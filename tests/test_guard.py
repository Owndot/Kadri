# Schutzregeln für Anfragen im Hintergrund (beide Fassungen): Anmeldung nur an die Seite selbst, nichts im eigenen Netz
# (außer der Helfer-App), nur GET (POST nur an die Helfer-App), nur http(s).
import subprocess, os
from common import check, done, shutdown, HERE
for br in ('chrome', 'firefox'):
    out = subprocess.run(['node', os.path.join(HERE, 'guard_check.js'), os.path.join(HERE, '..', br, 'background.js')], capture_output=True, text=True, timeout=60)
    lines = [l for l in out.stdout.splitlines() if l.startswith(('OK', 'FAIL'))]
    for l in lines: check(br + ': ' + l[5:].split('  – ')[0], l.startswith('OK'), l.split('  – ')[1] if '  – ' in l else '')
    if not lines: check(br + ': Prüfung lief', False, out.stderr[-400:])
# Firefox: jede Anfrage von Kadri selbst wird vor dem Absenden geprüft (auch nach Weiterleitungen, auch per DNS)
out = subprocess.run(['node', os.path.join(HERE, 'ff_net_check.js'), os.path.join(HERE, '..', 'firefox', 'background.js')], capture_output=True, text=True, timeout=60)
lines = [l for l in out.stdout.splitlines() if l.startswith(('OK', 'FAIL'))]
for l in lines: check('firefox Netz: ' + l[5:], l.startswith('OK'))
if len(lines) < 6: check('firefox Netz: Prüfung lief', False, out.stdout[-300:] + out.stderr[-300:])
# Lifecycle and concurrent request isolation against the actual Chrome background.
out = subprocess.run(['node', os.path.join(HERE, 'header_context_check.js')], capture_output=True, text=True, timeout=60)
lines = [l for l in out.stdout.splitlines() if l.startswith('OK')]
check('Chrome header contexts: process succeeded', out.returncode == 0, out.stderr[-500:])
check('Chrome header contexts: all scenarios executed', len(lines) == 14, lines)
shutdown()
done()
