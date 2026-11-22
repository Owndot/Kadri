# S3c DASH speichern – Ende zu Ende im echten Chromium mit der Erweiterung und dem echten Kanal-Helfer (ChannelServer +
# DashEngine der Helper-App mit SafeHttpClient, Fingerabdruck, S3-Profil, Plan, Sitzungsbindung, Fmp4Inspect, Journal,
# Dauerprüfung; nur der Remux ist im Desktop-Harness nachgebildet – Verkettung). Quelle: selbst erzeugt
# (tests/make_dash_source.sh: fMP4, H.264 180p/360p + AAC-LC, 20 s). Die Seite lädt das MPD und die Stücke der 360p-
# Darstellung und des Tons in Folge (so bindet Kadri: nur über beobachtete Stückfolgen) und zeigt daneben ein Video per MSE.
# Geprüft:
#  - Angebot nur bei bound + dash-segments + S3-Vorprüfung + Fähigkeit "dashdl" – im schwebenden Menü und im eigenen Player
#  - dashplan über den verschlüsselten Kanal mit Kadris Fingerabdruck; Auswahl Qualität × Ton (Ton immer benannt, die gerade
#    gespielte Kombination markiert); dashstart; der Helfer lädt genau die gewählten Darstellungen (ohne Cookies) und
#    veröffentlicht die Datei
#  - kein Angebot: HE-AAC im MPD, ContentProtection, nur zeitlich vermutet (keine Stücke), zwei konkurrierende MPDs
#  - abweichendes MPD beim Helfer (anderer Fingerabdruck): manifest_mismatch, kein Auftrag
#   HELPER_HOST_DIR=<Helper-Repository: tests/java/channel/build.sh OUT>   (vorher: node tools/build.js --test)
import os, re, time, json, threading, http.server, urllib.parse, subprocess, tempfile
from common import *   # noqa: E402

HLSDIR = os.path.join(WEB, 'hls')
SRCDIR = tempfile.mkdtemp(prefix='kadri-dash-src-')
subprocess.run(['bash', os.path.join(HERE, 'make_dash_source.sh'), SRCDIR], check=True)
MPD0 = open(os.path.join(SRCDIR, 'manifest.mpd'), encoding='utf-8').read()
PORT = 8794
VID = 'http://127.0.0.1:%d' % PORT
HITS = []
# je Fall: geladene Manifeste und welche Stücke die Seite lädt (Darstellung 1 = 360p, 2 = Ton); helper: was der Helfer bekommt
CASES = {
    'ok':       {'mpd': ['/d/ok/manifest.mpd'], 'segs': '/d/ok/'},
    'heaac':    {'mpd': ['/d/he/manifest.mpd'], 'segs': '/d/he/'},
    'drm':      {'mpd': ['/d/drm/manifest.mpd'], 'segs': '/d/drm/'},
    'unbound':  {'mpd': ['/d/ub/manifest.mpd'], 'segs': ''},
    'two':      {'mpd': ['/d/k1/manifest.mpd', '/d/k2/manifest.mpd'], 'segs': '/d/src/'},
    'mismatch': {'mpd': ['/d/mm/manifest.mpd'], 'segs': '/d/mm/'},
    # Tonauswahl: zwei Sprachen · zwei Spuren ohne Sprache (verschiedene Rate) · zwei nicht unterscheidbare Spuren
    'langs':    {'mpd': ['/d/ml/manifest.mpd'], 'segs': '/d/ml/'},
    'nolang':   {'mpd': ['/d/mn/manifest.mpd'], 'segs': '/d/mn/'},
    'same':     {'mpd': ['/d/ms/manifest.mpd'], 'segs': '/d/ms/'},
    # S3c-Fix: Quelle wechselt zwischen Plan und Start (Seite und eigener Player) – sl/ps: Plan beim Helfer verzögert
    'slow':     {'mpd': ['/d/sl/manifest.mpd'], 'segs': '/d/sl/'},
    'swo':      {'mpd': ['/d/so/manifest.mpd'], 'segs': '/d/so/'},
    'cmp':      {'mpd': ['/d/cp/manifest.mpd'], 'segs': '/d/cp/'},
    'pslow':    {'mpd': ['/d/ps/manifest.mpd'], 'segs': '/d/ps/'},
    'pswo':     {'mpd': ['/d/po/manifest.mpd'], 'segs': '/d/po/'},
    'pcmp':     {'mpd': ['/d/pc/manifest.mpd'], 'segs': '/d/pc/'},
    'pok':      {'mpd': ['/d/pk/manifest.mpd'], 'segs': '/d/pk/'},
}
SLOW = {'s': 4.0}
# konkurrierende MPDs (später geladen): beschreiben genau die schon geladenen Stücke der Fälle cmp bzw. pcmp
COMPETE = {'/d/k9/': '/d/cp/', '/d/k8/': '/d/pc/'}
AUDIO = re.search(r'<AdaptationSet id="1" contentType="audio".*?</AdaptationSet>', MPD0, re.S).group(0)
def second_audio(m, lang1, lang2, bw2):
    a2 = AUDIO.replace('id="1"', 'id="2"', 1).replace('<Representation id="2"', '<Representation id="3"').replace('bandwidth="48000"', 'bandwidth="%d"' % bw2)
    a1 = AUDIO
    if lang1: a1 = a1.replace('contentType="audio"', 'contentType="audio" lang="%s"' % lang1, 1)
    if lang2: a2 = a2.replace('contentType="audio"', 'contentType="audio" lang="%s"' % lang2, 1)
    return m.replace(AUDIO, a1 + '\n\t\t' + a2)
