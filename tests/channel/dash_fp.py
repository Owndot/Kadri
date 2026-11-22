# S3c, nur Tests: Kadris Fingerabdruck kadri-dash-fp/1 (src/038 + src/039) mit dem echten DOMParser von Chromium.
#   python3 tests/channel/dash_fp.py MPD_DATEI URL [URL …]   → je Zeile: URL<TAB>fp (oder ERROR:<grund>)
import os, sys
from playwright.sync_api import sync_playwright
ROOT = os.path.join(os.path.dirname(os.path.abspath(__file__)), '..', '..')
SRC = ''.join(open(os.path.join(ROOT, 'src', f), encoding='utf-8').read() + '\n' for f in ('038-dash-manifest.js', '039-dash-fingerprint.js'))
text = open(sys.argv[1], encoding='utf-8').read()
with sync_playwright() as p:
    br = p.chromium.launch(executable_path=os.environ.get('KADRI_CHROMIUM') or None)
    pg = br.new_page(); pg.set_content('<title>fp</title>')
    pg.add_script_tag(content=SRC)
    for u in sys.argv[2:]:
        r = pg.evaluate('([t,u]) => { const p = dashParse(t); return p.error ? { error: p.error } : dashFingerprint(t, p, u); }', [text, u])
        print(u + '\t' + (r.get('fp') or 'ERROR:' + str(r.get('error'))), flush=True)
    br.close()
