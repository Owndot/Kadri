#!/usr/bin/env python3
"""P4c-Vorbereitung: die öffentliche Gerätetestseite tests/web/public/p4-hls.html ist vollständig und unverändert.
Jeder Fall der Seite existiert, jede Playlist verweist nur auf vorhandene Dateien im eigenen Ordner, alle Dateien stehen
mit korrektem SHA-256 in SHA256SUMS, und es gibt keine Datei, die nicht zu einem Fall gehört."""
import hashlib
import os
import re
import sys

ROOT = os.path.join(os.path.dirname(os.path.abspath(__file__)), 'web', 'public')
P4 = os.path.join(ROOT, 'p4')
page = open(os.path.join(ROOT, 'p4-hls.html'), encoding='utf-8').read()
cases = re.findall(r"'(p4/[a-z0-9_]+/[a-z0-9_]+\.m3u8)'", page)
assert len(cases) == 9, cases
used = set()

def walk(rel):
    path = os.path.join(ROOT, rel)
    assert os.path.isfile(path), rel
    used.add(os.path.relpath(path, P4))
    text = open(path, encoding='utf-8').read()
    assert text.startswith('#EXTM3U'), rel
    base = os.path.dirname(rel)
    refs = [l.strip() for l in text.splitlines() if l.strip() and not l.startswith('#')]
    refs += re.findall(r'URI="([^"]+)"', text)
    for r in refs:
        assert '/' not in r and '..' not in r and ':' not in r, (rel, r)   # nur Dateien im eigenen Ordner
        target = os.path.join(base, r)
        if r.endswith('.m3u8'):
            walk(target)
        else:
            assert os.path.isfile(os.path.join(ROOT, target)), target
            used.add(os.path.relpath(os.path.join(ROOT, target), P4))
    return text

for c in cases:
    walk(c)
assert '#EXT-X-KEY:METHOD=AES-128' in open(os.path.join(P4, 'aes', 'master.m3u8')).read()
assert '#EXT-X-ENDLIST' not in open(os.path.join(P4, 'live', 'index.m3u8')).read()
sums = {}
for line in open(os.path.join(P4, 'SHA256SUMS'), encoding='utf-8'):
    digest, name = line.rstrip('\n').split('  ', 1)
    sums[name] = digest
files = set()
for d, _, fs in os.walk(P4):
    for f in fs:
        rel = os.path.relpath(os.path.join(d, f), P4)
        if rel != 'SHA256SUMS':
            files.add(rel)
assert files == set(sums), ('files vs SHA256SUMS', sorted(files ^ set(sums))[:10])
for rel, digest in sums.items():
    assert hashlib.sha256(open(os.path.join(P4, rel), 'rb').read()).hexdigest() == digest, rel
assert files == used, ('unreferenced files', sorted(files - used)[:10])
print('PASS: P4 device test page – %d cases, %d files, all referenced and hashed' % (len(cases), len(files)))
