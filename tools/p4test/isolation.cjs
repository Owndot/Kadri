'use strict';
// P4c-Vorbereitung (CI, Wegwerf-Chromium): das P4-Testpaket hat die erwartete feste ID, getrennte Erweiterungsdaten
// gegenüber einer zweiten Kadri-Fassung im selben Profil und dieselbe ID nach Verschieben in ein frisches Profil.
// Aufruf: node isolation.cjs PACKED_DIR CONTROL_DIR
const {chromium} = require('playwright');
const fs = require('fs'), path = require('path'), os = require('os'), assert = require('assert/strict');
const ident = JSON.parse(fs.readFileSync(path.join(__dirname, 'identity.json'), 'utf8'));
const [pack, control] = process.argv.slice(2);
const expected = ident.p4_test_extension_id;
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'p4-identity-'));
function launch(paths, profile) {
  return chromium.launchPersistentContext(profile, {headless: false, args: [`--disable-extensions-except=${paths.join(',')}`, `--load-extension=${paths.join(',')}`]});
}
async function workers(ctx, n) {
  for (let i = 0; i < 150; i++) {
    const w = ctx.serviceWorkers();
    if (w.length === n) return w;
    await new Promise(r => setTimeout(r, 100));
  }
  throw Error('extension workers missing');
}
(async () => {
  assert.notEqual(expected, ident.c3_test_extension_id);
  assert.notEqual(expected, ident.existing_extension_id);
  let ctx = await launch([pack, control], path.join(tmp, 'profile1'));
  try {
    const ws = await workers(ctx, 2);
    const test = ws.find(w => new URL(w.url()).host === expected);
    const other = ws.find(w => new URL(w.url()).host !== expected);
    assert.ok(test && other, 'P4 test extension and a second Kadri build with distinct IDs');
    assert.equal(await test.evaluate(() => chrome.runtime.id), expected);
    assert.notEqual(new URL(other.url()).host, ident.c3_test_extension_id);
    await test.evaluate(() => chrome.storage.local.set({'p4-isolation-probe': 'p4'}));
    assert.deepEqual(await other.evaluate(() => chrome.storage.local.get('p4-isolation-probe')), {});
    await other.evaluate(() => chrome.storage.local.set({'p4-isolation-probe': 'other'}));
    assert.equal((await test.evaluate(() => chrome.storage.local.get('p4-isolation-probe')))['p4-isolation-probe'], 'p4');
    const m = await test.evaluate(() => chrome.runtime.getManifest());
    assert.equal(m.name, ident.p4_name);
    console.log('PASS: P4 test extension', expected, 'with separate storage.local next to another Kadri build');
  } finally { await ctx.close(); }
  const relocated = path.join(tmp, 'different-path');
  fs.cpSync(pack, relocated, {recursive: true});
  ctx = await launch([relocated], path.join(tmp, 'profile2'));
  try {
    const [w] = await workers(ctx, 1);
    assert.equal(new URL(w.url()).host, expected);
    console.log('PASS: same P4 test ID after relocation and in a fresh browser profile');
  } finally { await ctx.close(); }
})().catch(e => { console.error(e); process.exitCode = 1; }).finally(() => fs.rmSync(tmp, {recursive: true, force: true}));
