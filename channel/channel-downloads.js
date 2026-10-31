// Kadri – direkte MP4-Downloads über die Helfer-App (Phase C3), im Hintergrund der Chrome-/Vivaldi-Fassung.
//
// Einziger Weg: der verschlüsselte Kanal (channel.download → dlstart/dlstatus/dlcancel, Noise KK). Übertragen werden
// nur Kennung, URL und optionaler Name; keine Cookies, Header, Referer oder Browser-Zugangsdaten. Ist der Helfer nicht
// gekoppelt oder nicht erreichbar, gibt es keinen anderen Weg (kein Klartext, kein Browser-Download als Ersatz).
//
// Aufträge (höchstens MAX_JOBS) liegen in storage.local, damit sie einen Neustart des Service Workers oder des Browsers
// überdauern – OHNE URL: gespeichert ist nur ihr SHA-256 (zum Erkennen doppelter Starts), der Name und der zuletzt vom
// Helfer gemeldete Zustand. Die URL bleibt nur im Arbeitsspeicher, solange der Start unbestätigt ist.
//
// Doppelte Starts: (1) dieselbe Datei läuft schon → derselbe Auftrag (kein zweiter dlstart); (2) die Kennung wird VOR
// dem Senden gespeichert; geht die Antwort verloren (Verbindungsabbruch, Helfer-Neustart, Sitzung unbekannt), fragt
// dlstatus nach und sendet dlstart höchstens mit DERSELBEN Kennung erneut – der Helfer startet je Kennung höchstens
// einmal (Journal, auch über seinen Neustart). Kennt der Helfer die Kennung nicht und ist die URL nicht mehr da
// (Service Worker neu gestartet), gilt der Start als nicht bestätigt; der Nutzer startet bewusst neu.
(function (root) {
  'use strict';
  const NS = root.KadriChannel = root.KadriChannel || {};

  const KEY = 'kadri-dl-jobs';
  const MAX_JOBS = 20;
  const TERMINAL = new Set(['done', 'failed', 'cancelled', 'interrupted']);
  const STATES = new Set(['running', 'done', 'failed', 'cancelled', 'interrupted']);
  const PROBE_ID = '0'.repeat(32);   // Fähigkeitsprobe: dlstatus einer nie vergebenen Kennung

  // URL für dlstart: http(s), keine Zugangsdaten, ohne Fragment (geht ohnehin nie zum Server), nur RFC-3986-Zeichen
  // (URL.href kodiert Nicht-ASCII; die restlichen erlaubten Zeichen werden hier kodiert). null = nicht direkt ladbar.
  function normalizeUrl(u) {
    let url;
    try { url = new URL(String(u)); } catch (e) { return null; }
    if ((url.protocol !== 'http:' && url.protocol !== 'https:') || url.username || url.password) return null;
    url.hash = '';
    const s = url.href.replace(/[^A-Za-z0-9\-._~:/?#[\]@!$&'()*+,;=%]/g, (c) => '%' + c.charCodeAt(0).toString(16).toUpperCase().padStart(2, '0'));
    return s.length <= 2048 && NS.downloadMessage('dlstart', { id: PROBE_ID, url: s }) ? s : null;
  }

  // Anzeigename (Dateiname beim Helfer): ohne Steuerzeichen, Anführungszeichen, Backslash, einzelne Surrogate; ≤ 120.
  function cleanName(n) {
    let s = String(n == null ? '' : n).replace(/[\\"\u0000-\u001f\u007f-\u009f\u2028\u2029]/g, ' ')
      .replace(/[\ud800-\udbff](?![\udc00-\udfff])|(?:^|(?<=[^\ud800-\udbff]))[\udc00-\udfff]/g, ' ').replace(/\s+/g, ' ').trim();
    if (s.length > 120) { s = s.slice(0, 120); if (/[\ud800-\udbff]$/.test(s)) s = s.slice(0, -1); }
    return s || 'Video';
  }

  // storage: { get(): Promise<array|undefined>, set(array): Promise } · digest(text): Promise<hex> · random(): hex(32)
  function createDownloads({ channel, storage, digest, random, now = () => Date.now() }) {
    const pending = new Map();   // id → URL, nur solange der Start unbestätigt ist (nie gespeichert)
    let chain = Promise.resolve();
    const serial = (fn) => { const p = chain.then(fn, fn); chain = p.catch(() => {}); return p; };
    let caps = null;

    async function load() {
      const l = await storage.get();
      return Array.isArray(l) ? l.filter((j) => j && typeof j.id === 'string' && /^[0-9a-f]{32}$/.test(j.id)) : [];
    }
    async function save(jobs) {
      jobs.sort((a, b) => b.at - a.at);
      // Begrenzt: laufende bleiben, älteste beendete fallen heraus.
      while (jobs.length > MAX_JOBS) {
        const i = jobs.map((j) => TERMINAL.has(j.state)).lastIndexOf(true);
        if (i < 0) break;
        jobs.splice(i, 1);
      }
      await storage.set(jobs);
    }
    const view = (j) => ({ id: j.id, name: j.name, state: j.state, bytes: j.bytes, total: j.total, reason: j.reason, at: j.at });

    // Antwort des Helfers in den Auftrag übernehmen (nur bekannte Felder und Werte).
    function apply(j, r) {
      if (r.ok === false) {
        const e = new Error(r.state === 'busy' ? 'helper-busy' : 'unsupported');
        e.kind = r.state === 'busy' ? 'helper-busy' : 'unsupported';
        throw e;
      }
      if (r.id !== j.id) { const e = new Error('protocol'); e.kind = 'protocol'; throw e; }
      if (r.state === 'unknown') return 'unknown';
      if (!STATES.has(r.state)) { const e = new Error('protocol'); e.kind = 'protocol'; throw e; }
      // Abbruch angefordert, Helfer lädt noch (Abbruch wirkt gleich): bei "wird abgebrochen" bleiben.
      j.state = j.state === 'cancelling' && r.state === 'running' ? 'cancelling' : r.state;
      j.bytes = Number.isSafeInteger(r.bytes) && r.bytes >= 0 ? r.bytes : j.bytes;
      j.total = Number.isSafeInteger(r.total) ? r.total : j.total;
      j.reason = typeof r.reason === 'string' && /^[a-z0-9_]{0,40}$/.test(r.reason) ? r.reason : '';
      j.seen = now();
      if (j.state !== 'starting' && j.state !== 'unconfirmed') pending.delete(j.id);
      return r.state;
    }

    // Fehler, bei denen der Record den Helfer erreicht haben KANN (Antwort verloren) → Auftrag bleibt "unbestätigt".
    // notSent (channel-session.js): kein Handshake bzw. Sitzung beim Helfer unbekannt – sicher nicht angekommen.
    const uncertain = (e) => !!e && !e.notSent && ['unreachable', 'timeout', 'tampered', 'record-rejected', 'protocol'].includes(e.kind);

    // dlstart mit der gespeicherten Kennung. War nur die Sitzung beim Helfer abgelaufen (Neustart der App), kam der
    // Befehl sicher nicht an: genau einmal mit neuer Sitzung und DERSELBEN Kennung wiederholen.
    async function send(j, url) {
      const args = j.named ? { id: j.id, url, name: j.name } : { id: j.id, url };
      try { return apply(j, await channel.download('dlstart', args)); }
      catch (e) {
        if (!(e && e.kind === 'stale-session' && e.notSent)) throw e;
        return apply(j, await channel.download('dlstart', args));
      }
    }

    // Start durch den Nutzer. Dieselbe Datei läuft schon (oder ist unbestätigt) → derselbe Auftrag.
    function start(rawUrl, rawName) {
      return serial(async () => {
        const url = normalizeUrl(rawUrl);
        if (!url) { const e = new Error('input'); e.kind = 'input'; throw e; }
        const key = await digest(url);
        const jobs = await load();
        const same = jobs.find((x) => x.key === key && !TERMINAL.has(x.state));
        if (same) { if (!pending.has(same.id)) pending.set(same.id, url); return { job: view(same), existing: true }; }
        const named = rawName != null && String(rawName).trim() !== '';
        const j = { id: random(), key, name: cleanName(rawName), named, state: 'starting', bytes: 0, total: -1, reason: '', at: now(), seen: 0 };
        jobs.unshift(j);                 // neuester zuerst (bei gleicher Zeit bleibt die Reihenfolge, sort ist stabil)
        await save(jobs);                // erst gespeichert, dann gesendet: die Kennung überlebt jeden Abbruch
        pending.set(j.id, url);
        try {
          await send(j, url);
        } catch (e) {
          if (uncertain(e)) { j.state = 'unconfirmed'; await save(jobs); return { job: view(j), existing: false }; }
          pending.delete(j.id);
          await save(jobs.filter((x) => x.id !== j.id));   // nie beim Helfer angekommen bzw. abgelehnt: kein Auftrag
          throw e;
        }
        await save(jobs);
        return { job: view(j), existing: false };
      });
    }

    // Zustand beim Helfer abfragen (dlstatus); unbestätigte Starts klären.
    function status(id) {
      return serial(async () => {
        const jobs = await load();
        const j = jobs.find((x) => x.id === id);
        if (!j) return null;
        if (TERMINAL.has(j.state)) return { job: view(j), reachable: true };
        let s;
        try { s = apply(j, await channel.download('dlstatus', { id })); }
        catch (e) {
          if (e.kind === 'unsupported' || e.kind === 'helper-busy') throw e;
          return { job: view(j), reachable: false, error: e.kind || 'error' };
        }
        if (s === 'running' && j.state === 'cancelling') {
          // Abbruch kam (noch) nicht an, etwa wegen eines Verbindungsabbruchs: erneut senden (dlcancel ist idempotent).
          try { apply(j, await channel.download('dlcancel', { id })); } catch (e) { /* nächste Abfrage versucht es wieder */ }
        } else if (s === 'unknown') {
          const url = pending.get(id);
          if (j.state === 'cancelling') { j.state = 'cancelled'; pending.delete(id); }
          else if (url) {
            try { await send(j, url); }   // dieselbe Kennung: der Helfer startet höchstens einmal
            catch (e) { if (!uncertain(e)) { j.state = 'failed'; j.reason = e.kind === 'helper-busy' ? 'busy' : 'not_started'; pending.delete(id); } }
          } else { j.state = 'failed'; j.reason = 'not_started'; }
        }
        await save(jobs);
        return { job: view(j), reachable: true };
      });
    }

    // Abbruch: dlcancel; der Helfer bricht auch den Verbindungsaufbau ab und räumt auf. Danach meldet dlstatus "cancelled".
    function cancel(id) {
      return serial(async () => {
        const jobs = await load();
        const j = jobs.find((x) => x.id === id);
        if (!j) return null;
        if (TERMINAL.has(j.state)) return { job: view(j), reachable: true };
        let s;
        try { s = apply(j, await channel.download('dlcancel', { id })); }
        catch (e) {
          if (e.kind === 'unsupported' || e.kind === 'helper-busy') throw e;
          if (j.state === 'starting' || j.state === 'unconfirmed') { j.state = 'cancelling'; pending.delete(id); await save(jobs); }
          return { job: view(j), reachable: false, error: e.kind || 'error' };
        }
        if (s === 'unknown') { j.state = 'cancelled'; pending.delete(id); }   // nie gestartet: nichts mehr senden
        else if (j.state === 'running') j.state = 'cancelling';
        await save(jobs);
        return { job: view(j), reachable: true };
      });
    }

    // Laufender oder zuletzt beendeter Auftrag für dieselbe Datei (ohne zu starten).
    function find(rawUrl) {
      return serial(async () => {
        const url = normalizeUrl(rawUrl);
        if (!url) return null;
        const key = await digest(url);
        const j = (await load()).find((x) => x.key === key);
        return j ? view(j) : null;
      });
    }

    const list = () => serial(async () => (await load()).map(view));

    // Kann der gekoppelte Helfer direkte Downloads? (dlstatus einer nie vergebenen Kennung; 60 s zwischengespeichert)
    function capabilities() {
      return serial(async () => {
        if (caps && now() - caps.at < 60_000) return caps.value;
        let value;
        try {
          const r = await channel.download('dlstatus', { id: PROBE_ID });
          value = { reachable: true, supported: r.ok === true && r.state === 'unknown' };
        } catch (e) { value = { reachable: false, supported: false, error: e.kind || 'error' }; }
        if (value.reachable) caps = { at: now(), value };
        return value;
      });
    }

    return { start, status, cancel, find, list, capabilities };
  }

  // Für Anzeigen (Menü, Player): feste Texte je Zustand und Grund – nie Server-Text oder URL.
  function describe(j) {
    if (!j) return { label: 'Unbekannt', progress: '' };
    const mb = (n) => (n / 1048576).toFixed(n >= 104857600 ? 0 : 1).replace('.', ',');
    const progress = j.state === 'running' || j.state === 'cancelling'
      ? (j.total > 0 ? Math.floor(j.bytes * 100 / j.total) + ' % · ' + mb(j.bytes) + ' / ' + mb(j.total) + ' MB' : (j.bytes > 0 ? mb(j.bytes) + ' MB' : ''))
      : '';
    switch (j.state) {
      case 'starting': return { label: 'Startet …', progress };
      case 'unconfirmed': return { label: 'Verbindung unterbrochen – Stand wird geprüft', progress };
      case 'running': return { label: 'Lädt …', progress };
      case 'cancelling': return { label: 'Wird abgebrochen …', progress };
      case 'done': return { label: 'Gespeichert in Download/Video-Assistent', progress };
      case 'cancelled': return { label: 'Abgebrochen', progress };
      case 'interrupted': return { label: 'Unterbrochen (Helfer neu gestartet) – erneut starten', progress };
      default: return { label: reasonText(j.reason), progress };
    }
  }
  function reasonText(r) {
    r = String(r || '');
    if (/^http_40[137]$/.test(r)) return 'Server verlangt Anmeldung – direkter Download nicht möglich';
    if (/^http_(404|410)$/.test(r)) return 'Datei nicht gefunden';
    if (/^http_\d+$/.test(r)) return 'Server-Fehler (' + r.replace('http_', 'HTTP ') + ')';
    if (/^blocked_(address|host_name|no_address|peer|port)$/.test(r)) return 'Adresse nicht erlaubt (eigenes oder privates Netz)';
    if (/^blocked_(redirect_target|downgrade|too_many_redirects|redirect_without_location)$/.test(r)) return 'Weiterleitung nicht erlaubt';
    if (r.startsWith('blocked_')) return 'Adresse nicht erlaubt';
    const T = {
      no_length: 'Server nennt keine Dateigröße – direkter Download nicht möglich', too_large: 'Datei zu groß',
      type: 'Keine MP4-Datei', not_mp4: 'Keine MP4-Datei', encoding: 'Server liefert die Datei nur komprimiert',
      no_space: 'Zu wenig Speicher auf dem Handy', storage_permission: 'Helfer-App: Speicherzugriff fehlt – in der App erlauben',
      storage: 'Speichern auf dem Handy fehlgeschlagen', network: 'Verbindung zum Server unterbrochen',
      changed: 'Datei hat sich beim Laden geändert', range_ignored: 'Fortsetzen nicht möglich', not_started: 'Start nicht bestätigt – bitte erneut starten',
      busy: 'Helfer lädt schon zwei Dateien – später erneut', stopped: 'Helfer-App beendet', long_body: 'Fehlerhafte Antwort des Servers',
      timeout: 'Server antwortet nicht',
    };
    if (T[r]) return T[r];
    if (r.startsWith('range_')) return 'Fortsetzen nicht möglich';
    return 'Download fehlgeschlagen';
  }
  // Fehler beim Start oder Abbruch (Kanal/Helfer), feste Texte.
  function errorText(kind) {
    return ({
      unpaired: 'Helfer-App nicht gekoppelt – in den Einstellungen koppeln',
      unreachable: 'Helfer-App nicht erreichbar', timeout: 'Helfer-App antwortet nicht',
      rejected: 'Der Helfer erkennt diese Kopplung nicht mehr an – neu koppeln',
      'identity-mismatch': 'Antwort nicht vom gekoppelten Helfer – nichts übertragen',
      unsupported: 'Diese Helfer-App-Version kann keine direkten Downloads',
      'helper-busy': 'Helfer lädt schon zwei Dateien – später erneut',
      input: 'Diese Adresse lässt sich nicht direkt laden',
    })[kind] || 'Helfer-App: Verbindung fehlgeschlagen';
  }

  NS.createDownloads = createDownloads;
  NS.normalizeDownloadUrl = normalizeUrl;
  NS.downloadName = cleanName;
  NS.describeDownload = describe;
  NS.downloadReasonText = reasonText;
  NS.downloadErrorText = errorText;
})(typeof self !== 'undefined' ? self : globalThis);
