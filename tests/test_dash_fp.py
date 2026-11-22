# S3c DASH: Strukturfingerabdruck kadri-dash-fp/1 (src/039) mit dem echten DOMParser von Chromium – exakt wie der Helper
# (de.evp.helfer.dash.DashFingerprint): alle 24 Golden-Vektoren, der festgeschriebene kanonische Text und eine Querprüfung
# an 58 Grenzfall-MPDs × 2 Dokumentadressen (Werte und Ablehnungen vom Helper berechnet). Dazu die Korrekturen am
# Erkennungsindex (src/038): $Bandwidth%0Nd$, kollisionsfreie Marke statt fester Wortmarke, exakte Schreibweise der
# Stücknummer, Darstellungsnummer in Dokumentreihenfolge (wie beim Helper) – und die S3-Vorprüfung (nur fMP4/H.264 + AAC-LC).
# Kein Netzabruf, keine Erweiterung nötig.
import os, json, time
from common import *   # noqa: E402

ROOT = os.path.join(HERE, '..')
FIX = os.path.join(WEB, 'dash')
SRC = open(os.path.join(ROOT, 'src', '038-dash-manifest.js'), encoding='utf-8').read() + '\n' + open(os.path.join(ROOT, 'src', '039-dash-fingerprint.js'), encoding='utf-8').read()
def rd(p): return open(p, encoding='utf-8').read()
def fx(n): return rd(os.path.join(FIX, n))
NS = 'urn:mpeg:dash:schema:mpd:2011'
DOC = 'https://cdn.example/v/manifest.mpd'

