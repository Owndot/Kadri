// Kadri – Hintergrund der Erweiterung.
// Ersetzt, was im Userscript der Manager (Violentmonkey) erledigt hat:
//  1. Anfragen an andere Server (GM_xmlhttpRequest) – ohne die Sperre der Seite (CORS): Untertitel, Weiterleitungen,
//     die Helfer-App auf 127.0.0.1, Laden über den Browser.
//  2. Den Menüeintrag „Diagnose anzeigen“ (Tipp auf das Kadri-Symbol bei den Erweiterungen).
//  3. hls.js und Kadri in eingebetteten Fenstern erst bei Bedarf nachladen.
'use strict';
importScripts('psl.js');   // pslBase(): Public Suffix List (welche Adressen zur selben Seite gehören)
const api = globalThis.browser || globalThis.chrome;
// Welche Anfragen Kadris Sitzungsregeln (DNR) betreffen: nur Kadris eigene. „Kein Tab“ (tabIds -1) allein genügt nicht –
// auch die Service Worker fremder Webseiten haben keinen Tab; ohne die Herkunft (Initiator = diese Erweiterung) sperrte
// Kadri deren Anfragen ins eigene Netz und entfernte ihre Cookies. Anfragen der Erweiterung (Hintergrund, Popup,
// Optionen) tragen ihre Kennung als Initiator, auch nach Weiterleitungen; Anfragen aus Tabs betreffen die Regeln nie.
const OWN = () => ({ tabIds: [-1], initiatorDomains: [api.runtime.id] });

// Only the redirect/header phase owns global DNR exceptions. Bodies remain parallel.
// No other non-helper fetch may start until exception removal has completed.
const HEADER_TIMEOUT_MS = 15000, QUEUE_TIMEOUT_MS = 60000;
function createHeaderGate(limit = 128) {
  let busy = false;
  const queue = [];
  const pump = () => {
    if (busy || !queue.length) return;
    // FIFO within each class; an aged normal request cannot starve.
    const urgent = queue.findIndex((q) => q.priority);
    const index = urgent >= 0 && Date.now() - queue[0].queuedAt < 5000 ? urgent : 0;
    const item = queue.splice(index, 1)[0];
    item.signal.removeEventListener('abort', item.cancel);
    if (item.signal.aborted) { item.reject(new Error('abgebrochen')); pump(); return; }
    busy = true;
    let released = false;
    item.resolve((safe = true) => {
      if (released) return;
      released = true; busy = false;
      // Ownership may pass, permission may not: the next owner must restore
      // and verify the baseline in netGuard before it can issue any fetch.
      if (!safe) netReady = null;
      pump();
    });
  };
  return {
    acquire(signal, priority = false) {
      if (signal.aborted) return Promise.reject(new Error('abgebrochen'));
      if (queue.length >= limit) return Promise.reject(new Error('zu viele offene Anfragen'));
      return new Promise((resolve, reject) => {
        const item = { signal, resolve, reject, priority, queuedAt: Date.now(), cancel: null };
        item.cancel = () => {
          const i = queue.indexOf(item);
          if (i >= 0) queue.splice(i, 1);
          signal.removeEventListener('abort', item.cancel);
          reject(new Error('abgebrochen'));
        };
        signal.addEventListener('abort', item.cancel, { once: true });
        queue.push(item); pump();
      });
    },
  };
}
const headerGate = createHeaderGate();


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
        condition: Object.assign({ regexFilter: '^' + esc(url) + '$' }, OWN()),
      }],
    });
    return id;
  } catch (e) { return 0; }
}

