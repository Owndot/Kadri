# S4b-7a – Machbarkeitsstudie: Erkennung und Zuordnung von DASH außerhalb des Hauptthreads (Worker, MSE im Worker, srcdoc/about:blank).
# NICHT Kadri: eine eigene Messsonde (tests/s4b7/probe, webRequest nur beobachtend, nur die Testhosts) in Chromium, dazu der
# Testplayer tests/web/s4a/own.js. Gemessen wird, was webRequest bei Worker-/Frame-Abrufen liefert (tabId, frameId, documentId,
# initiator, type, Zeitstempel, Weiterleitungen, Cache, Service Worker) und welche Bindungsregeln daraus SICHER wären.
# Keine Adresse und kein Query-Wert wird gespeichert oder ausgegeben (die Sonde klassifiziert schon im Hintergrund).
#   xvfb-run -a python3 tests/s4b7_webrequest_study.py [OUTDIR]
import os, re, sys, json, time, hashlib, threading, http.server, urllib.parse, tempfile, statistics
KADRI = os.path.realpath(os.path.join(os.path.dirname(os.path.abspath(__file__)), '..')); sys.path.insert(0, os.path.join(KADRI, 'tests'))
from common import check, done   # noqa: E402
from playwright.sync_api import sync_playwright   # noqa: E402

PORT = 8793
H264 = os.path.join(KADRI, 'tests', 'web', 'public', 's3d-dash'); LIB = os.path.join(KADRI, 'tests', 'web', 's4a')
PROBE = os.path.join(KADRI, 'tests', 's4b7', 'probe')
OUT = sys.argv[1] if len(sys.argv) > 1 else ''
FRONT, CDN = '127.0.0.1:%d' % PORT, 'cdn.example.org:%d' % PORT
MPD = open(os.path.join(H264, 'manifest.mpd'), encoding='utf-8').read()
# SHA-256-Präfix (12 Byte) je Fixture-Datei: das, was ein Helfer beim Laden derselben Stücke berechnen könnte
HASH = {}
for f in os.listdir(H264):
    m = re.match(r'(init|chunk)-(\d)(?:-0*(\d+))?\.m4s$', f)
    if not m: continue
    b = open(os.path.join(H264, f), 'rb').read(); name = ('init:' + m.group(2)) if m.group(1) == 'init' else 'seg:%s:%s' % (m.group(2), m.group(3))
    HASH[hashlib.sha256(b).hexdigest()[:24]] = name
    x = 0x811c9dc5
    for c in b: x = ((x ^ c) * 0x01000193) & 0xffffffff
    HASH['f%08x:%d' % (x, len(b))] = name   # (Rückfall der Sonde in unsicheren Kontexten)

VID = '<video id=v%d muted playsinline controls style="width:48%%;aspect-ratio:16/9;background:#000"></video>'
def page(body): return '<!doctype html><html><head><meta charset=utf-8><title>s4b7</title></head><body style="margin:0">%s</body></html>' % body
LIBABS = 'http://%s/lib/own.js' % FRONT
def own(*cfgs, seq=False, abs_lib=False, extra=''):
    vids = sorted(set(c.get('v', 0) for c in cfgs))
    js = 'const C = %s; C.forEach((c) => { c.video = document.getElementById("v" + (c.v || 0)); });' % json.dumps(list(cfgs))
    if seq: js += '(async () => { for (const c of C) { await S4A.start(c); const v = c.video; const t0 = Date.now(); while (v.currentTime < 6 && Date.now() - t0 < 20000) await new Promise((r) => setTimeout(r, 200)); } })();'
    else: js += 'C.forEach((c) => S4A.start(c));'
    return page(''.join(VID % i for i in vids) + '<script src="%s"></script><script>%s%s</script>' % (LIBABS if abs_lib else '/lib/own.js', js, extra))
