// Kadri – Hintergrund der Erweiterung.
// Ersetzt, was im Userscript der Manager (Violentmonkey) erledigt hat:
//  1. Anfragen an andere Server (GM_xmlhttpRequest) – ohne die Sperre der Seite (CORS): Untertitel, Weiterleitungen,
//     die Helfer-App auf 127.0.0.1, Laden über den Browser.
//  2. Den Menüeintrag „Diagnose anzeigen“ (Tipp auf das Kadri-Symbol bei den Erweiterungen).
'use strict';
const api = globalThis.browser || globalThis.chrome;
// Kadris Sitzungsregeln (DNR) gelten nur für Kadris eigene Anfragen: kein Tab UND von dieser Erweiterung
// (Initiator moz-extension://<uuid>). Auch die Service Worker fremder Webseiten haben keinen Tab.
const OWN_HOST = new URL(api.runtime.getURL('')).hostname;

// ---------- Referer setzen (fetch darf das nicht – dafür eine kurze Regel, nur für genau diese Anfrage) ----------
let nextRule = 1000;
const esc = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  // Strict origin comparison includes scheme and effective port. Never alter the media URL.
  function mediaReferrer(url, page, automaticRedirects = false) {
    try {
      const source = new URL(page), target = new URL(url);
      if (!/^https?:$/.test(source.protocol) || !/^https?:$/.test(target.protocol) ||
          source.protocol === 'https:' && target.protocol === 'http:') return '';
      source.username = ''; source.password = ''; source.hash = '';
      // GM transports cannot portably recompute custom headers at every redirect.
      // HTTPS sources therefore send none; HTTP sources send at most their origin.
      if (automaticRedirects) return source.protocol === 'https:' ? '' : source.origin + '/';
      return source.origin === target.origin ? source.href : source.origin + '/';
    } catch (e) { return ''; }
  }
