"""P1: Der sofortige Positionsabgleich beim Schließen prüft vor dem Original-Seek die Übergabeentscheidung.

Echte Wiedergabe im integrierten Player (MP4 bzw. hls.js), danach Schließen mit resumeAfterClose. Am Seitenvideo
werden Seeks über den currentTime-Setter und play() gezählt; beide delegieren an die Originalimplementierung."""
import os
from pathlib import Path

from common import B, check, done, results, shutdown, sync_playwright

ROOT = Path(__file__).resolve().parents[1]
MPD = (ROOT / 'tests/web/dash/gate/g02-number-duration.mpd').read_text(encoding='utf-8')
SOURCE = ''.join(p.read_text(encoding='utf-8') for p in sorted((ROOT / 'src').glob('[0-9]*.js')))
SOURCE = SOURCE[:SOURCE.rindex('})();')] + '''
  CONFIG.startFullscreen = false;
  CONFIG.systemHelper = false;
  CONFIG.ambient = false;
  CONFIG.resumeAfterClose = true;
  CONFIG.language = 'de';
  window.k = {
    openBrowserPlayer, closePlayer, dashSummaryOf, mediaIsDashManifest, notePlaylist, CONFIG,
    state: () => vp,
  };
})();
'''
CLIP = B + 'clip.mp4'
MASTER = B + 'hls2/master.m3u8'
HIGH = B + 'hls2/a/index.m3u8'
INF = '#EXT-X-STREAM-INF:BANDWIDTH=%d,RESOLUTION=320x180,CODECS="vp09.00.10.08,opus"'


def setup(page, src, extra=''):
    page.goto(B)
    page.set_content('<video id="v" muted playsinline%s></video>' % extra)
    page.add_script_tag(path=ROOT / 'vendor/hls.min.js')
    page.add_script_tag(content=SOURCE)
    page.evaluate('''([t, src]) => {
      window.mpd = t;
      window.mark = u => {   // gelesener MPD-Inhalt unter dieser Adresse (wie der Klassifikationspfad nach dem Abruf)
        k.notePlaylist(u, u, mpd);
        for (let i = 0; i < 44; i++) { const s = new URL('/analyses/' + Math.random() + '.mpd', location.href).href; k.notePlaylist(s, s, mpd); }
        return !k.dashSummaryOf(u) && k.mediaIsDashManifest(u);
      };
      window.log = {plays: 0, seeks: []};
      const play = HTMLMediaElement.prototype.play, d = Object.getOwnPropertyDescriptor(HTMLMediaElement.prototype, 'currentTime');
      v.play = function() { log.plays++; return play.call(this); };
      Object.defineProperty(v, 'currentTime', {configurable: true, get() { return d.get.call(this); },
        set(x) { log.seeks.push(x); d.set.call(this, x); }});
      window.decodedPast = t => k.state()?.vid.videoWidth > 0 && k.state().vid.currentTime > t;
      v.src = src;
    }''', [MPD, src])


def close(page, wait=1500):
    page.evaluate('() => { log.plays = 0; log.seeks = []; window.ownAt = k.state().vid.currentTime; k.closePlayer(); }')
    page.wait_for_timeout(wait)
    return page.evaluate('''() => ({plays: log.plays, seeks: log.seeks.length, to: log.seeks[0], own: ownAt, now: v.currentTime,
      paused: v.paused})''')


