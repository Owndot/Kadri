// Unit-Tests der Kanal-Zustandsführung OHNE Kryptografie: ein Schein-Kern reicht Klartext durch, ein Schein-Transport
// spielt einen Helfer, der authentisch, aber FALSCH antwortet (das kann ein echter Helfer im Test nicht).
// Prüft, dass Kadri Form und Inhalt der Steuerbefehle und Antworten selbst kontrolliert.
//   node tests/channel/channel_unit_check.js
'use strict';
const { loadChannel, check, expectError, summary } = require('./lib');

const { NS } = loadChannel();

const fakeCore = {
  identity_generate: () => new Uint8Array(64).fill(7),
  KadriHandshake: class {
    hs1() { return new Uint8Array(69); }
    finish() { return { seal_control: (b) => b, open: (r) => r, free() {} }; }
    free() {}
  },
};

const control = (obj) => Uint8Array.from([1, ...new TextEncoder().encode(typeof obj === 'string' ? obj : JSON.stringify(obj))]);
const STATUS = { ok: true, v: 3, dl: false, dash: false, proxy: false, app: 'fake', overlay: true, write: false, vol: 0.4, volStep: 6, volMax: 15, bright: 0.5 };

// Schein-Helfer: antwortet mit der Status-JSON; `bend` ersetzt genau die Antwort auf einen Befehl.
function fakeHelper(bend) {
  const h = { handshakes: 0, sent: [] };
  h.post = async (path, body) => {
    if (path === '/p1/ch/hs') { h.handshakes++; return new Uint8Array(69); }
    const text = new TextDecoder().decode(body);
    h.sent.push(text);
    const req = JSON.parse(text);
    if (bend) return bend(req);
    return control(req.op === 'end' ? { ok: true } : STATUS);
  };
  return h;
}

function channelWith(bend) {
  const helper = fakeHelper(bend);
  const backend = NS.memoryBackend({ identity: new Uint8Array(64).fill(7), pin: { reg: 'ab'.repeat(16), helper: 'cd'.repeat(32), pairedAt: 1 } });
  const store = NS.createStore(backend, fakeCore.identity_generate);
  return { helper, channel: NS.createChannel({ core: fakeCore, store, transport: helper }) };
}

async function main() {
  // ---------- Form der Befehle: genau das, was der Helfer annimmt ----------
  const M = NS.controlMessage;
  const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);
  check('status/beat/end ohne Wert', same(M('status'), { op: 'status' }) && same(M('beat'), { op: 'beat' }) && same(M('end'), { op: 'end' }));
  check('status/beat/end mit Wert abgelehnt', M('status', 1) === null && M('beat', 0) === null && M('end', 0.5) === null);
  check('vol ohne Wert (nur lesen) und 0…1', same(M('vol'), { op: 'vol' }) && same(M('vol', 0), { op: 'vol', v: 0 }) && same(M('vol', 1), { op: 'vol', v: 1 }));
  check('vol außerhalb 0…1 abgelehnt', M('vol', -0.01) === null && M('vol', 1.01) === null);
  check('bright 0,004…1, sonst abgelehnt', same(M('bright', 0.004), { op: 'bright', v: 0.004 }) && M('bright', 0.003) === null && M('bright', 1.5) === null && M('bright') === null);
  check('Werte auf 4 Nachkommastellen, nie mit Exponent', same(M('vol', 1e-7), { op: 'vol', v: 0 }) && JSON.stringify(M('vol', 0.123456789)) === '{"op":"vol","v":0.1235}' &&
    !/e/i.test(JSON.stringify(M('vol', 0.00011))));
  check('Keine Zahlen außer endlichen', [NaN, Infinity, '0.5', null, true, [0.5], { v: 1 }].every((v) => M('bright', v) === null && M('vol', v) === null));
  check('Unbekannte Befehle abgelehnt', ['ping', 'dummy', 'download', 'dlstate', 'pull', 'push', 'pair', 'STATUS', '', undefined, null, 'constructor', '__proto__'].every((op) => M(op) === null));

  // ---------- Befehle über den Kanal ----------
  {
    const { channel, helper } = channelWith(null);
    const r = await channel.command('bright', 0.75);
    check('Befehl erreicht den Helfer in fester Form', helper.sent[0] === '{"op":"bright","v":0.75}' && r.ok === true && r.bright === 0.5, helper.sent[0]);
    check('end → {ok:true}', (await channel.command('end')).ok === true);
    const before = helper.sent.length;
    for (const [op, v] of [['bright', 7], ['vol', -1], ['download', undefined], ['status', 1]]) {
      check('Ungültig (' + op + ',' + v + '): "input", nichts gesendet', await expectError(channel.command(op, v), 'input') === true);
    }
    check('… keine Anfrage für ungültige Befehle', helper.sent.length === before);
  }
  {
    const { channel, helper } = channelWith(() => control({ ok: false }));
    const r = await channel.command('status');
    check('Antwort {ok:false} (Helfer lehnt Befehl ab): gemeldet, Sitzung bleibt', r.ok === false && helper.handshakes === 1);
    await channel.command('status');
    check('… kein neuer Handshake', helper.handshakes === 1);
  }
  const replies = [
    ['keine Steuer-Record-Art', () => Uint8Array.from([2, 0, 0, 0, 1])],
    ['Medien-Record mit gültigem JSON', () => Uint8Array.from([2, ...new TextEncoder().encode(JSON.stringify(STATUS))])],
    ['Ende-Record mit gültigem JSON', () => Uint8Array.from([3, ...new TextEncoder().encode('{"ok":true}')])],
    ['kein JSON', () => control('nicht json')],
    ['JSON-Array', () => control([1, 2])],
    ['JSON-Zahl', () => control('3')],
    ['ok fehlt', () => control({ v: 3 })],
    ['ok kein Wahrheitswert', () => control({ ok: 'true' })],
    ['ungültiges UTF-8', () => Uint8Array.from([1, 0xff, 0xfe])],
  ];
  for (const [name, bend] of replies) {
    const { channel, helper } = channelWith(bend);
    check('Antwort ' + name + ' → "protocol"', await expectError(channel.command('status'), 'protocol') === true);
    await channel.command('status').catch(() => {});
    check('Antwort ' + name + ' → Sitzung verworfen (neuer Handshake)', helper.handshakes === 2, 'handshakes=' + helper.handshakes);
  }
  // Review I1: nach HTTP 404 werden genau die fünf Steuerbefehle einmal wiederholt (absolute Werte, Abfragen).
  check('Wiederholung nach 404 nur für die fünf Steuerbefehle', ['status', 'beat', 'end', 'vol', 'bright'].every((op) => NS.retryableAfterStaleSession(op)) &&
    !['ping', 'dummy', 'download', 'push', 'pull', 'pair', '', undefined].some((op) => NS.retryableAfterStaleSession(op)));
  summary('channel-unit');
}

main().catch((e) => { console.error(e); process.exitCode = 1; });