// ---------- Schutz: welche Anfragen Kadri überhaupt stellt ----------
// Die Adressen kommen oft aus den Daten der Webseite. Eine böse Seite soll Kadri damit nichts tun lassen, was sie selbst
// nicht dürfte:
//  - nur http(s); keine Adressen im eigenen Netz (Router, NAS …) – außer der Helfer-App auf 127.0.0.1:47811
//  - nur GET/HEAD; POST nur an die Helfer-App
//  - Anmeldung (Cookies) nur an die Seite selbst (gleiche Domain wie das Fenster, aus dem die Anfrage kommt) –
//    Video-Server, Untertitel-Server usw. bekommen sie nicht
const HELPER_ORIGIN = 'http://127.0.0.1:47811';
// Welche Adressen gehören zur selben Seite? Nach der offiziellen Public Suffix List (vendor/psl.js): www.bbc.co.uk und
// cdn.bbc.co.uk ja – angreifer.github.io und opfer.github.io, alice.eu.org und bob.eu.org nicht. IP-Adressen nur sich selbst.
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
// Anfrage das Ziel schon erreicht, bevor Kadri es merkt. Darum eine Regel des Browsers: Kadris eigene Anfragen (OWN:
// ohne Tab UND von dieser Erweiterung) dürfen keine Adresse im eigenen Netz erreichen – auch nicht nach einer
// Weiterleitung (der Initiator bleibt über alle Schritte derselbe). Anfragen von Webseiten, auch die ihrer Service
// Worker, bleiben unberührt.
// Ausnahmen: die Helfer-App (genau 127.0.0.1:47811 – ihre Anfragen folgen keiner Weiterleitung), und für die Dauer einer
// Anfrage GENAU deren Adresse, wenn die Seite selbst im eigenen Netz liegt (Medienserver zu Hause). Eine Freigabe für
// den ganzen Server oder Port gälte auch für gleichzeitige fremde Anfragen, die eine böse Seite dorthin umleitet –
// Chrome kann eine Regel nicht an eine einzelne Anfrage binden. Darum nur die genaue Adresse: Leitet der Medienserver
// selbst weiter, wird das (als unerwartet) gesperrt.
// (Chrome erlaubt pro Regel nur einfache Muster – darum je Adressbereich eine Regel)
const UI = '^https?://(?:[^/@]+@)?';
const O = '[0-9]{1,3}', E = '(?:[:/?#]|$)';
const PRIVATE_RES = ['127\\.' + O + '\\.' + O + '\\.' + O + E, '10\\.' + O + '\\.' + O + '\\.' + O + E, '192\\.168\\.' + O + '\\.' + O + E,
  '172\\.(?:1[6-9]|2[0-9]|3[01])\\.' + O + '\\.' + O + E, '169\\.254\\.' + O + '\\.' + O + E, '0\\.' + O + '\\.' + O + '\\.' + O + E,
  '100\\.(?:6[4-9]|[7-9][0-9]|1[01][0-9]|12[0-7])\\.' + O + '\\.' + O + E, '\\[(?:::1|::|::ffff:[^\\]]*|f[cd][0-9a-f]{2}:[^\\]]*|fe80:[^\\]]*)\\]' + E];
const NET_RULES = [{ id: 50, priority: 10, action: { type: 'allow' }, condition: Object.assign({ regexFilter: '^http://127\\.0\\.0\\.1:47811/' }, OWN()) }]
  .concat(PRIVATE_RES.map((re, i) => ({ id: 51 + i, priority: 5, action: { type: 'block' }, condition: Object.assign({ regexFilter: UI + re }, OWN()) })))
  .concat([{ id: 70, priority: 5, action: { type: 'block' }, condition: Object.assign({ requestDomains: ['localhost', 'local', 'internal', 'lan'] }, OWN()) }]);
