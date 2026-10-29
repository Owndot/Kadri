// Integrationstests des Helfer-Kanals: Kanal-Module + vendorter WASM-Kern in Node gegen den echten ChannelServer der
// Helper-App (Desktop, ChannelHarness; nur das Gerät ist nachgebildet). Keine Gerätetests, keine Medien.
//   HELPER_HOST_DIR=<Helper-Repo: tests/java/channel/build.sh OUT> node tests/channel/channel_integration_check.js
'use strict';
const http = require('http');
const { loadChannel, startHelper, check, expectError, summary } = require('./lib');

const { NS, core } = loadChannel();
const PORT = 47899;

function setup(opts = {}) {
  const backend = opts.backend || NS.memoryBackend();
  const store = NS.createStore(backend, () => core.identity_generate());
  const transport = NS.createTransport({ fetchImpl: opts.fetchImpl || fetch, port: opts.port || PORT, timeoutMs: opts.timeoutMs || 5000, tap: opts.tap || null });
  return { backend, store, channel: NS.createChannel({ core, store, transport }) };
}

// Fremder lokaler Dienst für Transport-Grenzen (eigener Port, nicht der Helfer).
function fakeServer(handler) {
  return new Promise((res) => {
    const s = http.createServer(handler);
    s.listen(0, '127.0.0.1', () => res({ port: s.address().port, close: () => new Promise((r) => { s.closeAllConnections(); s.close(r); }) }));
  });
}

