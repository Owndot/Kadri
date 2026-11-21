// Kadri – winziger Wächter in eingebetteten Fenstern (iframes: Werbung, Zähler, eingebettete Player …).
// Kadri selbst (rund 400 KB) wird dort erst geladen, wenn wirklich ein Video auftaucht – die allermeisten Fenster
// haben nie eins, und so spart jede Seite Speicher und Rechenzeit. Im Hauptfenster läuft Kadri wie gewohnt sofort.
(function () {
  'use strict';
  if (window.top === window) return;
  const api = globalThis.chrome || globalThis.browser;
  if (!api || !api.runtime || !api.runtime.id) return;
  // Lage eines Videos aus einem tiefer eingebetteten Fenster an das eigene Elternfenster weiterreichen (src/035): nur eine
  // Zufallskennung und Zahlen, in die Koordinaten dieses Fensters umgerechnet (Rand, Innenabstand, Skalierung des
  // <iframe>), der sichtbare Teil auf dessen Kasten zugeschnitten. Nur von einem eigenen <iframe> (e.source), nie von
  // diesem Fenster selbst. Das Hauptfenster rechnet die letzte Ebene selbst.
  const FG = '__kadriFg1';
  const num = (a) => Array.isArray(a) && a.length === 4 && a.every((x) => typeof x === 'number' && isFinite(x) && Math.abs(x) < 1e6);
  const cut = (a, b) => { const l = Math.max(a[0], b[0]), t = Math.max(a[1], b[1]); return [l, t, Math.max(0, Math.min(a[0] + a[2], b[0] + b[2]) - l), Math.max(0, Math.min(a[1] + a[3], b[1] + b[3]) - t)]; };
  addEventListener('message', (e) => {
    const d = e.data;
    if (!d || typeof d !== 'object' || d[FG] !== 1 || d.top === 1 || typeof d.n !== 'string' || !/^[0-9a-f]{32}$/.test(d.n)) return;
    if (!num(d.r) || !num(d.c) || !(d.w > 0 && d.h > 0 && d.w < 1e5 && d.h < 1e5) || !e.source || e.source === window) return;
    let f = null;
    const all = document.querySelectorAll('iframe,frame');
    for (let i = 0; i < all.length && !f; i++) { try { if (all[i].contentWindow === e.source) f = all[i]; } catch (er) {} }
    if (!f) return;
    try {
      const fr = f.getBoundingClientRect(), cs = getComputedStyle(f);
      if (!fr.width || !fr.height) return;
      const sx = f.offsetWidth ? fr.width / f.offsetWidth : 1, sy = f.offsetHeight ? fr.height / f.offsetHeight : 1;
      const pl = parseFloat(cs.paddingLeft) || 0, pt = parseFloat(cs.paddingTop) || 0;
      const b = [fr.left + (f.clientLeft + pl) * sx, fr.top + (f.clientTop + pt) * sy,
        (f.clientWidth - pl - (parseFloat(cs.paddingRight) || 0)) * sx, (f.clientHeight - pt - (parseFloat(cs.paddingBottom) || 0)) * sy];
      if (b[2] <= 0 || b[3] <= 0) return;
      const kx = b[2] / d.w, ky = b[3] / d.h;
      const map = (a) => [b[0] + a[0] * kx, b[1] + a[1] * ky, a[2] * kx, a[3] * ky];
      const m = { n: d.n, r: map(d.r), c: cut(map(d.c), b), w: innerWidth, h: innerHeight };
      m[FG] = 1;
      window.parent.postMessage(m, '*');
    } catch (er) {}
  });
  let asked = false, mo = null, tm = 0, n = 0;
  const vids = document.getElementsByTagName('video');   // „lebendige“ Liste – Abfrage kostet fast nichts
  function want() {
    if (asked) return;
    asked = true;
    try { mo && mo.disconnect(); } catch (e) {}
    clearInterval(tm);
    ['pointerdown', 'play'].forEach((t) => document.removeEventListener(t, poke, true));
    try { api.runtime.sendMessage({ t: 'kadri-sub' }, () => { void api.runtime.lastError; }); } catch (e) {}
  }
  // Videos in gekapselten Bereichen (Shadow DOM) – wie im Skript, aber sparsam: höchstens 3000 Elemente
  function inShadow() {
    let budget = 3000;
    const visit = (root, depth) => {
      if (depth > 3 || budget <= 0) return false;
      const els = root.querySelectorAll('*');
      for (let i = 0; i < els.length && budget > 0; i++, budget--) {
        const sr = els[i].shadowRoot;
        if (sr && (sr.querySelector('video') || visit(sr, depth + 1))) return true;
      }
      return false;
    };
    try { return visit(document, 0); } catch (e) { return false; }
  }
  const check = () => { if (vids.length || inShadow()) want(); };
  function poke(e) { if (vids.length || (e && e.type === 'play') || inShadow()) want(); }
  if (vids.length) { want(); return; }
  try {
    mo = new MutationObserver(() => { if (vids.length) want(); });
    mo.observe(document, { childList: true, subtree: true });
  } catch (e) {}
  // Berührung im Fenster (viele Player bauen ihr Video erst beim Antippen) und Abspielen (auch im Shadow DOM)
  document.addEventListener('pointerdown', poke, true);
  document.addEventListener('play', poke, true);
  // Shadow DOM: in der ersten Minute alle 3 s nachsehen, danach alle 15 s
  tm = setInterval(() => { n++; if (n <= 20 || n % 5 === 0) check(); }, 3000);
})();
