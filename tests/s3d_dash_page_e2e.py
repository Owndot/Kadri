# S3d-Gerätetestseite lokal Ende zu Ende (nicht in CI): tests/web/public/s3d-dash.html unverändert unter einem githack-artigen Pfad, echte
# Erweiterung (dist/test), echter Kanal-Helfer (DashEngine). Geprüft: bound(dash-segments), Angebot, dashplan (Optionen),
# dashstart, Datei beim Helfer (Bytes = Init + Stücke der gewählten Darstellungen), Diagnosezeilen, Zeitfenster.
#   node tools/build.js --test; HELPER_HOST_DIR=<Helper 3887569: tests/java/channel/build.sh OUT> xvfb-run -a python3 tests/s3d_dash_page_e2e.py
import os, re, sys, time, json, threading, http.server, urllib.parse
KADRI = sys.argv[1] if len(sys.argv) > 1 else os.path.join(os.path.dirname(os.path.abspath(__file__)), '..'); sys.path.insert(0, os.path.join(KADRI, 'tests'))
from common import *   # noqa
PORT = 8791
PUB = os.path.join(KADRI, 'tests', 'web', 'public'); PREFIX = '/Owndot/Kadri/0123456789abcdef0123456789abcdef01234567/tests/web/public/'
FIX = os.path.join(PUB, 's3d-dash'); HITS = []
class H(http.server.BaseHTTPRequestHandler):
    def log_message(self, *a): pass
    def do_GET(self):
        u = urllib.parse.urlparse(self.path)
        HITS.append({'path': u.path, 'browser': bool(self.headers.get('Sec-Fetch-Mode')), 'cookie': self.headers.get('Cookie') or '', 'auth': self.headers.get('Authorization') or ''})
        rel = u.path[len(PREFIX):] if u.path.startswith(PREFIX) else None
        f = os.path.normpath(os.path.join(PUB, rel)) if rel else ''
        if not rel or not f.startswith(PUB) or not os.path.isfile(f): self.send_response(404); self.send_header('Content-Length', '0'); self.end_headers(); return
        body = open(f, 'rb').read(); ct = {'.html': 'text/html; charset=utf-8', '.mpd': 'application/dash+xml', '.m4s': 'video/iso.segment'}.get(os.path.splitext(f)[1], 'application/octet-stream')
        self.send_response(200); self.send_header('Content-Type', ct); self.send_header('Content-Length', str(len(body))); self.send_header('ETag', '"%x"' % (hash(body) & 0xffffffff))
        self.send_header('Access-Control-Allow-Origin', '*'); self.end_headers(); self.wfile.write(body)
srv = http.server.ThreadingHTTPServer(('127.0.0.1', PORT), H); srv.daemon_threads = True; threading.Thread(target=srv.serve_forever, daemon=True).start()
BASE = 'http://127.0.0.1:%d' % PORT + PREFIX
def wait(pred, secs=10):
    end = time.time() + secs
    while time.time() < end:
        try:
            if pred(): return True
        except Exception: pass
        time.sleep(0.2)
    return False
