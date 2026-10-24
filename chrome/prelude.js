// Kadri – Inhaltsskript (wird um das eigentliche Skript aus src/ gelegt, siehe tools/build.js).
// Stellt dem Skript dieselben Werkzeuge bereit wie ein Userscript-Manager (GM_…), aber mit Mitteln der Erweiterung:
//   GM_xmlhttpRequest → Anfrage im Hintergrund (background.js), Antwort kommt zurück
//   GM_getValue/GM_setValue → Speicher der Erweiterung (vor dem Start einmal geladen, danach sofort lesbar)
//   GM_registerMenuCommand → Tipp auf das Kadri-Symbol bei den Erweiterungen
(function () {
  'use strict';
  const api = globalThis.browser || globalThis.chrome;
  if (!api || !api.runtime || !api.runtime.id) return;

  function start(cache) {
    // ---------- Speicher ----------
    const GM_getValue = (k, d) => (Object.prototype.hasOwnProperty.call(cache, 'gm:' + k) ? cache['gm:' + k] : d);
    const GM_setValue = (k, v) => {
      cache['gm:' + k] = v;
      try { const p = api.storage.local.set({ ['gm:' + k]: v }); if (p && p.catch) p.catch(() => {}); } catch (e) {}
    };
    // ---------- Anfragen ----------
    // Binärdaten (ArrayBuffer/Uint8Array) als Base64 schicken – Nachrichten an den Hintergrund können nur Text/JSON
    // (vorher wurde daraus der Text „[object ArrayBuffer]“ – „Über den Browser laden“ kam beim Helfer kaputt an)
    const toB64 = (u8) => { let s = ''; for (let i = 0; i < u8.length; i += 0x8000) s += String.fromCharCode.apply(null, u8.subarray(i, i + 0x8000)); return btoa(s); };
    const binOf = (d) => (d instanceof ArrayBuffer ? new Uint8Array(d) : ArrayBuffer.isView(d) ? new Uint8Array(d.buffer, d.byteOffset, d.byteLength) : null);
    const fromB64 = (s) => { const bin = atob(s); const u8 = new Uint8Array(bin.length); for (let i = 0; i < bin.length; i++) u8[i] = bin.charCodeAt(i); return u8; };
    function GM_xmlhttpRequest(o) {
      o = o || {};
      let port = null, done = false, aborted = false;
      const chunks = [];
      let size = 0;
      const call = (fn, arg) => { try { if (typeof fn === 'function') fn(arg); } catch (e) {} };
      const fail = (kind, msg) => {
        if (done) return;
        done = true;
        const r = { status: 0, readyState: 4, finalUrl: o.url, responseText: '', response: null, responseHeaders: '', error: msg || '' };
        call(kind === 'timeout' ? (o.ontimeout || o.onerror) : o.onerror, r);
        try { port && port.disconnect(); } catch (e) {}
      };
      try { port = api.runtime.connect({ name: 'kadri-xhr' }); } catch (e) { setTimeout(() => fail('error', 'keine Verbindung'), 0); return { abort() {} }; }
      port.onMessage.addListener((m) => {
        if (!m || done) return;
        if (m.t === 'head') {
          call(o.onreadystatechange, { readyState: 2, status: m.status, statusText: m.statusText, finalUrl: m.finalUrl, responseHeaders: m.headers });
        } else if (m.t === 'prog') {
          call(o.onprogress, { loaded: m.loaded, total: m.total, lengthComputable: m.total > 0 });
        } else if (m.t === 'chunk') {
          const u8 = fromB64(m.b); chunks.push(u8); size += u8.length;
        } else if (m.t === 'done') {
          done = true;
          const r = { status: m.status, statusText: m.statusText, readyState: 4, finalUrl: m.finalUrl, responseHeaders: m.headers };
          const rt = o.responseType || '';
          if (rt === 'blob') {
            r.response = new Blob(chunks, { type: m.type || '' });   // direkt aus den Stücken: keine zweite Kopie im Speicher
            chunks.length = 0;
            r.responseText = '';
          } else if (rt === 'arraybuffer') {
            const all = new Uint8Array(size);
            let at = 0;
            chunks.forEach((c) => { all.set(c, at); at += c.length; });
            chunks.length = 0;
            r.response = all.buffer;
            r.responseText = '';
          } else {
            r.responseText = m.text || '';
            if (rt === 'json') { try { r.response = JSON.parse(r.responseText); } catch (e) { r.response = null; } }
            else r.response = r.responseText;
          }
          call(o.onreadystatechange, r);
          call(o.onload, r);
          call(o.onloadend, r);
          try { port.disconnect(); } catch (e) {}
        } else if (m.t === 'error') {
          fail(m.timeout ? 'timeout' : 'error', m.msg);
        }
      });
      port.onDisconnect.addListener(() => { if (!done && !aborted) fail('error', 'getrennt'); });
      try {
        const bin = o.data == null ? null : binOf(o.data);
        port.postMessage({ t: 'req', method: o.method || 'GET', url: String(o.url || ''), headers: o.headers || {},
          data: o.data == null || bin ? null : String(o.data), dataB64: bin ? toB64(bin) : null,
          purpose: o.kadriPurpose === 'player-resolve' ? 'player-resolve' : '', timeout: +o.timeout || 0, anonymous: !!o.anonymous, responseType: o.responseType || '' });
      } catch (e) { setTimeout(() => fail('error', 'senden'), 0); }
      return {
        abort() {
          if (done) return;
          aborted = true; done = true;
          try { port.postMessage({ t: 'abort' }); } catch (e) {}
          try { port.disconnect(); } catch (e) {}
          call(o.onabort, { status: 0, readyState: 4 });
        },
      };
    }
    // ---------- Meldungen des Hintergrunds an das Skript (ohne die Seite) ----------
    // hls.js erst bei Bedarf (der Hintergrund lädt es in dieses Fenster nach) – einmal, alle warten auf dasselbe
    let hlsP = null;
    const loadHls = () => {
      if (typeof Hls !== 'undefined') return Promise.resolve();
      if (!hlsP) {
        hlsP = new Promise((res, rej) => {
          try {
            api.runtime.sendMessage({ t: 'kadri-hls' }, (r) => {
              const err = api.runtime.lastError;
              if (!err && r && r.ok && typeof Hls !== 'undefined') res(); else { hlsP = null; rej(new Error((err && err.message) || (r && r.e) || 'hls.js nicht geladen')); }
            });
          } catch (e) { hlsP = null; rej(e); }
        });
      }
      return hlsP;
    };
    const KADRI_HOOKS = { onSrc: null, loadHls: loadHls };
    try {
      api.runtime.onMessage.addListener((m) => {
        if (m && m.t === 'kadri-src' && typeof KADRI_HOOKS.onSrc === 'function') { try { KADRI_HOOKS.onSrc(m.u, m.k); } catch (e) {} }
      });
    } catch (e) {}
    // ---------- Menü ----------
    const menu = [];
    function GM_registerMenuCommand(name, fn) { menu.push({ name, fn }); return menu.length; }
    try {
      api.runtime.onMessage.addListener((m) => {
        if (m && m.t === 'kadri-menu' && window.top === window && menu.length) { try { menu[0].fn(); } catch (e) {} }
      });
    } catch (e) {}
    const GM = { xmlHttpRequest: GM_xmlhttpRequest, registerMenuCommand: GM_registerMenuCommand, getValue: (k, d) => Promise.resolve(GM_getValue(k, d)), setValue: (k, v) => Promise.resolve(GM_setValue(k, v)) };
    const GM_info = { injectInto: 'content', scriptHandler: 'Kadri', script: { name: 'Kadri', version: KADRI_VERSION } };
    const __KADRI__ = true;
    // ===== ab hier: das Skript aus src/ (unverändert bis auf wenige, im Bau-Skript benannte Stellen) =====
