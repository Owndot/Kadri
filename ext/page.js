// Kadri – winziges Skript IN der Seite (Chrome/Vivaldi: „MAIN world“).
// Das eigentliche Skript läuft abgetrennt von der Seite. Dieses hier macht nur zwei Dinge, die von dort nicht gehen:
//  1. Mitlesen: Stream-Listen (.m3u8/.mpd) und auf Facebook/Instagram die API-Antworten, die die Seite ohnehin lädt,
//     gehen als Text an Kadri (Ereignis „kadri-net“). Keine Anfrage und keine Antwort wird verändert.
//  2. Schild (nur auf Zuruf, solange Kadri ein Video der Seite spiegelt): Die Seite erfährt nicht, dass sie verdeckt ist
//     (Wischen zum Startbildschirm, Bild-in-Bild) – sonst hielte z. B. Facebook sein Video und damit den Spiegel an.
//     Kadri selbst bekommt die Meldung trotzdem („kadri-vis“).
(function () {
  'use strict';
  if (window.__kadriNet) return;
  try { Object.defineProperty(window, '__kadriNet', { value: true }); } catch (e) { return; }
  try { document.documentElement.setAttribute('data-kadri-page', ''); } catch (e) {}
  const keepName = (wrap, orig) => {
    try { Object.defineProperty(wrap, 'toString', { value: () => Function.prototype.toString.call(orig), configurable: true }); } catch (e) {}
    try { Object.defineProperty(wrap, 'name', { value: orig.name, configurable: true }); } catch (e) {}
  };

  // ---------- 1. Mitlesen ----------
  const PL = /\.(m3u8|mpd)(\?|#|$)/i;
  const META = /(^|\.)(facebook\.com|instagram\.com|threads\.net|threads\.com|messenger\.com)$/i.test(location.hostname);
  const API = /graphql|\/api\//i;
  const kindOf = (u) => (PL.test(u) ? 'pl' : META && API.test(u) ? 'api' : '');
  const abs = (u) => { try { return new URL(u, location.href).href; } catch (e) { return String(u); } };
  const send = (k, u, f, t) => {
    if (typeof t !== 'string' || !t || t.length > 4e6) return;
    try { document.dispatchEvent(new CustomEvent('kadri-net', { detail: JSON.stringify({ k: k, u: u, f: f || '', t: t }) })); } catch (e) {}
  };
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

  // ---------- 2. Schild ----------
  let shield = false;
  document.addEventListener('kadri-ctl', (e) => {
    try { const d = JSON.parse(e.detail); if (d && typeof d.shield === 'boolean') shield = d.shield; } catch (x) {}
  });
  // Abfragen „verdeckt?“: bei Schild immer „sichtbar“
  const DP = Document.prototype;
  const wrapGetter = (prop, fake) => {
    const d = Object.getOwnPropertyDescriptor(DP, prop);
    if (!d || !d.get) return;
    const g = d.get;
    const ng = function () { return shield && this === document ? fake : g.call(this); };
    keepName(ng, g);
    try { Object.defineProperty(DP, prop, { get: ng, configurable: true, enumerable: d.enumerable }); } catch (e) {}
  };
  wrapGetter('hidden', false);
  wrapGetter('visibilityState', 'visible');
  wrapGetter('webkitHidden', false);
  wrapGetter('webkitVisibilityState', 'visible');
  const hf = DP.hasFocus;
  if (typeof hf === 'function') {
    const nhf = function () { return shield && this === document ? true : hf.call(this); };
    keepName(nhf, hf);
    DP.hasFocus = nhf;
  }
  // Die Meldung selbst: ganz vorn abfangen (läuft vor allen Skripten der Seite), Kadri bekommt sie als „kadri-vis“
  const stopVis = (e) => {
    if (!shield || e.target !== document) return;
    e.stopImmediatePropagation();
    try { document.dispatchEvent(new Event('kadri-vis')); } catch (x) {}
  };
  window.addEventListener('visibilitychange', stopVis, true);
  window.addEventListener('webkitvisibilitychange', stopVis, true);
})();
