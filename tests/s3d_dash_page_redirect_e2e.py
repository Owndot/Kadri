# S3h-Regression (lokal, nicht in CI): Auslieferung wie rawcdn.githack.com – die HTML-Seite kommt direkt, MPD und Stücke
# (.mpd/.m4s) werden per 301 auf einen ANDEREN Host mit demselben Pfad umgeleitet (dort 200, ACAO *).
#  1. Gegenprobe: Seitenvariante mit dem früheren Fehler (Stücke relativ zur ANGEFRAGTEN MPD-Adresse) → genau der
#     Samsung-Befund: Stücke exakt 0, „gleicher Pfad, anderer Host“, Init anderer Host, ambiguous (keine-treffer), kein Angebot.
#  2. Unveränderte Seite tests/web/public/s3d-dash.html (Stücke relativ zur ENDGÜLTIGEN Adresse, Response.url) → bound
#     (dash-segments), Angebot, dashplan, dashstart, Datei beim Helfer; Kadris strenger Hostvergleich bleibt unverändert.
#   node tools/build.js --test; HELPER_HOST_DIR=<Helper 3887569: tests/java/channel/build.sh OUT> xvfb-run -a python3 tests/s3d_dash_page_redirect_e2e.py
import os, re, sys, time, json, threading, http.server, urllib.parse
KADRI = os.path.realpath(sys.argv[1] if len(sys.argv) > 1 else os.path.join(os.path.dirname(os.path.abspath(__file__)), '..')); sys.path.insert(0, os.path.join(KADRI, 'tests'))
from common import *   # noqa
PORT = 8791
PUB = os.path.join(KADRI, 'tests', 'web', 'public'); PREFIX = '/Owndot/Kadri/0123456789abcdef0123456789abcdef01234567/tests/web/public/'
FIX = os.path.join(PUB, 's3d-dash'); HITS = []
PAGE = open(os.path.join(PUB, 's3d-dash.html'), encoding='utf-8').read()
# Gegenprobe: genau die frühere Auflösung (relativ zur angefragten MPD-Adresse); sonst unverändert
OLD = PAGE.replace("n++), mpdBase).href", "n++), new URL(MPD, location.href)).href").replace("0), mpdBase).href", "0), new URL(MPD, location.href)).href")
# Seiten-Host (wie rawcdn.githack.com) und Ziel (wie raw.githubusercontent.com). Das Ziel ist ein gewöhnlicher Name (nicht
# „localhost“ – den lehnt der Helfer zu Recht ab: blocked_host_name); Browser und Test-Gegenstelle lösen ihn zu 127.0.0.1 auf.
TARGET_NAME = 'cdn.example.org'
FRONT, TARGET = '127.0.0.1:%d' % PORT, '%s:%d' % (TARGET_NAME, PORT)
class H(http.server.BaseHTTPRequestHandler):
    def log_message(self, *a): pass
    def do_GET(self):
        u = urllib.parse.urlparse(self.path); host = self.headers.get('Host') or ''
        HITS.append({'host': host, 'path': u.path, 'browser': bool(self.headers.get('Sec-Fetch-Mode')), 'cookie': self.headers.get('Cookie') or '', 'auth': self.headers.get('Authorization') or ''})
        rel = u.path[len(PREFIX):] if u.path.startswith(PREFIX) else None
        f = os.path.normpath(os.path.join(PUB, rel)) if rel else ''
        if not rel or not f.startswith(PUB) or not os.path.isfile(f): self.send_response(404); self.send_header('Content-Length', '0'); self.end_headers(); return
        ext = os.path.splitext(f)[1]
        if host == FRONT and ext in ('.mpd', '.m4s'):   # wie githack: 301 auf denselben Pfad beim Ziel-Host
            self.send_response(301); self.send_header('Location', 'http://%s%s' % (TARGET, self.path)); self.send_header('Access-Control-Allow-Origin', '*')
            self.send_header('Content-Length', '0'); self.end_headers(); return
        if ext == '.html' and host != FRONT: self.send_response(404); self.send_header('Content-Length', '0'); self.end_headers(); return
        body = (OLD if 'variant=old' in u.query else PAGE).encode() if ext == '.html' else open(f, 'rb').read()
        ct = {'.html': 'text/html; charset=utf-8', '.mpd': 'text/plain; charset=utf-8', '.m4s': 'application/octet-stream'}.get(ext, 'application/octet-stream')
        self.send_response(200); self.send_header('Content-Type', ct); self.send_header('Content-Length', str(len(body)))
        self.send_header('ETag', '"%x"' % (hash(body) & 0xffffffff)); self.send_header('X-Content-Type-Options', 'nosniff')
        self.send_header('Access-Control-Allow-Origin', '*'); self.end_headers(); self.wfile.write(body)
