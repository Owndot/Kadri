'use strict';
// Download-Blatt (src/105-download-knopf.js) deterministisch: visualViewport-Listener beim Ersetzen und Schließen,
// Verlaufseintrag für die Zurück-Taste bei schnellem Schließen und erneutem Öffnen (ausstehendes popstate wird hier
// gezielt zurückgehalten). Nachgebildetes DOM/history, echte Funktionen aus der Quelle.
//   node tests/dl_sheet_unit_check.js [ROOT]
const fs = require('fs'), path = require('path'), vm = require('vm'), assert = require('assert/strict');
const root = path.resolve(process.argv[2] || path.join(__dirname, '..'));
let passed = 0;
function check(name, value, info) { assert.ok(value, name + (info === undefined ? '' : ' – ' + JSON.stringify(info))); passed++; console.log('PASS ' + name); }

function world() {
  const L = {};   // window-Listener
  const vvL = { resize: new Set(), scroll: new Set() };
  const hist = { entries: ['page'], idx: 0, pushes: 0, backs: 0, queued: 0 };
  const el = (tag, attrs) => {
    const e = { tag, attrs: attrs || {}, children: [], style: {}, parent: null, listeners: {},
      classList: { s: new Set(String((attrs || {}).class || '').split(' ').filter(Boolean)), add(c) { this.s.add(c); }, contains(c) { return this.s.has(c); } },
      appendChild(c) { if (typeof c === 'object') c.parent = e; e.children.push(c); return c; },
      addEventListener(t, f) { (e.listeners[t] = e.listeners[t] || []).push(f); },
      remove() { if (e.parent) e.parent.children = e.parent.children.filter((x) => x !== e); e.parent = null; } };
    return e;
  };
  const shadow = el('root');
  const ctx = {
    console, setTimeout: (f, ms) => setTimeout(f, ms), clearTimeout,
    addEventListener: (t, f) => { (L[t] = L[t] || new Set()).add(f); },
    removeEventListener: (t, f) => { if (L[t]) L[t].delete(f); },
    META: false, root: shadow, ui() {}, tr: (x) => x, toast() {},
    h: (tag, attrs, text) => { const e = el(tag, attrs); if (text !== undefined) e.children.push(String(text)); return e; },
    location: { href: 'https://site.example/v' },
    visualViewport: { offsetLeft: 0, offsetTop: 0, width: 400, height: 800,
      addEventListener: (t, f) => vvL[t].add(f), removeEventListener: (t, f) => vvL[t].delete(f) },
    history: {
      state: null,
      get length() { return hist.entries.length; },
      pushState() { hist.entries = hist.entries.slice(0, hist.idx + 1); hist.entries.push('sheet'); hist.idx++; hist.pushes++; },
      back() { hist.backs++; hist.queued++; },   // asynchron: erst popDeliver() wendet es an
    },
  };
  ctx.window = ctx;
  vm.createContext(ctx);
  vm.runInContext(fs.readFileSync(path.join(root, 'src/105-download-knopf.js'), 'utf8') +
    '\nglobalThis.api = { open: pageDlMenu, close: pageDlClose, isOpen: () => !!pageDlEl };', ctx);
  const pop = () => { if (L.popstate) L.popstate.forEach((f) => f({})); };
  return {
    ctx, api: ctx.api, hist, shadow,
    vv: () => vvL.resize.size + vvL.scroll.size,
    popDeliver() { if (hist.queued > 0) { hist.queued--; hist.idx = Math.max(0, hist.idx - 1); pop(); } },   // ausstehendes Zurück kommt an
    userBack() { if (hist.idx > 0) { hist.idx--; pop(); } },                                               // Zurück-Taste
    tapOutside() { const ov = shadow.children.find((c) => c.classList && c.classList.contains('dlo')); ov.listeners.click.forEach((f) => f({ target: ov, stopPropagation() {} })); },
  };
}
const items = [{ label: 'A', fn() {} }];

