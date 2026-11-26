"""P0-A: Rückfall auf Capture und Rückgabe bei abgelehnten HLS-Varianten (echtes hls.js, echte Chromium-Requests).

Gezählt werden die tatsächlichen play()-Aufrufe am Seitenvideo und die Netzwerkrequests an die gesperrten
Variantenadressen. Die Varianten werden vor dem Öffnen im echten Klassifikationspfad als MPD gelesen, ihre
Zusammenfassungen verdrängt; jede spätere Netzabfrage erhält wieder MPD-Bytes."""
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
MASTER = B + 'hls2/master.m3u8'
LOW = B + 'hls2/b/index.m3u8'
HIGH = B + 'hls2/a/index.m3u8'
VARIANTS = (LOW, HIGH)


def setup(page, video):
    page.goto(B)
    page.set_content(video)
    page.add_script_tag(path=ROOT / 'vendor/hls.min.js')
    page.add_script_tag(content=SOURCE)
    page.evaluate('''t => {
      window.mpd = t;
      window.mark = async u => {
        const r = await fetch(u, {headers: {'x-kadri-fixture': 'parse-mpd'}});
        if (!r.ok) throw Error('MPD-Fixture fehlt');
        k.notePlaylist(u, r.url, await r.text());
        for (let i = 0; i < 44; i++) {
          const s = new URL('/analyses/' + Math.random() + '.mpd', location.href).href;
          k.notePlaylist(s, s, mpd);
        }
        return true;
      };
      window.evicted = us => us.every(u => !k.dashSummaryOf(u) && k.mediaIsDashManifest(u));
      // Tatsächliche play()-Aufrufe am Seitenvideo, Originalimplementierung bleibt wirksam.
      window.origPlays = 0;
      const play = HTMLMediaElement.prototype.play;
      v.play = function() { origPlays++; return play.call(this); };
      window.decoded = () => k.state()?.vid.videoWidth > 0 && k.state().vid.currentTime > 0;
    }''', MPD)


