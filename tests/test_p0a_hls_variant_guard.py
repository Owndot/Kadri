"""Echte hls.js-Instanzen und Chromium-Requests am Variantenladepfad."""
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
  CONFIG.resumeAfterClose = false;
  CONFIG.language = 'de';
  window.k = {
    openBrowserPlayer, closePlayer, dashSummaryOf, mediaIsDashManifest, notePlaylist,
    state: () => vp, shadow: () => root, epoch: () => mediaRegistry.contextFor(v).mediaEpoch,
  };
})();
'''
MASTER = B + 'hls2/master.m3u8'
LOW = B + 'hls2/b/index.m3u8'
HIGH = B + 'hls2/a/index.m3u8'


def setup(page):
    page.goto(B)
    page.set_content('<video id="v" muted playsinline preload="none"></video>')
    page.add_script_tag(path=ROOT / 'vendor/hls.min.js')
    page.add_script_tag(content=SOURCE)
    page.evaluate('''t => {
      window.mpd = t;
      window.mark = async u => {
        const r = await fetch(u, {headers: {'x-kadri-fixture': 'parse-mpd'}});
        if (!r.ok) throw Error('MPD-Fixture fehlt');
        k.notePlaylist(u, r.url, await r.text());
        for (let i = 0; i < 44; i++) {
          const s = new URL('/analyses/' + i + '.mpd', location.href).href;
          k.notePlaylist(s, s, mpd);
        }
        return !k.dashSummaryOf(u) && k.mediaIsDashManifest(u);
      };
      window.load = u => { v.src = u; k.openBrowserPlayer(v); };
      window.decoded = () => k.state()?.vid.videoWidth > 0 && k.state().vid.currentTime > 0;
      window.option = label => [...k.state().wrap.querySelectorAll('[role=menuitemradio]')]
        .find(b => b.firstChild?.textContent === label);
      window.quality = () => k.shadow().querySelector('[aria-label="Qualität"]').click();
      window.levelEvents = [];
      const attach = Hls.prototype.attachMedia;
      Hls.prototype.attachMedia = function(media) {
        const kind = (media.media || media).classList.contains('vpv') ? 'preview' : 'main';
        this.on(Hls.Events.LEVEL_LOADING, (_, data) => levelEvents.push([kind, data.url]));
        return attach.call(this, media);
      };
    }''', MPD)


def run_cases(page):
    requests = []

    def fixture(route):
        if route.request.headers.get('x-kadri-fixture') == 'parse-mpd':
            route.fulfill(body=MPD, content_type='application/dash+xml')
        else:
            route.continue_()

    page.route('**/index.m3u8*', fixture)
    page.on('request', lambda r: requests.append(r.url) if not r.headers.get('x-kadri-fixture') else None)

    for mode in ('vor Menü', 'altes Menü', 'automatisch', 'verspätet'):
        setup(page)
        page.evaluate('load', MASTER)
        page.wait_for_function('decoded() && k.state().hls.levels.length === 2')
        target = page.evaluate('''() => {
          const hls = k.state().hls;
          const index = hls.currentLevel === 1 ? 0 : 1;
          const {uri, height} = hls.levels[index];
          return {uri, label: height + 'p', index};
        }''')
        if mode == 'altes Menü':
            page.evaluate('''label => { quality(); window.oldOption = option(label); }''', target['label'])
        known = page.evaluate('mark', target['uri'])
        before = requests.count(target['uri'])
        outcome = page.evaluate('''({mode, index, label}) => {
          const hls = k.state().hls;
          if (mode === 'vor Menü') { quality(); option(label)?.click(); }
          if (mode === 'altes Menü') oldOption.click();
          if (mode === 'automatisch') { hls.nextAutoLevel = index; hls.nextLoadLevel = index; }
          if (mode === 'verspätet') setTimeout(() => { hls.nextLoadLevel = index; }, 60);
          return {offered: mode === 'vor Menü' && !!option(label), auto: hls.autoLevelEnabled};
        }''', dict(mode=mode, **target))
        page.wait_for_timeout(550)
        events = page.evaluate("(u) => levelEvents.filter(e => e[0] === 'main' && e[1] === u).length", target['uri'])
        observed = dict(known=known, requests=requests.count(target['uri']) - before, mainEvents=events, **outcome)
        check(mode + ' erreicht keinen neuen Playlistrequest', known and observed['requests'] == 0 and
              not observed['offered'] and (mode != 'automatisch' or outcome['auto']), observed)
        position = page.evaluate('k.state()?.vid.currentTime')
        page.wait_for_function('t => decoded() && k.state().vid.currentTime > t + 0.1', arg=position)

    setup(page)
    known = page.evaluate('mark', HIGH)
    before = requests.count(HIGH)
    page.evaluate('load', MASTER)
    page.wait_for_function('decoded()')
    check('Initiale Wahl lässt bekannte hohe Variante aus',
          known and requests.count(HIGH) == before, {'requests': requests.count(HIGH) - before})
    page.evaluate('k.closePlayer()')
    page.evaluate('load', MASTER)
    page.wait_for_function('decoded()')
    check('MPD-Veto gilt nach erneutem Öffnen', requests.count(HIGH) == before)
    page.evaluate("() => { k.closePlayer(); v.src = '/clip.mp4'; v.load(); }")
    page.wait_for_function('v.readyState >= 2')
    epoch = page.evaluate('k.epoch()')
    before = requests.count(HIGH)
    page.evaluate('u => { v.src = u; }', MASTER)
    page.wait_for_function('epoch => k.epoch() > epoch', arg=epoch)
    page.evaluate('k.openBrowserPlayer(v)')
    page.wait_for_function('decoded() && k.state().cur.endsWith("/hls2/master.m3u8")')
    check('MPD-Veto gilt nach Quellwechsel in neuer Medien-Epoche',
          page.evaluate('k.epoch()') > epoch and requests.count(HIGH) == before,
          {'epochBefore': epoch, 'epochAfter': page.evaluate('k.epoch()'), 'requests': requests.count(HIGH) - before})

    setup(page)
    page.evaluate('load', MASTER)
    page.wait_for_function('decoded() && k.state().hls.currentLevel === 1')
    known = page.evaluate('mark', LOW)
    before = requests.count(LOW)
    page.evaluate('k.state().prevWarm()')
    page.wait_for_function("k.shadow().querySelector('.vpv').videoWidth > 0")
    preview = page.evaluate("(u) => levelEvents.filter(e => e[0] === 'preview' && e[1] === u).length", LOW)
    check('HLS-Vorschau dekodiert mit erlaubter Variante, MPD bleibt gesperrt',
          known and requests.count(LOW) == before and preview == 0,
          dict(requests=requests.count(LOW) - before, previewEvents=preview))

    setup(page)
    page.route('**/hls2/guard-master.m3u8', lambda r: r.fulfill(
        body=(ROOT / 'tests/web/hls2/master.m3u8').read_text().replace('b/index.m3u8', 'b/index.m3u8?legitimate=1'),
        content_type='application/vnd.apple.mpegurl'))
    before = len(requests)
    page.evaluate('mark', LOW)
    page.evaluate('load', B + 'hls2/guard-master.m3u8')
    page.wait_for_function('decoded() && k.state().hls.currentLevel === 1')
    page.evaluate("() => { quality(); option('180p').click(); }")
    page.wait_for_function('decoded() && k.state().hls.currentLevel === 0')
    check('Erlaubter manueller Wechsel mit separater Query dekodiert',
          LOW + '?legitimate=1' in requests[before:] and LOW not in requests[before:])
    page.evaluate('''() => {
      const hls = k.state().hls;
      hls.currentLevel = -1;
      hls.nextAutoLevel = 1;
      hls.nextLoadLevel = 1;
    }''')
    page.wait_for_function('decoded() && k.state().hls.currentLevel === 1 && k.state().hls.autoLevelEnabled')
    check('Erlaubter automatischer Wechsel dekodiert', True)

    setup(page)
    audio, subtitle = B + 'hls3/aen/index.m3u8', B + 'hls3/sde/index.m3u8'
    page.evaluate('mark', audio)
    page.evaluate('mark', subtitle)
    before = {u: requests.count(u) for u in (audio, subtitle)}
    page.evaluate('load', B + 'hls3/master.m3u8')
    page.wait_for_function('decoded() && k.state().hls.audioTracks.length === 2')
    page.evaluate('k.state().hls.subtitleTrack = 0')
    page.wait_for_timeout(300)
    page.evaluate('k.state().hls.audioTrack = 1')
    page.wait_for_timeout(350)
    counts = {name: requests.count(u) - before[u] for name, u in [('Audio', audio), ('Untertitel', subtitle)]}
    check('Zentrale Grenze umfasst alternative Audio- und Untertitel-Playlists', not any(counts.values()), counts)

    setup(page)
    retry_url = MASTER + '?retry=1'
    deferred = []

    def retry_fixture(route):
        if route.request.headers.get('x-kadri-fixture'):
            route.fulfill(body=MPD, content_type='application/dash+xml')
        elif not deferred:
            deferred.append(route)
        else:
            route.continue_()

    page.route('**/master.m3u8?retry=1', retry_fixture)
    before = requests.count(retry_url)
    page.evaluate('load', retry_url)
    page.wait_for_timeout(200)
    if not deferred:
        raise RuntimeError('Master-Request fehlt vor dem Retry')
    known = page.evaluate('mark', retry_url)
    deferred[0].fulfill(status=503)
    page.wait_for_timeout(1300)
    check('Interner Master-Retry prüft die nachträgliche Klassifikation',
          known and requests.count(retry_url) - before == 1,
          {'initialAndRetry': requests.count(retry_url) - before})

    setup(page)
    page.evaluate('load', B + 'clip.mp4')
    page.wait_for_function('decoded()')
    check('MP4-Positivkontrolle dekodiert', page.evaluate("k.state().vid.currentSrc.endsWith('/clip.mp4')"))


try:
    with sync_playwright() as pw:
        browser = pw.chromium.launch(executable_path=os.environ.get('KADRI_CHROMIUM') or '/usr/bin/chromium')
        run_cases(browser.new_page())
        browser.close()
finally:
    shutdown()
done()
raise SystemExit(0 if all(results) else 1)
