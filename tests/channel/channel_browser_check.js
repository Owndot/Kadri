// Browser-Test des Helfer-Kanals in der normalen Kadri-Fassung für Chrome/Vivaldi (dist/test = dist/chrome mit den
// Test-Öffnungen) in Chromium (Playwright) gegen den echten ChannelServer der Helper-App (Desktop, ChannelHarness).
// Das ist KEIN Vivaldi-Android- oder Gerätetest.
//   node tools/build.js --test
//   HELPER_HOST_DIR=<Helper-Repo: tests/java/channel/build.sh OUT> node tests/channel/channel_browser_check.js
//   CHANNEL_DIST_DIR: nur für die Mutationsprobe (mutierte Kopie von dist/test).
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
  if (location.hostname !== 'evil.test') return;
  const out = {};
  const send = async (m) => { try { const r = await chrome.runtime.sendMessage(m); return r && r.ok ? 'ALLOWED' : (r && r.error ? r.error.kind : 'rejected'); } catch (e) { return 'error'; } };
  for (const op of ['status', 'check', 'pair', 'forget']) out['admin-' + op] = await send({ t: 'kadri-channel', op, code: '12345678' });
  out.validStatus = await send({ t: 'kadri-helper', op: 'status' });
  out.extraField = await send({ t: 'kadri-helper', op: 'status', url: 'https://media.invalid/v.mp4' });
  out.cookie = await send({ t: 'kadri-helper', op: 'status', c: 'SESSION=SYNTHETIC' });
  out.download = await send({ t: 'kadri-helper', op: 'download', v: 1 });
  out.ping = await send({ t: 'kadri-helper', op: 'ping' });
  out.brightRange = await send({ t: 'kadri-helper', op: 'bright', v: 5 });
  out.brightString = await send({ t: 'kadri-helper', op: 'bright', v: '0.5' });
  if (!chrome.storage) out.storageKeys = 'no-storage-api';
  else try { const all = await chrome.storage.local.get(null); out.storageKeys = Object.keys(all).filter((k) => /pin|identity|channel|helperKey/i.test(k)); } catch (e) { out.storageKeys = 'error'; }
  try { out.idb = (await indexedDB.databases()).map((d) => d.name); } catch (e) { out.idb = 'error'; }
  const xhr = (url, method) => new Promise((res) => {
    const port = chrome.runtime.connect({ name: 'kadri-xhr' });
    port.onMessage.addListener((m) => { if (m.t === 'error' || m.t === 'done' || m.t === 'head') { res(m.t === 'error' ? m.msg : 'reached ' + (m.status || '')); port.disconnect(); } });
    port.onDisconnect.addListener(() => res('no-broker'));
    port.postMessage({ t: 'req', url, method, data: method === 'POST' ? 'x' : undefined, headers: { 'X-Kadri-Helper': '2' } });
    setTimeout(() => res('timeout'), 5000);
  });
  out.xhrChannel = await xhr('http://127.0.0.1:47899/p1/ch/hs', 'POST');
  out.xhrLegacy = await xhr('http://127.0.0.1:47811/ping', 'GET');
  document.documentElement.dataset.kadriProbe = JSON.stringify(out);
})();`;

async function main() {
  const dist = process.env.CHANNEL_DIST_DIR || path.join(ROOT, 'dist', 'test');
  if (!fs.existsSync(path.join(dist, 'manifest.json'))) throw new Error('run node tools/build.js --test first');
  const ext = fs.mkdtempSync(path.join(os.tmpdir(), 'kadri-channel-ext-'));
  fs.cpSync(dist, ext, { recursive: true });
  fs.writeFileSync(path.join(ext, 'channel-probe-cs.js'), PROBE_CS);
  const manifest = JSON.parse(fs.readFileSync(path.join(ext, 'manifest.json'), 'utf8'));
  const original = JSON.parse(JSON.stringify(manifest));
  manifest.content_scripts.push({ matches: ['http://evil.test/*'], js: ['channel-probe-cs.js'], run_at: 'document_idle' });
  fs.writeFileSync(path.join(ext, 'manifest.json'), JSON.stringify(manifest, null, 2));

  // Alter Klartext-Port: ein Dienst, der jede Verbindung zählt. Er darf nie erreicht werden.
  let legacyHits = 0;
  const legacy = http.createServer((req, res) => { legacyHits++; res.writeHead(200, { 'Content-Type': 'application/json' }); res.end('{"ok":true}'); });
  await new Promise((r) => legacy.listen(47811, '127.0.0.1', r));
  const probe = http.createServer((req, res) => { res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' }); res.end(PROBE_PAGE); });
  await new Promise((r) => probe.listen(PROBE_PORT, '127.0.0.1', r));
  const h = startHelper();
  await h.ready;
  const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'kadri-channel-profile-'));
  const context = await chromium.launchPersistentContext(profile, {
    channel: 'chromium', headless: true,
    // Die Angreifer-Seite liegt unter einem fremden Namen (wie im Netz), nicht selbst auf 127.0.0.1 – sonst gälte Kadris
    // bestehende Ausnahme für Seiten im eigenen Netz (Medienserver zu Hause: GET an denselben Rechner).
    args: ['--disable-extensions-except=' + ext, '--load-extension=' + ext, '--host-resolver-rules=MAP evil.test 127.0.0.1'],
  });
  try {
    let sw = context.serviceWorkers().find((w) => w.url().endsWith('/background.js'));
    if (!sw) sw = await context.waitForEvent('serviceworker', { predicate: (w) => w.url().endsWith('/background.js'), timeout: 20000 });
    const id = new URL(sw.url()).host;
    check('Kadris Service Worker läuft (mit Kanal)', await sw.evaluate(() => typeof self.KadriChannel.createChannel === 'function'));
    check('CSP erlaubt nur WASM zusätzlich (kein unsafe-eval)', original.content_security_policy.extension_pages === "script-src 'self' 'wasm-unsafe-eval'; object-src 'self';");
    check('Keine neuen Berechtigungen', JSON.stringify(original.permissions) === '["storage","declarativeNetRequestWithHostAccess","scripting"]' && JSON.stringify(original.host_permissions) === '["<all_urls>"]');

    const options = await context.newPage();
    await options.goto('chrome-extension://' + id + '/options.html');
    const send = (op, extra) => options.evaluate((m) => chrome.runtime.sendMessage(m), Object.assign({ t: 'kadri-channel', op }, extra || {}));
    const cmd = (op, v) => options.evaluate((m) => chrome.runtime.sendMessage(m), v === undefined ? { t: 'kadri-helper', op } : { t: 'kadri-helper', op, v });
    await options.waitForFunction(() => document.getElementById('pairState') && document.getElementById('pairState').textContent !== '…');
    check('Anfangs nicht gekoppelt (Einstellungsseite)', /Nicht gekoppelt|Not paired/.test(await options.textContent('#pairState')));
    check('Ohne Kopplung: Befehl ohne Netzwerk abgelehnt', !(await cmd('status')).ok && h.events.length === 0, h.events.join(' | '));

    // (eval aus page.evaluate wäre kein Beleg: DevTools-Auswertungen umgehen die CSP. Darum ein eingeschleustes Inline-Skript.)
    const inlineRan = await options.evaluate(() => new Promise((res) => {
      const s = document.createElement('script'); s.textContent = 'window.__inlineRan = true;'; document.head.appendChild(s);
      setTimeout(() => res(window.__inlineRan === true), 200);
    }));
    check('CSP der Erweiterungsseiten: eingeschleuste Inline-Skripte gesperrt', inlineRan === false);

    // Kopplung über die echte Oberfläche
    await options.fill('#pairCode', (await h.code()).replace(/^(\d{4})/, '$1 '));
    await options.click('#pairBtn');
    await options.waitForFunction(() => /Verbunden|Connected|Kopplung|abgelehnt|fehl/i.test(document.getElementById('pairMsg').textContent), null, { timeout: 30000 });
    check('Kopplung über die Einstellungsseite', /^(Verbunden|Connected)$/.test(await options.textContent('#pairMsg')), await options.textContent('#pairMsg'));
    check('Einstellungsseite zeigt die Kopplung', /Gekoppelt mit Helfer|Paired with helper/.test(await options.textContent('#pairState')));
    check('Code-Feld nach dem Koppeln geleert', (await options.inputValue('#pairCode')) === '');

    // Steuerbefehle wie aus dem Player
    const st = await cmd('status');
    check('Status über den Kanal (Downloads aus)', st.ok && st.value.ok === true && st.value.dl === false && st.value.proxy === false, JSON.stringify(st));
    await cmd('bright', 0.25); await cmd('vol', 0.2);
    const d1 = await h.device();
    check('Helligkeit und Lautstärke kommen am Gerät an', d1.bright === 0.25 && d1.volStep === 3, JSON.stringify(d1));
    check('end gibt die Helligkeit zurück', (await cmd('end')).value.ok === true && (await h.device()).overriding === false);

    const popup = await context.newPage();
    await popup.goto('chrome-extension://' + id + '/popup.html');
    await popup.waitForFunction(() => /verbunden|connected|nicht|not/i.test(document.getElementById('helper').textContent), null, { timeout: 20000 });
    check('Menü zeigt „verbunden“ (über den Kanal)', /Helfer-App: verbunden|Helper app: connected/.test(await popup.textContent('#helper')), await popup.textContent('#helper'));
    const popupPair = await popup.evaluate(() => chrome.runtime.sendMessage({ t: 'kadri-channel', op: 'pair', code: '12345678' }));
    const popupForget = await popup.evaluate(() => chrome.runtime.sendMessage({ t: 'kadri-channel', op: 'forget' }));
    check('Menü darf nicht koppeln oder entkoppeln', !popupPair.ok && popupPair.error.kind === 'refused' && !popupForget.ok && popupForget.error.kind === 'refused');
    await popup.close();

    const rules = await sw.evaluate(() => chrome.declarativeNetRequest.getSessionRules());
    const ids = rules.map((r) => r.id).sort((a, b) => a - b);
    const r40 = rules.find((r) => r.id === 40);
    check('Kanal-Freigabe (Regel 40): nur POST an die vier Pfade, nur Kadris eigene Anfragen', !!r40 && r40.action.type === 'allow' &&
      r40.condition.regexFilter === '^http://127\\.0\\.0\\.1:47899/p1/(?:pair/m[02]|ch/(?:hs|rec))$' && r40.condition.requestMethods.join() === 'post' &&
      r40.condition.tabIds.join() === '-1' && JSON.stringify(r40.condition.initiatorDomains) === JSON.stringify([id]), JSON.stringify(r40));
    check('Alte Freigabe für Port 47811 (Regel 50) entfernt; Schutzregeln 51–58, 70, 80 bestehen', !ids.includes(50) && [51, 58, 70, 80].every((x) => ids.includes(x)), ids.join(','));
    const blocked = await sw.evaluate(async () => {
      const out = {};
      for (const [k, u, m] of [['legacy', 'http://127.0.0.1:47811/ping', 'GET'], ['legacyPost', 'http://127.0.0.1:47811/bright?v=1', 'POST'], ['getChannel', 'http://127.0.0.1:47899/p1/ch/hs', 'GET'], ['otherPath', 'http://127.0.0.1:47899/ping', 'POST']]) {
        try { await fetch(u, { method: m, signal: AbortSignal.timeout(3000) }); out[k] = 'reached'; } catch (e) { out[k] = 'blocked'; }
      }
      return out;
    });
    check('Hintergrund erreicht weder den alten Port noch andere Wege zum Kanal-Port', Object.values(blocked).every((v) => v === 'blocked'), JSON.stringify(blocked));

    // Worker-Neustart
    const cdp = await context.newCDPSession(options);
    await cdp.send('ServiceWorker.enable');
    await cdp.send('ServiceWorker.stopAllWorkers');
    await new Promise((r) => setTimeout(r, 500));
    const afterRestart = await cmd('bright', 0.5);
    check('Nach Worker-Neustart: gespeicherte Kopplung, neuer Handshake, Befehl kommt an', afterRestart.ok && (await h.device()).bright === 0.5, JSON.stringify(afterRestart));

    // Widerruf (Einzelwiderruf dieses Browsers)
    const regs = await h.regs();
    await h.cmd('revoke ' + regs[0].split(':')[0]);
    const revoked = await send('check');
    check('Widerruf wird respektiert ("rejected"), Befehle abgelehnt', !revoked.ok && revoked.error.kind === 'rejected' && !(await cmd('status')).ok, JSON.stringify(revoked.error));
    check('Widerruf: kein automatisches Neukoppeln', (await send('status')).value.paired === true && (await h.regs()).length === 0);
    const repaired = await send('pair', { code: await h.code() });
    check('Bewusste Neukopplung nach Widerruf', repaired.ok && repaired.value.replacedPrevious);

    // Fremder Dienst auf dem Kanal-Port
    const before = await h.device();
    await h.cmd('rogue-on');
    const r1 = await cmd('bright', 0.9), r2 = await send('check');
    check('Fremder Dienst: erkannt, Befehl nicht ausgeführt', !r1.ok && !r2.ok && r2.error.kind === 'identity-mismatch', JSON.stringify([r1, r2.error]));
    const off = await h.cmd('rogue-off');
    check('Fremder Dienst sah keinen Klartext; echter Helfer wieder erreichbar ohne neue Kopplung', /plaintextHits=0 /.test(off) && (await cmd('status')).ok && (await h.device()).brights === before.brights, off);

    // Bösartige Webseite und Content-Script
    const evil = await context.newPage();
    await evil.goto('http://evil.test:' + PROBE_PORT + '/');
    await evil.waitForFunction(() => document.documentElement.dataset.attack && document.documentElement.dataset.kadriProbe, null, { timeout: 20000 });
    const attack = JSON.parse(await evil.evaluate(() => document.documentElement.dataset.attack));
    const cs = JSON.parse(await evil.evaluate(() => document.documentElement.dataset.kadriProbe));
    check('Webseite: kein Zugriff auf die Erweiterung, Preflight blockiert', attack.runtime === 'undefined' && attack.preflighted === 'blocked', JSON.stringify(attack));
    check('Webseite: einfache Anfrage vom Helfer-Gate abgewiesen', h.events.some((e) => /GATE_REJECT/.test(e)), h.events.filter((e) => /GATE/.test(e)).join(' | '));
    check('Content-Script: Verwaltung (status/check/pair/forget) abgewiesen', ['status', 'check', 'pair', 'forget'].every((k) => cs['admin-' + k] === 'refused'), JSON.stringify(cs));
    check('Content-Script: gültiger Steuerbefehl erlaubt', cs.validStatus === 'ALLOWED', cs.validStatus);
    check('Content-Script: fremde Felder (URL, Cookie), fremde Befehle und falsche Werte abgewiesen',
      ['extraField', 'cookie', 'download', 'ping', 'brightRange', 'brightString'].every((k) => cs[k] === 'rejected'), JSON.stringify(cs));
    check('Content-Script: keine Kanal-Daten in storage.local, Kanal-IndexedDB unerreichbar', Array.isArray(cs.storageKeys) && !cs.storageKeys.length && Array.isArray(cs.idb) && !cs.idb.includes('kadri-helper-channel'), JSON.stringify([cs.storageKeys, cs.idb]));
    check('Content-Script: Kadris Anfrage-Weg erlaubt weder POST an den Kanal noch den alten Port', /nicht erlaubt/.test(cs.xhrChannel) && /nicht erlaubt/.test(cs.xhrLegacy), cs.xhrChannel + ' / ' + cs.xhrLegacy);
    check('Kopplung nach dem Angriff unverändert nutzbar', (await cmd('status')).ok);

    // Kopplung entfernen über die Oberfläche
    options.once('dialog', (d) => d.accept());
    await options.click('#forgetBtn');
    await options.waitForFunction(() => /Nicht gekoppelt|Not paired/.test(document.getElementById('pairState').textContent), null, { timeout: 10000 });
    check('Kopplung entfernen (Einstellungsseite)', !(await cmd('status')).ok);
    check('Alter Klartext-Port wurde nie erreicht', legacyHits === 0, 'hits=' + legacyHits);
  } finally {
    await context.close();
    await h.stop();
    probe.close();
    legacy.close();
    fs.rmSync(profile, { recursive: true, force: true });
    fs.rmSync(ext, { recursive: true, force: true });
  }
  summary('channel-browser');
}

main().catch((e) => { console.error(e); process.exitCode = 1; });
