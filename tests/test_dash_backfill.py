# S4b-4-Fix: Anfragebeginn beim NACHTRÄGLICHEN Zuordnen schon geladener DASH-Stücke (src/040 notePlaylist → recentRes → dashHit)
# und derselbe Zeitpunkt in der anonymen Beobachter-Zählung (obsNote / Diagnose).
# Läuft mit den ECHTEN Quelltexten (src/038, 039, 046, Ausschnitte aus 040 und 060) im echten Chromium (DOMParser, Resource
# Timing, PerformanceObserver) – ohne Erweiterung. Zwei Wege:
#  A) echtes Netz: lokaler Server, Antworten verzögert; der echte PerformanceObserver aus src/040 meldet die Abrufe
#  B) dieselbe Abfolge deterministisch über seeUrl(u, Ankunft, Initiator, Anfragebeginn) – so ruft der Beobachter seeUrl auf
# Abfolge: 3 zusammenhängende Stücke (Darstellung 1) werden VOR der neuen Medien-Epoche angefragt, kommen erst DANACH an;
# das MPD wird erst nach diesen Antworten gelesen (Rückfüllen aus recentRes). Sie dürfen nicht zählen. Danach 3 nach dem
# Epochenbeginn angefragte Stücke (Darstellung 0): Bindung, gespielte Darstellungen für dashOfferOf nur [0].
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

