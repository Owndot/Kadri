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
function dropRule(id) {
  if (!id) return;
  try { api.declarativeNetRequest.updateSessionRules({ removeRuleIds: [id] }); } catch (e) {}
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
    const headers = Object.assign({}, m.headers || {});
    let ref = '';
    Object.keys(headers).forEach((k) => { if (k.toLowerCase() === 'referer') { ref = String(headers[k] || ''); delete headers[k]; } });
    try {
      if (ref && /^https?:/i.test(ref)) rule = await refererRule(m.url, ref);
      if (m.timeout > 0) tm = setTimeout(() => { timedOut = true; ac.abort(); }, m.timeout);
      const res = await fetch(m.url, {
        method: m.method || 'GET', headers, body: m.data == null ? undefined : m.data,
        credentials: m.anonymous ? 'omit' : 'include', signal: ac.signal, redirect: 'follow', cache: 'no-store',
      });
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
    }
  });
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
