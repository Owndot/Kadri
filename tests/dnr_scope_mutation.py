# Mutationsprobe zu test_dnr_scope.py: Jede Abschwächung der Initiator-Einschränkung muss der Test bemerken.
# Je Mutant eine Kopie von dist/test mit geändertem background.js; der Test läuft dagegen (KADRI_EXT) und MUSS die
# genannte Prüfung verfehlen. Vorher: node tools/build.js --test
import os, re, shutil, subprocess, sys, tempfile
HERE = os.path.dirname(os.path.abspath(__file__))
DIST = os.path.join(HERE, '..', 'dist', 'test')
MUTANTS = [
    # Name, Ersetzungen (alt → neu, je genau einmal), Prüfung, die scheitern muss
    ('alter Stand: nur „kein Tab“ (wie main)', [("const OWN = () => ({ tabIds: [-1], initiatorDomains: [api.runtime.id] });", "const OWN = () => ({ tabIds: [-1] });")], 'F1 fremder SW'),
    ('Regel 80 ohne Initiator', [("  const cond = OWN(), ex", "  const cond = { tabIds: [-1] }, ex")], 'F1 fremder SW'),
    ('Regeln 51–58 ohne Initiator', [("condition: Object.assign({ regexFilter: UI + re }, OWN())", "condition: { regexFilter: UI + re, tabIds: [-1] }")], 'F2 fremder SW'),
    ('Regel 70 ohne Initiator', [("condition: Object.assign({ requestDomains: ['localhost', 'local', 'internal', 'lan'] }, OWN())", "condition: { requestDomains: ['localhost', 'local', 'internal', 'lan'], tabIds: [-1] }")], 'F3 fremder SW'),
    ('Referer-Regel ohne Initiator', [("condition: Object.assign({ regexFilter: '^' + esc(url) + '$' }, OWN())", "condition: { regexFilter: '^' + esc(url) + '$', tabIds: [-1] }")], 'F5 … der gleichzeitige'),
    ('falscher Initiator (Kadris eigene Anfragen ungeschützt)', [("initiatorDomains: [api.runtime.id] })", "initiatorDomains: ['aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa'] })")], 'O1 Kadri'),
    ('Tab-Bedingung entfernt (Regeln träfen auch Tabs)', [("const OWN = () => ({ tabIds: [-1], initiatorDomains: [api.runtime.id] });", "const OWN = () => ({ initiatorDomains: [api.runtime.id] });")], 'O3 Regeln'),
]
env = dict(os.environ)
bad = 0
for name, subs, must_fail in MUTANTS:
    tmp = tempfile.mkdtemp(prefix='kadri-dnr-mut-')
    ext = os.path.join(tmp, 'ext'); shutil.copytree(DIST, ext)
    f = os.path.join(ext, 'background.js'); s = open(f, encoding='utf-8').read()
    for old, new in subs:
        if s.count(old) != 1: print('MUTANT-FEHLER %s: Stelle nicht genau einmal gefunden: %s' % (name, old)); sys.exit(2)
        s = s.replace(old, new)
    open(f, 'w', encoding='utf-8').write(s)
    env['KADRI_EXT'] = ext
    cmd = ['python3', '-u', os.path.join(HERE, 'test_dnr_scope.py')]
    if not env.get('DISPLAY') and shutil.which('xvfb-run'): cmd = ['xvfb-run', '-a'] + cmd
    out = subprocess.run(cmd, cwd=HERE, env=env, capture_output=True, text=True, timeout=300).stdout
    failed = [l for l in out.splitlines() if l.startswith('FAIL') and must_fail in l]
    ok = bool(failed)
    print(('killed   ' if ok else 'SURVIVED ') + name + ('' if ok else '  – ' + out[-600:]))
    bad += not ok
    shutil.rmtree(tmp, ignore_errors=True)
print('DNR SCOPE MUTATION RESULT %s %d mutants' % ('PASS' if not bad else 'FAIL', len(MUTANTS)))
sys.exit(1 if bad else 0)
