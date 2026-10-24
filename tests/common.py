# Gemeinsames für die Tests der Erweiterung: Webserver mit den Testseiten, nachgebaute Helfer-App,
# Chromium mit geladener Erweiterung (dist/test – wie dist/chrome, nur mit offenem Shadow-DOM).
import http.server, threading, functools, json, os, re, sys, tempfile, time, urllib.parse
from playwright.sync_api import sync_playwright

HERE = os.path.dirname(os.path.abspath(__file__))
WEB = os.path.join(HERE, 'web')
EXT = os.environ.get('KADRI_EXT') or os.path.join(HERE, '..', 'dist', 'test')
PORT = 8790
B = 'http://127.0.0.1:%d/' % PORT
R = 'document.querySelector("[data-kadri-test]").shadowRoot'   # Oberfläche des Players (nur im Test-Bau offen)

results = []
SECRET_HITS = []   # Anfragen an /secret (darf Kadri über eine Weiterleitung nie erreichen)
def check(name, ok, info=''):
    results.append(bool(ok))
    print(('OK   ' if ok else 'FAIL ') + name + ('  – ' + str(info) if info != '' else ''), flush=True)
def done():
    print('ERGEBNIS: %d von %d' % (sum(results), len(results)), flush=True)

# ---------- Webserver (mit Range – Videos sollen springen können) ----------
class Q(http.server.SimpleHTTPRequestHandler):
    def log_message(self, *a): pass
    def end_headers(self):
        self.send_header('Cache-Control', 'no-store')
        if 'nopip' in self.path:   # wie Facebook: Bild-in-Bild für die ganze Seite verboten (andere Verbote bleiben)
            self.send_header('Permissions-Policy', 'picture-in-picture=(), camera=()')
        super().end_headers()
    def send_head(self):
        # Weiterleitung ins eigene Netz (für den Schutz-Test): öffentliche Adresse → 127.0.0.1
        p0 = self.path.split('?')[0]
        if p0 == '/redir-lan':
            self.send_response(302); self.send_header('Location', 'http://127.0.0.1:%d/secret' % PORT); self.send_header('Content-Length', '0'); self.end_headers()
            return None
        if p0 == '/secret':
            SECRET_HITS.append(self.headers.get('Host', ''))
        # /stream/…: dieselben Dateien wie hls/, aber die Haupt-Liste OHNE Endung (nur am Content-Type erkennbar)
        p0 = self.path.split('?')[0]
        if p0.startswith('/stream/'):
            # (auch die Unter-Liste ohne Endung: „index“ statt „index.m3u8“)
            name = p0[len('/stream/'):] or 'master'
            lists = {'master': 'master.m3u8', 'index': 'index.m3u8'}
            fn = os.path.join(WEB, 'hls', lists.get(name, name))
            if not os.path.isfile(fn): self.send_error(404); return None
            body = open(fn, 'rb').read()
            if name in lists: body = body.replace(b'index.m3u8', b'index?q=1')
            ct = 'application/vnd.apple.mpegurl' if name in lists else self.guess_type(fn)
            self.send_response(200)
            self.send_header('Content-Type', ct); self.send_header('Content-Length', str(len(body))); self.end_headers()
            import io
            return io.BytesIO(body)
        path = self.translate_path(self.path.split('?')[0])
        rng = self.headers.get('Range')
        if not rng or not os.path.isfile(path): return super().send_head()
        size = os.path.getsize(path)
        m = re.match(r'bytes=(\d*)-(\d*)', rng)
        start = int(m.group(1) or 0); end = min(int(m.group(2)) if m.group(2) else size - 1, size - 1)
        f = open(path, 'rb'); f.seek(start)
        self.send_response(206)
        self.send_header('Content-Type', self.guess_type(path)); self.send_header('Accept-Ranges', 'bytes')
        self.send_header('Content-Range', 'bytes %d-%d/%d' % (start, end, size)); self.send_header('Content-Length', str(end - start + 1))
        self.end_headers(); self._rem = end - start + 1
        return f
    def copyfile(self, src, dst):
        rem = getattr(self, '_rem', None)
        if rem is None: return super().copyfile(src, dst)
        while rem > 0:
            c = src.read(min(65536, rem))
            if not c: break
            try: dst.write(c)
            except Exception: break
            rem -= len(c)
        self._rem = None
srv = http.server.ThreadingHTTPServer(('127.0.0.1', PORT), functools.partial(Q, directory=WEB))
threading.Thread(target=srv.serve_forever, daemon=True).start()

