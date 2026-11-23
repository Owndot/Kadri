'use strict';
// S4b-3: Zuordnung der Antworten eines eingebetteten Fensters zu GENAU dem Tipp im Hauptfenster (Anfragekennung „rid“),
// mit den echten Funktionen aus der Quelle (src/035-fenster-oberflaeche.js, chrome/background.js):
//  - Hintergrund: rid nur als genau 8 Hex-Zeichen weitergereicht (nach unten mit act/pick, nach oben mit menu/toast),
//    sonst weggelassen; „stale“ nur als echtes true zurück an das Fenster.
//  - Hauptfenster: eine Auswahl gilt nur mit der Kennung des LETZTEN Tipps (⬇, ▶ oder Eintrag), einmal, aus demselben
//    Fenster und höchstens FUI_MENU_WAIT nach dem Tipp. Antwort auf einen älteren oder schon beantworteten Tipp → {stale:true}.
//  - Fenster: {stale:true} → Auswahl verwerfen, KEIN Rückfall auf die Auswahl im Fenster; die Kennung des Ablaufs wird
//    mitgeschickt, auch wenn inzwischen ein neuerer Tipp kam.
//   node tests/frame_ui_rid_check.js [ROOT]
const fs = require('fs'), path = require('path'), vm = require('vm'), assert = require('assert/strict');
const root = path.resolve(process.argv[2] || path.join(__dirname, '..'));
let passed = 0;
function check(name, value, info) { assert.ok(value, name + (info === undefined ? '' : ' – ' + JSON.stringify(info))); passed++; console.log('PASS ' + name); }
const tick = () => new Promise((r) => setTimeout(r, 0));
const N = 'b'.repeat(32), RID = /^[0-9a-f]{8}$/;

// ---------- 1. Hintergrund ----------
{
  const src = fs.readFileSync(path.join(root, 'chrome/background.js'), 'utf8');
  const a = src.indexOf('// ---------- Oberfläche eingebetteter Videos im Hauptfenster');
  const b = src.indexOf('api.runtime.onMessage.addListener((m, sender, reply) => {', a);
  const ctx = { Promise, console };
  vm.createContext(ctx);
  vm.runInContext(src.slice(a, b) + '\nglobalThis.B = { fuiUp, fuiDown, fuiUpBack };', ctx);
  const B = ctx.B;
  check('nach unten: act mit gültiger Kennung → rid weitergereicht', B.fuiDown({ op: 'act', n: N, a: 'dl', rid: '0a1b2c3d' }).rid === '0a1b2c3d');
  check('nach unten: pick mit gültiger Kennung → rid weitergereicht', B.fuiDown({ op: 'pick', n: N, seq: 1, i: 0, rid: 'deadbeef' }).rid === 'deadbeef');
  for (const bad of ['DEADBEEF', 'deadbee', 'deadbeef0', 'xyzxyzxy', 12345678, { a: 1 }, 'https://e.x/']) {
    const d = B.fuiDown({ op: 'pick', n: N, seq: 1, i: 0, rid: bad }), u = B.fuiUp({ op: 'menu', n: N, seq: 1, title: 't', items: [], rid: bad });
    check('ungültige Kennung ' + JSON.stringify(bad) + ': weggelassen (nach unten und oben), Nachricht sonst unverändert', d && !('rid' in d) && u && !('rid' in u), [d, u]);
  }
  check('nach oben: menu und toast tragen eine gültige Kennung', B.fuiUp({ op: 'menu', n: N, seq: 2, title: 't', items: [], rid: '01234567' }).rid === '01234567' &&
    B.fuiUp({ op: 'toast', n: N, text: 'x', rid: '01234567' }).rid === '01234567');
  check('Antwort an das Fenster: stale nur bei echtem true', B.fuiUpBack({ ok: false, stale: true }).stale === true && !('stale' in B.fuiUpBack({ ok: false, stale: 'true' })) && !('stale' in B.fuiUpBack({ ok: true })));
}

// ---------- 2./3. Hauptfenster und Fenster (src/035) ----------
function world(inFrame, answer, now) {
  const sent = [], toasts = [], shown = [], local = [], waitDone = [];
  const clock = { t: now || 1e12 };
  const D = function () { return new Date(clock.t); }; D.now = () => clock.t;
  const ctx = {
    console, setTimeout, Date: D, Promise, crypto: require('crypto').webcrypto,
    IN_FRAME: inFrame, addEventListener() {}, CONFIG: { minWidth: 160 }, vp: null, active: null, quiet: 0,
    KADRI_FRAMEUI: { send: (m) => { sent.push(m); return Promise.resolve(answer ? answer(m) : { ok: true }); } },
    toast: (t) => toasts.push(String(t)), hidePill() {}, tick() {}, watchSize() {}, frameOf: () => null, fsElem: () => null,
    pageDlMenu: (title, items, here) => (inFrame ? local : shown).push({ title, n: items.length, here, items }),
    toYtdlnis() {}, pageDlOpenTab() {}, shareUrl() {}, copyText() {}, pageDlWaitDone: (id) => waitDone.push(id),
  };
  vm.createContext(ctx);
  vm.runInContext(fs.readFileSync(path.join(root, 'src/035-fenster-oberflaeche.js'), 'utf8') +
    '\nglobalThis.T = { fui, fuiTop, fuiFrameMenu, fuiTopAct, fuiTopPick, fuiTopMsg, fuiFrameMsg, fuiTopCancel, FUI_MENU_WAIT, fuiTrace };', ctx);
  return { T: ctx.T, sent, toasts, shown, local, clock, waitDone };
}
const SRC = { f: 3, d: 'DOC3' }, SRC2 = { f: 4, d: 'DOC4' };
const up = (w, m, src) => w.T.fuiTopMsg(Object.assign({ n: N, src: src || SRC }, m));
const menuUp = (w, rid, seq, src) => up(w, { op: 'menu', seq: seq || 2, rid, title: 'DASH-Stream speichern', items: [{ label: '360p' }, { label: '180p' }] }, src);

