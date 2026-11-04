# Direkte MP4-Downloads über die Helfer-App (Phase C3) im echten Chromium mit Kadri (dist/test) gegen den echten
# ChannelServer UND die echte Download-Engine der Helper-App (Desktop-Harness, Download-Modus; nur die Android-Ablage
# ist ein Ordner). Medien von einem eigenen Testserver (127.0.0.1:8791, tests/web/clip.mp4 = VP9 in MP4).
# Geprüft: kein Eintrag ohne Kopplung; Start nur nach Tipp; öffentliche MP4; Fortschritt (Player-Menü, Kadri-Menü);
# Doppeltipp; Neustart des Service Workers; Abbruch; Verbindungsabbruch; Neustart des Helfers; Neustart des Browsers;
# fehlende Speicherberechtigung (Android 8–9); Seite mit Anmeldung (kontrollierter Fehler, nie Cookies); keine URL in
# Speicher, Hinweisen oder Menü; der alte Port bleibt unberührt.
#   HELPER_HOST_DIR=<Helper-Repository: tests/java/channel/build.sh OUT>
import http.server, threading, time, json, urllib.parse, html, base64
from common import *

# ---------- Medienserver (Range für den Browser; langsam nur für den Helfer = Anfragen ohne Sec-Fetch-Mode) ----------
CLIP = open(os.path.join(WEB, 'clip.mp4'), 'rb').read()
MHITS = []
BROWSER_GATES = {}  # path -> (request observed, release response); only for the loading-candidate regression
class M(http.server.BaseHTTPRequestHandler):
    def log_message(self, *a): pass
    def do_GET(self):
        u = urllib.parse.urlparse(self.path); q = dict(urllib.parse.parse_qsl(u.query))
        if u.path == '/c3-loading.html':
            # A different original resource prevents Chromium from reusing the original video's
            # decoded media cache for the own player, even with HTTP Cache-Control: no-store.
            # The real resolver discovers the separate candidate from page metadata.
            body = ('<!doctype html><meta name=viewport content="width=device-width,initial-scale=1">'
                    '<title>Loading candidate</title><body><video id=v muted autoplay playsinline loop '
                    'style="width:100%;display:block" src="data:video/mp4;base64,' + base64.b64encode(CLIP).decode() + '"></video>'
                    '<script type="application/ld+json">{"@type":"VideoObject","contentUrl":'
                    '"http://127.0.0.1:8791/videos/pending.mp4"}</script></body>').encode()
            self.send_response(200); self.send_header('Content-Type', 'text/html; charset=utf-8'); self.send_header('Content-Length', str(len(body))); self.end_headers()
            self.wfile.write(body); return
        if u.path == '/c3-iframe.html':
            ad = ('<iframe style="width:300px;height:170px" src="' + html.escape(q['ad'], quote=True) + '"></iframe>') if q.get('ad') else ''
            body = ('<!doctype html><title>Frame host</title><iframe allow="autoplay; fullscreen" style="width:100%;height:700px" src="' + html.escape(q['frame'], quote=True) + '"></iframe>' + ad).encode()
            self.send_response(200); self.send_header('Content-Type', 'text/html; charset=utf-8'); self.send_header('Content-Length', str(len(body))); self.end_headers()
            self.wfile.write(body); return
        if u.path == '/c3-ad.html':
            # Werbung in eigenem Fenster: eigenes Video mit eigener MP4 (darf nie dem Hauptvideo zugeordnet werden)
            body = ('<!doctype html><title>Ad</title><video muted autoplay loop playsinline style="width:100%" preload=auto>'
                    '<source src="http://127.0.0.1:8791/videos/ad.mp4" type="video/mp4" size="1080"></video>').encode()
            self.send_response(200); self.send_header('Content-Type', 'text/html; charset=utf-8'); self.send_header('Content-Length', str(len(body))); self.end_headers()
            self.wfile.write(body); return
        browser = bool(self.headers.get('Sec-Fetch-Mode'))
        MHITS.append({'path': u.path, 'query': u.query, 'browser': browser, 'cookie': self.headers.get('Cookie', ''), 'auth': self.headers.get('Authorization', ''), 'ref': self.headers.get('Referer', ''), 'range': self.headers.get('Range', '')})
        gate = BROWSER_GATES.get(u.path) if browser else None
        if gate:
            gate[0].set()
            if not gate[1].wait(15): return
        # Vergleichsabruf der Diagnose (Browser ohne Cookies/Referer, nur 1 Byte): hier wie ein Server, der ohne Sitzung 404 gibt
        if browser and q.get('anon404') == '1' and (self.headers.get('Range') or '') == 'bytes=0-0' and not self.headers.get('Referer') and not self.headers.get('Cookie'):
            self.send_response(404); self.send_header('Content-Length', '0'); self.end_headers(); return
        if not browser and q.get('missing') in ('404', '410'):
            self.send_response(int(q['missing'])); self.send_header('Content-Length', '0'); self.end_headers(); return
        if q.get('auth') == '1' and 'sess=' not in (self.headers.get('Cookie') or ''):
            self.send_response(403); self.send_header('Content-Length', '0'); self.end_headers(); return
        start, end, code = 0, len(CLIP) - 1, 200
        m = re.match(r'bytes=(\d*)-(\d*)$', self.headers.get('Range') or '')
        if m: start = int(m.group(1) or 0); end = min(int(m.group(2)) if m.group(2) else len(CLIP) - 1, len(CLIP) - 1); code = 206
        self.send_response(code)
        self.send_header('Content-Type', 'video/mp4'); self.send_header('Content-Length', str(end - start + 1)); self.send_header('ETag', '"kadri-clip-v1"')
        self.send_header('Accept-Ranges', 'bytes'); self.send_header('Cache-Control', 'no-store'); self.send_header('Access-Control-Allow-Origin', '*')
        if code == 206: self.send_header('Content-Range', 'bytes %d-%d/%d' % (start, end, len(CLIP)))
        self.end_headers()
        body = CLIP[start:end + 1]; rate = 0 if browser else int(q.get('rate', '0'))
        try:
            if not rate: self.wfile.write(body); return
            step = max(1024, rate // 10)
            for i in range(0, len(body), step): self.wfile.write(body[i:i + step]); self.wfile.flush(); time.sleep(0.1)
        except Exception: pass
msrv = http.server.ThreadingHTTPServer(('127.0.0.1', 8791), M); msrv.daemon_threads = True
threading.Thread(target=msrv.serve_forever, daemon=True).start()
helper_hits = lambda p: [x for x in MHITS if x['path'] == p and not x['browser']]
page = lambda src, login=False: B + 'mp4.html?' + ('login=1&' if login else '') + 'src=' + urllib.parse.quote(src)

ITEM = 'Mit der Helfer-App speichern'
def dl_menu(pg):
    pg.evaluate('() => %s.querySelector("button[aria-label^=Herunterladen]").dispatchEvent(new MouseEvent("contextmenu", { bubbles: true }))' % R); time.sleep(0.4)
    return pg.evaluate('() => Array.from(%s.querySelectorAll(".vmenu.on .vmi")).map(b => [b.firstChild.textContent, b.querySelector("small") ? b.querySelector("small").textContent : ""])' % R)
def wait_item(pg, pred, secs=12):
    end = time.time() + secs; items = []
    while time.time() < end:
        items = dl_menu(pg)
        if pred(items): return items
        close_menu(pg); time.sleep(0.5)
    return items
def start_item(pg, path, what):
    """Harte Startvoraussetzung vor jedem gestarteten Download: Eintrag vorhanden und Tipp tatsächlich ausgeführt.
    Fehlt etwas, wird das sofort als eigener Fehler mit redigierter Diagnose gemeldet (Zustand des Players, Menü,
    Prüfstand der Helfer-App) – statt erst als Folgefehler der nachgelagerten Prüfungen. Keine Adressen im Protokoll."""
    items = wait_item(pg, lambda it: any(l == ITEM for l, _ in it))
    shown = any(l == ITEM for l, _ in items)
    diag = '' if shown else player_diag(pg, path)   # Menü des letzten Versuchs ist noch offen
    close_menu(pg)
    check('%s: Startvoraussetzung – Eintrag „%s“ vorhanden' % (what, ITEM), shown, diag)
    if not shown: return False
    dl_menu(pg); ok = pick(pg, ITEM)
    check('%s: Startvoraussetzung – Tipp auf den Eintrag ausgeführt' % what, ok, '' if ok else player_diag(pg, path))
    return ok
def pick_sub(pg, label, part):
    """Eintrag mit genau diesem Namen, dessen Unterzeile part enthält (mehrere gleichnamige Einträge: Qualitäten)."""
    return pg.evaluate('([l, p]) => { const b = Array.from(%s.querySelectorAll(".vmenu.on .vmi")).find((b) => b.firstChild.textContent === l && (b.querySelector("small") || {}).textContent.includes(p)); if (b) b.click(); return !!b; }' % R, [label, part])
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
def player(pg, url):
    open_player(pg, url); watch_toasts(pg)
def close_player(pg):
    pg.evaluate('() => %s.querySelector("button[aria-label=Schließen]").click()' % R); time.sleep(0.6)
def files(h): return h.cmd('dl-files').split(' ')[1:]
def playing(pg):
    a = pg.evaluate('() => %s.querySelector(".vv").currentTime' % R); time.sleep(1.0)
    return pg.evaluate('() => %s.querySelector(".vv").currentTime' % R) > a + 0.5
def stop_worker(ctx, pg, sw):
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
    # ---------- ohne Kopplung: kein Helfer-Weg, nichts an den Helfer ----------
    player(pg, page('/videos/pub.mp4?sig=SECRET-A'))
    time.sleep(1.5)
    items = [l for l, _ in dl_menu(pg)]; close_menu(pg)
    check('ohne Kopplung: kein Eintrag „%s“, Browser-Wege wie bisher' % ITEM, ITEM not in items and 'Im Browser speichern' in items, items)
    check('… nichts beim Helfer angefragt', not [x for x in MHITS if not x['browser']] and files(helper) == [])
    close_player(pg)
    check('Kopplung über die Einstellungsseite', pair_helper(ctx, ext_id, helper) == 'Verbunden')

    # ---------- öffentliche MP4: Start nur nach Tipp ----------
    player(pg, page('/videos/pub.mp4?sig=SECRET-A'))
    items = wait_item(pg, lambda it: any(l == ITEM for l, _ in it)); close_menu(pg)
    check('gekoppelt: Eintrag „%s“ im Download-Menü' % ITEM, any(l == ITEM for l, _ in items), items)
    pg.evaluate('() => %s.querySelector("button[aria-label^=Herunterladen]").click()' % R); time.sleep(0.5)
    menu_items = pg.evaluate('() => Array.from(%s.querySelectorAll(".vmenu.on .vmi")).map(b => b.firstChild.textContent)' % R)
    check('Tipp auf ⬇ öffnet nur die Auswahl – kein automatischer Download', ITEM in menu_items and not helper_hits('/videos/pub.mp4'), menu_items)
    ok = pick(pg, ITEM)
    check('öffentliche MP4: Startvoraussetzung – Tipp auf den Eintrag ausgeführt', ok, '' if ok else player_diag(pg, '/videos/pub.mp4'))
    check('Tipp auf den Eintrag startet (Hinweis)', wait_toast(pg, 'Helfer-App', 5), toasts(pg))
    check('Fertig: Hinweis „Gespeichert in Download/Video-Assistent“', wait_toast(pg, 'Gespeichert in Download/Video-Assistent', 30), toasts(pg))
    check('… Datei beim Helfer, volle Größe, Name = Seitentitel', 'Testclip_MP4.mp4:%d' % len(CLIP) in files(helper), files(helper))
    hh = helper_hits('/videos/pub.mp4')
    check('… genau eine Anfrage des Helfers, ohne Cookie, Authorization, Referer', len(hh) == 1 and not hh[0]['cookie'] and not hh[0]['auth'] and not hh[0]['ref'], hh)
    check('… Video läuft weiter', playing(pg))
    # ---------- Seek-Vorschau (P0 Gerätetest D1): gekoppelt, fremde MP4, Modus „kleines Bild“ ----------
    # Getrennt geprüft: Vorschaubild beim Ziehen (zweites Video, kein Sprung des Videos) und der Sprung nach dem Loslassen.
    pg.evaluate('() => %s.querySelector(".vp").classList.add("ctl")' % R)
    bx = pg.evaluate('() => { const b = %s.querySelector(".vbar").getBoundingClientRect(); return [b.left, b.top, b.width, b.height]; }' % R)
    t_before = pg.evaluate('() => %s.querySelector(".vv").currentTime' % R)
    pg.mouse.move(bx[0] + bx[2] * 0.2, bx[1] + bx[3] / 2); pg.mouse.down()
    for i in range(25):
        pg.mouse.move(bx[0] + bx[2] * (0.2 + i * 0.024), bx[1] + bx[3] / 2); time.sleep(0.1)
    time.sleep(0.8)
    pv = pg.evaluate('''() => { const r = %s, p = r.querySelector(".vprev"), v = r.querySelector("video.vpv");
      return { cls: p.className, n: +(p.dataset.n || 0), pvReady: v ? v.readyState : -1, pvErr: v && v.error ? v.error.code : 0 }; }''' % R)
    check('Seek-Vorschau: beim Ziehen sichtbares Vorschaubild (kleines Bild, gekoppelter Helfer, fremde MP4)',
          'on' in pv['cls'] and 'img' in pv['cls'] and 'noimg' not in pv['cls'] and pv['n'] > 0 and not pv['pvErr'], pv)
    pg.mouse.up(); time.sleep(1.0)
    t_after = pg.evaluate('() => %s.querySelector(".vv").currentTime' % R)
    check('… Spulen selbst: nach dem Loslassen springt das Video (getrennt von der Vorschau)', abs(t_after - t_before) > 2, [t_before, t_after])
    close_player(pg)

    # ---------- sichtbare Seiten-Brücke ist noch keine geladene eigene MP4 ----------
    pg.goto('http://127.0.0.1:8791/c3-loading.html')
    pg.wait_for_function('document.getElementById("v").currentTime > 0.8', timeout=20000)
    pg.evaluate('() => { document.getElementById("v").muted = false; }')
    pg.wait_for_function('() => { const h = document.querySelector("[data-kadri-test]"); return h && h.shadowRoot && h.shadowRoot.querySelector("button[aria-label=\'Im Videoplayer öffnen\']"); }', timeout=15000)
    held, release = threading.Event(), threading.Event()
    BROWSER_GATES['/videos/pending.mp4'] = (held, release)
    try:
        pg.evaluate('() => %s.querySelector("button[aria-label=\'Im Videoplayer öffnen\']").click()' % R)
        check('Testaufbau: eigene MP4-Anfrage angehalten, Seite war bereits geladen', held.wait(5))
        items = dl_menu(pg); close_menu(pg)
        loading = pg.evaluate('() => %s.querySelector(".vv").readyState' % R)
        check('Ungeladener MP4-Kandidat: kein Helfer-Eintrag trotz sichtbarer Seiten-Brücke', loading == 0 and not any(l == ITEM for l, _ in items), [loading, items])
        check('… kein automatischer Helfer-Abruf', not helper_hits('/videos/pending.mp4'))
        release.set()
        pg.wait_for_function('() => %s.querySelector(".vv").readyState >= 2' % R, timeout=15000)
        items = wait_item(pg, lambda it: any(l == ITEM for l, _ in it)); close_menu(pg)
        check('Nach geladenem Videobild: Helfer-Eintrag erscheint ohne erneutes Öffnen', any(l == ITEM for l, _ in items), items)
        check('… auch dann nur Angebot, kein Download ohne Tipp', not helper_hits('/videos/pending.mp4'))
    finally:
        release.set(); BROWSER_GATES.pop('/videos/pending.mp4', None)
    close_player(pg)

    # ---------- Fortschritt, Doppeltipp, Kadri-Menü, Neustart des Service Workers, Abbruch ----------
    player(pg, page('/videos/slow.mp4?rate=30000&sig=SECRET-B'))
    wait_item(pg, lambda it: any(l == ITEM for l, _ in it)); close_menu(pg)
    dl_menu(pg)
    pg.evaluate('(l) => { const b = Array.from(%s.querySelectorAll(".vmenu.on .vmi")).find(b => b.firstChild.textContent === l); b.click(); b.click(); b.click(); }' % R, ITEM)
    time.sleep(3)
    check('Dreifachtipp: genau ein Download beim Helfer', len(helper_hits('/videos/slow.mp4')) == 1, len(helper_hits('/videos/slow.mp4')))
    it = wait_item(pg, lambda it: any(l.startswith('Helfer-App: Lädt') and '%' in s for l, s in it))
    check('Fortschritt im Player-Menü (Prozent, MB) und Abbrechen angeboten', any(l.startswith('Helfer-App: Lädt') and re.search(r'\d+ % · ', s) for l, s in it) and any(l == 'Download abbrechen' for l, _ in it), it)
    check('… statt „%s“ (kein zweiter Start möglich)' % ITEM, not any(l == ITEM for l, _ in it))
    close_menu(pg)
    pm = ctx.new_page(); pm.goto('chrome-extension://%s/popup.html' % ext_id)
    try: pm.wait_for_function('() => /Lädt/.test((document.getElementById("downloads") || {}).textContent || "") && /%/.test(document.getElementById("downloads").textContent)', timeout=10000)
    except Exception: pass
    ptxt = pm.text_content('#downloads') or ''
    check('Kadri-Menü: „Downloads über die Helfer-App“ mit Name und Fortschritt', 'Downloads über die Helfer-App' in ptxt and 'Testclip MP4' in ptxt and '%' in ptxt, ptxt)
    check('… ohne Adresse', not re.search(r'http|127\.0\.0\.1|8791|slow\.mp4|SECRET', ptxt), ptxt)
    check('Popup zeigt keine früheren Erfolge', pm.locator('#downloads .dl[data-state=done]').count() == 0)
    refused = pm.evaluate('''async (u) => {
      const s = (m) => chrome.runtime.sendMessage(Object.assign({ t: 'kadri-download' }, m));
      const jobs = (await s({ op: 'list' })).value || [];
      return [await s({ op: 'start', url: u }), await s({ op: 'find', url: u }), await s({ op: 'status', id: jobs[0].id, cookie: 'a=b' }),
              await s({ op: 'cancel', id: 'X'.repeat(32) }), await s({ op: 'start', url: u, headers: 'x' }), await s({ op: 'eval' })]; }''',
      'http://127.0.0.1:8791/videos/other.mp4')
    check('Hintergrund: Start nur aus Kadris Inhaltsskript, nur feste Felder (Menü, Zusatzfelder, falsche Kennung abgelehnt)',
          all(r and r.get('ok') is False and r['error']['kind'] == 'refused' for r in refused) and not helper_hits('/videos/other.mp4'), refused)
    pm.close()
    b0 = helper.cmd('dl-journal')
    check('Service Worker beendet (MV3) während des Downloads', stop_worker(ctx, pg, sw))
    time.sleep(2.5)
    it2 = wait_item(pg, lambda it: any(l.startswith('Helfer-App: Lädt') for l, _ in it)); close_menu(pg)
    check('… danach weiter mit echtem Stand (neuer Service Worker fragt dlstatus)', any(l.startswith('Helfer-App: Lädt') for l, _ in it2) and len(helper_hits('/videos/slow.mp4')) == 1, it2)
    dl_menu(pg); ok = pick(pg, 'Download abbrechen')
    check('Abbruch: Startvoraussetzung – Tipp auf „Download abbrechen“ ausgeführt', ok, '' if ok else player_diag(pg, '/videos/slow.mp4'))
    check('Abbruch: Hinweis „Abgebrochen“', wait_toast(pg, 'Abgebrochen', 15), toasts(pg))
    time.sleep(0.5)
    check('… Teil-Datei beim Helfer entfernt, keine Datei veröffentlicht', helper.cmd('dl-parts') == 'PARTS 0' and len(files(helper)) == 1, files(helper))
    it3 = wait_item(pg, lambda it: any(l == ITEM for l, _ in it)); close_menu(pg)
    check('… danach wieder „%s“ (bewusst neu starten)' % ITEM, any(l == ITEM for l, _ in it3), it3)
    close_player(pg)

    # ---------- Verbindungsabbruch: Kanal neu (Sitzungen weg), Download läuft weiter ----------
    player(pg, page('/videos/drop.mp4?rate=60000'))
    start_item(pg, '/videos/drop.mp4', 'Verbindungsabbruch'); time.sleep(1.5)
    check('Kanal des Helfers neu gestartet', helper.cmd('restart').startswith('READY'))
    check('… Download wird trotzdem fertig gemeldet (Sitzung neu, dlstatus)', wait_toast(pg, 'Gespeichert in Download/Video-Assistent', 30), toasts(pg))
    check('… ein einziger Abruf', len(helper_hits('/videos/drop.mp4')) == 1)
    close_player(pg)

    # ---------- Neustart des Helfers während eines Downloads ----------
    player(pg, page('/videos/crash.mp4?rate=20000'))
    start_item(pg, '/videos/crash.mp4', 'Helfer-Neustart'); time.sleep(2.0)
    state = helper.state; helper.kill()
    time.sleep(2.0)
    helper = ChannelHelper(state)
    check('Helfer-Prozess neu gestartet (Kopplung, Journal und Download-Modus aus dem Zustand)', helper.ready.startswith('READY'))
    check('… Hinweis „Unterbrochen (Helfer neu gestartet)“', wait_toast(pg, 'Unterbrochen', 20), toasts(pg))
    check('… keine Teil-Datei, nicht automatisch neu gestartet', helper.cmd('dl-parts') == 'PARTS 0' and len(helper_hits('/videos/crash.mp4')) == 1)
    close_player(pg)

    # ---------- Neustart des Browsers während eines Downloads ----------
    player(pg, page('/videos/browser.mp4?rate=25000'))
    start_item(pg, '/videos/browser.mp4', 'Browser-Neustart'); time.sleep(2.0)
    ctx.close()
    ctx, sw, _ = launch(p, user_dir=udir)
    pg = ctx.pages[0] if ctx.pages else ctx.new_page()
    pg.on('pageerror', lambda e: errs.append(str(e)))
    player(pg, page('/videos/browser.mp4?rate=25000'))
    it4 = wait_item(pg, lambda it: any(l.startswith('Helfer-App: ') for l, _ in it)); close_menu(pg)
    check('Browser neu gestartet: Player zeigt den laufenden Auftrag (aus dem Speicher, Stand vom Helfer)', any(l.startswith('Helfer-App: Lädt') for l, _ in it4), it4)
    check('… fertig gemeldet', wait_toast(pg, 'Gespeichert in Download/Video-Assistent', 30), toasts(pg))
    check('… kein zweiter Start (ein Abruf)', len(helper_hits('/videos/browser.mp4')) == 1)
    close_player(pg)

    # ---------- fehlende Speicherberechtigung (Android 8–9) ----------
    helper.cmd('storage-permission off')
    player(pg, page('/videos/perm.mp4'))
    start_item(pg, '/videos/perm.mp4', 'Speicherberechtigung')
    check('ohne Speicherberechtigung: verständlicher Hinweis', wait_toast(pg, 'Speicherzugriff fehlt', 15), toasts(pg))
    helper.cmd('storage-permission on')
    close_player(pg)

    # ---------- Seite verlangt Anmeldung (Cookie der Seite): kontrollierter Fehler, kein anderer Weg ----------
    player(pg, page('/videos/login.mp4?auth=1&token=SECRET-C', login=True))
    start_item(pg, '/videos/login.mp4', 'Anmeldung')
    check('Anmeldung verlangt: Hinweis, direkter Download nicht möglich', wait_toast(pg, 'Server verlangt Anmeldung', 15), toasts(pg))
    lb = [x for x in MHITS if x['path'] == '/videos/login.mp4']
    check('… Browser spielte MIT Sitzungs-Cookie, der Helfer bekam KEINEN', any(x['browser'] and 'sess=' in x['cookie'] for x in lb) and helper_hits('/videos/login.mp4') and all(not x['cookie'] for x in helper_hits('/videos/login.mp4')), lb)
    check('… kein Wechsel auf einen anderen Weg (keine weitere Anfrage, kein Browser-Download)', len(helper_hits('/videos/login.mp4')) == 1 and not pg.evaluate('() => !!document.querySelector("a[download]")'))
    check('… Wiedergabe unverändert', playing(pg))
    close_player(pg)


    # ---------- echte 404/410: verständlich, einzeln ausblendbar; Journal bleibt unangetastet ----------
    def hdl_diag(pg, want, secs=15):
        end = time.time() + secs; d = ''
        while time.time() < end:
            d = pg.evaluate('() => %s.querySelector("button[aria-label^=Herunterladen]").dataset.hdlDiag || ""' % R)
            if want in d: return d
            time.sleep(0.3)
        return d
    for code in (404, 410):
        player(pg, page('/videos/missing%d.mp4?missing=%d' % (code, code)))
        start_item(pg, '/videos/missing%d.mp4' % code, 'HTTP %d' % code)
        check('HTTP %d: Datei nicht gefunden' % code, wait_toast(pg, 'Datei nicht gefunden', 15), toasts(pg))
        d = hdl_diag(pg, 'Browser ohne Cookies/Referer: HTTP')
        check('HTTP %d: Diagnose trennt Helfer- und Browserantwort (Helfer %d, Browser ohne Sitzung 206)' % (code, code),
              ('Grund http_%d' % code) in d and 'Browser ohne Cookies/Referer: HTTP 206' in d and 'Bindung bound:own-player-loaded' in d, d)
        probe = [x for x in MHITS if x['path'] == '/videos/missing%d.mp4' % code and x['browser'] and x['range'] == 'bytes=0-0']
        check('HTTP %d: Vergleichsabruf genau einmal, ohne Cookie und Referer (Seite hatte ein Sitzungs-Cookie)' % code,
              len(probe) == 1 and not probe[0]['cookie'] and not probe[0]['ref'] and not probe[0]['auth'], probe)
        check('HTTP %d: Diagnose ohne Adresse' % code, not re.search(r'http:|127\.0\.0\.1|missing|\.mp4', d), d)
        close_player(pg)
    pm = ctx.new_page(); pm.goto('chrome-extension://%s/popup.html' % ext_id)
    missing = pm.locator('#downloads .dl[data-state=failed]').filter(has_text='Datei nicht gefunden')
    try: missing.first.wait_for(timeout=10000)
    except Exception: pass
    check('Popup: zwei echte HTTP-Fehler statt vermeintlich fehlender lokaler Dateien', missing.count() == 2 and 'Fehlgeschlagen:' in (missing.first.text_content() or ''))
    journal_before = sw.evaluate('async () => (await chrome.storage.local.get("kadri-dl-jobs"))["kadri-dl-jobs"]')
    check('Journal unterscheidet HTTP 404 und 410', {'http_404', 'http_410'}.issubset({j.get('reason') for j in journal_before}))
    missing.first.get_by_role('button', name='Fehlermeldung schließen').click()
    pm.wait_for_timeout(500)
    check('Nur gewählter Fehler ausgeblendet', missing.count() == 1)
    pm.reload(); pm.wait_for_timeout(1000)
    check('Ausblenden bleibt nach erneutem Öffnen erhalten', missing.count() == 1)
    journal_after = sw.evaluate('async () => (await chrome.storage.local.get("kadri-dl-jobs"))["kadri-dl-jobs"]')
    check('Schließen verändert weder Downloadjournal noch Fehlerursachen', journal_before == journal_after)
    pm.close()
    # Server gibt die Datei auch dem Browser ohne Sitzung nicht: Diagnose zeigt das (technische Grenze, kein Ausweichweg)
    player(pg, page('/videos/anon404.mp4?missing=404&anon404=1'))
    start_item(pg, '/videos/anon404.mp4', 'HTTP 404 auch ohne Sitzung')
    d = hdl_diag(pg, 'Browser ohne Cookies/Referer: HTTP')
    check('Ohne Sitzung auch im Browser 404: Diagnose zeigt es', 'Grund http_404' in d and 'Browser ohne Cookies/Referer: HTTP 404' in d, d)
    check('… danach kein weiterer Abruf des Helfers', len(helper_hits('/videos/anon404.mp4')) == 1)
    close_player(pg)

    # ---------- Cross-Origin-iframe: der tatsächliche eigene Player liefert die C3-Quelle ----------
    outer = 'http://127.0.0.1:8791/c3-iframe.html'
    def framed_player(inner):
        # Two real HTTP origins, no route interception; wait for the relevant frame rather than every load event.
        with pg.expect_event('framenavigated', predicate=lambda f: f.url.startswith(inner.split('?')[0].split('#')[0])) as nav:
            pg.goto(outer + '?' + urllib.parse.urlencode({'frame': inner}), wait_until='domcontentloaded')
        frame = nav.value
        frame.wait_for_function('() => { const v = document.getElementById("v"); return v && v.currentTime > 0.8; }', timeout=20000)
        frame.evaluate('() => { document.getElementById("v").muted = false; }')
        frame.wait_for_function('() => { const h = document.querySelector("[data-kadri-test]"); return h && h.shadowRoot && h.shadowRoot.querySelector("button[aria-label=\'Im Videoplayer öffnen\']"); }', timeout=15000)
        frame.evaluate('() => %s.querySelector("button[aria-label=\'Im Videoplayer öffnen\']").click()' % R)
        frame.wait_for_function('() => { const v = %s.querySelector(".vv"); return v && v.currentTime > 0.3; }' % R, timeout=25000)
        watch_toasts(frame)
        return frame
    frame = framed_player(page('/videos/frame.mp4?rate=30000'))
    check('Hauptframe ohne Video, Wiedergabe im Cross-Origin-iframe', pg.locator('video').count() == 0 and frame.evaluate('location.origin') != pg.evaluate('location.origin') and playing(frame))
    actual = frame.evaluate('() => %s.querySelector(".vv").currentSrc' % R)
    check('Eigener Player spielt die direkte MP4', '/videos/frame.mp4' in actual)
    items = wait_item(frame, lambda it: any(l == ITEM for l, _ in it)); close_menu(frame)
    check('C3-Angebot auch im iframe; noch kein Download gestartet', any(l == ITEM for l, _ in items) and not helper_hits('/videos/frame.mp4'), items)
    dl_menu(frame); ok = pick(frame, ITEM)
    check('iframe: Startvoraussetzung – Tipp auf den Eintrag ausgeführt', ok, '' if ok else player_diag(frame, '/videos/frame.mp4'))
    pm = ctx.new_page(); pm.goto('chrome-extension://%s/popup.html' % ext_id)
    pm.wait_for_selector('#downloads .dl[data-state=running]', timeout=10000)
    pm.wait_for_selector('#downloads .dl[data-state=done]', timeout=60000)
    check('Popup bestätigt gerade abgeschlossenen iframe-Download', 'Gespeichert' in pm.locator('#downloads .dl[data-state=done]').text_content())
    pm.wait_for_timeout(6000)
    check('Bestätigung verschwindet automatisch', pm.locator('#downloads .dl[data-state=done]').count() == 0)
    done_jobs = sw.evaluate('async () => (await chrome.storage.local.get("kadri-dl-jobs"))["kadri-dl-jobs"].filter(j => j.state === "done")')
    check('Interne abgeschlossene Aufträge bleiben gespeichert', len(done_jobs) >= 3)
    pm.reload(); pm.wait_for_timeout(1000)
    check('Popup öffnet ohne Erfolgshistorie', pm.locator('#downloads .dl[data-state=done]').count() == 0)
    hh = helper_hits('/videos/frame.mp4')
    check('Iframe-Download: einmal und ohne Cookie, Authorization oder Referer', len(hh) == 1 and all(not x['cookie'] and not x['auth'] and not x['ref'] for x in hh), hh)
    pm.close(); close_player(frame)

    # HLS spielt ebenfalls im eigenen Player, darf aber nicht an den MP4-Downloader gehen.
    n_helper = len([x for x in MHITS if not x['browser']])
    frame = framed_player(B + 'proof.html#preload')
    items = dl_menu(frame); close_menu(frame)
    check('HLS im iframe spielt, C3-MP4-Eintrag bleibt ausgeschlossen', playing(frame) and not any(l == ITEM for l, _ in items), items)
    check('HLS verursacht keinen automatischen Helfer-Download', len([x for x in MHITS if not x['browser']]) == n_helper)
    close_player(frame)

    # ---------- M02/M04/M05: HLS läuft, dasselbe Videoelement nennt zwei MP4-Dateien ausdrücklich (<source>) ----------
    alt = ['/videos/alt720.mp4', '/videos/alt360.mp4', '/videos/ldjson.mp4', '/videos/other-player.mp4']
    player(pg, B + 'hlsalt.html')
    src0 = pg.evaluate('() => %s.querySelector(".vv").currentSrc.slice(0, 5)' % R)
    check('HLS-Seite: eigener Player spielt den Stream (hls.js), nicht eine der MP4', src0 == 'blob:' and playing(pg), src0)
    items = wait_item(pg, lambda it: len([1 for l, _ in it if l == ITEM]) >= 2)
    offers = [sub for l, sub in items if l == ITEM]
    check('Bei laufendem HLS: genau die zwei gebundenen MP4 angeboten (720p, 360p)', len(offers) == 2 and '720p' in offers[0] and '360p' in offers[1], items)
    check('… Init des Streams (als <source type=video/mp4>), JSON-LD-MP4 und Quelle eines anderen Videos nicht angeboten', not any('1080p' in x or '480p' in x for x in offers), offers)
    check('… Menü öffnen lädt nichts (kein Helfer- oder Browserabruf der MP4)', not [x for x in MHITS if x['path'] in alt], [x['path'] for x in MHITS if x['path'] in alt])
    close_menu(pg)
    t0 = pg.evaluate('() => %s.querySelector(".vv").currentTime' % R)
    dl_menu(pg); ok = pick_sub(pg, ITEM, '720p')
    check('HLS-Seite: Startvoraussetzung – Tipp auf „%s · 720p“ ausgeführt' % ITEM, ok, '' if ok else player_diag(pg))
    check('… gespeichert (Hinweis)', wait_toast(pg, 'Gespeichert in Download/Video-Assistent', 30), toasts(pg))
    hh = helper_hits('/videos/alt720.mp4')
    check('… genau ein Abruf der gewählten MP4, ohne Cookie, Authorization, Referer', len(hh) == 1 and not hh[0]['cookie'] and not hh[0]['auth'] and not hh[0]['ref'], hh)
    check('… Adresse unverändert (Reihenfolge, doppelte Parameter, %-Escapes)', hh and hh[0]['query'] == 'sig=ALT-A&x=2&x=1&h=a%2Fb', hh and hh[0]['query'])
    check('… keine andere Qualität, kein anderes Video, keine Seitendaten-MP4 abgerufen', not [x for x in MHITS if x['path'] in alt[1:]], [x['path'] for x in MHITS if x['path'] in alt[1:]])
    check('… Datei vollständig beim Helfer (Name = Seitentitel)', any(f.startswith('HLS_mit_MP4') and f.endswith(':%d' % len(CLIP)) for f in files(helper)), files(helper))
    src1 = pg.evaluate('() => %s.querySelector(".vv").currentSrc.slice(0, 5)' % R)
    t1 = pg.evaluate('() => %s.querySelector(".vv").currentTime' % R)
    check('… Wiedergabe bleibt beim HLS-Stream und läuft weiter (keine Umschaltung, kein Sprung zurück)', src1 == 'blob:' and t1 >= t0 and playing(pg), [src1, t0, t1])
    # M06: Menü offen, dann wechselt die Seite das Medium desselben Elements – die alte Auswahl gilt nicht mehr
    items = wait_item(pg, lambda it: any(l == ITEM and '360p' in sub for l, sub in it))
    check('Medienwechsel: Auswahl vorher angeboten', any(l == ITEM and '360p' in sub for l, sub in items), items)
    pg.evaluate('() => { const v = document.getElementById("v"); v.removeAttribute("src"); v.load(); }')
    pg.wait_for_timeout(300)
    ok = pick_sub(pg, ITEM, '360p')
    check('… Tipp auf den alten Eintrag: verweigert mit Hinweis, kein Start', ok and wait_toast(pg, 'Quelle hat sich geändert', 5) and not helper_hits('/videos/alt360.mp4'), toasts(pg))
    items = dl_menu(pg); close_menu(pg)
    check('… danach keine Geister-Einträge aus dem alten Medium', not any(l == ITEM and '360p' in sub for l, sub in items), items)
    close_player(pg)

    # M03: Hauptframe ohne Video; HLS-Seite im Cross-Origin-iframe, daneben ein Werbe-iframe mit eigener MP4
    n_ad = len([x for x in MHITS if x['path'] == '/videos/ad.mp4' and not x['browser']])
    outer_ad = 'http://127.0.0.1:8791/c3-iframe.html?' + urllib.parse.urlencode({'frame': B + 'hlsalt.html', 'ad': 'http://127.0.0.1:8791/c3-ad.html'})
    with pg.expect_event('framenavigated', predicate=lambda f: f.url.startswith(B + 'hlsalt.html')) as nav:
        pg.goto(outer_ad, wait_until='domcontentloaded')
    fr = nav.value
    fr.wait_for_function('() => { const v = document.getElementById("v"); return v && v.currentTime > 0.8; }', timeout=20000)
    fr.evaluate('() => { document.getElementById("v").muted = false; }')
    fr.wait_for_function('() => { const h = document.querySelector("[data-kadri-test]"); return h && h.shadowRoot && h.shadowRoot.querySelector("button[aria-label=\'Im Videoplayer öffnen\']"); }', timeout=15000)
    fr.evaluate('() => %s.querySelector("button[aria-label=\'Im Videoplayer öffnen\']").click()' % R)
    fr.wait_for_function('() => { const v = %s.querySelector(".vv"); return v && v.currentTime > 0.3; }' % R, timeout=25000)
    watch_toasts(fr)
    items = wait_item(fr, lambda it: len([1 for l, _ in it if l == ITEM]) >= 2)
    offers = [sub for l, sub in items if l == ITEM]
    check('Cross-Origin-iframe: dieselben zwei MP4 des Videos im Fenster angeboten, nichts aus dem Werbe-iframe', pg.locator('video').count() == 0 and len(offers) == 2 and not any('1080p' in x for x in offers), items)
    dl_menu(fr); ok = pick_sub(fr, ITEM, '360p')
    check('… Tipp startet genau diese Datei (360p)', ok and wait_toast(fr, 'Gespeichert in Download/Video-Assistent', 30) and len(helper_hits('/videos/alt360.mp4')) == 1, toasts(fr))
    check('… Werbung nie an den Helfer', len([x for x in MHITS if x['path'] == '/videos/ad.mp4' and not x['browser']]) == n_ad == 0)
    close_player(fr)

    # ---------- nichts Sensibles gespeichert oder angezeigt ----------
    stored = json.dumps(sw.evaluate('async () => await chrome.storage.local.get(null)'))
    check('Speicher der Erweiterung ohne URL, Pfad oder Token', not re.search(r'SECRET|8791|/videos/|\.mp4', stored), re.findall(r'SECRET[^"]*|/videos/[^"]*', stored))
    check('Hinweise ohne URL oder Token', not any(re.search(r'http|127\.0\.0\.1|SECRET|\.mp4', t) for t in toasts(pg)), toasts(pg))
    check('alter Klartext-Port 47811 nie angesprochen', not LEGACY_HITS, LEGACY_HITS)
    check('keine Fehler der Seite', not errs, errs)
    ctx.close()
helper.stop()
msrv.shutdown()
shutdown()
done()

