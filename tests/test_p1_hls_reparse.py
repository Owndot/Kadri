"""P1: Erneute Analyse derselben Hauptliste darf frühere Sicherheitsinformationen nicht verlieren.

Echtes hls.js, echte Chromium-Requests. Dieselbe Playerinstanz lädt dieselbe Masteradresse über den regulären
Fehlerpfad (Fehler am eigenen Video -> tryNext) erneut. Der Server liefert hls.js pro Abruf eine festgelegte Liste;
der native Player des Seitenvideos erhält immer die vollständige Liste. Gezählt werden play() am Original, native
Masterrequests und Requests an die betroffene Variante."""
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
INF = '#EXT-X-STREAM-INF:BANDWIDTH=%d,RESOLUTION=320x180,CODECS="vp09.00.10.08,opus"'
A, Bv, C = (B + 'hls2/b/index.m3u8?r=%s' % x for x in ('a', 'b', 'c'))


def master(vs):
    return '#EXTM3U\n#EXT-X-VERSION:7\n' + ''.join('%s\n%s\n' % (INF % (150000 + i), u) for i, u in enumerate(vs))


class Net:
    def __init__(self, page):
        self.requests, self.mpd = [], set()
        self.plan, self.native, self.calls = [], '', 0
        page.on('request', lambda r: self.requests.append((r.url, r.resource_type)) if not r.headers.get('x-kadri-fixture') else None)
        page.route('**/*.m3u8*', self.route)

    def route(self, route):
        req = route.request
        url = req.url.split('#')[0]
        if req.headers.get('x-kadri-fixture') == 'parse-mpd' or url in self.mpd:
            return route.fulfill(body=MPD, content_type='application/dash+xml')
        if '/gen/' not in url:
            return route.continue_()
        if req.resource_type not in ('xhr', 'fetch'):
            return route.fulfill(body=self.native, content_type='application/vnd.apple.mpegurl')
        step = self.plan[min(self.calls, len(self.plan) - 1)]
        self.calls += 1
        if step == 'hold':
            return None   # bleibt offen
        if isinstance(step, int):
            return route.fulfill(status=step, body='nein')
        return route.fulfill(body=step, content_type='application/vnd.apple.mpegurl')

    def reset(self, plan, native):
        self.mpd.clear(); self.plan = plan; self.native = native; self.calls = 0

    def count(self, url, since, kinds=None):
        return sum(1 for u, t in self.requests[since:] if u.split('#')[0] == url and (kinds is None or t in kinds))


def setup(page, src):
    page.goto(B)
    page.set_content('<video id="v" muted playsinline preload="none"></video>')
    page.add_script_tag(path=ROOT / 'vendor/hls.min.js')
    page.add_script_tag(content=SOURCE)
    page.evaluate('''([t, src]) => {
      window.mpd = t;
      window.mark = async u => {
        const r = await fetch(u, {headers: {'x-kadri-fixture': 'parse-mpd'}});
        k.notePlaylist(u, r.url, await r.text());
        for (let i = 0; i < 44; i++) { const s = new URL('/analyses/' + Math.random() + '.mpd', location.href).href; k.notePlaylist(s, s, mpd); }
        return !k.dashSummaryOf(u) && k.mediaIsDashManifest(u);
      };
      window.log = {plays: 0};
      const play = HTMLMediaElement.prototype.play;
      v.play = function() { log.plays++; return play.call(this); };
      window.decoded = () => k.state()?.vid.videoWidth > 0 && k.state().vid.currentTime > 0.2;
      // Erneute Analyse derselben Quelle in derselben Playerinstanz (regulärer Fehlerpfad des eigenen Videos)
      window.reparse = () => { const st = k.state(); st.idx = 0; st.vid.dispatchEvent(new Event('error')); };
      v.src = src;
    }''', [MPD, src])


def finish(page, net, url, target, label, plays=0):
    since = len(net.requests)
    page.evaluate('() => { log.plays = 0; k.closePlayer(); }')
    page.wait_for_timeout(2500)
    obs = dict(plays=page.evaluate('log.plays'), nativeMaster=net.count(url, since, ('media',)),
               target=net.count(target, since) if target else 0, hlsCalls=net.calls)
    ok = obs['plays'] == plays if plays else (obs['plays'] == 0 and obs['nativeMaster'] == 0 and obs['target'] == 0)
    check(label, ok, obs)


