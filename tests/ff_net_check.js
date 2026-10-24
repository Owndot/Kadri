// Firefox: Schutz auf Netzwerk-Ebene (webRequest, jede Weiterleitung, DNS) – mit nachgebauter Browser-Schnittstelle geprüft.
// Jede Anfrage hat eine requestId, die über alle Weiterleitungen gleich bleibt: Ausnahmen gelten nur für die erste Adresse
// der Anfrage, für die sie gedacht sind; Cookies/Authorization nur innerhalb der Seite der ersten Adresse.
const fs = require('fs'), path = require('path'), vm = require('vm');
const file = process.argv[2];
const src = fs.readFileSync(file, 'utf8');
const psl = fs.readFileSync(path.join(path.dirname(file), '..', 'vendor', 'psl.js'), 'utf8');
function load(withWebRequest) {
  const L = {};
  const on = (k) => ({ addListener: (f) => { L[k] = f; } });
  let onConnect = null;
  const api = {
    runtime: { getURL: (p) => 'moz-extension://abc/' + p, onConnect: { addListener: (f) => { onConnect = f; } }, onMessage: { addListener() {} }, id: 'x' },
    webRequest: withWebRequest ? { onBeforeRequest: on('req'), onBeforeSendHeaders: on('hdr'), onCompleted: on('done'), onErrorOccurred: on('err'), onHeadersReceived: { addListener() {} } }
      : { onHeadersReceived: { addListener() {} } },
    dns: { resolve: async (h) => ({ addresses: h === 'rebind.example' ? ['192.168.1.5'] : ['93.184.216.34'] }) },
    tabs: { onRemoved: { addListener() {} } }, declarativeNetRequest: {}, contextMenus: { create() {}, onClicked: { addListener() {} } }, menus: null,
    storage: { local: { get: async () => ({}), set: async () => {} } }, action: null, browserAction: { onClicked: { addListener() {} } },
  };
  const fetched = [];
  const ctx = { browser: api, chrome: api, console, URL, AbortController, setTimeout, clearTimeout, btoa, atob, TextEncoder,
    fetch: async (u, o) => { fetched.push(u); return { status: 200, statusText: 'OK', url: u, headers: new Map(), text: async () => 'ok' }; } };
  ctx.globalThis = ctx;
  vm.createContext(ctx);
  vm.runInContext(psl, ctx); vm.runInContext(src, ctx);
  const ask = (from, m) => new Promise((res) => {
    const msgs = [];
    const port = { name: 'kadri-xhr', sender: { url: from }, postMessage: (x) => { msgs.push(x); if (x.t === 'done' || x.t === 'error') res(msgs); },
      onDisconnect: { addListener() {} }, onMessage: { addListener: (f) => { port._f = f; } } };
    onConnect(port); port._f(Object.assign({ t: 'req', method: 'GET', headers: {} }, m));
    setTimeout(() => res(msgs), 300);
  });
  return { L, ask, fetched, ctx };
}
const say = (ok, name, info) => console.log((ok ? 'OK   ' : 'FAIL ') + name + (ok ? '' : '  – ' + JSON.stringify(info)));
const own = (requestId, url) => ({ requestId, tabId: -1, originUrl: 'moz-extension://abc/_generated_background_page.html', url });
const H = (names) => names.map((name) => ({ name, value: 'x' }));
(async () => {
  const { L, ask, ctx } = load(true);
  let id = 1;
  // einzelne Anfragen (jeweils erste Adresse)
  for (const [u, want] of [['https://example.com/a.vtt', false], ['http://192.168.1.1/', true], ['http://127.0.0.1:47811/x', false], ['https://rebind.example/x', true], ['http://user@10.0.0.1/', true]]) {
    const r = await L.req(own(id++, u)); say((!!(r && r.cancel)) === want, (want ? 'gesperrt: ' : 'erlaubt: ') + u, r);
  }
  const page = await L.req({ requestId: id++, tabId: 5, originUrl: 'https://site/', url: 'http://192.168.1.1/' });
  say(!(page && page.cancel), 'Anfragen der Seiten selbst unberührt', page);
  // Weiterleitung einer öffentlichen Anfrage zur Helfer-App: gesperrt (Ausnahme nur als erste Adresse)
  let rid = id++;
  await L.req(own(rid, 'https://evil.example/r'));
  let r = await L.req(own(rid, 'http://127.0.0.1:47811/download?u=x'));
  say(r && r.cancel, 'Weiterleitung zur Helfer-App: gesperrt', r);
  // Medienserver: genau seine Adresse ist während der Anfrage frei – aber nur für die Anfrage, die dort BEGINNT
  ctx.allowExact('http://192.168.0.5:8096/Videos/1');
  r = await L.req(own(id++, 'http://192.168.0.5:8096/Videos/1'));
  say(!(r && r.cancel), 'Medienserver: die angefragte Adresse ist erreichbar', r);
  rid = id++;
  await L.req(own(rid, 'https://evil.example/r2'));
  r = await L.req(own(rid, 'http://192.168.0.5:8096/Videos/1'));
  say(r && r.cancel, 'gleichzeitige fremde Anfrage, die zur selben Adresse weiterleitet: gesperrt', r);
  r = await L.req(own(id++, 'http://192.168.0.5:8096/admin'));
  say(r && r.cancel, 'andere Adresse desselben Servers: gesperrt', r);
  rid = id++;
  await L.req(own(rid, 'http://192.168.0.5:8096/Videos/1'));
  r = await L.req(own(rid, 'http://192.168.0.5:8096/Videos/2'));
  say(r && r.cancel, 'Weiterleitung des Medienservers selbst: gesperrt (unerwartet)', r);
  ctx.dropExact('http://192.168.0.5:8096/Videos/1');
  r = await L.req(own(id++, 'http://192.168.0.5:8096/Videos/1'));
  say(r && r.cancel, 'nach der Anfrage: wieder gesperrt', r);
  // Cookies/Authorization: bleiben innerhalb der Seite, fallen beim Schritt zu einer anderen Seite weg (vor dem Absenden)
  rid = id++;
  await L.req(own(rid, 'https://www.site.example/a'));
  let h = L.hdr(Object.assign(own(rid, 'https://www.site.example/a'), { requestHeaders: H(['Cookie', 'Authorization', 'Range']) }));
  say(!h.requestHeaders, 'erste Adresse: Cookie und Authorization bleiben', h);
  h = L.hdr(Object.assign(own(rid, 'https://cdn.site.example/b'), { requestHeaders: H(['Cookie', 'Authorization', 'Range']) }));
  say(!h.requestHeaders, 'Weiterleitung innerhalb der Seite (cdn.): bleiben', h);
  h = L.hdr(Object.assign(own(rid, 'https://other.example/c'), { requestHeaders: H(['Cookie', 'Authorization', 'Proxy-Authorization', 'Range']) }));
  say(h.requestHeaders && h.requestHeaders.map((x) => x.name).join() === 'Range', 'Weiterleitung zu einer anderen Seite: Cookie/Authorization entfernt, Rest bleibt', h);
  rid = id++;
  await L.req(own(rid, 'https://alice.eu.org/a'));
  h = L.hdr(Object.assign(own(rid, 'https://bob.eu.org/c'), { requestHeaders: H(['Cookie']) }));
  say(h.requestHeaders && h.requestHeaders.length === 0, 'eu.org: alice → bob gilt als andere Seite', h);
  L.done({ requestId: rid });
  // ohne webRequest (Schutz nicht aktiv): keine Anfragen hinaus, außer an die Helfer-App
  const off = load(false);
  let msgs = await off.ask('https://www.example.com/', { url: 'https://www.example.com/a.vtt' });
  say(!off.fetched.length && msgs.some((x) => x.t === 'error' && /Schutzregeln/.test(x.msg)), 'Schutz nicht aktiv: Anfrage wird nicht gestellt', msgs);
  msgs = await off.ask('https://www.example.com/', { url: 'http://127.0.0.1:47811/version' });
  say(off.fetched.length === 1, '… Helfer-App weiter erreichbar', msgs);
})();
