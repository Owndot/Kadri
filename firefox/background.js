// Kadri – Hintergrund der Erweiterung.
// Ersetzt, was im Userscript der Manager (Violentmonkey) erledigt hat:
//  1. Anfragen an andere Server (GM_xmlhttpRequest) – ohne die Sperre der Seite (CORS): Untertitel, Weiterleitungen,
//     die Helfer-App auf 127.0.0.1, Laden über den Browser.
//  2. Den Menüeintrag „Diagnose anzeigen“ (Tipp auf das Kadri-Symbol bei den Erweiterungen).
'use strict';
const api = globalThis.browser || globalThis.chrome;

// ---------- Referer setzen (fetch darf das nicht – dafür eine kurze Regel, nur für genau diese Anfrage) ----------
let nextRule = 1000;
const esc = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
async function refererRule(url, ref) {
  const dnr = api.declarativeNetRequest;
  if (!dnr || !dnr.updateSessionRules || !ref) return 0;
  const id = nextRule++;
  if (nextRule > 900000) nextRule = 1000;
  try {
    await dnr.updateSessionRules({
      removeRuleIds: [id],
      addRules: [{
        id, priority: 1,
        action: { type: 'modifyHeaders', requestHeaders: [{ header: 'referer', operation: 'set', value: ref }] },
        condition: { regexFilter: '^' + esc(url) + '$', tabIds: [-1] },
      }],
    });
    return id;
  } catch (e) { return 0; }
}
function dropAllow(host) { const n = (allowedHosts.get(host) || 1) - 1; if (n > 0) allowedHosts.set(host, n); else allowedHosts.delete(host); }
function dropRule(id) {
  if (!id) return;
  try { api.declarativeNetRequest.updateSessionRules({ removeRuleIds: [id] }); } catch (e) {}
}

// ---------- Schutz: welche Anfragen Kadri überhaupt stellt ----------
// Die Adressen kommen oft aus den Daten der Webseite. Eine böse Seite soll Kadri damit nichts tun lassen, was sie selbst
// nicht dürfte:
//  - nur http(s); keine Adressen im eigenen Netz (Router, NAS …) – außer der Helfer-App auf 127.0.0.1:47811
//  - nur GET/HEAD; POST nur an die Helfer-App
//  - Anmeldung (Cookies) nur an die Seite selbst (gleiche Domain wie das Fenster, aus dem die Anfrage kommt) –
//    Video-Server, Untertitel-Server usw. bekommen sie nicht
const HELPER_ORIGIN = 'http://127.0.0.1:47811';
// angreifer.github.io und opfer.github.io sind verschiedene Seiten: Adressen, unter denen viele FREMDE Betreiber eigene
// Seiten haben, zählen als eigene Endung (wie co.uk)
const SHARED_SUFFIX = ['github.io', 'gitlab.io', 'netlify.app', 'vercel.app', 'pages.dev', 'workers.dev', 'web.app', 'firebaseapp.com',
  'herokuapp.com', 'appspot.com', 'blogspot.com', 'azurewebsites.net', 'cloudfront.net', 's3.amazonaws.com', 'onrender.com', 'fly.dev',
  'glitch.me', 'repl.co', 'surge.sh', 'ngrok.io', 'ngrok-free.app', 'duckdns.org', 'myshopify.com', 'wixsite.com', 'wordpress.com',
  'tumblr.com', 'neocities.org', 'r2.dev', 'b-cdn.net', 'translate.goog', 'carrd.co', 'webflow.io', 'framer.app', 'notion.site'];
