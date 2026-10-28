// Unit-Tests der Kanal-Zustandsführung OHNE Kryptografie: ein Schein-Kern reicht Klartext durch, ein Schein-Transport
// spielt einen Helfer, der authentisch, aber FALSCH antwortet (das kann ein echter Helfer im Test nicht).
// Prüft, dass Kadri Inhalt, Reihenfolge und Grenzen der Antworten selbst kontrolliert.
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

const media = (transfer, offset, data) => {
  const r = new Uint8Array(13 + data.length), dv = new DataView(r.buffer);
  r[0] = 2; dv.setUint32(1, transfer); dv.setBigUint64(5, BigInt(offset)); r.set(data, 13);
  return r;
};
const end = (transfer, total) => {
  const r = new Uint8Array(13), dv = new DataView(r.buffer);
  r[0] = 3; dv.setUint32(1, transfer); dv.setBigUint64(5, BigInt(total));
  return r;
};
const pattern = (transfer, offset, n) => Uint8Array.from({ length: n }, (_, i) => ((offset + i) * 31 + 7 + transfer) % 256);
const control = (obj) => Uint8Array.from([1, ...new TextEncoder().encode(typeof obj === 'string' ? obj : JSON.stringify(obj))]);

// Schein-Helfer: liefert korrekte Dummy-Records; `bend` verfälscht genau eine Antwort.
function fakeHelper(bend) {
  const h = { handshakes: 0 };
  h.post = async (path, body) => {
    if (path === '/p1/ch/hs') { h.handshakes++; return new Uint8Array(69); }
    const req = JSON.parse(new TextDecoder().decode(body));
    if (req.op === 'ping') return bend && bend.ping ? bend.ping() : control({ ok: true, helper: 'fake' });
    const { transfer, size, offset } = req;
    let reply = offset >= size ? end(transfer, size) : media(transfer, offset, pattern(transfer, offset, Math.min(61440, size - offset)));
    if (bend && bend.dummy) reply = bend.dummy(req, reply) || reply;
    return reply;
  };
  return h;
}

async function channelWith(bend) {
  const helper = fakeHelper(bend);
  const backend = NS.memoryBackend({ identity: new Uint8Array(64).fill(7), pin: { reg: 'ab'.repeat(16), helper: 'cd'.repeat(32), pairedAt: 1 } });
  const store = NS.createStore(backend, fakeCore.identity_generate);
  return { helper, channel: NS.createChannel({ core: fakeCore, store, transport: helper }) };
}

async function main() {
  {
    const { channel } = await channelWith(null);
    const r = await channel.dummy(200000, 3);
    check('Schein-Helfer korrekt: Muster und Reihenfolge wie beim echten Helfer', r.bytes === 200000 && r.records === 4, JSON.stringify(r));
  }
  const cases = [
    ['falsches Byte im Dummy-Inhalt', { dummy: (q, r) => { if (q.offset === 61440) { r[20] ^= 1; return r; } } }],
    ['falscher Offset', { dummy: (q, r) => (q.offset === 61440 ? media(q.transfer, 0, pattern(q.transfer, 0, 61440)) : null) }],
    ['falsche Transfer-Nummer', { dummy: (q) => (q.offset === 0 ? media(q.transfer + 1, 0, pattern(q.transfer + 1, 0, 61440)) : null) }],
    ['Record über 60 KiB', { dummy: (q) => (q.offset === 0 ? media(q.transfer, 0, pattern(q.transfer, 0, 61441)) : null) }],
    ['Daten über die angefragte Größe hinaus', { dummy: (q) => (q.offset === 184320 ? media(q.transfer, 184320, pattern(q.transfer, 184320, 61440)) : null) }],
    ['vorzeitiges Ende', { dummy: (q) => (q.offset === 61440 ? end(q.transfer, 200000) : null) }],
    ['Ende mit falscher Gesamtgröße', { dummy: (q) => (q.offset >= q.size ? end(q.transfer, q.size + 1) : null) }],
    ['leerer Medien-Record', { dummy: (q) => (q.offset === 0 ? media(q.transfer, 0, new Uint8Array(0)) : null) }],
    ['unbekannte Record-Art', { dummy: (q, r) => { r[0] = 9; return r; } }],
  ];
  for (const [name, bend] of cases) {
    const { channel, helper } = await channelWith(bend);
    check('Dummy: ' + name + ' → "protocol"', await expectError(channel.dummy(200000, 3), 'protocol') === true);
    await channel.ping().catch(() => {});
    check('Dummy: ' + name + ' → Sitzung verworfen (neuer Handshake)', helper.handshakes === 2, 'handshakes=' + helper.handshakes);
  }
  const pings = [
    ['Antwort keine Steuer-Record-Art', () => media(1, 0, new Uint8Array(1))],
    ['Antwort kein JSON', () => control('nicht json')],
    ['Antwort ok:false', () => control({ ok: false })],
    ['Antwort ungültiges UTF-8', () => Uint8Array.from([1, 0xff, 0xfe])],
  ];
  for (const [name, ping] of pings) {
    const { channel } = await channelWith({ ping });
    check('Ping: ' + name + ' → "protocol"', await expectError(channel.ping(), 'protocol') === true);
  }
  {
    const { channel } = await channelWith({ ping: () => control({ ok: true, helper: 'x'.repeat(500) }) });
    check('Ping: Helfer-Kennung auf 40 Zeichen begrenzt', (await channel.ping()).helper.length === 40);
  }
  // Review I1: nur Befehle ohne Wirkung werden nach HTTP 404 automatisch wiederholt.
  check('Wiederholung nach 404 nur für ping und dummy', NS.retryableAfterStaleSession('ping') && NS.retryableAfterStaleSession('dummy') &&
    !['download', 'push', 'bright', 'vol', 'end', 'pair', '', undefined].some((op) => NS.retryableAfterStaleSession(op)));
  summary('channel-unit');
}

main().catch((e) => { console.error(e); process.exitCode = 1; });
