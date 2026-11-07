# P4b: „Stream speichern …“ (HLS über die Helfer-App) im echten Chromium mit Kadri (dist/test) gegen den echten
# ChannelServer UND die echte HLS-Engine der Helper-App (Desktop-Harness; nur der Remux ist dort eine Nachbildung, das
# echte Umpacken prüfen die Helper-Tests). Medien: eigenes HLS-Testmaterial aus tests/web/hls (fMP4) von 127.0.0.1:8791.
# Geprüft: alter Helfer bietet nichts an (ehrlicher Hinweis); mit HLS: Eintrag nur nach Kopplung, nichts startet von
# selbst, Plan nur nach Tipp, Auswahl Qualität/Ton, Start, Fortschritt, fertige Datei; Stream mit nicht unterstütztem
# Format → klarer Grund, keine Datei; der Helfer sendet nie Cookies/Referer; keine Adresse in Hinweisen oder Menü.
#   HELPER_HOST_DIR=<Helper-Repository: tests/java/channel/build.sh OUT>
import http.server, threading, time, urllib.parse
from common import *

MHITS = []
HLSDIR = os.path.join(WEB, 'hls')
class M(http.server.BaseHTTPRequestHandler):
    def log_message(self, *a): pass
    def do_GET(self):
        u = urllib.parse.urlparse(self.path)
        browser = bool(self.headers.get('Sec-Fetch-Mode'))
        MHITS.append({'path': u.path, 'browser': browser, 'cookie': self.headers.get('Cookie', ''), 'auth': self.headers.get('Authorization', ''),
                      'ref': self.headers.get('Referer', '')})
        body, ctype = None, 'application/octet-stream'
        if u.path in ('/s/plain.html', '/s/vp9.html'):
            master = 'plain/master.m3u8' if u.path == '/s/plain.html' else 'vp9/master.m3u8'
            body = ('<!doctype html><html><head><meta name=viewport content="width=device-width,initial-scale=1"><title>HLS Stream Test</title>'
                    '<script src="/hls.min.js"></script></head><body style="margin:0"><video id=v muted autoplay playsinline style="width:100%;display:block"></video>'
                    '<script>const v=document.getElementById("v");const h=new Hls();h.loadSource("' + master + '?t=SECRET-T1");h.attachMedia(v);'
                    'h.on(Hls.Events.MANIFEST_PARSED,()=>v.play());</script></body></html>').encode(); ctype = 'text/html; charset=utf-8'
        elif u.path == '/hls.min.js':
            body = open(os.path.join(WEB, 'hls.min.js'), 'rb').read(); ctype = 'text/javascript'
        elif u.path in ('/s/plain/master.m3u8', '/s/vp9/master.m3u8'):
            # plain: dieselbe Liste OHNE CODECS-Angabe (Format prüft der Helfer erst beim Laden); vp9: wie sie ist (VP9/Opus)
            text = open(os.path.join(HLSDIR, 'master.m3u8')).read().replace('index.m3u8', '/s/media/index.m3u8?t=SECRET-T1')
            if u.path.startswith('/s/plain/'): text = re.sub(r',CODECS="[^"]*"', '', text)
            body = text.encode(); ctype = 'application/vnd.apple.mpegurl'
        elif u.path == '/s/media/index.m3u8':
            text = open(os.path.join(HLSDIR, 'index.m3u8')).read()
            text = re.sub(r'^(seg\d+\.m4s|init\.mp4)$', lambda m: m.group(1) + '?t=SECRET-T1', text, flags=re.M).replace('URI="init.mp4"', 'URI="init.mp4?t=SECRET-T1"')
            body = text.encode(); ctype = 'application/vnd.apple.mpegurl'
        elif re.match(r'^/s/media/(seg\d+\.m4s|init\.mp4)$', u.path):
            body = open(os.path.join(HLSDIR, u.path.split('/')[-1]), 'rb').read(); ctype = 'video/mp4'
        if body is None:
            self.send_response(404); self.send_header('Content-Length', '0'); self.end_headers(); return
        etag = '"kadri-hls-%d"' % len(body)
        if not browser and self.headers.get('Range') == 'bytes=0-0' and self.headers.get('If-Range') == etag:
            self.send_response(206); self.send_header('Content-Length', '1'); self.send_header('Content-Range', 'bytes 0-0/%d' % len(body)); self.send_header('ETag', etag)
            self.end_headers(); self.wfile.write(body[:1]); return
        self.send_response(200); self.send_header('Content-Type', ctype); self.send_header('Content-Length', str(len(body))); self.send_header('ETag', etag)
        self.send_header('Cache-Control', 'no-store'); self.send_header('Access-Control-Allow-Origin', '*'); self.end_headers()
        try: self.wfile.write(body)
        except Exception: pass
