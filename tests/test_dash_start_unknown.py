# S4b-6 Teil A (P1): unbekannter Anfragebeginn ist KEIN Beweis der aktuellen Medien-Epoche.
# Echte Quelltexte (src/038, 039, 046, 040 seeUrl…dashOfferOf + Beobachter, 060 Epoche + dashBindingFor) im Chromium.
# Abfolge je Fall: neues Medium (loadstart) → drei zusammenhängende Stücke kommen NACH dem Epochenbeginn an → MPD wird erst
# danach gelesen (Rückfüllen aus recentRes) → Bindung/Angebot/Diagnose. Unterschieden wird der Anfragebeginn:
#   bekannt und vor der Epoche · unbekannt (Resource Timing ohne startTime: 0 bzw. undefined) · beim Absenden erfasst
#   (fetch-/XHR-Mitleser, echter Zeitpunkt) · bekannt und nach der Epoche.
import os, re, threading, time, http.server, socketserver
from common import *   # noqa: E402

ROOT = os.path.join(HERE, '..')
def rd(*p): return open(os.path.join(ROOT, *p), encoding='utf-8').read()
def cut(s, a, b, inclusive_b=False):
    i = s.index(a); j = s.index(b, i + len(a))
    return s[i:j + (len(b) if inclusive_b else 0)]
S040, S060 = rd('src', '040-quellen-netzwerk.js'), rd('src', '060-quellen-zuordnung.js')
PARTS = [
    rd('src', '038-dash-manifest.js'), rd('src', '039-dash-fingerprint.js'), rd('src', '046-dash-ebenen.js'),
    cut(S040, '  function seeUrl(', '  // Das Video, von dem'),
    cut(S040, '  const urlKey = ', '  function dashSummaryOf('),
    cut(S040, '  try {\n    new PerformanceObserver(', "    }).observe({ type: 'resource', buffered: true });\n  } catch (e) {}", True),
]
# Epochen-Abschnitt aus src/060 (bis einschließlich der Zeile mit dashFromOf) und dashBindingFor
a = S060.index('  // ---------- S4b-4: Medien-Epoche'); b = S060.index('\n', S060.index('const dashFromOf = (v) =>'))
PARTS.append(S060[a:b] + '\n' + cut(S060, '  function dashBindingFor(', '  function timingMatch('))
STUBS = '''
  const IS_KADRI = false, META = false, navAt = 0, SPLIT_CDN_RE = /^\\b$/, SEGMENT_RE = /\\.m4s(\\?|#|$)/i, PLAYLIST_RE = /\\.(m3u8|mpd)(\\?|#|$)/i;
  let vp = null, bodiesRead = 0;
  const sources = [], hostOf = (u) => { try { return new URL(u).hostname; } catch (e) { return ''; } }, isMedia = () => false,
    addSource = () => {}, anonExt = () => 'stueck', allVideos = () => [], tr = (s) => s, rankPlaylists = (x) => x, scanText = () => {};
'''
EXPORT = '\n  window.__k = { seeUrl, notePlaylist, obsNote, dashBindingFor, dashOfferOf, dashFromOf, dashEpochOf, recentRes, obsRes, dashInfo, resAt: typeof resAt === "function" ? resAt : null };\n'
SRC = '(() => {\n' + STUBS + '\n'.join(PARTS) + EXPORT + '})();'
SRC = SRC.replace('window.__k = {', 'window.__k = { dashLevels, ', 1)

MPD = rd('tests', 'web', 'dash', 'vod-timeline-avc-aac.mpd')   # Darstellung 0 = 360p, 1 = 720p; Stücke video/<id>/<Zeit>.m4s
seg = lambda rep, i: 'video/%d/%d.m4s' % (rep, i * 76800)

class H(http.server.BaseHTTPRequestHandler):
    def log_message(self, *a): pass
    def do_GET(self):
        if self.path.startswith('/v/video/1/'): time.sleep(2.6)   # alte Stücke: Antwort erst nach dem Epochenwechsel
        body = MPD.encode() if self.path.endswith('.mpd') else (b'<!doctype html><video id=v></video>' if self.path == '/' else b'x' * 64)
        self.send_response(200); self.send_header('Content-Type', 'text/html' if self.path == '/' else 'application/octet-stream')
        self.send_header('Content-Length', str(len(body))); self.send_header('Cache-Control', 'no-store'); self.end_headers()
        try: self.wfile.write(body)
        except Exception: pass
class TS(socketserver.ThreadingMixIn, http.server.HTTPServer): daemon_threads = True
srv = TS(('127.0.0.1', 0), H); PORT = srv.server_address[1]
threading.Thread(target=srv.serve_forever, daemon=True).start()
B = 'http://127.0.0.1:%d/' % PORT

STATE = '''(mpd) => { const K = window.__k, v = document.getElementById('v');
  const b = K.dashBindingFor(v), e = b.list.find((x) => x.p.u === mpd), r = e ? b.res[e.key] : null, ep = K.dashEpochOf(v);
  const o = K.dashOfferOf(mpd, K.dashFromOf(v));
  return { state: r && r.state, reason: r && r.reason, hits: r && r.hits, run: r && r.run, played: o && o.played, by: ep.by, from: ep.from,
    hs: e ? e.p.dashHits.map((h) => [h.rep, h.idx, Math.round(h.t), Math.round(h.s)]) : null }; }'''


