// Kadri – direkte MP4-Downloads über die Helfer-App (Phase C3), im Hintergrund der Chrome-/Vivaldi-Fassung.
//
// Einziger Weg: der verschlüsselte Kanal (channel.download → dlstart/dlstatus/dlcancel, Noise KK). Übertragen werden
// nur Kennung, URL und optionaler Name, dazu – nur bei Helfern mit "ctx":1 – der Anfragekontext des Auftrags: die
// Herkunft der Seite als Referer (ohne Pfad/Query) und der User-Agent des Browsers. Nie Cookies, andere Header oder
// Browser-Zugangsdaten. Der Kontext bleibt nur im Arbeitsspeicher (wie die URL), nie in storage.local. Ist der Helfer nicht
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
  // P4c-3 (P2): endgültig. „interrupted“ ist es nicht mehr ganz – der Helfer kann einen unterbrochenen Auftrag aus der
  // verschlüsselten Quelle (≤ 6 h) selbst fortsetzen; deshalb wird er weiter abgefragt (keine neuen Starts von hier).
  const FINAL = new Set(['done', 'failed', 'cancelled']);
  const STATES = new Set(['running', 'done', 'failed', 'cancelled', 'interrupted']);
  const PROBE_ID = '0'.repeat(32);
  // P4c-3: Gründe einer gescheiterten Abfrage, die beim Auftrag vermerkt werden (feste Codes aus channel-session.js)
  const CHECK_KINDS = new Set(['unreachable', 'timeout', 'unpaired', 'rejected', 'identity-mismatch', 'tampered', 'record-rejected', 'protocol', 'stale-session', 'busy']);   // Fähigkeitsprobe: dlstatus einer nie vergebenen Kennung

  // Optional, additive helper diagnostic. Copy only fixed phases and a bounded count; never free text.
  function planDiagnostic(d) {
    if (!d || d.v !== 1 || !['source_fetch', 'source_parse', 'source_options', 'video_fetch', 'video_parse',
      'audio_fetch', 'audio_parse', 'plan_build'].includes(d.phase) ||
      !Number.isSafeInteger(d.playlists) || d.playlists < 0 || d.playlists > 3) return null;
    return { v: 1, phase: d.phase, playlists: d.playlists };
  }

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

  // HLS: Orte, an denen der Helfer einen HTTP-Fehler melden kann (Hauptliste, Medienliste, Init, Segment)
  const HLS_LOCS = ['master', 'video_list', 'audio_list', 'video_init', 'audio_init', 'video_segment', 'audio_segment'];
  // S3c: DASH: Orte eines HTTP-Fehlers beim Helfer (MPD, Init, Stück) – nur feste Codes und Positionsnummern
  const DASH_LOCS = ['mpd', 'video_init', 'audio_init', 'video_segment', 'audio_segment'];
  // Optional, additive helper diagnostic for dashplan: fixed phase only.
  function dashPlanDiagnostic(d) {
    if (!d || d.v !== 1 || !['mpd_fetch', 'mpd_parse', 'fingerprint', 'profile', 'options'].includes(d.phase)) return null;
    return { v: 1, phase: d.phase };
  }

  // storage: { get(): Promise<array|undefined>, set(array): Promise } · digest(text): Promise<hex> · random(): hex(32)
  function createDownloads({ channel, storage, digest, random, now = () => Date.now(), setTimer = (f, ms) => setTimeout(f, ms) }) {
    const pending = new Map();   // id → { url, ctx }, nur solange der Start unbestätigt ist (nie gespeichert)
    // P4b: Pläne des Helfers (hlsplan), nur im Arbeitsspeicher: planId → { key, url, bind, options, at }. Die URL bleibt
    // hier, solange der Plan gilt (10 min), damit ein abgelaufener Plan einmal neu erstellt werden kann – nie gespeichert.
    const plans = new Map();
    // P4c: unbestätigter HLS-Start (Antwort verloren): Plan-Kennung und Auswahl, nur im Arbeitsspeicher, damit die
    // Nachprüfung denselben Start mit DERSELBEN Kennung erneut senden kann (der Helfer startet je Kennung einmal).
    const hlsPending = new Map();
    // S3c: dasselbe für DASH (Plan-Kennung, Auswahl, Name; nur im Arbeitsspeicher)
    const dashPending = new Map();
    let chain = Promise.resolve();
    const serial = (fn) => { const p = chain.then(fn, fn); chain = p.catch(() => {}); return p; };
    let caps = null;
    let ctxCaps = null;   // { at, ok }: meldet der Helfer "ctx":1 (Anfragekontext)? 60 s zwischengespeichert
    let dashCtxCaps = null;   // S3c: dasselbe für DASH ("dashdl":{…,"ctx":1})

    // Anfragekontext nur an Helfer, die ihn annehmen (alte Helfer lehnten das ganze dlstart/hlsplan ab). Ohne Antwort
    // oder ohne Feld: ohne Kontext senden – wie bisher.
    async function contextFor(ctx, dash) {
      if (!ctx || (!ctx.ref && !ctx.ua) || typeof channel.status !== 'function') return null;
      const c0 = dash ? dashCtxCaps : ctxCaps;
      let cc = c0;
      if (!cc || now() - cc.at >= 60_000) {
        let ok = false;
        try {
          const st = await channel.status();
          ok = dash ? !!(st && dashCapable(st) && st.dashdl.ctx === 1) : !!(st && st.hls && st.hls.v === 1 && st.hls.ctx === 1);
        } catch (e) { ok = false; }
        cc = { at: now(), ok };
        if (dash) dashCtxCaps = cc; else ctxCaps = cc;
      }
      if (!cc.ok) return null;
      const c = {};
      if (typeof ctx.ref === 'string') c.ref = ctx.ref;
      if (typeof ctx.ua === 'string') c.ua = ctx.ua;
      return c;
    }

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
    const view = (j) => Object.assign({ id: j.id, name: j.name, state: j.state, bytes: j.bytes, total: j.total, reason: j.reason, at: j.at },
      j.wait ? { wait: j.wait } : {},
      j.check && !TERMINAL.has(j.state) ? { check: j.check } : {},
      j.kind === 'hls' || j.kind === 'dash' ? { kind: j.kind, done: j.done || 0, of: j.of || 0, phase: j.phase || '' } : {},
      (j.kind === 'hls' || j.kind === 'dash') && j.loc ? { loc: j.loc } : {});

    // Antwort des Helfers in den Auftrag übernehmen (nur bekannte Felder und Werte).
    function apply(j, r) {
      if (r.ok === false) {
        if (r.state === 'rejected') {   // P4b hlsstart: Plan abgelaufen/fremd, Option unbekannt, Kennung schon vergeben
          const e = new Error('plan-rejected');
          e.kind = 'plan-rejected';
          e.reason = typeof r.reason === 'string' && /^[a-z0-9_]{1,40}$/.test(r.reason) ? r.reason : 'rejected';
          throw e;
        }
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
      // P4c: der Helfer wartet selbst auf Netz bzw. den nächsten Versuch (der Auftrag läuft weiter)
      j.wait = r.state === 'running' && (r.wait === 'offline' || r.wait === 'retry') ? r.wait : '';
      if (r.kind === 'dash' || j.kind === 'dash') {
        // S3c: DASH-Auftrag (gleiche Felder wie HLS; Fehlerort: MPD, Init, Stück)
        if (r.kind !== 'dash' || (j.kind && j.kind !== 'dash')) { const e = new Error('protocol'); e.kind = 'protocol'; throw e; }   // nie die Art wechseln
        j.kind = 'dash';
        j.done = Number.isSafeInteger(r.done) && r.done >= 0 ? r.done : j.done || 0;
        j.of = Number.isSafeInteger(r.of) && r.of >= 0 ? r.of : j.of || 0;
        j.phase = ['fetch', 'mux', 'verify', 'save'].includes(r.phase) ? r.phase : '';
        const n = (x, max) => Number.isSafeInteger(x) && x >= -1 && x <= max;
        j.loc = DASH_LOCS.includes(r.at) && n(r.at_index, 100000) ? { at: r.at, index: r.at_index } : null;
      } else if (r.kind === 'hls' || j.kind === 'hls') {
        if (r.kind !== 'hls') { const e = new Error('protocol'); e.kind = 'protocol'; throw e; }   // nie die Art wechseln
        j.kind = 'hls';
        j.done = Number.isSafeInteger(r.done) && r.done >= 0 ? r.done : j.done || 0;
        j.of = Number.isSafeInteger(r.of) && r.of >= 0 ? r.of : j.of || 0;
        j.phase = ['fetch', 'mux', 'verify', 'save'].includes(r.phase) ? r.phase : '';
        // Fehlerort des ersten HTTP-Fehlers (Helfer: at/at_index/at_variant/at_audio) – nur feste Codes und Positionsnummern
        const n = (x, max) => Number.isSafeInteger(x) && x >= -1 && x <= max;
        j.loc = HLS_LOCS.includes(r.at) && n(r.at_index, 100000) && n(r.at_variant, 64) && n(r.at_audio, 64)
          ? { at: r.at, index: r.at_index, variant: r.at_variant, audio: r.at_audio } : null;
      }
      j.seen = now();
      if (j.check) j.check = '';   // P4c-3: der Helfer hat geantwortet
      if (j.state !== 'starting' && j.state !== 'unconfirmed') { pending.delete(j.id); hlsPending.delete(j.id); dashPending.delete(j.id); }
      return r.state;
    }

    // Fehler, bei denen der Record den Helfer erreicht haben KANN (Antwort verloren) → Auftrag bleibt "unbestätigt".
    // notSent (channel-session.js): kein Handshake bzw. Sitzung beim Helfer unbekannt – sicher nicht angekommen.
    const uncertain = (e) => !!e && !e.notSent && ['unreachable', 'timeout', 'tampered', 'record-rejected', 'protocol'].includes(e.kind);

    // dlstart mit der gespeicherten Kennung. War nur die Sitzung beim Helfer abgelaufen (Neustart der App), kam der
    // Befehl sicher nicht an: genau einmal mit neuer Sitzung und DERSELBEN Kennung wiederholen.
    async function send(j, url, ctx) {
      const args = Object.assign(j.named ? { id: j.id, url, name: j.name } : { id: j.id, url }, ctx || {});
      try { return apply(j, await channel.download('dlstart', args)); }
      catch (e) {
        if (!(e && e.kind === 'stale-session' && e.notSent)) throw e;
        return apply(j, await channel.download('dlstart', args));
      }
    }

    // Start durch den Nutzer. Dieselbe Datei läuft schon (oder ist unbestätigt) → derselbe Auftrag.
    function start(rawUrl, rawName, rawCtx) {
      return serial(async () => {
        const url = normalizeUrl(rawUrl);
        if (!url) { const e = new Error('input'); e.kind = 'input'; throw e; }
        const ctx = await contextFor(rawCtx);
        const key = await digest(url);
        const jobs = await load();
        const same = jobs.find((x) => x.key === key && !FINAL.has(x.state));
        if (same && await stillActive(jobs, same)) { if (same.state !== 'cancelling' && !pending.has(same.id)) pending.set(same.id, { url, ctx }); return { job: view(same), existing: true }; }
        const named = rawName != null && String(rawName).trim() !== '';
        const j = { id: random(), key, name: cleanName(rawName), named, state: 'starting', bytes: 0, total: -1, reason: '', at: now(), seen: 0 };
        jobs.unshift(j);                 // neuester zuerst (bei gleicher Zeit bleibt die Reihenfolge, sort ist stabil)
        await save(jobs);                // erst gespeichert, dann gesendet: die Kennung überlebt jeden Abbruch
        pending.set(j.id, { url, ctx });
        try {
          await send(j, url, ctx);
        } catch (e) {
          if (uncertain(e)) { j.state = 'unconfirmed'; await save(jobs); followUp(j.id); return { job: view(j), existing: false }; }
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
        if (FINAL.has(j.state)) return { job: view(j), reachable: true };
        return refresh(jobs, j);
      });
    }
    // P4c: gespeicherter Stand kann veraltet sein (niemand hat nachgefragt, z. B. Player zu): vor der Doppelstart-Prüfung
    // beim Helfer nachfragen. Nicht erreichbar → als laufend behandeln (lieber kein zweiter Start).
    async function stillActive(jobs, j) {
      if (FINAL.has(j.state)) return false;
      // Nicht erreichbar → als laufend behandeln (lieber kein zweiter Start; eine Abbruchabsicht wird nie überholt).
      // P4c-3: refresh() vermerkt dann den Grund (check) – die Anzeige zeigt ihn statt eines endlosen „Lädt …“.
      try { await refresh(jobs, j); } catch (e) { return true; }
      return !TERMINAL.has(j.state);
    }
    // P4c-3: nur bei echter Änderung speichern (eine Abfrage ohne neuen Stand – etwa eines unterbrochenen Auftrags –
    // schreibt das Journal nicht neu; „seen“ ist nur ein Zeitstempel).
    const fingerprint = (j) => JSON.stringify(Object.assign({}, j, { seen: 0 }));
    async function refresh(jobs, j) {
      const id = j.id;
      const before = fingerprint(j);
      {
        let s;
        try { s = apply(j, await channel.download('dlstatus', { id })); }
        catch (e) {
          if (e.kind === 'unsupported' || e.kind === 'helper-busy') throw e;
          // P4c-3: Grund der gescheiterten Abfrage beim Auftrag vermerken (fester Code, nie Text), damit Menü und Player
          // statt eines endlosen „Lädt …“/„Startet …“ den Grund zeigen; die nächste erfolgreiche Abfrage löscht ihn.
          const kind = CHECK_KINDS.has(e.kind) ? e.kind : 'error';
          if (j.check !== kind) { j.check = kind; await save(jobs); }
          return { job: view(j), reachable: false, error: e.kind || 'error' };
        }
        if (s === 'running' && j.state === 'cancelling') {
          // Abbruch kam (noch) nicht an, etwa wegen eines Verbindungsabbruchs: erneut senden (dlcancel ist idempotent).
          try { apply(j, await channel.download('dlcancel', { id })); } catch (e) { /* nächste Abfrage versucht es wieder */ }
        } else if (s === 'unknown' && j.kind === 'dash') {
          // S3c: unbestätigter DASH-Start: derselbe Start mit derselben Kennung, solange Plan und Auswahl im Speicher sind
          const dp = dashPending.get(id);
          if (j.state === 'cancelling') { dashPending.delete(id); }
          else if (dp && plans.get(dp.planId)) {
            try { await dashSend(j, plans.get(dp.planId), dp.option, dp.name); }
            catch (e) { if (!uncertain(e)) { j.state = 'failed'; j.reason = e.kind === 'helper-busy' ? 'busy' : (e.reason || 'not_started'); dashPending.delete(id); } }
          } else { j.state = 'failed'; j.reason = 'not_started'; dashPending.delete(id); }
        } else if (s === 'unknown' && j.kind === 'hls') {
          // P4c: unbestätigter HLS-Start: derselbe Start mit derselben Kennung, solange Plan und Auswahl im Speicher sind
          const hp = hlsPending.get(id);
          if (j.state === 'cancelling') { hlsPending.delete(id); }
          else if (hp && plans.get(hp.planId)) {
            try { await hlsSend(j, plans.get(hp.planId), hp.option, hp.name); }
            catch (e) { if (!uncertain(e)) { j.state = 'failed'; j.reason = e.kind === 'helper-busy' ? 'busy' : (e.reason || 'not_started'); hlsPending.delete(id); } }
          } else { j.state = 'failed'; j.reason = 'not_started'; hlsPending.delete(id); }
        } else if (s === 'unknown') {
          const p = pending.get(id);
          // unknown ist kein terminaler Zustand: ein früher gesendeter Start kann noch eintreffen.
          // Die gespeicherte Abbruchabsicht bleibt; insbesondere niemals dlstart erneut senden.
          if (j.state === 'cancelling') { pending.delete(id); }
          else if (p) {
            try { await send(j, p.url, p.ctx); }   // dieselbe Kennung (und derselbe Kontext): der Helfer startet höchstens einmal
            catch (e) { if (!uncertain(e)) { j.state = 'failed'; j.reason = e.kind === 'helper-busy' ? 'busy' : 'not_started'; pending.delete(id); } }
          } else { j.state = 'failed'; j.reason = 'not_started'; }
        }
        if (fingerprint(j) !== before) await save(jobs);
        return { job: view(j), reachable: true };
      }
    }

    // Abbruch: dlcancel; der Helfer bricht auch den Verbindungsaufbau ab und räumt auf. Danach meldet dlstatus "cancelled".
    function cancel(id) {
      return serial(async () => {
        const jobs = await load();
        const j = jobs.find((x) => x.id === id);
        if (!j) return null;
        if (TERMINAL.has(j.state)) return { job: view(j), reachable: true };
        // Nutzerabsicht VOR dem Netzwerkaufruf sichern: auch bei verlorener Antwort oder Worker-Ende.
        // Erst ein bestätigter Terminalzustand aus apply() darf cancelling ersetzen.
        j.state = 'cancelling';
        pending.delete(id);
        await save(jobs);                // Abbruchabsicht dauerhaft, bevor dlcancel den Browser verlässt
        try { apply(j, await channel.download('dlcancel', { id })); }
        catch (e) {
          if (e.kind === 'unsupported' || e.kind === 'helper-busy') throw e;
          return { job: view(j), reachable: false, error: e.kind || 'error' };
        }
        // unknown/running sind keine Bestätigung; apply() lässt die Abbruchabsicht bestehen.
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
        const jobs = await load();
        const j = jobs.find((x) => x.key === key);
        // P4c: gespeicherter Stand kann veraltet sein (Player war zu). Nicht erreichbar: gespeicherter Stand mit Grund (check).
        if (j) await stillActive(jobs, j);
        return j ? view(j) : null;
      });
    }

    // P4c: Liste für Menü/Popup mit aktuellem Stand: laufende Aufträge einmal beim Helfer nachfragen (höchstens
    // MAX_JOBS Abfragen; nicht erreichbar → gespeicherter Stand). Der Player muss dafür nicht offen sein.
    async function list() {
      const ids = (await serial(async () => (await load()).filter((j) => !FINAL.has(j.state)).map((j) => j.id)));
      for (const id of ids) { try { await status(id); } catch (e) { break; } }
      return serial(async () => (await load()).map(view));
    }

    // P4c: unbestätigter Start (Antwort verloren, z. B. Player oder Tab sofort geschlossen, Verbindung kurz weg): der
    // Hintergrund klärt den Stand selbst nach – unabhängig vom Player –, höchstens dreimal (2 s, 6 s, 20 s), solange der
    // Service Worker lebt. Danach klärt die nächste Abfrage (Menü, Player) mit derselben Kennung.
    const FOLLOW_MS = [2_000, 6_000, 20_000];
    function followUp(id, n = 0) {
      if (n >= FOLLOW_MS.length) return;
      setTimer(() => {
        status(id).then((r) => { if (r && r.job && (r.job.state === 'unconfirmed' || r.job.state === 'starting')) followUp(id, n + 1); },
          () => followUp(id, n + 1));
      }, FOLLOW_MS[n]);
    }

    // ---------------------------------------------------------------- P4b: HLS-Streams
    const HEX24 = /^[0-9a-f]{24}$/, HEX32 = /^[0-9a-f]{32}$/;
    const cleanText = (x, max) => (typeof x === 'string' ? x.replace(/[^A-Za-z0-9 _-]/g, '').slice(0, max) : '');
    // Antwort auf hlsplan streng übernehmen: nur bekannte Felder, Zahlen begrenzt, Texte bereinigt; nie eine Adresse.
    function planOf(r) {
      if (!r || r.ok !== true || typeof r.planId !== 'string' || !HEX32.test(r.planId) || !Array.isArray(r.options) ||
          !r.options.length || r.options.length > 64) return null;
      const opts = [];
      for (const o of r.options) {
        if (!o || typeof o !== 'object' || typeof o.id !== 'string' || !HEX24.test(o.id)) return null;
        const n = (x) => (Number.isSafeInteger(x) && x >= 0 && x <= 1e9 ? x : 0);
        const audio = o.audio === 'muxed' ? 'muxed' : (o.audio && typeof o.audio === 'object' ? { lang: cleanText(o.audio.lang, 16), name: cleanText(o.audio.name, 32) } : null);
        if (!audio) return null;
        opts.push({ id: o.id, height: n(o.height), width: n(o.width), bandwidth: n(o.bandwidth), audio, codecs: o.codecs === 'ok' ? 'ok' : 'unknown' });
      }
      const duration = typeof r.duration === 'number' && isFinite(r.duration) && r.duration >= 0 ? r.duration : 0;
      return { planId: r.planId, duration, options: opts };
    }
    // Gleiche Auswahl in einem neuen Plan (Optionskennungen sind je Plan gesalzen): Höhe, Breite, Bandbreite, Ton.
    const sameOption = (a, b) => a.height === b.height && a.width === b.width && a.bandwidth === b.bandwidth &&
      JSON.stringify(a.audio) === JSON.stringify(b.audio);
    function keepPlan(p) {
      plans.set(p.planId, p);
      for (const [k, v] of plans) if (now() - v.at > 9 * 60_000 || plans.size > 8) plans.delete(k);
    }

    // hlsplan: Optionen (Qualität, Ton) für einen vom Nutzer gewählten Stream. Antwort ohne Adressen; dazu ein
    // laufender oder unterbrochener Auftrag derselben Quelle (zum Fortsetzen).
    function hlsPlan(rawUrl, bind, rawCtx) {
      return serial(async () => {
        const url = normalizeUrl(rawUrl);
        if (!url) { const e = new Error('input'); e.kind = 'input'; throw e; }
        const ctx = await contextFor(rawCtx);
        const key = await digest(url);
        // Fortsetz-Schlüssel ohne Abfrage: dieselbe Quelle mit neuem Zugangs-Token (abgelaufene Adresse) wiederfinden.
        // Nur für das Angebot „Fortsetzen“; ob die Listen wirklich gleich sind, prüft der Helfer (Form-Fingerabdruck,
        // sonst lädt er neu). Doppelte Starts erkennt weiterhin nur der volle Schlüssel.
        const skey = await digest('hls-resume\n' + url.split(/[?#]/)[0]);
        const r = await channel.download('hlsplan', Object.assign({ url, bind }, ctx || {}));
        if (r && r.ok === false) {
          // Helfer lehnt ab: mit Grund (Live, verschlüsselt, Netzgrenze …) – ohne Grund ist es ein Helfer ohne HLS
          const ok = typeof r.reason === 'string' && /^[a-z0-9_]{1,40}$/.test(r.reason);
          const e = new Error(ok ? 'plan' : 'unsupported'); e.kind = ok ? 'plan' : 'unsupported'; if (ok) e.reason = r.reason;
          if (ok) e.diag = planDiagnostic(r.diag);
          throw e;
        }
        const p = planOf(r);
        if (!p) { const e = new Error('protocol'); e.kind = 'protocol'; throw e; }
        keepPlan(Object.assign({ key, skey, url, bind, ctx, at: now() }, p));
        const all = await load();
        for (const x of all) if (x.kind === 'hls' && (x.key === key || x.skey === skey) && !TERMINAL.has(x.state)) await stillActive(all, x);
        const job = all.find((x) => x.key === key && x.kind === 'hls' && !TERMINAL.has(x.state)) ||
          all.find((x) => x.kind === 'hls' && x.state === 'interrupted' && (x.key === key || x.skey === skey));
        return { planId: p.planId, duration: p.duration, options: p.options, job: job ? view(job) : null };
      });
    }

    // hlsstart mit gespeicherter Kennung; ist der Plan beim Helfer abgelaufen (plan_stale, z. B. neue Kanal-Sitzung),
    // genau einmal neu planen und dieselbe Auswahl erneut senden – mit DERSELBEN Kennung.
    async function hlsSend(j, plan, option, name) {
      const args = (p, o) => Object.assign({ id: j.id, planId: p.planId, option: o, bind: p.bind }, name != null ? { name } : {});
      try { return apply(j, await channel.download('hlsstart', args(plan, option))); }
      catch (e) {
        const stale = (e && e.kind === 'plan-rejected' && e.reason === 'plan_stale') || (e && e.kind === 'stale-session' && e.notSent);
        if (!stale) throw e;
        const want = plan.options.find((o) => o.id === option);
        const fresh = planOf(await channel.download('hlsplan', Object.assign({ url: plan.url, bind: plan.bind }, plan.ctx || {})));
        const again = fresh && want && fresh.options.find((o) => sameOption(o, want));
        if (!again) { const e2 = new Error('plan-changed'); e2.kind = 'plan-rejected'; e2.reason = 'plan_changed'; throw e2; }
        const np = Object.assign({ key: plan.key, skey: plan.skey, url: plan.url, bind: plan.bind, ctx: plan.ctx, at: now() }, fresh);
        keepPlan(np);
        return apply(j, await channel.download('hlsstart', args(np, again.id)));
      }
    }

    // Start nach Tipp auf eine Option. Dieselbe Quelle läuft schon → derselbe Auftrag (kein zweiter Start).
    function hlsStart(planId, option, rawName) {
      return serial(async () => {
        const plan = plans.get(planId);
        if (!plan || !plan.options.some((o) => o.id === option)) { const e = new Error('plan-rejected'); e.kind = 'plan-rejected'; e.reason = 'plan_stale'; throw e; }
        const jobs = await load();
        const same = jobs.find((x) => x.key === plan.key && !TERMINAL.has(x.state));
        if (same && await stillActive(jobs, same)) return { job: view(same), existing: true };
        const named = rawName != null && String(rawName).trim() !== '';
        const j = { id: random(), key: plan.key, skey: plan.skey, kind: 'hls', name: cleanName(rawName), named, state: 'starting', bytes: 0, total: -1, reason: '',
          done: 0, of: 0, phase: '', at: now(), seen: 0 };
        jobs.unshift(j);
        await save(jobs);                // erst gespeichert, dann gesendet
        hlsPending.set(j.id, { planId, option, name: named ? j.name : null });
        try {
          await hlsSend(j, plan, option, named ? j.name : null);
        } catch (e) {
          if (uncertain(e)) { j.state = 'unconfirmed'; await save(jobs); followUp(j.id); return { job: view(j), existing: false }; }
          hlsPending.delete(j.id);
          await save(jobs.filter((x) => x.id !== j.id));
          throw e;
        }
        await save(jobs);
        return { job: view(j), existing: false };
      });
    }

    // Unterbrochenen HLS-Auftrag fortsetzen: gleiche Quelle (Schlüssel), neuer Plan, DIESELBE Kennung. Der Helfer
    // übernimmt nur Segmente, die er per starkem ETag als unverändert bestätigt; ein dauerhafter Abbruch gewinnt immer.
    function hlsResume(id, planId, option) {
      return serial(async () => {
        const plan = plans.get(planId);
        const jobs = await load();
        const j = jobs.find((x) => x.id === id);
        if (!j || j.kind !== 'hls' || j.state !== 'interrupted') { const e = new Error('input'); e.kind = 'input'; throw e; }
        if (!plan || (plan.key !== j.key && plan.skey !== j.skey) || !plan.options.some((o) => o.id === option)) { const e = new Error('plan-rejected'); e.kind = 'plan-rejected'; e.reason = 'plan_stale'; throw e; }
        j.state = 'starting';
        await save(jobs);
        try { await hlsSend(j, plan, option, j.named ? j.name : null); }
        catch (e) {
          if (uncertain(e)) { j.state = 'unconfirmed'; await save(jobs); return { job: view(j), existing: true }; }
          j.state = 'interrupted';
          await save(jobs);
          throw e;
        }
        await save(jobs);
        return { job: view(j), existing: true };
      });
    }

    // ---------------------------------------------------------------- S3c: DASH-Streams
    const DASH_VIDEO = /^(avc1|avc3)\.[0-9a-f]{6}$/i;
    // Antwort auf dashplan streng übernehmen: nur bekannte Felder, Zahlen begrenzt, Texte bereinigt; nie eine Adresse.
    // Angeboten wird nur, was der Helfer speichert: fMP4/H.264 + AAC-LC (mp4a.40.2) – jede andere Option entfällt.
    function dashPlanOf(r) {
      if (!r || r.ok !== true || typeof r.planId !== 'string' || !HEX32.test(r.planId) || r.fp !== 'kadri-dash-fp/1' ||
          !Array.isArray(r.options) || !r.options.length || r.options.length > 256) return null;
      const opts = [];
      for (const o of r.options) {
        if (!o || typeof o !== 'object' || typeof o.id !== 'string' || !HEX24.test(o.id)) return null;
        const n = (x) => (Number.isSafeInteger(x) && x >= 0 && x <= 1e9 ? x : 0);
        if (typeof o.video !== 'string' || !DASH_VIDEO.test(o.video) || o.audio !== 'mp4a.40.2') continue;
        const lang = typeof o.lang === 'string' && /^[A-Za-z0-9-]{1,16}$/.test(o.lang) ? o.lang : '';
        opts.push({ id: o.id, height: n(o.height), width: n(o.width), bandwidth: n(o.bandwidth), video: o.video.toLowerCase(), audio: 'mp4a.40.2', lang, played: o.played === true });
      }
      if (!opts.length) return null;
      const duration = typeof r.duration === 'number' && isFinite(r.duration) && r.duration >= 0 ? r.duration : 0;
      const expiresSec = Number.isSafeInteger(r.expiresSec) && r.expiresSec > 0 && r.expiresSec <= 3600 ? r.expiresSec : 600;
      return { planId: r.planId, duration, expiresSec, options: opts };
    }
    const sameDashOption = (a, b) => a.height === b.height && a.width === b.width && a.bandwidth === b.bandwidth && a.lang === b.lang && a.video === b.video;

    // dashplan: Optionen (Qualität × Ton) für einen vom Nutzer gewählten, an genau dieses Video gebundenen DASH-Stream.
    // fp: Kadris Fingerabdruck des gebundenen MPD (der Helfer lehnt ein abweichendes MPD ab); played: Hinweis.
    function dashPlan(rawUrl, fp, bind, played, rawCtx, alt) {
      // S4b-6: Fähigkeit VOR dem Einreihen abfragen (capabilities() reiht sich selbst in serial ein – sonst Verklemmung)
      if (alt !== undefined && alt !== null) {
        return capabilities().then((c) => {
          if (!c || !c.dashAlt) { const e = new Error('plan'); e.kind = 'plan'; e.reason = 'alt_unsupported'; throw e; }
          return dashPlanSerial(rawUrl, fp, bind, played, rawCtx, alt);
        });
      }
      return dashPlanSerial(rawUrl, fp, bind, played, rawCtx, alt);
    }
    function dashPlanSerial(rawUrl, fp, bind, played, rawCtx, alt) {
      return serial(async () => {
        const url = normalizeUrl(rawUrl);
        if (!url || typeof fp !== 'string' || !/^[0-9a-f]{64}$/.test(fp)) { const e = new Error('input'); e.kind = 'input'; throw e; }
        const ctx = await contextFor(rawCtx, true);
        const key = await digest('dash\n' + url);
        // (S4b-6: mit Auswahl nur an einen Helfer, der sie prüft – oben vor dem Einreihen geprüft)
        const args = Object.assign({ url, fp, bind }, played ? { played } : {}, ctx || {}, alt ? { alt } : {});
        const r = await channel.download('dashplan', args);
        if (r && r.ok === false) {
          const ok = typeof r.reason === 'string' && /^[a-z0-9_]{1,40}$/.test(r.reason);
          const e = new Error(ok ? 'plan' : 'unsupported'); e.kind = ok ? 'plan' : 'unsupported'; if (ok) e.reason = r.reason;
          if (ok) e.diag = dashPlanDiagnostic(r.diag);
          throw e;
        }
        const p = dashPlanOf(r);
        if (!p) { const e = new Error('protocol'); e.kind = 'protocol'; throw e; }
        keepPlan(Object.assign({ kind: 'dash', key, url, fp, bind, played: played || '', ctx, alt: alt || '', at: now() }, p));
        const all = await load();
        for (const x of all) if (x.kind === 'dash' && x.key === key && !TERMINAL.has(x.state)) await stillActive(all, x);
        const job = all.find((x) => x.key === key && x.kind === 'dash' && !TERMINAL.has(x.state));
        return { planId: p.planId, duration: p.duration, options: p.options, job: job ? view(job) : null };
      });
    }
    // dashstart mit gespeicherter Kennung; ist der Plan beim Helfer abgelaufen (plan_stale, z. B. neue Kanal-Sitzung oder
    // 10 min um), genau einmal neu planen (gleicher Fingerabdruck) und dieselbe Auswahl erneut senden – DIESELBE Kennung.
    async function dashSend(j, plan, option, name) {
      const args = (p, o) => Object.assign({ id: j.id, planId: p.planId, option: o, bind: p.bind }, name != null ? { name } : {});
      try { return apply(j, await channel.download('dashstart', args(plan, option))); }
      catch (e) {
        const stale = (e && e.kind === 'plan-rejected' && e.reason === 'plan_stale') || (e && e.kind === 'stale-session' && e.notSent);
        if (!stale) throw e;
        const want = plan.options.find((o) => o.id === option);
        const fresh = dashPlanOf(await channel.download('dashplan', Object.assign({ url: plan.url, fp: plan.fp, bind: plan.bind }, plan.played ? { played: plan.played } : {}, plan.ctx || {}, plan.alt ? { alt: plan.alt } : {})));
        const again = fresh && want && fresh.options.filter((o) => sameDashOption(o, want));
        if (!again || again.length !== 1) { const e2 = new Error('plan-changed'); e2.kind = 'plan-rejected'; e2.reason = 'plan_changed'; throw e2; }
        const np = Object.assign({ kind: 'dash', key: plan.key, url: plan.url, fp: plan.fp, bind: plan.bind, played: plan.played, ctx: plan.ctx, alt: plan.alt || '', at: now() }, fresh);
        keepPlan(np);
        return apply(j, await channel.download('dashstart', args(np, again[0].id)));
      }
    }
    function dashStart(planId, option, rawName) {
      return serial(async () => {
        const plan = plans.get(planId);
        if (!plan || plan.kind !== 'dash' || !plan.options.some((o) => o.id === option)) { const e = new Error('plan-rejected'); e.kind = 'plan-rejected'; e.reason = 'plan_stale'; throw e; }
        const jobs = await load();
        const same = jobs.find((x) => x.key === plan.key && x.kind === 'dash' && !TERMINAL.has(x.state));
        if (same && await stillActive(jobs, same)) return { job: view(same), existing: true };
        const named = rawName != null && String(rawName).trim() !== '';
        const j = { id: random(), key: plan.key, kind: 'dash', name: cleanName(rawName), named, state: 'starting', bytes: 0, total: -1, reason: '',
          done: 0, of: 0, phase: '', at: now(), seen: 0 };
        jobs.unshift(j);
        await save(jobs);                // erst gespeichert, dann gesendet
        dashPending.set(j.id, { planId, option, name: named ? j.name : null });
        try {
          await dashSend(j, plan, option, named ? j.name : null);
        } catch (e) {
          if (uncertain(e)) { j.state = 'unconfirmed'; await save(jobs); followUp(j.id); return { job: view(j), existing: false }; }
          dashPending.delete(j.id);
          await save(jobs.filter((x) => x.id !== j.id));
          throw e;
        }
        await save(jobs);
        return { job: view(j), existing: false };
      });
    }

    // Kann der gekoppelte Helfer direkte Downloads? (dlstatus einer nie vergebenen Kennung; 60 s zwischengespeichert)
    function capabilities() {
      return serial(async () => {
        if (caps && now() - caps.at < 60_000) return caps.value;
        let value;
        try {
          const r = await channel.download('dlstatus', { id: PROBE_ID });
          value = { reachable: true, supported: r.ok === true && r.state === 'unknown', hls: false, ctx: false, dash: false };
          // P4b: HLS nur, wenn der Helfer es im Status meldet (alte Helfer: kein Feld → kein Angebot)
          if (value.supported && typeof channel.status === 'function') {
            try {
              const st = await channel.status();
              value.hls = !!(st && st.hls && st.hls.v === 1);
              value.ctx = value.hls && st.hls.ctx === 1;
              ctxCaps = { at: now(), ok: value.ctx };
              // S3c: DASH nur, wenn der Helfer genau dieses Profil und diesen Fingerabdruck meldet (alte Helfer: kein Angebot)
              value.dash = !!(st && dashCapable(st));
              value.dashAlt = value.dash && st.dashdl.alt === 1;   // S4b-6: dashplan v2 (Auswahl unter mehreren BaseURL)
              dashCtxCaps = { at: now(), ok: value.dash && st.dashdl.ctx === 1 };
            } catch (e) { value.hls = false; value.dash = false; }
          }
        } catch (e) { value = { reachable: false, supported: false, hls: false, dash: false, error: e.kind || 'error' }; }
        if (value.reachable) caps = { at: now(), value };
        return value;
      });
    }

    return { start, status, cancel, find, list, capabilities, hlsPlan, hlsStart, hlsResume, dashPlan, dashStart };
  }
  // S3c: Fähigkeit "dashdl" des Helfers: genau v 1, Profil fmp4-avc-aac, Fingerabdruck kadri-dash-fp/1
  function dashCapable(st) {
    const d = st && st.dashdl;
    return !!(d && typeof d === 'object' && d.v === 1 && d.fp === 'kadri-dash-fp/1' && Array.isArray(d.profiles) && d.profiles.indexOf('fmp4-avc-aac') >= 0);
  }

  // Für Anzeigen (Menü, Player): feste Texte je Zustand und Grund – nie Server-Text oder URL.
  function describe(j) {
    if (!j) return { label: 'Unbekannt', progress: '' };
    // P4c-3: MiB abgerundet (nie mehr als wirklich da ist), eine Stelle unter 100 MB – wie die Benachrichtigung des Helfers.
    const mb = (n) => (n >= 104857600 ? String(Math.floor(n / 1048576)) : (Math.floor(n * 10 / 1048576) / 10).toFixed(1).replace('.', ','));
    // P4c-3: Zahlen nur aus verlässlichem Zähler/Nenner. MP4: Prozent der exakten Länge nur bei 0 ≤ bytes ≤ total (ein
    // Widerspruch wird nicht auf 100 % abgeschnitten, sondern ohne Prozent gezeigt). HLS: fertige von allen Teilen und
    // geladene MB – nie eine Gesamtgröße vor dem Ende; danach die Phase.
    const loaded = () => (j.bytes > 0 ? mb(j.bytes) + ' MB geladen' : '');
    const hlsProgress = () => (j.phase === 'mux' ? 'Wird zusammengesetzt …' : j.phase === 'verify' ? 'Wird geprüft …' : j.phase === 'save' ? 'Wird gespeichert …'
      : (j.of > 0 && j.done <= j.of ? j.done + '/' + j.of + ' Teile' + (j.bytes > 0 ? ' · ' : '') : '') + loaded());
    const exact = j.total > 0 && j.bytes >= 0 && j.bytes <= j.total;
    const progress = j.state === 'running' || j.state === 'cancelling' || ((j.state === 'starting' || j.state === 'unconfirmed') && j.bytes > 0)
      ? (j.kind === 'hls' || j.kind === 'dash' ? hlsProgress()
        : exact ? Math.floor(j.bytes * 100 / j.total) + ' % · ' + mb(j.bytes) + ' / ' + mb(j.total) + ' MB' : loaded())
      : j.state === 'done' && j.total > 0 ? mb(j.total) + ' MB' : '';   // exakt die gespeicherte Datei
    // P4c-3: letzte Abfrage beim Helfer gescheitert → kein „Lädt …“/„Startet …“ ohne Ende, sondern der Grund.
    const lost = j.check ? errorText(j.check) : '';
    switch (j.state) {
      case 'starting': return { label: lost ? 'Start nicht bestätigt – ' + lost : 'Startet …', progress };
      case 'unconfirmed': return { label: lost ? 'Start nicht bestätigt – ' + lost + ' (wird beim nächsten Öffnen geprüft)' : 'Verbindung unterbrochen – Stand wird geprüft', progress };
      case 'running': return lost ? { label: lost + ' – letzter bekannter Stand', progress }
        : j.wait === 'offline' ? { label: 'Wartet auf Internet – setzt automatisch fort', progress }
        : j.wait === 'retry' ? { label: 'Verbindung gestört – neuer Versuch in Kürze', progress } : { label: 'Lädt …', progress };
      case 'cancelling': return { label: lost ? 'Abbruch angefordert – ' + lost : 'Wird abgebrochen …', progress };
      case 'done': return { label: 'Gespeichert in Download/Video-Assistent', progress };
      case 'cancelled': return { label: 'Abgebrochen', progress };
      case 'interrupted': return { label: j.kind === 'dash' ? 'Unterbrochen – in der Benachrichtigung der Helfer-App fortsetzen oder erneut speichern' + (j.reason ? ' (' + reasonText(j.reason) + ')' : '')
        : j.kind === 'hls' ? 'Unterbrochen – Helfer-App öffnen, in ihrer Benachrichtigung oder im Player fortsetzen' + (j.reason ? ' (' + reasonText(j.reason) + ')' : '')
        : 'Unterbrochen – öffne die Helfer-App (setzt bis zu 6 h automatisch fort) oder starte erneut', progress };
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
      // P4b: HLS
      plan_changed: 'Stream hat sich geändert – bitte erneut auswählen', plan_stale: 'Auswahl abgelaufen – bitte erneut auswählen',
      option_unknown: 'Auswahl abgelaufen – bitte erneut auswählen', id_in_use: 'Kennung schon vergeben – bitte erneut starten',
      restarted: 'Helfer-App neu gestartet', segment_size: 'Teil des Streams zu groß', size_limit: 'Stream zu groß (über 16 GiB)',
      segments_limit: 'Stream hat zu viele Teile', samples_limit: 'Stream zu lang für dieses Handy', memory: 'Zu wenig Arbeitsspeicher auf dem Handy',
      encrypted: 'Stream ist verschlüsselt (DRM/AES) – nicht speicherbar', live: 'Live-Stream – nicht speicherbar', no_audio: 'Stream ohne Ton – nicht gespeichert',
      audio_codec: 'Tonformat wird nicht unterstützt', video_codec: 'Bildformat wird nicht unterstützt', no_supported_variant: 'Kein unterstütztes Format (H.264/AAC)',
      av_duration_mismatch: 'Bild und Ton passen nicht zusammen', container_mismatch: 'Bild und Ton passen nicht zusammen',
      discontinuity: 'Stream mit Unterbrechungen – nicht unterstützt', byterange: 'Stream-Form nicht unterstützt', remux: 'Zusammensetzen fehlgeschlagen',
      internal: 'Interner Fehler der Helfer-App', expired: 'Unterbrochener Download abgelaufen', incomplete: 'Teile fehlen – bitte erneut starten',
      // S3c: DASH (feste Codes des Helfers, DashEngine/Fmp4Inspect)
      manifest_mismatch: 'Das Manifest beim Helfer weicht vom gespielten ab – nicht gespeichert', fingerprint_missing: 'Manifest nicht geprüft – bitte erneut versuchen',
      dash_no_audio: 'Stream ohne Ton – nicht gespeichert', media_duration: 'Stücke passen nicht zur angegebenen Länge – nichts gespeichert',
      segment_timing: 'Stücke ohne Zeitangaben – nicht speicherbar', codec_mismatch: 'Format weicht von den Angaben ab – nicht speicherbar',
      remux_io: 'Zusammensetzen fehlgeschlagen – nichts gespeichert', init_size: 'Stream-Form nicht unterstützt', init_box: 'Stream-Form nicht unterstützt',
      init_track: 'Stream-Form nicht unterstützt', mp4_structure: 'Stream-Form nicht unterstützt', mp4_boxes: 'Stream-Form nicht unterstützt', segment_box: 'Stream-Form nicht unterstützt',
      fingerprint: 'Manifest nicht lesbar – nicht speicherbar', mpd_size: 'Manifest zu groß', manifest_size: 'Manifest zu groß',
    };
    if (r.startsWith('verify_')) return 'Prüfung des Ergebnisses fehlgeschlagen – nichts gespeichert';
    if (T[r]) return T[r];
    // S3c: Profilgründe des Helfers (DashProfile, mit "_" statt "-")
    if (r === 'dash_live') return 'Live-Stream – nicht speicherbar';
    if (r === 'dash_protected') return 'Stream ist verschlüsselt (DRM) – nicht speicherbar';
    if (r === 'dash_codec') return 'Kein unterstütztes Format (H.264/AAC)';
    if (r.startsWith('dash_')) return 'Stream-Form nicht unterstützt';
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
      plan: 'Stream lässt sich nicht speichern',
      'plan-rejected': 'Auswahl abgelaufen – bitte erneut auswählen',
    })[kind] || 'Helfer-App: Verbindung fehlgeschlagen';
  }

  NS.createDownloads = createDownloads;
  NS.planDiagnostic = planDiagnostic;
  NS.dashPlanDiagnostic = dashPlanDiagnostic;
  NS.dashCapable = dashCapable;
  NS.normalizeDownloadUrl = normalizeUrl;
  NS.downloadName = cleanName;
  NS.describeDownload = describe;
  NS.downloadReasonText = reasonText;
  NS.downloadErrorText = errorText;
})(typeof self !== 'undefined' ? self : globalThis);