const baseDomain = (host) => {
  const h = String(host || '').toLowerCase().replace(/\.$/, '');
  if (/^[\d.]+$/.test(h) || h.indexOf(':') >= 0) return h;   // IP-Adresse: nur sie selbst
  const p = h.split('.');
  for (const s of SHARED_SUFFIX) if (h === s || h.endsWith('.' + s)) return p.slice(-(s.split('.').length + 1)).join('.');
  // co.uk, com.au, … (zweite Stufe kurz, Land zweistellig)
  return p.length > 2 && p[p.length - 1].length === 2 && p[p.length - 2].length <= 3 ? p.slice(-3).join('.') : p.slice(-2).join('.');
};
function privateHost(h) {
  h = String(h || '').toLowerCase().replace(/^\[|\]$/g, '');
  if (h === 'localhost' || h.endsWith('.localhost') || h.endsWith('.local') || h.endsWith('.internal') || h.endsWith('.lan') || h === '0.0.0.0') return true;
  if (h === '::1' || h === '::' || /^::ffff:/.test(h) || /^f[cd][0-9a-f]{2}:/.test(h) || /^fe80:/.test(h)) return true;   // (::ffff: = IPv4 in IPv6 verpackt)
  const m = /^(\d+)\.(\d+)\.(\d+)\.(\d+)$/.exec(h);
  if (!m) return false;
  const a = +m[1], b = +m[2];
  return a === 10 || a === 127 || a === 0 || (a === 169 && b === 254) || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168) || (a === 100 && b >= 64 && b <= 127);
}
// ---------- Schutz auf Netzwerk-Ebene: Kadris eigene Anfragen kommen nie ins eigene Netz ----------
// Die Prüfung oben sieht nur die erste Adresse. Leitet ein Server weiter (öffentliche Adresse → Router), hätte die
// Anfrage das Ziel schon erreicht, bevor Kadri es merkt. Darum wird JEDE Anfrage von Kadri selbst (auch nach jeder
// Weiterleitung) vor dem Absenden geprüft – in Firefox zusätzlich, wohin der Name wirklich zeigt (eine öffentliche
// Adresse, die auf ein Gerät zu Hause zeigt, fällt so auch auf). Ausnahmen: die Helfer-App, und für die Dauer einer
// Anfrage die Adresse einer Seite, die selbst im eigenen Netz liegt.
const allowedHosts = new Map();   // Adresse → Zahl laufender Anfragen
let netReady = Promise.resolve();
const netGuard = () => netReady;
function allowHost(host) { allowedHosts.set(host, (allowedHosts.get(host) || 0) + 1); return Promise.resolve(host); }
function privateIp(ip) {
  ip = String(ip || '').toLowerCase();
  return privateHost(ip) || /^::ffff:/.test(ip);
}
if (api.webRequest && api.webRequest.onBeforeRequest) {
  try {
    const own = (d) => d.tabId === -1 && String(d.originUrl || d.documentUrl || '').startsWith(api.runtime.getURL(''));
    api.webRequest.onBeforeRequest.addListener((d) => {
      if (!own(d)) return {};
      let u;
      try { u = new URL(d.url); } catch (e) { return { cancel: true }; }
      if (u.origin === HELPER_ORIGIN || allowedHosts.has(u.hostname)) return {};
      if (privateHost(u.hostname)) return { cancel: true };
      if (!api.dns || !api.dns.resolve || /^[\d.]+$/.test(u.hostname) || u.hostname.includes(':')) return {};
      return api.dns.resolve(u.hostname).then((r) => ({ cancel: (r.addresses || []).some(privateIp) }), () => ({}));
    }, { urls: ['http://*/*', 'https://*/*'] }, ['blocking']);
  } catch (e) {}
}
// → Grund (Text), wenn die Anfrage nicht erlaubt ist; sonst ''. Setzt o.anonymous, wenn die Seite fremd ist.
function guard(m, fromUrl) {
  let u;
  try { u = new URL(m.url); } catch (e) { return 'ungültige Adresse'; }
  if (u.protocol !== 'https:' && u.protocol !== 'http:') return 'nur http(s)';
  const helper = u.origin === HELPER_ORIGIN;
  let site = '';
  try { site = new URL(fromUrl).hostname; } catch (e) {}
  // (eigenes Netz nur, wenn die Seite selbst dort liegt – z. B. ein Medienserver zu Hause)
  if (!helper && privateHost(u.hostname) && u.hostname !== site) return 'Adresse im eigenen Netz';
  const meth = String(m.method || 'GET').toUpperCase();
  if (meth !== 'GET' && meth !== 'HEAD' && !helper) return 'nur GET';
  if (!helper && (!site || baseDomain(site) !== baseDomain(u.hostname))) m.anonymous = true;
  return '';
}

// Binärdaten als Base64 in Stücken (Nachrichten zwischen Hintergrund und Seite können in Chrome nur Text/JSON)
function b64(u8) {
  let s = '';
  for (let i = 0; i < u8.length; i += 0x8000) s += String.fromCharCode.apply(null, u8.subarray(i, i + 0x8000));
  return btoa(s);
}

