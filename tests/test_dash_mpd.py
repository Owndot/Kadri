# S1 DASH: MPD-Einordnung (src/038 dashManifestSummary) mit dem echten DOMParser von Chromium und dem unabhängigen
# Schema-Gate des Quellenmodells (src/045 mediaManifestOk) – an realistischen MPDs (shaka-packager-, ffmpeg-, On-Demand-,
# Live-, Multi-Period-, WebM-, AV1/HEVC-, DRM-, Thumbnail-Stil) und an Angriffen (DOCTYPE/Entitäten, XXE, kein MPD,
# kaputtes XML, Größen- und Strukturgrenzen). Kein Netzabruf, keine Erweiterung nötig.
import os, json, re
from common import *   # noqa: E402

ROOT = os.path.join(HERE, '..')
FIX = os.path.join(WEB, 'dash')
SRC = open(os.path.join(ROOT, 'src', '038-dash-manifest.js'), encoding='utf-8').read() + '\n' + open(os.path.join(ROOT, 'src', '045-media-source.js'), encoding='utf-8').read()
def fx(n): return open(os.path.join(FIX, n), encoding='utf-8').read()

with sync_playwright() as p:
    br = p.chromium.launch(executable_path=os.environ.get('KADRI_CHROMIUM') or None)
    pg = br.new_page()
    pg.set_content('<!doctype html><title>mpd</title>')
    pg.add_script_tag(content=SRC + '\nwindow.__sum = (t) => { const s = dashManifestSummary(t); return { s: s, ok: mediaManifestOk(s) }; };'
                      '\nwindow.__ok = (m) => mediaManifestOk(m);'
                      '\nwindow.__idx = (t, u, keys) => { const ix = dashSegmentIndex(dashParse(t), u); return { reps: ix.reps.length, single: ix.single,'
                      ' m: keys.map((k) => dashMatchSegment(ix, dashUrlKey(k))) }; };'
                      '\nwindow.__cls = (t, u, keys) => { const ix = dashSegmentIndex(dashParse(t), u); return keys.map((k) => dashDiagClassify(ix, dashUrlKey(k))); };'
                      # wie dashHit (040) + dashBindingFor (060): nur dashMatchSegment erzeugt Treffer – die Diagnose-Stufen nie
                      '\nwindow.__bindVia = (t, u, keys) => { const ix = dashSegmentIndex(dashParse(t), u), now = 1e6, hits = [];'
                      ' keys.forEach((k, i) => { const m = dashMatchSegment(ix, dashUrlKey(k)); if (m && !m.init) hits.push({ rep: m.rep, idx: m.idx, t: now - 3000 + i * 100 }); });'
                      ' const r = dashBindDecision({ manifests: [{ key: "A", hits: hits, duration: 0, checkable: ix.reps.length > 0 }], from: 0, now: now, video: { duration: NaN, othersPlaying: false } }).A;'
                      ' return { state: r.state, reason: r.reason, hits: r.hits, cls: keys.map((k) => dashDiagClassify(ix, dashUrlKey(k))) }; };')
    def run(text):
        r = pg.evaluate('(t) => window.__sum(t)', text)
        return r['s'], r['ok']
    def tracks(s, kind): return [t for t in s['tracks'] if t['kind'] == kind]
    LEAK = re.compile(r'\$|\.m4s|\.mp4|\.webm|\.jpg|\.vtt|init|video/|audio/|chunk|av1-1080|clear-sd|hevc-2160|V300|A48|00000000-|default_KID|file:|etc/passwd|http')
    results = {}

    # ---------- realistische MPDs ----------
    s, ok = run(fx('vod-timeline-avc-aac.mpd')); results['timeline'] = s
    v, a, t = tracks(s, 'video'), tracks(s, 'audio'), tracks(s, 'text')
    check('shaka-Stil VOD: static, Dauer, 1 Periode, 4 AdaptationSets, 6 Darstellungen, gültig',
          ok and not s['error'] and s['type'] == 'static' and s['duration'] == 5525.12 and s['periods'] == 1 and s['adaptationSets'] == 4 and s['representations'] == 6, s)
    check('… Video 3× avc/mp4 mit 360/720/1080p und Datenraten', [x['height'] for x in v] == [360, 720, 1080] and all(x['codecs'] == ['avc'] and x['container'] == 'mp4' for x in v)
          and [x['bandwidth'] for x in v] == [800000, 2400000, 4500000], v)
    check('… Audio 2× aac, Sprachen de/en; Text 1× ttml (application/mp4)', [x['lang'] for x in a] == ['de', 'en'] and all(x['codecs'] == ['aac'] for x in a)
          and len(t) == 1 and t[0]['codecs'] == ['ttml'] and t[0]['container'] == 'mp4', (a, t))
    check('… Adressierung: Bild/Ton SegmentTemplate+Timeline, Text Template mit Dauer',
          all(x['addressing'] == 'template-timeline' for x in v + a) and t[0]['addressing'] == 'template-duration' and sorted(s['addressing']) == ['template-duration', 'template-timeline'], s['addressing'])
    check('… kein Schutz angegeben → nur „nicht angegeben“ (signaled false), nie „unverschlüsselt“; keine Darstellung als geschützt',
          s['protection'] == {'signaled': False, 'systems': [], 'defaultKid': False} and not any(x['protected'] for x in s['tracks']) and 'clear' not in json.dumps(s), s['protection'])

    s, ok = run(fx('vod-number-ffmpeg.mpd')); results['ffmpeg'] = s
    check('ffmpeg-Stil: Template mit $Number$/Dauer je Darstellung, avc 854×480 + aac, Dauer 1450.5 s', ok and s['duration'] == 1450.5 and s['addressing'] == ['template-duration']
          and tracks(s, 'video')[0]['height'] == 480 and tracks(s, 'video')[0]['width'] == 854 and tracks(s, 'audio')[0]['codecs'] == ['aac'] and tracks(s, 'audio')[0]['lang'] == 'und', s)
    s, ok = run(fx('vod-segmentlist.mpd')); results['list'] = s
    check('SegmentList (Full-Profil): Adressierung list, HE-AAC als aac, Sprache fr', ok and s['addressing'] == ['list'] and tracks(s, 'audio')[0]['codecs'] == ['aac'] and tracks(s, 'audio')[0]['lang'] == 'fr', s)
    s, ok = run(fx('vod-ondemand-segmentbase.mpd')); results['base'] = s
    check('On-Demand (SegmentBase, eine Datei je Spur): Adressierung base, 1080p', ok and s['addressing'] == ['base'] and tracks(s, 'video')[0]['height'] == 1080 and s['duration'] == 596.46, s)
    s, ok = run(fx('live-dynamic.mpd')); results['live'] = s
    check('Live (dynamic): type dynamic, keine Dauer, Template mit Dauer', ok and s['type'] == 'dynamic' and s['duration'] is None and s['addressing'] == ['template-duration'], s)
    s, ok = run(fx('vod-multi-period.mpd')); results['multi'] = s
    check('Mehrere Perioden (Vorspann + Hauptfilm): 2 Perioden, 4 Darstellungen gezählt', ok and s['periods'] == 2 and s['representations'] == 4 and s['adaptationSets'] == 3, s)
    s, ok = run(fx('vod-webm-vp9-opus.mpd')); results['webm'] = s
    check('WebM: Container webm, vp9 bis 1080p und opus erkannt (für später offen, nicht verworfen)', ok and {x['container'] for x in s['tracks']} == {'webm'}
          and [x['codecs'] for x in tracks(s, 'video')] == [['vp9'], ['vp9']] and tracks(s, 'audio')[0]['codecs'] == ['opus'] and tracks(s, 'audio')[0]['lang'] == 'eng', s)
    s, ok = run(fx('vod-av1-hevc-inherit.mpd')); results['av1'] = s
    v = tracks(s, 'video')
    check('AV1 + HEVC (2160p): Familien erkannt; geerbte Zeitleiste trotz eigener Vorlage der Darstellung',
          ok and [x['codecs'] for x in v] == [['av1'], ['hevc']] and [x['height'] for x in v] == [1080, 2160] and all(x['addressing'] == 'template-timeline' for x in v), v)
    check('… Audio E-AC-3 und AAC (Sprache ja), Template mit Dauer', [x['codecs'] for x in tracks(s, 'audio')] == [['ec3'], ['aac']] and all(x['addressing'] == 'template-duration' and x['lang'] == 'ja' for x in tracks(s, 'audio')), tracks(s, 'audio'))
    s, ok = run(fx('vod-drm-cenc.mpd')); results['cenc'] = s
    check('DRM (CENC + Widevine + PlayReady, auch Großschreibung der UUID): Schutz angegeben, Systeme, default_KID; alle Spuren geschützt',
          ok and s['protection']['signaled'] and sorted(s['protection']['systems']) == ['cenc', 'playready', 'widevine'] and s['protection']['defaultKid'] and all(x['protected'] for x in s['tracks']), s['protection'])
    s, ok = run(fx('vod-drm-cbcs-rep.mpd')); results['cbcs'] = s
    check('Schutz nur an einer Darstellung (cbcs, FairPlay): diese geschützt, die andere ohne Angabe',
          ok and sorted(s['protection']['systems']) == ['cbcs', 'cenc', 'fairplay'] and [x['protected'] for x in s['tracks']] == [False, True] and not s['protection']['defaultKid'], s)
    s, ok = run(fx('vod-thumbnails-muxed.mpd')); results['thumbs'] = s
    check('gemuxte Darstellung (avc+aac) als Video; Vorschaubilder als Bild; WebVTT als Text (Einzeldatei)',
          ok and tracks(s, 'video')[0]['codecs'] == ['avc', 'aac'] and tracks(s, 'image')[0]['container'] == 'image' and tracks(s, 'text')[0]['container'] == 'text'
          and tracks(s, 'text')[0]['addressing'] == 'single-file', s)
    s, ok = run(fx('vod-prefixed-ns.mpd'))
    check('Namensraum mit Präfix (dash:MPD): ebenso erkannt', ok and not s['error'] and tracks(s, 'video')[0]['height'] == 240, s)
    check('keine Adresse, kein Pfad, keine Darstellungs-ID, kein KID in irgendeiner Zusammenfassung',
          not any(LEAK.search(json.dumps(x)) for x in results.values()), [k for k, x in results.items() if LEAK.search(json.dumps(x))])

    # ---------- S2: erwartete Stück-Adressen je Darstellung (privat) und Zuordnung beobachteter Abrufe ----------
    def idx(name, url, keys): return pg.evaluate('([t, u, k]) => window.__idx(t, u, k)', [fx(name), url, keys])
    M = 'https://cdn.example/v/manifest.mpd'
    r = idx('vod-number-ffmpeg.mpd', M, ['https://cdn.example/v/chunk-stream0-00001.m4s', 'https://cdn.example/v/chunk-stream0-00003.m4s?x=1',
                                         'https://cdn.example/v/chunk-stream1-00002.m4s', 'https://cdn.example/v/init-stream0.m4s',
                                         'https://cdn.example/v/chunk-stream0-00001.mp4', 'https://other.example/v/chunk-stream0-00001.m4s'])
    check('$Number%05d$ (ffmpeg): Stücknummer je Darstellung (− startNumber), Init erkannt; zusätzlicher Query-Parameter, andere Endung/anderer Host: kein Treffer',
          r['reps'] == 2 and r['m'][0] == {'rep': 0, 'idx': 0} and r['m'][1] is None and r['m'][2] == {'rep': 1, 'idx': 1}
          and r['m'][3] == {'rep': 0, 'init': True} and r['m'][4] is None and r['m'][5] is None, r)
    r = idx('vod-timeline-avc-aac.mpd', M, ['https://cdn.example/v/video/0/0.m4s', 'https://cdn.example/v/video/0/76800.m4s', 'https://cdn.example/v/video/2/153600.m4s',
                                            'https://cdn.example/v/video/0/76801.m4s', 'https://cdn.example/v/audio/de/288768.m4s'])
    check('$Time$ über SegmentTimeline (r-Wiederholungen): Zeit → Stücknummer; Zeit außerhalb der Zeitleiste: kein Treffer',
          r['m'][0] == {'rep': 0, 'idx': 0} and r['m'][1] == {'rep': 0, 'idx': 1} and r['m'][2] == {'rep': 2, 'idx': 2} and r['m'][3] is None
          and r['m'][4] == {'rep': 3, 'idx': 1}, r)
    r = idx('vod-segmentlist.mpd', M, ['https://cdn.example/v/media/v360/seg-2.m4s', 'https://cdn.example/v/media/a/seg-3.m4s', 'https://cdn.example/v/media/v360/init.mp4'])
    check('SegmentList mit BaseURL der MPD-Ebene: Reihenfolge der SegmentURL = Stücknummer; Init erkannt',
          r['m'][0] == {'rep': 0, 'idx': 1} and r['m'][1] == {'rep': 1, 'idx': 2} and r['m'][2] == {'rep': 0, 'init': True}, r)
    r = idx('vod-baseurl-chain.mpd', M, ['https://cdn2.example/content/p1/video/720/7.jpg', 'https://cdn2.example/content/p1/lowres/360/2.jpg',
                                         'https://audio.example/a/seg-128000-0005.m4s?tok=1', 'https://cdn2.example/content/p1/video/720/init.jpg',
                                         'https://cdn.example/v/720/7.jpg', 'https://audio.example/a/seg-128000-0005.m4s'])
    check('BaseURL-Kette (absolut → Periode → AdaptationSet → Darstellung, auch ../ und anderer Host), $RepresentationID$/$Bandwidth$, getarnte Endung .jpg',
          r['m'][0] == {'rep': 0, 'idx': 6} and r['m'][1] == {'rep': 1, 'idx': 1} and r['m'][2] == {'rep': 2, 'idx': 5}
          and r['m'][3] == {'rep': 0, 'init': True} and r['m'][4] is None and r['m'][5] is None, r)
    # ---------- Identität über die Query (S2-Korrektur): bedeutungstragende Parameter werden nicht ignoriert ----------
    QV = ('<MPD xmlns="urn:mpeg:dash:schema:mpd:2011" type="static" mediaPresentationDuration="PT60S"><Period><AdaptationSet mimeType="video/mp4">'
          '<SegmentTemplate media="seg$Number%03d$.m4s?video=A" initialization="init.mp4?video=A" startNumber="0" duration="4" timescale="1"/>'
          '<Representation id="v" bandwidth="1" width="640" height="360"/></AdaptationSet></Period></MPD>')
    def idxt(text, url, keys): return pg.evaluate('([t, u, k]) => window.__idx(t, u, k)', [text, url, keys])
    r = idxt(QV, M, ['https://cdn.example/v/seg001.m4s?video=A', 'https://cdn.example/v/seg001.m4s?video=B', 'https://cdn.example/v/seg001.m4s',
                     'https://cdn.example/v/seg001.m4s?video=A&x=1', 'https://cdn.example/v/init.mp4?video=A', 'https://cdn.example/v/init.mp4?video=B'])
    check('gleicher Stückpfad, andere Video-Identität in der Query: nur ?video=A trifft; ?video=B, ohne Query oder mit zusätzlichem Parameter nicht',
          r['m'][0] == {'rep': 0, 'idx': 1} and r['m'][1] is None and r['m'][2] is None and r['m'][3] is None
          and r['m'][4] == {'rep': 0, 'init': True} and r['m'][5] is None, r)
    QN = QV.replace('seg$Number%03d$.m4s?video=A', 'chunk.m4s?v=A&amp;n=$Number$').replace('startNumber="0"', 'startNumber="1"')
    r = idxt(QN, M, ['https://cdn.example/v/chunk.m4s?v=A&n=5', 'https://cdn.example/v/chunk.m4s?v=B&n=5', 'https://cdn.example/v/chunk.m4s?n=5&v=A',
                     'https://cdn.example/v/chunk.m4s?v=A&n=x'])
    check('Stücknummer als Query-Parameter (?v=A&n=$Number$): erkannt; andere Identität, umsortierte Parameter oder keine Zahl: kein Treffer',
          r['m'][0] == {'rep': 0, 'idx': 4} and r['m'][1] is None and r['m'][2] is None and r['m'][3] is None, r)
    r = idxt(QV.replace('seg$Number%03d$.m4s?video=A', 'seg$Number$.m4s?a=$Number$'), M, ['https://cdn.example/v/seg1.m4s?a=1'])
    check('zwei Zahlen-Platzhalter in einer Vorlage: Stücknummer nicht eindeutig → nicht prüfbar', r['reps'] == 0 and r['single'] == 1 and r['m'][0] is None, r)
    r = idx('vod-av1-hevc-inherit.mpd', M, ['https://cdn.example/v/av1-1080/4000.m4s', 'https://cdn.example/v/hevc/8000.m4s', 'https://cdn.example/v/a/3.m4s'])
    check('geerbte Zeitleiste trotz eigener Vorlage der Darstellung; Template mit fester Dauer (Number, Standard-Start 1)',
          r['m'][0] == {'rep': 0, 'idx': 1} and r['m'][1] == {'rep': 1, 'idx': 2} and r['m'][2] in ({'rep': 2, 'idx': 2}, {'rep': 3, 'idx': 2}), r)
    r = idx('live-dynamic.mpd', M, ['https://cdn.example/v/V300/41.m4s'])
    check('Live: $Number$ mit startNumber 0 erkannt (Bindung möglich; Download später ohnehin nicht)', r['m'][0] == {'rep': 0, 'idx': 41}, r)
    r = idx('vod-ondemand-segmentbase.mpd', M, ['https://cdn.example/v/video_1080.mp4'])
    check('SegmentBase/Einzeldatei: keine Stückfolge prüfbar (0 Darstellungen im Index, als „single“ gezählt), kein Treffer',
          r['reps'] == 0 and r['single'] == 2 and r['m'][0] is None, r)
    r = idx('vod-webm-vp9-opus.mpd', M, ['https://cdn.example/v/video_720.webm'])
    check('WebM On-Demand (SegmentBase): ebenso nicht prüfbar', r['reps'] == 0 and r['single'] == 3 and r['m'][0] is None, r)

    # ---------- Diagnose Stufe 1: stufenweiser Abgleich (dashDiagClassify) – rein diagnostisch, nie Bindung ----------
    def cls(text, url, keys): return pg.evaluate('([t, u, k]) => window.__cls(t, u, k)', [text, url, keys])
    C = 'https://cdn.example/v/'
    r = cls(fx('vod-number-ffmpeg.mpd'), M, [C + 'chunk-stream0-00001.m4s', C + 'chunk-stream0-00001.m4s?tok=1', 'https://other.example/v/chunk-stream0-00001.m4s',
                                            C + 'chunk-stream0-00000.m4s', C + 'init-stream0.m4s', C + 'init-stream0.m4s?tok=1', 'https://other.example/v/init-stream0.m4s',
                                            C + 'chunk-stream0-00001.mp4', C + 'thumb.jpg', M])
    check('Diagnose-Abgleich $Number$: exakt / nur Query abweichend / gleicher Pfad anderer Host / Nummer unter startNumber / Init exakt, Query, Host / kein Treffer',
          r == ['exact', 'query', 'host', 'number', 'init', 'init-query', 'init-host', 'none', 'none', 'none'], r)
    r = cls(fx('vod-timeline-avc-aac.mpd'), M, [C + 'video/0/76800.m4s', C + 'video/0/76801.m4s', C + 'video/0/76800.m4s?x=1', 'https://cdn2.example/v/video/0/0.m4s',
                                               C + 'video/9/0.m4s', C + 'audio/de/init.mp4?s=2'])
    check('Diagnose-Abgleich $Time$ + Zeitleiste: Zeit nicht in der Zeitleiste → „Nummer/Zeitleiste abweichend“; Query, Host; unbekannte Darstellung → kein Treffer',
          r == ['exact', 'number', 'query', 'host', 'none', 'init-query'], r)
    r = cls(fx('vod-segmentlist.mpd'), M, [C + 'media/v360/seg-2.m4s', C + 'media/v360/seg-2.m4s?x=1', 'https://cdn2.example/v/media/v360/seg-2.m4s', C + 'media/v360/seg-99.m4s'])
    check('Diagnose-Abgleich SegmentList: exakt / nur Query / anderer Host; nicht gelistete Datei → kein Treffer', r == ['exact', 'query', 'host', 'none'], r)
    r = cls(QV, M, [C + 'seg001.m4s?video=A', C + 'seg001.m4s?video=B', C + 'seg001.m4s', C + 'init.mp4?video=B'])
    check('Diagnose-Abgleich Identität in der Query (?video=A): andere oder fehlende Query nur „Query abweichend“, Init ebenso', r == ['exact', 'query', 'query', 'init-query'], r)
    r = cls(QN, M, [C + 'chunk.m4s?v=A&n=5', C + 'chunk.m4s?v=B&n=5', C + 'chunk.m4s?v=A&n=0', C + 'chunk.m4s?n=5&v=A'])
    check('Diagnose-Abgleich Nummer in der Query: andere Identität/umsortiert → Query abweichend; n=0 unter startNumber 1 → Nummer abweichend',
          r == ['exact', 'query', 'number', 'query'], r)
    def bindVia(text, keys): return pg.evaluate('([t, u, k]) => window.__bindVia(t, u, k)', [text, M, keys])
    for what, keys, want in (('nur Query abweichend', [C + 'chunk-stream0-%05d.m4s?tok=1' % i for i in range(1, 13)], 'query'),
                             ('gleicher Pfad, anderer Host', ['https://other.example/v/chunk-stream0-%05d.m4s' % i for i in range(1, 13)], 'host')):
        r = bindVia(fx('vod-number-ffmpeg.mpd'), keys)
        check('12 Folgestücke „%s“: Diagnose zählt sie (%s), Bindung bleibt ambiguous (keine-treffer) – unscharfe Stufen binden nie' % (what, want),
              r['state'] == 'ambiguous' and r['reason'] == 'keine-treffer' and r['hits'] == 0 and r['cls'] == [want] * 12, r)
    r = bindVia(fx('vod-timeline-avc-aac.mpd'), [C + 'video/0/%d.m4s' % (i * 76800 + 1) for i in range(12)])
    check('12 Stücke mit passendem Muster, aber Zeiten außerhalb der Zeitleiste: Diagnose „Nummer/Zeitleiste abweichend“, Bindung ambiguous (keine-treffer)',
          r['state'] == 'ambiguous' and r['reason'] == 'keine-treffer' and r['cls'] == ['number'] * 12, r)
    r = bindVia(fx('vod-number-ffmpeg.mpd'), [C + 'chunk-stream0-%05d.m4s' % i for i in range(1, 13)])
    check('Gegenprobe: 12 exakte Folgestücke → bound (stueckfolge)', r['state'] == 'bound' and r['reason'] == 'stueckfolge' and r['cls'] == ['exact'] * 12, r)

    # ---------- Angriffe und Grenzen: nur ein Fehlercode, keine erfundenen Angaben ----------
    for name, text, err in [('DOCTYPE mit Entitäten-Bombe', fx('bad-doctype-entities.mpd'), 'doctype'),
                            ('externe Entität (XXE auf eine Datei)', fx('bad-xxe.mpd'), 'doctype'),
                            ('kein MPD (HTML)', fx('bad-not-mpd.xml'), 'not-mpd'),
                            ('kaputtes XML', fx('bad-broken.mpd'), 'parse'),
                            ('leer', '', 'parse'),
                            ('über 4 MB', '<MPD xmlns="urn:mpeg:dash:schema:mpd:2011">' + ' ' * 4000001 + '</MPD>', 'too-large'),
                            ('über 200000 Elemente', '<MPD xmlns="urn:mpeg:dash:schema:mpd:2011"><Period>' + '<S/>' * 200001 + '</Period></MPD>', 'limits'),
                            ('65 Perioden', '<MPD xmlns="urn:mpeg:dash:schema:mpd:2011">' + '<Period/>' * 65 + '</MPD>', 'limits'),
                            ('4097 Darstellungen', '<MPD xmlns="urn:mpeg:dash:schema:mpd:2011"><Period><AdaptationSet mimeType="video/mp4">' +
                             '<Representation bandwidth="1"/>' * 4097 + '</AdaptationSet></Period></MPD>', 'limits')]:
        s, ok = run(text)
        check('abgelehnt: %s → %s, ohne Angaben, Schema gültig' % (name, err), s['error'] == err and ok and not s['tracks'] and s['periods'] == 0
              and not s['protection']['signaled'] and s['type'] == 'unknown', {k: s[k] for k in ('error', 'periods', 'type')})
    s, ok = run('<MPD xmlns="urn:mpeg:dash:schema:mpd:2011"><Period><AdaptationSet mimeType="video/mp4">' + '<Representation bandwidth="1" codecs="avc1.4d401e"/>' * 100 + '</AdaptationSet></Period></MPD>')
    check('100 Darstellungen: alle gezählt, höchstens 64 gespeichert', ok and s['representations'] == 100 and len(s['tracks']) == 64, (s['representations'], len(s['tracks'])))

    # ---------- unabhängiges Schema-Gate (src/045): manipulierte Zusammenfassungen werden abgelehnt ----------
    base = results['timeline']
    def bad(mut):
        m = json.loads(json.dumps(base)); mut(m); return not pg.evaluate('(m) => window.__ok(m)', m)
    for name, mut in [('unbekanntes Feld', lambda m: m.__setitem__('url', 'https://x')),
                      ('unbekanntes Feld in einer Spur', lambda m: m['tracks'][0].__setitem__('id', 'v1')),
                      ('Format v2', lambda m: m.__setitem__('v', 2)), ('Format hls', lambda m: m.__setitem__('format', 'hls')),
                      ('unbekannter Codec', lambda m: m['tracks'][0].__setitem__('codecs', ['h264'])),
                      ('freie Sprache', lambda m: m['tracks'][3].__setitem__('lang', 'Deutsch (Original)')),
                      ('negative Breite', lambda m: m['tracks'][0].__setitem__('width', -1)),
                      ('mehr Spuren als Darstellungen', lambda m: m.__setitem__('representations', 2)),
                      ('Fehler mit Angaben', lambda m: m.__setitem__('error', 'parse')),
                      ('Systeme ohne angegebenen Schutz', lambda m: m['protection'].__setitem__('systems', ['widevine'])),
                      ('unbekannte Adressierung', lambda m: m.__setitem__('addressing', ['template-magic'])),
                      ('Schutz als Text statt Ja/Nein', lambda m: m['tracks'][0].__setitem__('protected', 'no')),
                      ('65 Spuren', lambda m: (m.__setitem__('representations', 65), m.__setitem__('tracks', [m['tracks'][0]] * 65)))]:
        check('Schema-Gate lehnt ab: ' + name, bad(mut))
    br.close()
shutdown()
done()