async function refererRule(url, ref) {
  ref = mediaReferrer(url, ref);
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
        condition: { regexFilter: '^' + esc(url) + '$', tabIds: [-1], initiatorDomains: [OWN_HOST] },
      }],
    });
    return id;
  } catch (e) { return 0; }
}
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
// Welche Adressen gehören zur selben Seite? Nach der offiziellen Public Suffix List (psl.js, vor diesem Skript geladen):
// www.bbc.co.uk und cdn.bbc.co.uk ja – angreifer.github.io und opfer.github.io, alice.eu.org und bob.eu.org nicht.
const baseDomain = (host) => pslBase(host);
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
// Firefox kann jede einzelne Anfrage über alle Weiterleitungen verfolgen (gleiche requestId). So gilt jede Ausnahme nur
// für die Anfrage, für die sie gedacht ist:
//  - Helfer-App: nur als ERSTE Adresse einer Anfrage (eine fremde Anfrage, die dorthin weiterleitet, wird gesperrt)
//  - Seite im eigenen Netz (Medienserver zu Hause): nur GENAU die angefragte Adresse als erste Adresse – gleichzeitige
//    fremde Anfragen, die dorthin weiterleiten, bleiben gesperrt; Weiterleitungen des Medienservers selbst ebenso
//  - Cookies/Authorization: nur an die Seite der ersten Adresse; ein Schritt zu einer anderen Seite verliert sie,
//    bevor er abgeschickt wird
// Die zusätzliche DNS-Prüfung (Name zeigt auf eine private Adresse?) VERRINGERT das Risiko von DNS-Rebinding nur: Sie ist
// eine eigene Abfrage – wechselt die Antwort zwischen Prüfung und Verbindung, merkt Kadri das nicht.
const allowedUrls = new Map();   // genaue Adresse → Zahl laufender Anfragen
const firstUrl = new Map();      // requestId → erste Adresse der Anfrage
const noHash = (u) => String(u).split('#')[0];
let netOk = false;
const netGuard = () => Promise.resolve(netOk);
function allowExact(u) { u = noHash(u); allowedUrls.set(u, (allowedUrls.get(u) || 0) + 1); return Promise.resolve(u); }
function dropExact(u) { const n = (allowedUrls.get(u) || 1) - 1; if (n > 0) allowedUrls.set(u, n); else allowedUrls.delete(u); }
function privateIp(ip) {
  ip = String(ip || '').toLowerCase();
  return privateHost(ip) || /^::ffff:/.test(ip);
}
if (api.webRequest && api.webRequest.onBeforeRequest && api.webRequest.onBeforeSendHeaders) {
  try {
    const own = (d) => d.tabId === -1 && String(d.originUrl || d.documentUrl || '').startsWith(api.runtime.getURL(''));
    const ALL = { urls: ['http://*/*', 'https://*/*'] };
    api.webRequest.onBeforeRequest.addListener((d) => {
      if (!own(d)) return {};
      if (!firstUrl.has(d.requestId)) { if (firstUrl.size > 2000) firstUrl.clear(); firstUrl.set(d.requestId, d.url); }
      const first = firstUrl.get(d.requestId) === d.url;
      let u;
      try { u = new URL(d.url); } catch (e) { return { cancel: true }; }
      if (u.origin === HELPER_ORIGIN) return first ? {} : { cancel: true };
      if (first && allowedUrls.has(noHash(d.url))) return {};
      if (privateHost(u.hostname)) return { cancel: true };
      if (!api.dns || !api.dns.resolve || /^[\d.]+$/.test(u.hostname) || u.hostname.includes(':')) return {};
      return api.dns.resolve(u.hostname).then((r) => ({ cancel: (r.addresses || []).some(privateIp) }), () => ({}));
    }, ALL, ['blocking']);
    api.webRequest.onBeforeSendHeaders.addListener((d) => {
      if (!own(d)) return {};
      let same = false;
      try { same = baseDomain(new URL(firstUrl.get(d.requestId) || '').hostname) === baseDomain(new URL(d.url).hostname); } catch (e) {}
      if (same) return {};
      return { requestHeaders: (d.requestHeaders || []).filter((h) => !/^(cookie|authorization|proxy-authorization)$/i.test(h.name)) };
    }, ALL, ['blocking', 'requestHeaders']);
    const forget = (d) => { firstUrl.delete(d.requestId); };
    api.webRequest.onCompleted.addListener(forget, ALL);
    api.webRequest.onErrorOccurred.addListener(forget, ALL);
    netOk = true;
  } catch (e) { netOk = false; }
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
  m.site = site ? baseDomain(site) : '';
  return '';
}

const fromB64 = (s) => { const bin = atob(s); const u8 = new Uint8Array(bin.length); for (let i = 0; i < bin.length; i++) u8[i] = bin.charCodeAt(i); return u8; };
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
      const helper = new URL(m.url).origin === HELPER_ORIGIN;
      // Schutz nicht aktiv (Listener ließ sich nicht setzen)? Dann nichts hinaus – außer an die Helfer-App, ohne Weiterleitung
      if (!(await netGuard()) && !helper) { post({ t: 'error', timeout: false, msg: 'nicht erlaubt: Schutzregeln fehlen' }); return; }
      let allowId = 0;
      if (!helper && privateHost(new URL(m.url).hostname)) allowId = await allowExact(m.url);   // (Prüfung oben: Seite liegt selbst dort)
      m.allowId = allowId;
      if (ref && /^https?:/i.test(ref)) { rule = await refererRule(m.url, ref); if (mediaReferrer(m.url, ref) && !rule) throw new Error('Referrer protection unavailable'); }
      if (m.timeout > 0) tm = setTimeout(() => { timedOut = true; ac.abort(); }, m.timeout);
      const res = await fetch(m.url, {
        method: m.method || 'GET', headers, body: m.dataB64 ? fromB64(m.dataB64) : m.data == null ? undefined : m.data,
        credentials: helper || m.anonymous ? 'omit' : 'include', signal: ac.signal, redirect: helper ? 'error' : 'follow', cache: 'no-store', referrerPolicy: 'no-referrer',
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
      if (m.allowId) dropExact(m.allowId);
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