(async () => {
  // 1. visualViewport-Listener: Ersetzen eines offenen Blatts (z. B. HLS-Untermenü) und mehrfaches Öffnen/Schließen
  let w = world();
  w.api.open('Speichern', items);
  check('offenes Blatt: genau ein resize- und ein scroll-Listener', w.vv() === 2, w.vv());
  w.api.open('Stream speichern', items);   // ersetzt das offene Blatt
  w.api.open('Stream fortsetzen', items);
  check('Blatt zweimal ersetzt: weiterhin genau ein Listenerpaar (alte entfernt)', w.vv() === 2, w.vv());
  check('… ersetztes Blatt behält den einen Verlaufseintrag', w.hist.pushes === 1 && w.shadow.children.length === 1, [w.hist.pushes, w.shadow.children.length]);
  w.api.close(); w.popDeliver();
  check('geschlossen: keine Listener übrig, eigenes Zurück genau einmal', w.vv() === 0 && w.hist.backs === 1 && w.hist.idx === 0, [w.vv(), w.hist]);
  for (let i = 0; i < 5; i++) { w.api.open('Speichern', items); w.tapOutside(); w.popDeliver(); }
  check('5× öffnen/schließen: keine Listener übrig, Verlauf wieder auf der Seite', w.vv() === 0 && w.hist.idx === 0 && w.hist.backs === 6, [w.vv(), w.hist]);

  // 2. schnell schließen und sofort wieder öffnen, solange das eigene Zurück noch aussteht
  w = world();
  w.api.open('Speichern', items);
  w.api.close();                           // history.back() ausstehend
  w.api.open('Speichern', items);          // sofort wieder öffnen
  check('ausstehendes Zurück: noch kein neuer Verlaufseintrag (würde sonst vom Zurück getroffen)', w.hist.pushes === 1 && w.api.isOpen(), w.hist);
  w.popDeliver();                          // jetzt kommt das eigene Zurück an
  check('… danach genau ein neuer eigener Eintrag, Blatt bleibt offen', w.hist.pushes === 2 && w.hist.idx === 1 && w.api.isOpen(), w.hist);
  w.userBack();                            // Android-Zurück
  check('… Zurück-Taste schließt nur das Blatt, Seite bleibt (kein weiteres Zurück)', !w.api.isOpen() && w.hist.idx === 0 && w.hist.backs === 1, w.hist);

  // 3. Sicherheitsnetz: kommt das popstate des eigenen Zurück nie, wird der Eintrag nach kurzer Zeit trotzdem gesetzt
  w = world();
  w.api.open('Speichern', items); w.api.close(); w.api.open('Speichern', items);
  await new Promise((r) => setTimeout(r, 1100));
  check('ohne popstate: Eintrag nach dem Sicherheitsnetz gesetzt', w.hist.pushes === 2, w.hist);
  w.api.close();

  // 4. Seite hat selbst einen Eintrag gesetzt (SPA): Schließen geht NICHT zurück (keine unbeabsichtigte Navigation)
  w = world();
  w.api.open('Speichern', items);
  w.ctx.history.pushState(); w.ctx.location.href = 'https://site.example/other';
  w.api.close();
  check('fremder Eintrag nach dem eigenen: kein history.back() beim Schließen', w.hist.backs === 0 && w.vv() === 0, w.hist);

  // 5. Facebook/Instagram: nie ein Verlaufseintrag
  w = world(); w.ctx.META = true;
  vm.runInContext('META = true', w.ctx);
  w.api.open('Speichern', items); w.api.close();
  check('META-Seiten: kein Verlaufseintrag, kein Zurück', w.hist.pushes === 0 && w.hist.backs === 0, w.hist);
  console.log('RESULT dl-sheet-unit PASS ' + passed + '/' + passed);
})().catch((e) => { console.error(e); process.exitCode = 1; });
