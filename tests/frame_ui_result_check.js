'use strict';
// Antworten der Weiterleitung (src/035-fenster-oberflaeche.js) mit echten Funktionen aus der Quelle:
//  - Auswahl eines eingebetteten Fensters: nur {ok:true} heißt „oben angezeigt“. Bei null, Fehler oder {ok:false} greift
//    der kontrollierte Rückfall auf die Auswahl im Fenster – sofern die Anforderung noch die aktuelle ist.
//  - Tipp oben (Knopf oder Eintrag) mit Antwort {ok:false}: nie stillschweigend „erledigt“, sondern ein verständlicher
//    Hinweis mit dem Weg zum erneuten Tippen; nichts wird selbst wiederholt (genau eine Nachricht je Tipp).
//   node tests/frame_ui_result_check.js [ROOT]
const fs = require('fs'), path = require('path'), vm = require('vm'), assert = require('assert/strict');
const root = path.resolve(process.argv[2] || path.join(__dirname, '..'));
let passed = 0;
function check(name, value, info) { assert.ok(value, name + (info === undefined ? '' : ' – ' + JSON.stringify(info))); passed++; console.log('PASS ' + name); }
const tick = () => new Promise((r) => setTimeout(r, 0));

function world(inFrame, answer) {
  const sent = [], toasts = [], local = [], ext = [];
  const ctx = {
    console, setTimeout, Date, Promise, crypto: require('crypto').webcrypto,
    IN_FRAME: inFrame, addEventListener() {}, CONFIG: { minWidth: 160 }, vp: null, active: null, quiet: 0,
    KADRI_FRAMEUI: { send: (m) => { sent.push(m); const a = answer(m); return a instanceof Error ? Promise.reject(a) : Promise.resolve(a); } },
    toast: (t) => toasts.push(String(t)), hidePill() {}, tick() {}, watchSize() {}, frameOf: () => null, fsElem: () => null,
    pageDlMenu: (title, items, here) => local.push({ title, n: items.length, here }),
    toYtdlnis: (u) => ext.push(['ytdlnis', u]), pageDlOpenTab: (u) => ext.push(['open', u]), shareUrl: (u) => ext.push(['share', u]), copyText: (t) => ext.push(['copy', t]),
  };
  vm.createContext(ctx);
  vm.runInContext(fs.readFileSync(path.join(root, 'src/035-fenster-oberflaeche.js'), 'utf8') +
    '\nglobalThis.T = { fui, fuiTop, fuiFrameMenu, fuiTopAct, fuiTopPick };', ctx);
  return { T: ctx.T, sent, toasts, local, ext };
}
const items = [{ label: 'Mit Helper herunterladen', sub: 'MP4', fn() {} }, { label: 'Teilen …', fn() {}, ext: { k: 'share', u: 'https://cdn.example/v.mp4' } }];

