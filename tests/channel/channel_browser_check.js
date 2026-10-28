// Browser-Test des isolierten Test-Builds dist/channel-poc in Chromium (Playwright) gegen den unveränderten PocServer
// (Desktop-Host). Das ist KEIN Vivaldi-Android- oder Gerätetest.
//   node tools/build.js --channel-poc --channel-only
//   HELPER_HOST_DIR=<build-desktop-helper.sh OUT> node tests/channel/channel_browser_check.js            (dist/channel-poc)
//   HELPER_HOST_DIR=... CHANNEL_DIST_DIR=dist/channel-only node tests/channel/channel_browser_check.js   (minimaler Build)
// Für die Prüfung „bösartiges Content-Script“ fügt der Test einer KOPIE des Builds ein Probe-Content-Script hinzu;
// der Build selbst enthält es nicht.
'use strict';
const fs = require('fs');
const os = require('os');
const path = require('path');
const http = require('http');
const { chromium } = require('playwright');
const { ROOT, startHelper, check, summary } = require('./lib');

const PROBE_PORT = 47901;
const PROBE_PAGE = `<!doctype html><meta charset="utf-8"><title>Angreifer-Seite (Test)</title><p>Bösartige Testseite</p>
<script>
(async () => {
  const out = {};
  out.runtime = typeof (window.chrome && chrome.runtime && chrome.runtime.sendMessage);
  try { await fetch('http://127.0.0.1:47899/p1/pair/m0', { method: 'POST', body: new Uint8Array(37), headers: { 'Content-Type': 'application/octet-stream', 'X-Kadri-Helper': '2' } }); out.preflighted = 'reached'; }
  catch (e) { out.preflighted = 'blocked'; }
  try { await fetch('http://127.0.0.1:47899/p1/ch/hs', { method: 'POST', mode: 'no-cors', body: 'x' }); out.simple = 'sent-opaque'; }
  catch (e) { out.simple = 'blocked'; }
  document.documentElement.dataset.attack = JSON.stringify(out);
})();
</script>`;

// Probe-Content-Script (nur in der Testkopie): versucht alles, was ein kompromittiertes Content-Script versuchen könnte.
const PROBE_CS = `(async () => {
  if (location.port !== '${PROBE_PORT}') return;
  const out = {};
  for (const op of ['status', 'pair', 'ping', 'dummy', 'forget']) {
    try { const r = await chrome.runtime.sendMessage({ t: 'kadri-channel', op, code: '12345678', size: 1024 }); out[op] = r && r.ok ? 'ALLOWED' : (r && r.error && r.error.kind); }
    catch (e) { out[op] = 'error'; }
  }
  if (!chrome.storage) out.storageKeys = 'no-storage-api';
  else try { const all = await chrome.storage.local.get(null); out.storageKeys = Object.keys(all).filter((k) => /pin|identity|channel/i.test(k)); } catch (e) { out.storageKeys = 'error'; }
  try { out.idb = (await indexedDB.databases()).map((d) => d.name); } catch (e) { out.idb = 'error'; }
  out.xhrPost = await new Promise((res) => {
    const port = chrome.runtime.connect({ name: 'kadri-xhr' });
    port.onMessage.addListener((m) => { if (m.t === 'error' || m.t === 'done' || m.t === 'head') { res(m.t === 'error' ? m.msg : 'reached ' + (m.status || '')); port.disconnect(); } });
    port.onDisconnect.addListener(() => res('no-broker'));   // minimaler Build: niemand nimmt kadri-xhr an
    port.postMessage({ t: 'req', url: 'http://127.0.0.1:47899/p1/ch/hs', method: 'POST', data: 'x', headers: { 'X-Kadri-Helper': '2' } });
    setTimeout(() => res('timeout'), 5000);
  });
  document.documentElement.dataset.kadriProbe = JSON.stringify(out);
})();`;

