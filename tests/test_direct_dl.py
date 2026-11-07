# P4c: Download-Knopf ⬇ direkt am Video (neben ▶), Downloads unabhängig vom Player und automatische Wiederaufnahme –
# im echten Chromium mit Kadri (dist/test) gegen den echten ChannelServer UND die echten Download-Engines (MP4, HLS) der
# Helper-App (Desktop-Harness; nur das Umpacken von HLS ist dort eine Nachbildung). Eigene Medien von 127.0.0.1:8791.
# Geprüft:
#  - ⬇ erscheint neben ▶; ohne Kopplung verständliche Erklärung statt eines funktionslosen Knopfs
#  - HLS (Seite spielt mit hls.js/MSE): ⬇ erkennt den gerade laufenden Stream (Stücke geladen = gebunden), ohne den
#    Kadri-Player zu öffnen; eine Option → ein Tipp startet; Datei fertig; das Video der Seite läuft weiter
#  - MP4 (<video src>): ein Tipp startet; Datei fertig; während des Laufs zeigt ⬇ Stand und „Abbrechen“ (kein zweiter Start)
#  - kein sicher zugeordnetes Format (WebM): klarer Grund, keine Anfrage beim Helfer
#  - Seite sofort nach dem Tipp verlassen (0 ms), Tab-Wechsel: der Download läuft weiter und wird fertig
#  - Flugmodus mitten im Stream: „Wartet auf Internet“, keine Anfrage ohne Netz, Netz zurück → fertig ohne Zutun,
#    kein Segment doppelt; Abbruch während des Wartens → nie wieder aufgenommen
#  - Neustart des Service Workers und des Browsers: Stand bleibt nachvollziehbar
#  - nie Cookie/Authorization/Referer beim Helfer, keine Adresse in Hinweisen
#   HELPER_HOST_DIR=<Helper-Repository: tests/java/channel/build.sh OUT>
import http.server, threading, time, urllib.parse
from common import *

