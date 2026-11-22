# Download-Blatt am schwebenden ⬇ (Bottom-Sheet) im echten Chromium – mit GESCHLOSSENEM Shadow DOM wie in der
# ausgelieferten Erweiterung. Der übliche Test-Bau öffnet den Shadow DOM (damit Tests hineinsehen können); genau darum
# blieb verborgen, dass ein pointerdown-Listener auf document Tipps ins Menü als Außentipp wertete (composedPath enthält
# geschlossene Shadow-Knoten nicht) und das Menü vor dem Klick schloss. Hier: eine Kopie des Test-Baus mit
# mode:'closed'; Elemente werden über das DevTools-Protokoll gefunden (DOM.getDocument mit pierce sieht auch
# geschlossene Shadow Roots), getippt wird mit echten Touch-Ereignissen auf Bildschirmkoordinaten.
# Geprüft: Blatt unten, Einträge ≥ 48 px; Tipp ins Blatt und Wischen im Blatt schließen nicht; Außentipp, Zurück und
# „Schließen“ schließen; Tipp auf „Mit Helper herunterladen“ startet genau einen Helfer-Auftrag (eine Anfrage, eine
# Datei), ohne neuen Tab und ohne Navigation; kleines Display: Blatt vollständig sichtbar.
#   HELPER_HOST_DIR=<Helper-Repository: tests/java/channel/build.sh OUT>   (vorher: node tools/build.js --test)
import os, re, shutil, tempfile, time, threading, http.server, urllib.parse

HERE = os.path.dirname(os.path.abspath(__file__))
SRC = os.environ.get('KADRI_SHEET_SRC') or os.path.join(HERE, '..', 'dist', 'test')
CLOSED = tempfile.mkdtemp(prefix='kadri-closed-')
shutil.copytree(SRC, CLOSED, dirs_exist_ok=True)
_cs = os.path.join(CLOSED, 'content.js')
_txt = open(_cs, encoding='utf-8').read()
_open = "attachShadow({ mode: 'open' }); hostEl.setAttribute('data-kadri-test', '');"
assert _txt.count(_open) == 1, 'test build marker'
open(_cs, 'w', encoding='utf-8').write(_txt.replace(_open, "attachShadow({ mode: 'closed' }); hostEl.setAttribute('data-kadri-test', '');"))
os.environ['KADRI_EXT'] = CLOSED
from common import *   # noqa: E402  (liest KADRI_EXT)