async function main() {
  const dist = process.env.CHANNEL_DIST_DIR || path.join(ROOT, 'dist', 'channel-poc');   // Mutationsprobe: mutierte Kopie
  if (!fs.existsSync(path.join(dist, 'manifest.json'))) throw new Error('run node tools/build.js --channel-poc --channel-only first');
  const ext = fs.mkdtempSync(path.join(os.tmpdir(), 'kadri-channel-ext-'));
  fs.cpSync(dist, ext, { recursive: true });
  fs.writeFileSync(path.join(ext, 'channel-probe-cs.js'), PROBE_CS);
  const manifest = JSON.parse(fs.readFileSync(path.join(ext, 'manifest.json'), 'utf8'));
  const swFile = manifest.background.service_worker;
  const minimal = swFile === 'channel-only-background.js';
  const original = JSON.parse(JSON.stringify(manifest));
  console.log('Build: ' + (minimal ? 'minimal (dist/channel-only)' : 'Kadri + Kanal (dist/channel-poc)'));
  manifest.content_scripts = manifest.content_scripts || [];
  manifest.content_scripts.push({ matches: ['http://127.0.0.1/*'], js: ['channel-probe-cs.js'], run_at: 'document_idle' });
  fs.writeFileSync(path.join(ext, 'manifest.json'), JSON.stringify(manifest, null, 2));

  const probe = http.createServer((req, res) => { res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' }); res.end(PROBE_PAGE); });
  await new Promise((r) => probe.listen(PROBE_PORT, '127.0.0.1', r));
  const h = startHelper();
  await h.ready;
  const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'kadri-channel-profile-'));
  const context = await chromium.launchPersistentContext(profile, {
    channel: 'chromium', headless: true, args: ['--disable-extensions-except=' + ext, '--load-extension=' + ext],
  });
  try {
    let sw = context.serviceWorkers().find((w) => w.url().endsWith('/' + swFile));
    if (!sw) sw = await context.waitForEvent('serviceworker', { predicate: (w) => w.url().endsWith('/' + swFile), timeout: 20000 });
    const id = new URL(sw.url()).host;
    const page = await context.newPage();
    await page.goto('chrome-extension://' + id + '/channel/channel.html');
    const send = (op, extra) => page.evaluate((m) => chrome.runtime.sendMessage(m), Object.assign({ t: 'kadri-channel', op }, extra || {}));

    check('Service Worker des Test-Builds läuft', !!sw, sw.url());
    if (minimal) {
      check('Minimal: keine Content-Scripts, keine Optionsseite von Kadri', !original.content_scripts && original.options_ui.page === 'channel/channel.html');
      check('Minimal: Berechtigungen nur declarativeNetRequest + http://127.0.0.1/*', JSON.stringify(original.permissions) === '["declarativeNetRequest"]' && JSON.stringify(original.host_permissions) === '["http://127.0.0.1/*"]');
      const files = fs.readdirSync(dist).sort().join(',');
      check('Minimal: kein Kadri-Hintergrund, keine Medien-/Player-Dateien', files === 'LICENSE,channel,channel-only-background.js,icons,manifest.json', files);
    }
    check('Anfangs nicht gekoppelt', (await send('status')).value.state === 'unpaired');
    // (eval aus page.evaluate wäre kein Beleg: DevTools-Auswertungen umgehen die CSP. Darum ein eingeschleustes Inline-Skript.)
    const inlineRan = await page.evaluate(() => new Promise((res) => {
      const s = document.createElement('script'); s.textContent = 'window.__inlineRan = true;'; document.head.appendChild(s);
      setTimeout(() => res(window.__inlineRan === true), 200);
    }));
    check('CSP der Erweiterungsseiten: eingeschleuste Inline-Skripte gesperrt', inlineRan === false);
    check('CSP erlaubt nur WASM zusätzlich (kein unsafe-eval)', manifest.content_security_policy.extension_pages === "script-src 'self' 'wasm-unsafe-eval'; object-src 'self';");

    const paired = await send('pair', { code: await h.code() });
    check('Kopplung über die Testseite', paired.ok && paired.value.reg.length === 8, JSON.stringify(paired));
    const ping = await send('ping');
    check('Ping im Browser über den authentisierten Kanal', ping.ok && ping.value.helper === 'android-test-app', JSON.stringify(ping));
    const dummy = await send('dummy', { size: 1048576 });
    check('1 MiB Dummy-Daten im Browser (18 Records)', dummy.ok && dummy.value.records === 18, JSON.stringify(dummy));

    const rules = await sw.evaluate(() => chrome.declarativeNetRequest.getSessionRules());
    const ids = rules.map((r) => r.id).sort((a, b) => a - b);
    check('Kanal-Freigabe (Regel 40) nur für POST an die vier Pfade', rules.some((r) => r.id === 40 && r.action.type === 'allow' && /47899\/p1\//.test(r.condition.regexFilter) && r.condition.requestMethods.join() === 'post'));
    if (!minimal) check('Kadris Schutzregeln bleiben bestehen (50–70, 80)', [50, 51, 58, 70, 80].every((x) => ids.includes(x)), ids.join(','));
    if (minimal) {
      check('Minimal: Sandkasten-Regel 41 sperrt alle übrigen Anfragen der Erweiterung', ids.join(',') === '40,41' && rules.some((r) => r.id === 41 && r.action.type === 'block' && r.condition.tabIds.join() === '-1'), ids.join(','));
      const blocked = await sw.evaluate(async () => {
        const out = {};
        for (const [k, u, m] of [['other', 'http://127.0.0.1:47901/', 'GET'], ['web', 'https://example.com/', 'GET'], ['legacy', 'http://127.0.0.1:47811/ping', 'GET'], ['getChannel', 'http://127.0.0.1:47899/p1/ch/hs', 'GET'], ['otherPath', 'http://127.0.0.1:47899/ping', 'POST']]) {
          try { await fetch(u, { method: m, signal: AbortSignal.timeout(3000) }); out[k] = 'reached'; } catch (e) { out[k] = 'blocked'; }
        }
        return out;
      });
      check('Minimal: SW erreicht nur die vier Kanal-POSTs (alles andere gesperrt, auch der alte Helfer-Port)', Object.values(blocked).every((v) => v === 'blocked'), JSON.stringify(blocked));
    }

    // Worker-Neustart
    const cdp = await context.newCDPSession(page);
    await cdp.send('ServiceWorker.enable');
    await cdp.send('ServiceWorker.stopAllWorkers');
    await new Promise((r) => setTimeout(r, 500));
    const afterRestart = await send('ping');
    const st = await send('status');
    check('Nach Worker-Neustart: gespeicherte Kopplung, neuer Handshake', afterRestart.ok && st.value.paired && st.value.reg === paired.value.reg, JSON.stringify(st.value));

    // Widerruf
    await h.cmd('revoke');
    const revoked = await send('ping');
    check('Widerruf wird respektiert ("rejected")', !revoked.ok && revoked.error.kind === 'rejected', JSON.stringify(revoked.error));
    const repaired = await send('pair', { code: await h.code() });
    check('Neukopplung nach Widerruf', repaired.ok && repaired.value.replacedPrevious);

    // Fremde Helfer-Identität
    await h.cmd('rogue-on');
    const r1 = await send('ping'), r2 = await send('ping');
    check('Fremder Listener: erkannt, nichts übertragen', !r1.ok && !r2.ok && r2.error.kind === 'identity-mismatch', r1.error.kind + ' / ' + r2.error.kind);
    const off = await h.cmd('rogue-off');
    check('Fremder Listener sah keinen Klartext; echter Helfer wieder erreichbar', /plaintextHits=0$/.test(off) && (await send('ping')).ok, off);

    // Bösartige Webseite und Content-Script
    const evil = await context.newPage();
    await evil.goto('http://127.0.0.1:' + PROBE_PORT + '/');
    await evil.waitForFunction(() => document.documentElement.dataset.attack && document.documentElement.dataset.kadriProbe, null, { timeout: 15000 });
    const attack = JSON.parse(await evil.evaluate(() => document.documentElement.dataset.attack));
    const cs = JSON.parse(await evil.evaluate(() => document.documentElement.dataset.kadriProbe));
    check('Webseite: kein Zugriff auf die Erweiterung, Preflight blockiert', attack.runtime === 'undefined' && attack.preflighted === 'blocked', JSON.stringify(attack));
    check('Webseite: einfache Anfrage vom Helfer-Gate abgewiesen', h.events.some((e) => /GATE_REJECT POST \/p1\/ch\/hs/.test(e)), h.events.filter((e) => /GATE/.test(e)).join(' | '));
    check('Content-Script: alle Kanal-Befehle abgewiesen', ['status', 'pair', 'ping', 'dummy', 'forget'].every((k) => cs[k] === 'refused'), JSON.stringify(cs));
    check('Content-Script: keine Kanal-Daten in storage.local, Kanal-IndexedDB unerreichbar', (minimal ? cs.storageKeys === 'no-storage-api' : Array.isArray(cs.storageKeys) && !cs.storageKeys.length) && Array.isArray(cs.idb) && !cs.idb.includes('kadri-helper-channel'), JSON.stringify([cs.storageKeys, cs.idb]));
    if (minimal) check('Minimal: kein kadri-xhr-Anfrage-Weg vorhanden', cs.xhrPost === 'no-broker', cs.xhrPost);
    else check('Content-Script: Kadris Anfrage-Weg erlaubt kein POST an den Kanal', /nicht erlaubt/.test(cs.xhrPost), cs.xhrPost);
    check('Kopplung nach dem Angriff unverändert nutzbar', (await send('ping')).ok);
  } finally {
    await context.close();
    await h.stop();
    probe.close();
    fs.rmSync(profile, { recursive: true, force: true });
    fs.rmSync(ext, { recursive: true, force: true });
  }
  summary('channel-browser');
}

main().catch((e) => { console.error(e); process.exitCode = 1; });
