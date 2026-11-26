"""P1: „In App öffnen“ verstellt das Original nur über die bewachte Rückgabeentscheidung.

Echte Wiedergabe im integrierten Player (MP4 bzw. hls.js), danach der Produktpfad „In App öffnen“ über den Knopf.
Gezählt: Original-currentTime-Setter, Original-play() (beide delegieren an die Originalimplementierung) und die
tatsächlichen externen Ausgabeversuche (Intent-Link-Klick und verzögerte Intent-Navigation als Zähler). Eine reale
App-Annahme wird damit nicht geprüft."""
import os
from pathlib import Path

from common import B, check, done, results, shutdown, sync_playwright

ROOT = Path(__file__).resolve().parents[1]
MPD = (ROOT / 'tests/web/dash/gate/g02-number-duration.mpd').read_text(encoding='utf-8')
SOURCE = ''.join(p.read_text(encoding='utf-8') for p in sorted((ROOT / 'src').glob('[0-9]*.js')))
assert SOURCE.count('location.href = intent;') == 1
SOURCE = SOURCE.replace('location.href = intent;', 'window.log.nav.push(intent);')   # Ausweichnavigation desselben Aufrufs
SOURCE = SOURCE[:SOURCE.rindex('})();')] + '''
  CONFIG.startFullscreen = false;
  CONFIG.systemHelper = false;
  CONFIG.ambient = false;
  CONFIG.resumeAfterClose = true;
  CONFIG.language = 'de';
  window.k = {
    openBrowserPlayer, closePlayer, dashSummaryOf, mediaIsDashManifest, notePlaylist, CONFIG,
    state: () => vp,
    appButton: () => root.querySelector('[aria-label="In externer App öffnen"], [aria-label="Open in external app"]'),
  };
})();
'''
INF = '#EXT-X-STREAM-INF:BANDWIDTH=%d,RESOLUTION=320x180,CODECS="vp09.00.10.08,opus"'


def gen(n):
    return '#EXTM3U\n#EXT-X-VERSION:7\n' + ''.join('%s\n%s\n' % (INF % (150000 + i), B + 'hls2/b/index.m3u8?n=%d' % i) for i in range(n))


def setup(page, src, extra=' preload="auto"'):
    page.goto(B)
    page.set_content('<video id="v" muted playsinline%s></video>' % extra)
    page.add_script_tag(path=ROOT / 'vendor/hls.min.js')
    page.add_script_tag(content='window.log = {plays: 0, seeks: [], intents: [], nav: [], order: []};')
    page.add_script_tag(content=SOURCE)
    page.evaluate('''([t, src]) => {
      window.mpd = t;
      window.mark = u => {
        k.notePlaylist(u, u, mpd);
        for (let i = 0; i < 44; i++) { const s = new URL('/analyses/' + Math.random() + '.mpd', location.href).href; k.notePlaylist(s, s, mpd); }
        return !k.dashSummaryOf(u) && k.mediaIsDashManifest(u);
      };
      const play = HTMLMediaElement.prototype.play, d = Object.getOwnPropertyDescriptor(HTMLMediaElement.prototype, 'currentTime');
      window.watch = el => {
        el.play = function() { log.plays++; log.order.push('play'); return play.call(this); };
        Object.defineProperty(el, 'currentTime', {configurable: true, get() { return d.get.call(this); },
          set(x) { log.seeks.push(x); log.order.push('seek'); d.set.call(this, x); }});
      };
      watch(v);
      const click = HTMLAnchorElement.prototype.click;
      HTMLAnchorElement.prototype.click = function() { if (/^intent:/.test(this.href)) { log.intents.push(this.href); log.order.push('intent'); return; } return click.call(this); };
      window.decodedPast = t => k.state()?.vid.videoWidth > 0 && k.state().vid.currentTime > t;
      v.src = src;
    }''', [MPD, src])


