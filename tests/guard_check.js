// Prüft die Schutzregeln im Hintergrund (chrome/background.js) ohne Browser: Anfragen über eine nachgebaute Verbindung.
'use strict';
const fs = require('fs'), vm = require('vm'), path = require('path');
const file = process.argv[2];
let onConnect = null;
const calls = [];
const ev = () => ({ addListener() {} });
const chrome = { runtime: { id: 'x', onConnect: { addListener: (f) => { onConnect = f; } }, onMessage: ev() },
  action: { onClicked: ev() }, tabs: { onRemoved: ev(), sendMessage() {} }, webRequest: { onHeadersReceived: ev() },
  declarativeNetRequest: { updateSessionRules: async () => {} }, scripting: {} };
const ctx = { chrome, globalThis: null, console, URL, AbortController, setTimeout, clearTimeout, btoa, atob, TextEncoder,
  fetch: async (u, o) => { calls.push({ u, cred: o.credentials, method: o.method || 'GET' }); return { status: 200, statusText: 'OK', url: u, headers: new Map([['content-type', 'text/plain']]), text: async () => 'ok' }; } };
ctx.globalThis = ctx;
vm.runInNewContext(fs.readFileSync(file, 'utf8'), ctx);
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
  await t('co.uk wird richtig als eine Seite erkannt', 'https://www.bbc.co.uk/iplayer', { url: 'https://other.co.uk/x' }, (f, c) => f && c.cred === 'omit');
  await t('Router im eigenen Netz: abgelehnt', 'https://www.example.com/', { url: 'http://192.168.0.1/admin' }, (f, c, e) => !f && /eigenen Netz/.test(e));
  await t('localhost (andere Dienste): abgelehnt', 'https://www.example.com/', { url: 'http://127.0.0.1:8080/' }, (f, c, e) => !f && /eigenen Netz/.test(e));
  await t('versteckt: 0x7f.1 (= 127.0.0.1): abgelehnt', 'https://www.example.com/', { url: 'http://0x7f.1:8080/' }, (f, c, e) => !f && /eigenen Netz/.test(e));
  await t('versteckt: 2130706433 (= 127.0.0.1): abgelehnt', 'https://www.example.com/', { url: 'http://2130706433/' }, (f, c, e) => !f && /eigenen Netz/.test(e));
  await t('versteckt: [::ffff:192.168.0.1]: abgelehnt', 'https://www.example.com/', { url: 'http://[::ffff:192.168.0.1]/' }, (f, c, e) => !f && /eigenen Netz/.test(e));
  await t('Helfer-App 127.0.0.1:47811: erlaubt (auch POST)', 'https://www.example.com/', { url: 'http://127.0.0.1:47811/vol?v=1', method: 'POST' }, (f, c) => f && c.method === 'POST');
  await t('POST an fremde Server: abgelehnt', 'https://www.example.com/', { url: 'https://www.example.com/api', method: 'POST' }, (f, c, e) => !f && /nur GET/.test(e));
  await t('file:/data: abgelehnt', 'https://www.example.com/', { url: 'file:///etc/passwd' }, (f, c, e) => !f && /http/.test(e));
  await t('Seite selbst im eigenen Netz: dorthin erlaubt', 'http://192.168.0.5:8096/web', { url: 'http://192.168.0.5:8096/Videos/1' }, (f, c) => f && c.cred === 'include');
  out.forEach((o) => console.log((o[1] ? 'OK   ' : 'FAIL ') + o[0] + (o[1] ? '' : '  – ' + o[2])));
})();