CLIP = open(os.path.join(WEB, 'clip.mp4'), 'rb').read()
HLSDIR = os.path.join(WEB, 'hls')
HITS = []
class M(http.server.BaseHTTPRequestHandler):
    def log_message(self, *a): pass
    def do_GET(self):
        u = urllib.parse.urlparse(self.path)
        browser = bool(self.headers.get('Sec-Fetch-Mode'))
        HITS.append({'path': u.path, 'browser': browser})
        if u.path == '/d/mp4.html':
            body = ('<!doctype html><html><head><meta name=viewport content="width=device-width,initial-scale=1"><title>Blatt MP4</title></head>'
                    '<body style="margin:0;height:2000px"><video id=v muted autoplay playsinline loop src="/d/clip.mp4?sig=SECRET" '
                    'style="width:100%;display:block"></video></body></html>').encode(); ctype = 'text/html; charset=utf-8'
        elif u.path == '/d/clip.mp4':
            body, ctype = CLIP, 'video/mp4'
        elif u.path == '/d/other.html':   # vorherige Seite im Verlauf: ein ungewolltes Zurück fiele hier sofort auf
            body = b'<!doctype html><title>Vorher</title><p>vorherige Seite'; ctype = 'text/html; charset=utf-8'
        elif u.path == '/d/hls.html':
            body = ('<!doctype html><html><head><meta name=viewport content="width=device-width,initial-scale=1"><title>Blatt HLS</title>'
                    '<script src="/hls.min.js"></script></head><body style="margin:0"><video id=v muted autoplay playsinline style="width:100%;display:block"></video>'
                    '<script>const v=document.getElementById("v");const h=new Hls();h.loadSource("/d/s/master.m3u8");h.attachMedia(v);'
                    'h.on(Hls.Events.MANIFEST_PARSED,()=>v.play());</script></body></html>').encode(); ctype = 'text/html; charset=utf-8'
        elif u.path == '/hls.min.js':
            body = open(os.path.join(WEB, 'hls.min.js'), 'rb').read(); ctype = 'text/javascript'
        elif u.path == '/d/s/master.m3u8':
            body = re.sub(r',CODECS="[^"]*"', '', open(os.path.join(HLSDIR, 'master.m3u8')).read()).replace('index.m3u8', '/d/s/index.m3u8').encode()
            ctype = 'application/vnd.apple.mpegurl'
        elif u.path == '/d/s/index.m3u8':
            body = open(os.path.join(HLSDIR, 'index.m3u8'), 'rb').read(); ctype = 'application/vnd.apple.mpegurl'
        elif re.match(r'^/d/s/(seg\d+\.m4s|init\.mp4)$', u.path):
            body = open(os.path.join(HLSDIR, u.path.split('/')[-1]), 'rb').read(); ctype = 'video/mp4'
        else:
            self.send_response(404); self.send_header('Content-Length', '0'); self.end_headers(); return
        etag = '"kadri-sheet-%d"' % len(body)
        m = re.match(r'^bytes=(\d+)-(\d*)$', self.headers.get('Range', ''))
        if m and (browser or self.headers.get('If-Range') == etag):
            a = int(m.group(1)); b = int(m.group(2)) if m.group(2) else len(body) - 1
            self.send_response(206); self.send_header('Content-Type', ctype); self.send_header('Content-Length', str(b - a + 1))
            self.send_header('Content-Range', 'bytes %d-%d/%d' % (a, b, len(body))); self.send_header('ETag', etag); self.end_headers()
            self.wfile.write(body[a:b + 1]); return
        self.send_response(200); self.send_header('Content-Type', ctype); self.send_header('Content-Length', str(len(body)))
        self.send_header('ETag', etag); self.send_header('Accept-Ranges', 'bytes'); self.send_header('Cache-Control', 'no-store'); self.end_headers()
        try: self.wfile.write(body)
        except Exception: pass
msrv = http.server.ThreadingHTTPServer(('127.0.0.1', 8791), M); msrv.daemon_threads = True
threading.Thread(target=msrv.serve_forever, daemon=True).start()
PAGE = 'http://127.0.0.1:8791/d/mp4.html'
OTHER = 'http://127.0.0.1:8791/d/other.html'
HLSPAGE = 'http://127.0.0.1:8791/d/hls.html'
helper_clip = lambda: [x for x in HITS if not x['browser'] and x['path'] == '/d/clip.mp4']
def files(h): return h.cmd('dl-files').split(' ')[1:]

# ---------- geschlossener Shadow DOM über das DevTools-Protokoll ----------
def shadow_nodes(cdp):
    root = cdp.send('DOM.getDocument', {'depth': -1, 'pierce': True})['root']
    out = []
    def walk(n, sh):
        if sh: out.append(n)
        for c in n.get('children', []): walk(c, sh)
        for s in n.get('shadowRoots', []): walk(s, sh or s.get('shadowRootType') == 'closed')
    walk(root, False)
    return out
def attrs(n): a = n.get('attributes', []); return dict(zip(a[::2], a[1::2]))
def klass(n): return attrs(n).get('class', '').split()
def label(n):
    t = [c.get('nodeValue', '') for c in n.get('children', []) if c.get('nodeType') == 3]
    return t[0] if t else ''
def find(cdp, cls, text=None):
    return [n for n in shadow_nodes(cdp) if cls in klass(n) and (text is None or label(n) == text)]
def box(cdp, n):
    q = cdp.send('DOM.getBoxModel', {'nodeId': n['nodeId']})['model']['border']
    xs, ys = q[0::2], q[1::2]
    return min(xs), min(ys), max(xs), max(ys)
def center(cdp, n):
    x0, y0, x1, y1 = box(cdp, n); return (x0 + x1) / 2, (y0 + y1) / 2
def center_of(cdp, cls, text=None, secs=5):
    # Knoten jedes Mal neu suchen: eine Knotenkennung kann zwischen Suche und Abfrage ungültig werden
    end = time.time() + secs
    while True:
        try:
            n = find(cdp, cls, text)
            if n: return center(cdp, n[0])
        except Exception:
            if time.time() > end: raise
        if time.time() > end: return None
        time.sleep(0.15)