srv = http.server.ThreadingHTTPServer(('127.0.0.1', PORT), H); srv.daemon_threads = True; threading.Thread(target=srv.serve_forever, daemon=True).start()
BASE = 'http://%s%s' % (FRONT, PREFIX)
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
check('Gegenprobe vorbereitet: genau die beiden Auflösungen ersetzt', PAGE.count("n++), mpdBase).href") == 1 and PAGE.count("0), mpdBase).href") == 1 and OLD.count('new URL(MPD, location.href)).href') == 2 and 'mpdBase).href' not in OLD.replace("new URL('x', mpdBase).href", ''))
helper = ChannelHelper()
_r = [helper.ready, helper.cmd('downloads %d' % PORT), helper.cmd('hls on'), helper.cmd('dash on')]
check('Kanal-Helfer mit DASH-Engine', _r[0].startswith('READY') and _r[1] == 'DOWNLOADS on' and _r[3] == 'DASH on', _r)
with sync_playwright() as p:
    ctx, sw, udir = launch(p, extra_args=['--host-resolver-rules=MAP %s 127.0.0.1' % TARGET_NAME, '--no-proxy-server']); ext_id = sw.url.split('/')[2]
    ctx.grant_permissions(['clipboard-read', 'clipboard-write'])
    check('Kopplung', pair_helper(ctx, ext_id, helper) == 'Verbunden')
    pg = ctx.pages[0] if ctx.pages else ctx.new_page(); errs = []; pg.on('pageerror', lambda e: errs.append(str(e)))
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
    dline = lambda dg, start: next((l for l in dg.split('\n') if l.startswith(start)), '')
    num = lambda line, label: int((re.search(re.escape(label) + r' (\d+)', line) or [0, -1])[1])
    def open_page(q):
        pg.goto(BASE + 's3d-dash.html' + q); pg.bring_to_front()
        ok = wait(lambda: 'Stückfolge aktuell' in pg.inner_text('#w'), 30)
        pg.evaluate('() => { document.getElementById("v").muted = false; }'); time.sleep(1.2)   # Gerät: Ton einschalten
        return ok
    def menu():
        wait(lambda: pg.evaluate(js('return !!r.querySelector(".pill.on");')), 15); time.sleep(0.3)
        pg.evaluate(js('r.querySelector(".pill.on button[aria-label=\\"Video speichern\\"]").click(); return true;'))
        wait(lambda: any(x[0] != 'Schließen' for x in (pg.evaluate(js(ITEMS)) or [])), 15)
        return pg.evaluate(js(ITEMS)) or []
    close = lambda: pg.evaluate(js('const b = r.querySelector(".dlm .dlx"); if (b) b.click(); return true;'))

    # ---------- 1. Gegenprobe: früheres Verhalten der Seite reproduziert den Samsung-Befund ----------
    check('Gegenprobe: Seite lädt Stücke (Stückfolge aktuell)', open_page('?variant=old'), pg.inner_text('#w'))
    seg_front = [x for x in HITS if x['host'] == FRONT and x['path'].endswith('.m4s')]
    check('Gegenprobe: jedes Stück zuerst beim Seiten-Host angefragt (über die 301-Weiterleitung)', len(seg_front) >= 6, len(seg_front))
    dg = diag(); ab = dline(dg, 'DASH-Abgleich 1/1')
    print('  ' + dline(dg, 'DASH-Stückprüfung') + '\n  ' + ab)
    check('Gegenprobe: Samsung-Befund reproduziert – Stücke exakt 0, gleicher Pfad/anderer Host ≥ 6, Init anderer Host 2, sonst kein Unterschied',
          num(ab, 'Stücke exakt') == 0 and num(ab, 'gleicher Pfad, anderer Host') >= 6 and num(ab, 'Init anderer Host') == 2 and num(ab, 'nur Query abweichend') == 0
          and num(ab, 'Muster passt, Nummer/Zeitleiste abweichend') == 0, ab)
    check('Gegenprobe: Bindung ambiguous (keine-treffer) – der strenge Hostvergleich bindet nicht', 'Ergebnis ambiguous (keine-treffer)' in dline(dg, 'DASH-Stückprüfung'), dline(dg, 'DASH-Stückprüfung'))
    it = menu(); close()
    check('Gegenprobe: kein DASH-Angebot', OFFER not in [x[0] for x in it], it)

    # ---------- 2. korrigierte Seite: Stücke relativ zur endgültigen MPD-Adresse ----------
    n0 = len(HITS)
    check('Seite: Stückfolge aktuell', open_page(''), pg.inner_text('#w'))
    hosts = pg.inner_text('#a')
    check('Seite zeigt die Hosts: MPD weitergeleitet, Stücke direkt vom Ziel-Host', ('MPD angefragt %s · MPD endgültig %s · Stücke %s' % (FRONT, TARGET, TARGET)) in hosts, hosts)
    # (bis zum Plan lädt nur der Browser; an den nicht sicheren Ziel-Ursprung schickt Chromium keine Sec-Fetch-Kopfzeilen)
    seg = [x for x in HITS[n0:] if x['path'].endswith('.m4s')]
    check('… alle Stücke direkt beim Ziel-Host, keines über die Weiterleitung', len(seg) >= 6 and all(x['host'] == TARGET for x in seg), sorted(set(x['host'] for x in seg)))
    dg = diag(); ab = dline(dg, 'DASH-Abgleich 1/1')
    print('  ' + dline(dg, 'DASH-Stückprüfung') + '\n  ' + ab)
    check('Diagnose: Stücke exakt ≥ 6, Init exakt 2, kein „anderer Host“', num(ab, 'Stücke exakt') >= 6 and num(ab, 'Init exakt') >= 2 and num(ab, 'gleicher Pfad, anderer Host') == 0 and num(ab, 'Init anderer Host') == 0, ab)
    check('Diagnose: bound über dash-segments, Ergebnis bound (stueckfolge), Vorprüfung bestanden',
          re.search(r'Bindung bound\([^)]*dash-segments', dg) and 'Ergebnis bound (stueckfolge) · Vorprüfung bestanden' in dg, dline(dg, 'DASH-Stückprüfung'))
    check('Diagnose anonym', not re.search(r'://|127\.0\.0|example\.org|s3d-dash|manifest\.mpd|chunk-|init-\d', dg))
    it = menu()
    check('Angebot „%s“' % OFFER, OFFER in [x[0] for x in it], it)
    n1 = len(HITS)
    pg.evaluate(js('const b = Array.from(r.querySelectorAll(".dlm .dli")).find((x) => x.firstChild.textContent === %s); b.click(); return true;' % json.dumps(OFFER)))
    wait(lambda: pg.evaluate(js('const h = r.querySelector(".dlm .dlh"); return h && h.textContent === "DASH-Stream speichern";')), 30)
    o = [x for x in (pg.evaluate(js(ITEMS)) or []) if x[0] != 'Schließen']
    if not o:   # Diagnose bei Fehlschlag: Rückmeldung und Eintrag „Helfer-Downloads“ (anonym)
        print('  DIAG toast=%r' % pg.evaluate(js('const t = r.querySelector(".toast"); return t ? t.textContent : "";')))
        print('  DIAG ' + next((l for l in diag().split('\n') if l.startswith(' 1. Typ ')), '(kein Eintrag)'))
    check('dashplan: 360p (läuft gerade) und 180p, H.264 + AAC', [x[0] for x in o] == ['360p · Ton: Sprache nicht angegeben', '180p · Ton: Sprache nicht angegeben'] and 'läuft gerade' in o[0][1], o)
    mh = [x for x in HITS[n1:] if x['path'].endswith('.mpd')]   # nach dem Tipp lädt nur noch der Helfer das MPD
    check('… Helfer lud das MPD selbst von der endgültigen Adresse (Ziel-Host), ohne Cookie/Authorization', len(mh) == 1 and mh[0]['host'] == TARGET and not mh[0]['cookie'] and not mh[0]['auth'], mh)
    if o:
        pg.evaluate(js('const b = Array.from(r.querySelectorAll(".dlm .dli")).find((x) => x.firstChild.textContent === %s); b.click(); return true;' % json.dumps(o[0][0])))
    want = sum(os.path.getsize(os.path.join(FIX, f)) for f in ['init-1.m4s'] + ['chunk-1-%05d.m4s' % i for i in range(1, 6)] + ['init-2.m4s'] + ['chunk-2-%05d.m4s' % i for i in range(1, 7)])
    files = ['']
    wait(lambda: files.__setitem__(0, helper.cmd('dl-files')) or (':%d' % want) in files[0], 40)
    check('dashstart → Datei beim Helfer (%d Bytes = Init + 5 Video- + 6 Tonstücke)' % want, (':%d' % want) in files[0], files[0])
    hs = [x for x in HITS[n1:] if x['path'].endswith(('.mpd', '.m4s'))]   # Seite hat längst alles geladen; ab hier nur der Helfer
    check('… Helfer: nur Ziel-Host, nur 360p + Ton, nie Cookie/Authorization', hs and all(x['host'] == TARGET for x in hs) and not any('chunk-0-' in x['path'] for x in hs)
          and not any(x['cookie'] or x['auth'] for x in hs), sorted(set((x['host'], x['path'].rsplit('/', 1)[-1]) for x in hs))[:6])
    check('keine Seitenfehler', not errs, errs)
    ctx.close()
helper.stop() if hasattr(helper, 'stop') else None
done()