// Anmeldung nie an eine fremde Seite weiterreichen: Cookies und Authorization nehmen Kadris Anfragen nur zu Seiten mit,
// für die gerade eine angemeldete Anfrage läuft (deren Seite = die Seite des Fensters). Leitet ein Server dorthin weiter,
// wo man nicht angemeldet sein soll, entfernt der Browser die Header VOR dem Absenden dieses Schritts (Regel 80).
// Nur für Kadris eigene Anfragen (OWN) – Cookies der Service Worker fremder Webseiten bleiben unberührt.
const STRIP = 80, credSites = new Map();   // Seite → Zahl laufender angemeldeter Anfragen
const stripRule = () => {
  const cond = OWN(), ex = Array.from(credSites.keys());
  if (ex.length) cond.excludedRequestDomains = ex;
  return { id: STRIP, priority: 30, condition: cond, action: { type: 'modifyHeaders', requestHeaders: ['cookie', 'authorization', 'proxy-authorization'].map((header) => ({ header, operation: 'remove' })) } };
};
let stripChain = Promise.resolve();
const stripUpdate = () => (stripChain = stripChain.catch(() => {}).then(() => api.declarativeNetRequest.updateSessionRules({ removeRuleIds: [STRIP], addRules: [stripRule()] })));
// Schutzregeln setzen und prüfen, ob sie wirklich stehen. Klappt das nicht, gehen KEINE Anfragen hinaus (außer an
// die Helfer-App, und die ohne Weiterleitung) – lieber kein Untertitel als ein ungeschützter Zugriff.
let netReady = null;
function netGuard() {
  const dnr = api.declarativeNetRequest;
  if (!dnr || !dnr.updateSessionRules || !dnr.getSessionRules) return Promise.resolve(false);
  if (!netReady) {
    credSites.clear();
    const want = NET_RULES.map((r) => r.id).concat(STRIP);
    // Session rules survive service-worker restarts; remove orphaned temporary grants first.
    netReady = dnr.getSessionRules()
      .then((old) => dnr.updateSessionRules({
        removeRuleIds: Array.from(new Set(want.concat(old.filter((r) => r.id >= 1000 && r.id <= 900000).map((r) => r.id)))),
        addRules: NET_RULES.concat(stripRule()),
      }))
      .then(() => dnr.getSessionRules())
      .then((have) => {
        const canonical = (v) => JSON.stringify(v, function(k, x) {
          return x && typeof x === 'object' && !Array.isArray(x)
            ? Object.keys(x).sort().reduce((o, key) => { o[key] = x[key]; return o; }, {}) : x;
        });
        return !have.some((r) => r.id >= 1000 && r.id <= 900000) &&
          NET_RULES.concat(stripRule()).every((r) => have.some((h) => canonical(h) === canonical(r)));
      })
      .catch(() => false)
      .then((ok) => { if (!ok) netReady = null; return ok; });   // nächstes Mal neu versuchen
  }
  return netReady;
}
netGuard();
const noHash = (u) => String(u).split('#')[0];
// Seite liegt selbst im eigenen Netz (Medienserver zu Hause): GENAU diese Adresse für die Dauer der Anfrage erlauben
async function allowExact(u) {
  const dnr = api.declarativeNetRequest;
  const id = nextRule++;
  if (nextRule > 900000) nextRule = 1000;
  try {
    await dnr.updateSessionRules({ removeRuleIds: [id], addRules: [{ id, priority: 20, action: { type: 'allow' },
      condition: Object.assign({ regexFilter: '^' + esc(noHash(u)) + '$' }, OWN()) }] });
    return id;
  } catch (e) { return 0; }
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
  let rule = 0, gone = false, timedOut = false, tm = 0, phaseTimer = 0, started = false;
  const post = (m) => { if (gone) return; try { port.postMessage(m); } catch (e) { gone = true; } };
  port.onDisconnect.addListener(() => { gone = true; ac.abort(); clearTimeout(tm); clearTimeout(phaseTimer); });
  port.onMessage.addListener(async (m) => {
    if (!m) return;
    if (m.t === 'abort') { ac.abort(); return; }
    if (m.t !== 'req' || started) return;
    started = true;
    const no = guard(m, (port.sender && (port.sender.url || (port.sender.tab && port.sender.tab.url))) || '');
    if (no) { post({ t: 'error', timeout: false, msg: 'nicht erlaubt: ' + no }); return; }
    const headers = Object.assign({}, m.headers || {});
    let ref = '';
    Object.keys(headers).forEach((k) => { if (k.toLowerCase() === 'referer') { ref = String(headers[k] || ''); delete headers[k]; } });
    let release = null, allowId = 0, headersChanged = false;
    const resetHeaders = async () => {
      if (!release) return;
      const unlock = release; release = null;
      try {
        if (!headersChanged) { unlock(true); return; }
        const removeRuleIds = [rule, allowId].filter(Boolean);
        if (removeRuleIds.length) await api.declarativeNetRequest.updateSessionRules({ removeRuleIds });
        rule = 0; allowId = 0;
        credSites.clear();
        await stripUpdate();
        unlock(true);
      } catch (e) { credSites.clear(); netReady = null; ac.abort(); unlock(false); throw e; }
    };
    try {
      const helper = new URL(m.url).origin === HELPER_ORIGIN;
      if (m.timeout > 0) tm = setTimeout(() => { timedOut = true; ac.abort(); }, m.timeout);
      if (!helper) {
        phaseTimer = setTimeout(() => { timedOut = true; ac.abort(); }, QUEUE_TIMEOUT_MS);
        try { release = await headerGate.acquire(ac.signal, m.purpose === 'player-resolve'); }
        finally { clearTimeout(phaseTimer); }
        phaseTimer = setTimeout(() => { timedOut = true; ac.abort(); }, HEADER_TIMEOUT_MS);
      }
      if (ac.signal.aborted) throw new Error('abgebrochen');
      if (!helper && !(await netGuard())) { post({ t: 'error', timeout: false, msg: 'nicht erlaubt: Schutzregeln fehlen' }); return; }
      if (!helper) headersChanged = true; // even a rejected mutation is treated as uncertain
      // (Prüfung oben hat es schon erlaubt: Seite liegt selbst dort) – nur genau diese Adresse, ohne Weiterleitung
      try { if (!helper && privateHost(new URL(m.url).hostname)) { allowId = await allowExact(m.url); if (!allowId) throw new Error('Freigabe'); } } catch (e) { post({ t: 'error', timeout: false, msg: 'nicht erlaubt: Freigabe fehlt' }); return; }
      if (!helper && !m.anonymous && m.site) { credSites.set(m.site, 1); await stripUpdate(); }
      if (!helper && ref && /^https?:/i.test(ref)) { rule = await refererRule(m.url, ref); if (mediaReferrer(m.url, ref) && !rule) throw new Error('Referrer protection unavailable'); }
      const res = await fetch(m.url, {
        method: m.method || 'GET', headers, body: m.dataB64 ? fromB64(m.dataB64) : m.data == null ? undefined : m.data,
        credentials: helper || m.anonymous ? 'omit' : 'include', signal: ac.signal, redirect: helper ? 'error' : 'follow', cache: 'no-store', referrerPolicy: 'no-referrer',
      });
      clearTimeout(phaseTimer); // body lifetime is governed only by the caller's timeout
      await resetHeaders();   // fetch resolved at final headers, before consuming the response body
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
      clearTimeout(tm); clearTimeout(phaseTimer);
      try { await resetHeaders(); } catch (e) {
        post({ t: 'error', timeout: false, msg: 'Schutzregeln konnten nicht zurückgesetzt werden' });
      }
    }
  });
});