# ---------- nachgebaute Helfer-App (127.0.0.1:47811) ----------
helper = {'on': False, 'key': 'evp-1', 'calls': [], 'vol': 0.4, 'bright': 0.5, 'max': 15}
class H(http.server.BaseHTTPRequestHandler):
    def log_message(self, *a): pass
    def _send(self, code, body, ctype='application/json'):
        b = body.encode('utf-8')
        self.send_response(code); self.send_header('Content-Type', ctype); self.send_header('Content-Length', str(len(b))); self.end_headers()
        self.wfile.write(b)
    def do_GET(self):
        u = urllib.parse.urlparse(self.path); q = dict(urllib.parse.parse_qsl(u.query))
        if u.path == '/pair':   # Koppel-Seite: das Skript liest den Schlüssel aus dem #-Teil
            self._send(200, '<!doctype html><html><body><p id="evp-pair">…</p></body></html>', 'text/html; charset=utf-8'); return
        if not helper['on'] or self.headers.get('X-EVP-Key') != helper['key']:
            self._send(403, '{"ok":false}'); return
        helper['calls'].append((u.path, q.get('v'), self.headers.get('X-EVP-Key')))
        if u.path == '/vol' and 'v' in q: helper['vol'] = round(float(q['v']) * helper['max']) / helper['max']
        if u.path == '/bright' and 'v' in q: helper['bright'] = float(q['v'])
        self._send(200, json.dumps({'ok': True, 'overlay': True, 'write': False, 'dl': True, 'proxy': True, 'dash': True,
                                    'vol': helper['vol'], 'volMax': helper['max'], 'bright': helper['bright']}))
    do_POST = do_GET
hsrv = http.server.ThreadingHTTPServer(('127.0.0.1', 47811), H)
threading.Thread(target=hsrv.serve_forever, daemon=True).start()
def hcalls(path): return [c for c in helper['calls'] if c[0] == path]

# ---------- Chromium mit der Erweiterung ----------
def launch(p, user_dir=None, extra_args=None):
    user_dir = user_dir or tempfile.mkdtemp(prefix='kadri-')
    ctx = p.chromium.launch_persistent_context(
        user_dir, headless=False,
        args=['--disable-extensions-except=' + EXT, '--load-extension=' + EXT, '--autoplay-policy=no-user-gesture-required'] + (extra_args or []),
        viewport={'width': 400, 'height': 800}, is_mobile=True, has_touch=True, device_scale_factor=2, locale='de-DE')
    # Hintergrund der Erweiterung abwarten (startet manchmal erst spät – dann einmal eine Seite öffnen und weiter warten)
    sw = ctx.service_workers[0] if ctx.service_workers else None
    for i in range(2):
        if sw: break
        try: sw = ctx.wait_for_event('serviceworker', timeout=15000)
        except Exception:
            if i: raise
            pg = ctx.pages[0] if ctx.pages else ctx.new_page()
            pg.goto(B + 'direct.html'); sw = ctx.service_workers[0] if ctx.service_workers else None
    return ctx, sw, user_dir

def open_player(pg, url):
    pg.goto(url)
    pg.wait_for_function('document.getElementById("v").currentTime > 0.8', timeout=20000)
    pg.evaluate('() => { document.getElementById("v").muted = false; }'); time.sleep(1.0)
    pg.wait_for_function('() => { const h = document.querySelector("[data-kadri-test]"); return h && h.shadowRoot && h.shadowRoot.querySelector("button[aria-label=\'Im Videoplayer öffnen\']"); }', timeout=15000)
    pg.evaluate('() => %s.querySelector("button[aria-label=\'Im Videoplayer öffnen\']").click()' % R)
    pg.wait_for_function('() => { const v = %s.querySelector(".vv"); return v && v.currentTime > 0.3; }' % R, timeout=25000)
    # (nahtloser Start: bis die eigene Kopie aufgeholt hat, läuft die Seite sichtbar weiter – dann still)
    try: pg.wait_for_function('() => !%s.querySelector(".vbridge")' % R, timeout=12000)
    except Exception: pass
    time.sleep(0.6)

def settings(pg):
    """Einstellungen öffnen und die Einträge liefern: [(Name, Wert)]"""
    pg.evaluate('() => { const r = %s; r.querySelector(".vp").classList.add("ctl"); if (r.querySelector(".vmenu.on")) { r.querySelector(".vmenu").classList.remove("on"); r.querySelector(".vp").classList.remove("menu"); } r.querySelector("button[aria-label=Mehr]").click(); }' % R)
    time.sleep(0.35)
    pg.evaluate('() => Array.from(%s.querySelectorAll(".vmenu.on .vmi")).find(b => b.firstChild.textContent === "Einstellungen").click()' % R)
    time.sleep(0.35)
    return pg.evaluate('() => Array.from(%s.querySelectorAll(".vmenu.on .vmi")).map(b => [b.firstChild.textContent, b.querySelector("small") ? b.querySelector("small").textContent : ""])' % R)
def pick(pg, label):
    return pg.evaluate('(l) => { const b = Array.from(%s.querySelectorAll(".vmenu.on .vmi")).find(b => b.firstChild.textContent === l); if (b) b.click(); return !!b; }' % R, label)
def close_menu(pg):
    pg.evaluate('() => { const r = %s; r.querySelector(".vmenu").classList.remove("on"); r.querySelector(".vp").classList.remove("menu"); }' % R)

def swipe(pg, x, y0, y1):
    pg.mouse.move(x, y0); pg.mouse.down(); pg.mouse.move(x, y1, steps=8); pg.mouse.up(); time.sleep(0.5)
def side(pg):
    return pg.evaluate('() => { const s = %s.querySelector(".vside"); return s ? [s.className, (s.querySelector("b") || {}).textContent || ""] : null; }' % R)

def shutdown():
    srv.shutdown(); hsrv.shutdown()