mp = lambda k, host=FRONT: 'http://%s/m/%s/manifest.mpd' % (host, k)
esc = lambda s: s.replace('&', '&amp;').replace('"', '&quot;')
js = lambda s: json.dumps(s).replace('</', '<\\/')   # Zeichenkette in <script>: „</script>“ darf das Skript nicht beenden
CLOCK = page('''<script>
const ev = (d) => document.dispatchEvent(new CustomEvent('kprobe', { detail: Object.assign({ t: Date.now(), tp: performance.timeOrigin + performance.now() }, d) }));
const w = new Worker(URL.createObjectURL(new Blob([`onmessage = async (e) => { const i = e.data; postMessage({ mark: i, t: Date.now(), tp: performance.timeOrigin + performance.now() }); await fetch(self.location.origin + '/clock?i=' + i, { cache: 'no-store' }); }`], { type: 'text/javascript' })));
w.onmessage = (e) => ev({ ev: 'wclock', mark: e.data.mark, wt: e.data.t, wtp: e.data.tp });
(async () => { for (let k = 0; k < 12; k++) { fetch('/clock?i=m' + k, { cache: 'no-store' }); w.postMessage('w' + k); await new Promise((r) => setTimeout(r, 150)); } })();
</script>''')
SWPAGE = page('''<script>
(async () => { const r = await navigator.serviceWorker.register('/sw-test.js', { scope: '/p/' }); await navigator.serviceWorker.ready;
  if (!navigator.serviceWorker.controller) { location.reload(); return; }
  for (let k = 1; k <= 3; k++) await fetch('/m/swk/chunk-1-0000' + k + '.m4s', { cache: 'no-store' });
  document.title = 'fertig'; })();
</script>''')
SWJS = "self.addEventListener('install', () => self.skipWaiting()); self.addEventListener('activate', (e) => e.waitUntil(clients.claim()));\nself.addEventListener('fetch', (e) => { if (e.request.url.indexOf('/m/swk/') >= 0) e.respondWith(fetch(e.request)); });"
CACHE = page('''<script>(async () => { for (let r = 0; r < 2; r++) for (let k = 1; k <= 3; k++) { const x = await fetch('/m/cachek/chunk-1-0000' + k + '.m4s'); await x.arrayBuffer(); }
  const w = new Worker(URL.createObjectURL(new Blob([`(async () => { for (let k = 1; k <= 3; k++) { const x = await fetch('${location.origin}/m/cachek/chunk-0-0000' + k + '.m4s'); await x.arrayBuffer(); const y = await fetch('${location.origin}/m/cachek/chunk-0-0000' + k + '.m4s'); await y.arrayBuffer(); } })();`], { type: 'text/javascript' })));
  document.title = 'fertig'; })();</script>''')
REPEAT = page('<script>(async () => { for (let r = 0; r < 3; r++) await (await fetch("/m/repk/chunk-1-00002.m4s", { cache: "no-store" })).arrayBuffer(); })();</script>')
# about:blank-Rahmen, per DOM befüllt (Skript und Video ins leere Dokument eingefügt, kein document.open)
BLANK = page('<div>about:blank-Rahmen</div><iframe id=f style="width:100%%;aspect-ratio:16/9;border:0"></iframe><script>const f = document.getElementById("f"), d = f.contentDocument;'
             'd.body.innerHTML = %s; const s = d.createElement("script"); s.src = %s; s.onload = () => { const W = f.contentWindow; W.S4A.start({ mpd: %s, mode: "main", video: d.getElementById("v0") }); }; d.head.appendChild(s);</script>'
             % (js(VID % 0), js(LIBABS), js(mp('c2b'))))
# about:blank mit document.open/write (häufig bei Werbe-/Player-Rahmen): document.open entfernt alle Listener am Dokument
BLANKW = page('<iframe id=f style="width:100%%;aspect-ratio:16/9;border:0"></iframe><script>setTimeout(() => { const d = document.getElementById("f").contentDocument; d.open(); d.write(%s); d.close(); }, 300);</script>'
              % js(own(dict(mpd=mp('c2bw'), mode='main'), abs_lib=True)))
# Zuordnung je Abrufweg: Seite, about:blank-Rahmen (Aufruf aus der Seite / eigenes Skript / XHR), srcdoc-Rahmen (eigenes Skript)
BLANKF = page('<iframe id=f></iframe><iframe id=g srcdoc="%s"></iframe><script>setTimeout(() => { const f = document.getElementById("f"), d = f.contentDocument;'
              'fetch("/clock?i=p0"); f.contentWindow.fetch("/clock?i=b1"); const s = d.createElement("script"); s.textContent = \'fetch("/clock?i=b2"); const x = new XMLHttpRequest(); x.open("GET", "/clock?i=b3"); x.send();\'; d.body.appendChild(s); }, 800);</script>'
              % esc('<script>setTimeout(() => fetch("/clock?i=s1"), 800);</script>'))