(async () => {
  // ---------- 1. Auswahl des Fensters im Hauptfenster ----------
  for (const [name, ans, fallback] of [
    ['{ok:true} (oben angezeigt)', { ok: true }, false],
    ['{ok:false} (oben abgelehnt)', { ok: false }, true],
    ['null (Hauptfenster nicht erreichbar)', null, true],
    ['Fehler beim Senden', new Error('Could not establish connection'), true],
    ['Antwort ohne ok', { mode: 'remote' }, true],
  ]) {
    const w = world(true, (m) => (m.op === 'menu' ? ans : { ok: true }));
    w.T.fui.shown = true; w.T.fui.mode = 'remote';
    w.T.fuiFrameMenu('Speichern', items);
    await tick(); await tick();
    const menus = w.sent.filter((m) => m.op === 'menu');
    check('Auswahl, Antwort ' + name + ': ' + (fallback ? 'Rückfall auf die Auswahl im Fenster' : 'kein Rückfall'),
      menus.length === 1 && (fallback
        ? w.local.length === 1 && w.local[0].here === true && w.local[0].n === items.length && w.T.fui.local === true && w.T.fui.menu === null
        : w.local.length === 0 && w.T.fui.local === false && w.T.fui.menu && w.T.fui.menu.seq === menus[0].seq),
      { local: w.local, flag: w.T.fui.local, sent: w.sent.map((m) => m.op) });
    if (fallback) check('… dabei Knopf hier abgemeldet (genau eine Abmeldung, keine erneute Auswahl nach oben)',
      w.sent.filter((m) => m.op === 'show' && m.on === false).length === 1 && menus.length === 1, w.sent);
  }
  // Anforderung inzwischen überholt (eine neuere Auswahl ist unterwegs): kein Rückfall für die alte
  {
    const pend = [];
    const w = world(true, (m) => (m.op === 'menu' ? new Promise((res) => pend.push(res)) : { ok: true }));
    w.T.fui.shown = true; w.T.fui.mode = 'remote';
    w.T.fuiFrameMenu('Speichern', items);         // seq 1
    w.T.fuiFrameMenu('Stream speichern', items);  // seq 2 ersetzt
    pend[0]({ ok: false }); await tick(); await tick();
    check('überholte Anforderung mit {ok:false}: kein Rückfall, die neuere bleibt aktuell', w.local.length === 0 && w.T.fui.menu && w.T.fui.menu.seq === 2, w.local);
    pend[1]({ ok: false }); await tick(); await tick();
    check('… die aktuelle mit {ok:false}: genau ein Rückfall (mit ihrem Titel)', w.local.length === 1 && w.local[0].title === 'Stream speichern', w.local);
  }

  // ---------- 2. Tipp im Hauptfenster, Antwort des Fensters ----------
  const top = (ans) => {
    const w = world(false, () => ans);
    const g = { key: '3:D', src: { f: 3, d: 'D' }, n: 'a'.repeat(32), t0: 0, mode: 'remote', want: 'remote', hold: 0 };
    w.T.fuiTop.regs.set(g.key, g); w.T.fuiTop.cur = g;
    return { w, g };
  };
  for (const a of ['dl', 'player', 'diag', 'share']) {
    const { w } = top({ ok: false });
    w.T.fuiTopAct(a); await tick(); await tick();
    check('Knopf „' + a + '“, Antwort {ok:false}: Hinweis „nicht ausgeführt – bitte erneut tippen“, genau eine Nachricht',
      w.toasts.length === 1 && /nicht ausgeführt – bitte erneut tippen/.test(w.toasts[0]) && w.sent.filter((m) => m.op === 'act').length === 1 && !w.ext.length,
      { toasts: w.toasts, sent: w.sent });
  }
  {
    const { w } = top({ ok: false, gone: true });
    w.T.fuiTopAct('dl'); await tick(); await tick();
    check('Knopf, Antwort {ok:false, gone}: Knopf weg, Hinweis „nichts gestartet … erneut tippen, sobald der Knopf wieder erscheint“',
      w.T.fuiTop.cur === null && w.toasts.length === 1 && /nichts gestartet/.test(w.toasts[0]) && /wieder erscheint/.test(w.toasts[0]) && w.sent.length === 1, { toasts: w.toasts, cur: !!w.T.fuiTop.cur });
  }
  {
    const { w } = top({ ok: false, toast: 'Kein Link zu diesem Video gefunden' });
    w.T.fuiTopAct('share'); await tick(); await tick();
    check('Knopf, Antwort {ok:false} mit eigenem Hinweis des Fensters: genau dieser Hinweis (kein zweiter)', w.toasts.length === 1 && w.toasts[0] === 'Kein Link zu diesem Video gefunden', w.toasts);
  }
  {
    const { w, g } = top({ ok: false });
    w.T.fuiTopPick(g, 1, 0); await tick(); await tick();
    check('Eintrag der Auswahl, Antwort {ok:false}: Hinweis „Auswahl nicht mehr aktuell – nichts gestartet. Bitte erneut auf ⬇ tippen“',
      w.toasts.length === 1 && /Auswahl nicht mehr aktuell – nichts gestartet/.test(w.toasts[0]) && /erneut auf ⬇ tippen/.test(w.toasts[0]), w.toasts);
    check('… keine automatische Wiederholung (genau ein pick)', w.sent.filter((m) => m.op === 'pick').length === 1 && !w.ext.length, w.sent);
  }
  {
    const { w, g } = top({ ok: true });
    w.T.fuiTopPick(g, 1, 0); await tick(); await tick();
    check('Eintrag, Antwort {ok:true}: kein Fehlerhinweis', w.toasts.length === 0, w.toasts);
  }
  {
    const { w, g } = top({ ok: true, ext: { k: 'share', u: 'https://cdn.example/v.mp4' } });
    w.T.fuiTopPick(g, 1, 1); await tick(); await tick();
    check('Eintrag, Antwort {ok:true, ext}: Aktion hier ausgeführt, kein Fehlerhinweis', w.toasts.length === 0 && w.ext.length === 1 && w.ext[0][0] === 'share', [w.toasts, w.ext]);
  }
  {
    const { w } = top(null);
    w.T.fuiTopAct('dl'); await tick(); await tick();
    check('Knopf, keine Antwort (null): „nicht mehr erreichbar“, Knopf weg (unverändert)', w.toasts.length === 1 && /nicht mehr erreichbar/.test(w.toasts[0]) && w.T.fuiTop.cur === null, w.toasts);
  }
  console.log('RESULT frame-ui-result PASS ' + passed + '/' + passed);
})().catch((e) => { console.error(e); process.exitCode = 1; });
