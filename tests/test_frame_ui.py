# Video in eingebetteten Fenstern (iframe, fremde Herkunft, auch verschachtelt): Knopf ▶/⬇ und Download-Auswahl stehen im
# HAUPTFENSTER am echten Bildschirm – nicht abgeschnitten im Kasten des Fensters. Video, Quellen und Download-Aufträge
# bleiben im Ursprungsfenster (die Helfer-App bekommt dessen Herkunft als Referer). Drei Herkünfte im echten Chromium:
#   Hauptseite  http://localhost:8793   ·  Zwischenebene  http://127.0.0.2:8794   ·  Video  http://127.0.0.1:8791
# Geprüft: Knopf und Auswahl ganz im sichtbaren Bereich der Hauptseite; im Fenster selbst keine eigene Oberfläche;
# alle HLS-Qualitäten per Scrollen erreichbar; ein Tipp startet genau einen Helfer-Auftrag aus dem richtigen Fenster;
# kein neuer Tab, keine Navigation; Zurück, „Schließen“ und Außentipp; mehrere Fenster → genau ein Knopf, kleine oder
# stumme (Werbe-)Fenster → keiner; Seite ohne iframe wie bisher.
#   HELPER_HOST_DIR=<Helper-Repository: tests/java/channel/build.sh OUT>   (vorher: node tools/build.js --test)
import os, re, time, threading, http.server, urllib.parse
from common import *   # noqa: E402

CLIP = open(os.path.join(WEB, 'clip.mp4'), 'rb').read()
HLSDIR = os.path.join(WEB, 'hls')
HITS = []
TOP, MID, VID = 'http://localhost:8793', 'http://127.0.0.2:8794', 'http://127.0.0.1:8791'
QUAL = [(256, 144), (426, 240), (640, 360), (854, 480), (1024, 576), (1280, 720), (1600, 900), (1920, 1080), (2560, 1440)]
HEAD = '<!doctype html><html><head><meta name=viewport content="width=device-width,initial-scale=1"><title>%s</title>'

def frame_tag(src, style):
    return '<iframe src="%s" allow="autoplay; fullscreen" allowfullscreen style="display:block;border:0;%s"></iframe>' % (src, style)
def page(path, q):
    if path == '/f/vid.html':   # das eingebettete Video (MP4 mit eigener Adresse je Fall)
        return (HEAD % 'Video' + '</head><body style="margin:0;background:#000"><video id=v muted autoplay playsinline loop src="/d/clip.mp4?c=%s" '
                'style="width:100%%;height:100vh;display:block;object-fit:contain"></video></body></html>') % q.get('c', '0')
    if path == '/f/hlsvid.html':
        return (HEAD % 'Stream' + '<script src="/hls.min.js"></script></head><body style="margin:0;background:#000"><video id=v muted autoplay playsinline '
                'style="width:100%;height:100vh;display:block"></video><script>const v=document.getElementById("v");const h=new Hls({startLevel:2});'
                'h.loadSource("/d/q/master.m3u8");h.attachMedia(v);h.on(Hls.Events.MANIFEST_PARSED,()=>v.play());</script></body></html>')
    if path == '/f/other.html':   # vorherige Seite im Verlauf
        return '<!doctype html><title>Vorher</title><p>vorherige Seite'
    if path == '/f/plain.html':   # Seite ohne iframe (Video direkt)
        return (HEAD % 'Ohne Fenster' + '</head><body style="margin:0;height:2000px"><video id=v muted autoplay playsinline loop src="/d/clip.mp4?c=plain" '
                'style="width:100%;display:block"></video></body></html>')
    if path == '/f/one.html':     # Hauptseite mit einem eingebetteten Player fremder Herkunft (Kasten 230 px hoch)
        return (HEAD % 'Eine Seite' + '</head><body style="margin:0;height:2000px;font:16px sans-serif"><h1 style="margin:0;height:120px">Film</h1>' +
                frame_tag(VID + '/f/vid.html?c=one', 'width:100%;height:230px') + '</body></html>')
    if path == '/f/nested.html':  # Hauptseite → Zwischenebene (andere Herkunft, mit Rand/Abstand) → Player
        return (HEAD % 'Verschachtelt' + '</head><body style="margin:0;height:1500px"><div style="height:90px"></div>' +
                frame_tag(MID + '/f/mid.html', 'width:100%;height:330px;border:6px solid #444;box-sizing:border-box;padding:4px') + '</body></html>')
    if path == '/f/mid.html':
        return (HEAD % 'Mitte' + '</head><body style="margin:0;background:#222"><div style="height:50px"></div>' +
                frame_tag(VID + '/f/vid.html?c=nested', 'width:340px;height:220px;margin-left:20px') + '</body></html>')
    if path == '/f/multi.html':   # zwei große Player, ein kleiner (Werbung) und ein großer stummer
        return (HEAD % 'Mehrere' + '</head><body style="margin:0">' +
                frame_tag(VID + '/f/vid.html?c=m1', 'width:100%;height:220px') + '<div style="height:12px"></div>' +
                frame_tag(VID + '/f/vid.html?c=m2', 'width:100%;height:260px') +
                frame_tag(VID + '/f/vid.html?c=ad', 'width:120px;height:80px') +
                frame_tag(VID + '/f/vid.html?c=mute', 'width:100%;height:200px') + '</body></html>')
    if path == '/f/oddvid.html':   # HLS wie bei manchen Playern: Listen ohne Endung (text/plain), Stücke als Bilder getarnt
        return (HEAD % 'Getarnt' + '<script src="/hls.min.js"></script></head><body style="margin:0;background:#000"><video id=v muted autoplay playsinline '
                'style="width:100%;height:100vh;display:block"></video><script>const v=document.getElementById("v");const h=new Hls();'
                'h.loadSource("/d/odd/main");h.attachMedia(v);h.on(Hls.Events.MANIFEST_PARSED,()=>v.play());</script></body></html>')
    if path == '/f/odd.html':
        return (HEAD % 'Getarnte Seite' + '</head><body style="margin:0"><div style="height:60px"></div>' +
                frame_tag(VID + '/f/oddvid.html', 'width:100%;height:220px') + '</body></html>')
    if path == '/f/hls.html':
        return (HEAD % 'Stream-Seite' + '</head><body style="margin:0"><div style="height:60px"></div>' +
                frame_tag(VID + '/f/hlsvid.html', 'width:100%;height:220px') + '</body></html>')
    return None

