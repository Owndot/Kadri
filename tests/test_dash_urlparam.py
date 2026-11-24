# S4b-8: Annex I (UrlQueryInfo) – Index, Bindung, Angebot und Ebenen mit den echten Quelltexten (src/038, 039, 040, 046, 060) im
# Chromium. Regeln: die Query der ENDGÜLTIGEN MPD-Adresse gehört nur bei einem unterstützten Descriptor und genau unverändert zur
# Stückadresse (keine Umkodierung, Sortierung, Gleichsetzung, Entfernung doppelter Parameter); ohne Descriptor nie; nicht
# unterstützte Form → keine Bindung (urlparam); der Token verlässt die Abdruck-Auswertung nicht.
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
EXPORT = '\n  window.__k = { seeUrl, notePlaylist, obsNote, dashBindingFor, dashOfferOf, dashFromOf, dashEpochOf, recentRes, obsRes, dashInfo, dashParse, dashFingerprint, dashLevels, dashDiagClassify, dashUrlKey };\n'
SRC = '(() => {\n' + STUBS + '\n'.join(PARTS) + EXPORT + '})();'


class H(http.server.BaseHTTPRequestHandler):
    def log_message(self, *a): pass
    def do_GET(self):
        body = b'<!doctype html><video id=v></video>' if self.path == '/' else b'x' * 64
        self.send_response(200); self.send_header('Content-Type', 'text/html' if self.path == '/' else 'application/octet-stream')
        self.send_header('Content-Length', str(len(body))); self.end_headers()
        try: self.wfile.write(body)
        except Exception: pass
class TS(socketserver.ThreadingMixIn, http.server.HTTPServer): daemon_threads = True
srv = TS(('127.0.0.1', 0), H); PORT = srv.server_address[1]
threading.Thread(target=srv.serve_forever, daemon=True).start()
B = 'http://127.0.0.1:%d/' % PORT
G = os.path.join(ROOT, 'tests', 'web', 'dash', 'gate')
def fx(n): return open(os.path.join(G, n + '.mpd'), encoding='utf-8').read()
P = B + 'v/'
seg = lambda i, q='', base=P, rep='v0': base + 'v/%s/%05d.m4s' % (rep, i) + q
aud = lambda i, q='', base=P: base + 'a/a0/%05d.m4s' % i + q
STATE = """(mpd) => { const K = window.__k, v = document.getElementById('v');
  const b = K.dashBindingFor(v), e = b.list.find((x) => x.p.u === mpd), r = e ? b.res[e.key] : null;
  const o = K.dashOfferOf(mpd, K.dashFromOf(v));
  return { state: r && r.state, reason: r && r.reason, hits: r && r.hits, alt: r && r.alt, idx: e && e.p.dashIdx ? { n: e.p.dashIdx.reps.length, up: e.p.dashIdx.urlparam } : null,
    offer: o ? { urlq: !!o.urlq, alt: o.alt || '', error: o.error || '', gate: o.gate ? { ok: o.gate.ok, code: o.gate.code } : null } : null }; }"""
