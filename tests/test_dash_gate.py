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
check('dash-gate/1: %d Vektoren über %d Fixtures, jede Fixture mindestens einmal' % (len(rows), len({r['datei'] for r in rows})), len(rows) == 69
      and {r['datei'] for r in rows} == {f for f in os.listdir(G) if f.endswith('.mpd')} and len({r['datei'] for r in rows}) == 56, len(rows))
bad = [r['datei'] for r in rows if hashlib.sha256(open(os.path.join(G, r['datei']), 'rb').read()).hexdigest() != r['sha256']]
check('dash-gate/1: Fixtures unverändert (SHA-256 wie in der Vektortabelle)', not bad, bad)

JS = '''([t, u, alt]) => {
  const pp = dashParse(t);
  if (pp.error) return { code: 'mpd_' + pp.error.replace(/-/g, '_'), anzeige: 'unchecked', reps: null };
  // S4b-6: Vorprüfung wie dashplan – ohne Auswahl wie v1 (mehrere BaseURL fatal), mit Auswahl wie v2 (Projektion)
  const g = typeof dashGateFor === 'function' ? dashGateFor(t, pp, u, alt) : (() => { const f = dashFingerprint(t, pp, u); return f.error ? { ok: false, code: 'mpd-' + f.error, reason: f.error === 'baseurl-multiple' ? 'baseurl-multiple' : 'unchecked' } : f.gate; })();
  const code = g.code !== undefined ? g.code : (g.ok ? 'ok' : g.reason);   // (alter Stand ohne code: nur der Anzeigegrund)
  return { code: code.replace(/-/g, '_'), ok: g.ok, track: g.track || '', detail: g.detail || [], reps: g.reps || null, anzeige: g.reason || '-',
    coverage: g.coverage || null, video: (g.video || []).map((x) => x.index), audio: (g.audio || []).map((x) => x.index) };
}'''
# (Abdruck; schlägt das Lesen beim Helfer fehl, muss Kadri denselben Grund liefern – als Lesefehler ODER als Vorprüfung mpd-<grund>,
#  z. B. n21: die Auswertungsgrenze prüft Kadri in der Vorprüfung, der Helfer beim Lesen; angeboten wird in beiden Fällen nicht)
FPJS = '''([t, u]) => { const pp = dashParse(t); if (pp.error) return 'ERROR:' + pp.error; const f = dashFingerprint(t, pp, u);
  if (f.error) return 'ERROR:' + f.error; const g = f.gate; return g && /^mpd-/.test(g.code || '') ? 'ERROR:' + g.code.slice(4) : f.fp; }'''
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
        g = pg.evaluate(JS, [text, DOC, None if r['auswahl'] == '-' else r['auswahl']])
        got = {'erwartung': 'angeboten' if g['code'] == 'ok' else 'abgelehnt', 'code': g['code']}
        if r['spur'] != '-' or g.get('track'): got['spur'] = g.get('track') or '-'
        if r['detail'] != '-' or g.get('detail'): got['detail'] = ','.join(g.get('detail') or []) or '-'
        if r['abdeckung'] != '-':
            vals = abdeckung(g['reps'] or [])
            got['abdeckung'] = ('*=' + vals[0].split('=')[1]) if r['abdeckung'].startswith('*=') and len({v.split('=')[1] for v in vals}) == 1 else ','.join(vals)
        if r['basen'] != '-':
            got['basen'] = ','.join('%s=%s' % (x['id'], x.get('alts', 1)) for x in (g['reps'] or []))
        if r['adressierung'] != '-':
            vr = [x for x in (g['reps'] or []) if x['kind'] == 'video']
            got['adressierung'] = vr[0]['addressing'] if vr else '?'
        got['anzeige'] = g['anzeige'] if g['code'] != 'ok' else '-'
        want = {k: r[k] for k in got}
        ok = got == want
        check('%s%s → %s%s' % (r['datei'][:-4], '' if r['auswahl'] == '-' else ' [' + r['auswahl'] + ']', r['code'], '' if r['detail'] == '-' else ' (' + r['spur'] + ': ' + r['detail'] + ')'), ok, {k: (want[k], got[k]) for k in got if got[k] != want[k]})
        if not ok: diff.append(r['datei'])
        if r['datei'].startswith('n01') and r['auswahl'] == '-':
            n01 = g
    # ---------- S4b-6: Strukturfingerabdruck über alle Alternativen = Helfer (gate-v1-fp.tsv, vom Helfer berechnet) ----------
    fpw = {l.split('\t')[0]: l.rstrip('\n').split('\t')[1] for l in open(os.path.join(G, 'gate-v1-fp.tsv'), encoding='utf-8') if l.strip() and not l.startswith('#')}
    fpd = [f for f in sorted(fpw) if pg.evaluate(FPJS, [open(os.path.join(G, f), encoding='utf-8').read(), DOC]) != fpw[f]]
    check('Fingerabdruck aller %d Fixtures (mit allen BaseURL-Alternativen) identisch mit dem Helfer' % len(fpw), len(fpw) == 56 and not fpd, fpd)
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
        g = pg.evaluate(JS, [open(os.path.join(WEB, 'dash', f), encoding='utf-8').read(), DOC, None])
        check('S3c-Fixture %s: %s' % (f, 'weiterhin angeboten' if want == 'ok' else 'wie bisher nicht angeboten (nur HE-AAC) – Grund jetzt wie dashplan: ' + want), g['code'] == want, g)
    s3d = pg.evaluate(JS, [open(os.path.join(WEB, 'public', 's3d-dash', 'manifest.mpd'), encoding='utf-8').read(), 'https://media.example/s3d-dash/manifest.mpd', None])
    check('S3d-Testseite (Matrix-Grundlage): angeboten, 2 Video × AAC-LC, Ton 20,053 s statt 20 s innerhalb der Toleranz',
          s3d['code'] == 'ok' and len(s3d['video']) == 2 and len(s3d['audio']) == 1, s3d)
    br.close()
done()
