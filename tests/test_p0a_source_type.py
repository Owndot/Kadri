"""P0-A: Medientyp nach Belegen statt Dateiendung – eigener Player und von Kadri ausgelöster Originalstart.

Echte Chromium-Requests (Ressourcentyp: xhr = hls.js, media = nativer Player, fetch = Kadris Typprobe), echtes hls.js.
Am Seitenvideo werden play() und Seeks gezählt (Originalimplementierung bleibt wirksam). Bekannte MPD-Kinder werden
vorab über den echten Klassifikationspfad gelesen und aus dem Summary-Cache verdrängt; spätere Abrufe dieser Adressen
erhalten MPD-Bytes. Gleiche HLS-Inhalte liegen unter verschiedenen Pfaden (endungslos, .m3u8, .m3u, irreführend .mp4)."""
import os
from pathlib import Path

from common import B, check, done, results, shutdown, sync_playwright

ROOT = Path(__file__).resolve().parents[1]
MPD = (ROOT / 'tests/web/dash/gate/g02-number-duration.mpd').read_text(encoding='utf-8')
CLIP = (ROOT / 'tests/web/clip.mp4').read_bytes()
SOURCE = ''.join(p.read_text(encoding='utf-8') for p in sorted((ROOT / 'src').glob('[0-9]*.js')))
SOURCE = SOURCE[:SOURCE.rindex('})();')] + '''
  CONFIG.startFullscreen = false;
  CONFIG.systemHelper = false;
  CONFIG.ambient = false;
  CONFIG.resumeAfterClose = true;
  CONFIG.language = 'de';
  window.k = {
    openBrowserPlayer, closePlayer, dashSummaryOf, mediaIsDashManifest, notePlaylist, mediaRoleHint, CONFIG,
    state: () => vp,
  };
})();
'''
INF = '#EXT-X-STREAM-INF:BANDWIDTH=%d,RESOLUTION=320x180,CODECS="vp09.00.10.08,opus"'
KID_A = B + 'hls2/a/index.m3u8?src=gen'
KID_B = B + 'hls2/b/index.m3u8?src=gen'
MASTER_TEXT = '#EXTM3U\n#EXT-X-VERSION:7\n%s\n%s\n%s\n%s\n' % (INF % 400000, KID_A, INF % 150000, KID_B)
HLS_CT = 'application/vnd.apple.mpegurl'


class Net:
    def __init__(self, page):
        self.requests = []
        self.mpd = set()
        self.serve = {}      # Pfad samt Query -> (Body, Content-Type)
        self.hold = None     # Adresse, deren erster xhr-/media-Abruf offen bleibt
        self.held = []
        page.on('request', lambda r: self.requests.append((r.url.split('#')[0], r.resource_type)) if not r.headers.get('x-kadri-fixture') else None)
        page.route('**/*', self.route)

    def route(self, route):
        req = route.request
        url = req.url.split('#')[0]
        if req.headers.get('x-kadri-fixture') == 'parse-mpd' or url in self.mpd:
            return route.fulfill(body=MPD, content_type='application/dash+xml')
        if self.hold == url and req.resource_type in ('xhr', 'media') and not self.held:
            self.held.append(route)
            return None
        rel = url[len(B) - 1:]
        if rel in self.serve:
            body, ct = self.serve[rel]
            return route.fulfill(body=body, content_type=ct, headers={'Access-Control-Allow-Origin': '*'} if ct != 'video/mp4' else {})
        return route.continue_()

    def release(self):
        for r in self.held:
            try:
                rel = r.request.url.split('#')[0][len(B) - 1:]
                if rel in self.serve:
                    r.fulfill(body=self.serve[rel][0], content_type=self.serve[rel][1])
                else:
                    r.continue_()
            except Exception:
                pass
        self.held.clear()

    def reset(self):
        self.mpd = set(); self.serve = {}; self.hold = None; self.held = []

    def count(self, url, since, kinds=None):
        return sum(1 for u, t in self.requests[since:] if u == url and (kinds is None or t in kinds))


