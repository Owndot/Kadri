'use strict';
// Weiterleitung der Oberfläche eingebetteter Videos im Hintergrund (chrome/background.js, „kadri-fui“): echte Funktionen
// aus der Quelle mit nachgebildetem tabs.sendMessage. Geprüft: nach oben nur an das Hauptfenster desselben Tabs, nach
// unten nur an genau das gemeldete Dokument; feste Befehle und Felder (Adressen, Cookies o. ä. aus der Nachricht werden
// verworfen); Antworten mit Link nur http(s); ohne documentId oder aus fremden Quellen nichts.
//   node tests/frame_ui_relay_check.js [ROOT]
const fs = require('fs'), path = require('path'), vm = require('vm'), assert = require('assert/strict');
const root = path.resolve(process.argv[2] || path.join(__dirname, '..'));
let passed = 0;
function check(name, value, info) { assert.ok(value, name + (info === undefined ? '' : ' – ' + JSON.stringify(info))); passed++; console.log('PASS ' + name); }

const src = fs.readFileSync(path.join(root, 'chrome/background.js'), 'utf8');
const a = src.indexOf('// ---------- Oberfläche eingebetteter Videos im Hauptfenster');
const b = src.indexOf('api.runtime.onMessage.addListener((m, sender, reply) => {', a);
assert.ok(a > 0 && b > a, 'Abschnitt kadri-fui in chrome/background.js');
const sent = [];
let answer = (msg) => ({ ok: true, mode: 'remote' });
const ctx = { api: { tabs: { sendMessage: (tab, msg, opt) => { sent.push({ tab, msg, opt }); return Promise.resolve(answer(msg, opt)); } } }, Promise, console };
vm.createContext(ctx);
vm.runInContext(src.slice(a, b) + '\nglobalThis.relay = fuiRelay;', ctx);
const N = 'a'.repeat(32), DOC = 'D0C1';
const frame = (extra) => Object.assign({ id: 'x', tab: { id: 7 }, frameId: 3, documentId: DOC, url: 'https://player.example/e/1', origin: 'https://player.example' }, extra || {});
const top = (extra) => Object.assign({ id: 'x', tab: { id: 7 }, frameId: 0, documentId: 'TOP', url: 'https://site.example/film', origin: 'https://site.example' }, extra || {});
const call = (m, s) => new Promise((res) => { sent.length = 0; ctx.relay(Object.assign({ t: 'kadri-fui' }, m), s, res); });

