// Kadri – winziger Wächter in eingebetteten Fenstern (iframes: Werbung, Zähler, eingebettete Player …).
// Kadri selbst (rund 400 KB) wird dort erst geladen, wenn wirklich ein Video auftaucht – die allermeisten Fenster
// haben nie eins, und so spart jede Seite Speicher und Rechenzeit. Im Hauptfenster läuft Kadri wie gewohnt sofort.
(function () {
  'use strict';
  if (window.top === window) return;
  const api = globalThis.chrome || globalThis.browser;
  if (!api || !api.runtime || !api.runtime.id) return;
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
