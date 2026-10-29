// Prüft die Schutzregeln im Hintergrund (chrome/background.js) ohne Browser: Anfragen über eine nachgebaute Verbindung.
'use strict';
const fs = require('fs'), vm = require('vm'), path = require('path');
const file = process.argv[2];
let onConnect = null;
const calls = [];
const ev = () => ({ addListener() {} });
const rules = new Map();   // nachgebaute Sitzungsregeln
let failRules = false;
const chrome = { runtime: { id: 'x', getURL: (p) => 'moz-extension://abc/' + p, onConnect: { addListener: (f) => { onConnect = f; } }, onMessage: ev() },
  action: { onClicked: ev() }, tabs: { onRemoved: ev(), sendMessage() {} },
  webRequest: { onHeadersReceived: ev(), onBeforeRequest: ev(), onBeforeSendHeaders: ev(), onCompleted: ev(), onErrorOccurred: ev() },
  declarativeNetRequest: {
    updateSessionRules: async (o) => { if (failRules) throw new Error('kaputt'); (o.removeRuleIds || []).forEach((id) => rules.delete(id)); (o.addRules || []).forEach((r) => rules.set(r.id, r)); },
    getSessionRules: async () => Array.from(rules.values()) }, scripting: {} };
const ctx = { chrome, globalThis: null, console, URL, AbortController, setTimeout, clearTimeout, btoa, atob, TextEncoder,
  fetch: async (u, o) => { calls.push({ u, cred: o.credentials, method: o.method || 'GET', redirect: o.redirect }); return { status: 200, statusText: 'OK', url: u, headers: new Map([['content-type', 'text/plain']]), text: async () => 'ok' }; } };
