// Fail-closed-Test: Lassen sich Kadris Schutzregeln nicht setzen (darunter Regel 40 für den Kanal), geht keine
// Anfrage zum Helfer hinaus – Kopplung und Befehle scheitern, der Code bleibt unverbraucht.
// Der Test verdirbt dafür in einer KOPIE des Builds die Kanal-Regel (ungültiger regexFilter → updateSessionRules scheitert).
//   node tools/build.js --test
//   HELPER_HOST_DIR=... node tests/channel/channel_netguard_failure_check.js
// CHANNEL_DIST_DIR: nur für die Mutationsprobe (mutierte Kopie von dist/test).
'use strict';
const fs = require('fs');
const os = require('os');
const path = require('path');
const { chromium } = require('playwright');
const { ROOT, loadChannel, startHelper, check, summary } = require('./lib');

async function main() {
  const dist = process.env.CHANNEL_DIST_DIR || path.join(ROOT, 'dist', 'test');
  const ext = fs.mkdtempSync(path.join(os.tmpdir(), 'kadri-channel-broken-'));
  fs.cpSync(dist, ext, { recursive: true });
  const bg = path.join(ext, 'background.js');
  const good = "regexFilter: '^http://127\\\\.0\\\\.0\\\\.1:47899/p1/(?:pair/m[02]|ch/(?:hs|rec))$'";
  const text = fs.readFileSync(bg, 'utf8');
  if (text.split(good).length !== 2) throw new Error('channel rule pattern not found exactly once');
  fs.writeFileSync(bg, text.replace(good, "regexFilter: '('"));

  const h = startHelper();
  await h.ready;
  const code = await h.code();
  const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'kadri-channel-profile-'));
  const context = await chromium.launchPersistentContext(profile, {
    channel: 'chromium', headless: true, args: ['--disable-extensions-except=' + ext, '--load-extension=' + ext],
  });
  try {
    let sw = context.serviceWorkers().find((w) => w.url().endsWith('/background.js'));
    if (!sw) sw = await context.waitForEvent('serviceworker', { predicate: (w) => w.url().endsWith('/background.js'), timeout: 20000 });
    const id = new URL(sw.url()).host;
    const page = await context.newPage();
    await page.goto('chrome-extension://' + id + '/options.html');
    const send = (m) => page.evaluate((x) => chrome.runtime.sendMessage(x), m);
    const results = {};
    for (const m of [{ t: 'kadri-channel', op: 'pair', code }, { t: 'kadri-channel', op: 'check' }, { t: 'kadri-helper', op: 'bright', v: 0.5 }]) {
      const r = await send(m);
      results[m.op] = r.ok ? 'ALLOWED' : (r.error ? r.error.kind : 'rejected');
    }
    check('Schutzregeln nicht setzbar: Kopplung und Befehle scheitern', results.pair === 'unreachable' && results.check !== 'ALLOWED' && results.bright !== 'ALLOWED', JSON.stringify(results));
    const rules = await sw.evaluate(() => chrome.declarativeNetRequest.getSessionRules());
    check('Regel 40 fehlt tatsächlich (Testaufbau)', !rules.some((r) => r.id === 40), rules.map((r) => r.id).join(','));
    check('Keine Anfrage hat den Helfer erreicht', h.events.length === 0, h.events.join(' | '));
    const { NS, core } = loadChannel();
    const other = NS.createChannel({ core, store: NS.createStore(NS.memoryBackend(), () => core.identity_generate()), transport: NS.createTransport({ fetchImpl: fetch, port: 47899 }) });
    const paired = await other.pair(code).then(() => true, (e) => e.kind);
    check('Kopplungscode wurde nicht verbraucht (Gegenprobe koppelt damit)', paired === true, String(paired));
  } finally {
    await context.close();
    await h.stop();
    fs.rmSync(profile, { recursive: true, force: true });
    fs.rmSync(ext, { recursive: true, force: true });
  }
  summary('channel-netguard-failure');
}

main().catch((e) => { console.error(e); process.exitCode = 1; });