HITS = []
HLSDIR = os.path.join(WEB, 'hls')
STATE = {'down': False, 'slow': 0.0}
class M(http.server.BaseHTTPRequestHandler):
    def log_message(self, *a): pass
    def do_GET(self):
        u = urllib.parse.urlparse(self.path)
        browser = bool(self.headers.get('Sec-Fetch-Mode'))
        if not browser and STATE['down']:            # „Flugmodus“ des Handys: der Helfer erreicht nichts
            HITS.append({'path': u.path, 'browser': False, 'down': True, 'cookie': '', 'auth': '', 'ref': ''})
            try: self.connection.shutdown(2)
            except Exception: pass
            return
        hit = {'path': u.path, 'browser': browser, 'cookie': self.headers.get('Cookie', ''), 'auth': self.headers.get('Authorization', ''),
               'ref': self.headers.get('Referer', ''), 'range': self.headers.get('Range', '')}
        HITS.append(hit)
        # Synthetic HTTP failures only for the independent helper. Browser playback remains available.
        # fail_after=1: planning can succeed, the same URL becomes unavailable at download start.
        target = STATE.get('fail_path')
        if not browser and target and (u.path == '/d/gone' or u.path == target and
                sum(1 for x in HITS if not x['browser'] and x['path'] == target) > STATE.get('fail_after', 0)):
            code = 302 if STATE.get('redirect') and u.path != '/d/gone' else 404
            hit['status'] = code
            self.send_response(code)
            if code == 302: self.send_header('Location', '/d/gone')
            self.send_header('Content-Length', '0'); self.end_headers(); return
        body, ctype = None, 'application/octet-stream'
        title = re.sub(r'[^A-Za-z0-9]', '', urllib.parse.parse_qs(u.query).get('n', [''])[0])[:20]
        if u.path == '/d/hls.html':
            body = ('<!doctype html><html><head><meta name=viewport content="width=device-width,initial-scale=1"><title>Direkt HLS ' + title + '</title>'
                    '<script src="/hls.min.js"></script></head><body style="margin:0"><video id=v muted autoplay playsinline style="width:100%;display:block"></video>'
                    '<script>const v=document.getElementById("v");const h=new Hls();h.loadSource("/d/s/master.m3u8?t=SECRET-T1");h.attachMedia(v);'
                    'h.on(Hls.Events.MANIFEST_PARSED,()=>v.play());</script></body></html>').encode(); ctype = 'text/html; charset=utf-8'
        elif u.path == '/d/mp4.html':
            body = ('<!doctype html><html><head><meta name=viewport content="width=device-width,initial-scale=1"><title>Direkt MP4 ' + title + '</title></head>'
                    '<body style="margin:0"><video id=v muted autoplay playsinline loop src="/d/clip.mp4?sig=SECRET-M1" style="width:100%;display:block"></video></body></html>').encode()
            ctype = 'text/html; charset=utf-8'
        elif u.path == '/d/webm.html':
            body = ('<!doctype html><html><head><meta name=viewport content="width=device-width,initial-scale=1"><title>Direkt WebM</title></head>'
                    '<body style="margin:0"><video id=v muted autoplay playsinline loop src="/d/clip.webm" style="width:100%;display:block"></video></body></html>').encode()
            ctype = 'text/html; charset=utf-8'
        elif u.path == '/d/other.html':
            body = b'<!doctype html><title>Andere Seite</title><p>andere Seite'; ctype = 'text/html; charset=utf-8'
        elif u.path == '/hls.min.js':
            body = open(os.path.join(WEB, 'hls.min.js'), 'rb').read(); ctype = 'text/javascript'
        elif u.path == '/d/clip.mp4':
            body = open(os.path.join(WEB, 'clip.mp4'), 'rb').read(); ctype = 'video/mp4'
        elif u.path == '/d/clip.webm':
            body = open(os.path.join(WEB, 'clip.webm'), 'rb').read(); ctype = 'video/webm'
        elif u.path == '/d/s/master.m3u8':
            text = re.sub(r',CODECS="[^"]*"', '', open(os.path.join(HLSDIR, 'master.m3u8')).read()).replace('index.m3u8', '/d/s/index.m3u8?t=SECRET-T1')
            body = text.encode(); ctype = 'application/vnd.apple.mpegurl'
        elif u.path == '/d/s/index.m3u8':
            text = open(os.path.join(HLSDIR, 'index.m3u8')).read()
            text = re.sub(r'^(seg\d+\.m4s|init\.mp4)$', lambda m: m.group(1) + '?t=SECRET-T1', text, flags=re.M).replace('URI="init.mp4"', 'URI="init.mp4?t=SECRET-T1"')
            body = text.encode(); ctype = 'application/vnd.apple.mpegurl'
        elif re.match(r'^/d/s/(seg\d+\.m4s|init\.mp4)$', u.path):
            body = open(os.path.join(HLSDIR, u.path.split('/')[-1]), 'rb').read(); ctype = 'video/mp4'
            if not browser and STATE['slow']: time.sleep(STATE['slow'])
        if body is None:
            self.send_response(404); self.send_header('Content-Length', '0'); self.end_headers(); return
        etag = '"kadri-direct-%d"' % len(body)
        rng = self.headers.get('Range', '')
        m = re.match(r'^bytes=(\d+)-(\d*)$', rng)
        if m and not browser and self.headers.get('If-Range') == etag:
            a = int(m.group(1)); b = int(m.group(2)) if m.group(2) else len(body) - 1
            self.send_response(206); self.send_header('Content-Type', ctype); self.send_header('Content-Length', str(b - a + 1))
            self.send_header('Content-Range', 'bytes %d-%d/%d' % (a, b, len(body))); self.send_header('ETag', etag); self.end_headers()
            self.wfile.write(body[a:b + 1]); return
        self.send_response(200); self.send_header('Content-Type', ctype); self.send_header('Content-Length', str(len(body))); self.send_header('ETag', etag)
        self.send_header('Accept-Ranges', 'bytes'); self.send_header('Cache-Control', 'no-store'); self.send_header('Access-Control-Allow-Origin', '*'); self.end_headers()
        hit['ok'] = True
        try: self.wfile.write(body)
        except Exception: pass
msrv = http.server.ThreadingHTTPServer(('127.0.0.1', 8791), M); msrv.daemon_threads = True
threading.Thread(target=msrv.serve_forever, daemon=True).start()
BASE = 'http://127.0.0.1:8791'
DLB = "button[aria-label='Video speichern']"

