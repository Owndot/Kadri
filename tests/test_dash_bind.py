# S2 DASH im echten Chromium mit der Erweiterung: Bindung eines gelesenen MPD an das laufende Video nur über tatsächlich
# beobachtete Stückabrufe in Folge (je Darstellung) – nie über zeitliche Nähe. Video per MSE aus fMP4-Stücken.
# Fälle: BaseURL-Kette (MPD ohne Endung, nur Content-Type), SegmentTimeline ($Time$), SegmentList, Namensraum-Präfix
# (dash:MPD), MPD unter einer .m3u8-Adresse (Inhalt schlägt Adresse), konkurrierende MPDs, zu wenige Stücke, Stücke aus
# einem Web-Worker (unsichtbar → ambiguous), kein MPD (feed mit eingebettetem dash:MPD → verworfen), Medienwechsel.
# Diagnose Stufe 1: Beobachter-Zählung (getrennt vom Zeitleisten-Puffer) und stufenweiser MPD-Abgleich – Stücke mit
# abweichender Query, gleichem Pfad auf anderem Host oder Zeiten außerhalb der Zeitleiste werden gezählt, binden aber nie.
# Geprüft über den Hinweis im Download-Menü (kein Angebot!) und die anonymisierte Diagnose (Treffer, Grund).
#   HELPER_HOST_DIR=<Helper-Repository: tests/java/channel/build.sh OUT>   (vorher: node tools/build.js --test)
import os, re, time, json, threading, http.server, urllib.parse
from common import *   # noqa: E402

HLSDIR = os.path.join(WEB, 'hls')
HITS = []
VID = 'http://127.0.0.1:8791'
N, SEG = 12, 5.12
NS = 'urn:mpeg:dash:schema:mpd:2011'
def mpd(body, base='', prefix=''):
    p = prefix + ':' if prefix else ''
    x = ('<?xml version="1.0"?><{p}MPD xmlns{c}="{ns}" type="static" mediaPresentationDuration="PT61.44S" minBufferTime="PT2S">' + ('<{p}BaseURL>' + base + '</{p}BaseURL>' if base else '') +
         '<{p}Period><{p}AdaptationSet mimeType="video/mp4" codecs="vp09.00.10.08">' + body + '</{p}AdaptationSet></{p}Period></{p}MPD>')
    return x.replace('{p}', p).replace('{c}', ':' + prefix if prefix else '').replace('{ns}', NS).encode()
TPL_NUM = '<SegmentTemplate initialization="init.mp4" media="seg$Number%03d$.m4s" startNumber="0" duration="5120" timescale="1000"/><Representation id="v" bandwidth="400000" width="640" height="360"/>'
TPL_TIME = ('<SegmentTemplate initialization="init.mp4" media="$Time$.m4s" timescale="1000"><SegmentTimeline><S t="0" d="5120" r="11"/></SegmentTimeline></SegmentTemplate>'
            '<Representation id="v" bandwidth="400000" width="640" height="360"/>')
LIST = ('<Representation id="v" bandwidth="400000" width="640" height="360"><SegmentList timescale="1000" duration="5120"><Initialization sourceURL="init.mp4"/>' +
        ''.join('<SegmentURL media="a-%d.m4s"/>' % i for i in range(N)) + '</SegmentList></Representation>')