PAGES = {
    'm1': own(dict(mpd=mp('m1'), mode='main')),
    'b1': own(dict(mpd=mp('b1'), mode='worker')),
    'b2': own(dict(mpd=mp('b2'), mode='wmse')),
    'c2': page('<iframe srcdoc="%s" style="width:100%%;aspect-ratio:16/9;border:0"></iframe>' % esc(own(dict(mpd=mp('c2'), mode='main'), abs_lib=True))),
    'c2w': page('<iframe srcdoc="%s" style="width:100%%;aspect-ratio:16/9;border:0"></iframe>' % esc(own(dict(mpd=mp('c2w'), mode='worker'), abs_lib=True))),
    'c2b': BLANK, 'c2bw': BLANKW, 'blankf': BLANKF,
    # Manifest-Lesen: MPD auf dem fremden Host (CORS *), MPD nur MIT Sitzungs-Cookie (Worker sendet es, ein Abruf ohne Cookies nicht)
    'xo': own(dict(mpd=mp('xo', CDN), mode='worker')),
    'ck': own(dict(mpd=mp('ck'), mode='worker')).replace('<body style="margin:0">', '<body style="margin:0"><script>document.cookie = "sess=1; path=/";</script>', 1),
    'nest': page('<iframe src="http://%s/p/nest-mid.html" style="width:100%%;aspect-ratio:16/9;border:0"></iframe>' % CDN),
    'nest-mid': page('<iframe srcdoc="%s" style="width:100%%;aspect-ratio:16/9;border:0"></iframe>' % esc(own(dict(mpd=mp('nest', CDN), mode='worker'), abs_lib=False).replace('/lib/own.js', 'http://%s/lib/own.js' % CDN))),
    'two1': own(dict(mpd=mp('two1a'), mode='worker', v=0, vid='1'), dict(mpd=mp('two1b'), mode='worker', v=1, vid='0')),
    'two2': own(dict(mpd=mp('two2a'), mode='wmse', v=0, vid='1'), dict(mpd=mp('two2b'), mode='wmse', v=1, vid='0')),
    'twom': own(dict(mpd=mp('twoma'), mode='main', v=0, vid='1'), dict(mpd=mp('twomb'), mode='main', v=1, vid='0')),
    # zwei konkurrierende Videos + Werbung: v0 spielt erst Werbung (Darstellung 0), dann den Hauptfilm (Darstellung 1);
    # v1 spielt gleichzeitig einen anderen Strom mit denselben Bytes wie die Werbung (Darstellung 0)
    'twoad': page(VID % 0 + VID % 1 + '<script src="/lib/own.js"></script><script>const V = (i) => document.getElementById("v" + i);'
                  'S4A.start({ mpd: %s, mode: "worker", vid: "0", video: V(1) });'
                  '(async () => { await S4A.start({ mpd: %s, mode: "worker", vid: "0", maxSegs: 3, burst: true, video: V(0) }); const t0 = Date.now();'
                  ' while (V(0).currentTime < 6 && Date.now() - t0 < 20000) await new Promise((r) => setTimeout(r, 200));'
                  ' await S4A.start({ mpd: %s, mode: "worker", vid: "1", video: V(0) }); })();</script>' % (js(mp('ad2o')), js(mp('ad2a')), js(mp('ad2m')))),
    # zwei Videos, zwei MPDs, aber byte-gleiche Stücke derselben Darstellung (z. B. Vorschau und Hauptplayer desselben Films)
    'twosame': own(dict(mpd=mp('tsa'), mode='worker', v=0, vid='1'), dict(mpd=mp('tsb'), mode='worker', v=1, vid='1')),
    'ad1': own(dict(mpd=mp('ad1a'), mode='worker', vid='0', maxSegs=3, burst=True), dict(mpd=mp('ad1m'), mode='worker'), seq=True),
    # Vorladen im Hintergrund: ein Worker lädt Stücke eines ZWEITEN MPD, ohne sie an irgendein Video anzuhängen
    'pre1': own(dict(mpd=mp('pre1a'), mode='worker', v=0, vid='1'), extra='setTimeout(() => { const w = new Worker("/lib/own-worker.js"); for (let k = 1; k <= 4; k++) w.postMessage({ id: k, op: "buf", url: %s + "chunk-0-0000" + k + ".m4s" }); }, 1500);'
                % json.dumps(mp('pre1b').replace('manifest.mpd', ''))),
    # verstecktes zweites Video, das tatsächlich abspielt (eigene MediaSource)
    'pre2': own(dict(mpd=mp('pre2a'), mode='worker', v=0, vid='1'), dict(mpd=mp('pre2b'), mode='worker', v=1, vid='0', maxSegs=3, burst=True)).replace('id=v1 ', 'id=v1 style="display:none" '),
    'nav': own(dict(mpd=mp('nava'), mode='worker'), extra='setTimeout(() => { location.href = "/p/nav2.html"; }, 7000);'),
    'nav2': own(dict(mpd=mp('navb'), mode='worker')),
    'wrst': own(dict(mpd=mp('wrst'), mode='worker', restartAt=2)),
    'swch': own(dict(mpd=mp('swcha'), mode='worker', vid='0', burst=True), dict(mpd=mp('swchb'), mode='worker'), seq=True),
    'redir': own(dict(mpd='http://%s/m/redir/start.mpd?tok=x1' % FRONT, mode='worker')),
    'sw': SWPAGE, 'cache': CACHE, 'clock': CLOCK, 'rep': REPEAT,
}
# Wahrheit: welches Video (Rahmen-Seite, Element) spielt welches MPD (Szenario-Schlüssel); None = kein sichtbares Spiel
TRUTH = {'m1': {('m1', 'v0'): 'm1'}, 'b1': {('b1', 'v0'): 'b1'}, 'b2': {('b2', 'v0'): 'b2'}, 'c2': {('', 'v0'): 'c2'}, 'c2w': {('', 'v0'): 'c2w'},
         'c2b': {('', 'v0'): 'c2b'}, 'nest': {('', 'v0'): 'nest'}, 'two1': {('two1', 'v0'): 'two1a', ('two1', 'v1'): 'two1b'},
         'two2': {('two2', 'v0'): 'two2a', ('two2', 'v1'): 'two2b'}, 'twom': {('twom', 'v0'): 'twoma', ('twom', 'v1'): 'twomb'},
         'ad1': {('ad1', 'v0'): 'ad1m'}, 'twoad': {('twoad', 'v0'): 'ad2m', ('twoad', 'v1'): 'ad2o'},
         'twosame': {('twosame', 'v0'): 'tsa', ('twosame', 'v1'): 'tsb'}, 'pre1': {('pre1', 'v0'): 'pre1a'}, 'pre2': {('pre2', 'v0'): 'pre2a', ('pre2', 'v1'): 'pre2b'},
         'c2bw': {('', 'v0'): 'c2bw'}, 'xo': {('xo', 'v0'): 'xo'}, 'ck': {('ck', 'v0'): 'ck'}, 'nav': {('nav2', 'v0'): 'navb'},
         'wrst': {('wrst', 'v0'): 'wrst'}, 'swch': {('swch', 'v0'): 'swchb'}, 'redir': {('redir', 'v0'): 'redir'}}