def mpd_for(path, browser):
    m = MPD0
    if path.startswith('/d/he/'): m = m.replace('codecs="mp4a.40.2"', 'codecs="mp4a.40.5"')
    if path.startswith('/d/drm/'): m = m.replace('<AdaptationSet id="0"', '<AdaptationSet id="0"><ContentProtection schemeIdUri="urn:mpeg:dash:mp4protection:2011" value="cenc"/></AdaptationSet><AdaptationSet id="9"', 1)
    if path.startswith('/d/k1/') or path.startswith('/d/k2/'): m = m.replace('<Period id="0" start="PT0.0S">', '<Period id="0" start="PT0.0S"><BaseURL>/d/src/</BaseURL>', 1)
    for k, base in COMPETE.items():
        if path.startswith(k): m = m.replace('<Period id="0" start="PT0.0S">', '<Period id="0" start="PT0.0S"><BaseURL>%s</BaseURL>' % base, 1)
    if path.startswith('/d/mm/') and not browser: m = m.replace('bandwidth="322838"', 'bandwidth="322839"')   # nur der Helfer sieht ein anderes MPD
    if path.startswith('/d/ml/'): m = second_audio(m, 'de', 'en', 96000)
    if path.startswith('/d/mn/'): m = second_audio(m, '', '', 96000)
    if path.startswith('/d/ms/'): m = second_audio(m, '', '', 48000)
    return m.encode()