# je Fall: geladene Manifeste, Stückquelle der Wiedergabe, Worker, Medienwechsel
CASES = {
    'chain':   {'mpd': ['/y/c/manifest'], 'play': 'num:/y/segs/'},
    'time':    {'mpd': ['/y/t/manifest.mpd'], 'play': 'time:/y/t/'},
    'list':    {'mpd': ['/y/l/manifest.mpd'], 'play': 'list:/y/l/'},
    'prefix':  {'mpd': ['/y/p/manifest'], 'play': 'num:/y/segs/'},
    'hlsurl':  {'mpd': ['/y/h/stream.m3u8'], 'play': 'num:/y/segs/'},
    'compete': {'mpd': ['/y/k1/manifest.mpd', '/y/k2/manifest.mpd'], 'play': 'num:/y/segs/'},
    'few':     {'mpd': ['/y/f/manifest.mpd'], 'play': 'num:/y/z/', 'extra': ['/y/f/seg000.m4s', '/y/f/seg001.m4s']},
    'worker':  {'mpd': ['/y/w/manifest'], 'play': 'num:/y/segs/', 'worker': True},
    'notmpd':  {'mpd': ['/y/n/feed'], 'play': 'num:/y/segs/'},
    'switch':  {'mpd': ['/y/c/manifest'], 'play': 'num:/y/segs/', 'switch': 'num:/y/z/'},
    # Identität über die Query: zwei MPDs mit gleichem Pfad, andere Query; Stücke gleichen Pfads mit ?video=A
    'qtwo':    {'mpd': ['/y/q/manifest.mpd?video=A', '/y/q/manifest.mpd?video=B'], 'play': 'num:/y/q/:?video=A'},
    'qwrong':  {'mpd': ['/y/q/manifest.mpd?video=A'], 'play': 'num:/y/q/:?video=B'},
    # Diagnose Stufe 1 (nur Zählung, nie Bindung): Query angehängt / anderer Host, gleicher Pfad / Zeiten neben der Zeitleiste
    'dq':      {'mpd': ['/y/c/manifest'], 'play': 'num:/y/segs/:?tok=1'},
    'dhost':   {'mpd': ['/y/c/manifest'], 'play': 'num:/y/segs/', 'host': 'http://localhost:8791'},
    'dnum':    {'mpd': ['/y/t/manifest.mpd'], 'play': 'toff:/y/t/'},
}
MPDS = {'/y/c/manifest': mpd(TPL_NUM, base='/y/segs/'), '/y/t/manifest.mpd': mpd(TPL_TIME), '/y/l/manifest.mpd': mpd(LIST),
        '/y/p/manifest': mpd(TPL_NUM.replace('<Seg', '<dash:Seg').replace('<Rep', '<dash:Rep'), base='/y/segs/', prefix='dash'),
        '/y/h/stream.m3u8': mpd(TPL_NUM, base='/y/segs/'), '/y/k1/manifest.mpd': mpd(TPL_NUM, base='/y/segs/'),
        '/y/k2/manifest.mpd': mpd(TPL_NUM, base='/y/segs/'), '/y/f/manifest.mpd': mpd(TPL_NUM), '/y/w/manifest': mpd(TPL_NUM, base='/y/segs/'),
        '/y/n/feed': ('<?xml version="1.0"?><feed xmlns:dash="%s"><title>x</title><dash:MPD type="static"><dash:Period/></dash:MPD></feed>' % NS).encode()}
