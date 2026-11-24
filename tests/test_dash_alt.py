# S4b-6 Teil B: Bindung bei mehreren BaseURL (CDN-Alternativen) mit den echten Quelltexten (src/038 Index/Entscheidung,
# 039 Vorprüfung der Projektion, 040 seeUrl/notePlaylist/dashHit/dashOfferOf, 060 Epoche/dashBindingFor) im Chromium.
# Regeln: ein Stück zählt nur, wenn seine Adresse EXAKT zu einer im MPD erklärten Alternative passt; weiterhin ≥ 3 Stücke in
# Folge in der aktuellen Medien-Epoche (bekannter Anfragebeginn); je Darstellung genau eine Alternative (kein stiller CDN-Wechsel),
# über alle Darstellungen widerspruchsfrei; die Auswahl geht an den Helfer (dashplan v2), der sie selbst prüft.
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


G = os.path.join(ROOT, 'tests', 'web', 'dash', 'gate')
def fx(n): return open(os.path.join(G, n + '.mpd'), encoding='utf-8').read()
CA, CB = 'https://cdn-a.example/v/', 'https://cdn-b.example/v/'
v0 = lambda base, i: base + 'v/v0/%05d.m4s' % i
a0 = lambda base, i: base + 'a/a0/%05d.m4s' % i
STATE2 = """(mpd) => { const K = window.__k, v = document.getElementById('v');
  const b = K.dashBindingFor(v), e = b.list.find((x) => x.p.u === mpd), r = e ? b.res[e.key] : null;
  const o = K.dashOfferOf(mpd, K.dashFromOf(v));
  return { state: r && r.state, reason: r && r.reason, hits: r && r.hits, alt: r && r.alt, offer: o ? { alt: o.alt || '', altError: o.altError || '', multi: !!o.multi,
    gate: o.gate ? { ok: o.gate.ok, code: o.gate.code } : null, played: o.played } : null }; }"""
