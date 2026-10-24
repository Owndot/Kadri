// Firefox: Schutz auf Netzwerk-Ebene (webRequest, jede Weiterleitung, DNS) – mit nachgebauter Browser-Schnittstelle geprüft
const fs = require('fs');
const src = fs.readFileSync(process.argv[2], 'utf8');
let listener = null;
const api = {
  runtime: { getURL: (p) => 'moz-extension://abc/' + p, onConnect: { addListener() {} }, onMessage: { addListener() {} }, id: 'x' },
  webRequest: { onBeforeRequest: { addListener: (f) => { listener = f; } }, onHeadersReceived: { addListener() {} } },
  dns: { resolve: async (h) => ({ addresses: h === 'rebind.example' ? ['192.168.1.5'] : ['93.184.216.34'] }) },
  tabs: { onRemoved: { addListener() {} } }, declarativeNetRequest: {}, contextMenus: { create() {}, onClicked: { addListener() {} } }, menus: null,
  storage: { local: { get: async () => ({}), set: async () => {} } }, action: null, browserAction: { onClicked: { addListener() {} } },
};
globalThis.browser = api; globalThis.chrome = api;
try { new Function(src)(); } catch (e) { console.log('load error', e.message); }
const own = (url) => ({ tabId: -1, originUrl: 'moz-extension://abc/_generated_background_page.html', url });
(async () => {
  for (const [u, want] of [['https://example.com/a.vtt', false], ['http://192.168.1.1/', true], ['http://127.0.0.1:47811/x', false], ['https://rebind.example/x', true], ['http://user@10.0.0.1/', true]]) {
    const r = await listener(own(u)); console.log((!!(r && r.cancel)) === want ? 'OK  ' : 'FAIL', u, JSON.stringify(r));
  }
  const page = await listener({ tabId: 5, originUrl: 'https://site/', url: 'http://192.168.1.1/' }); console.log(page && page.cancel ? 'FAIL page blocked' : 'OK   page requests untouched');
})();