class M(http.server.BaseHTTPRequestHandler):
    def log_message(self, *a): pass
    def do_GET(self):
        u = urllib.parse.urlparse(self.path); q = dict(urllib.parse.parse_qsl(u.query))
        browser = bool(self.headers.get('Sec-Fetch-Mode'))
        HITS.append({'path': u.path, 'q': u.query, 'browser': browser, 'ref': self.headers.get('Referer', ''), 'port': self.server.server_address[1]})
        html = page(u.path, q)
        if html is not None: body, ctype = html.encode(), 'text/html; charset=utf-8'
        elif u.path == '/d/clip.mp4': body, ctype = CLIP, 'video/mp4'
        elif u.path == '/hls.min.js': body, ctype = open(os.path.join(WEB, 'hls.min.js'), 'rb').read(), 'text/javascript'
        elif u.path == '/d/q/master.m3u8':   # neun Qualitäten (dieselben Stücke, eigene Listen je Qualität)
            body = ('#EXTM3U\n#EXT-X-VERSION:7\n' + ''.join('#EXT-X-STREAM-INF:BANDWIDTH=%d,RESOLUTION=%dx%d\nv%d/index.m3u8\n' % (200000 + 300000 * i, w, h, i)
                                                     for i, (w, h) in enumerate(QUAL))).encode(); ctype = 'application/vnd.apple.mpegurl'
        elif u.path == '/d/odd/main':
            body, ctype = b'#EXTM3U\n#EXT-X-VERSION:7\n#EXT-X-STREAM-INF:BANDWIDTH=400000,RESOLUTION=640x360\nv/main\n', 'text/plain'
        elif u.path == '/d/odd/v/main':
            body = open(os.path.join(HLSDIR, 'index.m3u8')).read().replace('.m4s', '.jpg').replace('init.mp4', 'init.png').encode(); ctype = 'text/plain'
        elif re.match(r'^/d/odd/v/(seg\d+\.jpg|init\.png)$', u.path):
            f = u.path.split('/')[-1].replace('.jpg', '.m4s').replace('init.png', 'init.mp4')
            body, ctype = open(os.path.join(HLSDIR, f), 'rb').read(), ('image/png' if f == 'init.mp4' else 'image/jpeg')
        elif re.match(r'^/d/q/v\d/index\.m3u8$', u.path):
            body, ctype = open(os.path.join(HLSDIR, 'index.m3u8'), 'rb').read(), 'application/vnd.apple.mpegurl'
        elif re.match(r'^/d/q/v\d/(seg\d+\.m4s|init\.mp4)$', u.path):
            body, ctype = open(os.path.join(HLSDIR, u.path.split('/')[-1]), 'rb').read(), 'video/mp4'
        else:
            self.send_response(404); self.send_header('Content-Length', '0'); self.end_headers(); return
        etag = '"kadri-frame-%d"' % len(body)
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
SRVS = []
for host, port in (('127.0.0.1', 8791), ('127.0.0.1', 8793), ('127.0.0.2', 8794)):
    s = http.server.ThreadingHTTPServer((host, port), M); s.daemon_threads = True; SRVS.append(s)
    threading.Thread(target=s.serve_forever, daemon=True).start()