UI = '(() => { const h = document.querySelector("[data-kadri-test]"); return h && h.shadowRoot; })()'
def js(sel): return '() => { const r = %s; if (!r) return null; %s }' % (UI, sel)
ITEMS = 'return Array.from(r.querySelectorAll(".dlm .dli")).map((b) => [b.firstChild.textContent, b.querySelector("small") ? b.querySelector("small").textContent : ""]);'
OFFER = 'DASH-Stream mit Helper herunterladen …'
helper = ChannelHelper()
_r = [helper.ready, helper.cmd('downloads %d' % PORT), helper.cmd('hls on'), helper.cmd('dash on')]
check('Kanal-Helfer mit DASH-Engine', _r[0].startswith('READY') and _r[1] == 'DOWNLOADS on' and _r[3] == 'DASH on', _r)
with sync_playwright() as p:
    ctx, sw, udir = launch(p); ext_id = sw.url.split('/')[2]
    ctx.grant_permissions(['clipboard-read', 'clipboard-write'])
    print('gestartet', flush=True)
    check('Kopplung', pair_helper(ctx, ext_id, helper) == 'Verbunden')
    pg = ctx.pages[0] if ctx.pages else ctx.new_page(); errs = []; pg.on('pageerror', lambda e: errs.append(str(e)))
    pg.goto(BASE + 's3d-dash.html'); pg.bring_to_front()
    check('Seite: Stückfolge aktuell (≥ 3 Stücke in Folge) angezeigt', wait(lambda: 'Stückfolge aktuell' in pg.inner_text('#w'), 30), pg.inner_text('#w') + ' | ' + pg.inner_text('#c'))
    check('Seite: MSE H.264/AAC-LC verfügbar, Wiedergabe läuft, Dauer 20 s', wait(lambda: pg.evaluate('() => { const v = document.getElementById("v"); return !v.paused && v.currentTime > 0.5 && Math.abs(v.duration - 20) < 0.5; }'), 20), pg.inner_text('#c'))
    def diag():
        tab = sw.evaluate('async () => (await chrome.tabs.query({})).find((t) => /s3d-dash\\.html/.test(t.url)).id')
        sw.evaluate('(t) => chrome.tabs.sendMessage(t, { t: "kadri-menu" }, { frameId: 0 })', tab)
        wait(lambda: pg.evaluate(js('return !!r.querySelector(".diag .danon");')), 8)
        pg.evaluate('() => navigator.clipboard.writeText("-")')
        pg.evaluate(js('r.querySelector(".diag .danon").click(); return true;'))
        got = ['']
        wait(lambda: got.__setitem__(0, pg.evaluate('() => navigator.clipboard.readText()')) or got[0].startswith('Kadri – anonymisierte Diagnose'), 8)
        pg.evaluate(js('const b = Array.from(r.querySelectorAll(".diag button")).find((x) => x.textContent === "Schließen"); if (b) b.click(); return true;'))
        return got[0]
    pg.evaluate('() => { document.getElementById("v").muted = false; }'); time.sleep(1.2)   # Gerät: Ton über die Bedienleiste einschalten
    # Diagnose (anonymisiert) wie auf dem Gerät: über die interne Funktion der Testbuild-Seite nicht erreichbar → Menü-Weg
    wait(lambda: pg.evaluate(js('return !!r.querySelector(".pill.on");')), 15); time.sleep(0.3)
    pg.evaluate(js('r.querySelector(".pill.on button[aria-label=\\"Video speichern\\"]").click(); return true;'))
    wait(lambda: any(x[0] != 'Schließen' for x in (pg.evaluate(js(ITEMS)) or [])), 15)
    it = pg.evaluate(js(ITEMS)) or []
    check('Angebot „%s“ im schwebenden Menü' % OFFER, OFFER in [x[0] for x in it], it)
    n0 = len(HITS)
    pg.evaluate(js('const b = Array.from(r.querySelectorAll(".dlm .dli")).find((x) => x.firstChild.textContent === %s); b.click(); return true;' % json.dumps(OFFER)))
    wait(lambda: pg.evaluate(js('const h = r.querySelector(".dlm .dlh"); return h && h.textContent === "DASH-Stream speichern";')), 30)
    o = [x for x in (pg.evaluate(js(ITEMS)) or []) if x[0] != 'Schließen']
    check('dashplan: 2 Optionen 360p (läuft gerade) und 180p, H.264 + AAC, 0:20', [x[0] for x in o] == ['360p · Ton: Sprache nicht angegeben', '180p · Ton: Sprache nicht angegeben']
          and 'läuft gerade' in o[0][1] and all('H.264 + AAC' in x[1] for x in o), o)
    mh = [x for x in HITS[n0:] if not x['browser'] and x['path'].endswith('.mpd')]
    check('Helfer lud das MPD selbst, einmal, ohne Cookie/Authorization', len(mh) == 1 and not mh[0]['cookie'] and not mh[0]['auth'], mh)
    pg.evaluate(js('const b = Array.from(r.querySelectorAll(".dlm .dli")).find((x) => x.firstChild.textContent === %s); b.click(); return true;' % json.dumps(o[0][0])))
    want = sum(os.path.getsize(os.path.join(FIX, f)) for f in ['init-1.m4s'] + ['chunk-1-%05d.m4s' % i for i in range(1, 6)] + ['init-2.m4s'] + ['chunk-2-%05d.m4s' % i for i in range(1, 7)])
    files = ['']
    wait(lambda: files.__setitem__(0, helper.cmd('dl-files')) or (':%d' % want) in files[0], 40)
    check('dashstart → Datei beim Helfer veröffentlicht (%d Bytes = Init + 5 Video- + 6 Tonstücke 360p/AAC)' % want, (':%d' % want) in files[0], files[0])
    got = [x['path'] for x in HITS[n0:] if not x['browser']]
    check('Helfer lud nur 360p + Ton, nie 180p, nie mit Cookie/Authorization', any('chunk-1-00005' in x for x in got) and any('chunk-2-00006' in x for x in got)
          and not any('chunk-0-' in x or 'init-0' in x for x in got) and not any(x['cookie'] or x['auth'] for x in HITS[n0:] if not x['browser']), got)
    pg.click('#b360'); pg.evaluate('() => { document.getElementById("v").muted = false; }'); wait(lambda: 'Stückfolge aktuell' in pg.inner_text('#w'), 30); time.sleep(1)
    dg = diag(); open(os.environ.get('DIAG_OUT', '/dev/null'), 'w').write(dg)
    print('\n'.join(l for l in dg.split('\n') if 'DASH' in l or 'dash:' in l or 'Auswahl' in l or 'Ladevorg' in l or 'Video-Element' in l))
    check('Diagnose: Manifest gebunden über Stückfolge (bound(dash-segments), Ergebnis bound (stueckfolge))', re.search(r'Bindung bound\([^)]*dash-segments', dg) and 'Ergebnis bound (stueckfolge)' in dg)
    check('Diagnose anonym (keine Adresse, kein Pfad, kein Host)', not re.search(r'://|127\.0\.0|s3d-dash|manifest\.mpd|chunk-|init-\d', dg))
    # Zeitfenster: nach > 20 s ohne neue Stücke kein neues Angebot (bewusst, nicht-aktiv); „Neu starten“ stellt es wieder her
    pg.goto(BASE + 's3d-dash.html?q=180'); pg.bring_to_front()
    wait(lambda: 'Stückfolge aktuell' in pg.inner_text('#w'), 30)
    check('Seite: Zeitfenster läuft nach dem letzten Stück ab (Hinweis „Neu starten“)', wait(lambda: 'abgelaufen' in pg.inner_text('#w'), 60), pg.inner_text('#w'))
    print('Fehler auf der Seite:', errs)
    ctx.close()
helper.close() if hasattr(helper, 'close') else None
print('ALLE PRÜFUNGEN BESTANDEN')