PAGE = '''<!doctype html><html><head><meta name=viewport content="width=device-width,initial-scale=1"><title>DASH</title></head>
<body style="margin:0;background:#000"><video id=v muted autoplay playsinline style="width:100%%;height:100vh;display:block"></video><script>
const C = %s, v = document.getElementById("v");
const name = (p, i) => { const [k, b, q] = p.split(":"); return (C.host || "") + b + (k === "time" ? String(Math.round(i * 5120)) + ".m4s" : k === "toff" ? String(Math.round(i * 5120) + 7) + ".m4s" : k === "list" ? "a-" + i + ".m4s" : "seg" + String(i).padStart(3, "0") + ".m4s") + (q || ""); };
const initOf = (p) => (C.host || "") + p.split(":")[1] + "init.mp4" + (p.split(":")[2] || "");
const WORKER = "onmessage = async (e) => { const r = await fetch(e.data); postMessage(await r.arrayBuffer()); };";
const viaWorker = (u) => new Promise((res) => { const w = window.__w || (window.__w = new Worker(URL.createObjectURL(new Blob([WORKER], { type: "text/javascript" }))));
  w.onmessage = (e) => res(e.data); w.postMessage(new URL(u, location.href).href); });
const get = async (u) => (C.worker ? viaWorker(u) : (await fetch(u)).arrayBuffer());
const play = (p) => new Promise((done) => {
  const ms = new MediaSource(); v.src = URL.createObjectURL(ms);
  ms.addEventListener("sourceopen", async () => {
    const sb = ms.addSourceBuffer('video/mp4; codecs="vp09.00.10.08,opus"');
    const app = (b) => new Promise((res) => { sb.addEventListener("updateend", res, { once: true }); sb.appendBuffer(b); });
    await app(await get(initOf(p)));
    v.play().catch(() => {});
    for (let i = 0; i < %d; i++) await app(await get(name(p, i)));
    ms.endOfStream(); done();
  });
});
(async () => {
  for (const m of C.mpd) await (await fetch(m)).text();
  for (const x of (C.extra || [])) await (await fetch(x)).arrayBuffer();
  await play(C.play);
  window.__played = 1;
  if (C.switch) { await new Promise((r) => setTimeout(r, 4500)); await play(C["switch"]); window.__played = 2; }
})();
</script></body></html>'''