def helper_hits(pred): return [x for x in HITS if not x['browser'] and pred(x)]
def files(h): return h.cmd('dl-files').split(' ')[1:]
def wait(pred, secs=10):
    end = time.time() + secs
    while time.time() < end:
        try:
            if pred(): return True
        except Exception: pass
        time.sleep(0.15)
    return False
def tap(pg, xy): pg.touchscreen.tap(xy[0], xy[1])

# Oberfläche (Test-Bau: offenes Shadow DOM) – im Hauptfenster bzw. in einem Fenster
UI = '(() => { const h = document.querySelector("[data-kadri-test]"); return h && h.shadowRoot; })()'
def js(sel): return '() => { const r = %s; if (!r) return null; %s }' % (UI, sel)
RECT = 'const b = e.getBoundingClientRect(); return [b.left, b.top, b.right, b.bottom];'
def ui_rect(fr, css): return fr.evaluate(js('const e = r.querySelector(%r); if (!e) return null; %s' % (css, RECT)))
def pill_on(fr): return bool(fr.evaluate(js('return !!r.querySelector(".pill.on");')))
def sheet_open(fr): return bool(fr.evaluate(js('return !!r.querySelector(".dlo");')))
def items(fr): return fr.evaluate(js('return Array.from(r.querySelectorAll(".dlm .dli")).map((b) => [b.firstChild.textContent, b.querySelector("small") ? b.querySelector("small").textContent : "", b.className]);')) or []
def item_rect(fr, text):
    return fr.evaluate(js('const e = Array.from(r.querySelectorAll(".dlm .dli")).find((b) => b.firstChild.textContent === %s); if (!e) return null; %s' % (repr(text).replace("'", '"'), RECT)))
def center(rc): return ((rc[0] + rc[2]) / 2, (rc[1] + rc[3]) / 2)
def beside(p, v, tol=2):   # Knopf am Video: Standard „unter dem Video“ (rechts), sonst am unteren Rand im Video
    return p and v and p[0] >= v[0] - tol and p[2] <= v[2] + tol and v[3] - 70 <= p[1] <= v[3] + 8 + tol
def inside(a, b, tol=1.5): return a and b and a[0] >= b[0] - tol and a[1] >= b[1] - tol and a[2] <= b[2] + tol and a[3] <= b[3] + tol
def frames_of(pg, part): return [f for f in pg.frames if part in f.url]
def frame_ui_shown(f):   # zeigt das Fenster selbst einen Knopf oder eine Auswahl?
    try: return bool(f.evaluate(js('return !!(r.querySelector(".pill.on") || r.querySelector(".dlo"));')))
    except Exception: return False
def unmute(f):
    f.wait_for_function('document.getElementById("v") && document.getElementById("v").currentTime > 0.5', timeout=25000)
    f.evaluate('() => { document.getElementById("v").muted = false; }')

