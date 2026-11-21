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
                      '\nwindow.__ok = (m) => mediaManifestOk(m);')
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
