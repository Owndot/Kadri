# S4a – DASH-Player-Matrix (lokaler Prüfstand, nicht in CI). Misst für verschiedene Player-ARCHITEKTUREN und
# Adressierungsformen, was Kadri (echte Erweiterung, Testbuild) heute auf jeder Ebene feststellt:
#   Manifest gelesen? · an das laufende Video gebunden? (Ergebnis + Grund) · Kadri-Vorprüfung (Format/Codec) ·
#   Angebot im Menü (bzw. welcher Text statt dessen) · Helfer-Planung (dashplan) · optional Helfer-Download (dashstart).
# Keine Domain-Sonderregeln: alle Szenarien laufen auf zwei neutralen lokalen Hosts (Seite 127.0.0.1, „CDN“ cdn.example.org,
# im Browser per --host-resolver-rules auf 127.0.0.1). Medien: S3d-Fixture (H.264 + AAC-LC) und tests/make_s4a_fixtures.sh.
# Geprüft (hart) werden nur SICHERHEITS-Erwartungen: Szenarien, in denen eine Bindung falsch wäre, dürfen nie binden, und
# eine Bindung muss immer das richtige Manifest treffen. Alles andere wird gemessen und als Tabelle/JSON ausgegeben.
#   node tools/build.js --test
#   tests/make_s4a_fixtures.sh /tmp/s4a-fx
#   S4A_FIXTURES=/tmp/s4a-fx S4A_PLAYERS=<Ordner mit dashjs-4.7.4/ und shaka-player-4.11.7/ (npm pack, entpackt)> \
#   HELPER_HOST_DIR=<Helper 3887569: tests/java/channel/build.sh OUT> xvfb-run -a python3 tests/s4a_dash_player_matrix.py [SZENARIO …]
import os, re, sys, time, json, hashlib, threading, http.server, urllib.parse
KADRI = os.path.realpath(os.path.join(os.path.dirname(os.path.abspath(__file__)), '..')); sys.path.insert(0, os.path.join(KADRI, 'tests'))
from common import *   # noqa
PORT = 8792
PUB = os.path.join(KADRI, 'tests', 'web', 'public'); H264 = os.path.join(PUB, 's3d-dash'); LIB = os.path.join(KADRI, 'tests', 'web', 's4a')
FX = os.environ.get('S4A_FIXTURES') or ''; PLAYERS = os.environ.get('S4A_PLAYERS') or ''
OUTDIR = os.environ.get('S4A_OUT') or ''
OTHER_NAME = 'cdn.example.org'
FRONT, OTHER = '127.0.0.1:%d' % PORT, '%s:%d' % (OTHER_NAME, PORT)
BASE_MPD = open(os.path.join(H264, 'manifest.mpd'), encoding='utf-8').read()
AUDIO_T = [0, 188416, 380928, 572416, 764928, 957440]   # Startzeiten der Tonstücke (Zeitleiste der Fixture, Zeitskala 48000)

# ---------- MPD-Varianten (alle aus derselben Fixture; nur die Adressierung ändert sich) ----------
def mpd_dur(t):   # SegmentTemplate mit fester Dauer statt Zeitleiste ($Number$)
    t = re.sub(r'\s*<SegmentTimeline>.*?</SegmentTimeline>\s*', '', t, flags=re.S)
    t = re.sub(r'(<SegmentTemplate timescale="(\d+)")', lambda m: m.group(1) + ' duration="%d"' % (4 * int(m.group(2))), t)
    return re.sub(r'<SegmentTemplate([^>]*)>\s*</SegmentTemplate>', r'<SegmentTemplate\1 />', t)
def mpd_list(t, sign=True, timeline=True):   # SegmentList mit einzelnen (signierten) Stück-Adressen
    # timeline=True: Zeiten aus der SegmentTimeline der Fixture (genau); False: feste Dauer 4 s – beim Ton (6 Stücke, das letzte
    # nur 53 ms) beschreibt das MPD dann 24 s statt 20 s (bewusst fehlerhafte Abdeckung für die Vorprüfungs-Gegenprobe e3)
    def rep(m):
        rid, body = m.group(2), m.group(3)
        ts, n = (12800, 5) if rid in ('0', '1') else (48000, 6)
        q = lambda k: ('?sig=' + hashlib.sha256(('%s-%d' % (rid, k)).encode()).hexdigest()[:16]) if sign else ''
        tl = re.search(r'<SegmentTimeline>.*?</SegmentTimeline>', body, re.S).group(0) if timeline else ''
        sl = '<SegmentList timescale="%d"%s><Initialization sourceURL="init-%s.m4s%s"/>%s%s</SegmentList>' % (
            ts, '' if timeline else ' duration="%d"' % (4 * ts), rid, q(0), tl, ''.join('<SegmentURL media="chunk-%s-%05d.m4s%s"/>' % (rid, k, q(k)) for k in range(1, n + 1)))
        return m.group(1) + re.sub(r'<SegmentTemplate.*?</SegmentTemplate>', sl, body, flags=re.S) + '</Representation>'
    return re.sub(r'(<Representation id="(\d)"[^>]*>)(.*?)</Representation>', rep, t, flags=re.S)
def mpd_base(t, *urls): return t.replace('\t<Period ', ''.join('\t<BaseURL>%s</BaseURL>\n' % u for u in urls) + '\t<Period ', 1)
def mpd_drop_rep(t, rid): return re.sub(r'\s*<Representation id="%s".*?</Representation>' % rid, '', t, flags=re.S)
def fx(name):
    p = os.path.join(FX, name, 'manifest.mpd')
    return open(p, encoding='utf-8').read() if FX and os.path.isfile(p) else None

# key → { dir, mpd(): Text, redir: 'mpd' (MPD+Stücke 301 zum CDN, wie githack) | 'seg-signed' (Stücke 302 auf signierte CDN-Adresse), time: bool }
M = {}
def mk(key, text, d=H264, **kw): M[key] = dict(dir=d, mpd=text, **kw)
for k in ('a1', 'a2', 'a3', 'b1', 'b2', 'c1', 'c1n', 'c1w', 'c1t', 'c1x', 'a2w', 'c2', 'c3', 'f1', 'f2a', 'f2b', 'd4'): mk(k, BASE_MPD)
FAILMPD = set()   # S4b: MPD-Abruf nach der Verzögerung mit 404 beantworten (Planung scheitert spät)
DELAY = {}   # S4b-3: Verzögerung (s) für MPD-Abrufe je Szenario – ab dem Tipp lädt nur noch der Helfer (langsame Planung)
mk('a4', mpd_dur(BASE_MPD)); mk('a5', BASE_MPD.replace('$Number%05d$', '$Time$'), time=True)
mk('d1', BASE_MPD, redir='mpd'); mk('d2', BASE_MPD, redir='mpd'); mk('d3', BASE_MPD, redir='seg-signed')
mk('d5', mpd_base(BASE_MPD, 'http://%s/m/d5/' % FRONT, 'http://%s/m/d5/' % OTHER)); mk('d6', mpd_base(BASE_MPD, 'http://%s/m/d6/' % OTHER))
# S4b-6: CDN-Wechsel mitten in der Folge (Stücke 1–2 von der Seite, ab 3 vom CDN) – nie still akzeptiert
mk('d8', mpd_base(BASE_MPD, 'http://%s/m/d8/' % FRONT, 'http://%s/m/d8/' % OTHER))
mk('e2', mpd_list(BASE_MPD)); mk('e3', mpd_list(BASE_MPD, timeline=False)); mk('f1ad', mpd_drop_rep(BASE_MPD, '1')); mk('f1bad', mpd_drop_rep(BASE_MPD, '1')); mk('f1b', BASE_MPD);
# S4b-4: Medien-Epochen – Vorspann mit verspäteten Antworten, Vorladen, schneller Wechsel (sauber / alter Lader lädt weiter), Shadow-DOM
for k in ('f1cad', 'r1x', 'r2x'): mk(k, mpd_drop_rep(BASE_MPD, '1'))
for k in ('f1c', 'p1', 'r1', 'r2', 's1'): mk(k, BASE_MPD)
SEGDELAY = {'f1cad': 3.0}   # Stücke dieses Szenarios kommen 3 s verspätet an mk('g1', BASE_MPD); mk('h3', BASE_MPD.replace('mp4a.40.2', 'mp4a.40.5'))
if fx('sb'): mk('e1', fx('sb'), d=os.path.join(FX, 'sb'))
if fx('wm'): mk('h1', fx('wm'), d=os.path.join(FX, 'wm'))
if fx('vm'): mk('h2', fx('vm'), d=os.path.join(FX, 'vm'))