WAIT = {'twoad': 24, 'blankf': 4, 'nav': 16, 'ad1': 22, 'swch': 22, 'clock': 5, 'sw': 6, 'cache': 5, 'rep': 4}

class H(http.server.BaseHTTPRequestHandler):
    protocol_version = 'HTTP/1.1'
    def log_message(self, *a): pass
    def out(self, code, body=b'', ct='application/octet-stream', extra=None):
        self.send_response(code)
        for k, v in (extra or {}).items(): self.send_header(k, v)
        self.send_header('Content-Type', ct); self.send_header('Content-Length', str(len(body))); self.send_header('Access-Control-Allow-Origin', '*')
        if not (extra and 'Cache-Control' in extra): self.send_header('Cache-Control', 'no-store')
        self.end_headers()
        try: self.wfile.write(body)
        except Exception: pass
    def do_GET(self):
        u = urllib.parse.urlparse(self.path); parts = u.path.strip('/').split('/')
        if parts[0] == 'p' and len(parts) == 2 and parts[1][:-5] in PAGES: return self.out(200, PAGES[parts[1][:-5]].encode(), 'text/html; charset=utf-8')
        if parts[0] == 'lib' and parts[1] in ('own.js', 'own-worker.js'): return self.out(200, open(os.path.join(LIB, parts[1]), 'rb').read(), 'text/javascript')
        if u.path == '/sw-test.js': return self.out(200, SWJS.encode(), 'text/javascript', {'Service-Worker-Allowed': '/'})
        if parts[0] == 'clock': return self.out(204)
        if parts[0] != 'm' or len(parts) != 3: return self.out(404)
        key, name = parts[1], parts[2]
        if key == 'redir' and name == 'start.mpd': return self.out(302, extra={'Location': '/m/redir/manifest.mpd?tok=x2'})
        if key == 'redir' and name.endswith('.m4s') and self.headers.get('Host') == FRONT:
            return self.out(302, extra={'Location': 'http://%s/m/redir/%s?sig=z' % (CDN, name)})
        if key == 'ck' and name == 'manifest.mpd' and 'sess=1' not in (self.headers.get('Cookie') or ''): return self.out(403)
        if name == 'manifest.mpd': return self.out(200, MPD.encode(), 'application/dash+xml')
        f = os.path.join(H264, name)
        if not os.path.isfile(f): return self.out(404)
        return self.out(200, open(f, 'rb').read(), 'video/mp4', {'Cache-Control': 'max-age=600'} if key == 'cachek' else None)
srv = http.server.ThreadingHTTPServer(('127.0.0.1', PORT), H); srv.daemon_threads = True
threading.Thread(target=srv.serve_forever, daemon=True).start()