def run(page, net):
    url = B + 'gen/m.m3u8'
    full = master([A, Bv])

    # Pflicht: vollständig geparst, Variante B später als MPD erkannt, erneuter Parse mit kürzerer Liste
    net.reset([full, master([A])], full)
    setup(page, url)
    page.evaluate('k.openBrowserPlayer(v)')
    page.wait_for_function('decoded()')
    page.evaluate('mark', Bv); net.mpd.add(Bv)
    page.evaluate('reparse()')
    page.wait_for_function('decoded() && k.state().hls.levels.length === 1')
    finish(page, net, url, Bv, 'Kürzere Liste nach erneutem Parsen vergisst die später als MPD erkannte Variante nicht')

    # Frühere negative Entscheidung (Guard-Ablehnung) bleibt nach erneutem Parsen wirksam (Start auf A, dann B laden)
    net.reset([master([Bv, A]), master([A])], master([Bv, A]))
    setup(page, url)
    page.evaluate('k.openBrowserPlayer(v)')
    page.wait_for_function('decoded() && k.state().hls.levels.length === 2')
    page.evaluate('mark', Bv); net.mpd.add(Bv)
    page.evaluate('''u => { const h = k.state().hls; const i = h.levels.findIndex(l => l.uri === u); h.nextLoadLevel = i; }''', Bv)
    page.wait_for_function('k.state().hls.levels.length === 1')
    page.evaluate('reparse()')
    page.wait_for_function('decoded() && k.state().hls.levels.length === 1')
    finish(page, net, url, Bv, 'Abgelehnte Variante: Ablehnung überdauert den erneuten Parse')

    # Vollständige, aber veränderte Liste
    net.reset([full, master([A, C])], master([A, Bv, C]))
    setup(page, url)
    page.evaluate('k.openBrowserPlayer(v)')
    page.wait_for_function('decoded()')
    page.evaluate('reparse()')
    page.wait_for_function('decoded() && k.state().hls.levels.some(l => l.uri.endsWith("r=c"))')
    page.evaluate('mark', Bv); net.mpd.add(Bv)
    finish(page, net, url, Bv, 'Veränderte Liste: früher erfasste Variante bleibt in der Entscheidung')

    # Unvollständigkeit bleibt bestehen
    big = master([B + 'hls2/b/index.m3u8?n=%d' % i for i in range(513)])
    net.reset([big, master([A])], big)
    setup(page, url)
    page.evaluate('k.openBrowserPlayer(v)')
    page.wait_for_function('decoded()', timeout=45000)
    page.evaluate('reparse()')
    page.wait_for_function('decoded() && k.state().hls.levels.length === 1')
    finish(page, net, url, None, 'Unvollständige Erfassung bleibt nach vollständigem kurzem Parse unvollständig')

    # Erneute Analyse nach ausstehender Antwort: neuer vollständiger Lauf gibt frei (Positivkontrolle)
    net.reset(['hold', full], full)
    setup(page, url)
    page.evaluate('k.openBrowserPlayer(v)')
    page.wait_for_timeout(400)
    page.evaluate('reparse()')
    page.wait_for_function('decoded()')
    finish(page, net, url, None, 'Positiv: neuer vollständiger Lauf nach ausstehender Antwort gibt frei', plays=1)

    # Erneute Analyse nach gescheitertem Lauf (Abruf und Retry 500): neuer vollständiger Lauf gibt frei
    net.reset([500, 500, full], full)
    setup(page, url)
    page.evaluate("() => { k.openBrowserPlayer(v); k.state().sources.push(k.state().sources[0]); }")
    page.wait_for_function('decoded()', timeout=20000)
    finish(page, net, url, None, 'Positiv: neuer vollständiger Lauf nach gescheitertem Lauf gibt frei', plays=1)

    # Andere Query derselben Masterpfadstruktur wird getrennt bewertet
    net.reset([full], full)
    setup(page, url + '?x=1')
    page.evaluate('mark', Bv); net.mpd.add(Bv)
    page.evaluate('k.openBrowserPlayer(v)')
    page.wait_for_function('decoded()')
    page.evaluate('k.closePlayer()')
    page.wait_for_timeout(300)
    net.mpd.clear()
    net.plan, net.calls, net.native = [master([A])], 0, master([A])
    page.evaluate("u => { log.plays = 0; v.src = u; }", url + '?x=2')
    page.evaluate('k.openBrowserPlayer(v)')
    page.wait_for_function('decoded()')
    finish(page, net, url + '?x=2', None, 'Positiv: andere Query wird getrennt bewertet und zurückgegeben', plays=1)


try:
    with sync_playwright() as pw:
        browser = pw.chromium.launch(executable_path=os.environ.get('KADRI_CHROMIUM') or '/usr/bin/chromium')
        page = browser.new_page()
        page.set_default_timeout(30000)
        run(page, Net(page))
        browser.close()
finally:
    shutdown()
done()
raise SystemExit(0 if all(results) else 1)
