// S4b-7a Messsonde – isolierte Welt: Frame-Art melden und Ereignisse der Seitenwelt (main.js) an den Hintergrund weiterreichen.
'use strict';
(() => {
  const kind = location.href === 'about:srcdoc' ? 'srcdoc' : location.href === 'about:blank' ? 'blank' : /^data:/.test(location.href) ? 'data'
    : /^blob:/.test(location.href) ? 'blob' : 'http';
  const send = (m) => { try { chrome.runtime.sendMessage(m); } catch (e) {} };
  send({ k: 'frame', kind: kind, top: window === top, page: (location.pathname.match(/\/p\/([a-z0-9-]+)\.html$/) || [])[1] || '', t: Date.now() });
  // Manifest neu lesen OHNE Cookies (credentials: 'omit'), nur auf Anfrage des Hintergrunds; gemeldet werden Status, Länge, Hash-Präfix
  chrome.runtime.onMessage.addListener((m, sender, reply) => {
    if (!m || m.op !== 'refetch' || typeof m.url !== 'string') return;
    fetch(m.url, { credentials: 'omit', cache: 'no-store', redirect: 'follow' }).then(async (r) => {
      const b = new Uint8Array(await r.arrayBuffer());
      let h;
      if (self.crypto && crypto.subtle) h = Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', b)).slice(0, 12), (x) => x.toString(16).padStart(2, '0')).join('');
      else { let x = 0x811c9dc5; for (let i = 0; i < b.length; i++) { x ^= b[i]; x = Math.imul(x, 0x01000193) >>> 0; } h = 'f' + x.toString(16).padStart(8, '0') + ':' + b.length; }
      reply({ status: r.status, len: b.length, h: h, redirected: r.redirected, type: r.type });
    }, (e) => reply({ err: 'net:' + String((e && e.name) || e).slice(0, 30) }));
    return true;
  });
  document.addEventListener('kprobe', (e) => { const d = e.detail; if (d && typeof d === 'object') send(Object.assign({ k: 'page' }, d)); });
})();
