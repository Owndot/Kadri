"""P0-A: Ein von Kadri ausgelöster nativer HLS-Originalstart braucht eine vollständige, gültige Masterentscheidung.

Echtes hls.js im integrierten Player, echte Chromium-Requests. Am Seitenvideo werden play() (Originalimplementierung
bleibt wirksam) und Seeks gezählt. Bekannte MPD-Varianten werden vorher über den echten Klassifikationspfad gelesen und
aus dem Summary-Cache verdrängt; jede spätere Netzabfrage dieser Adressen erhält MPD-Bytes.

Teil 1: Schließen vor bzw. um die Masterantwort (ausstehend, Fehler, Timeout, Ersatz, Epoche, wiederholt).
Teil 2: Variantenbudget 510–514, Audio/Untertitel/Alias nach dem Limit, Duplikate, Querys, I-Frame, Content Steering."""
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
INF = '#EXT-X-STREAM-INF:BANDWIDTH=%d,RESOLUTION=320x180,CODECS="vp09.00.10.08,opus"'


def master(variants, head=(), tail=()):
    lines = ['#EXTM3U', '#EXT-X-VERSION:7', *head]
    for i, uri in enumerate(variants):
        lines += [INF % (150000 + i), uri]
    return '\n'.join(lines + list(tail)) + '\n'


def var(i, q='v'):
    return B + 'hls2/b/index.m3u8?%s=%d' % (q, i)


class Net:
    def __init__(self, page):
        self.requests = []      # (url, resource_type)
        self.mpd = set()        # Adressen, die bei jeder Netzabfrage MPD-Bytes erhalten
        self.generated = {}     # Pfad -> Mastertext
        self.hold = None        # Pfad, dessen erster hls.js-Abruf offen bleibt
        self.held = []
        self.fail = set()       # Pfade, deren hls.js-Abruf mit 500 endet
        page.on('request', lambda r: self.requests.append((r.url, r.resource_type)) if not r.headers.get('x-kadri-fixture') else None)
        page.route('**/*.m3u8*', self.route)

    def route(self, route):
        req = route.request
        url = req.url.split('#')[0]
        path = url[len(B) - 1:].split('?')[0]
        if req.headers.get('x-kadri-fixture') == 'parse-mpd' or url in self.mpd:
            return route.fulfill(body=MPD, content_type='application/dash+xml')
        xhr = req.resource_type in ('xhr', 'fetch')
        if xhr and path in self.fail:
            return route.fulfill(status=500, body='nein')
        if xhr and self.hold == path and not self.held:
            self.held.append(route)
            return None
        body = self.generated.get(path)
        if body is not None:
            return route.fulfill(body=body, content_type='application/vnd.apple.mpegurl')
        return route.continue_()

    def release(self):
        for r in self.held:
            path = r.request.url.split('#')[0][len(B) - 1:].split('?')[0]
            try:
                if path in self.generated:
                    r.fulfill(body=self.generated[path], content_type='application/vnd.apple.mpegurl')
                else:
                    r.continue_()
            except Exception:
                pass
        self.held.clear()

    def reset(self):
        self.mpd.clear(); self.generated.clear(); self.hold = None; self.held.clear(); self.fail.clear()

    def count(self, url, since, kinds=None):
        return sum(1 for u, t in self.requests[since:] if u.split('#')[0] == url and (kinds is None or t in kinds))


def setup(page, src=MASTER, extra=''):
    page.goto(B)
    page.set_content('<video id="v" muted playsinline preload="none"%s></video>' % extra)
    page.add_script_tag(path=ROOT / 'vendor/hls.min.js')
    page.add_script_tag(content=SOURCE)
    page.evaluate('''([t, src]) => {
      window.mpd = t;
      window.mark = async u => {
        const r = await fetch(u, {headers: {'x-kadri-fixture': 'parse-mpd'}});
        if (!r.ok) throw Error('MPD-Fixture fehlt');
        k.notePlaylist(u, r.url, await r.text());
        for (let i = 0; i < 44; i++) {
          const s = new URL('/analyses/' + Math.random() + '.mpd', location.href).href;
          k.notePlaylist(s, s, mpd);
        }
        return !k.dashSummaryOf(u) && k.mediaIsDashManifest(u);
      };
      window.log = {plays: 0, seeks: 0, hlsLive: 0, hlsMade: 0};
      const play = HTMLMediaElement.prototype.play, d = Object.getOwnPropertyDescriptor(HTMLMediaElement.prototype, 'currentTime');
      v.play = function() { log.plays++; return play.call(this); };
      Object.defineProperty(v, 'currentTime', {configurable: true, get() { return d.get.call(this); },
        set(x) { log.seeks++; d.set.call(this, x); }});
      const attach = Hls.prototype.attachMedia, destroy = Hls.prototype.destroy;
      Hls.prototype.attachMedia = function(m) { log.hlsMade++; log.hlsLive++; return attach.call(this, m); };
      Hls.prototype.destroy = function() { if (!this.__gone) { this.__gone = true; log.hlsLive--; } return destroy.call(this); };
      window.decoded = () => k.state()?.vid.videoWidth > 0 && k.state().vid.currentTime > 0.2;
      if (src) v.src = src;
    }''', [MPD, src])


