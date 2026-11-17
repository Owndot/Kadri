#!/usr/bin/env python3
"""P4c-Vorbereitung: entpackbares Testpaket "Kadri P4 TEST" aus einer fertigen Chrome-Fassung (dist/chrome).

Gegenüber der Vorlage unterscheiden sich NUR name, description und der feste öffentliche Schlüssel (key) aus
tools/p4test/identity.json – dadurch eine eigene, stabile Erweiterungs-ID, getrennt von der bestehenden Erweiterung und
vom C3-Testpaar. Deterministisch (feste Zeitstempel/Rechte, sortiert). Kein privater Schlüssel, keine Veröffentlichung.
Aufruf: pack-extension.py DIST_CHROME OUT.zip
"""
import base64
import hashlib
import json
import sys
import zipfile
from pathlib import Path

HERE = Path(__file__).resolve().parent
root, output = Path(sys.argv[1]), Path(sys.argv[2])
ident = json.loads((HERE / 'identity.json').read_text(encoding='utf-8'))
public = base64.b64decode(ident['p4_manifest_key'], validate=True)
ext_id = hashlib.sha256(public).hexdigest()[:32].translate(str.maketrans('0123456789abcdef', 'abcdefghijklmnop'))
assert ext_id == ident['p4_test_extension_id'], 'ID does not match the public key'
assert len({ext_id, ident['existing_extension_id'], ident['c3_test_extension_id']}) == 3, 'identities must differ'
assert ident['production_status'] == 'UNAPPROVED'
base = json.loads((root / 'manifest.json').read_text(encoding='utf-8'))
assert not any(k in base for k in ['key', 'update_url', 'externally_connectable']), 'template already carries an identity'
assert base['permissions'] == ['storage', 'declarativeNetRequestWithHostAccess', 'scripting'], base['permissions']
assert base['content_security_policy']['extension_pages'] == "script-src 'self' 'wasm-unsafe-eval'; object-src 'self';"
manifest = dict(base, name=ident['p4_name'],
                description='Isolierte P4-Testerweiterung (HLS-Downloads über die Test-App de.evp.helfer.p4test). UNAPPROVED.',
                key=ident['p4_manifest_key'])
assert {k for k in set(base) | set(manifest) if base.get(k) != manifest.get(k)} == {'name', 'description', 'key'}
entries = sorted(p for p in root.rglob('*') if p.is_file())
assert entries and all(not p.is_symlink() for p in entries)
with zipfile.ZipFile(output, 'w', compression=zipfile.ZIP_DEFLATED, compresslevel=9) as z:
    for p in entries:
        name = p.relative_to(root).as_posix()
        content = (json.dumps(manifest, indent=2, ensure_ascii=False) + '\n').encode() if name == 'manifest.json' else p.read_bytes()
        info = zipfile.ZipInfo(name, date_time=(1980, 1, 1, 0, 0, 0))
        info.external_attr = 0o644 << 16
        info.compress_type = zipfile.ZIP_DEFLATED
        z.writestr(info, content)
with zipfile.ZipFile(output) as z:
    assert z.namelist() == [p.relative_to(root).as_posix() for p in entries]
    for p in entries:
        name = p.relative_to(root).as_posix()
        if name != 'manifest.json':
            assert z.read(name) == p.read_bytes(), name
print('PASS: only name, description and the fixed public key differ; P4 test extension ID', ext_id)