PAGE = '''<!doctype html><html><head><meta name=viewport content="width=device-width,initial-scale=1"><title>DASH Test</title></head>
<body style="margin:0;background:#000"><video id=v muted autoplay playsinline style="width:100%%;height:100vh;display:block"></video><script>
document.cookie = "sess=GEHEIM; path=/";
const C = %s, v = document.getElementById("v");
const get = async (u) => (await fetch(u)).arrayBuffer();
(async () => {
  for (const m of C.mpd) await (await fetch(m)).text();
  if (C.segs) {   // Stücke der 360p-Darstellung und des Tons in Folge (wie ein DASH-Player)
    await get(C.segs + "init-1.m4s"); await get(C.segs + "init-2.m4s");
    for (let i = 1; i <= 5; i++) { await get(C.segs + "chunk-1-0000" + i + ".m4s"); await get(C.segs + "chunk-2-0000" + i + ".m4s"); }
  }
  // sichtbares Video per MSE (VP9 – Chromium ohne H.264), 4 × 5,12 s ≈ Länge des MPD
  const ms = new MediaSource(); v.src = URL.createObjectURL(ms);
  ms.addEventListener("sourceopen", async () => {
    const sb = ms.addSourceBuffer('video/mp4; codecs="vp09.00.10.08,opus"');
    const app = (b) => new Promise((res) => { sb.addEventListener("updateend", res, { once: true }); sb.appendBuffer(b); });
    await app(await get("/p/init.mp4"));
    v.play().catch(() => {});
    for (let i = 0; i < 4; i++) await app(await get("/p/seg" + String(i).padStart(3, "0") + ".m4s"));
    ms.endOfStream(); window.__played = 1;
  });
})();
// S3c-Fix: neues Medium im selben Element (neue Medien-Epoche) bzw. ein später geladenes, konkurrierendes MPD
window.__switch = () => new Promise((done) => {
  const ms = new MediaSource(); v.src = URL.createObjectURL(ms);
  ms.addEventListener("sourceopen", async () => {
    const sb = ms.addSourceBuffer('video/mp4; codecs="vp09.00.10.08,opus"');
    const app = (b) => new Promise((res) => { sb.addEventListener("updateend", res, { once: true }); sb.appendBuffer(b); });
    await app(await get("/p/init.mp4")); v.play().catch(() => {});
    for (let i = 0; i < 4; i++) await app(await get("/p/seg" + String(i).padStart(3, "0") + ".m4s"));
    ms.endOfStream(); done(1);
  });
});
window.__compete = async (m) => { await (await fetch(m)).text(); return 1; };
</script></body></html>'''

class M(http.server.BaseHTTPRequestHandler):
    def log_message(self, *a): pass
    def do_GET(self):
        u = urllib.parse.urlparse(self.path); q = dict(urllib.parse.parse_qsl(u.query))
        browser = bool(self.headers.get('Sec-Fetch-Mode'))
        HITS.append({'path': u.path, 'browser': browser, 'cookie': self.headers.get('Cookie') or '', 'auth': self.headers.get('Authorization') or '',
                     'referer': self.headers.get('Referer') or ''})
        body, ctype = None, ''
        if u.path == '/d/page.html': body, ctype = (PAGE % json.dumps(CASES[q['m']])).encode(), 'text/html; charset=utf-8'
        elif u.path.endswith('/manifest.mpd'):
            if not browser and (u.path.startswith('/d/sl/') or u.path.startswith('/d/ps/')): time.sleep(SLOW['s'])   # Plan beim Helfer dauert
            body, ctype = mpd_for(u.path, browser), 'application/dash+xml'
        elif re.match(r'^/p/(init\.mp4|seg\d{3}\.m4s)$', u.path): body, ctype = open(os.path.join(HLSDIR, u.path[3:]), 'rb').read(), 'video/mp4'
        else:
            m = re.match(r'^/d/\w+/((?:init-\d|chunk-\d-\d{5})\.m4s)$', u.path)
            if m and os.path.isfile(os.path.join(SRCDIR, m.group(1))): body, ctype = open(os.path.join(SRCDIR, m.group(1)), 'rb').read(), 'video/mp4'
        if body is None:
            self.send_response(404); self.send_header('Content-Length', '0'); self.end_headers(); return
        self.send_response(200); self.send_header('Content-Type', ctype); self.send_header('Content-Length', str(len(body)))
        if ctype == 'video/mp4': self.send_header('ETag', '"%x"' % (hash(body) & 0xffffffff))
        self.send_header('Cache-Control', 'no-store'); self.end_headers()
        try: self.wfile.write(body)
        except Exception: pass
srv = http.server.ThreadingHTTPServer(('127.0.0.1', PORT), M); srv.daemon_threads = True
threading.Thread(target=srv.serve_forever, daemon=True).start()

