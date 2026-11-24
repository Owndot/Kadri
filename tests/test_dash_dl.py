# DASH-Produktabnahme nach P0-A: beide Menüs zeigen die fehlende Elementzuordnung.
# Der gepaarte Desktop-Helfer ist verfügbar, erhält aber keine Planung und keinen Start.
# Die positive Protokoll-/Engine-Abnahme läuft in tests/channel/dash_integration_check.js.
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
    'swo':      {'mpd': ['/d/so/manifest.mpd'], 'segs': '/d/so/'},
}
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
BLOCKED = 'DASH-Stream erkannt – Zuordnung zum Video nicht nachgewiesen'
OFFER = 'DASH-Stream mit Helper herunterladen …'
helper_hits = lambda: [x for x in HITS if not x['browser']]

helper = ChannelHelper()
check('echter Kanal-Helfer mit MP4-, HLS- und DASH-Engine', helper.ready.startswith('READY') and helper.cmd('downloads %d' % PORT) == 'DOWNLOADS on'
      and helper.cmd('hls on') == 'HLS on' and helper.cmd('dash on') == 'DASH on')
with sync_playwright() as p:
    ctx, sw, udir = launch(p)
    ext_id = sw.url.split('/')[2]
    check('Kopplung über die Einstellungsseite', pair_helper(ctx, ext_id, helper) == 'Verbunden')
    ctx.grant_permissions(['clipboard-read', 'clipboard-write'])
    pg = ctx.pages[0] if ctx.pages else ctx.new_page()
    errs = []; pg.on('pageerror', lambda e: errs.append(str(e)))
    # S3g: anonymisierte Diagnose (wie auf dem Gerät: Kadri-Menü → Diagnose → „Anonymisiert kopieren“)
    def diag():
        tab = sw.evaluate('async () => (await chrome.tabs.query({})).find((t) => /\\/d\\/page\\.html/.test(t.url)).id')
        sw.evaluate('(t) => chrome.tabs.sendMessage(t, { t: "kadri-menu" }, { frameId: 0 })', tab)
        wait(lambda: pg.evaluate(js('return !!r.querySelector(".diag .danon");')), 8)
        pg.evaluate('() => navigator.clipboard.writeText("-")')
        pg.evaluate(js('r.querySelector(".diag .danon").click(); return true;'))
        got = ['']
        wait(lambda: got.__setitem__(0, pg.evaluate('() => navigator.clipboard.readText()')) or got[0].startswith('Kadri – anonymisierte Diagnose'), 8)
        pg.evaluate(js('const b = Array.from(r.querySelectorAll(".diag button")).find((x) => x.textContent === "Schließen"); if (b) b.click(); return true;'))
        return got[0]
    dline = lambda dg, start: next((l for l in dg.split('\n') if l.startswith(start)), '')
    danon = lambda dg: not re.search(r'://|127\.0\.0|/d/|manifest\.mpd|chunk-|init-\d', dg)
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
    def player_menu():
        pg.evaluate(js('r.querySelector(".pill.on button[aria-label=\"Im Videoplayer öffnen\"]").click(); return true;'))
        pg.wait_for_function(js('return !!r.querySelector("button[aria-label^=Herunterladen]");'))
        pg.evaluate(js('r.querySelector("button[aria-label^=Herunterladen]").dispatchEvent(new MouseEvent("contextmenu", {bubbles: true})); return true;'))
        return pg.evaluate(js('return Array.from(r.querySelectorAll(".vmenu.on .vmi")).map(b => b.firstChild.textContent);')) or []

    journal = lambda: sw.evaluate('async () => (await chrome.storage.local.get("kadri-dl-jobs"))["kadri-dl-jobs"] || []')
    old_files, old_jobs, old_hits = helper.cmd('dl-files'), journal(), len(helper_hits())
    caps = 'MP4 ja · HLS ja · DASH ja'
    for case in ('ok', 'langs', 'nolang', 'same', 'heaac', 'drm', 'unbound', 'two', 'mismatch'):
        open_case(case)
        items = sheet()
        dg = diag()
        labels = [x[0] for x in items]
        check(case + ': E1 erkannt, E2 blockiert, keine auswählbare DASH-Aktion', BLOCKED in labels and OFFER not in labels
              and 'DASH-Ebenen: E1 read · E2 ' in dg and ' · Angebot nein' in dg, (items, dline(dg, 'DASH-Ebenen:')))
        check(case + ': Fähigkeiten bleiben sichtbar und Diagnose anonym', caps in dg and danon(dg))
        if case == 'heaac':
            check('E3 weist HE-AAC weiterhin aus', ' · E3 audio-he-aac · ' in dg)
        elif case == 'drm':
            check('E3 weist DRM weiterhin aus', ' · E3 protected · ' in dg)
        elif case in ('ok', 'mismatch'):
            check(case + ': Netzfolge und Gate diagnostisch positiv', 'Ergebnis Netzfolge passt (stueckfolge)' in dg
                  and 'Vorprüfung bestanden' in dg, dline(dg, 'DASH-Stückprüfung'))
        elif case == 'two':
            check('Zwei konkurrierende MPDs bleiben unterscheidbar', dg.count('Ergebnis ambiguous (konkurrenz)') == 2)
        if case == 'ok':
            pitems = player_menu()
            check('Player zeigt denselben E2-Hinweis ohne DASH-Aktion', BLOCKED in pitems and OFFER not in pitems, pitems)
    open_case('swo')
    sheet(keep=True)
    pg.evaluate('() => window.__switch()')
    pg.wait_for_function('() => document.getElementById("v").currentTime > 0.5')
    check('Nach Medienwechsel und erneutem Öffnen bleibt DASH gesperrt', OFFER not in [x[0] for x in sheet(keep=True)])
    check('Kein DASH-Abruf beim Helfer, kein neuer Job, keine Datei',
          helper_hits()[old_hits:] == [] and journal() == old_jobs and helper.cmd('dl-files') == old_files, helper_hits()[old_hits:])
    check('Keine Seitenfehler', not errs, errs)
    ctx.close()
helper.stop()
srv.shutdown()
shutdown()
done()