class M(http.server.BaseHTTPRequestHandler):
    def log_message(self, *a): pass
    def do_GET(self):
        u = urllib.parse.urlparse(self.path); q = dict(urllib.parse.parse_qsl(u.query))
        HITS.append({'path': u.path, 'browser': bool(self.headers.get('Sec-Fetch-Mode'))})
        body, ctype = None, ''
        if u.path == '/y/page.html': body, ctype = (PAGE % (json.dumps(CASES[q['m']]), N)).encode(), 'text/html; charset=utf-8'
        elif u.path == '/y/q/manifest.mpd':   # je Query ein eigenes MPD: Vorlage trägt die Video-Identität in der Query
            v = q.get('video', 'X')
            body, ctype = mpd(TPL_NUM.replace('seg$Number%03d$.m4s', 'seg$Number%03d$.m4s?video=' + v).replace('init.mp4', 'init.mp4?video=' + v)), 'application/dash+xml'
        elif u.path in MPDS: body, ctype = MPDS[u.path], 'application/dash+xml'
        else:
            m = re.match(r'^/y/\w+/(?:seg(\d{3})\.m4s|a-(\d+)\.m4s|(\d+)\.m4s|(init)\.mp4)$', u.path)
            if m:
                f = 'init.mp4' if m.group(4) else 'seg%03d.m4s' % (int(m.group(1)) if m.group(1) else int(m.group(2)) if m.group(2) else int(m.group(3)) // 5120)
                body, ctype = open(os.path.join(HLSDIR, f), 'rb').read(), 'video/mp4'
        if body is None:
            self.send_response(404); self.send_header('Content-Length', '0'); self.end_headers(); return
        self.send_response(200); self.send_header('Content-Type', ctype); self.send_header('Content-Length', str(len(body)))
        self.send_header('Cache-Control', 'no-store'); self.send_header('Access-Control-Allow-Origin', '*'); self.end_headers()
        try: self.wfile.write(body)
        except Exception: pass
srv = http.server.ThreadingHTTPServer(('127.0.0.1', 8791), M); srv.daemon_threads = True
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
# S4b: Ebenen (src/046) – Fixtures VP9/Opus: gebunden → Format-Ebene; nicht gebunden → Zuordnungs-Ebene
DS = 'DASH-Stream erkannt – Zuordnung zum Video nicht nachgewiesen'
OFFERS = ('Mit Helper herunterladen', 'Stream mit Helper herunterladen …', 'DASH-Stream mit Helper herunterladen …')

helper = ChannelHelper()
check('echter Kanal-Helfer mit MP4- und HLS-Engine', helper.ready.startswith('READY') and helper.cmd('downloads 8791') == 'DOWNLOADS on' and helper.cmd('hls on') == 'HLS on')
with sync_playwright() as p:
    ctx, sw, udir = launch(p)
    ext_id = sw.url.split('/')[2]
    check('Kopplung über die Einstellungsseite', pair_helper(ctx, ext_id, helper) == 'Verbunden')
    ctx.grant_permissions(['clipboard-read', 'clipboard-write'])
    pg = ctx.pages[0] if ctx.pages else ctx.new_page()
    errs = []; pg.on('pageerror', lambda e: errs.append(str(e)))
    def open_case(m, played=1):
        pg.goto(VID + '/y/page.html?m=' + m); pg.bring_to_front()
        pg.wait_for_function('(n) => window.__played >= n', arg=played, timeout=40000)
        pg.evaluate('() => { document.getElementById("v").muted = false; }')
        time.sleep(1.2)
    def hint():
        wait(lambda: pg.evaluate(js('return !!r.querySelector(".pill.on");')), 15); time.sleep(0.3)
        pg.evaluate(js('r.querySelector(".pill.on button[aria-label=\\"Video speichern\\"]").click(); return true;'))
        wait(lambda: any(x != 'Schließen' for x in (pg.evaluate(js('return Array.from(r.querySelectorAll(".dlm .dli")).map((b) => b.firstChild.textContent);')) or [])), 15)
        it = pg.evaluate(js('return Array.from(r.querySelectorAll(".dlm .dli")).map((b) => b.firstChild.textContent);')) or []
        pg.evaluate(js('const b = r.querySelector(".dlm .dlx"); if (b) b.click(); return true;')); time.sleep(0.3)
        return it
    def diag():
        tab = sw.evaluate('async () => (await chrome.tabs.query({})).find((t) => /\\/y\\/page\\.html/.test(t.url)).id')
        sw.evaluate('(t) => chrome.tabs.sendMessage(t, { t: "kadri-menu" }, { frameId: 0 })', tab)
        wait(lambda: pg.evaluate(js('return !!r.querySelector(".diag .danon");')), 8)
        pg.evaluate('() => navigator.clipboard.writeText("-")')
        pg.evaluate(js('r.querySelector(".diag .danon").click(); return true;'))
        got = ['']
        wait(lambda: got.__setitem__(0, pg.evaluate('() => navigator.clipboard.readText()')) or got[0].startswith('Kadri – anonymisierte Diagnose'), 8)
        pg.evaluate(js('const b = Array.from(r.querySelectorAll(".diag button")).find((x) => x.textContent === "Schließen"); if (b) b.click(); return true;'))
        return got[0]
    def lines(dg): return [l for l in dg.split('\n') if 'dash:' in l or 'DASH' in l or 'MPD-Texte' in l or l.startswith('Ladevorg')]
    def abg(seg=0, q=0, host=0, num=0, init=0, iq=0, ih=0):   # Zeile „DASH-Abgleich“ (Diagnose Stufe 1) mit genau diesen Zahlen
        return ('): Stücke exakt %d · nur Query abweichend %d · gleicher Pfad, anderer Host %d · Muster passt, Nummer/Zeitleiste abweichend %d · kein struktureller Treffer '
                % (seg, q, host, num)), ('· Init exakt %d · Init nur Query abweichend %d · Init anderer Host %d · für die Netzfolge zählt nur exakt' % (init, iq, ih))
    def has_abg(dg, **kw):
        a, b = abg(**kw)
        return any(l.startswith('DASH-Abgleich 1/1 (Beobachter-Abrufe seit Videostart ') and a in l and l.endswith(b) for l in dg.split('\n'))
    def obs(dg):   # (gesamt, seit Videostart, Medien-Kandidaten) aus der Beobachter-Zeile; getrennte Zeile für den Zeitleisten-Puffer
        m = re.search(r'^Ladevorgänge hier \(Beobachter, laufend gezählt, Hauptthread dieses Fensters\): gesamt (\d+) \(.*\) · seit Videostart (\d+) \(Art:Endung: .*\) · Medien-Kandidaten seit Videostart (\d+) · nicht sichtbar: Abrufe aus Workern, anderen Fenstern, WebSocket/WebRTC$', dg, re.M)
        pf = re.search(r'^Ladevorgänge hier \(Zeitleisten-Puffer, beim Aufruf gelesen, letzte 2 min, Art:Endung\): .* · Zeitleiste \d+', dg, re.M)
        return (int(m.group(1)), int(m.group(2)), int(m.group(3))) if m and pf else None
    anon = lambda dg: not re.search(r'://|127\.0\.0|/y/|manifest\.mpd|/manifest|seg0|stream\.m3u8|a-\d', dg)
    n0 = len([x for x in HITS if not x['browser']])

    for m, what in (('chain', 'BaseURL der MPD-Ebene (MPD ohne Endung, nur Content-Type)'), ('time', 'SegmentTimeline ($Time$)'), ('list', 'SegmentList'),
                    ('prefix', 'Namensraum-Präfix dash:MPD über die ganze Erkennungskette')):
        open_case(m); it = hint(); dg = diag()
        check('%s: Stücke in Folge geladen → Netz-Kandidat („%s“), kein Angebot' % (what, DS), DS in it and not any(x in it for x in OFFERS), it)
        check('… Diagnose: dash:manifest ambiguous(… dash-segments), Netzfolge passt (stueckfolge) mit %d Treffern' % N,
              re.search(r'dash:manifest · Bindung ambiguous\([^)]*dash-segments', dg) and re.search(r'DASH-Stückprüfung 1/1: Treffer %d · Darstellungen mit Treffern 1 · längste Folge %d · Init-Abrufe 1 .* Ergebnis Netzfolge passt \(stueckfolge\)' % (N, N), dg)
              and 'DASH-Manifest: VOD' in dg and 'Angebot nein' in dg and anon(dg), lines(dg))
        o = obs(dg)
        check('… Diagnose Stufe 1: Abgleich exakt %d Stücke + 1 Init, keine unscharfen Stufen; Beobachter zählt ≥ %d Medien-Kandidaten seit Videostart, Puffer getrennt' % (N, N + 1),
              has_abg(dg, seg=N, init=1) and o and o[2] >= N + 1 and o[1] >= N + 1 and o[0] >= o[1], lines(dg))

    open_case('hlsurl'); it = hint(); dg = diag()
    check('MPD unter einer .m3u8-Adresse: Inhalt schlägt Adresse – dash:manifest als Kandidat, kein HLS-Angebot', DS in it and not any(x in it for x in OFFERS)
          and re.search(r'dash:manifest · Bindung ambiguous', dg) and 'hls:' not in dg and anon(dg), (it, lines(dg)))

    open_case('compete'); it = hint(); dg = diag()
    check('zwei MPDs beschreiben dieselben geladenen Stücke: konkurrierende Kandidaten ohne Freigabe', DS in it and not any(x in it for x in OFFERS)
          and dg.count('Ergebnis ambiguous (konkurrenz)') == 2 and 'Bindung bound(' not in dg, (it, lines(dg)))
    open_case('few'); it = hint(); dg = diag()
    check('nur 2 Stücke des MPD geladen: ambiguous (zu-wenig-folge), kein Angebot', not any(x in it for x in OFFERS) and 'Ergebnis ambiguous (zu-wenig-folge)' in dg
          and re.search(r'Treffer 2 · Darstellungen mit Treffern 1 · längste Folge 2', dg), (it, lines(dg)))
    open_case('worker'); it = hint(); dg = diag()
    check('Stücke aus einem Web-Worker (in diesem Fenster unsichtbar): keine Treffer → ambiguous, nie gebunden', not any(x in it for x in OFFERS) and 'Ergebnis ambiguous (keine-treffer)' in dg
          and 'Bindung bound(' not in dg, (it, lines(dg)))
    open_case('notmpd'); it = hint(); dg = diag()
    check('kein MPD (feed mit eingebettetem dash:MPD, Content-Type DASH): verworfen und gezählt, kein Manifest-Eintrag, kein DASH-Hinweis',
          'MPD-Texte verworfen: not-mpd ×1' in dg and 'dash:manifest' not in dg and 'DASH-Stückprüfung' not in dg and not any('DASH' in x for x in it), (it, lines(dg)))
    open_case('switch', played=2); time.sleep(1.0); it = hint(); dg = diag()
    check('Medienwechsel (neues Medium ohne Stücke dieses MPD): die alten Treffer zählen nicht mehr – nicht gebunden', not any(x in it for x in OFFERS)
          and re.search(r'DASH-Stückprüfung 1/1: Treffer 0 .* Ergebnis ambiguous \(keine-treffer\)', dg) and 'Bindung bound(' not in dg, (it, lines(dg)))
    open_case('qtwo'); it = hint(); dg = diag()
    check('zwei MPDs mit gleichem Pfad, andere Query (?video=A/B), Stücke mit ?video=A: genau eine passende Netzfolge, das andere ohne Treffer',
          DS in it and dg.count('Ergebnis Netzfolge passt (stueckfolge)') == 1 and dg.count('Ergebnis ambiguous (keine-treffer)') == 1
          and 'DASH-Stückprüfung 2/2' in dg and len(re.findall(r'dash:manifest · Bindung ambiguous\([^)]*dash-segments', dg)) == 1 and anon(dg) and 'video=' not in dg, (it, lines(dg)))
    open_case('qwrong'); it = hint(); dg = diag()
    check('gleicher Stückpfad, andere Video-Identität in der Query (MPD ?video=A, geladen ?video=B): keine Treffer → ambiguous',
          not any(x in it for x in OFFERS) and re.search(r'DASH-Stückprüfung 1/1: Treffer 0 .* Ergebnis ambiguous \(keine-treffer\)', dg) and 'Bindung bound(' not in dg, (it, lines(dg)))
    # ---------- Diagnose Stufe 1: unscharfe Stufen werden gezählt, binden aber nie ----------
    for m, what, kw, leak in (('dq', 'Stücke und Init mit angehängter Query (?tok=1), MPD ohne Query', dict(q=N, iq=1), 'tok'),
                              ('dhost', 'gleicher Pfad auf anderem Host (localhost statt 127.0.0.1)', dict(host=N, ih=1), 'localhost'),
                              ('dnum', 'Muster passt, Zeiten liegen neben der SegmentTimeline (+7)', dict(num=N, init=1), '61447')):
        open_case(m); it = hint(); dg = diag()
        check('%s: Diagnose zählt %s, Stücke exakt 0 – Bindung ambiguous (keine-treffer), kein Angebot, anonym' % (what, kw),
              not any(x in it for x in OFFERS) and has_abg(dg, **kw) and re.search(r'DASH-Stückprüfung 1/1: Treffer 0 .* Ergebnis ambiguous \(keine-treffer\)', dg)
              and 'Bindung bound(' not in dg and anon(dg) and leak not in dg and obs(dg) and obs(dg)[2] >= N, (it, lines(dg)))
    open_case('worker'); dg = diag(); o = obs(dg)
    check('Web-Worker: Beobachter sieht die Stücke nicht (Kandidaten seit Videostart < %d), Abgleich exakt 0 / unscharf 0 – Hinweis auf Worker in der Zeile' % N,
          has_abg(dg, seg=0, init=0) and o and o[2] < N, lines(dg))
    check('nichts beim Helfer angefragt (kein Plan, kein Download)', len([x for x in HITS if not x['browser']]) == n0)
    check('keine Seitenfehler', not errs, errs)
    ctx.close()
helper.stop()
srv.shutdown()
shutdown()
done()