# ---------- Seiten ----------
VID = '<video id=v%d muted playsinline controls style="width:100%%;display:block;background:#000;aspect-ratio:16/9"></video>'
def page(body, title='S4a'): return '<!doctype html><html><head><meta charset=utf-8><meta name=viewport content="width=device-width,initial-scale=1"><title>%s</title></head><body style="margin:0">%s</body></html>' % (title, body)
def own(*cfgs, seq=False):
    vids = sorted(set(c.get('v', 0) for c in cfgs))
    js = ['const C = %s;' % json.dumps(list(cfgs)), 'C.forEach((c) => { c.video = document.getElementById("v" + (c.v || 0)); });']
    # seq: nacheinander im selben Video; seq=='play': das erste (Vorspann) läuft ≥ 6 s, seq=='tight': das zweite startet 2,5 s nach dem Laden
    if seq in ('fast', 'overlap'):   # S4b-4: zweites start() nach 1,2 s bzw. 1,0 s, ohne auf das erste zu warten
        js.append('C.forEach((c, i) => setTimeout(() => S4A.start(c), i * %d));' % (1200 if seq == 'fast' else 1000))
        return page(''.join(VID % i for i in vids) + '<script src="/lib/own.js"></script><script>' + '\n'.join(js) + '</script>')
    js.append(('(async () => { for (const c of C) { await S4A.start(c); const v = c.video; if (%s) { const t0 = Date.now(); while (v.currentTime < 6 && Date.now() - t0 < 20000) await new Promise((r) => setTimeout(r, 200)); } else await new Promise((r) => setTimeout(r, 2500)); } })();' % ('true' if seq == 'play' else 'false')) if seq else 'C.forEach((c) => S4A.start(c));')
    return page(''.join(VID % i for i in vids) + '<script src="/lib/own.js"></script><script>' + '\n'.join(js) + '</script>')
