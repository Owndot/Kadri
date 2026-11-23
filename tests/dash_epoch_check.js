'use strict';
// S4b-4: Medien-Epoche je Videoelement (src/060 dashEpochNote/dashEpochOf, chrome/page.js „kadri-ls“) mit den echten Quelltexten.
//  - selbst gesehenes loadstart: Beginn = loadstart − 500 ms; gilt vor einer Meldung von page.js
//  - nicht gesehen: page.js-Meldung (nur echte Ereignisse, plausible Zeit), sonst Beobachtungsbeginn; kein Seitenstart-Rückgriff
//  - Quellwechsel ohne gesehenes loadstart: neuer Beginn
//   node tests/dash_epoch_check.js [ROOT]
const fs = require('fs'), path = require('path'), vm = require('vm'), assert = require('assert/strict');
const root = path.resolve(process.argv[2] || path.join(__dirname, '..'));
let passed = 0;
function check(name, value, info) { assert.ok(value, name + (info === undefined ? '' : ' – ' + JSON.stringify(info))); passed++; console.log('PASS ' + name); }

function doc() {
  const ls = {};
  return { ls, addEventListener: (t, f) => { (ls[t] = ls[t] || []).push(f); }, dispatchEvent: (e) => { (ls[e.type] || []).forEach((f) => f(e)); return true; },
    fire: (type, target, extra) => (ls[type] || []).forEach((f) => f(Object.assign({ type, target }, extra || {}))) };
}
// ---------- src/060 ----------
const src = fs.readFileSync(path.join(root, 'src/060-quellen-zuordnung.js'), 'utf8');
const a = src.indexOf('  // ---------- S4b-4: Medien-Epoche'), b = src.indexOf('\n', src.indexOf('const dashFromOf = (v) =>'));
assert.ok(a > 0 && b > a, 'Abschnitt Medien-Epoche in src/060');
function world(navAt) {
  const d = doc(), clock = { t: 1e12 };
  const D = function () { return new Date(clock.t); }; D.now = () => clock.t;
  const ctx = { document: d, Date: D, navAt: navAt || 0, WeakMap, Event: function (t) { this.type = t; }, isFinite, Math, Number };
  vm.createContext(ctx);
  vm.runInContext(src.slice(a, b) + '\nglobalThis.E = { dashEpochNote, dashEpochOf, dashFromOf };', ctx);
  return { E: ctx.E, d, clock };
}
const video = (src) => ({ tagName: 'VIDEO', currentSrc: src || '' });
{
  const w = world(0), v = video('blob:a');
  w.d.fire('loadstart', v);
  const t0 = w.clock.t;
  w.clock.t += 5000;
  const e = w.E.dashEpochOf(v);
  check('loadstart selbst gesehen: Epoche „loadstart“, Beginn = loadstart − 500 ms', e.by === 'loadstart' && e.from === t0 - 500, e);
  w.d.fire('kadri-ls', v, { detail: t0 - 60000 });
  check('… eine (frühere) Meldung von page.js ändert nichts daran', w.E.dashEpochOf(v).from === t0 - 500);
  w.clock.t += 1000; w.d.fire('loadstart', v);
  check('neues loadstart (neue MediaSource im selben Element): neuer Beginn', w.E.dashEpochOf(v).from === w.clock.t - 500);
}
{
  const w = world(0), v = video('blob:b');
  w.clock.t += 2000;
  w.d.fire('kadri-ls', v, { detail: w.clock.t - 1500 });
  const e = w.E.dashEpochOf(v);
  check('loadstart verpasst, page.js meldet es: Epoche „seite-loadstart“ mit dessen Zeit − 500 ms', e.by === 'seite-loadstart' && e.from === w.clock.t - 1500 - 500, e);
  w.d.fire('kadri-ls', v, { detail: w.clock.t + 60000 });
  check('… Meldung aus der Zukunft verworfen', w.E.dashEpochOf(v).by === 'seite-loadstart' && w.E.dashEpochOf(v).from === w.clock.t - 2000, w.E.dashEpochOf(v));
  w.d.fire('kadri-ls', v, { detail: 'x' });
  check('… unlesbare Meldung verworfen', w.E.dashEpochOf(v).from === w.clock.t - 2000);
}
{
  const w = world(5e11), v = video('blob:c');
  w.d.fire('kadri-ls', v, { detail: 1e11 });
  check('page.js-Meldung vor dem letzten Seitenwechsel (navAt): verworfen', w.E.dashEpochOf(v).by === 'beobachtet');
}
{
  const w = world(0), v = video('blob:d');
  const t0 = w.clock.t;
  w.E.dashEpochNote(v);
  w.clock.t += 7000;
  const e = w.E.dashEpochOf(v);
  check('nichts gemeldet (Shadow-DOM o. ä.): Beginn = Beobachtungsbeginn, ohne Toleranz, kein Rückgriff auf den Seitenstart', e.by === 'beobachtet' && e.from === t0, e);
  v.currentSrc = 'blob:e';
  w.E.dashEpochNote(v);
  const e2 = w.E.dashEpochOf(v);
  check('Quellwechsel ohne gesehenes loadstart: neuer Beginn „quellwechsel“', e2.by === 'quellwechsel' && e2.from === w.clock.t, e2);
}
{
  const w = world(0), v = video('');
  w.d.fire('loadstart', v);
  v.currentSrc = 'blob:f'; w.E.dashEpochNote(v);
  check('Quelle erst nach loadstart gesetzt: kein falscher Quellwechsel', w.E.dashEpochOf(v).by === 'loadstart');
}
// ---------- chrome/page.js ----------
{
  const d = doc(), sent = [];
  const ctx = { document: d, window: {}, location: { hostname: 'x.example', href: 'https://x.example/' }, Object, JSON, Date, URL,
    CustomEvent: function (t, o) { this.type = t; this.detail = o && o.detail; }, Event: function (t) { this.type = t; },
    fetch: () => Promise.resolve(), XMLHttpRequest: function () {}, Function, console };
  ctx.XMLHttpRequest.prototype = { open() {}, send() {}, addEventListener() {} };
  ctx.window = ctx;
  vm.createContext(ctx);
  try { vm.runInContext(fs.readFileSync(path.join(root, 'chrome/page.js'), 'utf8'), ctx); } catch (e) { /* (Teile außerhalb der Medien-Epoche brauchen eine echte Seite) */ }
  const v = { tagName: 'VIDEO', dispatchEvent: (e) => { sent.push([e.type, e.detail]); return true; } };
  d.fire('loadstart', v, { isTrusted: false });
  check('page.js: unechtes loadstart (isTrusted false) wird nicht gemeldet', sent.length === 0, sent);
  d.fire('loadstart', v, { isTrusted: true });
  check('page.js: echtes loadstart → „kadri-ls“ am Element mit Zeitstempel', sent.length === 1 && sent[0][0] === 'kadri-ls' && typeof sent[0][1] === 'number', sent);
  d.fire('kadri-ls-hello', null);
  check('page.js: auf „kadri-ls-hello“ (Kadri startet später) noch einmal gemeldet', sent.length === 2 && sent[1][1] === sent[0][1], sent);
}
console.log('RESULT dash-epoch PASS ' + passed + '/' + passed);