def act(page, how):
    page.evaluate('''how => { log.plays = 0; log.seeks = []; log.intents = []; log.nav = []; log.order = [];
      window.ownAt = k.state().vid.currentTime;
      if (how === 'app') k.appButton().click(); else k.closePlayer(); }''', how)
    page.wait_for_timeout(1600)
    return page.evaluate('''() => ({seeks: log.seeks.length, to: log.seeks.slice(), own: ownAt, plays: log.plays,
      intents: log.intents.length, nav: log.nav.length, open: !!k.state(), order: log.order.join(',')})''')


def run(page):
    page.route('**/gen/*', lambda r: r.fulfill(body=page.gen, content_type='application/vnd.apple.mpegurl'))
    page.gen = gen(513)

    # Unvollständiger Master (513 zulässige Varianten): normales Schließen und „In App öffnen“
    for how in ('close', 'app'):
        setup(page, B + 'gen/big.m3u8', ' preload="none"')
        page.evaluate('k.openBrowserPlayer(v)')
        page.wait_for_function('decodedPast(1.2)', timeout=45000)
        r = act(page, how)
        if how == 'close':
            check('Unvollständiger Master, normales Schließen: 0 Original-Seeks, 0 Plays', r['seeks'] == 0 and r['plays'] == 0, r)
        else:
            check('Unvollständiger Master, „In App öffnen“: 0 Original-Seeks, 0 Plays, genau eine externe Ausgabe',
                  r['seeks'] == 0 and r['plays'] == 0 and r['intents'] == 1 and not r['open'], r)

    # Vollständiger Master, eine Variante später als MPD erkannt
    page.gen = gen(2)
    setup(page, B + 'gen/two.m3u8', ' preload="none"')
    page.evaluate('k.openBrowserPlayer(v)')
    page.wait_for_function('decodedPast(1.2)')
    assert page.evaluate('mark', B + 'hls2/b/index.m3u8?n=0')
    r = act(page, 'app')
    check('Bekannte MPD-Variante, „In App öffnen“: 0 Original-Seeks, 0 Plays', r['seeks'] == 0 and r['plays'] == 0, r)

    # MP4 inzwischen als MPD erkannt: keine Ausgabe, kein Eingriff am Original
    setup(page, B + 'clip.mp4')
    page.wait_for_function('v.readyState >= 2')
    page.evaluate('k.openBrowserPlayer(v)')
    page.wait_for_function('decodedPast(1.2)')
    assert page.evaluate('mark', B + 'clip.mp4')
    r = act(page, 'app')
    check('Als MPD umklassifizierte MP4, „In App öffnen“: kein Seek, kein Play, keine Ausgabe', r['seeks'] == 0 and r['plays'] == 0 and r['intents'] == 0, r)

    # Altes, ersetztes Originalelement
    setup(page, B + 'clip.mp4')
    page.wait_for_function('v.readyState >= 2')
    page.evaluate('k.openBrowserPlayer(v)')
    page.wait_for_function('decodedPast(1.2)')
    page.evaluate("() => { const n = document.createElement('video'); n.muted = true; n.src = '/clip.mp4'; watch(n); v.replaceWith(n); }")
    r = act(page, 'app')
    check('Ersetztes Originalelement, „In App öffnen“: kein Seek, kein Play am alten oder neuen Element', r['seeks'] == 0 and r['plays'] == 0, r)

    # Positiv: zulässige MP4 und vollständig positiver HLS-Master
    for name, src, extra in (('MP4', B + 'clip.mp4', ' preload="auto"'), ('HLS', B + 'hls2/master.m3u8', ' preload="none"')):
        setup(page, src, extra)
        if name == 'MP4':
            page.wait_for_function('v.readyState >= 2')
        page.evaluate('k.openBrowserPlayer(v)')
        page.wait_for_function('decodedPast(1.2)')
        r = act(page, 'app')
        check('Positiv %s, „In App öffnen“: genau ein Seek auf die eigene Position, genau eine externe Ausgabe' % name,
              r['seeks'] == 1 and abs(r['to'][0] - r['own']) < 0.3 and r['intents'] == 1 and r['order'].index('seek') < r['order'].index('intent'), r)


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
