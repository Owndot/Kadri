# Direkte MP4-Downloads über die Helfer-App (Phase C3) im echten Chromium mit Kadri (dist/test) gegen den echten
# ChannelServer UND die echte Download-Engine der Helper-App (Desktop-Harness, Download-Modus; nur die Android-Ablage
# ist ein Ordner). Medien von einem eigenen Testserver (127.0.0.1:8791, tests/web/clip.mp4 = VP9 in MP4).
# Geprüft: kein Eintrag ohne Kopplung; Start nur nach Tipp; öffentliche MP4; Fortschritt (Player-Menü, Kadri-Menü);
# Doppeltipp; Neustart des Service Workers; Abbruch; Verbindungsabbruch; Neustart des Helfers; Neustart des Browsers;
# fehlende Speicherberechtigung (Android 8–9); Seite mit Anmeldung (kontrollierter Fehler, nie Cookies); keine URL in
# Speicher, Hinweisen oder Menü; der alte Port bleibt unberührt.
#   HELPER_HOST_DIR=<Helper-Repository: tests/java/channel/build.sh OUT>
import http.server, threading, time, json, urllib.parse, html
from common import *

# ---------- Medienserver (Range für den Browser; langsam nur für den Helfer = Anfragen ohne Sec-Fetch-Mode) ----------
CLIP = open(os.path.join(WEB, 'clip.mp4'), 'rb').read()
MHITS = []
class M(http.server.BaseHTTPRequestHandler):
    def log_message(self, *a): pass
    def do_GET(self):
        u = urllib.parse.urlparse(self.path); q = dict(urllib.parse.parse_qsl(u.query))
        if u.path == '/c3-iframe.html':
            body = ('<!doctype html><title>Frame host</title><iframe allow="autoplay; fullscreen" style="width:100%;height:700px" src="' + html.escape(q['frame'], quote=True) + '"></iframe>').encode()
            self.send_response(200); self.send_header('Content-Type', 'text/html; charset=utf-8'); self.send_header('Content-Length', str(len(body))); self.end_headers()
            self.wfile.write(body); return
        browser = bool(self.headers.get('Sec-Fetch-Mode'))
        MHITS.append({'path': u.path, 'browser': browser, 'cookie': self.headers.get('Cookie', ''), 'auth': self.headers.get('Authorization', ''), 'ref': self.headers.get('Referer', '')})
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
    pick(pg, ITEM)
    check('Tipp auf den Eintrag startet (Hinweis)', wait_toast(pg, 'Helfer-App', 5), toasts(pg))
    check('Fertig: Hinweis „Gespeichert in Download/Video-Assistent“', wait_toast(pg, 'Gespeichert in Download/Video-Assistent', 30), toasts(pg))
    check('… Datei beim Helfer, volle Größe, Name = Seitentitel', 'Testclip_MP4.mp4:%d' % len(CLIP) in files(helper), files(helper))
    hh = helper_hits('/videos/pub.mp4')
    check('… genau eine Anfrage des Helfers, ohne Cookie, Authorization, Referer', len(hh) == 1 and not hh[0]['cookie'] and not hh[0]['auth'] and not hh[0]['ref'], hh)
    check('… Video läuft weiter', playing(pg))
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
    dl_menu(pg); pick(pg, 'Download abbrechen')
    check('Abbruch: Hinweis „Abgebrochen“', wait_toast(pg, 'Abgebrochen', 15), toasts(pg))
    time.sleep(0.5)
    check('… Teil-Datei beim Helfer entfernt, keine Datei veröffentlicht', helper.cmd('dl-parts') == 'PARTS 0' and len(files(helper)) == 1, files(helper))
    it3 = wait_item(pg, lambda it: any(l == ITEM for l, _ in it)); close_menu(pg)
    check('… danach wieder „%s“ (bewusst neu starten)' % ITEM, any(l == ITEM for l, _ in it3), it3)
    close_player(pg)

    # ---------- Verbindungsabbruch: Kanal neu (Sitzungen weg), Download läuft weiter ----------
    player(pg, page('/videos/drop.mp4?rate=60000'))
    wait_item(pg, lambda it: any(l == ITEM for l, _ in it)); close_menu(pg)
    dl_menu(pg); pick(pg, ITEM); time.sleep(1.5)
    check('Kanal des Helfers neu gestartet', helper.cmd('restart').startswith('READY'))
    check('… Download wird trotzdem fertig gemeldet (Sitzung neu, dlstatus)', wait_toast(pg, 'Gespeichert in Download/Video-Assistent', 30), toasts(pg))
    check('… ein einziger Abruf', len(helper_hits('/videos/drop.mp4')) == 1)
    close_player(pg)

    # ---------- Neustart des Helfers während eines Downloads ----------
    player(pg, page('/videos/crash.mp4?rate=20000'))
    wait_item(pg, lambda it: any(l == ITEM for l, _ in it)); close_menu(pg)
    dl_menu(pg); pick(pg, ITEM); time.sleep(2.0)
    state = helper.state; helper.kill()
    time.sleep(2.0)
    helper = ChannelHelper(state)
    check('Helfer-Prozess neu gestartet (Kopplung, Journal und Download-Modus aus dem Zustand)', helper.ready.startswith('READY'))
    check('… Hinweis „Unterbrochen (Helfer neu gestartet)“', wait_toast(pg, 'Unterbrochen', 20), toasts(pg))
    check('… keine Teil-Datei, nicht automatisch neu gestartet', helper.cmd('dl-parts') == 'PARTS 0' and len(helper_hits('/videos/crash.mp4')) == 1)
    close_player(pg)

    # ---------- Neustart des Browsers während eines Downloads ----------
    player(pg, page('/videos/browser.mp4?rate=25000'))
    wait_item(pg, lambda it: any(l == ITEM for l, _ in it)); close_menu(pg)
    dl_menu(pg); pick(pg, ITEM); time.sleep(2.0)
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
    wait_item(pg, lambda it: any(l == ITEM for l, _ in it)); close_menu(pg)
    dl_menu(pg); pick(pg, ITEM)
    check('ohne Speicherberechtigung: verständlicher Hinweis', wait_toast(pg, 'Speicherzugriff fehlt', 15), toasts(pg))
    helper.cmd('storage-permission on')
    close_player(pg)

    # ---------- Seite verlangt Anmeldung (Cookie der Seite): kontrollierter Fehler, kein anderer Weg ----------
    player(pg, page('/videos/login.mp4?auth=1&token=SECRET-C', login=True))
    wait_item(pg, lambda it: any(l == ITEM for l, _ in it)); close_menu(pg)
    dl_menu(pg); pick(pg, ITEM)
    check('Anmeldung verlangt: Hinweis, direkter Download nicht möglich', wait_toast(pg, 'Server verlangt Anmeldung', 15), toasts(pg))
    lb = [x for x in MHITS if x['path'] == '/videos/login.mp4']
    check('… Browser spielte MIT Sitzungs-Cookie, der Helfer bekam KEINEN', any(x['browser'] and 'sess=' in x['cookie'] for x in lb) and helper_hits('/videos/login.mp4') and all(not x['cookie'] for x in helper_hits('/videos/login.mp4')), lb)
    check('… kein Wechsel auf einen anderen Weg (keine weitere Anfrage, kein Browser-Download)', len(helper_hits('/videos/login.mp4')) == 1 and not pg.evaluate('() => !!document.querySelector("a[download]")'))
    check('… Wiedergabe unverändert', playing(pg))
    close_player(pg)


    # ---------- echte 404/410: verständlich, einzeln ausblendbar; Journal bleibt unangetastet ----------
    for code in (404, 410):
        player(pg, page('/videos/missing%d.mp4?missing=%d' % (code, code)))
        wait_item(pg, lambda it: any(l == ITEM for l, _ in it)); close_menu(pg)
        dl_menu(pg); pick(pg, ITEM)
        check('HTTP %d: Datei nicht gefunden' % code, wait_toast(pg, 'Datei nicht gefunden', 15), toasts(pg))
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
    dl_menu(frame); pick(frame, ITEM)
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