// ---------- 1. Anfragen ----------
api.runtime.onConnect.addListener((port) => {
  if (port.name !== 'kadri-xhr') return;
  const ac = new AbortController();
  let rule = 0, gone = false, timedOut = false, tm = 0;
  const post = (m) => { if (gone) return; try { port.postMessage(m); } catch (e) { gone = true; } };
  port.onDisconnect.addListener(() => { gone = true; ac.abort(); dropRule(rule); clearTimeout(tm); });
  port.onMessage.addListener(async (m) => {
    if (!m) return;
    if (m.t === 'abort') { ac.abort(); return; }
    if (m.t !== 'req') return;
    const no = guard(m, (port.sender && (port.sender.url || (port.sender.tab && port.sender.tab.url))) || '');
    if (no) { post({ t: 'error', timeout: false, msg: 'nicht erlaubt: ' + no }); return; }
    const headers = Object.assign({}, m.headers || {});
    let ref = '';
    Object.keys(headers).forEach((k) => { if (k.toLowerCase() === 'referer') { ref = String(headers[k] || ''); delete headers[k]; } });
    try {
      await netGuard();
      let allowId = 0;
      try { const h = new URL(m.url).hostname; if (privateHost(h)) allowId = await allowHost(h); } catch (e) {}   // (Prüfung oben hat es schon erlaubt: Seite liegt selbst dort)
      m.allowId = allowId;
      if (ref && /^https?:/i.test(ref)) rule = await refererRule(m.url, ref);
      if (m.timeout > 0) tm = setTimeout(() => { timedOut = true; ac.abort(); }, m.timeout);
      const res = await fetch(m.url, {
        method: m.method || 'GET', headers, body: m.data == null ? undefined : m.data,
        credentials: m.anonymous ? 'omit' : 'include', signal: ac.signal, redirect: 'follow', cache: 'no-store',
      });
      // Weiterleitung ins eigene Netz (öffentliche Adresse → Router …)? Antwort nicht herausgeben
      try { const fu = new URL(res.url || m.url); if (fu.origin !== HELPER_ORIGIN && privateHost(fu.hostname) && fu.hostname !== new URL(m.url).hostname) { try { ac.abort(); } catch (e) {} post({ t: 'error', timeout: false, msg: 'nicht erlaubt: Weiterleitung ins eigene Netz' }); return; } } catch (e) {}
      const hdr = [];
      res.headers.forEach((v, k) => hdr.push(k + ': ' + v));
      const head = { status: res.status, statusText: res.statusText, finalUrl: res.url || m.url, headers: hdr.join('\r\n'), type: res.headers.get('content-type') || '' };
      post(Object.assign({ t: 'head' }, head));
      const rt = m.responseType || '';
      if (rt === 'arraybuffer' || rt === 'blob') {
        const total = +(res.headers.get('content-length') || 0);
        let loaded = 0, lastProg = 0;
        if (res.body && res.body.getReader) {
          const rd = res.body.getReader();
          for (;;) {
            const { done, value } = await rd.read();
            if (done) break;
            loaded += value.length;
            // in Stücken von höchstens 512 KB weiterreichen
            for (let i = 0; i < value.length; i += 524288) post({ t: 'chunk', b: b64(value.subarray(i, i + 524288)) });
            const now = Date.now();
            if (now - lastProg > 250) { lastProg = now; post({ t: 'prog', loaded, total }); }
            if (gone) return;
          }
        } else {
          const u8 = new Uint8Array(await res.arrayBuffer());
          loaded = u8.length;
          for (let i = 0; i < u8.length; i += 524288) post({ t: 'chunk', b: b64(u8.subarray(i, i + 524288)) });
        }
        post({ t: 'prog', loaded, total: total || loaded });
        post(Object.assign({ t: 'done' }, head));
      } else {
        const text = await res.text();
        post(Object.assign({ t: 'done', text }, head));
      }
    } catch (e) {
      post({ t: 'error', timeout: timedOut, msg: String((e && e.message) || e) });
    } finally {
      clearTimeout(tm);
      dropRule(rule); rule = 0;
      if (m.allowId) dropAllow(m.allowId);
    }
  });
});

// ---------- 3. Streams erkennen, die die Seite lädt – auch aus Hintergrund-Skripten (Worker) und ohne .m3u8 im Namen ----------
// Der Server sagt mit „Content-Type“, was er liefert. Nur Stream-Listen (HLS/DASH) werden gemeldet – keine Stücke,
// keine Bilder. Die Seite bekommt davon nichts mit; die Adresse geht nur an Kadri im selben Tab/Fenster.
const PL_CT = /mpegurl|dash\+xml/i;
const seenPl = new Map();   // Tab → Set(Adressen)
if (api.webRequest && api.webRequest.onHeadersReceived) {
  try {
    api.webRequest.onHeadersReceived.addListener((d) => {
      if (d.tabId < 0 || d.statusCode >= 400) return;
      const h = (d.responseHeaders || []).find((x) => x.name && x.name.toLowerCase() === 'content-type');
      const ct = h ? String(h.value || '') : '';
      if (!PL_CT.test(ct)) return;
      let set = seenPl.get(d.tabId);
      if (!set) { set = new Set(); seenPl.set(d.tabId, set); }
      if (set.has(d.url)) return;
      set.add(d.url);
      if (set.size > 300) set.delete(set.values().next().value);
      const k = /dash/i.test(ct) ? 'mpd' : 'm3u8';
      try {
        const p = api.tabs.sendMessage(d.tabId, { t: 'kadri-src', u: d.url, k }, { frameId: d.frameId >= 0 ? d.frameId : 0 });
        if (p && p.catch) p.catch(() => {});
      } catch (e) {}
    }, { urls: ['<all_urls>'], types: ['xmlhttprequest', 'media', 'other'] }, ['responseHeaders']);
  } catch (e) {}
  if (api.tabs && api.tabs.onRemoved) api.tabs.onRemoved.addListener((id) => seenPl.delete(id));
}

// ---------- 2. Menü: Tipp auf das Kadri-Symbol = Diagnose der Seite ----------
const action = api.action || api.browserAction;
if (action && action.onClicked) {
  action.onClicked.addListener((tab) => {
    if (!tab || tab.id == null) return;
    try {
      const p = api.tabs.sendMessage(tab.id, { t: 'kadri-menu' }, { frameId: 0 });
      if (p && p.catch) p.catch(() => {});
    } catch (e) {}
  });
}