async function main() {
  const h = startHelper();
  const ready = await h.ready;
  check('Desktop-Helfer (ChannelServer) gestartet', /^READY [0-9a-f]{8}$/.test(ready), ready);
  try {
    // ---------- Kopplung und Steuerbefehle ----------
    {
      const { channel, backend } = setup();
      const r = await channel.pair(await h.code());
      check('Kopplung per Code: Pin erst nach authentisierter Bestätigung', r.reg.length === 8 && r.replacedPrevious === false);
      check('Helfer: Registrierung bestätigt', (await h.regs()).length === 1 && (await h.regs())[0].endsWith(':confirmed'));
      const p = await channel.command('status');
      check('Status über den authentisierten Kanal (Downloads aus)', p.ok === true && p.app === 'harness' && p.dl === false && p.proxy === false && p.dash === false, JSON.stringify(p));
      const b = await channel.command('bright', 0.3);
      const d0 = await h.device();
      check('Helligkeit kommt am Gerät an', b.ok === true && d0.bright === 0.3 && d0.overriding === true, JSON.stringify(d0));
      await channel.command('vol', 0.6);
      check('Lautstärke kommt am Gerät an', (await h.device()).volStep === 9);
      const vRead = await channel.command('vol');
      check('vol ohne Wert ändert nichts', vRead.volStep === 9 && (await h.device()).vols === 1);
      await channel.command('beat');
      check('Lebenszeichen', (await h.device()).beats >= 2);
      check('end gibt die Helligkeit zurück', (await channel.command('end')).ok === true && (await h.device()).overriding === false);
      const keys = Array.from(backend.dump().keys()).sort().join(',');
      check('Gespeichert werden nur Identität und Pin (kein Sitzungsmaterial)', keys === 'identity,pin', keys);
      check('Status verbunden', (await channel.status()).state === 'connected');
      await h.cmd('revoke-all');
    }

    // ---------- Einzelwiderruf (hostRevoke): nur dieser Browser ----------
    {
      const a = setup(), b = setup();
      const ra = await a.channel.pair(await h.code());
      const rb = await b.channel.pair(await h.code());
      const ids = await h.regs();
      const idA = ids.map((x) => x.split(':')[0]).find((x) => x.startsWith(ra.reg));
      check('Zwei Browser gekoppelt', ids.length === 2 && !!idA, ids.join(' '));
      check('Einzelwiderruf gespeichert', (await h.cmd('revoke ' + idA)) === 'REVOKED saved');
      check('Widerrufener Browser: "rejected"', await expectError(a.channel.command('status'), 'rejected') === true);
      check('Anderer Browser arbeitet weiter', (await b.channel.command('status')).ok === true && (await h.regs()).length === 1 && (await h.regs())[0].startsWith(rb.reg));
      await h.cmd('restart');
      check('Einzelwiderruf übersteht Helfer-Neustart', await expectError(a.channel.command('status'), 'rejected') === true && (await b.channel.command('status')).ok === true);
      await h.cmd('revoke-all');
    }

    // ---------- falscher Kopplungscode ----------
    {
      const { channel } = setup();
      const code = await h.code();
      const wrong = (code[0] === '9' ? '0' : String(+code[0] + 1)) + code.slice(1);
      const e = await expectError(channel.pair(wrong), 'pair-rejected');
      check('Falscher Code wird abgelehnt', e === true, String(e));
      check('Code-Fenster nach einem Fehlversuch verbraucht', await expectError(channel.pair(code), 'pair-rejected') === true);
      check('Nach Fehlversuch nichts gespeichert', !(await channel.status()).paired);
      for (const bad of ['1234567', '123456789', 'abcdefgh', '']) check('Ungültiges Codeformat "' + bad + '" abgelehnt', await expectError(channel.pair(bad), 'input') === true);
    }

    // ---------- Worker-Neustart, dauerhafte Speicherung, Helfer-Neustart ----------
    {
      const a = setup();
      await a.channel.pair(await h.code());
      const b = setup({ backend: a.backend });   // neuer Worker: gleicher Speicher, kein Sitzungszustand
      check('Neuer Worker nutzt gespeicherte Kopplung (neuer Handshake)', (await b.channel.command('status')).ok);
      check('Gespeicherte Kopplung bleibt nach Worker-Neustart gleich', (await b.channel.status()).reg === (await a.channel.status()).reg);
      await h.cmd('restart');
      check('Nach Helfer-Neustart: alte Sitzung unbekannt → genau ein neuer Handshake', (await b.channel.command('status')).ok);
      await h.cmd('restart');
      const br = await b.channel.command('bright', 0.42);
      check('Nach Helfer-Neustart: Helligkeit genau einmal neu gesendet und angekommen', br.ok === true && (await h.device()).bright === 0.42);
      await h.cmd('revoke-all');
    }

    // ---------- Widerruf ----------
    {
      const { channel } = setup();
      const first = await channel.pair(await h.code());
      check('Widerruf (Helfer meldet gespeichert)', (await h.cmd('revoke-all')) === 'REVOKED saved');
      check('Nach Widerruf: Zustand "rejected", keine Übertragung', await expectError(channel.command('status'), 'rejected') === true);
      const st = await channel.status();
      check('Widerruf ändert den Pin nicht automatisch', st.paired && st.reg === first.reg && st.state === 'rejected', JSON.stringify(st));
      await h.cmd('restart');
      check('Widerruf übersteht Helfer-Neustart', await expectError(channel.command('status'), 'rejected') === true);
      const again = await channel.pair(await h.code());
      check('Neue Kopplung nach Widerruf', again.replacedPrevious && !again.helperChanged && (await channel.command('status')).ok);
      await h.cmd('revoke-all');
    }

    // ---------- unbekannte Helfer-Identität ----------
    {
      const { channel } = setup();
      const first = await channel.pair(await h.code());
      await h.cmd('rogue-on');
      const brightBefore = (await h.device()).brights;
      check('Fremder Listener bei offener Sitzung: gefälschte Antwort erkannt ("tampered")', await expectError(channel.command('bright', 0.9), 'tampered') === true);
      check('Fremder Listener beim neuen Handshake: "identity-mismatch"', await expectError(channel.command('status'), 'identity-mismatch') === true);
      check('Status zeigt den Identitätskonflikt', (await channel.status()).state === 'identity-mismatch');
      check('Fremder Listener: Pin unverändert', (await channel.status()).reg === first.reg);
      const off = await h.cmd('rogue-off');
      check('Fremder Listener sah keinen Klartext (keinen Befehl, keinen Wert)', /plaintextHits=0 /.test(off) && !/0\.9/.test(off), off);
      check('Kein Befehl am echten Gerät angekommen', (await h.device()).brights === brightBefore);
      check('Echter Helfer zurück: Kanal funktioniert ohne neue Kopplung', (await channel.command('status')).ok);
      await h.cmd('reset-identity');
      check('Helfer-Identität zurückgesetzt: alte Kopplung abgewiesen', await expectError(channel.command('status'), 'rejected') === true);
      const again = await channel.pair(await h.code());
      check('Bewusste Neukopplung meldet den Identitätswechsel', again.helperChanged === true && again.helper !== first.helper);
      await h.cmd('revoke-all');
    }

    // ---------- manipulierte und wiederholte Records ----------
    {
      let mode = null, captured = null, lastReply = null;
      const tap = {
        request: (path, b) => {
          if (path === '/p1/ch/rec') captured = b.slice();
          if (path === '/p1/ch/rec' && mode === 'flip-out') { mode = null; const c = b.slice(); c[c.length - 3] ^= 1; return c; }
          return b;
        },
        response: (path, b) => {
          if (path !== '/p1/ch/rec') return b;
          if (mode === 'flip-in') { mode = null; const c = b.slice(); c[c.length - 3] ^= 1; return c; }
          if (mode === 'replay-in' && lastReply) { mode = null; return lastReply; }
          lastReply = b.slice();
          return b;
        },
      };
      const { channel } = setup({ tap });
      await channel.pair(await h.code());
      await channel.command('status');
      mode = 'flip-in';
      check('Manipulierte Antwort: Sitzung beendet ("tampered")', await expectError(channel.command('status'), 'tampered') === true);
      check('Danach neuer Handshake, Kanal wieder nutzbar', (await channel.command('status')).ok);
      mode = 'flip-out';
      check('Manipulierte Anfrage: Helfer lehnt ab ("record-rejected")', await expectError(channel.command('status'), 'record-rejected') === true);
      check('Danach wieder nutzbar', (await channel.command('status')).ok);
      mode = 'replay-in';
      check('Wiederholte (alte) Antwort wird erkannt ("tampered")', await expectError(channel.command('status'), 'tampered') === true);
      await channel.command('status');
      const old = captured;
      await channel.command('status');
      const r = await fetch('http://127.0.0.1:' + PORT + '/p1/ch/rec', { method: 'POST', body: old, headers: { 'Content-Type': 'application/octet-stream', 'X-Kadri-Helper': '2' } });
      check('Wiederholter Record (Replay) vom Helfer abgelehnt', r.status === 400, 'HTTP ' + r.status);
      check('Nach Replay (bekanntes Risiko R2: Sitzung beendet) baut der Kanal neu auf', (await channel.command('status')).ok);
      await h.cmd('revoke-all');
    }

    // ---------- gescheiterte Bestätigung einer neuen Kopplung (R4) ----------
    {
      let flipHs = false;
      const tap = { response: (path, b) => { if (path === '/p1/ch/hs' && flipHs) { flipHs = false; const c = b.slice(); c[c.length - 1] ^= 1; return c; } return b; } };
      const { channel } = setup({ tap });
      const first = await channel.pair(await h.code());
      flipHs = true;   // die neue Kopplung gelingt, ihr erster Handshake wird verfälscht
      const e = await expectError(channel.pair(await h.code()), 'confirm-failed');
      check('Neue Kopplung ohne erfolgreiche Bestätigung wird nicht übernommen', e === true, String(e));
      check('… vorherige Kopplung bleibt gespeichert und funktioniert', (await channel.status()).reg === first.reg && (await channel.command('status')).ok);
      await h.cmd('revoke-all');
    }

    // ---------- konkurrierende Anfragen und Warteschlangen-Grenze ----------
    {
      const { channel } = setup();
      await channel.pair(await h.code());
      const many = await Promise.allSettled(Array.from({ length: 20 }, (_, i) => channel.command(i % 2 ? 'beat' : 'status')).concat([channel.command('bright', 0.2)]));
      check('20 parallele Befehle + Helligkeit nacheinander abgearbeitet', many.every((x) => x.status === 'fulfilled'), many.filter((x) => x.status !== 'fulfilled').map((x) => x.reason && x.reason.kind).join(','));
      const flood = await Promise.allSettled(Array.from({ length: 40 }, () => channel.command('status')));
      const busy = flood.filter((x) => x.status === 'rejected' && x.reason.kind === 'busy').length;
      check('Warteschlange begrenzt (32): Überlauf wird abgewiesen, Rest bedient', busy === 8 && flood.filter((x) => x.status === 'fulfilled').length === 32, 'busy=' + busy);
      const pairs = await Promise.allSettled([channel.pair(await h.code()), channel.command('status')]);
      check('Kopplung und Anfrage gleichzeitig: nacheinander, beide erfolgreich', pairs.every((x) => x.status === 'fulfilled'));
      await h.cmd('revoke-all');
    }

    // ---------- fehlgeschlagene Persistenz ----------
    {
      const a = setup();
      a.backend.failWrites = 1;   // Identität kann nicht gespeichert werden
      check('Identität nicht speicherbar: Kopplung bricht ab', await expectError(a.channel.pair(await h.code()), 'storage') === true);
      const first = await a.channel.pair(await h.code());
      a.backend.failWrites = 1;   // neuer Pin kann nicht gespeichert werden
      const e = await expectError(a.channel.pair(await h.code()), 'storage');
      check('Neuer Pin nicht speicherbar: Fehler gemeldet', e === true, String(e));
      check('… vorherige Kopplung bleibt und funktioniert', (await a.channel.status()).reg === first.reg && (await a.channel.command('status')).ok);
      a.backend.failWrites = 1;
      check('Vergessen nicht speicherbar: Fehler, Kopplung bleibt', await expectError(a.channel.forget(), 'storage') === true && (await a.channel.status()).paired);
      await h.cmd('fail-persist on');
      check('Helfer kann Kopplung nicht speichern: kein M3, nichts gepinnt', await expectError(setup().channel.pair(await h.code()), 'pair-rejected') === true);
      check('Helfer kann Widerruf nicht speichern: meldet das und stoppt', (await h.cmd('revoke-all')) === 'REVOKE_NOT_DURABLE server stopped');
      const down = await expectError(a.channel.command('status'), 'unreachable');
      check('Kadri sieht danach "unreachable", keine Ausweichroute', down === true, String(down));
      await h.cmd('fail-persist off');
      await h.cmd('restart');
      await h.cmd('revoke-all');
    }

    // ---------- Speicherzustände ohne stille Identitätsrotation ----------
    {
      const id = core.identity_generate();
      const orphan = setup({ backend: NS.memoryBackend({ pin: { reg: '00'.repeat(16), helper: '11'.repeat(32) } }) });
      check('Pin ohne Identität: keine neue Identität ("inconsistent")', await expectError(orphan.store.identity(), 'inconsistent') === true);
      const corrupt = setup({ backend: NS.memoryBackend({ identity: id, pin: { reg: 'zz', helper: 'yy' } }) });
      check('Beschädigter Pin: Zustand gemeldet, nicht gelöscht', (await corrupt.channel.status()).state === 'storage-corrupt' && corrupt.backend.dump().has('pin'));
      const r = await corrupt.channel.pair(await h.code());
      check('Bewusste Neukopplung ersetzt beschädigten Pin', !r.replacedPrevious && (await corrupt.channel.command('status')).ok);
      const badId = setup({ backend: NS.memoryBackend({ identity: new Uint8Array(10) }) });
      check('Beschädigte Identität wird nicht ersetzt', await expectError(badId.store.identity(), 'corrupt') === true);
      await h.cmd('revoke-all');
    }

    // ---------- Zeitgrenzen und Ressourcengrenzen des Transports ----------
    {
      const slow = await fakeServer(() => {});   // antwortet nie
      const t = setup({ port: slow.port, timeoutMs: 300 });
      const tr = NS.createTransport({ fetchImpl: fetch, port: slow.port, timeoutMs: 300 });
      const e = await tr.post('/p1/ch/hs', new Uint8Array(69)).then(() => 'no error', (x) => x.kind);
      check('Hängender Dienst: Zeitgrenze greift', e === 'timeout', e);
      check('Kopplung gegen hängenden Dienst: "timeout"', await expectError(t.channel.pair('12345678'), 'timeout') === true);
      await slow.close();
      const big = await fakeServer((req, res) => { res.writeHead(200, { 'Content-Length': 70000 }); res.end(Buffer.alloc(70000)); });
      const e2 = await NS.createTransport({ fetchImpl: fetch, port: big.port }).post('/p1/ch/hs', new Uint8Array(69)).then(() => 'no error', (x) => x.kind);
      check('Zu große Antwort abgewiesen', e2 === 'framing', e2);
      await big.close();
      const chunked = await fakeServer((req, res) => { res.writeHead(200); res.write(Buffer.alloc(10)); res.end(); });
      const e3 = await NS.createTransport({ fetchImpl: fetch, port: chunked.port }).post('/p1/ch/hs', new Uint8Array(69)).then(() => 'no error', (x) => x.kind);
      check('Antwort ohne Content-Length abgewiesen', e3 === 'framing', e3);
      await chunked.close();
      // Das Ziel der Weiterleitung antwortet gültig – würde ihr gefolgt, käme eine Antwort zurück. (303, weil Node einen
      // POST-Body bei 307 nicht erneut senden kann; so prüft der Test wirklich das Verfolgen, nicht diese Eigenheit.)
      const target = await fakeServer((req, res) => { res.writeHead(200, { 'Content-Length': 5 }); res.end('hello'); });
      const redir = await fakeServer((req, res) => { res.writeHead(303, { Location: 'http://127.0.0.1:' + target.port + '/p1/ch/hs' }); res.end(); });
      const e4 = await NS.createTransport({ fetchImpl: fetch, port: redir.port }).post('/p1/ch/hs', new Uint8Array(69)).then(() => 'no error', (x) => x.kind);
      check('Weiterleitung wird nicht verfolgt (auch nicht zu einem antwortenden Ziel)', e4 === 'http' || e4 === 'unreachable', e4);
      await redir.close(); await target.close();
      const tr2 = NS.createTransport({ fetchImpl: fetch, port: PORT });
      check('Nur die vier Protokollpfade', await tr2.post('/ping', new Uint8Array(1)).then(() => 'no error', (x) => x.kind) === 'config');
      check('Anfrage über Record-Größe abgewiesen', await tr2.post('/p1/ch/rec', new Uint8Array(65557)).then(() => 'no error', (x) => x.kind) === 'config');
      const { channel } = setup();
      await channel.pair(await h.code());
      check('Ungültiger Befehl verlässt Kadri nicht', await expectError(channel.command('download'), 'input') === true);
      check('Port des alten Helfers ist kein Kanal-Port', (() => { try { NS.createTransport({ fetchImpl: fetch, port: 80 }); return false; } catch (x) { return x.kind === 'config'; } })());
      await h.cmd('revoke-all');
    }

    const leaked = h.events.filter((l) => /[0-9]{8}/.test(l.replace(/reg=[0-9a-f]{8}…/, '')) && /CODE|code/.test(l));
    check('Helfer-Protokoll enthält keine Codes', leaked.length === 0, leaked.join(' | '));
  } finally {
    await h.stop();
  }
  summary('channel-integration');
}

main().catch((e) => { console.error(e); process.exitCode = 1; });