with sync_playwright() as p:
    br = p.chromium.launch(executable_path=os.environ.get('KADRI_CHROMIUM') or None)
    pg = br.new_page()
    def case(name, text, mpd, urls, want, final=None, cls=None):
        errs = []; pg.on('pageerror', lambda e: errs.append(str(e)))
        pg.goto(B)
        pg.evaluate('() => Object.defineProperty(document.getElementById("v"), "duration", { value: 20 })')
        pg.add_script_tag(content=SRC)
        pg.evaluate("() => document.getElementById('v').dispatchEvent(new Event('loadstart'))"); time.sleep(0.2)
        pg.evaluate('([u, f, t]) => window.__k.notePlaylist(u, f, t)', [mpd, final or mpd, text])
        pg.evaluate("""(us) => { const K = window.__k, now = Date.now(); us.forEach((u, i) => K.seeUrl(u, now + 10 + i * 10, 'fetch', now + i * 10)); }""", urls)
        st = pg.evaluate(STATE, mpd)
        if cls is not None:
            st['cls'] = pg.evaluate("""([m, u]) => { const K = window.__k, p = K.dashInfo.get(K.dashUrlKey(m)); return K.dashDiagClassify(p.dashIdx, K.dashUrlKey(u)); }""", [final or mpd, urls[0]])
            want = dict(want, cls=cls)
        ok = all(st.get(k) == v if not isinstance(v, dict) else all((st.get(k) or {}).get(kk) == vv for kk, vv in v.items()) for k, v in want.items())
        check(name, ok and not errs, [st, errs])
        return st
    T = '?tok=abc123'
    M1 = P + 'manifest.mpd' + T
    # 1) explizit übernommen (MPD-Ebene, Essential)
    case('u01: Stücke mit ?tok=abc123 → bound, Angebot mit urlq, Vorprüfung ok', fx('u01-mpd-essential'), M1, [seg(i, T) for i in (1, 2, 3)],
         {'state': 'bound', 'offer': {'urlq': True, 'gate': {'ok': True, 'code': 'ok'}}})
    case('u01: dieselben Stücke OHNE Token → keine Bindung (Abgleich: nur Query abweichend)', fx('u01-mpd-essential'), M1, [seg(i) for i in (1, 2, 3)],
         {'state': 'ambiguous', 'hits': 0}, cls='query')
    case('u01: anderer Tokenwert → keine Bindung', fx('u01-mpd-essential'), M1, [seg(i, '?tok=zzz999') for i in (1, 2, 3)], {'state': 'ambiguous', 'hits': 0})
    case('u01: Token plus zusätzlicher Parameter → keine Bindung', fx('u01-mpd-essential'), M1, [seg(i, T + '&x=1') for i in (1, 2, 3)], {'state': 'ambiguous', 'hits': 0})
    case('u01: Wert mit „/“ – Stücke mit umkodiertem %2F (wie dash.js) → keine Gleichsetzung, keine Bindung', fx('u01-mpd-essential'), P + 'manifest.mpd?sig=a/b',
         [seg(i, '?sig=a%2Fb') for i in (1, 2, 3)], {'state': 'ambiguous', 'hits': 0})
    case('u01: … mit unverändertem „sig=a/b“ → bound', fx('u01-mpd-essential'), P + 'manifest.mpd?sig=a/b', [seg(i, '?sig=a/b') for i in (1, 2, 3)], {'state': 'bound'})
    # 2) Reihenfolge, Prozentkodierung, doppelte Parameter, vorhandene Query
    Q11 = '?b=2&a=1&c=%2F%3D~'
    case('u11: Reihenfolge und %-Kodierung unverändert → bound', fx('u11-order-percent'), P + 'manifest.mpd' + Q11, [seg(i, Q11) for i in (1, 2, 3)], {'state': 'bound'})
    case('u11: sortierte Parameter (a, b, c) → keine Bindung', fx('u11-order-percent'), P + 'manifest.mpd' + Q11, [seg(i, '?a=1&b=2&c=%2F%3D~') for i in (1, 2, 3)], {'state': 'ambiguous', 'hits': 0})
    case('u11: dekodiert (c=/=~) → keine Bindung', fx('u11-order-percent'), P + 'manifest.mpd' + Q11, [seg(i, '?b=2&a=1&c=/=~') for i in (1, 2, 3)], {'state': 'ambiguous', 'hits': 0})
    Q9 = '?tok=new&tok=new2'
    case('u09: doppelte Parameter erhalten (tok=old&tok=new&tok=new2) → bound', fx('u09-duplicate-param'), P + 'manifest.mpd' + Q9, [seg(i, '?tok=old&tok=new&tok=new2') for i in (1, 2, 3)], {'state': 'bound'})
    case('u09: einer der doppelten fehlt → keine Bindung', fx('u09-duplicate-param'), P + 'manifest.mpd' + Q9, [seg(i, '?tok=old&tok=new') for i in (1, 2, 3)], {'state': 'ambiguous', 'hits': 0})
    case('u08: vorhandene Query der Vorlage zuerst (?v=1&tok=…) → bound', fx('u08-template-query'), M1, [seg(i, '?v=1&tok=abc123') for i in (1, 2, 3)], {'state': 'bound'})
    case('u08: umgekehrte Reihenfolge (?tok=…&v=1) → keine Bindung', fx('u08-template-query'), M1, [seg(i, '?tok=abc123&v=1') for i in (1, 2, 3)], {'state': 'ambiguous', 'hits': 0})
    # 3) Gültigkeitsbereich: nur das Video-Set
    case('u06: Video mit Token, Ton ohne → bound mit 6 Treffern (Ton gehört nicht zum Descriptor)', fx('u06-set-video-only'), M1,
         [seg(i, T) for i in (1, 2, 3)] + [aud(i) for i in (1, 2, 3)], {'state': 'bound', 'hits': 6})
    case('u06: Ton MIT Token → zählt nicht (nur 3 Video-Treffer)', fx('u06-set-video-only'), M1, [seg(i, T) for i in (1, 2, 3)] + [aud(i, T) for i in (1, 2, 3)], {'state': 'bound', 'hits': 3})
    # 4) MPD-Weiterleitung: Query der ENDGÜLTIGEN Adresse
    REQ, FIN = P + 'start.mpd?tok=A1', P + 'manifest.mpd?tok=B2'
    case('MPD 302 (?tok=A1 → ?tok=B2): Stücke mit tok=B2 → bound', fx('u01-mpd-essential'), REQ, [seg(i, '?tok=B2') for i in (1, 2, 3)], {'state': 'bound', 'offer': {'urlq': True}}, final=FIN)
    case('… Stücke mit tok=A1 (Anfrageadresse) → keine Bindung', fx('u01-mpd-essential'), REQ, [seg(i, '?tok=A1') for i in (1, 2, 3)], {'state': 'ambiguous', 'hits': 0}, final=FIN)
    # 5) ohne Descriptor: nie übernommen (d4)
    case('u03 ohne Descriptor: Stücke mit Token der MPD-Adresse → keine Bindung (nur Query abweichend, wie d4)', fx('u03-no-descriptor'), M1, [seg(i, T) for i in (1, 2, 3)], {'state': 'ambiguous', 'hits': 0}, cls='query')
    case('u03 ohne Descriptor: Stücke ohne Token → bound, Angebot ohne urlq', fx('u03-no-descriptor'), M1, [seg(i) for i in (1, 2, 3)], {'state': 'bound', 'offer': {'urlq': False}})
    # 6) fehlend/unbekannt/widersprüchlich: nichts indiziert, Grund urlparam
    for f in ('u05-period-essential', 'u13-template-query-param', 'u17-ext-2016', 'u19-two-levels', 'u18-no-child'):
        case('%s: nicht unterstützte Form → nichts indiziert, keine Bindung (urlparam), Angebot mit festem Grund' % f, fx(f), M1, [seg(i, T) for i in (1, 2, 3)],
             {'state': 'ambiguous', 'reason': 'urlparam', 'idx': {'n': 0}})
    # 7) mehrere BaseURL + UrlQueryInfo
    CB = 'https://cdn-b.example/v/'
    case('u23: zweite BaseURL mit Token → bound, Auswahl m:1, Angebot urlq', fx('u23-multi-baseurl'), M1, [seg(i, T, CB) for i in (1, 2, 3)] + [aud(i, T, CB) for i in (1, 2, 3)],
         {'state': 'bound', 'alt': 'm:1', 'offer': {'urlq': True, 'alt': 'm:1', 'gate': {'ok': True, 'code': 'ok'}}})
    case('u23: zweite BaseURL OHNE Token → keine Bindung', fx('u23-multi-baseurl'), M1, [seg(i, '', CB) for i in (1, 2, 3)], {'state': 'ambiguous', 'hits': 0})
    # 8) Datenschutz: der Token verlässt die Abdruck-Auswertung nicht; Ebenen
    r = pg.evaluate("""([t, u]) => { const K = window.__k; const f = K.dashFingerprint(t, K.dashParse(t), u); return { keys: Object.keys(f), json: JSON.stringify({ gate: f.gate, urlq: f.urlq, multi: f.multi }) }; }""", [fx('u01-mpd-essential'), M1])
    check('Abdruck-Ergebnis mit Annex I: urlq nur als Ja/Nein je Darstellung – kein Token, keine Adresse', 'abc123' not in r['json'] and 'http' not in r['json'] and '"urlq":{"reps":[true,true,true]}' in r['json'], r)
    L = """(inp) => { const l = window.__k.dashLevels(Object.assign({ read: true, fmt: { video: [], audio: [], container: [] } }, inp)); return [l.code, l.main, l.sub]; }"""
    lv = pg.evaluate(L, {'bound': True, 'gate': {'ok': True}, 'urlqCode': 'helper-no-urlq', 'caps': {'known': True, 'reachable': True, 'supported': True, 'dash': True}})
    check('Ebenen: Annex I wirkt, Helfer ohne dashdl.urlq → E4/no-urlq mit Meldung', lv[0] == 'E4/no-urlq' and 'UrlQueryInfo' in lv[2], lv)
    lv = pg.evaluate(L, {'bound': False, 'bindReason': 'urlparam', 'fpError': True, 'fpCode': 'urlparam-template', 'caps': {'known': False}})
    check('Ebenen: nicht unterstützte Form → E2/urlparam „Manifest verlangt Adressparameter (UrlQueryInfo) …“', lv[0] == 'E2/urlparam' and lv[1] == 'DASH-Stream erkannt – nicht speicherbar' and 'UrlQueryInfo' in lv[2], lv)
    lv = pg.evaluate(L, {'bound': True, 'fpError': True, 'fpCode': 'urlparam-unsupported', 'caps': {'known': False}})
    check('Ebenen: … gebunden, Abdruck mit urlparam-Fehler → E3/urlparam', lv[0] == 'E3/urlparam', lv)
    # 9) Leistung: 4096 Darstellungen, Descriptor auf MPD-Ebene, Query 2000 Zeichen (Grenze 2048) – begrenzt, ohne Blockade
    NS = 'urn:mpeg:dash:schema:mpd:2011'
    UQ = '<EssentialProperty schemeIdUri="urn:mpeg:dash:urlparam:2014"><up:UrlQueryInfo xmlns:up="urn:mpeg:dash:schema:urlparam:2014" queryTemplate="$querypart$" useMPDUrlQuery="true"/></EssentialProperty>'
    TT = '<SegmentTemplate timescale="12800" initialization="$RepresentationID$/i.mp4" media="$RepresentationID$/$Number$.m4s"><SegmentTimeline><S t="0" d="51200" r="4"/></SegmentTimeline></SegmentTemplate>'
    big = '<?xml version="1.0"?><MPD xmlns="%s" type="static" mediaPresentationDuration="PT20S">%s<Period><AdaptationSet contentType="video" mimeType="video/mp4" codecs="avc1.4d401e">%s%s</AdaptationSet><AdaptationSet contentType="audio" mimeType="audio/mp4" codecs="mp4a.40.2">%s<Representation id="a" bandwidth="48000"/></AdaptationSet></Period></MPD>' % (
        NS, UQ, TT, ''.join('<Representation id="v%d" bandwidth="%d" width="320" height="180"/>' % (i, 90000 + i) for i in range(4095)), TT)
    LQ = '?t=' + 'x' * 1997
    PJS = """([t, u]) => { const K = window.__k, R = {}; let a = performance.now(); const pp = K.dashParse(t); const f = K.dashFingerprint(t, pp, u); R.fp = performance.now() - a; R.err = f.error || '';
      R.urlq = f.urlq ? f.urlq.reps.filter((x) => x).length : 0; a = performance.now(); K.notePlaylist(u, u, t); R.note = performance.now() - a;
      const p = K.dashInfo.get(K.dashUrlKey(u)); R.records = p && p.dashIdx ? p.dashIdx.reps.length : -1; R.up = p && p.dashIdx ? p.dashIdx.urlparam : '?'; return R; }"""
    pg.goto(B); pg.add_script_tag(content=SRC)
    r = pg.evaluate(PJS, [big, P + 'manifest.mpd' + LQ])
    check('Leistung: 4096 Darstellungen + Descriptor + Query 2000 Zeichen: Abdruck < 3 s, Lesen samt Index < 4 s, Index begrenzt (64 Darstellungen), alle Darstellungen mit Query',
          not r['err'] and r['urlq'] == 4096 and r['fp'] < 3000 and r['note'] < 4000 and 0 < r['records'] <= 64 and r['up'] == '', r)
    r = pg.evaluate(PJS, [big.replace(UQ, UQ * 17), P + 'manifest.mpd' + LQ])
    check('… 17 Descriptoren: kontrolliert abgelehnt (urlparam-limits), nichts indiziert', r['err'] == 'urlparam-limits' and r['records'] == 0 and r['up'] == 'urlparam-limits', r)
    br.close()
srv.shutdown()
done()