// ---------- 3. Nachladen bei Bedarf (spart Speicher und Akku auf jeder Seite) ----------
//  - hls.js (620 KB) erst, wenn ein Stream abgespielt wird
//  - Kadri selbst in eingebetteten Fenstern erst, wenn dort ein Video auftaucht (sub.js meldet das)
// Streams erkennt in Chrome/Vivaldi page.js am „Content-Type“ der Antworten – der Hintergrund muss dafür nicht bei
// jeder Anfrage aller Seiten aufwachen.
// (Ob schon geladen, weiß nur das Fenster selbst – es fragt nur, wenn es noch fehlt. Nach Neuladen der Seite fehlt es wieder.)
function inject(sender, files) {
  const tabId = sender.tab && sender.tab.id, frameId = sender.frameId || 0;
  if (tabId == null || tabId < 0) return Promise.reject(new Error('kein Tab'));
  return api.scripting.executeScript({ target: { tabId, frameIds: [frameId] }, files });
}
api.runtime.onMessage.addListener((m, sender, reply) => {
  if (!m || !sender || sender.id !== api.runtime.id) return;
  if (m.t === 'kadri-hls') { inject(sender, ['hls.min.js']).then(() => reply({ ok: true }), (e) => reply({ ok: false, e: String(e && e.message || e) })); return true; }
  if (m.t === 'kadri-sub' && sender.frameId > 0) { inject(sender, ['content.js']).then(() => reply({ ok: true }), () => reply({ ok: false })); return true; }
});

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
