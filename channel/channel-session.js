// Kadri – Helfer-Kanal (TEST-Stufe): Kopplung, authentisierter Kanal und die einzigen Befehle dieser Stufe.
// Kryptografie ausschließlich im geprüften Rust/WASM-Kern (SPAKE2-Kopplung, Noise_KK-Kanal). Diese Datei verwaltet
// nur Zustände und Reihenfolge.
//
// Befehle dieser Stufe: "ping" und begrenzte "dummy"-Daten. Keine Medien-URLs, Cookies, Header oder echten Medien.
//
// Sicherheitsregeln:
//  - Ein neuer Pin ersetzt den alten erst nach dem ersten erfolgreichen authentisierten Austausch (Review R4) und erst,
//    wenn er gespeichert ist. Scheitert etwas, bleibt die vorherige Kopplung unverändert.
//  - Keine automatische Annahme einer neuen Helfer-Identität: ein Handshake, der nicht vom gepinnten Schlüssel stammt,
//    endet im Zustand "identity-mismatch"; eine vom Helfer nicht (mehr) anerkannte Kopplung (Widerruf, Helfer
//    zurückgesetzt) im Zustand "rejected". Beides ändert den Pin nicht; nur eine bewusste neue Kopplung per Code hilft.
//  - Jeder Fehler im Kanal beendet die Sitzung (keine Wiederverwendung nach Manipulation). Einzige automatische
//    Wiederholung: Kennt der Helfer die Sitzung nicht (HTTP 404, z. B. nach seinem Neustart), wird EINMAL ein neuer
//    authentisierter Handshake gemacht – der Record wurde dann nachweislich nicht verarbeitet. Das gilt nur für
//    Befehle ohne Wirkung (ping, dummy); alle anderen melden den Fehler (Review I1).
//  - Alle Aktionen laufen nacheinander (höchstens ein offener Record); die Warteschlange ist begrenzt.
//  - Fristen der Kopplung auf der monotonen Uhr (performance.now, Review R3).
(function (root) {
  'use strict';
  const NS = root.KadriChannel = root.KadriChannel || {};

  const PAIR_TTL_MS = 60_000;
  const MAX_QUEUE = 32;
  const RECORD_DATA_MAX = 60 * 1024;
  const DUMMY_MAX = 8 * 1024 * 1024;
  // Nur Befehle ohne Wirkung beim Helfer dürfen nach HTTP 404 (Sitzung unbekannt) einmal mit neuem Handshake
  // wiederholt werden (Review I1). Künftige Befehle mit Wirkung kommen NICHT in diese Liste.
  const IDEMPOTENT_OPS = new Set(['ping', 'dummy']);
  const retryableAfterStaleSession = (op) => IDEMPOTENT_OPS.has(op);

  class ChannelError extends Error {
    constructor(kind, message) { super(message); this.kind = kind; }
  }

  const MESSAGES = {
    unpaired: 'Nicht gekoppelt',
    rejected: 'Der Helfer erkennt diese Kopplung nicht (mehr) an – widerrufen oder Helfer zurückgesetzt. Neu koppeln.',
    'identity-mismatch': 'Antwort stammt nicht vom gekoppelten Helfer (fremder Dienst auf dem Port oder neue Helfer-Identität). Nichts übertragen; Kopplung unverändert.',
    unreachable: 'Helfer nicht erreichbar',
    timeout: 'Helfer antwortet nicht rechtzeitig',
    tampered: 'Antwort manipuliert oder ungültig – Sitzung beendet',
    'record-rejected': 'Helfer hat die Anfrage abgelehnt – Sitzung beendet',
    protocol: 'Unerwartete Antwort – Sitzung beendet',
    busy: 'Zu viele offene Anfragen',
  };

  const coreError = (e) => String((e && e.message) || e);

  // core: der WASM-Kern (wasm_bindgen-Exporte). store: createStore(...). transport: createTransport(...).
  function createChannel({ core, store, transport, now = () => performance.now() }) {
    let session = null;          // { ch, reg } – nur im Arbeitsspeicher, nie gespeichert
    let state = 'unknown';
    let lastError = null;
    let chain = Promise.resolve();
    let queued = 0;

    const drop = () => {
      if (session) { try { session.ch.free(); } catch (e) {} session = null; }
    };
    const fail = (kind, message) => {
      lastError = { kind, message: message || MESSAGES[kind] || kind };
      return new ChannelError(kind, lastError.message);
    };
    const transportKind = (e) => (e && (e.kind === 'timeout' || e.kind === 'unreachable')) ? e.kind : null;

    // Höchstens eine Aktion gleichzeitig; begrenzte Warteschlange (Ressourcengrenze).
    function serial(fn) {
      if (queued >= MAX_QUEUE) return Promise.reject(fail('busy'));
      queued++;
      const run = () => fn().finally(() => { queued--; });
      const p = chain.then(run, run);
      chain = p.catch(() => {});
      return p;
    }

    // Authentisierter Handshake mit genau dem gepinnten Helfer-Schlüssel.
    async function connect(pin, identity) {
      drop();
      const hs = new core.KadriHandshake(identity, NS.unhex(pin.helper), NS.unhex(pin.reg));
      try {
        let hs2;
        try { hs2 = await transport.post('/p1/ch/hs', hs.hs1()); }
        catch (e) {
          if (e.kind === 'http' && e.status === 400) { state = 'rejected'; throw fail('rejected'); }
          if (transportKind(e)) { state = 'unreachable'; throw fail(transportKind(e)); }
          state = 'unreachable'; throw fail('protocol', e.message);
        }
        try { session = { ch: hs.finish(hs2), reg: pin.reg }; }
        catch (e) {
          // Nicht vom gepinnten Schlüssel signiert/verschlüsselt: fremder Dienst oder andere Helfer-Identität.
          state = 'identity-mismatch';
          throw fail(coreError(e) === 'AuthFailed' ? 'identity-mismatch' : 'protocol', coreError(e) === 'AuthFailed' ? undefined : 'Handshake-Antwort ungültig (' + coreError(e) + ')');
        }
      } finally {
        hs.free();
      }
      state = 'connected';
    }

    // Ein Record hin, einer zurück. Jeder Fehler beendet die Sitzung.
    async function exchange(obj) {
      const s = session;
      let reply;
      try { reply = await transport.post('/p1/ch/rec', s.ch.seal_control(new TextEncoder().encode(JSON.stringify(obj)))); }
      catch (e) {
        if (session === s) drop();
        if (e instanceof ChannelError) throw e;
        if (e.kind === 'http' && e.status === 404) throw new ChannelError('stale-session', 'Sitzung beim Helfer unbekannt');
        if (e.kind === 'http') { state = 'paired'; throw fail('record-rejected'); }
        if (transportKind(e)) { state = 'unreachable'; throw fail(transportKind(e)); }
        state = 'paired'; throw fail('protocol', e.message);
      }
      try { return s.ch.open(reply); }
      catch (e) {
        if (session === s) drop();
        state = 'paired';
        throw fail('tampered', MESSAGES.tampered + ' (' + coreError(e) + ')');
      }
    }

    async function request(obj) {
      return serial(async () => {
        const pin = await store.pin();
        if (!pin) { drop(); state = 'unpaired'; throw fail('unpaired'); }
        if (session && session.reg !== pin.reg) drop();
        if (!session) await connect(pin, await store.identity());
        try { return await exchange(obj); }
        catch (e) {
          if (e.kind !== 'stale-session') throw e;
          if (!retryableAfterStaleSession(obj.op)) throw fail('stale-session', 'Sitzung beim Helfer unbekannt – Befehl nicht automatisch wiederholt');
          await connect(pin, await store.identity());   // genau einmal
          try { return await exchange(obj); }
          catch (e2) { throw e2.kind === 'stale-session' ? fail('record-rejected') : e2; }
        }
      });
    }

    // ---------- öffentliche Aktionen ----------
    async function pair(code) {
      code = String(code || '');
      if (!/^[0-9]{8}$/.test(code)) throw fail('input', 'Der Code hat genau 8 Ziffern');
      return serial(async () => {
        let previous = null;
        try { previous = await store.pin(); } catch (e) { if (e.kind !== 'corrupt') throw e; }
        const identity = await store.identity();
        const flow = new core.KadriPairingFlow(code, identity.subarray(32), now(), PAIR_TTL_MS);
        let candidate;
        try {
          const m1 = await transport.post('/p1/pair/m0', flow.m0());
          const m3 = await transport.post('/p1/pair/m2', flow.on_m1(m1, now()));
          const p = flow.on_m3(m3, now());
          candidate = { reg: NS.hex(p.subarray(0, 16)), helper: NS.hex(p.subarray(16)) };
        } catch (e) {
          if (e.kind === 'http') throw fail('pair-rejected', 'Kopplung abgelehnt (falscher Code, Fenster abgelaufen oder schon benutzt)');
          if (transportKind(e)) throw fail(transportKind(e));
          throw fail('pair-failed', 'Kopplung fehlgeschlagen (' + coreError(e) + ') – falscher Code oder nicht der Helfer');
        } finally {
          flow.free();
        }
        const keep = previous ? 'vorherige Kopplung bleibt' : 'keine Kopplung gespeichert';
        try {
          await connect(candidate, identity);
          const r = await exchange({ op: 'ping' });
          if (r[0] !== 1) throw new ChannelError('protocol', 'unerwartete Bestätigung');
        } catch (e) {
          drop();
          state = previous ? 'paired' : 'unpaired';
          throw fail('confirm-failed', 'Bestätigung fehlgeschlagen (' + e.message + '); ' + keep);
        }
        try { await store.setPin(candidate); }
        catch (e) {
          drop();
          state = previous ? 'paired' : 'unpaired';
          throw fail('storage', 'Kopplung bestätigt, aber nicht gespeichert; ' + keep);
        }
        lastError = null;
        return {
          reg: candidate.reg.slice(0, 8), helper: candidate.helper.slice(0, 8),
          replacedPrevious: !!previous, helperChanged: !!previous && previous.helper !== candidate.helper,
        };
      });
    }

    async function ping() {
      const r = await request({ op: 'ping' });
      if (r[0] !== 1) { drop(); throw fail('protocol'); }
      let reply;
      try { reply = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(r.subarray(1))); } catch (e) { drop(); throw fail('protocol'); }
      if (!reply || reply.ok !== true) { drop(); throw fail('protocol'); }
      lastError = null;
      return { ok: true, helper: String(reply.helper || '').slice(0, 40) };
    }

    // Begrenzte Dummy-Daten (kein Medium): size Bytes in Records zu höchstens 60 KiB; Inhalt und Reihenfolge geprüft.
    async function dummy(size, transfer = 1) {
      if (!Number.isSafeInteger(size) || size < 1 || size > DUMMY_MAX) throw fail('input', 'Dummy-Größe 1 B … 8 MiB');
      if (!Number.isInteger(transfer) || transfer < 1 || transfer > 1000) throw fail('input', 'ungültige Transfer-Nummer');
      let offset = 0, records = 0;
      const t0 = now();
      for (;;) {
        const r = await request({ op: 'dummy', transfer, size, offset });
        const dv = new DataView(r.buffer, r.byteOffset, r.byteLength);
        if (r[0] === 3 && r.length === 13) {
          if (dv.getUint32(1) !== transfer || Number(dv.getBigUint64(5)) !== size || offset !== size) { drop(); throw fail('protocol', 'Ende passt nicht'); }
          break;
        }
        const n = r.length - 13;
        if (r[0] !== 2 || n < 1 || n > RECORD_DATA_MAX || dv.getUint32(1) !== transfer || Number(dv.getBigUint64(5)) !== offset || offset + n > size) { drop(); throw fail('protocol', 'Record passt nicht'); }
        for (let i = 0; i < n; i++) if (r[13 + i] !== ((offset + i) * 31 + 7 + transfer) % 256) { drop(); throw fail('protocol', 'Dummy-Inhalt falsch'); }
        offset += n; records++;
      }
      lastError = null;
      return { bytes: offset, records, ms: Math.round(now() - t0) };
    }

    async function forget() {
      return serial(async () => {
        drop();
        await store.forgetPin();
        state = 'unpaired'; lastError = null;
        return { ok: true };
      });
    }

    async function status() {
      let pin = null, storage = 'ok';
      try { pin = await store.pin(); } catch (e) { storage = e.kind || 'error'; }
      const st = !pin ? (storage === 'ok' ? 'unpaired' : 'storage-' + storage) : session ? 'connected' : (state === 'unknown' || state === 'unpaired' || state === 'connected' ? 'paired' : state);
      return { state: st, paired: !!pin, reg: pin ? pin.reg.slice(0, 8) : null, helper: pin ? pin.helper.slice(0, 8) : null, pairedAt: pin ? pin.pairedAt : 0, lastError };
    }

    return { pair, ping, dummy, forget, status, dropSession: () => serial(async () => { drop(); }) };
  }

  NS.ChannelError = ChannelError;
  NS.createChannel = createChannel;
  NS.DUMMY_MAX = DUMMY_MAX;
  NS.retryableAfterStaleSession = retryableAfterStaleSession;
})(typeof self !== 'undefined' ? self : globalThis);
