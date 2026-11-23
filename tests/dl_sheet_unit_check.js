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
  const hist = { entries: [null], idx: 0, pushes: 0, backs: 0, queued: 0 };   // je Eintrag sein history.state
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
    META: false, IN_FRAME: false, fuiLog() {}, root: shadow, ui() {}, tr: (x) => x, toast() {},
    h: (tag, attrs, text) => { const e = el(tag, attrs); if (text !== undefined) e.children.push(String(text)); return e; },
    location: { href: 'https://site.example/v' },
    visualViewport: { offsetLeft: 0, offsetTop: 0, width: 400, height: 800,
      addEventListener: (t, f) => vvL[t].add(f), removeEventListener: (t, f) => vvL[t].delete(f) },
    history: {
      get state() { return hist.entries[hist.idx]; },
      get length() { return hist.entries.length; },
      pushState(st) { hist.entries = hist.entries.slice(0, hist.idx + 1); hist.entries.push(st); hist.idx++; if (st && st.__kadriDlSheet) hist.pushes++; },
      replaceState(st) { hist.entries[hist.idx] = st; },
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
    // (Länge + Adresse allein reichen nicht: siehe Fall 4)
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

  // 3. verspätetes popstate: das eigene Zurück wird länger als der Sicherheits-Timeout zurückgehalten
  w = world();
  w.api.open('Speichern', items); w.api.close(); w.api.open('Speichern', items);   // Zurück ausstehend, neues Blatt offen
  await new Promise((r) => setTimeout(r, 1700));                                    // weit über den Timeout hinaus
  check('verspätetes Zurück ausstehend: Timeout setzt keinen neuen Eintrag, Blatt bleibt offen',
    w.hist.pushes === 1 && w.hist.idx === 1 && w.api.isOpen(), w.hist);
  w.popDeliver();                                                                   // jetzt erst kommt das popstate
  check('… verspätetes popstate schließt das neue Blatt nicht; danach genau ein neuer eigener Eintrag',
    w.api.isOpen() && w.hist.pushes === 2 && w.hist.idx === 1 && w.hist.entries.length === 2, w.hist);
  w.userBack();
  check('… Zurück-Taste schließt nur das Blatt; die Seite navigiert nicht zurück (kein weiteres history.back())',
    !w.api.isOpen() && w.hist.idx === 0 && w.hist.backs === 1 && w.hist.queued === 0, w.hist);
  await new Promise((r) => setTimeout(r, 700));
  check('… auch später kein weiteres Zurück, kein neuer Eintrag', w.hist.backs === 1 && w.hist.pushes === 2 && w.hist.idx === 0, w.hist);
  // ohne jedes popstate, aber mit angewendetem Zurück (Zustand gewechselt): Timeout erkennt das und trägt dann ein
  w = world();
  w.api.open('Speichern', items); w.api.close(); w.api.open('Speichern', items);
  w.hist.queued--; w.hist.idx--;                                                    // Zurück angewendet, popstate verloren
  await new Promise((r) => setTimeout(r, 700));
  check('Zurück angewendet ohne popstate: Timeout trägt erst danach ein', w.api.isOpen() && w.hist.pushes === 2 && w.hist.idx === 1, w.hist);
  w.api.close(); w.popDeliver();

  // 4. Zuordnung des eigenen Eintrags: nur die Kennung im history.state zählt, nicht Länge + Adresse
  w = world();
  w.api.open('Speichern', items);
  w.ctx.history.pushState({ page: 1 }); w.ctx.location.href = 'https://site.example/other';
  w.api.close();
  check('fremder Eintrag nach dem eigenen: kein history.back() beim Schließen', w.hist.backs === 0 && w.vv() === 0, w.hist);
  w = world();
  w.api.open('Speichern', items);
  w.hist.idx--; w.ctx.history.pushState({ page: 2 });   // Seite ersetzt den Eintrag durch einen eigenen: gleiche Länge, gleiche Adresse
  check('… (gleiche Länge und Adresse wie der eigene Eintrag)', w.hist.entries.length === 2 && w.ctx.location.href === 'https://site.example/v');
  w.api.close();
  check('… trotzdem kein history.back(): der aktuelle Eintrag trägt nicht die eigene Kennung', w.hist.backs === 0, w.hist);
  w = world();
  w.api.open('Speichern', items);
  w.ctx.history.replaceState({ router: 'x' });          // Seite überschreibt den Zustand des eigenen Eintrags
  w.api.close();
  check('… ebenso nach replaceState der Seite', w.hist.backs === 0, w.hist);
  w = world();
  w.api.open('Speichern', items);
  check('eigener Eintrag übernimmt den Zustand der Seite und ergänzt nur die Kennung', w.hist.entries[1] && typeof w.hist.entries[1].__kadriDlSheet === 'string', w.hist.entries);
  w = world(); w.hist.entries[0] = 'string-state';
  w.api.open('Speichern', items); w.api.close();
  check('fremde Zustandsform (kein Objekt): kein Eintrag, kein Zurück', w.hist.pushes === 0 && w.hist.backs === 0 && w.hist.entries[0] === 'string-state', w.hist);

  // 5. Facebook/Instagram: nie ein Verlaufseintrag
  w = world(); w.ctx.META = true;
  vm.runInContext('META = true', w.ctx);
  w.api.open('Speichern', items); w.api.close();
  check('META-Seiten: kein Verlaufseintrag, kein Zurück', w.hist.pushes === 0 && w.hist.backs === 0, w.hist);
  console.log('RESULT dl-sheet-unit PASS ' + passed + '/' + passed);
})().catch((e) => { console.error(e); process.exitCode = 1; });