DATA = {}
with sync_playwright() as p:
    ud = tempfile.mkdtemp(prefix='s4b7-')
    ctx = p.chromium.launch_persistent_context(ud, headless=False, executable_path=os.environ.get('KADRI_CHROMIUM') or None,
        args=['--disable-extensions-except=' + PROBE, '--load-extension=' + PROBE, '--host-resolver-rules=MAP cdn.example.org 127.0.0.1',
              '--no-proxy-server', '--autoplay-policy=no-user-gesture-required'])
    sw = ctx.service_workers[0] if ctx.service_workers else ctx.wait_for_event('serviceworker', timeout=15000)
    for key in ['clock', 'blankf', 'm1', 'b1', 'b2', 'c2', 'c2w', 'c2b', 'c2bw', 'nest', 'xo', 'ck', 'twom', 'two1', 'two2', 'twosame', 'twoad', 'ad1', 'pre1', 'pre2', 'nav', 'wrst', 'swch', 'redir', 'sw', 'cache', 'rep']:
        sw.evaluate('() => { globalThis.__rec.length = 0; }')
        pg = ctx.new_page()
        t0 = time.time() * 1000
        pg.goto('http://%s/p/%s.html' % (FRONT, key))
        time.sleep(WAIT.get(key, 12))
        DATA[key] = {'t0': t0, 'rec': sw.evaluate('() => globalThis.__rec.slice()')}
        pg.close(); time.sleep(0.5)
    ctx.close()
srv.shutdown()

# ------------------------------------------------------------- Auswertung -------------------------------------------------------------
REQ = lambda k: [r for r in DATA[k]['rec'] if r['ev'] == 'req']
CTX = lambda k: [r for r in DATA[k]['rec'] if r['ev'] == 'ctx']
def frames(k):   # documentId → {frame, kind, page, top}
    out = {}
    for c in CTX(k):
        if c['m'].get('k') == 'frame': out[c['doc']] = {'frame': c['frame'], 'kind': c['m']['kind'], 'page': c['m']['page'], 'top': c['m']['top']}
    return out
def media(k):   # (doc, el) → letzte loadstart-Zeit, Quellenart, Frame
    out = {}
    for c in CTX(k):
        m = c['m']
        if m.get('k') == 'page' and m.get('ev') == 'media' and m.get('type') == 'loadstart' and m.get('el'):
            out[(c['doc'], m['el'])] = {'t': m['t'], 'src': m['src'], 'frame': c['frame']}
    return out
def appends(k):   # Medienquelle (ms) → Folge der erkannten Stücke (aus dem SHA-256-Präfix)
    out = {}
    for c in CTX(k):
        m = c['m']
        if m.get('k') == 'page' and m.get('ev') == 'append': out.setdefault((c['doc'], m['ms']), []).append((m['at'], HASH.get(m['h'], '?'), m['hashMs'], m['len']))
    return out
def runs(segs):   # längste zusammenhängende Folge je Darstellung
    best = {}
    for rep in {s.split(':')[1] for s in segs}:
        ns = sorted({int(s.split(':')[2]) for s in segs if s.split(':')[1] == rep}); b = c = 0; prev = None
        for n in ns: c = c + 1 if prev is not None and n == prev + 1 else 1; b = max(b, c); prev = n
        best[rep] = b
    return best

REPORT = {}
# 1) Sichtbarkeit und Herkunftsangaben je Szenario
for k in DATA:
    reqs = REQ(k); fr = frames(k)
    segs = [r for r in reqs if r['kind'].startswith('seg:') or r['kind'].startswith('init:')]
    mpds = [r for r in reqs if r['kind'] == 'mpd']
    REPORT[k] = {
        'mpd': len(mpds), 'seg': len(segs), 'types': sorted({r['type'] for r in mpds + segs}),
        'tab': sorted({r['tab'] for r in segs + mpds}), 'docKnown': sum(1 for r in segs if r.get('doc')), 'docInFrames': sum(1 for r in segs if r.get('doc') in fr),
        'frameKinds': sorted({fr[r['doc']]['kind'] for r in segs if r.get('doc') in fr}), 'initiator': sorted({str(r.get('init')) for r in segs + mpds}),
        'ftype': sorted({str(r.get('ftype')) for r in segs}), 'frames': sorted({(v['kind'], v['page'], v['top']) for v in fr.values()}),
        'fromCache': sum(1 for r in DATA[k]['rec'] if r['ev'] == 'done' and r.get('fromCache')),
        'redirects': [(r['kind'], r['status'], r['to']['host'], r['to']['kind']) for r in DATA[k]['rec'] if r['ev'] == 'redir'],
    }
