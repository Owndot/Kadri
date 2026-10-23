# Schutzregeln für Anfragen im Hintergrund (beide Fassungen): Anmeldung nur an die Seite selbst, nichts im eigenen Netz
# (außer der Helfer-App), nur GET (POST nur an die Helfer-App), nur http(s).
import subprocess, os
from common import check, done, shutdown, HERE
for br in ('chrome', 'firefox'):
    out = subprocess.run(['node', os.path.join(HERE, 'guard_check.js'), os.path.join(HERE, '..', br, 'background.js')], capture_output=True, text=True, timeout=60)
    lines = [l for l in out.stdout.splitlines() if l.startswith(('OK', 'FAIL'))]
    for l in lines: check(br + ': ' + l[5:].split('  – ')[0], l.startswith('OK'), l.split('  – ')[1] if '  – ' in l else '')
    if not lines: check(br + ': Prüfung lief', False, out.stderr[-400:])
shutdown()
done()