def dashjs(mpd): return page(VID % 0 + '<script src="/lib/dash.all.min.js"></script><script>const p = dashjs.MediaPlayer().create(); p.updateSettings({ debug: { logLevel: 0 } }); p.initialize(document.getElementById("v0"), %s, true);</script>' % json.dumps(mpd))
def shaka(mpd): return page(VID % 0 + '<script src="/lib/shaka.js"></script><script>shaka.polyfill.installAll(); (async () => { const p = new shaka.Player(); await p.attach(document.getElementById("v0")); await p.load(%s); document.getElementById("v0").play().catch(() => {}); })();</script>' % json.dumps(mpd))
def iframe(src): return page('<div style="padding:6px">Seite mit eingebettetem Player</div><iframe src="%s" allow="autoplay; fullscreen" style="width:100%%;aspect-ratio:16/9;border:0"></iframe>' % src)
def srcdoc(inner): return page('<div style="padding:6px">Seite mit srcdoc-Fenster</div><iframe srcdoc="%s" allow="autoplay; fullscreen" style="width:100%%;aspect-ratio:16/9;border:0"></iframe>' % inner.replace('&', '&amp;').replace('"', '&quot;'))
mp = lambda k, host=FRONT: 'http://%s/m/%s/manifest.mpd' % (host, k)
PAGES = {
    'a1': own(dict(mpd=mp('a1'), mode='main')), 'a2': dashjs(mp('a2')), 'a3': shaka(mp('a3')), 'a4': dashjs(mp('a4')), 'a5': dashjs(mp('a5')),
    'b1': own(dict(mpd=mp('b1'), mode='worker')), 'b2': own(dict(mpd=mp('b2'), mode='wmse')),
    'c1': iframe('http://%s/p/c1-inner.html' % OTHER), 'c1-inner': dashjs(mp('c1', OTHER)),
    'c1n': iframe('http://%s/p/c1n-inner.html' % OTHER), 'c1n-inner': dashjs(mp('c1n', OTHER)),
    'c1w': iframe('http://%s/p/c1w-inner.html' % OTHER), 'c1w-inner': dashjs(mp('c1w', OTHER)),
    'c1t': iframe('http://%s/p/c1t-inner.html' % OTHER), 'c1t-inner': dashjs(mp('c1t', OTHER)),
    'c1x': iframe('http://%s/p/c1x-inner.html' % OTHER), 'c1x-inner': dashjs(mp('c1x', OTHER)),
    'a2w': dashjs(mp('a2w')),
    'c2': srcdoc(own(dict(mpd=mp('c2'), mode='main')).replace('src="/lib/', 'src="http://%s/lib/' % FRONT)),
    'c3': iframe('http://%s/p/c3-mid.html' % OTHER), 'c3-mid': iframe('http://%s/p/c3-inner.html' % FRONT), 'c3-inner': dashjs(mp('c3')),
    'd1': dashjs(mp('d1')), 'd2': own(dict(mpd=mp('d2'), mode='main', resolve='initial')), 'd3': dashjs(mp('d3')),
    'd4': own(dict(mpd=mp('d4') + '?tok=s4a-token', mode='main', addQuery='tok=s4a-token')),
    'd5': own(dict(mpd=mp('d5'), mode='main', base=1)), 'd6': dashjs(mp('d6')),
    'd8': own(dict(mpd=mp('d8'), mode='main', base=0, switchAt=2)),
    'e1': dashjs(mp('e1')), 'e2': shaka(mp('e2')), 'e3': dashjs(mp('e3')),
    'f1': own(dict(mpd=mp('f1ad'), mode='main', vid='0', maxSegs=3, burst=True), dict(mpd=mp('f1'), mode='main'), seq='play'),
    'f1b': own(dict(mpd=mp('f1bad'), mode='main', vid='0', maxSegs=3, burst=True), dict(mpd=mp('f1b'), mode='main'), seq='tight'),
    'f2': own(dict(mpd=mp('f2a'), mode='main', v=0), dict(mpd=mp('f2b'), mode='main', v=1)),
    'f1c': own(dict(mpd=mp('f1cad'), mode='main', vid='0', maxSegs=3, burst=True, parallel=True), dict(mpd=mp('f1c'), mode='main'), seq='overlap'),
    'p1': own(dict(mpd=mp('p1'), mode='main', preload=2)),
    'r1': own(dict(mpd=mp('r1x'), mode='main', vid='0', burst=True), dict(mpd=mp('r1'), mode='main'), seq='fast'),
    'r2': own(dict(mpd=mp('r2x'), mode='main', vid='0', zombie=True), dict(mpd=mp('r2'), mode='main'), seq='fast'),
    's1': page('<div id=host></div><script src="/lib/dash.all.min.js"></script><script>const sr = document.getElementById("host").attachShadow({ mode: "open" }); const v = document.createElement("video"); '
               'v.muted = true; v.playsInline = true; v.controls = true; v.style.cssText = "width:100%%;display:block;aspect-ratio:16/9;background:#000"; sr.appendChild(v); '
               'const p = dashjs.MediaPlayer().create(); p.updateSettings({ debug: { logLevel: 0 } }); p.initialize(v, %s, true);</script>' % json.dumps(mp('s1'))),
    'g1': own(dict(inline='/api/g1.json', mode='main')),
    'h1': dashjs(mp('h1')), 'h2': dashjs(mp('h2')), 'h3': own(dict(mpd=mp('h3'), mode='main')),
}
# Szenarien: (Kennung, Gruppe, Beschreibung, Sicherheits-Erwartung: 'nie' = darf nicht binden | 'richtig' = wenn gebunden, dann
# mit den Optionen des laufenden Manifests | None, Planung versuchen, Download versuchen, erwartete Plan-Optionen)
OPT2 = ['360p · Ton: Sprache nicht angegeben', '180p · Ton: Sprache nicht angegeben']
SCN = [
    ('a1', 'A Player', 'eigener Player, Hauptthread, fetch · Timeline + $Number$', 'richtig', True, False),
    ('a2', 'A Player', 'dash.js 4.7.4, Hauptthread, XHR · Timeline + $Number$', 'richtig', True, False),
    ('a3', 'A Player', 'Shaka 4.11.7, Hauptthread, fetch · Timeline + $Number$', 'richtig', True, False),
    ('a4', 'A Adressierung', 'dash.js · SegmentTemplate $Number$ mit fester Dauer (ohne Timeline)', 'richtig', True, False),
    ('a5', 'A Adressierung', 'dash.js · SegmentTemplate $Time$ + Timeline', 'richtig', True, True),
    ('b1', 'B Worker', 'eigener Player · MPD und Stücke per fetch im Dedicated Worker, MSE im Hauptthread', 'richtig', True, False),
    ('b2', 'B Worker', 'eigener Player · MediaSource im Dedicated Worker (MediaSourceHandle)', 'richtig', True, False),
    ('c1', 'C Fenster', 'dash.js in fremd-originigem iframe (CDN-Host)', 'richtig', True, True),
    ('c1n', 'C Fenster', 'wie c1, Planung langsam (6 s); währenddessen neuer Tipp auf ⬇ – die späte Planantwort ist veraltet', 'richtig', True, False),
    ('c1w', 'C Fenster', 'S4b: wie c1, Planung langsam (6 s); Warteblatt währenddessen bewusst geschlossen', 'richtig', True, False),
    ('a2w', 'A Player', 'S4b: wie a2 (Hauptfenster), Planung langsam (6 s); Warteblatt währenddessen bewusst geschlossen', 'richtig', True, False),
    ('c1t', 'C Fenster', 'S4b: wie c1, Planung scheitert spät (6 s, 404); währenddessen neuer Tipp ⬇ – später Fehler-Hinweis ist veraltet', 'richtig', True, False),
    ('c1x', 'C Fenster', 'S4b: wie c1, Helfer-Abruf des MPD verzögert um 50 s (Planung über 45 s, echte Zeit)', 'richtig', True, False),
    ('c2', 'C Fenster', 'eigener Player in srcdoc-iframe', 'richtig', True, False),
    ('c3', 'C Fenster', 'dash.js zweifach verschachtelt (Seite → fremd → Seite)', 'richtig', True, True),
    ('d1', 'D Adressen', 'dash.js · MPD + Stücke 301 auf CDN-Host (wie githack), Auflösung gegen endgültige Adresse', 'richtig', True, False),
    ('d2', 'D Adressen', 'eigener Player · wie d1, aber Auflösung gegen ANGEFRAGTE Adresse (Gegenprobe, Fehler S3h)', 'nie', False, False),
    ('d3', 'D Adressen', 'dash.js · jedes Stück 302 auf signierte CDN-Adresse (?exp&sig)', 'richtig', True, True),
    ('d4', 'D Adressen', 'eigener Player · MPD mit ?tok=…, Token an jedes Stück angehängt (MPD nennt es nicht)', 'nie', False, False),
    ('d5', 'D Adressen', 'eigener Player · zwei BaseURL (Seite, CDN), Player nimmt die zweite (Ausweich-CDN) – S4b-6: gebunden, Download über die zweite', 'richtig', True, True),
    ('d8', 'D Adressen', 'eigener Player · zwei BaseURL, CDN-Wechsel mitten in der Folge (S4b-6: nie still akzeptiert)', 'nie', False, False),
    ('d6', 'D Adressen', 'dash.js · absolute BaseURL auf CDN-Host', 'richtig', True, False),
    ('e1', 'E Form', 'dash.js · Einzeldatei je Darstellung, SegmentList mit mediaRange (Byte-Bereiche)', 'nie', False, False),
    ('e2', 'E Form', 'Shaka · SegmentList + SegmentTimeline mit einzeln signierten SegmentURL', 'richtig', True, True),
    ('e3', 'E Form', 'dash.js · SegmentList mit fester Dauer, Ton-Abdeckung im MPD falsch (24 s statt 20 s) – Vorprüfungs-Gegenprobe', 'richtig', True, False),
    ('f1', 'F Mehrere', 'eigener Player · erst Vorspann-MPD (nur 180p, 3 Stücke), dann Haupt-MPD im selben Video', 'richtig', True, False),
    ('f1b', 'F Mehrere', 'eigener Player · wie f1, aber Haupt-MPD startet 2,5 s nach dem Laden des Vorspanns (Vorspann vorgeladen)', 'richtig', True, False),
    ('f1c', 'F Mehrere', 'S4b-4: Vorspann (3 Stücke gleichzeitig angefragt, Antworten 3 s verspätet); Haupt-MPD startet 1 s nach dem Vorspann', 'richtig', True, False),
    ('p1', 'F Epoche', 'S4b-4: Init + 2 Stücke VOR dem Anlegen der MediaSource geladen (Vorladen), danach angehängt', 'richtig', True, False),
    ('r1', 'F Epoche', 'S4b-4: schneller Wechsel im selben Video nach 1,2 s (neue MediaSource), alter Lader hört auf', 'richtig', True, False),
    ('r2', 'F Epoche', 'S4b-4: schneller Wechsel, alter Lader lädt weiter Stücke des alten MPD (schlecht aufgeräumt)', None, True, False),
    ('s1', 'F Epoche', 'S4b-4: dash.js-Video in Shadow-DOM (loadstart für das Dokument unsichtbar)', None, True, False),
    ('f2', 'F Mehrere', 'eigener Player · zwei Videos gleichzeitig, zwei MPDs', None, True, False),
    ('g1', 'G Quelle', 'eigener Player · MPD-Text aus API-JSON (kein .mpd-Abruf)', 'nie', False, False),
    ('h1', 'H Codec', 'dash.js · VP9 + Opus in WebM', 'richtig', True, False),
    ('h2', 'H Codec', 'dash.js · VP9 + Opus in fMP4', 'richtig', True, False),
    ('h3', 'H Codec', 'eigener Player · AAC als mp4a.40.5 (HE-AAC) gekennzeichnet', 'richtig', True, False),
]
WANT_OPTS = {'d5': OPT2, 'f1': OPT2, 'f1b': OPT2, 'f1c': OPT2, 'p1': OPT2, 'r1': OPT2, 'r2': OPT2, 's1': OPT2, 'h1': None, 'h2': None}
# S4b: harte FUNKTIONS-Erwartungen je Szenario (heutiger Soll-Stand; jede S4b-Stufe ändert hier nur, was sie ausdrücklich
# liefert). bound/offer: Bindung und Angebot; plan: erwartete Optionen ('rejected' = Helfer lehnt beim Plan ab);
# file: vollständige Datei beim Helfer (Größe = Init + alle Stücke der gewählten Darstellung + Ton).
FX_SIZE = lambda v: sum(os.path.getsize(os.path.join(H264, f)) for f in os.listdir(H264) if re.match(r'(init|chunk)-(%s|2)(-\d+)?\.m4s$' % v, f))
FILE_OK = {FX_SIZE('1'), FX_SIZE('0')}   # 360p bzw. 180p (je nach dem, was der Player gerade spielte)
EXPECT = {}
for k in ('a1', 'a2', 'a3', 'a4', 'd1', 'd6', 'f1'): EXPECT[k] = dict(bound=True, offer=True, plan=OPT2)
for k in ('a5', 'd3', 'e2', 'c1', 'c3'): EXPECT[k] = dict(bound=True, offer=True, plan=OPT2, file=True)
for k in ('b1', 'b2', 'c2', 'g1', 'd2', 'd4', 'd8', 'e1', 'f2', 'r2', 's1'): EXPECT[k] = dict(bound=False, offer=False)
# S4b-6: mehrere BaseURL – an die beobachtete zweite Alternative gebunden, Helfer prüft die Auswahl und lädt vollständig über sie
EXPECT['d5'] = dict(bound=True, offer=True, plan=OPT2, file=True)
# S4b-4: Medien-Epoche – der Vorspann gehört zur vorigen MediaSource: das Haupt-MPD (360p + 180p) wird gebunden
for k in ('f1b', 'f1c', 'p1', 'r1'): EXPECT[k] = dict(bound=True, offer=True, plan=OPT2)
# S4b-5: Vorprüfung im Gleichlauf mit dem Helfer – e3 (Ton-Abdeckung 24 s statt 20 s) wird schon von Kadri erkannt: kein Angebot,
# kein dashplan (der Helfer lädt das MPD nicht), Bindung unverändert
EXPECT['e3'] = dict(bound=True, offer=False, noplan=True)
for k in ('h1', 'h2', 'h3'): EXPECT[k] = dict(bound=True, offer=False)
for k in ('c1n', 'c1w', 'c1t', 'c1x', 'a2w'): EXPECT[k] = dict(bound=True, offer=True)
# S4b: Ebenen (src/046) – erste blockierende Ebene (Diagnose „DASH-Ebenen“), Hauptzeile und Unterzeile im Menü.
# '-' = keine blockierende Ebene (Angebot); None = kein DASH an diesem Video (keine Ebenen-Zeile).
M_E1 = 'DASH vermutet – Manifest nicht lesbar'
M_E2 = 'DASH-Stream erkannt – Zuordnung zum Video nicht nachgewiesen'
M_FMT = 'DASH-Stream zugeordnet – Format wird noch nicht gespeichert'
LV = {k: ('-', None, None) for k in ('a1', 'a2', 'a3', 'a4', 'a5', 'd1', 'd3', 'd5', 'd6', 'e2', 'f1', 'c1', 'c3', 'c1n', 'c1w', 'c1t', 'c1x', 'a2w')}
LV.update({
    'b1': ('E1/unread-invisible', M_E1, r'verdeckt'), 'b2': ('E1/unread-invisible', M_E1, r'verdeckt'), 'c2': ('E1/unread-invisible', M_E1, r'verdeckt'),
    'd2': ('E2/host', M_E2, r'anderen Server'), 'd4': ('E2/query', M_E2, r'Zusatzparameter'), 'd8': ('E2/alt-mixed', M_E2, r'verschiedenen Server-Alternativen \(CDN-Wechsel\)'),
    'e3': ('E3/coverage', 'DASH-Stream zugeordnet – nicht speicherbar', r'^Manifest widersprüchlich: Tonspur 24 s statt 20 s$'),
    'e1': ('E2/uncheckable', 'DASH-Stream erkannt – Zuordnung hier nicht möglich', r'^Stream-Form \(Byte-Bereiche einer Datei\) erlaubt keinen sicheren Nachweis$'),
    'f2': ('E2/multi-video', M_E2, r'Mehrere Videos'),
    'f1b': ('-', None, None), 'f1c': ('-', None, None), 'p1': ('-', None, None), 'r1': ('-', None, None),
    'r2': ('E2/competing', M_E2, r'Werbung'),
    # Shadow-DOM: loadstart für Kadri unsichtbar → Epoche ab Beobachtung; alle Stücke waren schon vorher geladen → keine Bindung (Grenze)
    's1': ('E2/epoch-late', M_E2, r'erst seit kurzem'),
    'g1': (None, 'Keine speicherbare Videodatei erkannt – Video abspielen und erneut tippen', None),
    'h1': ('E3/format', M_FMT, r'^Video VP9 · Ton Opus · WebM – gespeichert wird bisher nur H\.264 mit AAC-LC \(MP4\)$'),
    'h2': ('E3/format', M_FMT, r'^Video VP9 · Ton Opus · MP4 – gespeichert wird bisher nur H\.264 mit AAC-LC \(MP4\)$'),
    'h3': ('E3/audio-he-aac', 'DASH-Stream zugeordnet – Tonformat HE-AAC wird noch nicht gespeichert', r'^Ton HE-AAC – gespeichert wird bisher nur AAC-LC$'),
})