# 2) Uhren: webRequest-Zeitstempel gegen Date.now()/timeOrigin des Dokuments bzw. Workers (gleiche Marke)
ck = DATA['clock']['rec']; marks = {}
for c in [r for r in ck if r['ev'] == 'ctx']:
    m = c['m']
    if m.get('ev') == 'fetch': marks[m['mark']] = ('main', m['t'], m['tp'])
    if m.get('ev') == 'wclock': marks[m['mark']] = ('worker', m['wt'], m['wtp'])
dl = {'main': [], 'worker': []}, {'main': [], 'worker': []}
for r in [r for r in ck if r['ev'] == 'req' and r['kind'].startswith('clock:')]:
    mk = r['kind'].split(':')[1]
    if mk in marks: who, t, tp = marks[mk]; dl[0][who].append(r['ts'] - t); dl[1][who].append(r['ts'] - tp)
CLK = {w: {'n': len(dl[0][w]), 'dateNow_median': round(statistics.median(dl[0][w]), 2) if dl[0][w] else None, 'dateNow_max': round(max(dl[0][w]), 2) if dl[0][w] else None,
           'dateNow_min': round(min(dl[0][w]), 2) if dl[0][w] else None, 'timeOrigin_median': round(statistics.median(dl[1][w]), 2) if dl[1][w] else None} for w in ('main', 'worker')}
# 3) Bindungsregeln gegen die Wahrheit
def rule_net(k):   # R1: nur webRequest + Dokument + Epoche (loadstart) + Folge ≥ 3 je MPD; eindeutig je Dokument
    reqs = REQ(k); md = media(k); fr = frames(k); res = {}
    for (doc, el), mv in md.items():
        page_ = fr.get(doc, {}).get('page', '')
        others = [x for x in md if x[0] == doc and x != (doc, el)]
        cand = {}
        for r in reqs:
            if r.get('doc') == doc and r['kind'].startswith('seg:') and r['ts'] >= mv['t']: cand.setdefault(r['scen'], []).append(r['kind'])
        good = sorted(s for s, ks in cand.items() if max(runs(ks).values() or [0]) >= 3)
        if others: verdict = 'mehrdeutig (mehrere Videos im Dokument)' if good else 'keine'
        elif len(good) == 1: verdict = good[0]
        elif good: verdict = 'mehrdeutig (%d MPDs)' % len(good)
        else: verdict = 'keine'
        res[(page_, el)] = verdict
    return res
def rule_mse(k):   # R2: MSE-Anhänge des Videos (SHA-256-Präfix) ↔ Stücke; R1-Kandidaten im Dokument mit genau dieser Folge
    reqs = REQ(k); md = media(k); ap = appends(k); fr = frames(k); res = {}
    for (doc, el), mv in md.items():
        page_ = fr.get(doc, {}).get('page', '')
        if not mv['src'].startswith('ms:'): res[(page_, el)] = 'nicht sichtbar (%s)' % mv['src']; continue
        mine = [x for x in ap.get((doc, int(mv['src'][3:])), []) if x[0] >= mv['t'] and x[1].startswith('seg:') and x[1].split(':')[1] in ('0', '1')]
        if max(runs([x[1] for x in mine]).values() or [0]) < 3: res[(page_, el)] = 'keine (zu wenige Anhänge)'; continue
        vids_ = {x[1] for x in mine}
        cand = sorted({r['scen'] for r in reqs if r.get('doc') == doc and r['kind'] in vids_ and r['ts'] >= mv['t']})
        res[(page_, el)] = cand[0] if len(cand) == 1 else ('mehrdeutig (%d MPDs mit denselben Stücken)' % len(cand) if cand else 'keine')
    return res
RULES = {}
for k, truth in TRUTH.items():
    r1, r2 = rule_net(k), rule_mse(k)
    RULES[k] = []
    for (pg_, el), want in truth.items():
        got1 = r1.get((pg_, el), 'kein Video gesehen') if pg_ else next((v for (p_, e), v in r1.items() if e == el), 'kein Video gesehen')
        got2 = r2.get((pg_, el), 'kein Video gesehen') if pg_ else next((v for (p_, e), v in r2.items() if e == el), 'kein Video gesehen')
        RULES[k].append({'video': (pg_ or '(Rahmen)') + '/' + el, 'wahr': want, 'R1': got1, 'R2': got2})
def verdict(got, want):
    if got == want: return 'richtig'
    return 'keine Bindung' if got.startswith(('mehrdeutig', 'nicht sichtbar', 'keine', 'kein Video')) else 'FALSCH'
hashms = [x[2] for k in DATA for v in appends(k).values() for x in v]; hashlen = [x[3] for k in DATA for v in appends(k).values() for x in v]

