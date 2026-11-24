# S4b-7a – Audit „unbekanntes EssentialProperty“ (Vorschlag, KEINE Verhaltensänderung): zeigt für die Fixtures aus
# tests/s4b7/essential das IST-Verhalten von Kadri (echte Quelltexte src/038/039/046 im DOMParser von Chromium) und – mit
# HELPER_DIR=<Helfer-Checkout> – des Helfers (echter DashManifest/DashProfile/DashPlan per javac). Hart geprüft wird nur, dass
# beide Seiten gleich entscheiden und das IST der Tabelle entspricht; die Spalte „vorschlag“ wird nur gegenübergestellt.
#   python3 tests/s4b7_essential_audit.py [OUTDIR]
import os, sys, json, subprocess, tempfile
from common import *   # noqa: F401,F403
ROOT = os.path.join(HERE, '..')
E = os.path.join(HERE, 's4b7', 'essential')
FIX = tempfile.mkdtemp()
subprocess.run([sys.executable, os.path.join(E, 'erzeuge.py'), FIX], check=True, stdout=subprocess.DEVNULL)
rd = lambda *p: open(os.path.join(ROOT, *p), encoding='utf-8').read()
SRC = rd('src', '038-dash-manifest.js') + '\n' + rd('src', '039-dash-fingerprint.js') + '\n' + rd('src', '046-dash-ebenen.js')
DOC = 'https://media.example/s4b5/manifest.mpd'
rows = [l.rstrip('\n').split('\t') for l in open(os.path.join(E, 'vorschlag.tsv'), encoding='utf-8') if l.strip() and not l.startswith('#')]
rows = [dict(zip(rows[0], r)) for r in rows[1:]]
JS = '''([t, u]) => { const pp = dashParse(t); if (pp.error) return 'mpd_' + pp.error.replace(/-/g, '_');
  const g = dashGateFor(t, pp, u, null); return (g.code || (g.ok ? 'ok' : g.reason)).replace(/-/g, '_'); }'''
kadri = {}
with sync_playwright() as p:
    br = p.chromium.launch(executable_path=os.environ.get('KADRI_CHROMIUM') or None)
    pg = br.new_page(); pg.set_content('<!doctype html><title>ess</title>'); pg.add_script_tag(content=SRC)
    for r in rows: kadri[r['datei']] = pg.evaluate(JS, [open(os.path.join(FIX, r['datei']), encoding='utf-8').read(), DOC])
    br.close()
helper = {}
H = os.environ.get('HELPER_DIR')
if H:
    w = tempfile.mkdtemp(); hs = os.path.join(H, 'app', 'src', 'main', 'java', 'de', 'evp', 'helfer')
    srcs = [os.path.join(hs, 'hls', 'HlsUri.java'), os.path.join(hs, 'hls', 'HlsException.java')] + \
           [os.path.join(hs, 'dash', f) for f in sorted(os.listdir(os.path.join(hs, 'dash'))) if f.endswith('.java')] + [os.path.join(E, 'EssentialAudit.java')]
    subprocess.run(['javac', '-d', w] + srcs, check=True)
    out = subprocess.run(['java', '-Xmx64m', '-cp', w, 'de.evp.helfer.dash.EssentialAudit', DOC] + [os.path.join(FIX, r['datei']) for r in rows],
                         check=True, capture_output=True, text=True).stdout
    helper = dict(l.split('\t') for l in out.strip().split('\n'))
tab = []
for r in rows:
    d, k, h = r['datei'], kadri[r['datei']], helper.get(r['datei'], '-')
    check('%s: Kadri IST = %s' % (d, r['ist']), k == r['ist'], k)
    if H: check('%s: Helfer IST = %s (gleich wie Kadri)' % (d, r['ist']), h == r['ist'] and h == k, h)
    tab.append({'datei': d, 'kadri': k, 'helfer': h, 'vorschlag': r['vorschlag'], 'abweichung': k != r['vorschlag'], 'begruendung': r['begruendung']})
gaps = [t['datei'] for t in tab if t['abweichung']]
print('Befund: %d von %d Fixtures weichen vom Vorschlag ab: %s' % (len(gaps), len(tab), ', '.join(gaps)))
if len(sys.argv) > 1:
    with open(os.path.join(sys.argv[1], 's4b7-essential-audit.json'), 'w', encoding='utf-8') as f: json.dump(tab, f, ensure_ascii=False, indent=1)
done()
