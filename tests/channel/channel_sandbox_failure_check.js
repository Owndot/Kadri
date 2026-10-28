// Fail-closed-Test des minimalen Test-Builds (Review N1): Lässt sich die Sandkasten-Regel 41 nicht setzen, darf der
// Kanal nichts tun – jede Aktion meldet „sandbox-missing“, keine Anfrage erreicht den Helfer.
// Der Test verdirbt dafür in einer KOPIE des Builds die Regel (ungültiger regexFilter → updateSessionRules scheitert).
//   node tools/build.js --channel-only
//   HELPER_HOST_DIR=... node tests/channel/channel_sandbox_failure_check.js
// CHANNEL_DIST_DIR: nur für die Mutationsprobe (mutierte Kopie von dist/channel-only).
'use strict';
const fs = require('fs');
const os = require('os');
const path = require('path');
const { chromium } = require('playwright');
const { ROOT, loadChannel, startHelper, check, summary } = require('./lib');

async function main() {
  const dist = process.env.CHANNEL_DIST_DIR || path.join(ROOT, 'dist', 'channel-only');
  const ext = fs.mkdtempSync(path.join(os.tmpdir(), 'kadri-channel-broken-'));
  fs.cpSync(dist, ext, { recursive: true });
  const entry = path.join(ext, 'channel-only-background.js');
  const good = "condition: { tabIds: [-1], initiatorDomains: [chrome.runtime.id] }";
  const text = fs.readFileSync(entry, 'utf8');
  if (text.split(good).length !== 2) throw new Error('sandbox rule pattern not found exactly once');
  fs.writeFileSync(entry, text.replace(good, "condition: { tabIds: [-1], initiatorDomains: [chrome.runtime.id], regexFilter: '(' }"));

  const h = startHelper();
  await h.ready;
  const code = await h.code();
  const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'kadri-channel-profile-'));
  const context = await chromium.launchPersistentContext(profile, {
    channel: 'chromium', headless: true, args: ['--disable-extensions-except=' + ext, '--load-extension=' + ext],
  });
  try {
    let sw = context.serviceWorkers().find((w) => w.url().endsWith('/channel-only-background.js'));
    if (!sw) sw = await context.waitForEvent('serviceworker', { predicate: (w) => w.url().endsWith('/channel-only-background.js'), timeout: 20000 });
    const id = new URL(sw.url()).host;
    const page = await context.newPage();
    await page.goto('chrome-extension://' + id + '/channel/channel.html');
    const send = (op, extra) => page.evaluate((m) => chrome.runtime.sendMessage(m), Object.assign({ t: 'kadri-channel', op }, extra || {}));
    const results = {};
    for (const [op, extra] of [['status'], ['pair', { code }], ['ping'], ['dummy', { size: 1024 }], ['forget']]) {
      const r = await send(op, extra);
      results[op] = r.ok ? 'ALLOWED' : r.error.kind;
    }
    check('Sandkasten-Regel nicht setzbar: jede Aktion wird mit "sandbox-missing" abgelehnt', Object.values(results).every((k) => k === 'sandbox-missing'), JSON.stringify(results));
    const rules = await sw.evaluate(() => chrome.declarativeNetRequest.getSessionRules());
    check('Regel 41 fehlt tatsächlich (Testaufbau)', !rules.some((r) => r.id === 41), rules.map((r) => r.id).join(','));
    const reached = h.events.filter((e) => /PAIRED|HS_|REC|GATE|REJECT|ERROR/.test(e));
    check('Keine Anfrage hat den Helfer erreicht', reached.length === 0, reached.join(' | '));
    // Gegenprobe: derselbe Code ist unverbraucht – eine Kopplung von außerhalb des gesperrten Builds gelingt damit.
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
  summary('channel-sandbox-failure');
}

main().catch((e) => { console.error(e); process.exitCode = 1; });