def setup(page, src, extra=' preload="none"'):
    page.goto(B)
    page.set_content('<video id="v" muted playsinline%s></video>' % extra)
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
      // Rolle vorab beobachtet: wie der Mitleser der Seite den gelesenen Playlisttext meldet
      window.observe = async u => { const r = await fetch(u, {headers: {'x-kadri-fixture': 'observe'}}); k.notePlaylist(u, r.url, await r.text()); return k.mediaRoleHint(u); };
      window.log = {plays: 0, seeks: 0, hlsMade: 0, hlsLive: 0, ownSrc: []};
      const play = HTMLMediaElement.prototype.play, d = Object.getOwnPropertyDescriptor(HTMLMediaElement.prototype, 'currentTime');
      v.play = function() { log.plays++; return play.call(this); };
      Object.defineProperty(v, 'currentTime', {configurable: true, get() { return d.get.call(this); }, set(x) { log.seeks++; d.set.call(this, x); }});
      const attach = Hls.prototype.attachMedia, destroy = Hls.prototype.destroy;
      Hls.prototype.attachMedia = function(m) { log.hlsMade++; log.hlsLive++; return attach.call(this, m); };
      Hls.prototype.destroy = function() { if (!this.__gone) { this.__gone = true; log.hlsLive--; } return destroy.call(this); };
      window.decoded = () => k.state()?.vid.videoWidth > 0 && k.state().vid.currentTime > 0.2;
      if (src) v.src = src;
    }''', [MPD, src])


def wait(page, expr, arg=None, timeout=20000):
    try:
        page.wait_for_function(expr, arg=arg, timeout=timeout)
        return True
    except Exception:
        return False


def mark_kids(page, net):
    for u in (KID_A, KID_B):
        assert page.evaluate('mark', u), 'MPD-Klassifikation fehlt'
        net.mpd.add(u)


def snap(page):
    return page.evaluate('({plays: log.plays, seeks: log.seeks, hlsMade: log.hlsMade, hlsLive: log.hlsLive, open: !!k.state(), paused: v.paused})')


def close_case(page, net, master, label, resume=True, observed=True, hold=True):
    """Pflichtfall 1–3: Kinder als MPD bekannt, Original pausiert, erster Masterabruf offen, dann Schließen."""
    net.reset()
    rel = master[len(B) - 1:]
    net.serve[rel.split('#')[0]] = (MASTER_TEXT, HLS_CT)
    setup(page, master)
    page.evaluate('r => { k.CONFIG.resumeAfterClose = r; }', resume)
    if observed:
        page.evaluate('observe', master)
    mark_kids(page, net)
    if hold:
        net.hold = master.split('#')[0]
    page.evaluate('k.openBrowserPlayer(v)')
    page.wait_for_timeout(1500)
    since = len(net.requests)
    page.evaluate('() => { log.plays = 0; log.seeks = 0; k.closePlayer(); }')
    page.wait_for_timeout(3000)
    s = snap(page)
    obs = dict(s, master=net.count(master.split('#')[0], since), mpdKids=net.count(KID_A, since) + net.count(KID_B, since))
    check(label, s['plays'] == 0 and s['seeks'] == 0 and obs['master'] == 0 and obs['mpdKids'] == 0 and s['paused'], obs)
    net.release()
    page.wait_for_timeout(800)
    s2 = snap(page)
    check('… späte Antwort reaktiviert nichts: ' + label.split(':')[0],
          s2['plays'] == 0 and not s2['open'] and s2['hlsLive'] == 0 and net.count(KID_A, since) + net.count(KID_B, since) == 0, s2)


def open_case(page, net, master, label, observed):
    """Pflichtfall 4: beim Öffnen keine ungeschützten Requests an bekannte MPD-Kinder."""
    net.reset()
    net.serve[master[len(B) - 1:]] = (MASTER_TEXT, HLS_CT)
    setup(page, master)
    if observed:
        page.evaluate('observe', master)
    mark_kids(page, net)
    since = len(net.requests)
    page.evaluate('() => { log.plays = 0; k.openBrowserPlayer(v); }')
    page.wait_for_timeout(3500)
    s = snap(page)
    native = net.count(master, since, ('media',))
    kids = net.count(KID_A, since) + net.count(KID_B, since)
    check(label, kids == 0 and native == 0 and s['plays'] == 0, dict(s, nativeMaster=native, mpdKids=kids))
    page.evaluate('() => k.state() && k.closePlayer()')
    page.wait_for_timeout(1500)
    s = snap(page)
    kids2 = net.count(KID_A, since) + net.count(KID_B, since)
    check('… und nach dem Schließen: ' + label.split(':')[0], kids2 == 0 and s['plays'] == 0, dict(s, mpdKids=kids2))


def run(page, net):
    # ---------- Pflichtfälle 1–3 ----------
    close_case(page, net, B + 'gen/stream', 'Endungsloser Master (Rolle beobachtet), Schließen vor Antwort: 0 Play, 0 Master, 0 MPD-Kinder')
    close_case(page, net, B + 'gen/plain', 'Endungsloser Master (ohne Vorwissen), Schließen vor Antwort: 0 Play, 0 Master, 0 MPD-Kinder', observed=False)
    close_case(page, net, B + 'gen/stream.m3u8', 'Gleicher Master als .m3u8: 0 Play, 0 Master, 0 MPD-Kinder')
    close_case(page, net, B + 'gen/stream', 'Endungsloser Master, Wiederaufnahme aus: 0 Play, 0 Master, 0 MPD-Kinder', resume=False)

    # ---------- Pflichtfall 4: Öffnen ----------
    open_case(page, net, B + 'gen/open', 'Öffnen endungslos (Rolle beobachtet): keine ungeschützten Kind-Requests', True)
    open_case(page, net, B + 'gen/open-unknown', 'Öffnen endungslos (ohne Vorwissen): keine ungeschützten Kind-Requests', False)
    open_case(page, net, B + 'gen/list.m3u', 'Öffnen .m3u: keine ungeschützten Kind-Requests', False)
    open_case(page, net, B + 'gen/fake.mp4', 'Öffnen irreführend .mp4 mit HLS-Inhalt: keine ungeschützten Kind-Requests', False)

    # ---------- Pflichtfall 5: echte MP4, mit Endung und endungslos ----------
    for path in ('clip.mp4', 'gen/clipfile'):
        net.reset()
        if path.startswith('gen/'):
            net.serve['/' + path] = (CLIP, 'video/mp4')
        setup(page, B + path, ' preload="auto"')
        page.evaluate('k.openBrowserPlayer(v)')
        ok = wait(page, 'decoded()')
        page.evaluate('() => { log.plays = 0; k.state() && k.closePlayer(); }')
        page.wait_for_timeout(800)
        s = snap(page)
        check('Positiv: echte MP4 (%s) dekodiert und wird zurückgegeben' % path, ok and s['plays'] == 1 and s['hlsMade'] == 0, dict(s, decoded=ok))

    # ---------- Pflichtfall 6: erlaubter endungsloser HLS-Master, Qualitätswechsel, Rückgabe ----------
    for observed in (True, False):
        net.reset()
        net.serve['/gen/ok'] = (MASTER_TEXT, HLS_CT)
        setup(page, B + 'gen/ok')
        if observed:
            page.evaluate('observe', B + 'gen/ok')
        page.evaluate('k.openBrowserPlayer(v)')
        ok = wait(page, 'decoded() && k.state().hls && k.state().hls.levels.length === 2')
        if ok:
            lv = page.evaluate('k.state().hls.currentLevel')
            page.evaluate('l => { k.state().hls.currentLevel = l === 1 ? 0 : 1; }', lv)
            ok = wait(page, 'l => decoded() && k.state().hls.currentLevel === (l === 1 ? 0 : 1)', lv)
        if ok:
            page.evaluate('() => { const h = k.state().hls; h.currentLevel = -1; h.nextAutoLevel = 1; h.nextLoadLevel = 1; }')
            ok = wait(page, 'decoded() && k.state().hls.autoLevelEnabled && k.state().hls.currentLevel === 1')
        page.evaluate('() => { log.plays = 0; k.state() && k.closePlayer(); }')
        page.wait_for_timeout(1500)
        s = snap(page)
        check('Positiv: erlaubter endungsloser Master (%s) über hls.js dekodiert, manueller und automatischer Wechsel, Rückgabe'
              % ('Rolle beobachtet' if observed else 'ohne Vorwissen'), ok and s['plays'] == 1, dict(s, hlsPath=ok))

    # ---------- Pflichtfall 7: gleicher Pfad, andere Query ----------
    net.reset()
    net.serve['/gen/q?x=1'] = (MASTER_TEXT, HLS_CT)
    net.serve['/gen/q?x=2'] = (CLIP, 'video/mp4')
    setup(page, B + 'gen/q?x=2', ' preload="auto"')
    page.evaluate('observe', B + 'gen/q?x=1')
    page.evaluate('k.openBrowserPlayer(v)')
    ok = wait(page, 'decoded()')
    page.evaluate('() => { log.plays = 0; k.state() && k.closePlayer(); }')
    page.wait_for_timeout(800)
    s = snap(page)
    check('Gleicher Pfad, andere Query: HLS-Beleg der einen Query macht die MP4 der anderen nicht zu HLS',
          ok and s['plays'] == 1 and s['hlsMade'] == 0, dict(s, decoded=ok))

    # ---------- Pflichtfall 8: Redirect, behauptete Rolle, Epoche, alter Callback ----------
    net.reset()
    net.serve['/gen/redir-target'] = (MASTER_TEXT, HLS_CT)
    setup(page, B + 'redir?to=/gen/redir-target')
    mark_kids(page, net)
    since = len(net.requests)
    page.evaluate('k.openBrowserPlayer(v)')
    page.wait_for_timeout(3000)
    page.evaluate('() => { log.plays = 0; k.state() && k.closePlayer(); }')
    page.wait_for_timeout(1500)
    s = snap(page)
    kids = net.count(KID_A, since) + net.count(KID_B, since)
    check('Redirect auf endungslosen Master: keine MPD-Kind-Requests, kein Originalstart', kids == 0 and s['plays'] == 0, dict(s, mpdKids=kids))

    net.reset()
    net.serve['/gen/claimed'] = (CLIP, 'video/mp4')
    setup(page, B + 'gen/claimed')
    page.evaluate("u => k.notePlaylist(u, u, '#EXTM3U\\n#EXT-X-STREAM-INF:BANDWIDTH=1\\n/x.m3u8\\n')", B + 'gen/claimed')
    since = len(net.requests)
    page.evaluate('k.openBrowserPlayer(v)')
    page.wait_for_timeout(3000)
    native = net.count(B + 'gen/claimed', since, ('media',))
    page.evaluate('() => { log.plays = 0; k.state() && k.closePlayer(); }')
    page.wait_for_timeout(1000)
    s = snap(page)
    check('Nur gemeldete HLS-Rolle wirkt ausschließlich einschränkend: kein nativer Start der Adresse', native == 0 and s['plays'] == 0, dict(s, nativeLoads=native))

    net.reset()
    net.serve['/gen/epoch'] = (MASTER_TEXT, HLS_CT)
    setup(page, B + 'gen/epoch')
    page.evaluate('observe', B + 'gen/epoch')
    mark_kids(page, net)
    net.hold = B + 'gen/epoch'
    page.evaluate('k.openBrowserPlayer(v)')
    page.wait_for_timeout(1000)
    page.evaluate("() => { log.plays = 0; v.src = '/clip.mp4'; v.load(); }")
    wait(page, 'v.readyState >= 1')
    page.evaluate('k.closePlayer()')
    page.wait_for_timeout(600)
    s = snap(page)
    check('Neue Medien-Epoche (MP4) während ausstehender HLS-Analyse: zulässiger Originalstart', s['plays'] == 1, s)
    net.release()

    # Alter Callback: Typprobe bzw. Masterantwort trifft erst nach dem Schließen ein
    net.reset()
    net.serve['/gen/late'] = (MASTER_TEXT, HLS_CT)
    setup(page, B + 'gen/late')
    mark_kids(page, net)
    since = len(net.requests)
    page.evaluate('() => { k.openBrowserPlayer(v); k.closePlayer(); }')
    page.wait_for_timeout(3000)
    s = snap(page)
    kids = net.count(KID_A, since) + net.count(KID_B, since)
    check('Sofort geschlossen: späte Rückmeldungen starten weder Player noch Original', s['plays'] == 0 and not s['open'] and s['hlsLive'] == 0 and kids == 0,
          dict(s, mpdKids=kids))

    # ---------- Pflichtfall 10: gemischte unabhängige Kandidaten ----------
    net.reset()
    net.serve['/gen/mixed'] = (MASTER_TEXT, HLS_CT)
    setup(page, B + 'gen/mixed')
    page.evaluate('observe', B + 'gen/mixed')
    mark_kids(page, net)
    since = len(net.requests)
    # Kandidaten derselben Playerinstanz: gesperrter Master, bekannte MPD, unabhängige MP4
    page.evaluate('([a, m]) => { k.openBrowserPlayer(v); k.state().sources.push(a, m); }', [KID_A, B + 'clip.mp4'])
    ok = wait(page, "decoded() && k.state().vid.currentSrc.endsWith('/clip.mp4')")
    page.evaluate('() => { log.plays = 0; k.state() && k.closePlayer(); }')
    page.wait_for_timeout(1500)
    s = snap(page)
    kids = net.count(KID_A, since) + net.count(KID_B, since)
    check('Gemischte Kandidaten: gesperrter HLS-Master übersprungen, unabhängige MP4 dekodiert, kein nativer HLS-Start',
          ok and kids == 0 and s['plays'] == 0, dict(s, mpdKids=kids, mp4Decoded=ok))


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