(async () => {
  // nach oben
  let r = await call({ op: 'show', n: N, on: true, url: 'https://cdn.example/v.mp4', cookie: 'c=1' }, frame());
  check('show aus einem Fenster: genau eine Nachricht an das Hauptfenster desselben Tabs', sent.length === 1 && sent[0].tab === 7 && sent[0].opt.frameId === 0 && !('documentId' in sent[0].opt), sent);
  check('… Absender vom Browser (frameId/documentId), keine fremden Felder (Adresse, Cookie) weitergereicht',
    JSON.stringify(sent[0].msg) === JSON.stringify({ t: 'kadri-fui-in', op: 'show', n: N, on: true, src: { f: 3, d: DOC } }), sent[0].msg);
  check('… Antwort nur mit ok/mode', JSON.stringify(r) === '{"ok":true,"mode":"remote"}', r);
  r = await call({ op: 'menu', n: N, seq: 1, title: 'Speichern', items: [{ label: 'A', sub: 'b', fn: 'x', url: 'https://cdn.example/v.mp4', ext: { k: 'open', u: 'https://cdn.example/v.mp4' } }] }, frame());
  check('menu: nur Texte und info (Aktionen/Links der Einträge bleiben im Fenster)', JSON.stringify(sent[0].msg.items) === '[{"label":"A","sub":"b","info":false,"wait":false}]', sent[0].msg.items);
  r = await call({ op: 'menu', n: N, seq: 1, title: 'x', items: new Array(25).fill({ label: 'A' }) }, frame());
  check('menu mit mehr als 24 Einträgen: verworfen', sent.length === 0 && r === null, r);
  r = await call({ op: 'toast', n: N, text: 'x'.repeat(1000) }, frame());
  check('toast: Text gekürzt (300)', sent[0].msg.text.length === 300);
  for (const [name, m, s] of [
    ['ohne documentId', { op: 'show', n: N, on: true }, frame({ documentId: undefined })],
    ['falsche Kennung', { op: 'show', n: 'XYZ', on: true }, frame()],
    ['unbekannter Befehl nach oben', { op: 'act', n: N, a: 'dl' }, frame()],
    ['ohne Tab (Erweiterungsseite)', { op: 'show', n: N, on: true }, frame({ tab: undefined })],
    ['aus einer Nicht-Web-Seite', { op: 'show', n: N, on: true }, frame({ url: 'chrome-extension://x/popup.html', origin: 'chrome-extension://x' })],
    ['undurchsichtige Herkunft (sandbox)', { op: 'show', n: N, on: true }, frame({ url: 'about:blank', origin: 'null' })],
  ]) { r = await call(m, s); check('nach oben verworfen: ' + name, sent.length === 0 && r === null, [sent, r]); }

  r = await call({ op: 'show', n: N, on: true }, frame({ url: 'about:blank', origin: 'https://player.example' }));
  check('Fenster mit Adresse „about:blank“, aber Web-Herkunft: weitergeleitet', sent.length === 1 && sent[0].opt.frameId === 0, sent);

  // nach unten
  answer = () => ({ ok: true, ext: { k: 'open', u: 'https://cdn.example/v.mp4' }, cookie: 'c=1' });
  r = await call({ op: 'act', n: N, a: 'dl', to: { f: 3, d: DOC } }, top());
  check('act vom Hauptfenster: nur an genau das gemeldete Dokument (frameId + documentId)', sent.length === 1 && sent[0].tab === 7 && sent[0].opt.frameId === 3 && sent[0].opt.documentId === DOC, sent);
  check('… nur der feste Befehl', JSON.stringify(sent[0].msg) === JSON.stringify({ t: 'kadri-fui-in', op: 'act', n: N, a: 'dl' }), sent[0].msg);
  check('… Antwort: ok und der http(s)-Link der Aktion, sonst nichts', JSON.stringify(r) === '{"ok":true,"ext":{"k":"open","u":"https://cdn.example/v.mp4"}}', r);
  answer = () => ({ ok: true, ext: { k: 'share-page', u: 'https://site.example/watch?v=1', cookie: 'c=1' } });
  r = await call({ op: 'act', n: N, a: 'share', to: { f: 3, d: DOC } }, top());
  check('typisierter Seitenlink aus genau dem angefragten Dokument, ohne Zusatzfelder',
    sent[0].opt.documentId === DOC && JSON.stringify(r.ext) === '{"k":"share-page","u":"https://site.example/watch?v=1"}', r);
  for (const u of ['javascript:alert(1)', 'intent://x#Intent;end', 'data:text/html,x', 'https://a b']) {
    for (const k of ['share', 'share-page']) {
      answer = () => ({ ok: true, ext: { k, u } });
      r = await call({ op: 'pick', n: N, seq: 2, i: 0, to: { f: 3, d: DOC } }, top());
      check(k + ' mit Link „' + u.slice(0, 12) + '…“: Link verworfen', r && r.ok === true && !r.ext, r);
    }
  }
  answer = () => ({ ok: true, ext: { k: 'run', u: 'https://x.example/' } });
  r = await call({ op: 'pick', n: N, seq: 2, i: 0, to: { f: 3, d: DOC } }, top());
  check('unbekannte Aktion in der Antwort: verworfen', r && !r.ext, r);
  answer = () => ({ ok: true });
  for (const [name, m, s] of [
    ['an das Hauptfenster selbst (f=0)', { op: 'act', n: N, a: 'dl', to: { f: 0, d: 'TOP' } }, top()],
    ['ohne Dokument', { op: 'act', n: N, a: 'dl', to: { f: 3 } }, top()],
    ['unbekannte Aktion', { op: 'act', n: N, a: 'download-url', to: { f: 3, d: DOC } }, top()],
    ['pick mit Nummer außerhalb', { op: 'pick', n: N, seq: 1, i: 99, to: { f: 3, d: DOC } }, top()],
    ['ack mit unbekanntem Zustand', { op: 'ack', n: N, mode: 'fullscreen', to: { f: 3, d: DOC } }, top()],
    ['Befehl nach unten aus einem Fenster', { op: 'act', n: N, a: 'dl', to: { f: 4, d: 'OTHER' } }, frame()],
  ]) { r = await call(m, s); check('nach unten verworfen: ' + name, sent.length === 0, [sent, r]); }

  // Empfänger fehlt (Fenster/Seite weg): null – das Skript fällt kontrolliert zurück
  ctx.api.tabs.sendMessage = () => Promise.reject(new Error('Could not establish connection'));
  r = await call({ op: 'show', n: N, on: true }, frame());
  check('Hauptfenster nicht erreichbar: Antwort null (Fenster zeigt seine Oberfläche selbst)', r === null, r);
  console.log('RESULT frame-ui-relay PASS ' + passed + '/' + passed);
})().catch((e) => { console.error(e); process.exitCode = 1; });
