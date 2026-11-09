'use strict';
// P4b-8: die P4-Testerweiterung hat eine eigene, feste ID (aus dem öffentlichen Schlüssel abgeleitet), verschieden von
// der bestehenden Erweiterung und vom C3-Testpaar; nur öffentliche Daten; Produktion bleibt UNAPPROVED.
const assert = require('assert/strict');
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const id = JSON.parse(fs.readFileSync(path.join(__dirname, '../../tools/p4test/identity.json'), 'utf8'));
const der = Buffer.from(id.p4_manifest_key, 'base64');
assert.equal(der.toString('base64'), id.p4_manifest_key, 'canonical base64');
const pub = crypto.createPublicKey({key: der, format: 'der', type: 'spki'});
assert.equal(pub.asymmetricKeyType, 'rsa');
assert.ok(pub.asymmetricKeyDetails.modulusLength >= 3072, 'RSA >= 3072');
const derived = crypto.createHash('sha256').update(der).digest('hex').slice(0, 32).replace(/[0-9a-f]/g, c => 'abcdefghijklmnop'[parseInt(c, 16)]);
assert.equal(derived, id.p4_test_extension_id, 'ID derived from the public key');
const ids = [id.existing_extension_id, id.c3_test_extension_id, id.p4_test_extension_id];
assert.equal(new Set(ids).size, 3, 'three distinct extension identities');
assert.equal(id.helper_package, 'de.evp.helfer.p4test');
assert.equal(id.production_status, 'UNAPPROVED');
assert.ok(!/PRIVATE KEY/.test(JSON.stringify(id)), 'no private key material');
console.log('PASS: P4 test extension identity', derived, '(separate from existing and C3 test identities)');