(async () => {
  {
    const w = world(false);
    up(w, { op: 'show', on: true });
    const g = w.T.fuiTop.regs.get('3:DOC3');
    check('Hauptfenster: Fenster registriert', !!g);
    w.T.fuiTop.cur = g;
    w.T.fuiTopPick(g, 1, 0);
    const pick = w.sent.find((m) => m.op === 'pick');
    check('Tipp auf Eintrag: pick mit neuer Kennung, an genau dieses Dokument', pick && RID.test(pick.rid) && pick.to.f === 3 && pick.to.d === 'DOC3', pick);
    let r = menuUp(w, pick.rid);
    check('Auswahl mit der Kennung dieses Tipps: gezeigt ({ok:true})', r.ok === true && w.shown.length === 1 && w.shown[0].n === 2, r);
    r = menuUp(w, pick.rid, 3);
    check('dieselbe Kennung ein zweites Mal (doppelte Antwort): {stale:true}, nichts gezeigt', r.ok === false && r.stale === true && w.shown.length === 1, r);
    // neuer Tipp auf ⬇, danach kommt die Antwort des älteren Tipps
    w.T.fuiTopPick(g, 2, 0);
    const pickA = w.sent.filter((m) => m.op === 'pick').pop();
    w.T.fuiTopAct('dl');
    const actB = w.sent.filter((m) => m.op === 'act').pop();
    check('neuer Tipp ⬇: act mit eigener, anderer Kennung', actB && RID.test(actB.rid) && actB.rid !== pickA.rid);
    r = menuUp(w, pickA.rid, 4);
    check('Antwort auf den ÄLTEREN Tipp nach einem neueren: {stale:true}, nichts gezeigt', r.ok === false && r.stale === true && w.shown.length === 1, r);
    r = menuUp(w, actB.rid, 5);
    check('Antwort auf den neueren Tipp: gezeigt', r.ok === true && w.shown.length === 2, r);
    r = menuUp(w, pickA.rid, 6);
    check('ältere Antwort auch NACH der Antwort des neueren Tipps: {stale:true} (nicht „kein Tipp“ → kein Rückfall im Fenster)', r.ok === false && r.stale === true && w.shown.length === 2, r);
    r = menuUp(w, undefined, 7);
    check('Auswahl ohne Kennung: abgelehnt, nicht als veraltet markiert', r.ok === false && !r.stale && w.shown.length === 2, r);
    check('Relay-Spur hält die Gründe (veraltet / ohne-kennung)', w.T.fuiTrace.some((e) => e[2] === 'top:menu-abgelehnt' && e[3] === 'veraltet') && w.T.fuiTrace.some((e) => e[3] === 'ohne-kennung'));
    check('Relay-Spur ohne Adressen/Texte: nur Kennung, Schritt und kurzer Code', w.T.fuiTrace.every((e) => typeof e[0] === 'number' && (e[1] === '-' || RID.test(e[1])) && !/[:\/]{2}|DASH|360p/.test(e[3])), w.T.fuiTrace.slice(-4));
  }
  {
    const w = world(false);
    up(w, { op: 'show', on: true }); up(w, { op: 'show', on: true }, SRC2);
    const g = w.T.fuiTop.regs.get('3:DOC3');
    w.T.fuiTop.cur = g;
    w.T.fuiTopPick(g, 1, 0);
    const p = w.sent.find((m) => m.op === 'pick');
    let r = menuUp(w, p.rid, 2, SRC2);
    check('Auswahl mit passender Kennung, aber aus einem ANDEREN Fenster: nicht gezeigt', r.ok === false && w.shown.length === 0, r);
    r = up(w, { op: 'menu', seq: 2, rid: p.rid, title: 't', items: [] }, { f: 3, d: 'FREMD' });
    check('… aus einem unbekannten Dokument: nicht gezeigt', r.ok === false && w.shown.length === 0, r);
    w.clock.t += w.T.FUI_MENU_WAIT + 1;
    r = menuUp(w, p.rid);
    check('S4b: Auswahl nach Ablauf der Planungsfrist (' + w.T.FUI_MENU_WAIT / 1000 + ' s): nicht gezeigt UND veraltet (kein unbeabsichtigtes Blatt im Fenster)', r.ok === false && r.stale === true && w.shown.length === 0, r);
  }
  {
    const w = world(false);
    up(w, { op: 'show', on: true });
    const g = w.T.fuiTop.regs.get('3:DOC3');
    w.T.fuiTop.cur = g;
    w.T.fuiTopPick(g, 1, 0);
    const p = w.sent.find((m) => m.op === 'pick');
    w.clock.t += 40000;   // langsame Planung (Kanal 25 s + Warteschlange) – innerhalb der Frist
    const r = menuUp(w, p.rid);
    check('langsame Planung (40 s) innerhalb der Frist: gezeigt', r.ok === true && w.shown.length === 1, r);
  }
  // ---------- S4b: Warteblatt bewusst geschlossen, Hinweise je Kennung ----------
  {
    const w = world(false);
    up(w, { op: 'show', on: true });
    const g = w.T.fuiTop.regs.get('3:DOC3');
    w.T.fuiTop.cur = g;
    const rid = w.T.fuiTopPick(g, 1, 0);
    check('fuiTopPick gibt die Kennung des Tipps zurück (für das Warteblatt)', RID.test(rid || ''), rid);
    let r = up(w, { op: 'toast', rid, prog: true, text: 'Helfer-App prüft den Stream …' });
    check('Fortschritts-Hinweis des aktuellen Tipps: gezeigt, Warteblatt bleibt offen', r.ok === true && w.toasts.length === 1 && w.waitDone.length === 0, [r, w.waitDone]);
    w.T.fuiTopCancel(rid);   // Warteblatt bewusst geschlossen (src/105)
    r = menuUp(w, rid);
    check('Planauswahl nach bewusstem Schließen: nicht gezeigt, {stale:true} (Fenster verwirft, kein Blatt)', r.ok === false && r.stale === true && w.shown.length === 0, r);
    r = up(w, { op: 'toast', rid, text: 'Stream lässt sich nicht speichern' });
    check('später Hinweis des abgebrochenen Tipps: abgelehnt', r.ok === false && w.toasts.length === 1, r);
    check('Relay-Spur nennt den Abbruch', w.T.fuiTrace.some((e) => e[2] === 'top:menu-abgelehnt' && e[3] === 'abgebrochen') && w.T.fuiTrace.some((e) => e[2] === 'top:abgebrochen'));
    // neuer Tipp; ein später Hinweis des älteren Tipps überdeckt den neueren nicht
    const rid2 = w.T.fuiTopPick(g, 2, 0);
    r = up(w, { op: 'toast', rid: rid, text: 'Helfer-App nicht erreichbar' });
    check('Hinweis eines älteren Tipps nach einem neueren: abgelehnt (veraltet)', r.ok === false && w.toasts.length === 1, r);
    r = up(w, { op: 'toast', rid: rid2, text: 'Helfer-App lädt' });
    check('Ergebnis-Hinweis des aktuellen Tipps: gezeigt und schließt dessen Warteblatt', r.ok === true && w.toasts.length === 2 && w.waitDone.indexOf(rid2) >= 0, [r, w.waitDone]);
  }
  // ---------- Fenster ----------
  {
    const w = world(true, (m) => (m.op === 'menu' ? { ok: false, stale: true } : { ok: true }));
    w.T.fui.shown = true; w.T.fui.mode = 'remote';
    w.T.fuiFrameMsg({ op: 'pick', n: w.T.fui.n, seq: 1, i: 0, rid: '11111111' });
    w.T.fuiFrameMsg({ op: 'act', n: w.T.fui.n, a: 'diag', rid: '22222222' });
    w.T.fuiFrameMenu('DASH-Stream speichern', [{ label: '360p', fn() {} }], '11111111');
    await tick(); await tick();
    const m = w.sent.find((x) => x.op === 'menu');
    check('Fenster: Auswahl trägt die Kennung ihres Ablaufs (nicht die des neueren Tipps)', m && m.rid === '11111111' && w.T.fui.rid === '22222222', m);
    check('Fenster: Antwort {stale:true} → verworfen, KEIN Rückfall auf die Auswahl im Fenster', w.local.length === 0 && w.T.fui.local === false && w.T.fui.menu === null &&
      !w.sent.some((x) => x.op === 'show' && x.on === false), { local: w.local, flag: w.T.fui.local });
  }
  {
    const w = world(true, (m) => (m.op === 'menu' ? { ok: false } : { ok: true }));
    w.T.fui.shown = true; w.T.fui.mode = 'remote';
    w.T.fuiFrameMenu('Speichern', [{ label: 'x', fn() {} }], '33333333');
    await tick(); await tick();
    check('Fenster: Antwort {ok:false} ohne stale → bisheriger kontrollierter Rückfall (Gegenstück)', w.local.length === 1 && w.local[0].here === true && w.T.fui.local === true);
  }
  console.log('RESULT frame-ui-rid PASS ' + passed + '/' + passed);
})().catch((e) => { console.log('FAIL ' + e.message); process.exit(1); });
