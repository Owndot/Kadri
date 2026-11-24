# S0 DASH-Hinweis im echten Chromium: Video per MSE (Blob) aus fMP4-Stücken, daneben lädt die Seite ein DASH-Manifest.
#  a) Manifest ohne Endung, nur am Content-Type erkannt, Stücke aus einem anderen Ordner: nur zeitlich vermutet
#     (wie der Feldbefund) → „Vermutlich DASH-Stream – nicht sicher zugeordnet und derzeit nicht unterstützt“
#  b) Manifest *.mpd, Stücke aus seinem Ordner geladen (segments-loaded): sicher gebunden
#     → „DASH-Stream erkannt – derzeit nicht unterstützt“
# Geprüft im schwebenden Menü (Video im fremden iframe, Auswahl im Hauptfenster) und im eigenen Player; nie ein
# Download-Angebot, nichts beim Helfer angefragt. Gegenprobe: dieselbe MSE-Seite ohne Manifest → bisheriger Hinweis.
#   HELPER_HOST_DIR=<Helper-Repository: tests/java/channel/build.sh OUT>   (vorher: node tools/build.js --test)
import os, re, time, threading, http.server, urllib.parse
from common import *   # noqa: E402

HLSDIR = os.path.join(WEB, 'hls')
HITS = []
TOP, VID = 'http://localhost:8793', 'http://127.0.0.1:8791'
MPD = ('<?xml version="1.0"?><MPD xmlns="urn:mpeg:dash:schema:mpd:2011" type="static" mediaPresentationDuration="PT61.44S" minBufferTime="PT2S">'
       '<Period><AdaptationSet mimeType="video/mp4" segmentAlignment="true"><SegmentTemplate initialization="init.mp4" media="seg$Number%03d$.m4s" '
       'startNumber="0" duration="5120" timescale="1000"/><Representation id="v" bandwidth="400000" width="640" height="360" codecs="vp09.00.10.08"/>'
       '</AdaptationSet></Period></MPD>').encode()
MSE = '''<!doctype html><html><head><meta name=viewport content="width=device-width,initial-scale=1"><title>MSE</title></head>
<body style="margin:0;background:#000"><video id=v muted autoplay playsinline style="width:100%%;height:100vh;display:block"></video><script>
const v = document.getElementById("v"), mpd = %s, base = %s;
const go = async () => {
  if (mpd) await (await fetch(mpd)).text();
  const ms = new MediaSource(); v.src = URL.createObjectURL(ms);
  ms.addEventListener("sourceopen", async () => {
    const sb = ms.addSourceBuffer('video/mp4; codecs="vp09.00.10.08,opus"');
    const app = (b) => new Promise((res) => { sb.addEventListener("updateend", res, { once: true }); sb.appendBuffer(b); });
    await app(await (await fetch(base + "init.mp4")).arrayBuffer());
    v.play().catch(() => {});
    for (let i = 0; i < 12; i++) await app(await (await fetch(base + "seg" + String(i).padStart(3, "0") + ".m4s")).arrayBuffer());
    ms.endOfStream();
  });
};
go();
</script></body></html>'''
def mse_page(m):
    if m == 'a': return MSE % ('"/x/a/manifest"', '"/x/segs/"')        # vermutet: Manifest ohne Endung, Stücke anderswo
    if m == 'b': return MSE % ('"/x/b/manifest.mpd"', '"/x/b/"')       # gebunden: Stücke aus dem Ordner des Manifests
    return MSE % ('""', '"/x/segs/"')                                  # Gegenprobe: kein Manifest

class M(http.server.BaseHTTPRequestHandler):
    def log_message(self, *a): pass
    def do_GET(self):
        u = urllib.parse.urlparse(self.path); q = dict(urllib.parse.parse_qsl(u.query))
        HITS.append({'path': u.path, 'browser': bool(self.headers.get('Sec-Fetch-Mode'))})
        if u.path == '/x/mse.html': body, ctype = mse_page(q.get('m', '')).encode(), 'text/html; charset=utf-8'
        elif u.path == '/x/top.html':
            body = ('<!doctype html><html><head><meta name=viewport content="width=device-width,initial-scale=1"><title>Seite</title></head>'
                    '<body style="margin:0;height:1600px"><div style="height:60px"></div><iframe src="%s/x/mse.html?m=%s" allow="autoplay; fullscreen" allowfullscreen '
                    'style="display:block;border:0;width:100%%;height:230px"></iframe></body></html>' % (VID, q.get('m', ''))).encode(); ctype = 'text/html; charset=utf-8'
        elif u.path == '/x/a/manifest': body, ctype = MPD, 'application/dash+xml'
        elif u.path == '/x/b/manifest.mpd': body, ctype = MPD, 'application/dash+xml'
        elif re.match(r'^/x/(segs|b)/(seg\d+\.m4s|init\.mp4)$', u.path):
            body, ctype = open(os.path.join(HLSDIR, u.path.split('/')[-1]), 'rb').read(), 'video/mp4'
        else:
            self.send_response(404); self.send_header('Content-Length', '0'); self.end_headers(); return
        self.send_response(200); self.send_header('Content-Type', ctype); self.send_header('Content-Length', str(len(body)))
        self.send_header('Cache-Control', 'no-store'); self.end_headers()
        try: self.wfile.write(body)
        except Exception: pass