HITS = []
def time_to_num(rid, t):
    if rid in ('0', '1'): return t // 51200 + 1 if t % 51200 == 0 else None
    return AUDIO_T.index(t) + 1 if t in AUDIO_T else None
class H(http.server.BaseHTTPRequestHandler):
    protocol_version = 'HTTP/1.1'
    def log_message(self, *a): pass
    def out(self, code, body=b'', ct='application/octet-stream', extra=None):
        self.send_response(code)
        for k, v in (extra or {}).items(): self.send_header(k, v)
        self.send_header('Content-Type', ct); self.send_header('Content-Length', str(len(body))); self.send_header('Access-Control-Allow-Origin', '*')
        self.send_header('Access-Control-Expose-Headers', 'Content-Range, Content-Length'); self.send_header('Cache-Control', 'no-store'); self.end_headers()
        if self.command != 'HEAD':
            try: self.wfile.write(body)
            except (BrokenPipeError, ConnectionResetError): pass   # (Gegenstelle hat aufgegeben, z. B. Kanal-Frist bei c1x)
    def do_OPTIONS(self):
        self.send_response(204); self.send_header('Access-Control-Allow-Origin', '*'); self.send_header('Access-Control-Allow-Headers', 'Range'); self.send_header('Content-Length', '0'); self.end_headers()
    def do_HEAD(self): self.do_GET()
    def do_GET(self):
        u = urllib.parse.urlparse(self.path); host = self.headers.get('Host') or ''; q = urllib.parse.parse_qs(u.query)
        HITS.append({'t': time.time(), 'host': host, 'path': u.path, 'q': u.query, 'range': self.headers.get('Range') or '', 'cookie': self.headers.get('Cookie') or '', 'auth': self.headers.get('Authorization') or ''})
        parts = u.path.strip('/').split('/')
        if parts[0] == 'p' and len(parts) == 2 and parts[1].endswith('.html') and parts[1][:-5] in PAGES:
            return self.out(200, PAGES[parts[1][:-5]].encode(), 'text/html; charset=utf-8')
        if parts[0] == 'lib' and len(parts) == 2:
            src = {'own.js': os.path.join(LIB, 'own.js'), 'own-worker.js': os.path.join(LIB, 'own-worker.js'),
                   'dash.all.min.js': os.path.join(PLAYERS, 'dashjs-4.7.4', 'package', 'dist', 'dash.all.min.js'),
                   'shaka.js': os.path.join(PLAYERS, 'shaka-player-4.11.7', 'package', 'dist', 'shaka-player.compiled.js')}.get(parts[1])
            if src and os.path.isfile(src): return self.out(200, open(src, 'rb').read(), 'text/javascript; charset=utf-8')
            return self.out(404)
        if parts[0] == 'api' and len(parts) == 2 and parts[1] == 'g1.json':
            return self.out(200, json.dumps({'mpd': M['g1']['mpd'], 'base': '/m/g1/'}).encode(), 'application/json')
        if parts[0] != 'm' or len(parts) != 3 or parts[1] not in M: return self.out(404)
        key, name = parts[1], parts[2]; m = M[key]
        if m.get('redir') == 'mpd' and host == FRONT and re.search(r'\.(mpd|m4s)$', name):
            return self.out(301, extra={'Location': 'http://%s%s' % (OTHER, self.path)})
        if m.get('redir') == 'seg-signed' and name.endswith('.m4s'):
            if host == FRONT:
                exp = str(int(time.time()) + 300); sig = hashlib.sha256((u.path + exp).encode()).hexdigest()[:20]
                return self.out(302, extra={'Location': 'http://%s%s?exp=%s&sig=%s' % (OTHER, u.path, exp, sig)})
            if not (q.get('exp') and q.get('sig') and hashlib.sha256((u.path + q['exp'][0]).encode()).hexdigest()[:20] == q['sig'][0]): return self.out(403)
        if name == 'manifest.mpd':
            if DELAY.get(key): time.sleep(DELAY[key])
            if key in FAILMPD: return self.out(404)
            return self.out(200, m['mpd'].encode(), 'application/dash+xml')
        if SEGDELAY.get(key) and name.startswith('chunk-'): time.sleep(SEGDELAY[key])
        if m.get('time'):
            mm = re.match(r'chunk-(\d)-(\d+)\.m4s$', name)
            if mm:
                n = time_to_num(mm.group(1), int(mm.group(2)))
                if not n: return self.out(404)
                name = 'chunk-%s-%05d.m4s' % (mm.group(1), n)
        f = os.path.normpath(os.path.join(m['dir'], name))
        if not f.startswith(m['dir']) or not os.path.isfile(f): return self.out(404)
        body = open(f, 'rb').read(); ct = 'video/webm' if f.endswith('.webm') else 'video/mp4'
        rg = re.match(r'bytes=(\d+)-(\d*)$', self.headers.get('Range') or '')
        if rg:
            a = int(rg.group(1)); b = int(rg.group(2)) if rg.group(2) else len(body) - 1
            return self.out(206, body[a:b + 1], ct, {'Content-Range': 'bytes %d-%d/%d' % (a, b, len(body)), 'Accept-Ranges': 'bytes'})
        return self.out(200, body, ct, {'Accept-Ranges': 'bytes', 'ETag': '"%s"' % hashlib.sha256(body).hexdigest()[:16]})