def run(page):
    mpd_urls = set()
    page.route('**/*.m3u8*', lambda r: r.fulfill(body=MPD, content_type='application/dash+xml')
               if (r.request.headers.get('x-kadri-fixture') == 'parse-mpd' or r.request.url.split('#')[0] in mpd_urls)
               else (r.fulfill(body=page.gen, content_type='application/vnd.apple.mpegurl') if '/gen/' in r.request.url else r.continue_()))
    page.gen = ''

    # Negativ: MP4 legitim im Player, Originaladresse vor dem Schließen als MPD erkannt
    setup(page, '/clip.mp4', ' preload="auto"')
    page.wait_for_function('v.readyState >= 2')
    page.evaluate('k.openBrowserPlayer(v)')
    page.wait_for_function('decodedPast(1.2)')
    known = page.evaluate('mark', CLIP)
    r = close(page)
    check('MP4 vor dem Schließen als MPD erkannt: null Seek, null Play', known and r['seeks'] == 0 and r['plays'] == 0, dict(r, known=known))

    # Positiv: weiterhin zulässige MP4 mit deutlicher Zeitdifferenz
    setup(page, '/clip.mp4', ' preload="auto"')
    page.wait_for_function('v.readyState >= 2')
    page.evaluate('k.openBrowserPlayer(v)')
    page.wait_for_function('decodedPast(1.2)')
    r = close(page, 2000)
    check('Positiv: zulässige MP4 – Position synchronisiert, genau ein Start',
          r['seeks'] == 1 and abs(r['to'] - r['own']) < 0.3 and r['plays'] == 1 and not r['paused'] and r['now'] > r['to'], r)

    # Videoende: Rückgabe kurz vor das Ende, angehalten – zulässig bzw. gesperrt
    for blocked in (False, True):
        setup(page, '/clip.mp4', ' preload="auto"')
        page.wait_for_function('v.readyState >= 2')
        page.evaluate('k.openBrowserPlayer(v)')
        page.wait_for_function('decodedPast(0.3)')
        page.evaluate('() => { const m = k.state().vid; m.currentTime = m.duration - 0.6; }')
        page.wait_for_function('k.state().vid.currentTime > k.state().vid.duration - 0.6')
        if blocked:
            assert page.evaluate('mark', CLIP), 'MPD-Klassifikation fehlt'
        r = close(page)
        if blocked:
            check('Videoende, Adresse als MPD erkannt: null Seek, null Play', r['seeks'] == 0 and r['plays'] == 0, r)
        else:
            check('Positiv: Videoende – Seek kurz vor das Ende, angehalten, kein Start',
                  r['seeks'] == 1 and r['plays'] == 0 and r['paused'], r)

    # HLS: gesperrte Variante (hohe Stufe vor dem Öffnen als MPD erkannt), Wiedergabe über die niedrige
    setup(page, MASTER, ' preload="none"')
    assert page.evaluate('mark', HIGH), 'MPD-Klassifikation fehlt'
    mpd_urls.add(HIGH)
    page.evaluate('k.openBrowserPlayer(v)')
    page.wait_for_function('decodedPast(1.2)')
    r = close(page)
    check('HLS mit gesperrter Variante: null Seek, null Play', r['seeks'] == 0 and r['plays'] == 0, r)
    mpd_urls.clear()

    # HLS: unvollständig erfasster Master (513 Varianten)
    page.gen = '#EXTM3U\n#EXT-X-VERSION:7\n' + ''.join('%s\n%s\n' % (INF % (150000 + i), B + 'hls2/b/index.m3u8?n=%d' % i) for i in range(513))
    setup(page, B + 'gen/big.m3u8', ' preload="none"')
    page.evaluate('k.openBrowserPlayer(v)')
    page.wait_for_function('decodedPast(1.2)', timeout=45000)
    r = close(page)
    check('HLS-Master unvollständig erfasst: null Seek, null Play', r['seeks'] == 0 and r['plays'] == 0, r)

    # Positiv: vollständig geprüfter zulässiger HLS-Master
    setup(page, MASTER, ' preload="none"')
    page.evaluate('k.openBrowserPlayer(v)')
    page.wait_for_function('decodedPast(1.2)')
    r = close(page, 2000)
    check('Positiv: zulässiger HLS-Master – Position synchronisiert, genau ein Start',
          r['seeks'] == 1 and abs(r['to'] - r['own']) < 0.3 and r['plays'] == 1, r)

    # Bereits laufendes Original: Rückgabe ohne Fehler, Original läuft weiter
    setup(page, '/clip.mp4', ' preload="auto" loop')
    page.evaluate('() => HTMLMediaElement.prototype.play.call(v)')
    page.wait_for_function('v.currentTime > 0.3')
    page.evaluate('k.openBrowserPlayer(v)')
    page.wait_for_function('decodedPast(1.5)')
    r = close(page, 2000)
    check('Positiv: zuvor laufendes zulässiges Original läuft nach der Rückgabe weiter',
          r['seeks'] <= 1 and r['plays'] <= 1 and not r['paused'], r)

    # Playerersatz während des Schließens: alter Player wird übergeben, neuer übernimmt
    setup(page, '/clip.mp4', ' preload="auto"')
    page.wait_for_function('v.readyState >= 2')
    page.evaluate('k.openBrowserPlayer(v)')
    page.wait_for_function('decodedPast(1.2)')
    assert page.evaluate('mark', CLIP), 'MPD-Klassifikation fehlt'
    page.evaluate('() => { log.plays = 0; log.seeks = []; k.openBrowserPlayer(v); }')
    page.wait_for_timeout(1500)
    r = page.evaluate('({plays: log.plays, seeks: log.seeks.length})')
    check('Playerersatz bei inzwischen gesperrter Adresse: null Seek, null Play am Original', r['seeks'] == 0 and r['plays'] == 0, r)


try:
    with sync_playwright() as pw:
        browser = pw.chromium.launch(executable_path=os.environ.get('KADRI_CHROMIUM') or '/usr/bin/chromium')
        page = browser.new_page()
        page.set_default_timeout(30000)
        run(page)
        browser.close()
finally:
    shutdown()
done()
raise SystemExit(0 if all(results) else 1)
