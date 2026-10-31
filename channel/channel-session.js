// Kadri – Helfer-Kanal: Kopplung, authentisierter Kanal und die einzigen Befehle (Steuerung von Helligkeit und Lautstärke).
// Kryptografie ausschließlich im geprüften Rust/WASM-Kern (SPAKE2-Kopplung, Noise_KK-Kanal). Diese Datei verwaltet
// nur Zustände und Reihenfolge.
//
// Befehle: status, beat, end, vol (v 0…1, optional), bright (v 0,004…1) – dieselbe strenge Form, die der Helfer prüft.
// Phase C3: dlstart (id, url, optional name), dlstatus (id), dlcancel (id) für direkte MP4-Downloads – nur diese Felder;
// keine Cookies, Header, Referer oder sonstigen Browser-Zugangsdaten. Die Medien selbst laufen nie durch den Kanal.
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
//    Befehle, deren Wiederholung nichts anderes bewirkt als die erste Ausführung (alle fünf Steuerbefehle setzen
//    absolute Werte oder fragen nur ab); alles andere meldet den Fehler (Review I1).
//  - Alle Aktionen laufen nacheinander (höchstens ein offener Record); die Warteschlange ist begrenzt.
//  - Fristen der Kopplung auf der monotonen Uhr (performance.now, Review R3).
(function (root) {
  'use strict';
  const NS = root.KadriChannel = root.KadriChannel || {};

  const PAIR_TTL_MS = 60_000;
  const MAX_QUEUE = 32;
  // Nur Befehle, deren Wiederholung nichts anderes bewirkt (absolute Werte, Abfragen), dürfen nach HTTP 404 (Sitzung
  // unbekannt) einmal mit neuem Handshake wiederholt werden (Review I1). Künftige Befehle mit anderer Wirkung (z. B.
  // ein Download-Start) kommen NICHT in diese Liste.
  // dlstatus/dlcancel ändern beim zweiten Mal nichts (Abfrage bzw. Abbruch derselben Kennung). dlstart NICHT: ob ein
  // Start wiederholt wird, entscheidet die Download-Verwaltung (channel-downloads.js) mit derselben Kennung.
  const IDEMPOTENT_OPS = new Set(['status', 'beat', 'end', 'vol', 'bright', 'dlstatus', 'dlcancel']);
  const retryableAfterStaleSession = (op) => IDEMPOTENT_OPS.has(op);

  // Steuerbefehl → Record-Inhalt, genau in der Form, die der Helfer annimmt (ControlCommands.java): nur "op" und "v",
  // Zahlen ohne Exponent (auf 4 Nachkommastellen gerundet). Alles andere wird hier schon abgelehnt (null).
  function controlMessage(op, v) {
    if (op === 'status' || op === 'beat' || op === 'end') return v === undefined ? { op } : null;
    if (op !== 'vol' && op !== 'bright') return null;
    if (v === undefined) return op === 'vol' ? { op } : null;
    if (typeof v !== 'number' || !Number.isFinite(v)) return null;
    const r = Math.round(v * 1e4) / 1e4;
    if (op === 'vol' ? !(r >= 0 && r <= 1) : !(r >= 0.004 && r <= 1)) return null;
    return { op, v: r };
  }

  // Download-Befehle (Phase C3) → Record-Inhalt in genau der Form, die der Helfer annimmt (ControlCommands.java):
  // id = 32 Kleinbuchstaben-Hex, url = http(s) aus RFC-3986-Zeichen ≤ 2048, name ohne Escapes/Steuerzeichen ≤ 120.
  // Jedes andere Feld (Cookie, Header, Referer …) und jede Abweichung → null; nichts verlässt den Browser.
  const DL_ID = /^[0-9a-f]{32}$/;
  const DL_URL = /^https?:\/\/[A-Za-z0-9\-._~:/?#[\]@!$&'()*+,;=%]+$/;
  const DL_NAME_BAD = /[\\"\u0000-\u001f\u007f-\u009f\u2028\u2029]|[\ud800-\udbff](?![\udc00-\udfff])|(?:^|[^\ud800-\udbff])[\udc00-\udfff]/;
  function downloadMessage(op, a) {
    if (!a || typeof a !== 'object' || typeof a.id !== 'string' || !DL_ID.test(a.id)) return null;
    const keys = Object.keys(a);
    if (op === 'dlstatus' || op === 'dlcancel') return keys.every((k) => k === 'id') ? { op, id: a.id } : null;
    if (op !== 'dlstart' || !keys.every((k) => k === 'id' || k === 'url' || k === 'name')) return null;
    if (typeof a.url !== 'string' || a.url.length > 2048 || !DL_URL.test(a.url)) return null;
    const m = { op, id: a.id, url: a.url };
    if (a.name !== undefined) {
      if (typeof a.name !== 'string' || a.name.length > 120 || DL_NAME_BAD.test(a.name)) return null;
      m.name = a.name;
    }
    return m;
  }

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
        // notSent: der Befehl hat den Helfer sicher nicht erreicht (kein Handshake bzw. Sitzung dort unbekannt → Record
        // nie geöffnet). Für die Download-Verwaltung: dann ist ein Start sicher nicht angekommen.
        if (!session) { try { await connect(pin, await store.identity()); } catch (e) { e.notSent = true; throw e; } }
        try { return await exchange(obj); }
        catch (e) {
          if (e.kind !== 'stale-session') throw e;
          if (!retryableAfterStaleSession(obj.op)) { const e2 = fail('stale-session', 'Sitzung beim Helfer unbekannt – Befehl nicht automatisch wiederholt'); e2.notSent = true; throw e2; }
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
          if (!replyOf(await exchange({ op: 'status' }))) throw new ChannelError('protocol', 'unerwartete Bestätigung');
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

    // Antwort eines Steuer-Records: JSON-Objekt (Status des Helfers) oder null.
    function replyOf(r) {
      if (r[0] !== 1) return null;
      let reply;
      try { reply = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(r.subarray(1))); } catch (e) { return null; }
      return reply && typeof reply === 'object' && !Array.isArray(reply) ? reply : null;
    }

    // Ein Steuerbefehl. Ergebnis: die Antwort des Helfers ({ok:true, …}); {ok:false} heißt „Befehl abgelehnt“
    // (die Sitzung bleibt). Ungültige Befehle verlassen den Browser nicht.
    async function command(op, v) {
      const msg = controlMessage(op, v);
      if (!msg) throw fail('input', 'ungültiger Steuerbefehl');
      const reply = replyOf(await request(msg));
      if (!reply || typeof reply.ok !== 'boolean') { drop(); throw fail('protocol'); }
      lastError = null;
      return reply;
    }

    // Ein Download-Befehl (Phase C3). Antwort des Helfers ({ok:true, id, state, …}, {ok:false, state:"busy"} oder
    // {ok:false} bei einem Helfer ohne Downloads). Nach "Sitzung unbekannt" wird dlstart NICHT automatisch wiederholt
    // (retryableAfterStaleSession) – das entscheidet die Download-Verwaltung mit derselben Kennung.
    async function download(op, args) {
      const msg = downloadMessage(op, args);
      if (!msg) throw fail('input', 'ungültiger Download-Befehl');
      const reply = replyOf(await request(msg));
      if (!reply || typeof reply.ok !== 'boolean') { drop(); throw fail('protocol'); }
      lastError = null;
      return reply;
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

    return { pair, command, download, forget, status, dropSession: () => serial(async () => { drop(); }) };
  }

  NS.ChannelError = ChannelError;
  NS.createChannel = createChannel;
  NS.controlMessage = controlMessage;
  NS.downloadMessage = downloadMessage;
  NS.retryableAfterStaleSession = retryableAfterStaleSession;
})(typeof self !== 'undefined' ? self : globalThis);