with sync_playwright() as p:
    br = p.chromium.launch(executable_path=os.environ.get('KADRI_CHROMIUM') or None)
    for way in ('A', 'B'):
        pg = br.new_page()
        errs = []; pg.on('pageerror', lambda e: errs.append(str(e)))
        pg.goto(B)
        pg.evaluate('() => Object.defineProperty(document.getElementById("v"), "duration", { value: 5525.12 })')
        pg.add_script_tag(content=SRC)
        check('%s: echte Quelltexte geladen (notePlaylist, seeUrl, dashHit, dashBindingFor, dashOfferOf)' % way, pg.evaluate('() => !!window.__k') and not errs, errs)
        mpd = B + 'v/manifest.mpd'
        if way == 'A':
            # 1) drei alte Stücke anfragen (Server antwortet erst nach 2,6 s), 2) nach 1 s neues Medium (loadstart),
            # 3) Antworten abwarten, 4) MPD lesen (wie der Mitleser: notePlaylist mit dem Text)
            t = pg.evaluate('''async ([b, segs]) => {
              const req = performance.timeOrigin + performance.now();
              const ps = segs.map((s) => fetch(b + 'v/' + s, { cache: 'no-store' }).then((r) => r.arrayBuffer()));
              await new Promise((r) => setTimeout(r, 1000));
              const ls = Date.now(); document.getElementById('v').dispatchEvent(new Event('loadstart'));
              await Promise.all(ps); const arr = Date.now();
              await new Promise((r) => setTimeout(r, 300));   // Beobachter liefert die Einträge
              const txt = await (await fetch(b + 'v/manifest.mpd', { cache: 'no-store' })).text();
              window.__k.notePlaylist(b + 'v/manifest.mpd', b + 'v/manifest.mpd', txt);
              return { req, ls, arr };
            }''', [B, [seg(1, i) for i in range(3)]])
            check('A: Abfolge wie verlangt – Anfrage ≥ 0,9 s vor dem Epochenwechsel, Antworten danach', t['ls'] - t['req'] >= 900 and t['arr'] > t['ls'], t)
        else:
            pg.evaluate('''([b, segs]) => { const K = window.__k, now = Date.now();
              document.getElementById('v').dispatchEvent(new Event('loadstart'));   // Epoche ab now − 500 ms
              segs.forEach((s, i) => K.seeUrl(b + 'v/' + s, now + 200 + i * 10, 'fetch', now - 2000 + i * 10));   // vorher angefragt, danach angekommen
            }''', [B, [seg(1, i) for i in range(3)]])
            time.sleep(0.4)
            pg.evaluate('([u, t]) => window.__k.notePlaylist(u, u, t)', [mpd, MPD])
        st = pg.evaluate(STATE, mpd)
        check('%s: MPD erst nach den Antworten gelesen – die 3 nachträglich zugeordneten Stücke tragen ihren Anfragebeginn (vor der Epoche)' % way,
              st['hs'] and len(st['hs']) == 3 and all(h[0] == 1 and h[3] < st['from'] <= h[2] for h in st['hs']), st)
        check('%s: … sie zählen nicht zur neuen Epoche: keine Bindung, 0 Treffer' % way, st['state'] != 'bound' and st['hits'] == 0, st)
        check('%s: … und nicht als gespielte Darstellung im Angebot (dashOfferOf)' % way, st['played'] == [], st)
        # danach: drei nach dem Epochenbeginn angefragte Stücke (Darstellung 0)
        if way == 'A':
            pg.evaluate('''async ([b, segs]) => { for (const s of segs) await (await fetch(b + 'v/' + s, { cache: 'no-store' })).arrayBuffer();
              await new Promise((r) => setTimeout(r, 300)); }''', [B, [seg(0, i) for i in range(3, 6)]])
        else:
            pg.evaluate('''([b, segs]) => { const K = window.__k, now = Date.now();
              segs.forEach((s, i) => K.seeUrl(b + 'v/' + s, now + i * 10, 'fetch', now - 100 + i * 10)); }''', [B, [seg(0, i) for i in range(3, 6)]])
        st = pg.evaluate(STATE, mpd)
        check('%s: 3 nach Epochenbeginn angefragte Stücke binden weiterhin (bound, 3 Treffer, Folge 3)' % way,
              st['state'] == 'bound' and st['hits'] == 3 and st['run'] == 3, st)
        check('%s: gespielte Darstellungen für dashOfferOf: nur die der neuen Epoche [0], nicht die alte [1]' % way, st['played'] == [0], st)
        # Beobachter-Zählung (P2): derselbe Anfragebeginn wie für die Bindung
        o = pg.evaluate('''() => { const K = window.__k, L = K.obsRes.log, R = K.recentRes;
          return { n: L.length, withS: L.filter((x) => x.s > 0).length, bad: L.filter((x) => x.s > x.t).length,
            same: R.filter((x) => x.it).every((x) => L.some((y) => y.s === x.s && y.t === x.t)) }; }''')
        if way == 'A':
            check('A: Beobachter-Zählung (obsNote) speichert den Anfragebeginn aus Resource Timing (je Eintrag, s ≤ t)', o['n'] >= 7 and o['withS'] == o['n'] and o['bad'] == 0, o)
            check('A: … identisch mit dem Zeitpunkt, den die Bindung (recentRes/dashHit) verwendet', o['same'], o)
        if way == 'B':
            f = pg.evaluate('''(b) => { const K = window.__k, T = Date.now() - 50, L = K.obsRes.log, R = K.recentRes, at = K.resAt || ((x) => NaN);
              K.obsNote(b + 'v/x1.m4s', 'fetch', T, 0); const o0 = L[L.length - 1];
              K.obsNote(b + 'v/x2.m4s', 'fetch', T, T + 5); const o1 = L[L.length - 1];
              K.obsNote(b + 'v/x3.m4s', 'fetch', T, T - 700); const o2 = L[L.length - 1];
              K.seeUrl(b + 'v/x4.m4s', T); const r0 = R[R.length - 1];
              K.seeUrl(b + 'v/x5.m4s', T, 'fetch', T - 700); const r1 = R[R.length - 1];
              return { o0: [o0.s === undefined, at(o0) === null], o1: [o1.s === undefined, at(o1) === null], o2: [o2.s === T - 700, at(o2) === T - 700],
                r0: [r0.s === null, at(r0) === null], r1: [at(r1) === T - 700] }; }''', B)
            # S4b-6 P1 (ersetzt den Rückfall auf die Ankunft aus S4b-4): unbekannt bleibt unbekannt – kein Zeitpunkt, eigens gezählt
            check('B: Anfragebeginn unbekannt (Resource Timing ohne startTime): Beobachter-Eintrag ohne s, Zeitpunkt UNBEKANNT (null, nicht die Ankunft)', all(f['o0']), f)
            check('B: … unplausibler Anfragebeginn (nach der Ankunft): verworfen, ebenfalls unbekannt', all(f['o1']), f)
            check('B: … bekannter Anfragebeginn: Beobachter-Zählung und Bindung (recentRes) verwenden ihn gleich', all(f['o2']) and all(f['r1']), f)
            check('B: seeUrl ohne Anfragebeginn: s = null (unbekannt), nicht die Ankunft – der Mitleser übergibt den Absendezeitpunkt ausdrücklich', all(f['r0']), f)
        check('%s: keine Fehler der Seite' % way, not errs, errs)
        pg.close()
    br.close()
srv.shutdown()

# ---------- Rückfall auf die Ankunft nur, wo der Anfragebeginn wirklich unbekannt ist; Diagnose = Bindung ----------
check('Rückfüllen in notePlaylist übergibt den Anfragebeginn (dashHit(info, x.k, x.t, x.s))', 'recentRes.forEach((x) => dashHit(info, x.k, x.t, x.s))' in S040)
check('ein Zeitpunkt für alle: resAt (Anfragebeginn, sonst ausdrücklich Ankunft) in dashOfferOf, src/046 und der Diagnose; kein „x.s || x.t“ mehr',
      'const resAt = ' in S040 and not re.search(r'\.s \|\| \w+\.t', S040 + rd('src', '046-dash-ebenen.js') + rd('src', '280-diagnose.js'))
      and rd('src', '280-diagnose.js').count('resAt(') >= 4 and 'resAt(' in rd('src', '046-dash-ebenen.js'))
done()
