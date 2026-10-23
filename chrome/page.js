// Kadri – winziges Skript IN der Seite (Chrome/Vivaldi: „MAIN world“).
// Das eigentliche Skript läuft abgetrennt von der Seite. Dieses hier macht nur zwei Dinge, die von dort nicht gehen:
//  1. Mitlesen: Stream-Listen (.m3u8/.mpd – oder am „Content-Type“ erkannt, auch ohne Endung) und auf
//     Facebook/Instagram die API-Antworten, die die Seite ohnehin lädt, gehen als Text an Kadri (Ereignis „kadri-net“).
//     Keine Anfrage und keine Antwort wird verändert. Die letzten Meldungen werden aufgehoben und noch einmal
//     geschickt, wenn Kadri später startet (eingebettete Fenster laden Kadri erst, wenn ein Video auftaucht).
//  2. Schild (nur auf Zuruf, solange Kadri ein Video der Seite spiegelt): Die Seite erfährt nicht, dass sie verdeckt ist
//     (Wischen zum Startbildschirm, Bild-in-Bild) – sonst hielte z. B. Facebook sein Video und damit den Spiegel an.
//     Kadri selbst bekommt die Meldung trotzdem („kadri-vis“).
(function () {
  'use strict';
  if (window.__kadriNet) return;
  try { Object.defineProperty(window, '__kadriNet', { value: true }); } catch (e) { return; }
  // Kadri fragt „bist du da?“ (kein sichtbares Merkmal an der Seite)
  document.addEventListener('kadri-ping', () => { try { document.dispatchEvent(new Event('kadri-pong')); } catch (e) {} });
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
  const PL_CT = /mpegurl|dash\+xml/i;
  const ctKind = (ct) => (PL_CT.test(ct || '') ? (/dash/i.test(ct) ? 'mpd' : 'm3u8') : '');
  // aufheben: die letzten 40 Meldungen, zusammen höchstens ~6 MB
  const keep = [];
  let kept = 0;
  const fire = (d) => { try { document.dispatchEvent(new CustomEvent('kadri-net', { detail: d })); } catch (e) {} };
  const send = (k, u, f, t) => {
    if (typeof t !== 'string' || (!t && k !== 'src') || t.length > 4e6) return;
    const d = JSON.stringify({ k: k, u: u, f: f || '', t: t });
    keep.push(d); kept += d.length;
    while (keep.length > 40 || kept > 6e6) kept -= keep.shift().length;
    fire(d);
  };
  // Kadri ist (neu) da: alles Aufgehobene noch einmal
  document.addEventListener('kadri-hello', () => { keep.slice().forEach(fire); });
  // Stream-Liste ohne Endung, nur am Content-Type erkannt: Adresse melden (und den Text)
  const byType = (u, finalU, ct, text) => {
    const k = ctKind(ct);
    if (!k || PL.test(u)) return false;
    send('src', abs(u), k, '');
    if (typeof text === 'string' && text) send('pl', abs(u), finalU, text);
    return true;
  };
  const of = window.fetch;
  if (typeof of === 'function') {
    const wf = function (input) {
      const p = of.apply(this, arguments);
      try {
        const u = typeof input === 'string' ? input : (input && input.url) || String(input || '');
        const k = kindOf(u);
        p.then((r) => {
          try {
            if (!r || !r.ok) return;
            if (k) { r.clone().text().then((t) => send(k, abs(u), r.url, t), () => {}); return; }
            const ct = r.headers.get('content-type');   // nur die Kopfzeile – kostet fast nichts
            if (ctKind(ct)) r.clone().text().then((t) => byType(u, r.url, ct, t), () => byType(u, r.url, ct, ''));
          } catch (e) {}
        }, () => {});
      } catch (e) {}
      return p;
    };
    keepName(wf, of);
    window.fetch = wf;
  }
  const XP = window.XMLHttpRequest && window.XMLHttpRequest.prototype;
  const xinfo = new WeakMap();
  if (XP && XP.open) {
    const oo = XP.open;
    const wo = function (m, url) {
      try {
        const u = String(url), k = kindOf(u);
        const had = xinfo.has(this);
        xinfo.set(this, { u: u, k: k });   // (open kann mehrmals kommen – die letzte Adresse zählt; unsichtbar für die Seite)
        if (!had) {
          this.addEventListener('load', function () {
            try {
              if (this.status >= 400) return;
              const xi = xinfo.get(this) || {}, u = xi.u, k = xi.k, rt = this.responseType;
              const txt = !rt || rt === 'text';
              if (k) {
                if (txt) send(k, abs(u), this.responseURL, this.responseText);
                else if (rt === 'json' && k === 'api' && this.response) send(k, abs(u), this.responseURL, JSON.stringify(this.response));
                return;
              }
              const ct = this.getResponseHeader('content-type');
              if (ctKind(ct)) byType(u, this.responseURL, ct, txt ? this.responseText : '');
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