ctx.globalThis = ctx;
vm.createContext(ctx);
const PSL = path.join(path.dirname(file), '..', 'vendor', 'psl.js');
// Kanal-Module (channel/…) brauchen WASM und einen echten Service Worker – hier nicht geladen (eigene Tests in tests/channel).
ctx.importScripts = (...fl) => fl.forEach((f) => { if (!/^channel\//.test(f)) vm.runInContext(fs.readFileSync(f === 'psl.js' ? PSL : f, 'utf8'), ctx); });
if (/firefox/.test(file)) ctx.importScripts('psl.js');   // (Firefox lädt psl.js vor background.js)
vm.runInContext(fs.readFileSync(file, 'utf8'), ctx);
function req(from, m) {
  return new Promise((res) => {
    const msgs = [];
    const port = { name: 'kadri-xhr', sender: { url: from }, postMessage: (x) => { msgs.push(x); if (x.t === 'done' || x.t === 'error') res(msgs); },
      onDisconnect: { addListener() {} }, onMessage: { addListener: (f) => { port._f = f; } } };
    onConnect(port);
    port._f(Object.assign({ t: 'req', method: 'GET', headers: {} }, m));
    setTimeout(() => res(msgs), 500);
  });
}
(async () => {
  const out = [];
  const last = () => calls[calls.length - 1];
  const t = async (name, from, m, want) => {
    const n0 = calls.length; const msgs = await req(from, m); const fetched = calls.length > n0;
    const err = (msgs.find((x) => x.t === 'error') || {}).msg || '';
    out.push([name, want(fetched, fetched ? last() : null, err), JSON.stringify({ fetched, call: fetched ? last() : null, err })]);
  };
  await t('gleiche Seite: mit Anmeldung', 'https://www.ardmediathek.de/video/1', { url: 'https://api.ardmediathek.de/x' }, (f, c) => f && c.cred === 'include');
  await t('fremder Server (Video-CDN): ohne Anmeldung', 'https://www.facebook.com/reel/1', { url: 'https://evil.example/steal' }, (f, c) => f && c.cred === 'omit');
  await t('github.io: fremde Unterseite bekommt keine Anmeldung', 'https://opfer.github.io/video', { url: 'https://angreifer.github.io/x.vtt' }, (f, c) => f && c.cred === 'omit');
  await t('github.io: dieselbe Unterseite behält die Anmeldung', 'https://opfer.github.io/video', { url: 'https://opfer.github.io/x.vtt' }, (f, c) => f && c.cred === 'include');
  await t('co.uk wird richtig als eine Seite erkannt', 'https://www.bbc.co.uk/iplayer', { url: 'https://other.co.uk/x' }, (f, c) => f && c.cred === 'omit');
  await t('Router im eigenen Netz: abgelehnt', 'https://www.example.com/', { url: 'http://192.168.0.1/admin' }, (f, c, e) => !f && /eigenen Netz/.test(e));
  await t('localhost (andere Dienste): abgelehnt', 'https://www.example.com/', { url: 'http://127.0.0.1:8080/' }, (f, c, e) => !f && /eigenen Netz/.test(e));
  await t('versteckt: 0x7f.1 (= 127.0.0.1): abgelehnt', 'https://www.example.com/', { url: 'http://0x7f.1:8080/' }, (f, c, e) => !f && /eigenen Netz/.test(e));
  await t('versteckt: 2130706433 (= 127.0.0.1): abgelehnt', 'https://www.example.com/', { url: 'http://2130706433/' }, (f, c, e) => !f && /eigenen Netz/.test(e));
  await t('versteckt: [::ffff:192.168.0.1]: abgelehnt', 'https://www.example.com/', { url: 'http://[::ffff:192.168.0.1]/' }, (f, c, e) => !f && /eigenen Netz/.test(e));
  await t('alter Helfer-Port 127.0.0.1:47811: abgelehnt (auch GET)', 'https://www.example.com/', { url: 'http://127.0.0.1:47811/ping' }, (f, c, e) => !f && /eigenen Netz/.test(e));
  await t('Kanal-Port 127.0.0.1:47899 über diesen Weg: abgelehnt', 'https://www.example.com/', { url: 'http://127.0.0.1:47899/p1/ch/hs', method: 'POST' }, (f, c, e) => !f && /eigenen Netz|nur GET/.test(e));
  await t('POST an fremde Server: abgelehnt', 'https://www.example.com/', { url: 'https://www.example.com/api', method: 'POST' }, (f, c, e) => !f && /nur GET/.test(e));
  await t('file:/data: abgelehnt', 'https://www.example.com/', { url: 'file:///etc/passwd' }, (f, c, e) => !f && /http/.test(e));
  await t('Seite selbst im eigenen Netz: dorthin erlaubt', 'http://192.168.0.5:8096/web', { url: 'http://192.168.0.5:8096/Videos/1' }, (f, c) => f && c.cred === 'include');
  await t('eu.org (Public Suffix List): fremde Unterseite bekommt keine Anmeldung', 'https://alice.eu.org/video', { url: 'https://bob.eu.org/x.vtt' }, (f, c) => f && c.cred === 'omit');
  await t('andere Anfragen folgen Weiterleitungen (Video-CDNs)', 'https://www.example.com/', { url: 'https://cdn.example.net/a.vtt' }, (f, c) => f && c.redirect === 'follow');
  if (!/firefox/.test(file)) {
    const ids = Array.from(rules.keys());
    out.push(['Schutzregeln stehen (40, 51–58, 70, 80), keine Freigabe 50 für den alten Port', [40, 51, 58, 70, 80].every((i) => ids.includes(i)) && !ids.includes(50), JSON.stringify(ids)]);
    const r40 = rules.get(40), rx = r40 && new RegExp(r40.condition.regexFilter);
    out.push(['Regel 40: nur POST an die vier Kanal-Pfade, nur eigene Anfragen', !!rx && rx.test('http://127.0.0.1:47899/p1/ch/rec') && rx.test('http://127.0.0.1:47899/p1/pair/m0') && !rx.test('http://127.0.0.1:47899/p1/ch/rec2') && !rx.test('http://127.0.0.1:47811/ping') && !rx.test('http://127.0.0.1:47899/status') &&
      r40.condition.requestMethods.join() === 'post' && r40.condition.tabIds.join() === '-1' && r40.condition.initiatorDomains.join() === 'x', JSON.stringify(r40)]);
    const strip = rules.get(80);
    out.push(['Regel 80 entfernt Cookie und Authorization', strip && JSON.stringify(strip.action).includes('cookie') && JSON.stringify(strip.action).includes('authorization'), JSON.stringify(strip)]);
    // Medienserver: nur GENAU die Adresse wird freigegeben (keine Freigabe für den ganzen Server oder Port)
    let seen = null;
    const upd = chrome.declarativeNetRequest.updateSessionRules;
    chrome.declarativeNetRequest.updateSessionRules = async (o) => { (o.addRules || []).forEach((r) => { if (r.priority === 20) seen = r; }); return upd(o); };
    await req('http://192.168.0.5:8096/web', { url: 'http://192.168.0.5:8096/Videos/1?x=1' });
    chrome.declarativeNetRequest.updateSessionRules = upd;
    const re = seen && new RegExp(seen.condition.regexFilter);
    out.push(['Medienserver: Freigabe nur für genau diese Adresse', re && re.test('http://192.168.0.5:8096/Videos/1?x=1') && !re.test('http://192.168.0.5:8096/admin') && !re.test('http://192.168.0.5:8080/Videos/1?x=1'), JSON.stringify(seen && seen.condition)]);
    // Schutzregeln lassen sich nicht setzen: keine Anfragen hinaus
    failRules = true; rules.clear(); ctx.eval && 0;
    vm.runInContext('netReady = null;', ctx);
    await t('Schutzregeln fehlen: Anfrage wird nicht gestellt', 'https://www.example.com/', { url: 'https://www.example.com/a.vtt' }, (f, c, e) => !f && /Schutzregeln/.test(e));
    await t('… auch nicht zum alten Helfer-Port', 'https://www.example.com/', { url: 'http://127.0.0.1:47811/version' }, (f, c, e) => !f);
    failRules = false;
  }
  out.forEach((o) => console.log((o[1] ? 'OK   ' : 'FAIL ') + o[0] + (o[1] ? '' : '  – ' + o[2])));
})();