helper_hits = lambda: [x for x in HITS if not x['browser']]
def files(h): return h.cmd('dl-files').split(' ')[1:]
def wait_files(h, n, secs=60):
    end = time.time() + secs
    while time.time() < end:
        if len(files(h)) >= n: return True
        time.sleep(0.3)
    return False
def goto_playing(pg, url):
    pg.goto(url)
    pg.wait_for_function('document.getElementById("v").currentTime > 0.8', timeout=20000)
    pg.evaluate('() => { document.getElementById("v").muted = false; }')   # (wie open_player: Kadri zeigt den Knopf an Videos mit Ton)
    pg.wait_for_function('() => { const h = document.querySelector("[data-kadri-test]"); return h && h.shadowRoot && h.shadowRoot.querySelector("%s"); }' % DLB.replace('"', '\\"'), timeout=15000)
    pg.evaluate('''() => { const t = %s.querySelector(".toast"); window.__toasts = [];
      new MutationObserver(() => window.__toasts.push(t.textContent)).observe(t, { childList: true, characterData: true, subtree: true }); }''' % R)
def tap_dl(pg): pg.evaluate('() => %s.querySelector("%s").click()' % (R, DLB.replace('"', '\\"')))
def toasts(pg): return pg.evaluate('() => window.__toasts || []')
def wait_toast(pg, text, secs=30):
    end = time.time() + secs
    while time.time() < end:
        if any(text in t for t in toasts(pg)): return True
        time.sleep(0.2)
    return False
def menu(pg, secs=10):
    end = time.time() + secs
    while time.time() < end:
        it = pg.evaluate('() => Array.from(%s.querySelectorAll(".dlm .dli")).map(b => [b.firstChild.textContent, b.querySelector("small") ? b.querySelector("small").textContent : ""])' % R)
        if it: return it
        time.sleep(0.2)
    return []
def menu_pick(pg, label):
    return pg.evaluate('(l) => { const b = Array.from(%s.querySelectorAll(".dlm .dli")).find(b => b.firstChild.textContent === l); if (b) b.click(); return !!b; }' % R, label)
def menu_close(pg): pg.evaluate('() => { const b = %s.querySelector(".dlm .dlx"); if (b) b.click(); }' % R)
def player_open(pg): return pg.evaluate('() => !!%s.querySelector(".vv")' % R)
def page_playing(pg):
    t0 = pg.evaluate('document.getElementById("v").currentTime'); time.sleep(0.8)
    return pg.evaluate('(t) => { const v = document.getElementById("v"); return !v.paused && v.currentTime > t; }', t0)
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
def jobs_via_popup(ctx, ext_id):
    o = ctx.new_page(); o.goto('chrome-extension://%s/popup.html' % ext_id)
    r = o.evaluate('() => chrome.runtime.sendMessage({ t: "kadri-download", op: "list" })'); o.close()
    return (r or {}).get('value') or []
SEGS = lambda: sum(1 for x in helper_hits() if x['path'].endswith('.m4s') and x.get('ok') and not x.get('range'))