print('\n=== Sichtbarkeit (webRequest, nur Klassen) ===')
for k, v in REPORT.items(): print('%-6s mpd=%d seg=%d types=%s tab=%s doc=%d/%d frames=%s init=%s fromCache=%d redir=%s' % (k, v['mpd'], v['seg'], v['types'], v['tab'], v['docKnown'], v['docInFrames'], v['frameKinds'], v['initiator'], v['fromCache'], v['redirects']))
print('\n=== Uhren (webRequest.timeStamp − Zeit des Absendens, ms) ===\n', json.dumps(CLK))
print('\n=== Bindungsregeln ===')
for k, rows in RULES.items():
    for x in rows: print('%-6s %-14s wahr=%-7s R1=%-40s [%s]  R2=%-40s [%s]' % (k, x['video'], x['wahr'], x['R1'], verdict(x['R1'], x['wahr']), x['R2'], verdict(x['R2'], x['wahr'])))
print('\nMSE-Hash: %d Anhänge, Median %.2f ms, max %.2f ms, größter Anhang %d Byte' % (len(hashms), statistics.median(hashms) if hashms else 0, max(hashms) if hashms else 0, max(hashlen) if hashlen else 0))

# ------------------------------------------------------------- Nachweise (hart) -------------------------------------------------------------
R = REPORT
check('Datenschutz: die Sonde speichert keine Adresse und keinen Query-Wert (nur Klassen)', not any(re.search(r'://|tok=|sig=|x1|x2', json.dumps(DATA[k]['rec'])) for k in DATA))
check('b1: Worker-MPD und -Stücke für webRequest sichtbar', R['b1']['mpd'] >= 1 and R['b1']['seg'] >= 6, R['b1'])
check('b2: MPD und Stücke des Workers mit MediaSource sichtbar', R['b2']['mpd'] >= 1 and R['b2']['seg'] >= 6, R['b2'])
for k in ('b1', 'b2'):
    check('%s: Worker-Abrufe tragen tabId und documentId des erzeugenden Dokuments (Seite)' % k, R[k]['docKnown'] == R[k]['seg'] and R[k]['docInFrames'] == R[k]['seg'] and R[k]['tab'] and min(R[k]['tab']) >= 0, R[k])
for k in ('c2', 'c2w', 'c2b'):
    check('%s: Inhaltsskripte laufen im srcdoc/about:blank-Rahmen (match_about_blank/match_origin_as_fallback)' % k, any(f[0] in ('srcdoc', 'blank') for f in R[k]['frames']), R[k]['frames'])
    if k == 'c2b': continue   # (about:blank: eigener Befund unten)
    check('%s: Abrufe aus dem Rahmen gehören zu dessen documentId' % k, R[k]['seg'] > 0 and R[k]['docInFrames'] == R[k]['seg'] and set(R[k]['frameKinds']) <= {'srcdoc', 'blank'}, R[k])
# about:blank: wem ordnet webRequest die Abrufe zu?
BF = {}
fr_bf = frames('blankf')
for r in REQ('blankf'):
    if r['kind'].startswith('clock:'): BF[r['kind'][6:]] = {'frame': r['frame'], 'ftype': r['ftype'], 'kind': fr_bf.get(r['doc'], {}).get('kind', '?')}
print('\n=== about:blank / srcdoc: Zuordnung je Abrufweg ===\n', json.dumps(BF))
REPORT['blankf'] = BF
check('blankf: srcdoc-Abruf gehört zum srcdoc-Dokument, Seitenabruf zur Seite', BF.get('s1', {}).get('kind') == 'srcdoc' and BF.get('p0', {}).get('kind') == 'http', BF)
check('blankf (Befund): alle Abrufwege aus dem about:blank-Rahmen tragen frameId/documentId der ELTERN-Seite (nicht des Rahmens)',
      all(BF.get(m, {}).get('kind') == 'http' and BF[m]['ftype'] == 'outermost_frame' for m in ('b1', 'b2', 'b3')), BF)
check('c2b (Befund): Player im about:blank-Rahmen (Medienereignisse dort), seine Abrufe aber unter der Eltern-documentId',
      R['c2b']['seg'] > 0 and R['c2b']['frameKinds'] == ['http'] and any(fr.get('kind') == 'blank' for d, fr in frames('c2b').items() for (dd, el) in media('c2b') if dd == d), R['c2b'])
