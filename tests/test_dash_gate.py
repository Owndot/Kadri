# S4b-5: Vorprüfung im Gleichlauf mit dem Helfer – gemeinsame Golden-Vektoren dash-gate/1 (tests/web/dash/gate, im Helfer
# byte-gleich unter tests/java/dash/fixtures/gate und dort gegen den echten dashplan geprüft). Mit den ECHTEN Quelltexten
# (src/038, 039, 046) und dem DOMParser von Chromium; ohne Erweiterung, ohne Netz. Je Vektor hart: Ergebnis, Grund wie
# dashplan, blockierende Spur und ihre Gründe, Stücke/Abdeckung je Darstellung, Adressierung, Kadris Anzeigegrund. Dazu
# e3 (n01) bis zur Meldung: konkreter Abdeckungsfehler „Tonspur 24 s statt 20 s“, kein Angebot; d5 (n19): einheitlicher Grund.
import os, hashlib
from common import *   # noqa: E402

ROOT = os.path.join(HERE, '..')
G = os.path.join(WEB, 'dash', 'gate')
def rd(*p): return open(os.path.join(ROOT, *p), encoding='utf-8').read()
SRC = rd('src', '038-dash-manifest.js') + '\n' + rd('src', '039-dash-fingerprint.js') + '\n' + rd('src', '046-dash-ebenen.js')
DOC = 'https://media.example/s4b5/manifest.mpd'
rows = [l.rstrip('\n').split('\t') for l in open(os.path.join(G, 'gate-v1-vectors.tsv'), encoding='utf-8') if l.strip() and not l.startswith('#')]
head, rows = rows[0], [dict(zip(rows[0], r)) for r in rows[1:]]
check('dash-gate/1: %d Vektoren, jede Fixture genau einmal' % len(rows), len(rows) == 41 and len({r['datei'] for r in rows}) == 41
      and sorted(r['datei'] for r in rows) == sorted(f for f in os.listdir(G) if f.endswith('.mpd')), len(rows))
bad = [r['datei'] for r in rows if hashlib.sha256(open(os.path.join(G, r['datei']), 'rb').read()).hexdigest() != r['sha256']]
check('dash-gate/1: Fixtures unverändert (SHA-256 wie in der Vektortabelle)', not bad, bad)

JS = '''([t, u]) => {
  const pp = dashParse(t);
  if (pp.error) return { code: 'mpd_' + pp.error.replace(/-/g, '_'), anzeige: 'unchecked', reps: null };
  const f = dashFingerprint(t, pp, u);
  if (f.error) return { code: 'mpd_' + f.error.replace(/-/g, '_'), anzeige: f.error === 'baseurl-multiple' ? 'baseurl-multiple' : 'unchecked', reps: null, fpError: f.error };
  const g = f.gate;
  const code = g.code !== undefined ? g.code : (g.ok ? 'ok' : g.reason);   // (alter Stand ohne code: nur der Anzeigegrund)
  return { code: code.replace(/-/g, '_'), ok: g.ok, track: g.track || '', detail: g.detail || [], reps: g.reps || null, anzeige: g.reason || '-',
    coverage: g.coverage || null, video: (g.video || []).map((x) => x.index), audio: (g.audio || []).map((x) => x.index) };
}'''
def abdeckung(reps):
    vals = ['%s=%s' % (r['id'], ('!' + r['excluded']) if r.get('excluded') else '%d/%s' % (r['count'], r['covered'])) for r in reps]
    return vals