CASES = [
    # (Name, Ausdruck für den Anfragebeginn, Ankunft, erwarteter Zustand, Grund, Treffer, unbekannt)
    ('Anfragebeginn bekannt, vor der Epoche', 'now - 2000 + i * 10', 'now + 200 + i * 10', 'ambiguous', 'keine-treffer', 0, 0),
    ('Anfragebeginn UNBEKANNT (0)', '0', 'now + 200 + i * 10', 'ambiguous', 'start-unknown', 0, 3),
    ('Anfragebeginn UNBEKANNT (undefined)', 'undefined', 'now + 200 + i * 10', 'ambiguous', 'start-unknown', 0, 3),
    ('Anfragebeginn UNBEKANNT (null)', 'null', 'now + 200 + i * 10', 'ambiguous', 'start-unknown', 0, 3),
    ('Anfragebeginn UNBEKANNT, Ankunft unbekannt (Beobachter ohne Zeiten)', '0', '0', 'ambiguous', 'start-unknown', 0, 3),
    ('beim Absenden erfasst (Mitleser), nach der Epoche', 'Date.now()', '0', 'bound', 'stueckfolge', 3, 0),
    ('Anfragebeginn bekannt, nach der Epoche', 'now + 100 + i * 10', 'now + 200 + i * 10', 'bound', 'stueckfolge', 3, 0),
]
with sync_playwright() as p:
    br = p.chromium.launch(executable_path=os.environ.get('KADRI_CHROMIUM') or None)
    pg = br.new_page()
    mpd = B + 'v/manifest.mpd'
    for name, started, arrived, st_want, why, hits, unk in CASES:
        errs = []; pg.on('pageerror', lambda e: errs.append(str(e)))
        pg.goto(B)
        pg.evaluate('() => Object.defineProperty(document.getElementById("v"), "duration", { value: 5525.12 })')
        pg.add_script_tag(content=SRC)
        sent = 'Mitleser' in name
        if sent:
            # Mitleser: seeUrl beim Absenden (nach dem Epochenbeginn), Ankunft unbekannt, Anfragebeginn = jetzt – genau wie src/040
            pg.evaluate("() => document.getElementById('v').dispatchEvent(new Event('loadstart'))"); time.sleep(0.2)
            pg.evaluate("""([b, segs]) => { const K = window.__k; segs.forEach((s) => K.seeUrl(b + 'v/' + s, 0, '', Date.now())); }""", [B, [seg(1, i) for i in range(3)]])
        else:
            pg.evaluate("""([b, segs]) => { const K = window.__k, now = Date.now();
              document.getElementById('v').dispatchEvent(new Event('loadstart'));
              segs.forEach((s, i) => K.seeUrl(b + 'v/' + s, %s, 'fetch', %s)); }""" % (arrived, started), [B, [seg(1, i) for i in range(3)]])
        time.sleep(0.5)
        pg.evaluate('([u, t]) => window.__k.notePlaylist(u, u, t)', [mpd, MPD])
        st = pg.evaluate(STATE, mpd)
        res = pg.evaluate('(u) => { const K = window.__k, v = document.getElementById("v"), b = K.dashBindingFor(v); const e = b.list.find((x) => x.p.u === u); return e ? b.res[e.key] : null; }', mpd)
        ok = st['state'] == st_want and st['reason'] == why and st['hits'] == hits and (res.get('unknownStart') or 0) == unk
        if st_want == 'bound': ok = ok and st['played'] == [1]
        else: ok = ok and st['played'] == []
        check('%s → %s (%s), Treffer %d, Anfragebeginn unbekannt %d, gespielt %s' % (name, st_want, why, hits, unk, '[1]' if st_want == 'bound' else '[]'), ok, [st, res])
        if why == 'start-unknown' and '(0)' in name:
            lv = pg.evaluate('(g) => window.__k.dashLevels({ read: true, bound: false, bindReason: "start-unknown", cls: {}, gate: null, fmt: { video: [], audio: [], container: [] }, caps: { known: false } })', None)
            check('… Ebenen E2/start-unknown mit verständlicher Meldung', lv['code'] == 'E2/start-unknown' and 'Ladebeginn' in lv['sub'], [lv['code'], lv['main'], lv['sub']])
            # danach kommen drei Stücke mit bekanntem Beginn nach der Epoche: Bindung wie bisher (unbekannte zählen weiter nicht)
            pg.evaluate("""([b, segs]) => { const K = window.__k, now = Date.now(); segs.forEach((s, i) => K.seeUrl(b + 'v/' + s, now + i * 10, 'fetch', now - 100 + i * 10)); }""", [B, [seg(0, i) for i in range(3, 6)]])
            st2 = pg.evaluate(STATE, mpd)
            check('… danach 3 Stücke mit bekanntem Beginn nach der Epoche: bound wie bisher, gespielt nur [0]', st2['state'] == 'bound' and st2['hits'] == 3 and st2['played'] == [0], st2)
        check('%s: keine Fehler der Seite' % name, not errs, errs)
    br.close()
srv.shutdown()
S280 = rd('src', '280-diagnose.js')
check('Diagnose zählt Abrufe mit unbekanntem Anfragebeginn mit festem Code start-unknown', 'start-unknown' in S280 and 'Anfragebeginn unbekannt' in S280)
check('Bindung: kein Rückfall des Anfragebeginns auf die Ankunft (dashBindDecision, dashHit, dashSee, dashOfferOf)',
      '(h.s != null ? h.s : h.t)' not in rd('src', '038-dash-manifest.js') and 's > 0 ? s : t' not in S040 and 'started <= t ? started : t' not in S040)
done()