def wait(pred, secs=10):
    end = time.time() + secs
    while time.time() < end:
        try:
            if pred(): return True
        except Exception: pass
        time.sleep(0.15)
    return False
UI = '(() => { const h = document.querySelector("[data-kadri-test]"); return h && h.shadowRoot; })()'
def js(sel): return '() => { const r = %s; if (!r) return null; %s }' % (UI, sel)
ITEMS = 'return Array.from(r.querySelectorAll(".dlm .dli")).map((b) => [b.firstChild.textContent, b.querySelector("small") ? b.querySelector("small").textContent : ""]);'
DB = 'DASH-Stream erkannt – derzeit nicht unterstützt'
OFFER = 'DASH-Stream mit Helper herunterladen …'
helper_hits = lambda: [x for x in HITS if not x['browser']]

helper = ChannelHelper()
check('echter Kanal-Helfer mit MP4-, HLS- und DASH-Engine', helper.ready.startswith('READY') and helper.cmd('downloads %d' % PORT) == 'DOWNLOADS on'
      and helper.cmd('hls on') == 'HLS on' and helper.cmd('dash on') == 'DASH on')
with sync_playwright() as p:
    ctx, sw, udir = launch(p)
    ext_id = sw.url.split('/')[2]
    check('Kopplung über die Einstellungsseite', pair_helper(ctx, ext_id, helper) == 'Verbunden')
    pg = ctx.pages[0] if ctx.pages else ctx.new_page()
    errs = []; pg.on('pageerror', lambda e: errs.append(str(e)))
    def open_case(m):
        pg.goto(VID + '/d/page.html?m=' + m); pg.bring_to_front()
        pg.wait_for_function('() => window.__played >= 1', timeout=40000)
        pg.evaluate('() => { document.getElementById("v").muted = false; }')
        time.sleep(1.2)
    def sheet(keep=False):
        wait(lambda: pg.evaluate(js('return !!r.querySelector(".pill.on");')), 15); time.sleep(0.3)
        pg.evaluate(js('r.querySelector(".pill.on button[aria-label=\\"Video speichern\\"]").click(); return true;'))
        wait(lambda: any(x[0] != 'Schließen' for x in (pg.evaluate(js(ITEMS)) or [])), 15)
        it = pg.evaluate(js(ITEMS)) or []
        if not keep: close_sheet()
        return it
    def close_sheet():
        pg.evaluate(js('const b = r.querySelector(".dlm .dlx"); if (b) b.click(); return true;')); time.sleep(0.3)
    def tap(label):
        return pg.evaluate(js('const b = Array.from(r.querySelectorAll(".dlm .dli")).find((x) => x.firstChild.textContent === %s); if (!b) return false; b.click(); return true;' % json.dumps(label)))
    def toast_text():
        got = ['']
        wait(lambda: got.__setitem__(0, pg.evaluate(js('const t = r.querySelector(".toast.on"); return t ? t.textContent : "";')) or '') or bool(got[0]), 8)
        return got[0]
    labels = lambda it: [x[0] for x in it]

    # ---------- Gutfall: Angebot → Plan → Auswahl → Start → Datei beim Helfer ----------
    open_case('ok')
    it = sheet(keep=True)
    check('gebunden (Stücke in Folge), Profil passt, Helfer meldet dashdl: Angebot „%s“ im schwebenden Menü' % OFFER, OFFER in labels(it) and DB not in labels(it), it)
    n0 = len(helper_hits())
    check('Menü öffnen fragt den Helfer nichts zum Stream (kein Abruf des MPD)', not any(x['path'].endswith('.mpd') for x in helper_hits()), helper_hits())
    tap(OFFER)
    wait(lambda: pg.evaluate(js('const h = r.querySelector(".dlm .dlh"); return h && h.textContent === "DASH-Stream speichern";')), 30)
    opts = pg.evaluate(js(ITEMS)) or []
    o = [x for x in opts if x[0] != 'Schließen']
    check('Plan beim Helfer (MPD selbst geladen, Fingerabdruck gleich): Auswahl 360p und 180p, Ton benannt, die gespielte Kombination zuerst und markiert',
          [x[0] for x in o] == ['360p · Ton: Sprache nicht angegeben', '180p · Ton: Sprache nicht angegeben'] and 'läuft gerade' in o[0][1] and 'läuft gerade' not in o[1][1]
          and all('H.264 + AAC' in x[1] for x in o), opts)
    mpd_hits = [x for x in helper_hits()[n0:] if x['path'].endswith('.mpd')]
    check('… der Helfer hat das MPD genau einmal selbst geladen (Plan), ohne Cookie/Authorization', len(mpd_hits) == 1 and mpd_hits[0]['path'] == '/d/ok/manifest.mpd'
          and not mpd_hits[0]['cookie'] and not mpd_hits[0]['auth'], mpd_hits)
    tap(o[0][0])
    t = ['']
    wait(lambda: t.__setitem__(0, pg.evaluate(js('const t = r.querySelector(".toast.on"); return t ? t.textContent : "";')) or '') or t[0].startswith('Helfer-App lädt'), 20)
    check('Start per Tipp: Rückmeldung „Helfer-App lädt …“ (nach „startet …“)', t[0].startswith('Helfer-App lädt'), t[0])
    want = sum(os.path.getsize(os.path.join(SRCDIR, f)) for f in ['init-1.m4s'] + ['chunk-1-%05d.m4s' % i for i in range(1, 6)] + ['init-2.m4s'] + ['chunk-2-%05d.m4s' % i for i in range(1, 7)])
    files = ['']
    wait(lambda: files.__setitem__(0, helper.cmd('dl-files')) or ':%d' % want in files[0], 40)
    check('Helfer hat die Datei veröffentlicht (Init + 5 Video- und 6 Tonstücke der gewählten Darstellungen, %d Bytes)' % want, re.search(r'DASH_Test\.mp4:%d\b' % want, files[0]), files[0])
    got = [x['path'] for x in helper_hits()[n0:]]
    check('… geladen wurden nur die gewählten Darstellungen (keine Stücke der 180p-Darstellung), nie mit Cookie/Authorization',
          any('chunk-1-00005' in x for x in got) and any('chunk-2-00006' in x for x in got) and not any('chunk-0-' in x or 'init-0' in x for x in got)
          and not any(x['cookie'] or x['auth'] for x in helper_hits()[n0:]), got)
    check('… Referer beim Helfer höchstens die Herkunft der Seite (kein Pfad, keine Query)', all(x['referer'] in ('', VID + '/') for x in helper_hits()[n0:]),
          sorted(set(x['referer'] for x in helper_hits()[n0:])))
    it = sheet()
    check('dieselbe Seite erneut: Angebot bleibt (fertiger Auftrag blockiert keinen neuen Start)', OFFER in labels(it), it)

    # ---------- eigener Player: dasselbe Angebot im Download-Menü ----------
    pg.evaluate(js('r.querySelector(".pill.on button[aria-label=\\"Im Videoplayer öffnen\\"]").click(); return true;'))
    wait(lambda: pg.evaluate(js('return !!r.querySelector("button[aria-label^=Herunterladen]");')), 20); time.sleep(1.0)
    pitems = []
    end = time.time() + 15
    while time.time() < end:
        pg.evaluate(js('r.querySelector("button[aria-label^=Herunterladen]").dispatchEvent(new MouseEvent("contextmenu", { bubbles: true })); return true;')); time.sleep(0.6)
        pitems = pg.evaluate(js('return Array.from(r.querySelectorAll(".vmenu.on .vmi")).map((b) => b.firstChild.textContent);')) or []
        if OFFER in pitems: break
        pg.evaluate(js('r.querySelector(".vmenu").classList.remove("on"); r.querySelector(".vp").classList.remove("menu"); return true;')); time.sleep(0.6)
    check('eigener Player: dasselbe Angebot „%s“ im Download-Menü' % OFFER, OFFER in pitems, pitems)

    # ---------- Tonauswahl im Sheet: immer benannt, nie stillschweigend ----------
    def plan_items(m):
        open_case(m); sheet(keep=True); tap(OFFER)
        wait(lambda: pg.evaluate(js('const h = r.querySelector(".dlm .dlh"); return h && h.textContent === "DASH-Stream speichern";')), 30)
        its = [x for x in (pg.evaluate(js(ITEMS)) or []) if x[0] != 'Schließen']
        close_sheet()
        return its
    its = plan_items('langs')
    check('zwei Tonsprachen: alle Kombinationen Qualität × Ton, Sprache benannt, gespielte Kombination (360p · Deutsch) zuerst',
          [x[0] for x in its] == ['360p · Ton: Deutsch', '360p · Ton: Englisch', '180p · Ton: Deutsch', '180p · Ton: Englisch'] and 'läuft gerade' in its[0][1]
          and not any('läuft gerade' in x[1] for x in its[1:]), its)
    its = plan_items('nolang')
    check('zwei Tonspuren ohne Sprachangabe: als „Tonspur 1/2 (Sprache nicht angegeben)“ unterscheidbar wählbar',
          [x[0] for x in its] == ['360p · Ton: Tonspur 1 (Sprache nicht angegeben)', '360p · Ton: Tonspur 2 (Sprache nicht angegeben)',
                                  '180p · Ton: Tonspur 1 (Sprache nicht angegeben)', '180p · Ton: Tonspur 2 (Sprache nicht angegeben)'], its)
    open_case('same'); sheet(keep=True); tap(OFFER)
    t = ['']
    wait(lambda: t.__setitem__(0, pg.evaluate(js('const t = r.querySelector(".toast.on"); return t ? t.textContent : "";')) or '') or 'eindeutig' in t[0], 30)
    check('zwei nicht unterscheidbare Tonspuren (gleiche Rate, keine Sprache): keine Auswahl angeboten („nicht eindeutig zuordenbar“)',
          'Auswahl nicht eindeutig zuordenbar – nicht angeboten' in t[0] and not pg.evaluate(js('const h = r.querySelector(".dlm .dlh"); return !!(h && h.textContent === "DASH-Stream speichern");')), t[0])

    # ---------- S3c-Fix: Quelle wechselt zwischen dashplan und dashstart → keine Auswahl bzw. kein Start ----------
    CHANGED = 'Quelle hat sich geändert – erneut auswählen'
    def toast_has(sub, secs=20):
        t = ['']
        wait(lambda: t.__setitem__(0, pg.evaluate(js('const t = r.querySelector(".toast.on"); return t ? t.textContent : "";')) or '') or sub in t[0], secs)
        return t[0]
    segs_since = lambda n: [x['path'] for x in helper_hits()[n:] if '/init-' in x['path'] or '/chunk-' in x['path']]
    title_is = lambda t: pg.evaluate(js('const h = r.querySelector(".dlm .dlh"); return !!(h && h.textContent === %s);' % json.dumps(t)))
    # Webseitenknopf
    open_case('slow'); sheet(keep=True); n = len(helper_hits()); files0 = helper.cmd('dl-files')
    tap(OFFER); time.sleep(1.0)
    pg.evaluate('() => window.__switch()')
    t = toast_has(CHANGED, 25)
    check('Seite: Quelle wechselt, während der Plan beim Helfer läuft → keine Auswahl, Meldung „%s“' % CHANGED,
          CHANGED in t and not title_is('DASH-Stream speichern') and not segs_since(n) and helper.cmd('dl-files') == files0, (t, segs_since(n)))
    open_case('swo'); sheet(keep=True); tap(OFFER)
    wait(lambda: title_is('DASH-Stream speichern'), 30)
    o = [x for x in (pg.evaluate(js(ITEMS)) or []) if x[0] != 'Schließen']
    n = len(helper_hits()); files0 = helper.cmd('dl-files')
    pg.evaluate('() => window.__switch()'); time.sleep(1.0)
    tap(o[0][0]); t = toast_has(CHANGED); time.sleep(1.5)
    check('Seite: Quelle wechselt bei offener Auswahl → kein dashstart (kein Abruf beim Helfer, keine Datei), Meldung', bool(o) and CHANGED in t
          and not segs_since(n) and helper.cmd('dl-files') == files0, (o, t, segs_since(n)))
    open_case('cmp'); sheet(keep=True); tap(OFFER)
    wait(lambda: title_is('DASH-Stream speichern'), 30)
    o = [x for x in (pg.evaluate(js(ITEMS)) or []) if x[0] != 'Schließen']
    n = len(helper_hits()); files0 = helper.cmd('dl-files')
    pg.evaluate('() => window.__compete("/d/k9/manifest.mpd")'); time.sleep(1.0)
    tap(o[0][0]); t = toast_has(CHANGED); time.sleep(1.5)
    check('Seite: zweites MPD beschreibt dieselben Stücke (Konkurrenz) bei offener Auswahl → kein Start, Meldung', bool(o) and CHANGED in t
          and not segs_since(n) and helper.cmd('dl-files') == files0, (o, t, segs_since(n)))
    # eigener Player
    PI = 'return Array.from(r.querySelectorAll(".vmenu.on .vmi")).map((b) => b.firstChild.textContent);'
    def player_offer():
        pg.evaluate(js('r.querySelector(".pill.on button[aria-label=\\"Im Videoplayer öffnen\\"]").click(); return true;'))
        wait(lambda: pg.evaluate(js('return !!r.querySelector("button[aria-label^=Herunterladen]");')), 20); time.sleep(1.0)
        end = time.time() + 15
        while time.time() < end:
            pg.evaluate(js('r.querySelector("button[aria-label^=Herunterladen]").dispatchEvent(new MouseEvent("contextmenu", { bubbles: true })); return true;')); time.sleep(0.6)
            if OFFER in (pg.evaluate(js(PI)) or []): return True
            pg.evaluate(js('r.querySelector(".vmenu").classList.remove("on"); r.querySelector(".vp").classList.remove("menu"); return true;')); time.sleep(0.6)
        return False
    ptap = lambda label: pg.evaluate(js('const b = Array.from(r.querySelectorAll(".vmenu.on .vmi")).find((x) => x.firstChild.textContent === %s); if (!b) return false; b.click(); return true;' % json.dumps(label)))
    def player_options():
        wait(lambda: any('· Ton:' in x for x in (pg.evaluate(js(PI)) or [])), 30)
        return [x for x in (pg.evaluate(js(PI)) or []) if '· Ton:' in x]
    open_case('pslow'); ok_offer = player_offer(); n = len(helper_hits()); files0 = helper.cmd('dl-files')
    ptap(OFFER); time.sleep(1.0)
    pg.evaluate('() => window.__switch()')
    t = toast_has(CHANGED, 25); time.sleep(0.5)
    check('Player: Quelle wechselt, während der Plan läuft → keine Auswahl, Meldung', ok_offer and CHANGED in t
          and not any('· Ton:' in x for x in (pg.evaluate(js(PI)) or [])) and not segs_since(n) and helper.cmd('dl-files') == files0, (t, segs_since(n)))
    open_case('pswo'); ok_offer = player_offer(); ptap(OFFER); po = player_options()
    n = len(helper_hits()); files0 = helper.cmd('dl-files')
    pg.evaluate('() => window.__switch()'); time.sleep(1.0)
    ptap(po[0] if po else ''); t = toast_has(CHANGED); time.sleep(1.5)
    check('Player: Quelle wechselt bei offener Auswahl → kein Start, Meldung', ok_offer and bool(po) and CHANGED in t and not segs_since(n)
          and helper.cmd('dl-files') == files0, (po, t, segs_since(n)))
    open_case('pcmp'); ok_offer = player_offer(); ptap(OFFER); po = player_options()
    n = len(helper_hits()); files0 = helper.cmd('dl-files')
    pg.evaluate('() => window.__compete("/d/k8/manifest.mpd")'); time.sleep(1.0)
    ptap(po[0] if po else ''); t = toast_has(CHANGED); time.sleep(1.5)
    check('Player: konkurrierendes MPD bei offener Auswahl → kein Start, Meldung', ok_offer and bool(po) and CHANGED in t and not segs_since(n)
          and helper.cmd('dl-files') == files0, (po, t, segs_since(n)))
    open_case('pok'); ok_offer = player_offer(); ptap(OFFER); po = player_options()
    files0 = helper.cmd('dl-files')
    ptap(po[0] if po else '')
    files = ['']
    wait(lambda: files.__setitem__(0, helper.cmd('dl-files')) or files[0].count(':%d' % want) > files0.count(':%d' % want), 40)
    check('Player: unveränderter Player und unveränderte Bindung → normaler Download bis zur Datei beim Helfer', ok_offer and po and po[0].startswith('360p')
          and files[0].count(':%d' % want) == files0.count(':%d' % want) + 1, (po, files0, files[0]))

    # ---------- kein Angebot ----------
    n1 = len(helper_hits())
    open_case('heaac'); it = sheet()
    check('MPD nur mit HE-AAC (mp4a.40.5): kein Angebot, Hinweis „%s“ mit Grund „Tonformat nicht unterstützt (nur AAC-LC)“' % DB,
          OFFER not in labels(it) and [DB, 'Tonformat nicht unterstützt (nur AAC-LC)'] in it, it)
    open_case('drm'); it = sheet()
    check('MPD mit ContentProtection: kein Angebot, Grund „geschützt (DRM) – nicht speicherbar“', OFFER not in labels(it)
          and any(x[1] == 'geschützt (DRM) – nicht speicherbar' for x in it), it)
    open_case('unbound'); it = sheet()
    check('MPD geladen, aber keine seiner Stücke (nur zeitliche Nähe): kein Angebot, kein „erkannt“', OFFER not in labels(it) and DB not in labels(it), it)
    open_case('two'); it = sheet()
    check('zwei MPDs beschreiben dieselben geladenen Stücke (nicht eindeutig zuordenbar): kein Angebot', OFFER not in labels(it) and DB not in labels(it), it)
    check('in keinem dieser Fälle etwas beim Helfer angefragt (kein Plan, kein Abruf)', len(helper_hits()) == n1, helper_hits()[n1:])

    # ---------- abweichendes MPD beim Helfer ----------
    open_case('mismatch'); it = sheet(keep=True)
    check('MPD, das der Helfer anders bekommt: Angebot (Kadris Prüfung besteht)', OFFER in labels(it), it)
    before = helper.cmd('dl-files')
    tap(OFFER)
    t = toast_text()
    t2 = ['']
    wait(lambda: t2.__setitem__(0, pg.evaluate(js('const t = r.querySelector(".toast.on"); return t ? t.textContent : "";')) or '') or 'weicht' in t2[0], 30)
    check('… Plan abgelehnt: „Das Manifest beim Helfer weicht vom gespielten ab – nicht gespeichert“, keine Auswahl, kein Auftrag',
          'Das Manifest beim Helfer weicht vom gespielten ab – nicht gespeichert' in t2[0] and helper.cmd('dl-files') == before
          and not pg.evaluate(js('const h = r.querySelector(".dlm .dlh"); return !!(h && h.textContent === "DASH-Stream speichern");')), (t, t2[0]))
    check('keine Seitenfehler', not errs, errs)
    ctx.close()
helper.stop()
done()