def sheet_open(cdp): return bool(find(cdp, 'dlm'))
def wait(pred, secs=10):
    end = time.time() + secs
    while time.time() < end:
        if pred(): return True
        time.sleep(0.15)
    return False
def tap(pg, xy): pg.touchscreen.tap(xy[0], xy[1])
def swipe(cdp, x, y0, y1):
    cdp.send('Input.dispatchTouchEvent', {'type': 'touchStart', 'touchPoints': [{'x': x, 'y': y0}]})
    for i in range(1, 9): cdp.send('Input.dispatchTouchEvent', {'type': 'touchMove', 'touchPoints': [{'x': x, 'y': y0 + (y1 - y0) * i / 8}]}); time.sleep(0.02)
    cdp.send('Input.dispatchTouchEvent', {'type': 'touchEnd', 'touchPoints': []})

helper = ChannelHelper()
check('echter Kanal-Helfer mit MP4- und HLS-Engine', helper.ready.startswith('READY') and helper.cmd('downloads 8791') == 'DOWNLOADS on' and helper.cmd('hls on') == 'HLS on')
with sync_playwright() as p:
    ctx, sw, udir = launch(p)
    ext_id = sw.url.split('/')[2]
    check('Kopplung über die Einstellungsseite', pair_helper(ctx, ext_id, helper) == 'Verbunden')
    pg = ctx.pages[0] if ctx.pages else ctx.new_page()
    errs = []; pg.on('pageerror', lambda e: errs.append(str(e)))
    cdp = ctx.new_cdp_session(pg)
    ctxs = {}
    cdp.on('Runtime.executionContextCreated', lambda e: ctxs.__setitem__(e['context']['id'], e['context']))
    cdp.on('Runtime.executionContextDestroyed', lambda e: ctxs.pop(e['executionContextId'], None))
    cdp.send('Runtime.enable')
    def vv_listeners():
        # Listener am visualViewport in der isolierten Welt der Erweiterung (dort registriert Kadri sie): genau
        # resize + scroll bei offenem Blatt, keine nach dem Schließen
        top = cdp.send('Page.getFrameTree')['frameTree']['frame']['id']
        cid = [c['id'] for c in ctxs.values() if c.get('origin', '').startswith('chrome-extension://') and c.get('auxData', {}).get('frameId') == top]
        if not cid: return None
        oid = cdp.send('Runtime.evaluate', {'expression': 'visualViewport', 'contextId': cid[-1]})['result']['objectId']
        return sorted(l['type'] for l in cdp.send('DOMDebugger.getEventListeners', {'objectId': oid})['listeners'] if l['type'] in ('resize', 'scroll'))
    def nav():
        h = cdp.send('Page.getNavigationHistory'); return h['currentIndex'], h['entries'][h['currentIndex']]['url'], len(h['entries'])
    def android_back():
        # Zurück-Taste: vom Browser ausgelöstes Zurück im Verlauf (nicht aus der Seite)
        h = cdp.send('Page.getNavigationHistory'); cdp.send('Page.navigateToHistoryEntry', {'entryId': h['entries'][h['currentIndex'] - 1]['id']})
    pg.goto(OTHER)
    pg.goto(PAGE)
    pg.wait_for_function('document.getElementById("v").currentTime > 0.8', timeout=20000)
    pg.evaluate('() => { document.getElementById("v").muted = false; }')
    check('Kadri-Oberfläche da, Shadow DOM geschlossen (von der Seite aus nicht erreichbar)',
          wait(lambda: pg.evaluate('() => { const h = document.querySelector("[data-kadri-test]"); return !!h && h.shadowRoot === null; }'), 15)
          and wait(lambda: bool([n for n in find(cdp, 'pb') if attrs(n).get('aria-label') == 'Video speichern']), 15))
    dl = lambda: [n for n in find(cdp, 'pb') if attrs(n).get('aria-label') == 'Video speichern'][0]
    pill_on = lambda: any('pill' in klass(n) and 'on' in klass(n) for n in shadow_nodes(cdp))
    def tap_dl():
        # ⬇ nur antippen, wenn der schwebende Knopf sichtbar ist (der kurze Testclip läuft in Schleife; beim Sprung an den
        # Anfang blendet Kadri den Knopf kurz aus – das ist bestehendes Verhalten, nicht Teil dieser Prüfung)
        wait(pill_on, 15)
        xy = None
        for _ in range(20):
            try: xy = center(cdp, dl()); break
            except Exception: time.sleep(0.15)
        tap(pg, xy)
    url0, pages0 = pg.url, len(ctx.pages)
    base = nav()
    VV0 = vv_listeners()   # Grundwert ohne Blatt (die Platzierung des schwebenden Knopfs hat ein eigenes Paar)
    VV1 = sorted((VV0 or []) + ['resize', 'scroll'])   # mit offenem Blatt: genau ein Paar mehr
    vw, vh = pg.evaluate('() => [innerWidth, innerHeight]')

    # ---------- Blatt öffnen: unten, große Einträge ----------
    tap_dl()
    check('Tipp auf ⬇ öffnet das Blatt', wait(lambda: bool(find(cdp, 'dli', 'Mit Helper herunterladen')), 15), [label(n) for n in find(cdp, 'dli')])
    sx0, sy0, sx1, sy1 = box(cdp, find(cdp, 'dlm')[0])
    check('Blatt am unteren Bildschirmrand, ganz sichtbar', abs(sy1 - vh) <= 2 and sy0 >= 0 and sx0 >= 0 and sx1 <= vw + 1, (sx0, sy0, sx1, sy1, vw, vh))
    hs = [box(cdp, n)[3] - box(cdp, n)[1] for n in find(cdp, 'dli')]
    check('alle Einträge mindestens 48 px hoch', hs and min(hs) >= 48, hs)
    ov = find(cdp, 'dlo')
    ob = box(cdp, ov[0]) if ov else None
    check('abgedunkelter Hintergrund über dem ganzen sichtbaren Bereich', bool(ob) and ob[0] <= 0 and ob[1] <= 0 and ob[2] >= vw - 1 and ob[3] >= vh - 1, ob)

    # ---------- im Blatt tippen und wischen: bleibt offen, startet nichts ----------
    tap(pg, center_of(cdp, 'dlh')); time.sleep(0.6)
    check('Tipp auf die Überschrift im Blatt schließt nicht', sheet_open(cdp))
    if not sheet_open(cdp): tap_dl(); wait(lambda: sheet_open(cdp), 10)
    c = center_of(cdp, 'dlm')
    if c: swipe(cdp, c[0], c[1] + 20, c[1] - 40); time.sleep(0.6)
    check('Wischen/Scrollen im Blatt schließt nicht', bool(c) and sheet_open(cdp))
    check('… und startet nichts', not helper_clip())

    # ---------- Außentipp, Zurück, „Schließen“ ----------
    if not sheet_open(cdp): tap_dl(); wait(lambda: sheet_open(cdp), 10)
    pos = lambda: pg.evaluate('() => [scrollX, scrollY, history.scrollRestoration]')
    before = pos()   # (manche Chromium-Fassungen scrollen beim Wischen im Blatt die Seite mit – das ist dann der Stand)
    tap(pg, (vw / 2, 20))
    check('Tipp auf den Hintergrund (außerhalb) schließt', wait(lambda: not sheet_open(cdp), 5))
    check('… ohne Start, ohne Navigation', not helper_clip() and pg.url == url0)
    # S3D-SHEET-BACK-141: das eigene Zurück nach dem Schließen darf die Seite nicht scrollen (Chromium 141 stellte den
    # Stand vom Öffnen wieder her; das Scrollen blendete ⬇ kurz aus, ein sofortiger Tipp ging an die Seite)
    tap_dl()   # sofort, ohne Pause
    check('… sofort wieder antippbar: Blatt öffnet (kein Scrollsprung durch das eigene Zurück)', wait(lambda: sheet_open(cdp), 5))
    check('… Seite nicht gescrollt, Scroll-Wiederherstellung der Seite unverändert (auto)', pos() == before and before[2] == 'auto', (pos(), before))
    check('offenes Blatt: genau ein eigener Verlaufseintrag, genau ein zusätzliches resize-/scroll-Listenerpaar', nav()[0] == base[0] + 1 and vv_listeners() == VV1, (nav(), base, vv_listeners(), VV0))
    android_back()
    check('Zurück-Taste schließt das Blatt', wait(lambda: not sheet_open(cdp), 5))
    time.sleep(0.8)
    check('… und bleibt auf der Seite (Video läuft weiter)', pg.url == url0 and nav()[:2] == base[:2] and pg.evaluate('() => !document.getElementById("v").paused'), (pg.url, nav(), base))
    check('… Zurück-Taste: Seite nicht gescrollt, Scroll-Wiederherstellung der Seite wieder auto', pos() == before, (pos(), before))

    # ---------- mehrfach öffnen und schließen: keine zusätzlichen Listener übrig, Verlauf unverändert ----------
    for i in range(3):
        tap_dl(); wait(lambda: sheet_open(cdp), 10)
        tap(pg, (vw / 2, 20)); wait(lambda: not sheet_open(cdp), 5)
    time.sleep(1.2)
    check('3× öffnen/schließen: keine zusätzlichen visualViewport-Listener übrig, Verlauf wie vorher, keine Navigation',
          vv_listeners() == VV0 and nav()[:2] == base[:2] and pg.url == url0, (vv_listeners(), VV0, nav(), base))

    # ---------- Seite mit eigener Scroll-Wiederherstellung "manual": bleibt unangetastet ----------
    pg.evaluate('() => { history.scrollRestoration = "manual"; }')
    tap_dl(); wait(lambda: sheet_open(cdp), 10)
    check('Seite mit "manual": während das Blatt offen ist unverändert', pg.evaluate('() => history.scrollRestoration') == 'manual')
    android_back()
    check('Seite mit "manual": Zurück-Taste schließt das Blatt', wait(lambda: not sheet_open(cdp), 5))
    time.sleep(0.8)
    tap_dl(); wait(lambda: sheet_open(cdp), 10)
    tap(pg, (vw / 2, 20)); wait(lambda: not sheet_open(cdp), 5)
    time.sleep(0.8)
    check('Seite mit "manual": nach Zurück-Taste und Außentipp weiter "manual", auf der Seite', pg.evaluate('() => history.scrollRestoration') == 'manual' and pg.url == url0 and nav()[:2] == base[:2], (pg.evaluate('() => history.scrollRestoration'), nav(), base))
    pg.evaluate('() => { history.scrollRestoration = "auto"; }')

    # ---------- schnell schließen und sofort wieder öffnen, dann Zurück-Taste ----------
    tap_dl(); wait(lambda: sheet_open(cdp), 10)
    tap(pg, (vw / 2, 20)); tap_dl()          # schließen und ohne Pause wieder öffnen (eigenes Zurück noch unterwegs)
    check('schnell wieder geöffnet', wait(lambda: sheet_open(cdp), 10))
    time.sleep(1.5)
    check('… danach genau ein eigener Verlaufseintrag (nicht vom ausstehenden Zurück verbraucht), ein Listenerpaar',
          sheet_open(cdp) and nav()[0] == base[0] + 1 and vv_listeners() == VV1, (nav(), base, vv_listeners(), VV0))
    android_back()
    check('… Zurück-Taste schließt das Blatt', wait(lambda: not sheet_open(cdp), 5))
    time.sleep(1.5)
    check('… keine unbeabsichtigte Navigation (vorherige Seite nicht erreicht, Verlauf wie vorher)',
          pg.url == url0 and nav()[:2] == base[:2] and vv_listeners() == VV0, (pg.url, nav(), base, vv_listeners(), VV0))
    tap_dl(); wait(lambda: sheet_open(cdp), 10)
    xc = center_of(cdp, 'dlx')
    if xc: tap(pg, xc)
    check('„Schließen“ schließt das Blatt', wait(lambda: not sheet_open(cdp), 5))
    time.sleep(0.8)
    check('… Seite unverändert', pg.url == url0 and not helper_clip())

    # ---------- „Mit Helper herunterladen“: genau ein Auftrag, kein Tab, keine Navigation ----------
    tap_dl()
    wait(lambda: bool(find(cdp, 'dli', 'Mit Helper herunterladen')), 15)
    xy = center_of(cdp, 'dli', 'Mit Helper herunterladen')
    check('Helfer-Eintrag im Blatt', bool(xy), [label(n) for n in find(cdp, 'dli')])
    if xy:
        tap(pg, xy)
        check('Tipp auf den Helfer-Eintrag schließt das Blatt erst nach dem Start', wait(lambda: not sheet_open(cdp), 5))
        check('… Helfer-Auftrag gestartet (Datei fertig beim Helfer)', wait(lambda: len(files(helper)) >= 1, 30), files(helper))
        tap(pg, xy); time.sleep(1.5)   # zweiter Tipp an dieselbe Stelle: Blatt ist zu, kein zweiter Start
        check('… genau eine Anfrage des Helfers, genau eine Datei', len(helper_clip()) == 1 and len(files(helper)) == 1, (len(helper_clip()), files(helper)))
        check('… kein neuer Tab, keine Navigation', len(ctx.pages) == pages0 and pg.url == url0, (len(ctx.pages), pg.url))

    # ---------- HLS: Stream-Eintrag → Qualität/Ton (Blatt wird ersetzt) → Start ----------
    pg.goto(HLSPAGE)
    pg.wait_for_function('document.getElementById("v").currentTime > 0.8', timeout=30000)
    pg.evaluate('() => { document.getElementById("v").muted = false; }')
    hbase, hurl = nav(), pg.url
    seg0 = len([x for x in HITS if not x['browser'] and x['path'].endswith('.m4s')])
    tap_dl()
    sxy = center_of(cdp, 'dli', 'Stream mit Helper herunterladen …', 15)
    check('HLS: Stream-Eintrag im Blatt', bool(sxy), [label(n) for n in find(cdp, 'dli')])
    if not sxy:   # S3g: nur Diagnose bei Fehlschlag (CI-only): Zustand von Knopf und Video, keine Änderung am Ablauf
        print('DIAG HLS-Blatt: pill_on=%s video=%s' % (pill_on(), pg.evaluate('() => { const v = document.getElementById("v"); '
              'return { t: +v.currentTime.toFixed(2), d: +v.duration.toFixed(2), paused: v.paused, ended: v.ended, muted: v.muted, rs: v.readyState, '
              'err: v.error && v.error.code, adb: v.webkitAudioDecodedByteCount, vdb: v.webkitVideoDecodedByteCount }; }')), flush=True)
    if sxy:
        tap(pg, sxy)
        check('HLS: Qualitätsauswahl erscheint (Blatt ersetzt)', wait(lambda: any(label(n).startswith('Stream') for n in find(cdp, 'dlh')), 20), [label(n) for n in find(cdp, 'dlh')])
        q = [n for n in find(cdp, 'dli') if 'dlx' not in klass(n) and 'info' not in klass(n)]
        check('… mit Qualitäts-Einträgen, ein eigener Verlaufseintrag, genau ein Listenerpaar (alte entfernt)',
              bool(q) and nav()[0] == hbase[0] + 1 and vv_listeners() == VV1, ([label(n) for n in q], nav(), hbase, vv_listeners(), VV0))
        if q:
            tap(pg, center(cdp, q[0]))
            check('HLS: Tipp auf die Qualität schließt das Blatt und startet den Helfer (Segmente)', wait(lambda: not sheet_open(cdp), 5)
                  and wait(lambda: len([x for x in HITS if not x['browser'] and x['path'].endswith('.m4s')]) > seg0, 30))
            time.sleep(1.2)
            check('… kein neuer Tab, keine Navigation, keine zusätzlichen Listener übrig', len(ctx.pages) == pages0 and pg.url == hurl and nav()[:2] == hbase[:2] and vv_listeners() == VV0,
                  (len(ctx.pages), nav(), hbase, vv_listeners(), VV0))

    # ---------- kleines Display: Blatt vollständig sichtbar und scrollbar ----------
    pg.set_viewport_size({'width': 320, 'height': 420}); time.sleep(0.8)
    tap_dl(); wait(lambda: sheet_open(cdp), 10)
    sx0, sy0, sx1, sy1 = box(cdp, find(cdp, 'dlm')[0])
    check('kleines Display: Blatt unten, vollständig im sichtbaren Bereich', sy0 >= 0 and abs(sy1 - 420) <= 2 and sx0 >= 0 and sx1 <= 321, (sx0, sy0, sx1, sy1))
    tap(pg, (160, 10))
    check('kleines Display: Außentipp schließt', wait(lambda: not sheet_open(cdp), 5))
    check('keine Seitenfehler', not errs, errs)
    ctx.close()
helper.stop()
msrv.shutdown()
shutil.rmtree(CLOSED, ignore_errors=True)
shutdown()
done()