SRVS = []
for port in (8791, 8793):
    s = http.server.ThreadingHTTPServer(('127.0.0.1', port), M); s.daemon_threads = True; SRVS.append(s)
    threading.Thread(target=s.serve_forever, daemon=True).start()

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
def sheet_items(fr): return fr.evaluate(js('return Array.from(r.querySelectorAll(".dlm .dli")).map((b) => b.firstChild.textContent);')) or []
def player_items(fr): return fr.evaluate(js('return Array.from(r.querySelectorAll(".vmenu.on .vmi")).map((b) => b.firstChild.textContent);')) or []
# S4b: Ebenen (src/046) – Fixture VP9: gebunden → Format-Ebene; nur vermutet mit gelesenem MPD → Zuordnungs-Ebene
DS = 'DASH-Stream erkannt – Zuordnung zum Video nicht nachgewiesen'
OFFERS = ('Mit Helper herunterladen', 'Stream mit Helper herunterladen …', 'DASH-Stream mit Helper herunterladen …')
helper_hits = lambda: [x for x in HITS if not x['browser']]

helper = ChannelHelper()
check('echter Kanal-Helfer mit MP4- und HLS-Engine', helper.ready.startswith('READY') and helper.cmd('downloads 8791') == 'DOWNLOADS on' and helper.cmd('hls on') == 'HLS on')
with sync_playwright() as p:
    ctx, sw, udir = launch(p)
    ext_id = sw.url.split('/')[2]
    check('Kopplung über die Einstellungsseite', pair_helper(ctx, ext_id, helper) == 'Verbunden')
    pg = ctx.pages[0] if ctx.pages else ctx.new_page()
    errs = []; pg.on('pageerror', lambda e: errs.append(str(e)))
    def playing(fr):
        fr.wait_for_function('() => { const v = document.getElementById("v"); return v && v.currentTime > 1.2 && /^blob:/.test(v.currentSrc); }', timeout=25000)
        fr.evaluate('() => { document.getElementById("v").muted = false; }')
    def top_sheet(m):
        pg.goto(TOP + '/x/top.html?m=' + m)
        fr = wait(lambda: [f for f in pg.frames if '/x/mse.html' in f.url], 10) and [f for f in pg.frames if '/x/mse.html' in f.url][0]
        playing(fr)
        wait(lambda: pg.evaluate(js('return !!r.querySelector(".pill.on");')), 15); time.sleep(0.5)
        pg.evaluate(js('r.querySelector(".pill.on button[aria-label=\\"Video speichern\\"]").click(); return true;'))
        wait(lambda: any(x != 'Schließen' for x in sheet_items(pg)), 15)
        it = sheet_items(pg)
        pg.evaluate(js('const b = r.querySelector(".dlm .dlx"); if (b) b.click(); return true;')); time.sleep(0.4)
        return it

    # ---------- schwebendes Menü (Video im fremden iframe, Auswahl im Hauptfenster) ----------
    n0 = len(helper_hits())
    it = top_sheet('a')
    check('schwebendes Menü, DASH nur vermutet (Manifest ohne Endung, Stücke anderswo): „%s“' % DS, DS in it, it)
    check('… kein Angebot, kein generischer Hinweis', not any(x in it for x in OFFERS) and not any('Keine speicherbare Videodatei' in x for x in it), it)
    it = top_sheet('b')
    check('schwebendes Menü, DASH-Netz-Kandidat (Stücke aus dem Ordner des Manifests): „%s“' % DS, DS in it, it)
    check('… kein Angebot', not any(x in it for x in OFFERS), it)
    it = top_sheet('none')
    check('Gegenprobe ohne Manifest: bisheriger Hinweis „keine speicherbare Videodatei“, kein DASH-Hinweis',
          any('Keine speicherbare Videodatei' in x for x in it) and not any('DASH' in x for x in it), it)
    check('nichts beim Helfer angefragt (kein Plan, kein Download)', len(helper_hits()) == n0, helper_hits()[n0:])

    # ---------- eigener Player: Download-Menü ----------
    def player_menu(m):
        pg.goto(VID + '/x/mse.html?m=' + m)
        playing(pg.main_frame)
        wait(lambda: pg.evaluate(js('return !!r.querySelector(".pill.on");')), 15); time.sleep(0.5)
        pg.evaluate(js('r.querySelector(".pill.on button[aria-label=\\"Im Videoplayer öffnen\\"]").click(); return true;'))
        wait(lambda: pg.evaluate(js('return !!r.querySelector("button[aria-label^=Herunterladen]");')), 20); time.sleep(1.0)
        items = []
        end = time.time() + 15
        while time.time() < end:   # (Prüfung der Helfer-App beim ersten Öffnen: Menü kurz danach erneut öffnen)
            pg.evaluate(js('r.querySelector("button[aria-label^=Herunterladen]").dispatchEvent(new MouseEvent("contextmenu", { bubbles: true })); return true;')); time.sleep(0.5)
            items = player_items(pg)
            if any('DASH' in x or 'keine speicherbare Quelle' in x for x in items): break
            pg.evaluate(js('r.querySelector(".vmenu").classList.remove("on"); r.querySelector(".vp").classList.remove("menu"); return true;')); time.sleep(0.6)
        return items
    it = player_menu('a')
    check('eigener Player, DASH nur vermutet: „%s“' % DS, DS in it, it)
    check('… kein Angebot, kein generischer Hinweis', not any(x in it for x in OFFERS) and 'Helfer-App: keine speicherbare Quelle erkannt' not in it, it)
    it = player_menu('b')
    check('eigener Player, DASH-Netz-Kandidat: „%s“' % DS, DS in it, it)
    check('… kein Angebot', not any(x in it for x in OFFERS), it)
    it = player_menu('none')
    check('eigener Player, Gegenprobe ohne Manifest: bisheriger Hinweis, kein DASH-Hinweis', 'Helfer-App: keine speicherbare Quelle erkannt' in it and not any('DASH' in x for x in it), it)
    check('nichts beim Helfer angefragt', len(helper_hits()) == n0, helper_hits()[n0:])
    # ---------- S1: Manifest eingeordnet – anonymisierte Diagnose (Kadri-Symbol → „Anonymisiert kopieren“) ----------
    ctx.grant_permissions(['clipboard-read', 'clipboard-write'])
    def anon_diag(m):
        pg.goto(VID + '/x/mse.html?m=' + m); pg.bring_to_front()
        playing(pg.main_frame); time.sleep(1.5)
        tab = sw.evaluate('async () => (await chrome.tabs.query({})).find((t) => /\\/x\\/mse\\.html/.test(t.url)).id')
        sw.evaluate('(t) => chrome.tabs.sendMessage(t, { t: "kadri-menu" }, { frameId: 0 })', tab)
        wait(lambda: pg.evaluate(js('return !!r.querySelector(".diag .danon");')), 8)
        pg.evaluate('() => navigator.clipboard.writeText("-")')
        pg.evaluate(js('r.querySelector(".diag .danon").click(); return true;'))
        got = ['']
        wait(lambda: got.__setitem__(0, pg.evaluate('() => navigator.clipboard.readText()')) or got[0].startswith('Kadri – anonymisierte Diagnose'), 8)
        return got[0]
    MAN = ('DASH-Manifest: VOD · Perioden 1 · AdaptationSets 1 · Darstellungen 1 · Video 1 (vp9 ×1; mp4; bis 360p) · Audio 0 · Text 0 · Bild 0'
           ' · Adressierung template-duration · Schutz angegeben: nein (Verschlüsselung damit nicht ausgeschlossen)')
    for m, bind in (('a', r'ambiguous\(start-timing\)'), ('b', r'ambiguous\([^)]*dash-segments')):
        dg = anon_diag(m)
        lines = [l for l in dg.split('\n') if 'dash:' in l or 'DASH-Manifest' in l or 'Listen gelesen' in l]
        check('Diagnose (%s): Eintrag dash:manifest mit Bindung %s' % ('zeitnah' if m == 'a' else 'Netzfolge', bind), re.search(r'dash:manifest · Bindung ' + bind, dg), lines)
        check('… Manifest eingeordnet (VOD, 1 Periode, vp9/mp4 bis 360p, Template mit Dauer, Schutz nicht angegeben ≠ unverschlüsselt)', MAN in dg, lines)
        check('… Netzwerk: 1 gelesenes DASH-Manifest; Registry verweist auf die DASH-Ebenen (kein „stream-not-supported“), Ebenen-Zeile vorhanden', 'davon DASH-Manifeste 1' in dg and 'Download siehe DASH-Ebenen' in dg and 'stream-not-supported' not in dg and 'DASH-Ebenen: E1 read' in dg and 'Angebot nein' in dg and 'derzeit nicht unterstützt' not in dg, lines)
        check('… anonym: keine Adresse, kein Host, kein Pfad', not re.search(r'://|127\.0\.0|localhost|/x/|manifest\.mpd|seg0', dg), dg[:300])
    check('keine Seitenfehler', not errs, errs)
    ctx.close()
helper.stop()
for s in SRVS: s.shutdown()
shutdown()
done()
