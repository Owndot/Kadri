// Kadri – Helfer-Kanal (TEST-Stufe, nur Dummy-Daten): Kopplungsverwaltung.
// Hält die eigene X25519-Testidentität und die eine gespeicherte Kopplung (Pin) mit dem Helfer.
//
// Speicherort im Hintergrund: IndexedDB des Erweiterungs-Ursprungs – NICHT storage.local, denn das könnten Kadris
// Content-Scripts lesen. Für Tests ist der Speicher austauschbar (memoryBackend, auch mit eingebauten Fehlern).
//
// Regeln (wie im geprüften PoC und in der Android-Test-App, Review F2/R4):
//  - Eine Identität entsteht nur, wenn weder Identität noch Kopplung gespeichert ist (Erststart). Eine Kopplung ohne
//    Identität ist ein Fehlerzustand – keine stille neue Identität.
//  - Gespeicherte Daten werden beim Laden geprüft; Unbrauchbares wird gemeldet, nicht stillschweigend gelöscht.
//  - Jeder Schreibfehler wird an den Aufrufer weitergegeben (keine vorgetäuschte Speicherung).
(function (root) {
  'use strict';
  const NS = root.KadriChannel = root.KadriChannel || {};

  const HEX = /^[0-9a-f]*$/;
  const hex = (u8) => Array.from(u8, (b) => b.toString(16).padStart(2, '0')).join('');
  const unhex = (s) => new Uint8Array(String(s).match(/../g).map((h) => parseInt(h, 16)));

  class StoreError extends Error {
    constructor(kind, message) { super(message); this.kind = kind; }
  }

  // ---------- Speicher-Rückseiten ----------
  function idbBackend(name) {
    let dbp = null;
    const db = () => {
      if (!dbp) dbp = new Promise((res, rej) => {
        const r = indexedDB.open(name, 1);
        r.onupgradeneeded = () => r.result.createObjectStore('kv');
        r.onsuccess = () => res(r.result);
        r.onerror = () => { dbp = null; rej(r.error); };
      });
      return dbp;
    };
    const tx = async (mode, fn) => {
      const d = await db();
      return new Promise((res, rej) => {
        const t = d.transaction('kv', mode), req = fn(t.objectStore('kv'));
        t.oncomplete = () => res(req && req.result);
        t.onerror = t.onabort = () => rej(t.error || new Error('IndexedDB'));
      });
    };
    return {
      get: (k) => tx('readonly', (s) => s.get(k)),
      put: (k, v) => tx('readwrite', (s) => s.put(v, k)).then(() => undefined),
      del: (k) => tx('readwrite', (s) => s.delete(k)).then(() => undefined),
    };
  }

  // Für Tests: Speicher im Arbeitsspeicher; failWrites > 0 lässt die nächsten Schreibvorgänge scheitern.
  function memoryBackend(initial) {
    const m = new Map(Object.entries(initial || {}));
    const be = {
      failWrites: 0,
      get: async (k) => (m.has(k) ? structuredClone(m.get(k)) : undefined),
      put: async (k, v) => { if (be.failWrites > 0) { be.failWrites--; throw new Error('write failed (injected)'); } m.set(k, structuredClone(v)); },
      del: async (k) => { if (be.failWrites > 0) { be.failWrites--; throw new Error('write failed (injected)'); } m.delete(k); },
      dump: () => new Map(m),
    };
    return be;
  }

  // ---------- Prüfung gespeicherter Werte ----------
  function validPin(p) {
    return !!p && typeof p === 'object' && typeof p.reg === 'string' && p.reg.length === 32 && HEX.test(p.reg) &&
      typeof p.helper === 'string' && p.helper.length === 64 && HEX.test(p.helper);
  }
  function validIdentity(id) { return id instanceof Uint8Array && id.length === 64; }

  // generateIdentity: () => Uint8Array(64) aus dem geprüften Kern (privat ‖ öffentlich)
  function createStore(backend, generateIdentity) {
    const read = async (k) => {
      try { return await backend.get(k); } catch (e) { throw new StoreError('storage', 'Speicher nicht lesbar'); }
    };
    const write = async (k, v) => {
      try { await backend.put(k, v); } catch (e) { throw new StoreError('storage', 'Speichern fehlgeschlagen – nichts geändert'); }
    };

    async function pin() {
      const p = await read('pin');
      if (p === undefined || p === null) return null;
      if (!validPin(p)) throw new StoreError('corrupt', 'Gespeicherte Kopplung ist beschädigt – bitte bewusst vergessen und neu koppeln');
      return { reg: p.reg, helper: p.helper, pairedAt: p.pairedAt || 0 };
    }

    // Identität laden; nur beim Erststart (keine Kopplung gespeichert) neu anlegen.
    async function identity() {
      const id = await read('identity');
      if (id !== undefined && id !== null) {
        if (!validIdentity(id)) throw new StoreError('corrupt', 'Gespeicherte Identität ist beschädigt');
        return id;
      }
      if (await pin()) throw new StoreError('inconsistent', 'Kopplung ohne Identität gespeichert – keine neue Identität ohne bewusstes Vergessen');
      const fresh = generateIdentity();
      if (!validIdentity(fresh)) throw new StoreError('internal', 'Identität ungültig');
      await write('identity', fresh);
      return fresh;
    }

    async function setPin(p) {
      if (!validPin(p)) throw new StoreError('internal', 'ungültige Kopplung');
      await write('pin', { reg: p.reg, helper: p.helper, pairedAt: Date.now() });
    }

    // Bewusstes Vergessen (Nutzeraktion): Kopplung weg; die Identität bleibt, damit keine stille Rotation entsteht.
    async function forgetPin() {
      try { await backend.del('pin'); } catch (e) { throw new StoreError('storage', 'Vergessen fehlgeschlagen – Kopplung besteht weiter'); }
    }

    return { pin, identity, setPin, forgetPin };
  }

  NS.hex = hex;
  NS.unhex = unhex;
  NS.StoreError = StoreError;
  NS.idbBackend = idbBackend;
  NS.memoryBackend = memoryBackend;
  NS.createStore = createStore;
  NS.validPin = validPin;
})(typeof self !== 'undefined' ? self : globalThis);