def run_cases(page):
    requests = []
    mpd_variants = set()

    def fixture(route):
        url = route.request.url.split('#')[0]
        if route.request.headers.get('x-kadri-fixture') == 'parse-mpd' or url in mpd_variants:
            route.fulfill(body=MPD, content_type='application/dash+xml')
        else:
            route.continue_()

    page.route('**/index.m3u8*', fixture)
    page.on('request', lambda r: requests.append(r.url) if not r.headers.get('x-kadri-fixture') else None)

    # ---------- Negativfall: beide Varianten bekannte MPDs, pausiertes Original mit preload=none ----------
    for resume in (True, False):
        setup(page, '<video id="v" muted playsinline preload="none"></video>')
        page.evaluate('''([m, r]) => { v.src = m; k.CONFIG.resumeAfterClose = r; }''', [MASTER, resume])
        mpd_variants.clear()
        for u in VARIANTS:
            page.evaluate('mark', u)
            mpd_variants.add(u)
        known = page.evaluate('evicted', list(VARIANTS))
        native = page.evaluate("v.canPlayType('application/vnd.apple.mpegurl')")
        start = len(requests)
        page.evaluate('''() => {
          window.capture = 0;
          k.openBrowserPlayer(v);
          const st = k.state();
          window.trace = [];
          const iv = setInterval(() => { if (k.state() === st && st.mode === 'capture') capture = 1; }, 5);
          setTimeout(() => clearInterval(iv), 4000);
        }''')
        page.wait_for_timeout(4000)
        seen = requests[start:]
        observed = dict(known=known, nativeHls=native, origPlays=page.evaluate('origPlays'),
                        low=seen.count(LOW), high=seen.count(HIGH), masterRequests=seen.count(MASTER),
                        capture=page.evaluate('capture'), open=page.evaluate('!!k.state()'),
                        paused=page.evaluate('v.paused'))
        check('Gesperrte Varianten: kein Originalstart beim Rückfall (resumeAfterClose=%s)' % resume,
              known and observed['masterRequests'] >= 1 and observed['origPlays'] == 0, observed)
        check('Gesperrte Varianten: null Requests an beide Varianten (resumeAfterClose=%s)' % resume,
              known and observed['low'] == 0 and observed['high'] == 0, observed)
        check('Gesperrte Varianten: kontrollierter Abbruch statt Capture (resumeAfterClose=%s)' % resume,
              not observed['open'] and observed['paused'], observed)

    # ---------- Rückgabe nach dem Schließen: eine Variante gesperrt, eigene Wiedergabe über die andere ----------
    setup(page, '<video id="v" muted playsinline preload="none"></video>')
    page.evaluate('m => { v.src = m; }', MASTER)
    mpd_variants.clear()
    page.evaluate('mark', HIGH)
    mpd_variants.add(HIGH)
    start = len(requests)
    page.evaluate('k.openBrowserPlayer(v)')
    page.wait_for_function('decoded() && k.state().hls.levels.length === 1')
    page.wait_for_timeout(300)
    inside = requests[start:]
    check('Erlaubte Variante dekodiert im Player, gesperrte bleibt ohne Request',
          inside.count(HIGH) == 0 and inside.count(LOW) >= 1, dict(high=inside.count(HIGH), low=inside.count(LOW)))
    start = len(requests)
    page.evaluate('k.closePlayer()')
    page.wait_for_timeout(2500)
    seen = requests[start:]
    observed = dict(origPlays=page.evaluate('origPlays'), high=seen.count(HIGH), low=seen.count(LOW))
    check('Rückgabe startet kein Original mit bekannter gesperrter Variante',
          observed['origPlays'] == 0 and observed['high'] == 0, observed)

    # ---------- Kontextbindung: legitimer Medienwechsel im selben Element wird neu bewertet ----------
    page.evaluate("() => { origPlays = 0; v.src = '/clip.mp4'; v.load(); }")
    page.wait_for_function('v.readyState >= 2')
    page.evaluate('k.openBrowserPlayer(v)')
    page.wait_for_function("decoded() && k.state().vid.currentSrc.endsWith('/clip.mp4')")
    page.evaluate('k.closePlayer()')
    page.wait_for_timeout(400)
    plays = page.evaluate('origPlays')
    check('Nach Medienwechsel: zulässige MP4 wird wieder an das Original zurückgegeben', plays == 1, {'origPlays': plays})

    # ---------- Positive Kontrollen ----------
    setup(page, '<video id="v" muted playsinline preload="none"></video>')
    page.evaluate("v.src = '/clip.mp4'")
    page.evaluate('k.openBrowserPlayer(v)')
    page.wait_for_function("decoded() && k.state().vid.currentSrc.endsWith('/clip.mp4')")
    check('MP4-Positivkontrolle dekodiert', True)
    page.evaluate('k.closePlayer()')
    page.wait_for_timeout(400)
    plays = page.evaluate('origPlays')
    check('Sichere Rückgabe an zulässiges MP4-Original', plays == 1, {'origPlays': plays})

    setup(page, '<video id="v" muted playsinline preload="none"></video>')
    mpd_variants.clear()
    page.evaluate('m => { v.src = m; }', MASTER)
    page.evaluate('k.openBrowserPlayer(v)')
    page.wait_for_function('decoded() && k.state().hls.levels.length === 2')
    level = page.evaluate('k.state().hls.currentLevel')
    page.evaluate('l => { k.state().hls.currentLevel = l === 1 ? 0 : 1; }', level)
    page.wait_for_function('l => decoded() && k.state().hls.currentLevel === (l === 1 ? 0 : 1)', arg=level)
    t = page.evaluate('k.state().vid.currentTime')
    page.wait_for_function('t => k.state().vid.currentTime > t + 0.1', arg=t)
    check('HLS mit erlaubten Varianten dekodiert und wechselt sicher die Qualität', True)
    page.evaluate('k.closePlayer()')
    page.wait_for_timeout(400)
    plays = page.evaluate('origPlays')
    check('Sichere Rückgabe an HLS-Original ohne gesperrte Variante', plays == 1, {'origPlays': plays})

    # Bereits laufendes, zulässiges Original ohne eigene Quelle (Blob-MP4): passives Spiegeln
    setup(page, '<video id="v" muted playsinline loop></video>')
    page.route('**/opaque-bytes', lambda r: r.fulfill(path=str(ROOT / 'tests/web/clip.mp4'),
                                                      content_type='application/octet-stream'))
    page.evaluate('''async () => {
      const b = new Blob([await (await fetch('/opaque-bytes')).arrayBuffer()], {type: 'video/mp4'});
      v.src = URL.createObjectURL(b);
      await HTMLMediaElement.prototype.play.call(v);
    }''')
    page.wait_for_function('v.currentTime > 0.2')
    page.evaluate('() => { origPlays = 0; k.openBrowserPlayer(v); }')
    page.wait_for_function("k.state()?.mode === 'capture' && k.state().vid.videoWidth > 0")
    t = page.evaluate('k.state().vid.currentTime')
    page.wait_for_function('t => k.state().vid.currentTime > t + 0.1', arg=t)
    plays = page.evaluate('origPlays')
    check('Laufendes zulässiges Original wird passiv gespiegelt', plays == 0 and page.evaluate('!v.paused'),
          {'origPlays': plays})
    page.evaluate('k.closePlayer()')


try:
    with sync_playwright() as pw:
        browser = pw.chromium.launch(executable_path=os.environ.get('KADRI_CHROMIUM') or '/usr/bin/chromium')
        run_cases(browser.new_page())
        browser.close()
finally:
    shutdown()
done()
raise SystemExit(0 if all(results) else 1)