with sync_playwright() as p:
    br = p.chromium.launch(executable_path=os.environ.get('KADRI_CHROMIUM') or None)
    pg = br.new_page()
    mpd = B + 'v/manifest.mpd'
    def case(name, text, urls, want, more=None):
        errs = []; pg.on('pageerror', lambda e: errs.append(str(e)))
        pg.goto(B)
        pg.evaluate('() => Object.defineProperty(document.getElementById("v"), "duration", { value: 20 })')
        pg.add_script_tag(content=SRC)
        pg.evaluate("() => document.getElementById('v').dispatchEvent(new Event('loadstart'))"); time.sleep(0.2)
        pg.evaluate('([u, t]) => window.__k.notePlaylist(u, u, t)', [mpd, text])
        pg.evaluate("""(us) => { const K = window.__k, now = Date.now(); us.forEach((u, i) => K.seeUrl(u, now + 10 + i * 10, 'fetch', now + i * 10)); }""", urls)
        st = pg.evaluate(STATE2, mpd)
        ok = all(st.get(k) == v if not isinstance(v, dict) else all((st.get(k) or {}).get(kk) == vv for kk, vv in v.items()) for k, v in want.items())
        check(name, ok and not errs, [st, errs])
        return st
    # 1) d5-Form (MPD-Ebene zwei CDN): Stücke vom zweiten → gebunden, Auswahl m:1, Vorprüfung der Projektion ok
    case('MPD-Ebene: 3 Stücke + Ton von der ZWEITEN Alternative → bound, Auswahl m:1, Angebot mit Auswahl, Vorprüfung ok',
         fx('b01-mpd-two-cdn'), [v0(CB, i) for i in (1, 2, 3)] + [a0(CB, i) for i in (1, 2, 3)],
         {'state': 'bound', 'alt': 'm:1', 'offer': {'alt': 'm:1', 'multi': True, 'gate': {'ok': True, 'code': 'ok'}}})
    case('… gleiche Pfade auf der ERSTEN Alternative → bound, Auswahl m:0 (Hosts werden nicht gleichgesetzt)',
         fx('b01-mpd-two-cdn'), [v0(CA, i) for i in (1, 2, 3)], {'state': 'bound', 'alt': 'm:0'})
    case('… gleicher Pfad auf einem Host, der NICHT im MPD steht → keine Treffer, keine Bindung (keine-treffer)',
         fx('b01-mpd-two-cdn'), [v0('https://cdn-c.example/v/', i) for i in (1, 2, 3)], {'state': 'ambiguous', 'reason': 'keine-treffer', 'hits': 0})
    case('… CDN-Wechsel innerhalb einer Folge (Stück 1–2 von A, 3–4 von B) → nicht gebunden (alt-mixed), kein Angebot',
         fx('b01-mpd-two-cdn'), [v0(CA, 1), v0(CA, 2), v0(CB, 3), v0(CB, 4)], {'state': 'ambiguous', 'reason': 'alt-mixed', 'offer': {'alt': '', 'altError': 'alt-mixed'}})
    case('… Video von A, Ton von B (widersprüchliche Wahl der MPD-Ebene) → nicht gebunden (alt-competing)',
         fx('b01-mpd-two-cdn'), [v0(CA, i) for i in (1, 2, 3)] + [a0(CB, i) for i in (1, 2, 3)], {'state': 'ambiguous', 'reason': 'alt-competing'})
    case('… nur 2 Stücke in Folge von einer Alternative → wie bisher nicht gebunden (zu-wenig-folge)',
         fx('b01-mpd-two-cdn'), [v0(CB, 1), v0(CB, 2)], {'state': 'ambiguous', 'reason': 'zu-wenig-folge'})
    # 2) Set-Ebene: Video beobachtet, Ton nicht → gebunden, aber kein Angebot (Ton-Alternative unbestimmt)
    SA, SB = CA + 'video/', CB + 'video/'
    vs = lambda base, i: base + 'v/v0/%05d.m4s' % i
    st = case('Set-Ebene: nur Video von der zweiten Alternative → bound (s0:1), Vorprüfung: Ton unbestimmt → kein Angebot',
              fx('b03-set-two'), [vs(SB, i) for i in (1, 2, 3)], {'state': 'bound', 'alt': 's0:1', 'offer': {'alt': 's0:1', 'gate': {'ok': False, 'code': 'dash-baseurl-undetermined'}}})
    case('… mit Ton von der ersten Ton-Alternative → Auswahl s0:1;s1:0, Vorprüfung ok',
         fx('b03-set-two'), [vs(SB, i) for i in (1, 2, 3)] + [CA + 'audio/a/a0/%05d.m4s' % i for i in (1, 2, 3)],
         {'state': 'bound', 'alt': 's0:1;s1:0', 'offer': {'alt': 's0:1;s1:0', 'gate': {'ok': True, 'code': 'ok'}}})
    # 3) Grenzen: 9 BaseURL auf einer Ebene → nicht prüfbar (nie unvollständig indiziert und angeboten)
    case('9 BaseURL auf einer Ebene (über der Grenze 8) → Index nicht prüfbar, keine Bindung',
         fx('b08-too-many-per-element'), ['https://cdn-1.example/v/v/v0/%05d.m4s' % i for i in (1, 2, 3)], {'state': 'ambiguous', 'reason': 'nicht-pruefbar'})
    # 4) bestehende Einzel-BaseURL unverändert: keine Auswahl, kein multi
    case('Einzel-BaseURL (g09) unverändert: bound ohne Auswahl, Angebot ohne alt, Vorprüfung wie bisher',
         fx('g09-baseurl-chain'), ['https://cdn.example/root/p/v/v0/%05d.m4s' % i for i in (1, 2, 3)],
         {'state': 'bound', 'alt': '', 'offer': {'alt': '', 'multi': False, 'gate': {'ok': True, 'code': 'ok'}}})
    # 5) Grenzen und Rechenaufwand bei großen/bösartigen MPDs (Abdruck, Index, Abgleich, Vorprüfung einer Auswahl)
    NS = 'urn:mpeg:dash:schema:mpd:2011'
    T = '<SegmentTemplate timescale="12800" initialization="$RepresentationID$/i.mp4" media="$RepresentationID$/$Number$.m4s"><SegmentTimeline><S t="0" d="51200" r="4"/></SegmentTimeline></SegmentTemplate>'
    big = '<?xml version="1.0"?><MPD xmlns="%s" type="static" mediaPresentationDuration="PT20S"><Period><AdaptationSet contentType="video" mimeType="video/mp4" codecs="avc1.4d401e">%s%s</AdaptationSet><AdaptationSet contentType="audio" mimeType="audio/mp4" codecs="mp4a.40.2">%s<Representation id="a" bandwidth="48000"/></AdaptationSet></Period></MPD>' % (
        NS, T, ''.join('<Representation id="v%d" bandwidth="%d" width="320" height="180">%s</Representation>' % (i, 90000 + i, ''.join('<BaseURL>https://cdn-%d.example/x/</BaseURL>' % j for j in range(8))) for i in range(4095)), T)
    over = big.replace('<BaseURL>https://cdn-0.example/x/</BaseURL>', '<BaseURL>https://cdn-0.example/x/</BaseURL><BaseURL>https://cdn-9.example/x/</BaseURL>', 1)
    PJS = """([t, u]) => { const R = {}; let a = performance.now(); const pp = dashParse(t); const f = dashFingerprint(t, pp, u); R.fp = performance.now() - a; R.err = f.error || ''; R.multi = !!f.multi;
      a = performance.now(); const ix = dashSegmentIndex(pp, u); R.idx = performance.now() - a; R.records = ix.reps.length; R.overflow = ix.overflow;
      a = performance.now(); for (let i = 0; i < 200; i++) dashMatchSegment(ix, 'https://cdn-1.example/x/v' + i + '/1.m4s'); R.match = performance.now() - a;
      a = performance.now(); R.gate = dashGateFor(t, pp, u, 'r0:1').code; R.alt = performance.now() - a; return R; }"""
    pg.goto(B); pg.add_script_tag(content=SRC.replace('window.__k = {', 'window.__k = { dashParse, dashFingerprint, dashSegmentIndex, dashMatchSegment, dashGateFor, ', 1))
    pg.evaluate("() => { for (const k of ['dashParse', 'dashFingerprint', 'dashSegmentIndex', 'dashMatchSegment', 'dashGateFor']) window[k] = window.__k[k]; }")
    r = pg.evaluate(PJS, [big, 'https://media.example/s4b6/manifest.mpd'])
    check('Groß: 4096 Darstellungen × 8 BaseURL (1,7 MB): Abdruck < 2 s, Index begrenzt (256 Einträge, dann nicht prüfbar), 200 Abgleiche < 0,2 s, Vorprüfung einer Auswahl < 2 s',
          not r['err'] and r['multi'] and r['fp'] < 2000 and r['idx'] < 1000 and r['records'] == 256 and r['overflow'] and r['match'] < 200 and r['alt'] < 2000, r)
    r = pg.evaluate(PJS, [over, 'https://media.example/s4b6/manifest.mpd'])
    check('… mit 9 BaseURL an einer Darstellung: kontrolliert abgelehnt (baseurl-limits), nichts indiziert und angeboten', r['err'] == 'baseurl-limits', r)
    br.close()
srv.shutdown()
done()
