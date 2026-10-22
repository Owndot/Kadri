// Kadri – winziges Skript IN der Seite (Chrome/Vivaldi: „MAIN world“).
// Das eigentliche Skript läuft abgetrennt von der Seite und sieht ihre Anfragen nicht. Dieses hier liest nur mit,
// was die Seite ohnehin lädt – Stream-Listen (.m3u8/.mpd) und auf Facebook/Instagram die API-Antworten – und reicht
// den Text an Kadri weiter (Ereignis „kadri-net“). Es verändert keine Anfrage und keine Antwort.
(function () {
  'use strict';
  if (window.__kadriNet) return;
  try { Object.defineProperty(window, '__kadriNet', { value: true }); } catch (e) { return; }
  const PL = /\.(m3u8|mpd)(\?|#|$)/i;
  const META = /(^|\.)(facebook\.com|instagram\.com|threads\.net|threads\.com|messenger\.com)$/i.test(location.hostname);
  const API = /graphql|\/api\//i;
  const kindOf = (u) => (PL.test(u) ? 'pl' : META && API.test(u) ? 'api' : '');
  const abs = (u) => { try { return new URL(u, location.href).href; } catch (e) { return String(u); } };
  const send = (k, u, f, t) => {
    if (typeof t !== 'string' || !t || t.length > 4e6) return;
    try { document.dispatchEvent(new CustomEvent('kadri-net', { detail: JSON.stringify({ k: k, u: u, f: f || '', t: t }) })); } catch (e) {}
  };
  const keepName = (wrap, orig) => {
    try { Object.defineProperty(wrap, 'toString', { value: () => Function.prototype.toString.call(orig), configurable: true }); } catch (e) {}
    try { Object.defineProperty(wrap, 'name', { value: orig.name, configurable: true }); } catch (e) {}
  };
  // fetch
  const of = window.fetch;
  if (typeof of === 'function') {
    const wf = function (input) {
      const p = of.apply(this, arguments);
      try {
        const u = typeof input === 'string' ? input : (input && input.url) || String(input || '');
        const k = kindOf(u);
        if (k) p.then((r) => { try { if (r && r.ok) r.clone().text().then((t) => send(k, abs(u), r.url, t), () => {}); } catch (e) {} }, () => {});
      } catch (e) {}
      return p;
    };
    keepName(wf, of);
    window.fetch = wf;
  }
  // XMLHttpRequest
  const XP = window.XMLHttpRequest && window.XMLHttpRequest.prototype;
  if (XP && XP.open) {
    const oo = XP.open;
    const wo = function (m, url) {
      try {
        const u = String(url), k = kindOf(u);
        if (k && !this.__kadri) {
          this.__kadri = true;
          this.addEventListener('load', function () {
            try {
              if (this.status >= 400) return;
              const rt = this.responseType;
              if (!rt || rt === 'text') send(k, abs(u), this.responseURL, this.responseText);
              else if (rt === 'json' && k === 'api' && this.response) send(k, abs(u), this.responseURL, JSON.stringify(this.response));
            } catch (e) {}
          });
        }
      } catch (e) {}
      return oo.apply(this, arguments);
    };
    keepName(wo, oo);
    XP.open = wo;
  }
})();