# Manifest-Lesen ohne Cookies vom zugeordneten Dokument aus (flüchtig): gleicher Inhalt? Bei Cookie-Pflicht: sicher abgelehnt?
MB = MPD.encode(); x = 0x811c9dc5
for c in MB: x = ((x ^ c) * 0x01000193) & 0xffffffff
MPDH = {hashlib.sha256(MB).hexdigest()[:24], 'f%08x:%d' % (x, len(MB))}
RF = {}
for k in DATA:
    for r in DATA[k]['rec']:
        if r['ev'] == 'refetch':
            res = r['res']; RF.setdefault(k, []).append({'scen': r['scen'], 'host': r['host'], 'q': r['q'], 'status': res.get('status'), 'gleich': res.get('h') in MPDH,
                                                       'umgeleitet': res.get('redirected'), 'err': res.get('err')})
print('\n=== Manifest ohne Cookies neu gelesen (vom zugeordneten Dokument) ===\n', json.dumps(RF))
REPORT['refetch'] = RF
for k in ('b1', 'b2', 'c2', 'nest', 'xo', 'redir'):
    check('%s: MPD ohne Cookies vom zugeordneten Dokument neu gelesen – byte-gleich' % k, RF.get(k) and all(e['status'] == 200 and e['gleich'] for e in RF[k]), RF.get(k))
check('redir: neu gelesen wird die ENDGÜLTIGE Adresse (mit Query, ohne erneute Weiterleitung)', RF.get('redir') and all(e['q'] and not e['umgeleitet'] for e in RF['redir']), RF.get('redir'))
ckd = [r for r in REQ('ck') if r['kind'] == 'mpd']
check('ck: Worker lädt das MPD mit Sitzungs-Cookie (200), der Abruf ohne Cookies wird abgewiesen (403) – sicher: kein Abdruck, keine Bindung',
      any(r['status'] == 200 for r in DATA['ck']['rec'] if r['ev'] == 'done' and r['kind'] == 'mpd') and RF.get('ck') and all(e['status'] == 403 and not e['gleich'] for e in RF['ck']), (len(ckd), RF.get('ck')))
check('c2bw (Befund): about:blank mit document.open/write – der Player läuft (Abrufe unter der Eltern-documentId), die Sonde sieht im Rahmen aber kein Medienereignis mehr (document.open entfernt die Listener am Dokument)',
      R['c2bw']['seg'] > 0 and R['c2bw']['frameKinds'] == ['http'] and not media('c2bw'), (R['c2bw'], list(media('c2bw'))))
check('nest: verschachtelt (Seite → fremder Rahmen → srcdoc → Worker): Stücke dem srcdoc-Dokument zugeordnet', R['nest']['seg'] > 0 and R['nest']['frameKinds'] == ['srcdoc'], R['nest'])
check('Uhren: webRequest.timeStamp liegt auf der Date.now()-Achse (Hauptthread und Worker, Abstand 0…50 ms)',
      all(CLK[w]['n'] >= 10 and CLK[w]['dateNow_min'] > -5 and CLK[w]['dateNow_max'] < 50 for w in ('main', 'worker')), CLK)
check('Weiterleitungen: MPD 302 und Stück 302 (Host-Wechsel) als onBeforeRedirect sichtbar', any(x[0] == 'mpd' and x[1] == 302 for x in R['redir']['redirects'])
      and any(x[0].startswith('seg:') and x[2] == 'cdn' for x in R['redir']['redirects']), R['redir']['redirects'])
check('Service Worker: Abruf des Service Workers mit tabId −1 (ohne Dokument) – die Seitenanfrage selbst erscheint nicht als Netzabruf',
      R['sw']['seg'] >= 3 and R['sw']['tab'] == [-1], R['sw'])
check('Cache: Wiederholungen aus dem HTTP-Cache melden fromCache', R['cache']['fromCache'] >= 3, R['cache'])
check('Mehrfach geladenes Stück: jede Wiederholung ein eigener Abruf (eigene requestId)', R['rep']['seg'] == 3 and len({r['rid'] for r in REQ('rep') if r['kind'].startswith('seg')}) == 3, R['rep'])
for k, rows in RULES.items():
    for x in rows:
        check('%s %s: R1 (Netz + Dokument + Epoche) bindet nie falsch' % (k, x['video']), verdict(x['R1'], x['wahr']) != 'FALSCH', x)
        check('%s %s: R2 (MSE-Hash + Netz) bindet nie falsch' % (k, x['video']), verdict(x['R2'], x['wahr']) != 'FALSCH', x)
if OUT:
    os.makedirs(OUT, exist_ok=True)
    json.dump({'report': REPORT, 'clock': CLK, 'rules': RULES, 'hash_ms': hashms}, open(os.path.join(OUT, 's4b7-studie.json'), 'w'), ensure_ascii=False, indent=1, default=str)
    json.dump({k: v['rec'] for k, v in DATA.items()}, open(os.path.join(OUT, 's4b7-rohdaten-klassen.json'), 'w'), ensure_ascii=False, default=str)
done()