msrv = http.server.ThreadingHTTPServer(('127.0.0.1', 8791), M); msrv.daemon_threads = True
threading.Thread(target=msrv.serve_forever, daemon=True).start()
PAGE = 'http://127.0.0.1:8791/s/plain.html'
ITEM = 'Stream speichern …'

def dl_menu(pg):
    pg.evaluate('() => %s.querySelector("button[aria-label^=Herunterladen]").dispatchEvent(new MouseEvent("contextmenu", { bubbles: true }))' % R); time.sleep(0.4)
    return menu_items(pg)
def menu_items(pg):
    return pg.evaluate('() => Array.from(%s.querySelectorAll(".vmenu.on .vmi")).map(b => [b.firstChild.textContent, b.querySelector("small") ? b.querySelector("small").textContent : ""])' % R)
def menu_head(pg):
    return pg.evaluate('() => { const h = %s.querySelector(".vmenu.on .vmhead, .vmenu.on h3, .vmenu.on .vmh"); return h ? h.textContent : ""; }' % R)
def wait_menu(pg, pred, secs=15):
    end = time.time() + secs; items = []
    while time.time() < end:
        items = dl_menu(pg)
        if pred(items): return items
        close_menu(pg); time.sleep(0.6)
    return items
def watch_toasts(pg):
    pg.evaluate('''() => { const t = %s.querySelector(".toast"); window.__toasts = window.__toasts || [];
      new MutationObserver(() => window.__toasts.push(t.textContent)).observe(t, { childList: true, characterData: true, subtree: true }); }''' % R)
def toasts(pg): return pg.evaluate('() => window.__toasts || []')
def wait_toast(pg, text, secs=30):
    end = time.time() + secs
    while time.time() < end:
        if any(text in t for t in toasts(pg)): return True
        time.sleep(0.3)
    return False
def files(h): return h.cmd('dl-files').split(' ')[1:]
def wait_sub(pg, secs=15):
    """Nach dem Tipp auf „Stream speichern …“ erscheint (nach dem Plan des Helfers) die Auswahl."""
    end = time.time() + secs
    while time.time() < end:
        items = menu_items(pg)
        if items and any(' · ' in l for l, _ in items) and not any(l == ITEM for l, _ in items): return items
        time.sleep(0.3)
    return menu_items(pg)
helper_hits = lambda: [x for x in MHITS if not x['browser']]
def stop_worker(ctx, pg, sw):
    """Service Worker beenden (wie Chrome es tut): Zwischenspeicher der Fähigkeiten ist danach leer."""
    cdp = ctx.new_cdp_session(pg); versions = []
    cdp.on('ServiceWorker.workerVersionUpdated', lambda e: versions.extend(e.get('versions', [])))
    cdp.send('ServiceWorker.enable')
    for _ in range(100):
        if any(v.get('scriptURL') == sw.url and v.get('status') == 'activated' for v in versions): break
        pg.wait_for_timeout(50)
    c = [v for v in versions if v.get('scriptURL') == sw.url and v.get('status') == 'activated']
    if not c: return False
    cdp.send('ServiceWorker.stopWorker', {'versionId': c[-1]['versionId']}); return True