srv = http.server.ThreadingHTTPServer(('127.0.0.1', PORT), H); srv.daemon_threads = True; threading.Thread(target=srv.serve_forever, daemon=True).start()

def wait(pred, secs=10):
    end = time.time() + secs
    while time.time() < end:
        try:
            if pred(): return True
        except Exception: pass
        time.sleep(0.25)
    return False
UI = '(() => { const h = document.querySelector("[data-kadri-test]"); return h && h.shadowRoot; })()'
def js(sel): return '() => { const r = %s; if (!r) return null; %s }' % (UI, sel)
ITEMS = 'return Array.from(r.querySelectorAll(".dlm .dli")).map((b) => [b.firstChild.textContent, b.querySelector("small") ? b.querySelector("small").textContent : ""]);'
OFFER = 'DASH-Stream mit Helper herunterladen …'
KEEP = ('Quellen am Video', 'Auswahl', 'DASH', 'Helfer-Fähigkeiten', 'Rahmen', 'Fenster-Ebene', 'Beobachter', 'Download')
want = [a for a in sys.argv[1:] if not a.startswith('-')]
RUN = [s for s in SCN if (not want or s[0] in want) and s[0] in PAGES and (s[0] in M or s[0] in ('c1', 'c3', 'f1', 'f1b', 'f1c', 'r1', 'r2', 'f2'))]
skipped = [s[0] for s in SCN if s not in RUN and (not want or s[0] in want)]
check('Fixtures/Player vorhanden (sonst übersprungen: %s)' % (', '.join(skipped) or '–'), bool(PLAYERS) and os.path.isfile(os.path.join(PLAYERS, 'dashjs-4.7.4', 'package', 'dist', 'dash.all.min.js')), PLAYERS)
# S4b-4: Messmodus (ohne Erweiterung, nur Test-Instrumentierung der Seite): je Szenario die Zeitpunkte von loadstart/emptied
# des Videoelements, sourceopen der MediaSource und Anfragebeginn/-ende jedes Init-/Medienstücks (Resource Timing).
# Ergebnis als JSON (S4A_MEASURE=<Datei>), danach Ende.
MEASURE_JS = """(() => {
  const T = window.__ep = { ev: [] };
  const now = () => performance.timeOrigin + performance.now();
  document.addEventListener('loadstart', (e) => { if (e.target.tagName === 'VIDEO') T.ev.push(['loadstart', now(), String(e.target.currentSrc || e.target.src || '').slice(0, 5)]); }, true);
  document.addEventListener('emptied', (e) => { if (e.target.tagName === 'VIDEO') T.ev.push(['emptied', now()]); }, true);
  const MS = window.MediaSource;
  if (MS) { const add = MS.prototype.addEventListener; window.MediaSource = function () { const m = new MS(); add.call(m, 'sourceopen', () => T.ev.push(['sourceopen', now()])); return m; };
    window.MediaSource.prototype = MS.prototype; window.MediaSource.isTypeSupported = MS.isTypeSupported.bind(MS); window.MediaSource.canConstructInDedicatedWorker = MS.canConstructInDedicatedWorker; }
  new PerformanceObserver((l) => l.getEntries().forEach((e) => { if (/[.](m4s|webm|mp4|mpd)([?]|$)/.test(e.name)) T.ev.push(['res', performance.timeOrigin + e.startTime, performance.timeOrigin + e.responseEnd, e.name.replace(/^https?:[/][/][^/]+/, '').replace(/[?].*$/, ''), e.initiatorType]); })).observe({ type: 'resource', buffered: true });
})();"""
if os.environ.get('S4A_MEASURE'):
    out = {}
    with sync_playwright() as p:
        b = p.chromium.launch(executable_path=os.environ.get('KADRI_CHROMIUM') or None, args=['--host-resolver-rules=MAP %s 127.0.0.1' % OTHER_NAME, '--no-proxy-server', '--autoplay-policy=no-user-gesture-required'])
        for sid in [x[0] for x in RUN]:
            ctx = b.new_context(); ctx.add_init_script(MEASURE_JS); pg = ctx.new_page()
            pg.goto('http://%s/p/%s.html' % (FRONT, sid)); time.sleep(14)
            out[sid] = [{'frame': f.url.split('/p/')[-1], 'ev': f.evaluate('() => window.__ep ? window.__ep.ev : null')} for f in pg.frames]
            ctx.close()
        b.close()
    json.dump(out, open(os.environ['S4A_MEASURE'], 'w'), indent=1)
    print('MESSUNG', ', '.join(out)); sys.exit(0)
