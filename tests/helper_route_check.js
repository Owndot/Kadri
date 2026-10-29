'use strict';
// Weg des Players zur Helfer-App in Kadri: helper() (src/080, geteilt mit dem Userscript) → KADRI_HELPER (nur in
// chrome/prelude.js) → Nachricht an den Hintergrund (sicherer Kanal). Geprüft am echten Quelltext:
//  - nur /ping (= status), /status, /beat, /end, /bright?v=…, /vol?v=… werden zu {t:'kadri-helper', op, v};
//  - alles andere (Downloads, Laden über den Browser, Cookies, URLs) verlässt das Inhaltsskript nicht;
//  - Firefox-Fassung und Userscript haben keinen Weg (helper() meldet „kein Helfer“), kein alter Schlüssel, kein Port.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const root = path.resolve(process.argv[2] || path.join(__dirname, '..'));
const shared = fs.readFileSync(path.join(root, 'src/080-helper-app.js'), 'utf8');
const a = shared.indexOf('  // ---------- Helfer-App'), b = shared.indexOf('  // ---------- Laden über den Browser', a);
assert(a >= 0 && b > a, 'helper section not found');
const prelude = (t) => fs.readFileSync(path.join(root, t, 'prelude.js'), 'utf8');
const k1 = prelude('chrome').indexOf('    const KADRI_HELPER = async'), k2 = prelude('chrome').indexOf('\n    };\n', k1);
assert(k1 >= 0 && k2 > k1, 'KADRI_HELPER not found in chrome/prelude.js');
for (const t of ['chrome', 'firefox']) {
  for (const needle of ['helperKey', 'KADRI_HELPER_KEY', 'X-EVP-Key', '47811']) assert(!prelude(t).includes(needle), t + '/prelude.js contains ' + needle);
}
assert(!prelude('firefox').includes('KADRI_HELPER'), 'firefox/prelude.js must not route to a helper');

(async () => {
  const sent = [];
  const api = { runtime: { sendMessage: async (m) => { sent.push(m); return { ok: true, value: { ok: true, bright: 0.5 } }; } } };
  const ctx = { api, CONFIG: { systemHelper: true }, GM_getValue: () => '', GM_setValue: () => {} };
  vm.runInNewContext(prelude('chrome').slice(k1, k2 + 7) + shared.slice(a, b) + '\nglobalThis.helper = helper;', ctx);
  const ok = [['/ping', { t: 'kadri-helper', op: 'status' }], ['/status', { t: 'kadri-helper', op: 'status' }], ['/beat', { t: 'kadri-helper', op: 'beat' }],
    ['/end', { t: 'kadri-helper', op: 'end' }], ['/bright?v=0.500', { t: 'kadri-helper', op: 'bright', v: 0.5 }], ['/vol?v=1.000', { t: 'kadri-helper', op: 'vol', v: 1 }]];
  for (const [p, want] of ok) {
    sent.length = 0;
    assert.deepEqual(await ctx.helper(p, 1200), { ok: true, bright: 0.5 }, p);
    assert.equal(JSON.stringify(sent), JSON.stringify([want]), p);
  }
  sent.length = 0;
  for (const p of ['/download?u=https%3A%2F%2Fmedia.invalid%2Fa.mp4&c=SESSION%3DSYNTHETIC', '/dlstate?id=1', '/pull?job=1', '/push?job=1&id=1&st=200',
    '/bright?v=1e-3', '/bright?v=0.5&u=x', '/bright?v=', '/vol?v=-1', '/ping?x=1', '/pair', 'http://127.0.0.1:47811/ping', '/PING']) {
    assert.equal(await ctx.helper(p, 1200, new ArrayBuffer(4)), null, p);
  }
  assert.deepEqual(sent, [], 'a non-control path left the content script');
  ctx.CONFIG.systemHelper = false;
  assert.equal(await ctx.helper('/ping'), null);
  assert.deepEqual(sent, [], 'routed although the "Helper app" setting is off');
  // Firefox und Userscript: kein KADRI_HELPER → nichts.
  const ff = { CONFIG: { systemHelper: true }, GM_getValue: () => '', GM_setValue: () => {} };
  vm.runInNewContext(shared.slice(a, b) + '\nglobalThis.helper = helper;', ff);
  assert.equal(await ff.helper('/ping'), null);
  // Antwort des Hintergrunds, die kein Objekt ist, gilt als „kein Helfer“.
  const odd = { api: { runtime: { sendMessage: async () => ({ ok: true, value: 'x' }) } }, CONFIG: { systemHelper: true }, GM_getValue: () => '', GM_setValue: () => {} };
  vm.runInNewContext(prelude('chrome').slice(k1, k2 + 7) + shared.slice(a, b) + '\nglobalThis.helper = helper;', odd);
  assert.equal(await odd.helper('/ping'), null);
  console.log('PASS: Kadri routes only the five control commands to the background channel; Firefox/userscript have no route; no legacy key or port');
})().catch((e) => { console.error(e); process.exitCode = 1; });