with sync_playwright() as p:
    br = p.chromium.launch(executable_path=os.environ.get('KADRI_CHROMIUM') or None)
    pg = br.new_page()
    pg.set_content('<!doctype html><title>fp</title>')
    pg.add_script_tag(content=SRC + '\nwindow.__fp = (t, u, c) => { const pp = dashParse(t); if (pp.error) return { error: "kadri:" + pp.error }; return dashFingerprint(t, pp, u, c); };'
                      '\nwindow.__idx = (t, u, keys) => { const ix = dashSegmentIndex(dashParse(t), u); return { reps: ix.reps.map((r) => r.i), single: ix.single,'
                      ' m: keys.map((k) => dashMatchSegment(ix, dashUrlKey(k))) }; };')
    fp = lambda t, u=DOC, c=False: pg.evaluate('([t,u,c]) => window.__fp(t,u,c)', [t, u, c])
    idx = lambda t, keys, u=DOC: pg.evaluate('([t,u,k]) => window.__idx(t,u,k)', [t, u, keys])

    # ---------- Golden-Vektoren des Helpers ----------
    vec = [l.rstrip('\n').split('\t') for l in open(os.path.join(FIX, 'fp', 'fp-v1-vectors.tsv'), encoding='utf-8') if l.strip() and not l.startswith('#')]
    bad = []
    for f, u, want in vec:
        path = os.path.join(FIX, f[len('kadri/'):]) if f.startswith('kadri/') else os.path.join(FIX, 'fp', f[len('s3a/'):])
        r = fp(rd(path), u)
        if r.get('fp') != want: bad.append((f, u, r))
    check('alle %d Golden-Vektoren (12 MPDs × 2 Dokumentadressen) exakt reproduziert' % len(vec), len(vec) == 24 and not bad, bad)
    r = fp(fx('vod-segmentlist.mpd'), DOC, True)
    check('kanonischer Text von vod-segmentlist.mpd = Golden-Datei des Helpers (Format v1 festgeschrieben)', r.get('text') == rd(os.path.join(FIX, 'fp', 'fp-v1-golden-segmentlist.txt')), r.get('error'))

    # ---------- Querprüfung an Grenzfällen (Werte und Ablehnungen vom Helper) ----------
    rows = [l.rstrip('\n').split('\t') for l in open(os.path.join(FIX, 'fp', 'fp-v1-crosscheck.tsv'), encoding='utf-8') if l.strip() and not l.startswith('#')]
    diff, n_ok, n_err = [], 0, 0
    for u, f, want in rows:
        r = fp(rd(os.path.join(FIX, 'fp', 'x', f)), u)
        if want.startswith('ERROR:'):
            n_err += 1
            if r.get('fp'): diff.append((f, u, want, r.get('fp')))
        else:
            n_ok += 1
            if r.get('fp') != want: diff.append((f, u, want, r.get('fp') or r.get('error')))
    check('Querprüfung: %d Abdrücke identisch mit dem Helper, %d vom Helper abgelehnte MPDs auch hier ohne Abdruck' % (n_ok, n_err),
          len(rows) == 116 and n_ok == 74 and n_err == 42 and not diff, diff[:5])
    r = fp(fx('vod-timeline-avc-aac.mpd'))
    check('Ergebnis enthält nur Abdruck (64 Hex) und Vorprüfung – keine Adresse, keine Kennung', set(r.keys()) <= {'fp', 'gate', 'text'} and len(r['fp']) == 64
          and 'http' not in json.dumps(r) and 'cdn.example' not in json.dumps(r), r)
    big = '<?xml version="1.0"?><MPD xmlns="%s" type="static" mediaPresentationDuration="PT9999S"><Period><SegmentList timescale="1" duration="1">%s</SegmentList><AdaptationSet mimeType="video/mp4">%s</AdaptationSet></Period></MPD>' % (
        NS, ''.join('<SegmentURL media="s%d"/>' % i for i in range(20000)), ''.join('<Representation id="r%d" bandwidth="1"><BaseURL>b%d/</BaseURL></Representation>' % (i, i) for i in range(120)))
    t0 = time.time(); r = fp(big); dt = time.time() - t0
    check('geerbte Liste je Darstellung neu aufgelöst über der Grenze (20000 × 120): kein Abdruck (limits), ohne Hängen (%.1f s)' % dt, r.get('error') == 'limits' and dt < 20, r)

    # ---------- Erkennungsindex (src/038) ----------
    def tpl(media, rep='<Representation id="v1" bandwidth="64000"/>', extra=''):
        return ('<?xml version="1.0"?><MPD xmlns="%s" type="static" mediaPresentationDuration="PT40S"><Period><AdaptationSet mimeType="video/mp4">%s'
                '<SegmentTemplate timescale="1" duration="4" startNumber="1" initialization="init.mp4" media="%s"/>%s</AdaptationSet></Period></MPD>') % (NS, extra, media, rep)
    B = 'https://cdn.example/v/'
    r = idx(tpl('b$Bandwidth%08d$/s$Number$.m4s'), [B + 'b00064000/s3.m4s', B + 'b64000/s3.m4s'])
    check('$Bandwidth%08d$: Stück unter b00064000/ erkannt, b64000/ nicht (vorher wurde das Format ignoriert)', r['m'][0] == {'rep': 0, 'idx': 2} and r['m'][1] is None, r)
    r = idx(tpl('s$Number%05d$.m4s'), [B + 's00012.m4s', B + 's12.m4s', B + 's123456.m4s'])
    check('$Number%05d$: genau die erzeugte Schreibweise (s00012 ja, s12 nein, s123456 ja)', r['m'][0] == {'rep': 0, 'idx': 11} and r['m'][1] is None and r['m'][2] == {'rep': 0, 'idx': 123455}, r)
    r = idx(tpl('s$Number$.m4s'), [B + 's12.m4s', B + 's012.m4s'])
    check('$Number$ ohne Format: keine führenden Nullen (s12 ja, s012 nein)', r['m'][0] == {'rep': 0, 'idx': 11} and r['m'][1] is None, r)
    r = idx(tpl('$RepresentationID$/s$Number$.m4s', '<Representation id="KADRIIDXTOKEN9Q" bandwidth="1"/>'), [B + 'KADRIIDXTOKEN9Q/s2.m4s'])
    check('Darstellungs-ID gleich der früheren festen Marke (KADRIIDXTOKEN9Q): Stücke werden zugeordnet (Marke kollisionsfrei)', r['m'][0] == {'rep': 0, 'idx': 1}, r)
    r = idx(tpl('$RepresentationID$/x99999/s$Number$.m4s', '<Representation id="v9999" bandwidth="1"/>'), ['https://cdn.example/999999/v9999/x99999/s2.m4s'], u='https://cdn.example/999999/manifest.mpd')
    check('9er-Folgen in ID, Vorlage und Basis: Marke länger als jede Folge, Zuordnung eindeutig', r['m'][0] == {'rep': 0, 'idx': 1}, r)
    r = idx(tpl('s$Number$.m4s', '<Representation id="b" bandwidth="1"><SegmentTemplate media="x$SubNumber$.m4s"/></Representation><Representation id="t" bandwidth="1"/>'), [B + 's2.m4s'])
    check('Darstellungsnummer in Dokumentreihenfolge wie beim Helper (erste Darstellung ohne prüfbare Stückfolge → zweite hat Nummer 1)', r['reps'] == [1] and r['m'][0] == {'rep': 1, 'idx': 1}, r)
    r = idx(tpl('s$SubNumber$.m4s'), [B + 's2.m4s'])
    check('Vorlage, die der Helper ablehnt ($SubNumber$): keine Muster (nicht prüfbar statt geraten)', r['reps'] == [] and r['single'] == 1, r)
    r = idx(tpl('$RepresentationID$/s$Number$.m4s', '<Representation id="a/b" bandwidth="1"/>'), [B + 'a/b/s2.m4s'])
    check('Darstellungs-ID mit "/" in $RepresentationID$ (vom Helper abgelehnt): keine Muster', r['reps'] == [] and r['m'][0] is None, r)

    # ---------- S3-Vorprüfung ----------
    def mpd(sets, attrs='type="static" mediaPresentationDuration="PT20S"', periods=1, pextra=''):
        return '<?xml version="1.0"?><MPD xmlns="%s" %s>%s</MPD>' % (NS, attrs, ''.join('<Period%s>%s</Period>' % (pextra, sets) for _ in range(periods)))
    T = '<SegmentTemplate timescale="1000" duration="4000" initialization="$RepresentationID$/i.mp4" media="$RepresentationID$/$Number$.m4s"/>'
    VID = lambda c='avc1.4d401e', m='video/mp4', extra='': '<AdaptationSet mimeType="%s" codecs="%s" contentType="video">%s%s<Representation id="v" bandwidth="500000" width="640" height="360"/><Representation id="w" bandwidth="900000" width="1280" height="720"/></AdaptationSet>' % (m, c, extra, T)
    AUD = lambda c='mp4a.40.2', lang='de': '<AdaptationSet mimeType="audio/mp4" codecs="%s" contentType="audio" lang="%s">%s<Representation id="a" bandwidth="64000"/></AdaptationSet>' % (c, lang, T)
    def gate(t): r = fp(t); return r.get('gate') or {'error': r.get('error')}
    g = gate(mpd(VID() + AUD()))
    check('Vorprüfung: H.264 + AAC-LC, statisch, eine Periode → ok; Video/Ton mit Höhe, Breite, Bandbreite, Sprache (ohne Adressen)',
          g.get('ok') and [(x['index'], x['height'], x['width'], x['bandwidth']) for x in g['video']] == [(0, 360, 640, 500000), (1, 720, 1280, 900000)]
          and [(x['index'], x['lang'], x['bandwidth']) for x in g['audio']] == [(2, 'de', 64000)] and 'http' not in json.dumps(g), g)
    for what, t, want in [
        ('nur HE-AAC (mp4a.40.5)', mpd(VID() + AUD('mp4a.40.5')), 'dash-audio-codec'),
        ('nur HE-AACv2 (mp4a.40.29)', mpd(VID() + AUD('mp4a.40.29')), 'dash-audio-codec'),
        ('ohne Ton', mpd(VID()), 'dash-no-audio'),
        ('ContentProtection (auch nur angegeben)', mpd(VID(extra='<ContentProtection schemeIdUri="urn:mpeg:dash:mp4protection:2011" value="cenc"/>') + AUD()), 'dash-protected'),
        ('ContentProtection unter Period', mpd('<ContentProtection schemeIdUri="urn:x"/>' + VID() + AUD()), 'dash-protected'),
        ('Live (dynamic)', mpd(VID() + AUD(), attrs='type="dynamic"'), 'dash-live'),
        ('zwei Perioden', mpd(VID() + AUD(), periods=2, pextra=' duration="PT10S"'), 'dash-multiperiod'),
        ('VP9/WebM', mpd(VID('vp09.00.10.08', 'video/webm') + AUD()), 'dash-codec'),
        ('HEVC', mpd(VID('hvc1.1.6.L93.90') + AUD()), 'dash-codec'),
        ('Bild und Ton gemischt (muxed)', mpd(VID('avc1.4d401e,mp4a.40.2') + AUD()), 'dash-codec'),
        ('Dauer unbekannt', mpd(VID() + AUD(), attrs='type="static"'), 'dash-duration-unknown'),
        ('über 48 h', mpd(VID() + AUD(), attrs='type="static" mediaPresentationDuration="PT49H"'), 'dash-duration-limit'),
        ('SegmentBase (Byte-Bereiche)', mpd(VID().replace(T, '<SegmentBase indexRange="0-9"><Initialization range="0-9"/></SegmentBase>') + AUD()), 'dash-addressing'),
        ('EssentialProperty am Video-Set', mpd(VID(extra='<EssentialProperty schemeIdUri="urn:x"/>') + AUD()), 'dash-unsupported'),
    ]:
        g = gate(t)
        check('Vorprüfung lehnt ab: %s → %s' % (what, want), g.get('ok') is False and g.get('reason') == want, g)
    g = gate(mpd(VID() + AUD('mp4a.40.5', 'en') + AUD('mp4a.40.2', 'de')))
    check('Ton gemischt: nur die AAC-LC-Spur gilt (HE-AAC-Spur entfällt, nie stillschweigend ersetzt)', g.get('ok') and [x['lang'] for x in g['audio']] == ['de'], g)
    done()
    br.close()