def snap(page):
    return page.evaluate('({plays: log.plays, seeks: log.seeks, hlsLive: log.hlsLive, open: !!k.state(), paused: v.paused})')


def closed(page, net, since, variants, master_url, label, plays=0, wait=2500):
    page.wait_for_timeout(wait)
    s = snap(page)
    obs = dict(s, master=net.count(master_url, since), variants={u.replace(B, '/'): net.count(u, since) for u in variants})
    ok = s['plays'] == plays and (plays or (net.count(master_url, since, ('media',)) == 0 and not any(obs['variants'].values()) and s['paused']))
    check(label, ok, obs)
    return obs


def pending_cases(page, net):
    # ---------- Teil 1: Schließen vor bzw. um die Masterantwort ----------
    for resume in (True, False):
        net.reset()
        setup(page)
        page.evaluate('r => { k.CONFIG.resumeAfterClose = r; }', resume)
        for u in (LOW, HIGH):
            page.evaluate('mark', u); net.mpd.add(u)
        net.hold = '/hls2/master.m3u8'
        page.evaluate('k.openBrowserPlayer(v)')
        page.wait_for_timeout(400)
        assert net.held, 'Masterabruf wurde nicht zurückgehalten'
        since = len(net.requests)
        page.evaluate('() => { log.plays = 0; log.seeks = 0; k.closePlayer(); }')
        closed(page, net, since, (LOW, HIGH), MASTER, 'Schließen vor Masterantwort (resumeAfterClose=%s): kein Originalstart, keine Requests' % resume)
        net.release()
        page.wait_for_timeout(1200)
        s = snap(page)
        check('… späte Masterantwort reaktiviert nichts (resumeAfterClose=%s)' % resume,
              s['plays'] == 0 and not s['open'] and s['hlsLive'] == 0 and net.count(LOW, since) + net.count(HIGH, since) == 0, s)

    # Antwort unmittelbar vor dem Schließen
    net.reset(); setup(page)
    for u in (LOW, HIGH):
        page.evaluate('mark', u); net.mpd.add(u)
    net.hold = '/hls2/master.m3u8'
    page.evaluate('k.openBrowserPlayer(v)')
    page.wait_for_timeout(400)
    since = len(net.requests)
    net.release()
    page.evaluate('() => { log.plays = 0; k.closePlayer(); }')
    closed(page, net, since, (LOW, HIGH), MASTER, 'Masterantwort unmittelbar vor dem Schließen: kein Originalstart, keine Requests')

    # Masterabruf schlägt fehl
    net.reset(); setup(page)
    for u in (LOW, HIGH):
        page.evaluate('mark', u); net.mpd.add(u)
    net.fail.add('/hls2/master.m3u8')
    since = len(net.requests)
    page.evaluate('k.openBrowserPlayer(v)')
    closed(page, net, since, (LOW, HIGH), MASTER, 'Masterabruf schlägt fehl: kontrollierter Abbruch ohne Originalstart', wait=4000)

    # Masterabruf bleibt offen (Lade-Timeout des Players nach 9 s)
    net.reset(); setup(page)
    for u in (LOW, HIGH):
        page.evaluate('mark', u); net.mpd.add(u)
    net.hold = '/hls2/master.m3u8'
    since = len(net.requests)
    page.evaluate('k.openBrowserPlayer(v)')
    page.wait_for_timeout(9800)
    closed(page, net, since, (LOW, HIGH), MASTER, 'Masterabruf läuft in den Lade-Timeout: kein Originalstart', wait=1500)
    net.release()

    # Player wird während der Analyse ersetzt
    net.reset(); setup(page)
    for u in (LOW, HIGH):
        page.evaluate('mark', u); net.mpd.add(u)
    net.hold = '/hls2/master.m3u8'
    page.evaluate('k.openBrowserPlayer(v)')
    page.wait_for_timeout(400)
    since = len(net.requests)
    page.evaluate('() => { log.plays = 0; k.openBrowserPlayer(v); }')
    closed(page, net, since, (LOW, HIGH), MASTER, 'Player während der Analyse ersetzt: kein Originalstart', wait=3500)
    net.release()

    # Wiederholtes Öffnen und Schließen bei ausstehender Analyse
    net.reset(); setup(page)
    for u in (LOW, HIGH):
        page.evaluate('mark', u); net.mpd.add(u)
    net.hold = '/hls2/master.m3u8'
    since = len(net.requests)
    for _ in range(3):
        page.evaluate('k.openBrowserPlayer(v)')
        page.wait_for_timeout(250)
        page.evaluate('k.closePlayer()')
    closed(page, net, since, (LOW, HIGH), MASTER, 'Wiederholtes Öffnen/Schließen bei ausstehender Analyse: kein Originalstart')
    net.release()

    # Neue Medien-Epoche während der Analyse: zulässige MP4 wird neu bewertet
    net.reset(); setup(page)
    for u in (LOW, HIGH):
        page.evaluate('mark', u); net.mpd.add(u)
    net.hold = '/hls2/master.m3u8'
    page.evaluate('k.openBrowserPlayer(v)')
    page.wait_for_timeout(400)
    page.evaluate("() => { log.plays = 0; v.src = '/clip.mp4'; v.load(); }")
    page.wait_for_function('v.readyState >= 1')
    page.evaluate('k.closePlayer()')
    page.wait_for_timeout(600)
    s = snap(page)
    check('Neue Medien-Epoche (MP4) während ausstehender Analyse: zulässiger Originalstart', s['plays'] == 1, s)
    net.release()

    # Original läuft bereits (natives HLS, nichts gesperrt): kein zusätzlicher Kadri-Start, Original läuft weiter
    net.reset(); setup(page, extra=' loop')
    page.evaluate('() => HTMLMediaElement.prototype.play.call(v)')
    page.wait_for_function('v.currentTime > 0.3')
    net.hold = '/hls2/master.m3u8'
    page.evaluate('() => { log.plays = 0; k.openBrowserPlayer(v); }')
    page.wait_for_timeout(300)
    page.evaluate('k.closePlayer()')
    page.wait_for_timeout(800)
    s = snap(page)
    t = page.evaluate('v.currentTime')
    page.wait_for_timeout(500)
    check('Bereits laufendes Original bei ausstehender Analyse: kein Kadri-Start, Wiedergabe läuft weiter',
          s['plays'] == 0 and page.evaluate('t => v.currentTime > t', t), s)
    net.release()

    # Positive Kontrollen: unabhängige MP4 und vollständig geprüfter zulässiger HLS-Master
    net.reset(); setup(page, src=B + 'clip.mp4')
    page.evaluate('k.openBrowserPlayer(v)')
    page.wait_for_function("decoded() && k.state().vid.currentSrc.endsWith('/clip.mp4')")
    page.evaluate('() => { log.plays = 0; k.closePlayer(); }')
    page.wait_for_timeout(500)
    s = snap(page)
    check('Positiv: unabhängige MP4 dekodiert und wird an das Original zurückgegeben', s['plays'] == 1, s)

    net.reset(); setup(page)
    page.evaluate('k.openBrowserPlayer(v)')
    page.wait_for_function('decoded() && k.state().hls.levels.length === 2')
    since = len(net.requests)
    page.evaluate('() => { log.plays = 0; k.closePlayer(); }')
    page.wait_for_timeout(1500)
    s = snap(page)
    check('Positiv: vollständig geprüfter zulässiger HLS-Master wird nativ zurückgegeben',
          s['plays'] == 1 and net.count(MASTER, since, ('media',)) >= 1 and s['hlsLive'] == 0, dict(s, nativeMaster=net.count(MASTER, since, ('media',))))