helper = ChannelHelper()
check('echter Kanal-Helfer mit MP4- und HLS-Engine', helper.cmd('downloads 8791') == 'DOWNLOADS on' and helper.cmd('hls on') == 'HLS on')
with sync_playwright() as p:
    ctx, sw, udir = launch(p)
    ext_id = sw.url.split('/')[2]
    pg = ctx.pages[0] if ctx.pages else ctx.new_page()
    errs = []; pg.on('pageerror', lambda e: errs.append(str(e)))

    # ---------- ⬇ neben ▶; ohne Kopplung: verständliche Erklärung ----------
    goto_playing(pg, BASE + '/d/hls.html')
    order = pg.evaluate('() => Array.from(%s.querySelectorAll(".pill .pb")).map(b => b.getAttribute("aria-label"))' % R)
    check('Knopfleiste: [▶ Player] [⬇ Video speichern]', order == ['Im Videoplayer öffnen', 'Video speichern'], order)
    tap_dl(pg)
    it = menu(pg)
    check('Ohne Kopplung: Erklärung „nicht gekoppelt“ statt eines funktionslosen Knopfs', any('nicht gekoppelt' in l for l, _ in it), it)
    check('… nichts beim Helfer angefragt, Kadri-Player nicht geöffnet', not helper_hits() and not player_open(pg))
    menu_close(pg)
    check('Kopplung über die Einstellungsseite', pair_helper(ctx, ext_id, helper) == 'Verbunden')

    # ---------- HLS über ⬇, ohne Player; eine Option → ein Tipp ----------
    goto_playing(pg, BASE + '/d/hls.html?n=eins')
    tap_dl(pg)
    check('HLS: ein Tipp prüft den Stream und startet (eine Option, kein Menü)', wait_toast(pg, 'Helfer-App lädt', 20), toasts(pg))
    check('HLS: Datei fertig beim Helfer', wait_files(helper, 1), files(helper))
    check('HLS: Kadri-Player nie geöffnet, Video der Seite läuft weiter', not player_open(pg) and page_playing(pg))
    hh = helper_hits()
    check('HLS: Helfer lud Listen und alle 12 Segmente, ohne Cookie/Authorization/Referer',
          SEGS() == 12 and all(not x['cookie'] and not x['auth'] and not x['ref'] for x in hh), [x['path'] for x in hh])
    check('Keine Adresse oder Token in Hinweisen', not any('127.0.0.1' in t or 'SECRET' in t for t in toasts(pg)), toasts(pg))

    # ---------- MP4 über ⬇: ein Tipp; während des Laufs Stand + Abbrechen statt zweitem Start ----------
    before = len(files(helper)); n0 = len(helper_hits())
    goto_playing(pg, BASE + '/d/mp4.html?n=eins')
    tap_dl(pg)
    check('MP4: ein Tipp startet direkt', wait_toast(pg, 'Helfer-App lädt', 20), toasts(pg))
    check('MP4: Datei fertig', wait_files(helper, before + 1), files(helper))
    mp4hits = [x for x in helper_hits()[n0:] if x['path'] == '/d/clip.mp4']
    check('MP4: genau ein Abruf der Datei durch den Helfer, ohne Cookie/Referer', len(mp4hits) == 1 and not mp4hits[0]['cookie'] and not mp4hits[0]['ref'], mp4hits)
    check('MP4: Video der Seite läuft weiter, Player zu', page_playing(pg) and not player_open(pg))

    # ---------- Proven diagnostic gaps: real HTTP failures, never a claim about site-a's cause ----------
    def anon_diag():
        # Use the same menu and anonymized copy path as on Samsung.
        pg.bring_to_front()
        sw.evaluate("""async () => { const [t] = await chrome.tabs.query({ active: true, currentWindow: true });
          await chrome.tabs.sendMessage(t.id, { t: 'kadri-menu' }, { frameId: 0 }); }""")
        pg.wait_for_function('() => !!%s.querySelector(".diag textarea")' % R, timeout=10000)
        pg.evaluate('() => %s.querySelector(".diag .danon").click()' % R)
        result = pg.evaluate('() => %s.querySelector(".diag textarea").value' % R)
        pg.evaluate('() => %s.querySelector(".diag").remove()' % R)
        return result

    # Existing requests are cleared for each deterministic plan/start boundary.
    for label, media, target, after, redirect in [
            ('MP4 GET', 'mp4', '/d/clip.mp4', 0, False),
            ('MP4 redirect', 'mp4', '/d/clip.mp4', 0, True),
            ('HLS plan media', 'hls', '/d/s/index.m3u8', 0, False),
            ('HLS start master', 'hls', '/d/s/master.m3u8', 1, False),
            ('HLS start media', 'hls', '/d/s/index.m3u8', 1, False),
            ('HLS init', 'hls', '/d/s/init.mp4', 0, False),
            ('HLS first segment', 'hls', '/d/s/seg000.m4s', 0, False),
            ('HLS later segment', 'hls', '/d/s/seg010.m4s', 0, False),
            ('HLS redirect', 'hls', '/d/s/init.mp4', 0, True)]:
        # An interrupted earlier HLS job would legitimately offer resume. Finish it via explicit cancellation
        # before the next independent synthetic case; cancellation is also checked in the existing suite below.
        # runtime.sendMessage in the service worker cannot target that same worker. Use the authorized popup
        # sender, as the real download list does; never bypass the sender checks to clean up a fixture job.
        cleanup = ctx.new_page(); cleanup.goto('chrome-extension://%s/popup.html' % ext_id)
        cleanup.evaluate('''async () => {
          const r = await chrome.runtime.sendMessage({t:"kadri-download",op:"list"});
          if (!r || !r.ok) throw new Error('fixture list failed');
          for (const j of r.value) if (j.state === 'interrupted') {
            const c = await chrome.runtime.sendMessage({t:"kadri-download",op:"cancel",id:j.id});
            if (!c || !c.ok) throw new Error('fixture cancel failed');
          }
        }''')
        cleanup.close()
        goto_playing(pg, BASE + '/d/' + media + '.html?n=diag')
        HITS.clear()
        STATE.update(fail_path=target, fail_after=after, redirect=redirect)
        before = len(files(helper))
        tap_dl(pg)
        end = time.time() + 20
        anon = ''
        while time.time() < end:
            anon = anon_diag()
            if 'Grund http_404' in anon: break
            time.sleep(0.3)
        check(label + ': anonymous diagnostic contains actual helper HTTP 404', 'Grund http_404' in anon and 'HTTP 404' in anon, anon)
        check(label + ': source identity/age present, page keeps playing without Kadri player',
              'Identität ' in anon and 'Alter beim Start ' in anon and not player_open(pg) and page_playing(pg))
        check(label + ': no confidential URL, token, job id or title', not re.search(r'127\.0\.0\.1|8791|https?:|/d/|SECRET|sig=|token=|Direkt |[a-f0-9]{24,}', anon), anon)
        check(label + ': no publication after HTTP 404', len(files(helper)) == before)
        rejected = [x for x in helper_hits() if x.get('status') == 404]
        check(label + ': protocol capture proves 404 and excludes credentials', bool(rejected) and all(not x['cookie'] and not x['auth'] and not x['ref'] for x in helper_hits()), rejected)
        if media == 'hls':
            check(label + ': error stage honest; no master used as failed-segment probe',
                  ('Phase hlsplan' in anon if after == 0 and target.endswith('index.m3u8') else 'Phase unbekannt' in anon)
                  and not any(x['browser'] and x['range'] == 'bytes=0-0' for x in HITS), anon)
        STATE.update(fail_path=None, fail_after=0, redirect=False)

    # ---------- kein sicher zugeordnetes Format: klarer Grund, nichts beim Helfer ----------
    n0 = len(helper_hits())
    goto_playing(pg, BASE + '/d/webm.html')
    tap_dl(pg)
    it = menu(pg)
    check('WebM: klarer Grund („Keine speicherbare Videodatei …“), kein Start', any('Keine speicherbare Videodatei' in l for l, _ in it), it)
    check('… keine Anfrage an den Helfer', len(helper_hits()) == n0)
    menu_close(pg)

    # ---------- Seite sofort verlassen (0 ms) bzw. Tab wechseln: läuft weiter ----------
    STATE['slow'] = 0.15
    before = len(files(helper))
    goto_playing(pg, BASE + '/d/hls.html?n=verlassen')
    tap_dl(pg)
    wait_toast(pg, 'Helfer-App prüft den Stream', 10)
    pg.wait_for_timeout(0)
    t0 = time.time()
    while time.time() - t0 < 10 and not any(x['path'].endswith('.m4s') for x in helper_hits()[-3:]): time.sleep(0.05)
    seen_toasts = (toasts(pg), menu(pg, 1))
    pg.goto(BASE + '/d/other.html')                      # Seite verlassen, kaum dass der Start bestätigt ist
    other = ctx.new_page(); other.goto(BASE + '/d/other.html')   # Tab-Wechsel: anderer Tab im Vordergrund
    check('Seite verlassen + Tab-Wechsel direkt nach dem Start: Download wird trotzdem fertig', wait_files(helper, before + 1), (files(helper), seen_toasts,
          [(x['state'], x.get('label'), x.get('progress')) for x in jobs_via_popup(ctx, ext_id)][:3]))
    other.close()
    STATE['slow'] = 0.0

    # ---------- Flugmodus mitten im Stream: automatische Wiederaufnahme ohne Zutun ----------
    STATE['slow'] = 0.2
    before = len(files(helper)); s0 = SEGS()
    goto_playing(pg, BASE + '/d/hls.html?n=flugmodus')
    tap_dl(pg)
    wait_toast(pg, 'Helfer-App lädt', 20)
    t0 = time.time()
    while time.time() - t0 < 15 and SEGS() - s0 < 4: time.sleep(0.05)
    STATE['down'] = True; helper.cmd('dl-net off')
    time.sleep(0.8)
    tap_dl(pg)
    it = menu(pg)
    check('Flugmodus: ⬇ zeigt „Wartet auf Internet – setzt automatisch fort“ (kein zweiter Start)', any('Wartet auf Internet' in l for l, _ in it), it)
    menu_close(pg)
    downs = sum(1 for x in HITS if x.get('down'))
    time.sleep(1.5)
    check('Flugmodus: keine Anfrage des Helfers ohne Netz', sum(1 for x in HITS if x.get('down')) == downs, sum(1 for x in HITS if x.get('down')) - downs)
    STATE['down'] = False; helper.cmd('dl-net on')
    check('Netz zurück: ohne Nutzeraktion fertig', wait_files(helper, before + 1, 60), files(helper))
    # verifizierte Segmente nur per starkem ETag bestätigt; neu geladen höchstens das beim Abriss gerade laufende
    check('… verifizierte Segmente nicht neu geladen (höchstens das beim Abriss laufende)', 12 <= SEGS() - s0 <= 13, SEGS() - s0)
    STATE['slow'] = 0.0

    # ---------- Abbruch während des Wartens: nie wieder aufgenommen ----------
    STATE['slow'] = 0.2
    before = len(files(helper)); s0 = SEGS()
    goto_playing(pg, BASE + '/d/hls.html?n=abbruch')
    tap_dl(pg)
    wait_toast(pg, 'Helfer-App lädt', 20)
    t0 = time.time()
    while time.time() - t0 < 15 and SEGS() - s0 < 3: time.sleep(0.05)
    STATE['down'] = True; helper.cmd('dl-net off')
    time.sleep(0.8)
    tap_dl(pg)
    it = menu(pg)
    ok = menu_pick(pg, 'Download abbrechen')
    check('Abbruch im Warten: über ⬇ „Download abbrechen“', ok, it)
    end = time.time() + 10; st = ''
    while time.time() < end:
        l = jobs_via_popup(ctx, ext_id); st = l[0]['state'] if l else ''
        if st == 'cancelled': break
        time.sleep(0.3)
    check('… vom Helfer als abgebrochen bestätigt', st == 'cancelled', st)
    n1 = len(helper_hits())
    STATE['down'] = False; helper.cmd('dl-net on')
    time.sleep(1.5)
    check('… nach Netz zurück kein weiterer Versuch, keine Datei', len(helper_hits()) == n1 and len(files(helper)) == before, (len(helper_hits()) - n1, files(helper)))
    STATE['slow'] = 0.0

    # ---------- Neustart des Service Workers und des Browsers: Stand nachvollziehbar ----------
    STATE['slow'] = 0.2
    before = len(files(helper))
    goto_playing(pg, BASE + '/d/hls.html?n=worker')
    tap_dl(pg)
    wait_toast(pg, 'Helfer-App lädt', 20)
    check('Service Worker mitten im Download beendet', stop_worker(ctx, pg, sw))
    check('… Download läuft im Helfer weiter und wird fertig', wait_files(helper, before + 1), files(helper))
    l = jobs_via_popup(ctx, ext_id)
    check('… Liste nach Worker-Neustart zeigt den Auftrag als fertig', l and l[0]['state'] == 'done', [(x['state'], x.get('label')) for x in l][:3])
    STATE['slow'] = 0.0
    check('keine Seitenfehler', not errs, errs)
    ctx.close()
    ctx2 = p.chromium.launch_persistent_context(udir, headless=False, executable_path=os.environ.get('KADRI_CHROMIUM') or None,
        args=['--disable-extensions-except=' + EXT, '--load-extension=' + EXT], viewport={'width': 400, 'height': 800}, is_mobile=True, has_touch=True, locale='de-DE')
    sw2 = ctx2.service_workers[0] if ctx2.service_workers else ctx2.wait_for_event('serviceworker', timeout=15000)
    l = jobs_via_popup(ctx2, sw2.url.split('/')[2])
    states = [x['state'] for x in l]
    check('Browser-Neustart: fertige und abgebrochene Downloads bleiben erkennbar (ohne Adresse)', 'done' in states and 'cancelled' in states
          and not any('127.0.0.1' in json.dumps(x) or 'SECRET' in json.dumps(x) for x in l), states)
    ctx2.close()
helper.stop()
done()