with sync_playwright() as p:
    br = p.chromium.launch(executable_path=os.environ.get('KADRI_CHROMIUM') or None)
    pg = br.new_page()
    pg.set_content('<!doctype html><title>gate</title>')
    pg.add_script_tag(content=SRC + '\nwindow.__lv = (gate) => dashLevels({ read: true, bound: true, gate: gate, fmt: { video: [], audio: [], container: [] }, caps: { known: false } });'
                      '\nwindow.__lvfp = (code, bound) => dashLevels({ read: true, bound: bound, bindReason: "keine-treffer", cls: { host: 8 }, fpError: true, fpCode: code, gate: null, fmt: { video: [], audio: [], container: [] }, caps: { known: false } });')
    diff = []
    for r in rows:
        text = open(os.path.join(G, r['datei']), encoding='utf-8').read()
        g = pg.evaluate(JS, [text, DOC])
        got = {'erwartung': 'angeboten' if g['code'] == 'ok' else 'abgelehnt', 'code': g['code']}
        if r['spur'] != '-' or g.get('track'): got['spur'] = g.get('track') or '-'
        if r['detail'] != '-' or g.get('detail'): got['detail'] = ','.join(g.get('detail') or []) or '-'
        if r['abdeckung'] != '-':
            vals = abdeckung(g['reps'] or [])
            got['abdeckung'] = ('*=' + vals[0].split('=')[1]) if r['abdeckung'].startswith('*=') and len({v.split('=')[1] for v in vals}) == 1 else ','.join(vals)
        if r['adressierung'] != '-':
            vr = [x for x in (g['reps'] or []) if x['kind'] == 'video']
            got['adressierung'] = vr[0]['addressing'] if vr else '?'
        got['anzeige'] = g['anzeige'] if g['code'] != 'ok' else '-'
        want = {k: r[k] for k in got}
        ok = got == want
        check('%s → %s%s' % (r['datei'][:-4], r['code'], '' if r['detail'] == '-' else ' (' + r['spur'] + ': ' + r['detail'] + ')'), ok, {k: (want[k], got[k]) for k in got if got[k] != want[k]})
        if not ok: diff.append(r['datei'])
        if r['datei'].startswith('n01'):
            n01 = g
    # ---------- e3 (n01) bis zur Meldung, ohne Angebot ----------
    check('e3/n01: Abdeckungsfehler mit Zahlen aus dem MPD: Tonspur beschreibt 24 s, Periode 20 s',
          n01.get('coverage') == {'track': 'audio', 'described': '24', 'period': '20'}, n01.get('coverage'))
    gate = pg.evaluate('([t, u]) => dashFingerprint(t, dashParse(t), u).gate', [open(os.path.join(G, 'n01-list-audio-24s.mpd'), encoding='utf-8').read(), DOC])
    lv = pg.evaluate('(g) => window.__lv(g)', gate)
    check('e3/n01: Ebenen E3/coverage – „DASH-Stream zugeordnet – nicht speicherbar“ · „Manifest widersprüchlich: Tonspur 24 s statt 20 s“',
          lv['code'] == 'E3/coverage' and lv['main'] == 'DASH-Stream zugeordnet – nicht speicherbar' and lv['sub'] == 'Manifest widersprüchlich: Tonspur 24 s statt 20 s', [lv['code'], lv['main'], lv['sub']])
    check('e3/n01: kein Angebot (gate.ok false, keine Video-/Tonoption für den Plan)', gate['ok'] is False and gate['code'] == 'dash-addressing', gate.get('code'))
    # ---------- d5 (n19): einheitlicher Grund, gebunden oder nicht ----------
    a = pg.evaluate('() => window.__lvfp("baseurl-multiple", true)'); b = pg.evaluate('() => window.__lvfp("baseurl-multiple", false)')
    check('d5/n19: zugeordnet → E3/baseurl-multiple „mehrere Server-Alternativen (BaseURL) – noch nicht unterstützt“',
          a['code'] == 'E3/baseurl-multiple' and 'mehrere Server-Alternativen (BaseURL)' in a['sub'], [a['code'], a['sub']])
    check('d5/n19: nicht zugeordnet (Stücke der zweiten BaseURL) → E2/baseurl-multiple, derselbe Grund statt „anderer Server“',
          b['code'] == 'E2/baseurl-multiple' and 'mehrere Server-Alternativen (BaseURL)' in b['sub'], [b['code'], b['sub']])
    c = pg.evaluate('() => window.__lvfp("addressing-ambiguous", true)')
    check('anderer Lesefehler (n17) bleibt E3/unchecked', c['code'] == 'E3/unchecked', c['code'])
    # ---------- bisher unterstützte Profile bleiben angeboten (Kadri-Fixtures aus S3c) ----------
    for f, want in [('vod-timeline-avc-aac.mpd', 'ok'), ('vod-number-ffmpeg.mpd', 'ok'), ('vod-segmentlist.mpd', 'audio_codec')]:
        g = pg.evaluate(JS, [open(os.path.join(WEB, 'dash', f), encoding='utf-8').read(), DOC])
        check('S3c-Fixture %s: %s' % (f, 'weiterhin angeboten' if want == 'ok' else 'wie bisher nicht angeboten (nur HE-AAC) – Grund jetzt wie dashplan: ' + want), g['code'] == want, g)
    s3d = pg.evaluate(JS, [open(os.path.join(WEB, 'public', 's3d-dash', 'manifest.mpd'), encoding='utf-8').read(), 'https://media.example/s3d-dash/manifest.mpd'])
    check('S3d-Testseite (Matrix-Grundlage): angeboten, 2 Video × AAC-LC, Ton 20,053 s statt 20 s innerhalb der Toleranz',
          s3d['code'] == 'ok' and len(s3d['video']) == 2 and len(s3d['audio']) == 1, s3d)
    br.close()
done()
