// Kadri – Helfer-Kanal: Transport zum Android-Helfer.
// Bewegt nur undurchsichtige Bytes des geprüften Protokolls an genau eine feste Loopback-Adresse.
//
//  - nur POST an vier feste Pfade, nur 127.0.0.1:<Port>, keine Weiterleitung, keine Cookies, kein Referrer, kein Cache
//  - keine Wiederholung, keine Ausweichadresse, kein Klartext-Fallback, kein statischer Schlüssel (X-EVP-Key)
//  - Antworten nur mit Content-Length und höchstens so groß wie ein Protokoll-Record; feste Zeitgrenze je Anfrage
// Das Gate des Helfers (Content-Type, X-Kadri-Helper, Erweiterungs-Origin) wehrt Webseiten ab – es ist KEINE
// Authentisierung. Die leistet allein der kryptografische Kanal.
(function (root) {
  'use strict';
  const NS = root.KadriChannel = root.KadriChannel || {};

  const PATHS = new Set(['/p1/pair/m0', '/p1/pair/m2', '/p1/ch/hs', '/p1/ch/rec']);
  const MAX_BODY = 65535 + 21;       // größter Record des Protokolls
  const MAX_RESPONSE = 65535 + 21;

  class TransportError extends Error {
    constructor(kind, message, status) { super(message); this.kind = kind; this.status = status || 0; }
  }

  // fetchImpl: das fetch des Hintergrunds (Tests: Node-fetch). tap: nur für Tests (Manipulation/Mitschnitt), sonst null.
  function createTransport({ fetchImpl, port, timeoutMs = 5000, tap = null }) {
    if (!Number.isInteger(port) || port < 1024 || port > 65535) throw new TransportError('config', 'ungültiger Port');
    const base = 'http://127.0.0.1:' + port;

    async function post(path, body) {
      if (!PATHS.has(path)) throw new TransportError('config', 'Pfad nicht erlaubt');
      if (!(body instanceof Uint8Array) || body.length > MAX_BODY) throw new TransportError('config', 'Anfrage zu groß');
      if (tap && tap.request) body = tap.request(path, body);
      let res;
      try {
        res = await fetchImpl(base + path, {
          method: 'POST', body,
          headers: { 'Content-Type': 'application/octet-stream', 'X-Kadri-Helper': '2' },
          credentials: 'omit', redirect: 'error', cache: 'no-store', referrerPolicy: 'no-referrer',
          signal: AbortSignal.timeout(timeoutMs),
        });
      } catch (e) {
        if (e && (e.name === 'TimeoutError' || e.name === 'AbortError')) throw new TransportError('timeout', 'Helfer antwortet nicht rechtzeitig');
        throw new TransportError('unreachable', 'Helfer nicht erreichbar' + (e && e.cause && e.cause.code ? ' (' + e.cause.code + ')' : ''));
      }
      if (res.status !== 200) {
        try { await res.body?.cancel(); } catch (e) {}
        throw new TransportError('http', 'HTTP ' + res.status, res.status);
      }
      const declared = Number(res.headers.get('content-length'));
      if (!Number.isSafeInteger(declared) || declared < 0 || declared > MAX_RESPONSE) {
        try { await res.body?.cancel(); } catch (e) {}
        throw new TransportError('framing', 'Antwort ohne gültige Länge oder zu groß');
      }
      const out = new Uint8Array(declared);
      let at = 0;
      try {
        const reader = res.body.getReader();
        for (;;) {
          const { done, value } = await reader.read();
          if (done) break;
          if (at + value.length > declared) { try { await reader.cancel(); } catch (e) {} throw new TransportError('framing', 'Antwort länger als angekündigt'); }
          out.set(value, at); at += value.length;
        }
      } catch (e) {
        if (e instanceof TransportError) throw e;
        if (e && (e.name === 'TimeoutError' || e.name === 'AbortError')) throw new TransportError('timeout', 'Helfer antwortet nicht rechtzeitig');
        throw new TransportError('unreachable', 'Verbindung abgebrochen');
      }
      if (at !== declared) throw new TransportError('framing', 'Antwort unvollständig');
      return tap && tap.response ? tap.response(path, out) : out;
    }

    return { post };
  }

  NS.TransportError = TransportError;
  NS.createTransport = createTransport;
  NS.CHANNEL_PATHS = Array.from(PATHS);
})(typeof self !== 'undefined' ? self : globalThis);