helper = ChannelHelper()
check('echter Kanal-Helfer mit MP4- und HLS-Engine', helper.ready.startswith('READY') and helper.cmd('downloads 8791') == 'DOWNLOADS on' and helper.cmd('hls on') == 'HLS on')
with sync_playwright() as p:
    ctx, sw, udir = launch(p)
    ext_id = sw.url.split('/')[2]
    check('Kopplung über die Einstellungsseite', pair_helper(ctx, ext_id, helper) == 'Verbunden')
    # Was Seitenskripte (Hauptwelt) an Fenster-Nachrichten sehen – darin darf nie eine Adresse stehen
    ctx.add_init_script('window.__seen = []; addEventListener("message", (e) => { try { window.__seen.push(JSON.stringify(e.data)); } catch (x) {} });')
    pg = ctx.pages[0] if ctx.pages else ctx.new_page()
    errs = []; pg.on('pageerror', lambda e: errs.append(str(e)))
    cdp = ctx.new_cdp_session(pg)
    def nav():
        h = cdp.send('Page.getNavigationHistory'); return h['currentIndex'], h['entries'][h['currentIndex']]['url'], len(h['entries'])
    def android_back():
        h = cdp.send('Page.getNavigationHistory'); cdp.send('Page.navigateToHistoryEntry', {'entryId': h['entries'][h['currentIndex'] - 1]['id']})
    def tap_dl(fr=None):
        fr = fr or pg
        wait(lambda: pill_on(fr), 15)
        rc = None
        for _ in range(20):
            rc = ui_rect(fr, '.pill.on button[aria-label="Video speichern"]')
            if rc: break
            time.sleep(0.15)
        tap(pg, center(rc))

    # ---------- 1. Seite ohne iframe: wie bisher (Knopf am Video, Auswahl unten, keine Weiterleitung) ----------
    pg.goto(TOP + '/f/other.html'); pg.goto(VID + '/f/plain.html')
    unmute(pg.main_frame)
    vw, vh = pg.evaluate('() => [innerWidth, innerHeight]')
    VIEW = [0, 0, vw, vh]
    check('ohne iframe: Knopf erscheint am Video', wait(lambda: pill_on(pg), 15)); time.sleep(0.8)
    vr = pg.evaluate('() => { const b = document.getElementById("v").getBoundingClientRect(); return [b.left, b.top, b.right, b.bottom]; }')
    check('… Knopf am Video wie bisher (Standard: direkt darunter, rechts)', beside(ui_rect(pg, '.pill.on'), vr), (ui_rect(pg, '.pill.on'), vr))
    tap_dl()
    check('… ⬇ öffnet die Auswahl unten im Bildschirm', wait(lambda: any(l == 'Mit Helper herunterladen' for l, _, _ in items(pg)), 15) and abs(ui_rect(pg, '.dlm')[3] - vh) <= 2, items(pg))
    tap(pg, (vw / 2, 20))
    check('… Außentipp schließt', wait(lambda: not sheet_open(pg), 5))

    # ---------- 2. ein eingebetteter Player fremder Herkunft ----------
    pg.goto(TOP + '/f/one.html')
    base, url0, pages0 = nav(), pg.url, len(ctx.pages)
    vf = wait(lambda: frames_of(pg, '/f/vid.html'), 10) and frames_of(pg, '/f/vid.html')[0]
    unmute(vf)
    fr = pg.evaluate('() => { const b = document.querySelector("iframe").getBoundingClientRect(); return [b.left, b.top, b.right, b.bottom]; }')
    check('iframe: Knopf erscheint im HAUPTFENSTER', wait(lambda: pill_on(pg), 15)); time.sleep(0.8)
    pr = ui_rect(pg, '.pill.on')
    check('… ganz im sichtbaren Bereich, am Video im Fenster (darunter, außerhalb des Kastens)', inside(pr, VIEW) and beside(pr, fr) and pr[1] >= fr[3], (pr, fr, VIEW))
    time.sleep(0.8)
    check('… im Fenster selbst kein eigener Knopf (keine doppelte Oberfläche)', not frame_ui_shown(vf))
    tap_dl()
    check('⬇ im Hauptfenster öffnet die Auswahl des Fensters', wait(lambda: any(l == 'Mit Helper herunterladen' for l, _, _ in items(pg)), 15), items(pg))
    sr = ui_rect(pg, '.dlm')
    check('… Auswahl im Hauptfenster: ganz sichtbar, unten am Bildschirm, höher als der Kasten des Fensters möglich wäre',
          inside(sr, VIEW) and abs(sr[3] - vh) <= 2 and (sr[3] - sr[1]) > 0 and not inside(sr, fr), (sr, fr, vh))
    check('… im Fenster keine Auswahl', not frame_ui_shown(vf))
    hs = [r[3] - r[1] for r in pg.evaluate(js('return Array.from(r.querySelectorAll(".dlm .dli")).map((e) => { const b = e.getBoundingClientRect(); return [b.left, b.top, b.right, b.bottom]; });'))]
    check('… Einträge ≥ 48 px, Griff oben', hs and min(hs) >= 48 and bool(ui_rect(pg, '.dlm .dlg')), hs)
    tap(pg, (vw / 2, 20))
    check('Außentipp schließt', wait(lambda: not sheet_open(pg), 5))
    tap_dl(); wait(lambda: sheet_open(pg), 10)
    check('offene Auswahl: ein eigener Verlaufseintrag im Hauptfenster', nav()[0] == base[0] + 1, (nav(), base))
    android_back()
    check('Zurück-Taste schließt die Auswahl', wait(lambda: not sheet_open(pg), 5))
    time.sleep(1.0)
    check('… Seite bleibt (keine Navigation), Video im Fenster läuft weiter', pg.url == url0 and nav()[:2] == base[:2] and vf.evaluate('() => !document.getElementById("v").paused'), (pg.url, nav(), base))
    tap_dl(); wait(lambda: sheet_open(pg), 10)
    tap(pg, center(ui_rect(pg, '.dlm .dlx')))
    check('„Schließen“ schließt', wait(lambda: not sheet_open(pg), 5))
    time.sleep(0.8)
    tap_dl()
    wait(lambda: item_rect(pg, 'Mit Helper herunterladen'), 15)
    n0 = len(files(helper))
    tap(pg, center(item_rect(pg, 'Mit Helper herunterladen')))
    check('Tipp auf „Mit Helper herunterladen“: Auswahl zu, Helfer-Auftrag gestartet', wait(lambda: not sheet_open(pg), 5) and wait(lambda: len(files(helper)) > n0, 30), files(helper))
    time.sleep(1.5)
    hh = helper_hits(lambda x: x['path'] == '/d/clip.mp4' and x['q'] == 'c=one')
    check('… genau ein Auftrag (eine Anfrage der Helfer-App, eine Datei)', len(hh) == 1 and len(files(helper)) == n0 + 1, (len(hh), files(helper)))
    check('… aus dem Ursprungsfenster: Herkunft des Fensters als Referer (nicht die Hauptseite)', hh and hh[0]['ref'].startswith(VID + '/') and 'localhost' not in hh[0]['ref'], [x['ref'][:40] for x in hh])
    check('… kein neuer Tab, keine Navigation', len(ctx.pages) == pages0 and pg.url == url0 and nav()[:2] == base[:2], (len(ctx.pages), pg.url, nav()))
    seen = [m for f in [pg.main_frame] + frames_of(pg, '/f/vid.html') for m in (f.evaluate('() => window.__seen || []') or [])]
    check('Seitenskripte sehen nur Kennung und Zahlen (keine Adresse, kein Dateiname, kein Text der Auswahl)',
          any('__kadriFg1' in m for m in seen) and not [m for m in seen if '__kadriFg1' in m and re.search(r'://|mp4|clip|Helper|Speichern', m)],
          [m[:80] for m in seen if '__kadriFg1' in m][:2])
    check('… Hinweis der Helfer-App im Hauptfenster', wait(lambda: pg.evaluate(js('const t = r.querySelector(".toast.on"); return t ? t.textContent : "";')) != '', 4))

    # ---------- 2b. ▶ im Hauptfenster: Kadri-Player öffnet im Fenster, das Fenster füllt den Bildschirm (bestehender Weg) ----------
    vf.evaluate('() => { document.getElementById("v").currentTime = 0; }')
    wait(lambda: pill_on(pg), 15)
    tap(pg, center(ui_rect(pg, '.pill.on button[aria-label="Im Videoplayer öffnen"]')))
    check('▶ oben: Kadri-Player öffnet im Ursprungsfenster', wait(lambda: vf.evaluate(js('return !!r.querySelector(".vv");')), 15))
    full = lambda: pg.evaluate('() => { const b = document.querySelector("iframe").getBoundingClientRect(); return b.left <= 0 && b.top <= 0 && b.right >= innerWidth - 1 && b.bottom >= innerHeight - 1; }')
    check('… das Fenster liegt über dem ganzen Bildschirm (wie bisher)', wait(full, 10))
    hold = []
    for _ in range(10): hold.append(pill_on(pg)); time.sleep(0.2)
    check('… solange kein Knopf oben', not any(hold), hold)
    time.sleep(1.0)
    # Zurück-Taste: im Vollbild beendet sie das Vollbild (Android/Chrome) – Kadri schließt dann den Player; ohne Vollbild
    # geht sie über den Verlauf
    if pg.evaluate('() => !!document.fullscreenElement'): pg.evaluate('() => document.exitFullscreen()')
    else: android_back()
    check('… Zurück-Taste schließt den Player: Fenster wieder klein, Seite bleibt', wait(lambda: not full() and not vf.evaluate(js('return !!r.querySelector(".vv");')), 10) and pg.url == url0)
    vf.evaluate('() => { const v = document.getElementById("v"); v.currentTime = 0; v.play().catch(() => {}); }')
    check('… danach steht der Knopf wieder oben', wait(lambda: pill_on(pg), 10))

    # ---------- 3. verschachtelt: Hauptseite → Zwischenebene (fremd) → Player (fremd) ----------
    pg.goto(TOP + '/f/nested.html')
    vf = wait(lambda: frames_of(pg, '/f/vid.html'), 10) and frames_of(pg, '/f/vid.html')[0]
    mf = frames_of(pg, '/f/mid.html')[0]
    unmute(vf)
    check('verschachtelt: Knopf erscheint im Hauptfenster', wait(lambda: pill_on(pg), 15))
    outer = pg.evaluate('() => { const f = document.querySelector("iframe"), b = f.getBoundingClientRect(); return [b.left + 6 + 4, b.top + 6 + 4]; }')   # Rand + Abstand
    inner = mf.evaluate('() => { const b = document.querySelector("iframe").getBoundingClientRect(); return [b.left, b.top, b.right, b.bottom]; }')
    exp = [outer[0] + inner[0], outer[1] + inner[1], outer[0] + inner[2], outer[1] + inner[3]]
    time.sleep(1.0)
    pr = ui_rect(pg, '.pill.on')
    check('… am Video der inneren Ebene (Lage über beide Ebenen umgerechnet), ganz sichtbar', beside(pr, exp) and inside(pr, VIEW), (pr, exp))
    check('… in keiner Ebene eine eigene Oberfläche', not frame_ui_shown(vf) and not frame_ui_shown(mf))
    tap_dl()
    check('… ⬇ öffnet die Auswahl im Hauptfenster', wait(lambda: item_rect(pg, 'Mit Helper herunterladen'), 15) and inside(ui_rect(pg, '.dlm'), VIEW), items(pg))
    n0 = len(files(helper))
    tap(pg, center(item_rect(pg, 'Mit Helper herunterladen')))
    check('… Tipp startet genau einen Auftrag aus dem inneren Fenster', wait(lambda: len(files(helper)) > n0, 30) and
          len(helper_hits(lambda x: x['path'] == '/d/clip.mp4' and x['q'] == 'c=nested')) == 1 and
          helper_hits(lambda x: x['q'] == 'c=nested')[0]['ref'].startswith(VID + '/'), [x['ref'][:30] for x in helper_hits(lambda x: x['q'] == 'c=nested')])

    # ---------- 4. mehrere Fenster: genau ein Knopf; kleines und stummes Fenster nie ----------
    pg.goto(TOP + '/f/multi.html')
    wait(lambda: len(frames_of(pg, '/f/vid.html')) == 4, 10)
    fs = {re.search(r'c=(\w+)', f.url).group(1): f for f in frames_of(pg, '/f/vid.html')}
    for k in ('m1', 'm2', 'ad'): unmute(fs[k])
    fs['mute'].wait_for_function('document.getElementById("v").currentTime > 0.5', timeout=25000)
    check('mehrere Fenster: Knopf im Hauptfenster', wait(lambda: pill_on(pg), 15))
    big = pg.evaluate('() => { const b = document.querySelectorAll("iframe")[1].getBoundingClientRect(); return [b.left, b.top, b.right, b.bottom]; }')
    # (der Testclip hat keine Tonspur: Kadri wertet ihn nach 2 s als stumm und blendet den Knopf aus – darum alle an den
    # Anfang setzen und in den ersten 2 s beobachten)
    for k in ('m1', 'm2', 'ad'): fs[k].evaluate('() => { document.getElementById("v").currentTime = 0; }')
    time.sleep(0.7)
    samples = []
    for _ in range(8):   # nie zwei Knöpfe, nie einer in einem Fenster
        samples.append((pg.evaluate(js('return r.querySelectorAll(".pill.on").length;')), tuple(k for k, f in fs.items() if frame_ui_shown(f)), ui_rect(pg, '.pill.on')))
        time.sleep(0.15)
    check('… genau ein Knopf insgesamt (nie einer in einem der Fenster)', all(n == 1 and not sh for n, sh, _ in samples), [(n, sh) for n, sh, _ in samples])
    check('… am größten sichtbaren Video', all(beside(r, big) for n, _, r in samples if n == 1), [r for _, _, r in samples][:3] + [big])
    for k in ('m1', 'm2'): fs[k].evaluate('() => document.getElementById("v").pause()')
    time.sleep(2.5)
    check('nur noch kleines (Werbe-) und stummes Fenster laufen: nirgends ein Knopf', not pill_on(pg) and not [k for k, f in fs.items() if frame_ui_shown(f)],
          [k for k, f in fs.items() if frame_ui_shown(f)])

    # ---------- 4b. Hauptfenster ohne Kadri (Seite dort abgeschaltet): kontrollierter Rückfall auf die Oberfläche im Fenster ----------
    sw.evaluate('() => chrome.storage.local.set({ "gm:settings": { disabledSites: ["localhost"] } })')
    pg.goto(TOP + '/f/one.html')
    vf = wait(lambda: frames_of(pg, '/f/vid.html'), 10) and frames_of(pg, '/f/vid.html')[0]
    vf.evaluate('() => { document.getElementById("v").currentTime = 0; }'); unmute(vf); vf.evaluate('() => { document.getElementById("v").currentTime = 0; }')
    check('Hauptfenster antwortet nicht: das Fenster zeigt seinen eigenen Knopf (wie bisher), oben keiner',
          wait(lambda: frame_ui_shown(vf), 6) and not pg.evaluate('() => !!document.querySelector("[data-kadri-test]")'))
    sw.evaluate('() => chrome.storage.local.remove("gm:settings")')

    # ---------- 4c. Diagnose des Ursprungsfensters (lange auf ▶ oben): anonym, mit Fenster, Element, Quellen, Auswahl ----------
    ctx.grant_permissions(['clipboard-read', 'clipboard-write'])
    def long_press_play():
        rc = ui_rect(pg, '.pill.on button[aria-label="Im Videoplayer öffnen"]')
        x, y = center(rc)
        pg.evaluate('() => navigator.clipboard.writeText("-")')
        cdp.send('Input.dispatchTouchEvent', {'type': 'touchStart', 'touchPoints': [{'x': x, 'y': y}]}); time.sleep(1.0)
        cdp.send('Input.dispatchTouchEvent', {'type': 'touchEnd', 'touchPoints': []})
        got = ['']
        wait(lambda: got.__setitem__(0, pg.evaluate('() => navigator.clipboard.readText()')) or got[0].startswith('Kadri – anonymisierte Diagnose'), 8)
        return got[0]
    def diag_of(page_path, frame_part):
        pg.goto(TOP + page_path); pg.bring_to_front()
        vf = wait(lambda: frames_of(pg, frame_part), 10) and frames_of(pg, frame_part)[0]
        unmute(vf); vf.evaluate('() => { document.getElementById("v").currentTime = 0; }')
        wait(lambda: pill_on(pg), 15); time.sleep(0.6)
        return vf, long_press_play()
    # a) getarnte Quelle: dasselbe Bild wie auf dem Gerät („keine speicherbare Videodatei“)
    vf, dg = diag_of('/f/odd.html', '/f/oddvid.html')
    tap_dl()
    check('getarnte Quelle (Listen ohne Endung, text/plain; Stücke als Bilder): Menü meldet „keine speicherbare Videodatei“ (Symptom nachgestellt)',
          wait(lambda: any('Keine speicherbare Videodatei' in l for l, _, _ in items(pg)), 15), items(pg))
    tap(pg, (vw / 2, 20)); wait(lambda: not sheet_open(pg), 5)
    check('lange auf ▶ oben: anonymisierte Diagnose des URSPRUNGSFENSTERS (eingebettet, Kadri dort nachgeladen, 1 Video)',
          'Fenster: eingebettet' in dg and 'Videos auf der Seite: 1' in dg and 'Fenster-Ebene 1 (Kadri hier nachgeladen)' in dg, dg[:600])
    check('… Mitleser aktiv, aber keine Liste gemeldet; Element spielt Blob (MSE)',
          'Mitleser in der Seite aktiv' in dg and 'gemeldete Listen 0' in dg and 'per Typ erkannt 0' in dg and 'Video-Element: Quelle blob' in dg, dg[:900])
    check('… Ladevorgänge nur nach Art:Endung – Listen ohne Endung und Stücke als Bilder sichtbar',
          re.search(r'xhr:ohne-endung ×\d', dg) and re.search(r'xhr:bild ×\d', dg) and 'xhr:liste' not in dg, [l for l in dg.split('\n') if l.startswith('Ladevorg')])
    check('… Quellen am Video und Auswahl samt Grund des Menüs', 'Quellen am Video (' in dg and 'Auswahl Stream: -' in dg and 'Hinweis im Menü: Keine speicherbare Videodatei' in dg,
          [l for l in dg.split('\n') if 'Auswahl' in l or 'Quellen am' in l])
    check('… anonym: keine Adresse, kein Host, kein Pfad, kein Seitentitel', not re.search(r'://|127\.0\.0|localhost|/d/|/f/|oddvid|Getarnt', dg), dg)
    # b) Gegenprobe normaler HLS-Stream im Fenster: Liste gemeldet, gebunden, angeboten
    vf, dg2 = diag_of('/f/hls.html', '/f/hlsvid.html')
    check('Gegenprobe normaler Stream: Listen gemeldet, Ladevorgänge „liste“, Stream angeboten (attemptable)',
          re.search(r'gemeldete Listen [1-9]', dg2) and 'xhr:liste' in dg2 and re.search(r'Auswahl Stream: [^\n]*attemptable ×\d', dg2) and 'Hinweis im Menü' not in dg2,
          [l for l in dg2.split('\n') if 'Listen' in l or 'Auswahl' in l or 'Ladevorg' in l])
    check('… ebenfalls anonym', not re.search(r'://|127\.0\.0|localhost|/d/|/f/|hlsvid|Stream-Seite', dg2), dg2)
    check('… Grund der Quellenauswahl bleibt lesbar (stream-not-supported nicht als Kennung entfernt)', 'unavailable(stream-not-supported)' in dg2 and '[entfernt]' not in dg2,
          [l for l in dg2.split('\n') if 'Download ' in l][:2])
    # c) Diagnose über das Kadri-Symbol läuft im Hauptfenster: sagt, dass das Video in einem eingebetteten Fenster läuft und wo
    #    dessen Diagnose zu bekommen ist
    tab = sw.evaluate('async () => (await chrome.tabs.query({})).find((t) => /\\/f\\/hls\\.html/.test(t.url)).id')
    sw.evaluate('(t) => chrome.tabs.sendMessage(t, { t: "kadri-menu" }, { frameId: 0 })', tab)
    wait(lambda: pg.evaluate(js('return !!r.querySelector(".diag .danon");')), 8)
    pg.evaluate('() => navigator.clipboard.writeText("-")')
    pg.evaluate(js('r.querySelector(".diag .danon").click(); return true;'))
    dt = ['']
    wait(lambda: dt.__setitem__(0, pg.evaluate('() => navigator.clipboard.readText()')) or dt[0].startswith('Kadri – anonymisierte Diagnose'), 8)
    check('Diagnose über das Kadri-Symbol (Hauptseite): verweist auf das Video im eingebetteten Fenster und den langen Druck auf ▶',
          'Fenster: Hauptseite' in dt[0] and 'Video in eingebettetem Fenster: 1 – dessen Diagnose: lange auf ▶ drücken' in dt[0], dt[0][:400])
    pg.evaluate(js('const b = Array.from(r.querySelectorAll(".diag button")).find((x) => x.textContent === "Schließen"); if (b) b.click(); return true;'))

    # ---------- 5. HLS im Fenster, kleines Display: alle Qualitäten per Scrollen erreichbar, genau ein Auftrag ----------
    pg.set_viewport_size({'width': 360, 'height': 460}); vw, vh = 360, 460; VIEW = [0, 0, vw, vh]
    pg.goto(TOP + '/f/hls.html')
    base, url0 = nav(), pg.url
    vf = wait(lambda: frames_of(pg, '/f/hlsvid.html'), 10) and frames_of(pg, '/f/hlsvid.html')[0]
    unmute(vf)
    tap_dl()
    check('HLS im Fenster: Stream-Eintrag in der Auswahl des Hauptfensters', wait(lambda: item_rect(pg, 'Stream mit Helper herunterladen …'), 20), items(pg))
    tap(pg, center(item_rect(pg, 'Stream mit Helper herunterladen …')))
    check('… Qualitätsauswahl erscheint im Hauptfenster', wait(lambda: len([i for i in items(pg) if re.match(r'^\d+p$', i[0])]) == len(QUAL), 25), items(pg))
    q = [i for i in items(pg) if re.match(r'^\d+p$', i[0])]
    check('… Hauptzeile nur die Qualität, Ton/Laufzeit/Datenrate gedämpft darunter', q and all('Ton' in s and 'kbit/s' in s for _, s, _ in q), q[:3])
    sr = ui_rect(pg, '.dlm')
    check('… Auswahl ganz im sichtbaren Bereich (kleines Display)', inside(sr, VIEW), (sr, VIEW))
    last = q[-1][0]
    lr = item_rect(pg, last)
    check('… nicht alle Qualitäten passen auf einmal (Liste scrollt)', lr[3] > ui_rect(pg, '.dlm .dll')[3] + 1, (lr, ui_rect(pg, '.dlm .dll')))
    pg.evaluate(js('const l = r.querySelector(".dlm .dll"); l.scrollTop = l.scrollHeight; return true;'))
    time.sleep(0.4)
    lr = item_rect(pg, last)
    check('… nach dem Scrollen ist die letzte Qualität ganz sichtbar', inside(lr, ui_rect(pg, '.dlm .dll')) and inside(lr, VIEW), (lr, ui_rect(pg, '.dlm .dll')))
    check('… „Schließen“ bleibt beim Scrollen sichtbar', inside(ui_rect(pg, '.dlm .dlx'), VIEW))
    seg0 = len(helper_hits(lambda x: x['path'].endswith('.m4s')))
    tap(pg, center(lr))
    check('Tipp auf die Qualität: Auswahl zu, Helfer lädt Stücke', wait(lambda: not sheet_open(pg), 5) and wait(lambda: len(helper_hits(lambda x: x['path'].endswith('.m4s'))) > seg0, 30))
    time.sleep(2.0)
    segs = helper_hits(lambda x: x['path'].endswith('.m4s'))[seg0:]
    variants = sorted(set(x['path'].split('/')[3] for x in segs))
    want = ['v%d' % [h for _, h in QUAL].index(int(last[:-1]))]
    check('… genau ein Auftrag: Stücke genau der gewählten Qualität (%s)' % last, variants == want, (variants, want))
    check('… aus dem Ursprungsfenster (Referer = Herkunft des Fensters)', segs and all(x['ref'].startswith(VID + '/') for x in segs), sorted(set(x['ref'][:30] for x in segs)))
    check('… kein neuer Tab, keine Navigation', len(ctx.pages) == pages0 and pg.url == url0 and nav()[:2] == base[:2], (len(ctx.pages), nav(), base))
    check('keine Seitenfehler', not errs, errs)
    ctx.close()
helper.stop()
for s in SRVS: s.shutdown()
shutdown()
done()