def big(page, net, name, text, last, mark_last=True, plays=0, label=None):
    """Master öffnen, Dekodierung abwarten, optional letzte Adresse als MPD erkennen, schließen und zählen."""
    net.reset()
    path = '/gen/%s.m3u8' % name
    net.generated[path] = text
    url = B + path.lstrip('/')
    setup(page, src=url)
    page.evaluate('k.openBrowserPlayer(v)')
    page.wait_for_function('decoded()', timeout=45000)
    levels = page.evaluate('k.state().hls.levels.length')
    if mark_last:
        page.evaluate('mark', last)
        net.mpd.add(last)
    since = len(net.requests)
    page.evaluate('() => { log.plays = 0; log.seeks = 0; k.closePlayer(); }')
    page.wait_for_timeout(2500)
    s = snap(page)
    obs = dict(s, levels=levels, nativeMaster=net.count(url, since, ('media',)), last=net.count(last, since))
    if plays:
        ok = s['plays'] == plays
    else:
        ok = s['plays'] == 0 and obs['nativeMaster'] == 0 and obs['last'] == 0
    check(label or name, ok, obs)
    return obs


def budget_cases(page, net):
    # ---------- Teil 2: Budget und Vollständigkeit ----------
    for n in (510, 511, 512, 513, 514):
        vs = [var(i) for i in range(n)]
        big(page, net, 'n%d' % n, master(vs), vs[-1],
            label='%d Varianten, letzte später als MPD erkannt: kein nativer Originalstart, kein Request an sie' % n)
    vs = [var(i) for i in range(512)]
    big(page, net, 'n512ok', master(vs), vs[-1], mark_last=False, plays=1,
        label='Positiv: 512 vollständig erfasste zulässige Varianten werden nativ zurückgegeben')
    vs = [var(i) for i in range(513)]
    obs = big(page, net, 'n513ok', master(vs), vs[-1], mark_last=False, plays=0,
              label='513 Varianten ohne bekannte MPD: unvollständig erfasst, kein nativer Originalstart')
    vs = [var(i) for i in range(512)]
    audio = B + 'hls3/aen/index.m3u8?a=513'
    sub = B + 'hls3/sde/index.m3u8?s=513'
    media = {'Audio': '#EXT-X-MEDIA:TYPE=AUDIO,GROUP-ID="x",NAME="en",DEFAULT=NO,AUTOSELECT=NO,URI="%s"' % audio,
             'Untertitel': '#EXT-X-MEDIA:TYPE=SUBTITLES,GROUP-ID="s",NAME="de",DEFAULT=NO,AUTOSELECT=NO,URI="%s"' % sub}
    for name, line in media.items():
        target = audio if name == 'Audio' else sub
        # vor den Varianten: die Spuradresse ist erfasst, die 513. Adresse ist eine Variante
        big(page, net, name + 'vorn', master(vs, head=[line]), target,
            label='%s-Playlist vor 512 Varianten als MPD: kein nativer Originalstart' % name)
        # hinter den Varianten: die Spuradresse ist die 513. Adresse jenseits des Limits
        big(page, net, name + 'hinten', master(vs, tail=[line]), target,
            label='%s-Playlist als 513. Adresse hinter dem Limit als MPD: kein nativer Originalstart' % name)
    alias = var(9999, 'alias')
    big(page, net, 'alias', master(vs) + (INF % 150000) + '\n' + alias + '\n', alias,
        label='Aliasadresse nach dem Limit als MPD: kein nativer Originalstart')
    dup = [var(i % 300) for i in range(700)]
    big(page, net, 'dup', master(dup), dup[-1], mark_last=False, plays=1,
        label='Positiv: 700 Einträge mit 300 eindeutigen Adressen verbrauchen kein Budget')
    q = [var(1, 'q'), var(2, 'q')]
    big(page, net, 'qother', master(q), var(9, 'q'), plays=1,
        label='Positiv: dieselbe Variante mit anderer Query als MPD sperrt nicht')
    big(page, net, 'qsame', master(q), q[1],
        label='Variante mit exakter Query als MPD: kein nativer Originalstart')
    iframe = B + 'hls2/b/iframe.m3u8'
    big(page, net, 'iframe', master(q, tail=['#EXT-X-I-FRAME-STREAM-INF:BANDWIDTH=10000,URI="%s"' % iframe]), iframe,
        label='I-Frame-Playlist (nicht in hls.js-Leveln) als MPD: kein nativer Originalstart')
    big(page, net, 'steering', master(q, head=['#EXT-X-CONTENT-STEERING:SERVER-URI="/steering.json"']), q[0], mark_last=False, plays=0,
        label='Content Steering (dynamische Pfade): nicht vollständig prüfbar, kein nativer Originalstart')


try:
    with sync_playwright() as pw:
        browser = pw.chromium.launch(executable_path=os.environ.get('KADRI_CHROMIUM') or '/usr/bin/chromium')
        page = browser.new_page()
        page.set_default_timeout(30000)
        net = Net(page)
        which = os.environ.get('KADRI_PART', 'all')
        if which in ('all', 'pending'):
            pending_cases(page, net)
        if which in ('all', 'budget'):
            budget_cases(page, net)
        browser.close()
finally:
    shutdown()
done()
raise SystemExit(0 if all(results) else 1)