helper = ChannelHelper()
_r = [helper.ready, helper.cmd('downloads %d' % PORT), helper.cmd('hls on'), helper.cmd('dash on')]
check('Kanal-Helfer mit DASH-Engine', _r[0].startswith('READY') and _r[1] == 'DOWNLOADS on' and _r[3] == 'DASH on', _r)
RES = []
with sync_playwright() as p:
    ctx, sw, udir = launch(p, extra_args=['--host-resolver-rules=MAP %s 127.0.0.1' % OTHER_NAME, '--no-proxy-server']); ext_id = sw.url.split('/')[2]
    ctx.grant_permissions(['clipboard-read', 'clipboard-write'])
    check('Kopplung', pair_helper(ctx, ext_id, helper) == 'Verbunden')
    for sid, grp, title, safety, do_plan, do_start in RUN:
        pg = ctx.new_page(); errs = []; pg.on('pageerror', lambda e: errs.append(str(e)[:160]))
        r = {'id': sid, 'group': grp, 'title': title, 'safety': safety}
        n0 = len(HITS)
        pg.goto('http://%s/p/%s.html' % (FRONT, sid)); pg.bring_to_front()
        vids = lambda: [x for f in pg.frames for x in (f.evaluate('() => Array.from(document.querySelectorAll("video")).concat(Array.from(document.querySelectorAll("#host")).flatMap((h) => h.shadowRoot ? Array.from(h.shadowRoot.querySelectorAll("video")) : [])).map((v) => [v.currentTime, v.paused, v.readyState])') or [])]
        def playing():
            if sid in ('f1c', 'r1', 'r2'): return pg.evaluate('() => window.S4A && S4A.players.length === 2 && S4A.players[1].segs >= 3 && document.getElementById("v0").currentTime > 2')
            if sid in ('f1', 'f1b'): return pg.evaluate('() => window.S4A && S4A.players.length === 2 && S4A.players[1].segs >= 3 && document.getElementById("v0").currentTime > 2')
            return any(v[0] > 6 for v in vids())
        r['plays'] = wait(playing, 45)
        for f in pg.frames:
            try: f.evaluate('() => { document.querySelectorAll("video").forEach((v) => { v.muted = false; }); document.querySelectorAll("#host").forEach((h) => h.shadowRoot && h.shadowRoot.querySelectorAll("video").forEach((v) => { v.muted = false; })); }')
            except Exception: pass
        time.sleep(1.5)
        r['video'] = vids()
        # Stückabrufe des Browsers bis hierher (nur Datei + Zeit relativ, für die Auswertung des Prüfstands)
        r['seg_hits'] = [[round(x['t'] - HITS[n0]['t'], 1), x['host'].split(':')[0], x['path'].rsplit('/', 1)[-1]] for x in HITS[n0:] if re.search(r'\.(m4s|webm|mp4)$', x['path'])]
        r['own'] = None
        try: r['own'] = pg.evaluate('() => window.S4A ? S4A.players.map((p) => ({ segs: p.segs, err: p.err })) : null')
        except Exception: pass
        # Diagnose (anonym) – zuerst Hauptfenster, sonst das Fenster mit dem Video
        def diag(frame_all=False):
            tab = sw.evaluate('async () => (await chrome.tabs.query({})).filter((t) => /\\/p\\//.test(t.url)).pop().id')
            pg.evaluate('() => navigator.clipboard.writeText("-")')
            if frame_all: sw.evaluate('(t) => chrome.tabs.sendMessage(t, { t: "kadri-menu" })', tab)
            else: sw.evaluate('(t) => chrome.tabs.sendMessage(t, { t: "kadri-menu" }, { frameId: 0 })', tab)
            fr = [None]
            order = [f for f in pg.frames if f != pg.main_frame] + [pg.main_frame] if frame_all else [pg.main_frame]
            wait(lambda: fr.__setitem__(0, next((f for f in order if f.evaluate(js('return !!r.querySelector(".diag .danon");'))), None)) or fr[0], 8)
            if not fr[0]: return ''
            fr[0].evaluate(js('r.querySelector(".diag .danon").click(); return true;'))
            got = ['']
            wait(lambda: got.__setitem__(0, pg.evaluate('() => navigator.clipboard.readText()')) or got[0].startswith('Kadri – anonymisierte Diagnose'), 8)
            for f in pg.frames:
                try: f.evaluate(js('const b = Array.from(r.querySelectorAll(".diag button")).find((x) => x.textContent === "Schließen"); if (b) b.click(); return true;'))
                except Exception: pass
            return got[0]
        # Diagnose des Fensters, in dem das Video läuft: lange auf ▶ der Pille drücken (wie auf dem Gerät, src/035)
        cdp = ctx.new_cdp_session(pg)
        def diag_press(raw=False):
            if not wait(lambda: pg.evaluate(js('return !!r.querySelector(".pill.on button[aria-label=\\"Im Videoplayer öffnen\\"]");')), 12): return ''
            rc = pg.evaluate(js('const b = r.querySelector(".pill.on button[aria-label=\\"Im Videoplayer öffnen\\"]").getBoundingClientRect(); return [b.x + b.width / 2, b.y + b.height / 2];'))
            pg.evaluate('() => navigator.clipboard.writeText("-")')
            cdp.send('Input.dispatchTouchEvent', {'type': 'touchStart', 'touchPoints': [{'x': rc[0], 'y': rc[1]}]}); time.sleep(1.0)
            cdp.send('Input.dispatchTouchEvent', {'type': 'touchEnd', 'touchPoints': []})
            got = ['']
            wait(lambda: got.__setitem__(0, pg.evaluate('() => navigator.clipboard.readText()')) or got[0].startswith('Kadri – anonymisierte Diagnose'), 8)
            # nur die anonyme Fassung übernehmen (bei einem Video im Hauptfenster bzw. im srcdoc-Fenster kopiert der Langdruck die
            # vollständige lokale Diagnose mit Adressen – die gehört nicht ins Protokoll)
            if raw: return got[0]
            return got[0] if got[0].startswith('Kadri – anonymisierte Diagnose') else ''
        dg = diag()
        if sid in ('a1', 'c2'): r['longpress'] = diag_press(raw=True)   # S4b: Langdruck oben auf ▶ (Video im Hauptfenster bzw. srcdoc)
        if sid.startswith('c'):
            dg2 = diag_press()
            if dg2: r['diag_frame'] = dg2
        r['diag'] = dg
        allg = dg + '\n' + r.get('diag_frame', '')
        r['lines'] = [l for l in allg.split('\n') if l.strip().startswith(KEEP) or 'Bindung' in l]
        b = re.findall(r'Bindung (\w+)\(([^)]*)\)', allg); r['bindung'] = b
        r['bound'] = any(x[0] == 'bound' for x in b)
        r['pruef'] = re.findall(r'Ergebnis (\w+) \(([^)]*)\)(?: · ([^\n·]+))?', allg)
        # Menü
        it = []
        n_menu = len(HITS)
        if wait(lambda: pg.evaluate(js('return !!r.querySelector(".pill.on");')), 12):
            time.sleep(0.3)
            pg.evaluate(js('r.querySelector(".pill.on button[aria-label=\\"Video speichern\\"]").click(); return true;'))
            wait(lambda: any(x[0] != 'Schließen' for x in (pg.evaluate(js(ITEMS)) or [])), 15)
            it = [x for x in (pg.evaluate(js(ITEMS)) or []) if x[0] != 'Schließen']
        else: r['pill'] = False
        r['menu'] = it
        r['offer'] = OFFER in [x[0] for x in it]
        if not r['offer']:   # S4b-5: ohne Angebot fragt Kadri den Helfer nicht (dashplan lädt das MPD – hier darf keins kommen)
            time.sleep(2.0)
            r['mpd_after_menu'] = len([x for x in HITS[n_menu:] if x['path'].endswith('.mpd')])
        if r['offer'] and do_plan:
            n1 = len(HITS)
            # S4b-3: das Ergebnis des Tipps ist die Auswahl selbst oder ein NEUER Hinweis. Ein noch sichtbarer älterer Hinweis (z. B.
            # „Diagnose kopiert“) ist kein Ergebnis – in S4a hat genau das die Fenster-Szenarien als „hängt“ fehlgedeutet.
            toast0 = pg.evaluate(js('const t = r.querySelector(".toast"); return t ? t.textContent : "";'))
            pg.evaluate(js('const t = r.querySelector(".toast"); if (t) t.textContent = ""; return true;'))
            if sid in ('c1n', 'c1w', 'a2w', 'c1t'): DELAY[sid] = 6
            if sid == 'c1t': FAILMPD.add('c1t')
            if sid == 'c1x': DELAY['c1x'] = 50
            pg.evaluate(js('const b = Array.from(r.querySelectorAll(".dlm .dli")).find((x) => x.firstChild.textContent === %s); b.click(); return true;' % json.dumps(OFFER)))
            special = sid in ('c1w', 'a2w', 'c1t', 'c1x')
            def replay():   # (kurzes Testvideo: weiterlaufen lassen, damit Knopf und Fenster-Diagnose danach verfügbar sind)
                for f in pg.frames:
                    try: f.evaluate('() => document.querySelectorAll("video").forEach((v) => { if (v.ended || v.paused || v.currentTime > 12) { v.currentTime = 0; v.play().catch(() => {}); } })')
                    except Exception: pass
            head = lambda: pg.evaluate(js('const h = r.querySelector(".dlm .dlh"); return h ? h.textContent : "";'))
            toastt = lambda: pg.evaluate(js('const t = r.querySelector(".toast"); return t ? t.textContent : "";'))
            fsheets = lambda: [f.evaluate(js('return r.querySelectorAll(".dlm").length;')) for f in pg.frames if f != pg.main_frame]
            if sid in ('c1w', 'a2w'):
                # Warteblatt steht („Helfer-App prüft …“); bewusst schließen, bevor die (langsame) Planung antwortet
                time.sleep(1.2)
                r['wait_shown'] = pg.evaluate(js('return !!r.querySelector(".dlm.wait .dlw");'))
                pg.evaluate(js('const b = r.querySelector(".dlm .dlx"); if (b) b.click(); return true;'))
                replay(); time.sleep(9)
                DELAY[sid] = 0
                r['head_after'] = head(); r['frame_sheets'] = fsheets(); r['toast_after'] = toastt()
            if sid == 'c1t':
                time.sleep(1.5)
                pg.evaluate(js('r.querySelector(".pill.on button[aria-label=\\"Video speichern\\"]").click(); return true;'))
                wait(lambda: OFFER in [x[0] for x in (pg.evaluate(js(ITEMS)) or [])], 10)
                r['menu_b'] = [x[0] for x in (pg.evaluate(js(ITEMS)) or [])]
                seen = set()
                end = time.time() + 9
                while time.time() < end: seen.add(toastt()); time.sleep(0.1)
                DELAY['c1t'] = 0; FAILMPD.discard('c1t')
                r['toasts_seen'] = sorted(x for x in seen if x)
                r['head_after'] = head(); r['frame_sheets'] = fsheets()
            if sid == 'c1x':
                t0 = time.time(); log = []
                while time.time() - t0 < 62:
                    st_ = (head(), toastt(), pg.evaluate(js('return !!r.querySelector(".dlm.wait");')), tuple(fsheets()))
                    if not log or log[-1][1:] != st_: log.append((round(time.time() - t0, 1),) + st_)
                    time.sleep(0.25)
                DELAY['c1x'] = 0
                r['timeline'] = log
                r['head_after'] = head(); r['frame_sheets'] = fsheets()
            if sid == 'c1n':
                # während die (langsame) Planung läuft: neuer Tipp auf ⬇ → neue Auswahl „Speichern“; die späte Planantwort
                # gehört zum älteren Tipp und darf weder oben noch im Fenster als Auswahl erscheinen
                time.sleep(1.5)
                pg.evaluate(js('r.querySelector(".pill.on button[aria-label=\\"Video speichern\\"]").click(); return true;'))
                wait(lambda: OFFER in [x[0] for x in (pg.evaluate(js(ITEMS)) or [])], 10)
                r['menu_b'] = [x[0] for x in (pg.evaluate(js(ITEMS)) or [])]
                time.sleep(9)
                DELAY['c1n'] = 0
                r['head_after'] = pg.evaluate(js('const h = r.querySelector(".dlm .dlh"); return h ? h.textContent : "";'))
                r['frame_sheets'] = [f.evaluate(js('return r.querySelectorAll(".dlm").length;')) for f in pg.frames if f != pg.main_frame]
            if not special: wait(lambda: pg.evaluate(js('const h = r.querySelector(".dlm .dlh"); const t = r.querySelector(".toast"); return (h && h.textContent === "DASH-Stream speichern") || (t && t.textContent && !/prüft/.test(t.textContent));')), 45)
            o = [x for x in (pg.evaluate(js(ITEMS)) or []) if x[0] != 'Schließen']
            r['plan'] = o if pg.evaluate(js('const h = r.querySelector(".dlm .dlh"); return !!h && h.textContent === "DASH-Stream speichern";')) else []
            r['toast'] = pg.evaluate(js('const t = r.querySelector(".toast"); return t ? t.textContent : "";'))
            r['toast_vorher'] = toast0
            hh = [x for x in HITS[n1:] if not x['path'].startswith(('/p/', '/lib/'))]
            r['mpd_after_tap'] = len([x for x in hh if x['path'].endswith('.mpd')])   # (statisches MPD: danach lädt es nur noch der Helfer)
            r['helper_clean'] = not any(x['cookie'] or x['auth'] for x in hh)
            if not r['plan'] and not special:
                d3 = diag_press() if sid.startswith('c') else diag(); r['helper_line'] = next((l for l in d3.split('\n') if l.startswith(' 1. Typ ')), '')
            elif do_start:
                f0 = helper.cmd('dl-files'); n2 = len(HITS)
                # doppelter Tipp auf dieselbe Option (gleicher Takt): genau EIN Auftrag
                pg.evaluate(js('const b = Array.from(r.querySelectorAll(".dlm .dli")).find((x) => x.firstChild.textContent === %s); b.click(); b.click(); return true;' % json.dumps(r['plan'][0][0])))
                got = ['']
                wait(lambda: got.__setitem__(0, helper.cmd('dl-files')) or (got[0] != f0 and re.search(r':\d{5,}', got[0])), 45)
                time.sleep(3)
                got[0] = helper.cmd('dl-files')
                r['file'] = got[0] if got[0] != f0 else ''
                r['new_files'] = [x for x in got[0].split()[1:] if x not in f0.split()[1:]]
                r['dl_hosts'] = sorted({x['host'] for x in HITS[n2:] if re.search(r'(init|chunk)-', x['path'])})   # S4b-6: Hosts der Helfer-Abrufe
                r['helper_clean'] = r['helper_clean'] and not any(x['cookie'] or x['auth'] for x in HITS[n2:])
                d3 = diag(); r['helper_line'] = next((l for l in d3.split('\n') if l.startswith(' 1. Typ ')), '')
            if sid.startswith('c') or sid == 'a2w':   # S4b-3: Relay-Spur beider Seiten (anonym)
                spur = lambda t: next((l for l in t.split('\n') if l.startswith('Relay-Spur')), '')
                r['trace_top'] = spur(diag())
                try: pg.evaluate(js('const b = r.querySelector(".dlm .dlx"); if (b) b.click(); return true;'))
                except Exception: pass
                for f in pg.frames:   # (kurzes Testvideo evtl. schon zu Ende: wieder abspielen, damit der Knopf oben steht)
                    try: f.evaluate('() => document.querySelectorAll("video").forEach((v) => { if (v.ended || v.paused) { v.currentTime = 0; v.play().catch(() => {}); } })')
                    except Exception: pass
                time.sleep(1.5)
                r['trace_frame'] = spur(diag_press())
                print('     SPUR oben:    ' + r['trace_top'][:1800]); print('     SPUR Fenster: ' + r['trace_frame'][:1800])
        try: pg.evaluate(js('const b = r.querySelector(".dlm .dlx"); if (b) b.click(); return true;'))
        except Exception: pass
        r['errs'] = errs
        r['anon'] = not re.search(r'://|127\.0\.0|example\.org|manifest\.mpd|chunk-|init-\d|/m/|s4a-token|sig=', allg)
        RES.append(r)
        print('[%s] spielt=%s bound=%s Prüfung=%s Angebot=%s Plan=%s Menü=%s' % (sid, r['plays'], r['bound'], r['pruef'][:2], r['offer'],
              [x[0] for x in r.get('plan', [])] or r.get('toast', ''), [x[0] + (' | ' + x[1] if x[1] else '') for x in it][:3]))
        for l in r['lines']: print('     ' + l.strip()[:260])
        # ---- Sicherheits-Erwartungen ----
        if safety == 'nie': check('[%s] Sicherheit: bindet nicht (%s)' % (sid, title), not r['bound'] and not r['offer'], r['bindung'])
        if safety == 'richtig' and r.get('plan') and sid in WANT_OPTS and WANT_OPTS[sid]:
            check('[%s] Sicherheit: Bindung trifft das laufende Manifest (Optionen %s)' % (sid, WANT_OPTS[sid]), [x[0] for x in r['plan']] == WANT_OPTS[sid], r['plan'])
        check('[%s] Diagnose anonym' % sid, r['anon'])
        # ---- Funktions-Erwartungen (hart) ----
        ex = EXPECT.get(sid)
        if ex:
            check('[%s] Funktion: Bindung %s' % (sid, 'ja' if ex['bound'] else 'nein'), r['bound'] == ex['bound'], r['bindung'])
            check('[%s] Funktion: Angebot %s' % (sid, 'ja' if ex['offer'] else 'nein'), r['offer'] == ex['offer'], it[:2])
            if ex.get('noplan'): check('[%s] Funktion: kein dashplan – der Helfer lädt das MPD nicht' % sid, r.get('mpd_after_menu') == 0, r.get('mpd_after_menu'))
            if ex.get('plan') == 'rejected': check('[%s] Funktion: Helfer lehnt beim Plan ab' % sid, not r.get('plan') and 'abgelehnt' in r.get('helper_line', ''), r.get('helper_line'))
            elif ex.get('plan'): check('[%s] Funktion: Planoptionen %s' % (sid, ' + '.join(x.split(' ')[0] for x in ex['plan'])), sorted(x[0] for x in r.get('plan', [])) == sorted(ex['plan']), r.get('plan') or r.get('toast'))
            if sid == 'd5':   # S4b-6: der Helfer lud alle Init-/Stückabrufe über die ZWEITE BaseURL (CDN-Host), keinen über die erste
                check('[d5] Funktion: Download vollständig über die zweite BaseURL (alle Stückabrufe an %s)' % OTHER_NAME, r.get('dl_hosts') == [OTHER], r.get('dl_hosts'))
            if ex.get('file'):
                sizes = [int(x.rsplit(':', 1)[1]) for x in r.get('new_files', []) if ':' in x]
                check('[%s] Funktion: genau EIN Download trotz Doppeltipp, Datei vollständig (%s Byte)' % (sid, '/'.join(map(str, sorted(FILE_OK)))), len(sizes) == 1 and sizes[0] in FILE_OK, r.get('new_files'))
            if r.get('mpd_after_tap') is not None and r.get('plan'): check('[%s] Funktion: Helfer lud das MPD genau einmal (ohne Cookie/Authorization)' % sid, r['mpd_after_tap'] == 1 and r['helper_clean'], (r['mpd_after_tap'], r['helper_clean']))
        # ---- S4b: Ebenen und Meldungen (hart) ----
        if sid in LV:
            want_lv, want_msg, want_sub = LV[sid]
            lvl = next((l.strip() for l in allg.split('\n') if l.strip().startswith('DASH-Ebenen:')), '')
            mm = re.search(r'erste blockierende Ebene (\S+)(?: \((\S+)\))?', lvl)
            got_lv = None if not lvl else (mm.group(2) or mm.group(1)) if mm else '?'
            r['levels'] = lvl
            check('[%s] Ebenen: erste blockierende Ebene %s' % (sid, want_lv), got_lv == want_lv, lvl or '(keine DASH-Ebenen-Zeile)')
            if want_msg:
                m0 = it[0] if it else ['', '']
                check('[%s] Menü: „%s“' % (sid, want_msg), m0[0] == want_msg and (not want_sub or re.search(want_sub, m0[1])), m0)
                hint = next((l for l in allg.split('\n') if 'Hinweis im Menü: ' in l), '').split('Hinweis im Menü: ', 1)[-1]
                check('[%s] Diagnose nennt denselben Hinweis wie das Menü (eine Entscheidungsfunktion)' % sid, hint == (m0[0] + (' – ' + m0[1] if m0[1] else '')), [hint, m0])
        check('[%s] Menü ohne „derzeit nicht unterstützt“' % sid, not any('derzeit nicht unterstützt' in (x[0] + x[1]) for x in it), it)
        if 'longpress' in r:
            lp = r['longpress']
            check('[%s] Langdruck auf ▶ kopiert die anonymisierte Diagnose (keine Adresse, kein Token)' % sid, lp.startswith('Kadri – anonymisierte Diagnose')
                  and not re.search(r'://|127\.0\.0|example\.org|manifest\.mpd|chunk-|/m/|/p/|s4a-token|sig=', lp), lp[:200])
        if sid in ('c1w', 'a2w'):
            spur = r.get('trace_top', '') + ' ' + r.get('trace_frame', '')
            check('[%s] Warteblatt „Helfer-App prüft …“ stand während der Planung' % sid, r.get('wait_shown') is True, r.get('wait_shown'))
            check('[%s] bewusst geschlossen: die späte Planantwort öffnet kein Blatt (oben)' % sid, r.get('head_after') == '', r.get('head_after'))
            check('[%s] … und kein Blatt im Fenster' % sid, not any(r.get('frame_sheets') or []), r.get('frame_sheets'))
            check('[%s] … Helfer lud das MPD genau einmal, kein Download gestartet' % sid, r.get('mpd_after_tap') == 1 and not r.get('new_files'), r.get('mpd_after_tap'))
            check('[%s] … Spur: Abbruch beim Schließen, späte Antwort verworfen' % sid, 'ablauf:abgebrochen(schliessen)' in spur and
                  (('top:menu-abgelehnt(abgebrochen)' in spur and (not r.get('trace_frame') or 'frame:menu-reply(veraltet)' in spur)) if sid == 'c1w' else 'blatt:veraltet' in spur), spur[-900:])
        if sid == 'c1t':
            spur = r.get('trace_top', '')
            check('[c1t] neuer Tipp ⬇ während der Planung: neue Auswahl erscheint', OFFER in r.get('menu_b', []), r.get('menu_b'))
            check('[c1t] später Fehler-Hinweis des älteren Tipps oben abgelehnt (veraltet), nie sichtbar', 'top:toast-abgelehnt(veraltet)' in spur
                  and not any(re.search(r'nicht speichern|nicht erreichbar|HTTP|Fehler', x) for x in r.get('toasts_seen', [])), [r.get('toasts_seen'), spur[-600:]])
            check('[c1t] die neuere Auswahl bleibt stehen', r.get('head_after') == 'Speichern', r.get('head_after'))
        if sid == 'c1x':
            tl = r.get('timeline', [])
            ends = [x for x in tl if not x[3] and x[0] > 1]   # Warteblatt zu
            last = tl[-1] if tl else None
            check('[c1x] Planung über 45 s (echte Zeit): nie eine Planauswahl', not any(x[1] == 'DASH-Stream speichern' for x in tl), tl)
            check('[c1x] … Warteblatt kontrolliert beendet (spätestens nach 47 s) mit Hinweis', bool(ends) and ends[0][0] <= 47 and bool(ends[0][2]), tl[:12])
            check('[c1x] … kein Blatt im Fenster, keins oben am Ende', last is not None and not any(last[4]) and r.get('head_after') == '', last)
            check('[c1x] … kein Download gestartet, Helfer-Abruf des MPD höchstens einmal', not r.get('new_files') and r.get('mpd_after_tap', 0) <= 1, r.get('mpd_after_tap'))
        if sid == 'c1n':
            m = re.search(r'([0-9a-f]{8}) top:pick\(seq=1 i=0\)', r.get('trace_top', ''))
            a = m.group(1) if m else '?'
            check('[c1n] neuer Tipp während langsamer Planung: Auswahl „Speichern“ mit Angebot erscheint', OFFER in r.get('menu_b', []), r.get('menu_b'))
            check('[c1n] späte Planantwort des älteren Tipps oben als veraltet abgelehnt', (a + ' top:menu-abgelehnt(veraltet)') in r.get('trace_top', ''), r.get('trace_top', '')[-700:])
            check('[c1n] … und im Fenster verworfen (keine lokale Auswahl im iframe)', (a + ' frame:menu-reply(veraltet)') in r.get('trace_frame', '') and not any(r.get('frame_sheets', [1])), (r.get('frame_sheets'), r.get('trace_frame', '')[-500:]))
            check('[c1n] oben bleibt die neuere Auswahl „Speichern“ (keine Qualitätsauswahl aus der veralteten Antwort)', r.get('head_after') == 'Speichern', r.get('head_after'))
        if sid in ('c1', 'c3') and r.get('trace_top'):
            # Relay-Spur: die Auswahl des Plans kam oben mit der Kennung des Tipps auf das Angebot an (Zuordnung über rid)
            m = re.search(r'([0-9a-f]{8}) top:pick\(seq=1 i=0\)', r['trace_top'])
            check('[%s] Relay: Planauswahl oben mit der Kennung genau dieses Tipps gezeigt, keine Ablehnung' % sid,
                  bool(m) and (m.group(1) + ' top:menu-gezeigt(seq=2') in r['trace_top'] and 'menu-abgelehnt' not in r['trace_top']
                  and bool(m) and (m.group(1) + ' plan:helfer-antwort(ok') in r['trace_frame'], (r['trace_top'][-600:], r['trace_frame'][-600:]))
        pg.close()
    ctx.close()
helper.stop() if hasattr(helper, 'stop') else None
if OUTDIR:
    os.makedirs(OUTDIR, exist_ok=True)
    json.dump(RES, open(os.path.join(OUTDIR, 's4a-matrix.json'), 'w'), ensure_ascii=False, indent=1)
done()