helper = ChannelHelper()
check('echter Kanal-Helfer mit Download-Engine', helper.ready.startswith('READY') and helper.cmd('downloads 8791') == 'DOWNLOADS on')
with sync_playwright() as p:
    ctx, sw, udir = launch(p)
    ext_id = sw.url.split('/')[2]
    pg = ctx.pages[0] if ctx.pages else ctx.new_page()
    errs = []; pg.on('pageerror', lambda e: errs.append(str(e)))
    check('Kopplung über die Einstellungsseite', pair_helper(ctx, ext_id, helper) == 'Verbunden')

    # ---------- alter Helfer ohne HLS: kein „Stream speichern“, ehrlicher Hinweis ----------
    open_player(pg, PAGE); watch_toasts(pg)
    items = wait_menu(pg, lambda it: any(l.startswith('Helfer-App: Stream') for l, _ in it))
    close_menu(pg)
    check('Helfer ohne HLS: kein Eintrag „%s“' % ITEM, not any(l == ITEM for l, _ in items), items)
    check('… Hinweis „Diese Helfer-App-Version speichert keine Streams“', any('speichert keine Streams' in sub for _, sub in items), items)
    check('… nichts beim Helfer angefragt', not helper_hits())
    pg.evaluate('() => %s.querySelector("button[aria-label=Schließen]").click()' % R); time.sleep(0.6)

    # ---------- Helfer mit HLS ----------
    check('HLS-Engine des Helfers an', helper.cmd('hls on') == 'HLS on')
    # (Fähigkeiten speichert der Hintergrund 60 s zwischen – hier wechselt der Helfer mitten im Lauf; Neustart wie ein App-Update)
    check('Service Worker neu (Fähigkeiten neu abfragen)', stop_worker(ctx, pg, sw))
    open_player(pg, PAGE); watch_toasts(pg)
    items = wait_menu(pg, lambda it: any(l == ITEM for l, _ in it), 20)
    check('Eintrag „%s“ im Download-Menü (gespielter Stream)' % ITEM, any(l == ITEM for l, _ in items), items)
    check('… Unterzeile: Qualität und Ton wählen, diese Wiedergabe', any(l == ITEM and 'Qualität und Ton' in s and 'diese Wiedergabe' in s for l, s in items), items)
    check('Menü öffnen fragt den Helfer noch nicht nach einem Plan', not helper_hits(), helper_hits())
    ok = pick(pg, ITEM)
    check('Tipp auf „%s“ ausgeführt' % ITEM, ok)
    sub = wait_sub(pg)
    check('Auswahl erscheint: Qualität und Ton je Option', any('360p' in l and 'Ton im Stream' in l for l, _ in sub), sub)
    check('… Hinweis: Format wird beim Laden geprüft (keine CODECS-Angabe)', any('Format wird beim Laden geprüft' in s for _, s in sub), sub)
    planned = [x['path'] for x in helper_hits()]
    check('Plan: der Helfer hat nur die Listen geladen (keine Segmente)', planned and all(x.endswith('.m3u8') for x in planned), planned)
    opt = next((l for l, _ in sub if '360p' in l), None)
    check('Tipp auf die Option startet', opt is not None and pick(pg, opt))
    check('Hinweis „Helfer-App lädt den Stream“', wait_toast(pg, 'Helfer-App lädt den Stream', 15), toasts(pg))
    check('Fertig: „Gespeichert in Download/Video-Assistent“', wait_toast(pg, 'Gespeichert in Download/Video-Assistent', 60), toasts(pg))
    fl = files(helper)
    check('… Datei beim Helfer (Name = Seitentitel)', any(f.startswith('HLS_Stream_Test.mp4:') for f in fl), fl)
    hh = helper_hits()
    check('… Helfer: Init + alle 12 Segmente einmal, ohne Cookie/Authorization/Referer',
          sum(1 for x in hh if x['path'].endswith('.m4s')) == 12 and all(not x['cookie'] and not x['auth'] and not x['ref'] for x in hh), len(hh))
    check('Keine Adresse oder Token in Hinweisen/Menü', not any('127.0.0.1' in t or 'SECRET' in t for t in toasts(pg)) and
          not any('SECRET' in l + s for l, s in menu_items(pg)))
    pg.evaluate('() => %s.querySelector("button[aria-label=Schließen]").click()' % R); time.sleep(0.6)

    # ---------- nicht unterstütztes Format (VP9/Opus laut Liste): klarer Grund, keine Datei ----------
    before = len(files(helper))
    open_player(pg, 'http://127.0.0.1:8791/s/vp9.html'); watch_toasts(pg)
    items = wait_menu(pg, lambda it: any(l == ITEM for l, _ in it), 20)
    check('VP9-Stream: Eintrag angeboten (Format prüft erst der Helfer)', any(l == ITEM for l, _ in items), items)
    pick(pg, ITEM)
    check('… Helfer lehnt beim Plan ab: „Kein unterstütztes Format (H.264/AAC)“', wait_toast(pg, 'Kein unterstütztes Format', 15), toasts(pg))
    check('… keine Datei, keine Segmente geladen', len(files(helper)) == before and not any(x['path'].endswith('.m4s') for x in helper_hits()[len(hh):]))
    check('keine Seitenfehler', not errs, errs)
    ctx.close()
helper.stop()
done()
