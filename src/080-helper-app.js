  // ---------- Helfer-App: echte Helligkeit und Lautstärke des Handys ----------
  // Nur noch über den gekoppelten, verschlüsselten Kanal (127.0.0.1:47899, SPAKE2 + Noise KK). Den hat nur die
  // Erweiterung Kadri für Chrome/Vivaldi: ihr Hintergrund führt die Steuerbefehle aus (KADRI_HELPER, nur Pfad, keine
  // Daten). Userscript und Firefox haben ihn noch nicht – dort sendet helper() nichts und meldet „kein Helfer“, der
  // Player läuft wie ohne App. Bewusst kein Rückfall auf den alten Klartext-Port.
  async function helper(path) {
    if (CONFIG.systemHelper === false || typeof KADRI_HELPER !== 'function') return null;
    try { return await KADRI_HELPER(String(path)); } catch (e) { return null; }
  }
  // Direkte MP4-Downloads über denselben Kanal (nur Kadri für Chrome/Vivaldi, KADRI_DOWNLOAD): der Helfer lädt die Datei
  // selbst, ohne Cookies oder Sitzung des Browsers. Sonst (Userscript, Firefox, Helfer aus) gibt es diesen Weg nicht.
  async function helperDl(op, args) {
    if (CONFIG.systemHelper === false || typeof KADRI_DOWNLOAD !== 'function') return null;
    try { return await KADRI_DOWNLOAD(op, args || {}); } catch (e) { return null; }
  }
  // ---------- Diagnose der Helfer-Downloads (Seitenleben, NICHT an den Player gebunden; nie eine Adresse) ----------
  // Je gestartetem oder gefundenem Auftrag: Herkunft/Bindung/Art der Quelle (aus der Registry, ohne Adresse), Alter beim
  // Start, Zustand, Grundcode, Zeit bis zum Fehler und – einmal bei einem HTTP-Fehler – ein Vergleichsabruf aus dem
  // Browser OHNE Cookies und OHNE Referer (1 Byte, Kadris Hintergrund mit Netzschutz). Bleibt nach dem Schließen oder
  // Neuöffnen des Players erhalten; nach dem Schließen fragt die Seite den Stand weiter ab (höchstens 15 min, nur sichtbar).
  // Die Adresse liegt nur im Arbeitsspeicher, bis der Vergleich gelaufen oder der Auftrag beendet ist.
  const hdlDiags = [];   // jüngste zuerst, höchstens 4
  let hdlDiagChanged = null;   // (der offene Player zeigt den Stand am Download-Knopf, für Tests)
  const hdlDiagUrl = new WeakMap();
  const hdlDiagLocal = new WeakMap();   // Blick auf die eigene Wiedergabe derselben Adresse (nur Zahlen, einmal nach dem Fehler)
  const HDL_TERMINAL = ['done', 'failed', 'cancelled'];
  // Gemeinsame Quellenangaben für Webseitenknopf und Player. Alter = erste Beobachtung, NICHT Token-Gültigkeit.
  function hdlSourceInfo(o, play) {
    let e = null;
    try { e = mediaRegistry.snapshot(o.ctx).find((x) => x.sourceId === o.sourceId) || null; } catch (x) {}
    const first = e && e.provenance && e.provenance[0];
    return { at: Date.now(), identity: o.identity || '?', qstate: e && e.quality ? e.quality.status : '?', play: play || null,
      origin: e ? e.provenance.map((p) => p.kind + '/' + p.origin).join('+') : '?',
      binding: e && e.association ? e.association.state + ':' + e.association.evidence.join(',') : '?',
      kind: e ? e.kind : '?', role: e ? e.role : '?',
      height: e && e.quality && e.quality.status !== 'unknown' && e.quality.value ? e.quality.value.height || 0 : 0,
      ageSec: first && first.observedAt ? Math.max(0, Math.round((Date.now() - first.observedAt) / 1000)) : -1,
      loaded: !!(e && e.browser === 'loaded'), current: !!(e && e.revision === o.revision) };
  }
  const hdlDiagCode = (s) => typeof s === 'string' && /^[a-z0-9_-]{1,40}$/.test(s) ? s : '';
  // Fehler vor einer Auftragskennung (z. B. hlsplan): ebenfalls behalten, ohne künstlichen Downloadauftrag.
  function hdlDiagFailure(info, r) {
    const d = Object.assign({ at: Date.now(), state: 'rejected', failAfter: 0 }, info,
      { reason: hdlDiagCode(r && r.error && (r.error.reason || r.error.kind)) || 'unreachable' });
    const diag = r && r.error && r.error.diag;
    // Validate again at the page boundary. Old helpers have no diag; retain their unknown phase.
    if (d.stage === 'hlsplan' && diag && diag.v === 1 &&
        ['source_fetch', 'source_parse', 'source_options', 'video_fetch', 'video_parse', 'audio_fetch', 'audio_parse', 'plan_build'].indexOf(diag.phase) >= 0 &&
        Number.isSafeInteger(diag.playlists) && diag.playlists >= 0 && diag.playlists <= 3) {
      d.planPhase = diag.phase; d.playlists = diag.playlists;
    }
    d.failAfter = Math.max(0, Math.round((Date.now() - d.at) / 1000));
    hdlDiags.unshift(d);
    while (hdlDiags.length > 4) hdlDiags.pop();
    if (typeof hdlDiagChanged === 'function') { try { hdlDiagChanged(); } catch (e) {} }
    return d;
  }
  function hdlDiagFor(id) { return hdlDiags.find((d) => d.id === id) || null; }
  function hdlDiagNew(info, url, job, local) {
    if (!job || !job.id) return null;
    let d = hdlDiagFor(job.id);
    if (!d) {
      d = Object.assign({ id: job.id, at: Date.now(), state: '', reason: '', failAfter: 0, probe: '' }, info);
      hdlDiags.unshift(d);
      while (hdlDiags.length > 4) hdlDiags.pop();
      if (url) hdlDiagUrl.set(d, url);
      if (typeof local === 'function') hdlDiagLocal.set(d, local);
      hdlDiagWatch(d);
    }
    d.type = job.kind === 'hls' || info.stream ? 'hls' : 'mp4';
    hdlDiagUpdate(job);
    return d;
  }
  function hdlDiagUpdate(job) {
    const d = job && hdlDiagFor(job.id);
    if (!d || HDL_TERMINAL.indexOf(d.state) >= 0) return;
    const previous = d.state + ':' + d.reason;
    d.state = ['starting', 'unconfirmed', 'running', 'cancelling', 'interrupted', 'done', 'failed', 'cancelled'].indexOf(job.state) >= 0 ? job.state : 'unknown';
    d.reason = hdlDiagCode(job.reason);
    d.check = hdlDiagCode(job.check);
    d.phase = ['fetch', 'mux', 'verify', 'save'].indexOf(job.phase) >= 0 ? job.phase : '';
    if (d.type === 'hls') {
      d.done = Number.isSafeInteger(job.done) && job.done >= 0 ? job.done : 0;
      d.of = Number.isSafeInteger(job.of) && job.of >= 0 ? job.of : 0;
    }
    if ((d.state === 'failed' || d.state === 'interrupted') && previous !== d.state + ':' + d.reason) {
      d.failAfter = Math.round((Date.now() - d.at) / 1000);
      if (/^(range_)?http_\d{3}$/.test(d.reason)) hdlDiagProbe(d);
      hdlDiagAfter(d);
    }
    if (HDL_TERMINAL.indexOf(d.state) >= 0 && d.probe !== 'läuft') hdlDiagUrl.delete(d);
    if (typeof hdlDiagChanged === 'function') { try { hdlDiagChanged(); } catch (e) {} }
  }
  function hdlDiagProbe(d) {
    const u = hdlDiagUrl.get(d), x = gmXhr();
    if (d.probe) return;
    // Der Helfer meldet keine fehlerhafte HLS-Adresse. Ein Abruf der Hauptliste wäre KEIN Segmentvergleich.
    if (d.type === 'hls') { d.probe = 'nicht durchgeführt (HLS-Ressource unbekannt)'; return; }
    if (!x || !u) { d.probe = 'nicht möglich'; return; }
    d.probe = 'läuft';
    let req = null, fin = false;
    const end = (v) => {
      if (fin) return; fin = true; d.probe = v; hdlDiagUrl.delete(d);
      try { if (req) req.abort(); } catch (e) {}
      if (typeof hdlDiagChanged === 'function') { try { hdlDiagChanged(); } catch (e) {} }
    };
    try {
      req = x({ method: 'GET', url: u, headers: { Range: 'bytes=0-0' }, anonymous: true, timeout: 15000, responseType: 'arraybuffer',
        onreadystatechange: (r) => { if (r && r.readyState === 2 && r.status) end('HTTP ' + r.status); },
        onload: (r) => end('HTTP ' + ((r && r.status) || '?')), onerror: () => end('Netzwerkfehler'), ontimeout: () => end('Zeitüberschreitung') });
    } catch (e) { end('nicht möglich'); }
  }
  // Nach einem Fehler: Lädt der Browser im eigenen Player DIESELBE Adresse ohne Fehler weiter? Kein zusätzlicher Abruf –
  // nur gepufferte Sekunden und Fehlercode des Videoelements, jetzt und 20 s später. Hinweis, kein Beweis (der Browser
  // kann Vorgeladenes nachreichen); sagt nichts über Cookies vs. Referer.
  function hdlDiagAfter(d) {
    const f = hdlDiagLocal.get(d);
    hdlDiagLocal.delete(d);
    if (!f) return;
    const a = f();
    if (!a) { d.after = 'Player zu oder anderes Medium – nicht prüfbar'; return; }
    d.after = 'wird 20 s beobachtet';
    setTimeout(() => {
      const b = f();
      d.after = !b ? 'Player zu oder anderes Medium – nicht prüfbar'
        : b.err ? 'Browser-Medienfehler ' + b.err
        : b.buf > a.buf ? 'Browser lud danach weiter (+' + (b.buf - a.buf) + ' s gepuffert, kein Fehler)'
        : 'keine neuen Daten (' + (b.paused ? 'pausiert' : 'evtl. schon vollständig gepuffert') + ') – nicht aussagekräftig';
      if (typeof hdlDiagChanged === 'function') { try { hdlDiagChanged(); } catch (e) {} }
    }, 20000);
  }
  function hdlDiagWatch(d) {
    const tick = () => {
      if (hdlDiags.indexOf(d) < 0 || HDL_TERMINAL.indexOf(d.state) >= 0 || Date.now() - d.at > 15 * 60e3) { if (d.probe !== 'läuft') hdlDiagUrl.delete(d); return; }
      if (document.hidden) { setTimeout(tick, 3000); return; }
      helperDl('status', { id: d.id }).then((r) => {
        if (r && r.ok && r.value && r.value.job) hdlDiagUpdate(r.value.job);
        setTimeout(tick, 2000);
      });
    };
    setTimeout(tick, 2000);
  }
  function hdlDiagText(d) {
    if (!d) return '-';
    const status = /^(?:range_)?http_(\d{3})$/.exec(d.reason || '');
    const type = d.type || (d.stream ? 'hls' : d.kind === 'mp4' ? 'mp4' : '?');
    const phase = d.state === 'rejected' && d.stage === 'hlsplan' ? 'hlsplan' : status && type === 'mp4' ? (d.reason.indexOf('range_') === 0 ? 'mp4-range' : 'mp4-get') : d.phase || 'unbekannt';
    return 'Typ ' + type + ' · Zustand ' + (d.state || '?') + (d.reason ? ' · Grund ' + d.reason + ' nach ' + d.failAfter + ' s' : '') +
      (status ? ' · HTTP ' + status[1] : '') + ' · Phase ' + phase + (d.stage ? ' · Aufruf ' + d.stage : '') +
      (d.planPhase ? ' · Planungsschritt ' + d.planPhase + ' · Listen verarbeitet ' + d.playlists + ' · Medienabrufe noch nicht begonnen' : '') +
      (d.check ? ' · Statusabfrage ' + d.check : '') +
      (type === 'hls' ? ' · Planung ' + (d.planned ? 'erfolgreich (erste Option)' : 'unbekannt') +
        (d.planPhase ? ' · Ressourcen 0 (Planung)' : ' · Ressourcen ' + (Number.isSafeInteger(d.done) ? d.done + '/' + d.of + ' (inkl. Init)' : '?') +
        ' · genaue Fehlerressource/Segmentzahl unbekannt') : '') +
      ' · Quelle ' + (d.kind || '?') + '/' + (d.role || '?') + (d.height ? ' ' + d.height + 'p' : '') + ' · Herkunft ' + (d.origin || '?') +
      ' · Bindung ' + (d.binding || '?') + ' · im Player geladen ' + (d.loaded ? 'ja' : 'nein') +
      ' · Identität ' + (d.identity === 'played' ? 'diese Wiedergabe' : d.identity === 'declared' ? 'laut Seite' : '?') +
      (d.height ? ' · Höhe ' + (d.qstate || '?') : '') +
      (d.play ? ' · Wiedergabe beim Start: Bild ' + d.play.w + 'x' + d.play.h + ' dekodiert, Bereitschaft ' + d.play.rs +
        ', gepuffert ' + d.play.buf + ' s, gespielt ' + d.play.played + ' s' + (d.play.err ? ', Medienfehler ' + d.play.err : '') : '') +
      ' · Alter beim Start ' + (d.ageSec >= 0 ? d.ageSec + ' s' : '?') + (d.existing ? ' · Auftrag bestand schon' : '') +
      ' · Auswahl noch aktuell ' + (d.current === true ? 'ja' : d.current === false ? 'nein' : '?') +
      (d.probe ? ' · Browser ohne Cookies/Referer: ' + d.probe : '') + (d.after ? ' · nach dem Fehler: ' + d.after : '');
  }
  // Einen früher gespeicherten Kopplungsschlüssel des alten Ports nicht weiter aufbewahren.
  try { if (typeof GM_getValue === 'function' && typeof GM_setValue === 'function' && GM_getValue('helperKey', '')) GM_setValue('helperKey', ''); } catch (e) {}
  // ---------- Laden über den Browser (für Server, die nur dem eingeloggten Browser etwas geben) ----------
  // Der Helfer sagt, was er braucht (/pull) – das Skript lädt es mit der Sitzung des Browsers und liefert (/push).
  // Läuft, solange die Seite offen ist (der Player darf zu sein).
  // anon = ohne Cookies: für Adressen fremder Seiten (eine bösartige Playlist darf nicht mit deiner Sitzung woanders abrufen)
  function gmGet(u, off, len, sizeOnly, anon, expectedValidator, expectedTotal = -1, job) {
    return new Promise((res) => {
      if (job && job.cancelled) { res({ st: 499 }); return; }
      const x = gmXhr();
      if (!x) { res({ st: 502 }); return; }
      const ranged = sizeOnly || off >= 0 && len > 0;
      const start = sizeOnly ? 0 : off, count = sizeOnly ? 1 : len;
      if (ranged && (!Number.isSafeInteger(start) || !Number.isSafeInteger(count) || count <= 0 || !Number.isSafeInteger(start + count))) { res({ st: 422 }); return; }
      const headers = { Referer: mediaReferrer(u) };
      if (ranged) headers.Range = 'bytes=' + start + '-' + (start + count - 1);
      if (ranged && !sizeOnly && expectedValidator) headers['If-Range'] = expectedValidator;
      let request, done = false, pendingAbort = false;
      const finish = (value, abort) => {
        if (done) return;
        done = true; clearTimeout(timer);
        if (job) job.aborters.delete(cancel);
        if (abort) { if (request) { try { request.abort(); } catch (e) {} } else pendingAbort = true; }
        res(value);
      };
      const cancel = () => finish({ st: 499 }, true);
      const timer = setTimeout(() => finish({ st: 504 }, true), 60400);
      if (job) job.aborters.add(cancel);
      function parse(r, headOnly) {
        const st = +r.status;
        if (st >= 400) return { st: st };
        if (st !== 200 && st !== 206) return { st: 422 };
        const fields = {};
        String(r.responseHeaders || '').split(/\r?\n/).forEach((line) => {
          const at = line.indexOf(':'); if (at <= 0) return;
          const name = line.slice(0, at).trim().toLowerCase(), value = line.slice(at + 1).trim();
          (fields[name] || (fields[name] = [])).push(value);
        });
        const values = (name) => fields[name] || [];
        const single = (name) => values(name)[0] || '';
        const bad = () => ({ st: 422 });
        const lengths = values('content-length'), transfers = values('transfer-encoding');
        if (lengths.length && transfers.length) return bad();
        if (transfers.length && (transfers.length !== 1 || !/^chunked$/i.test(transfers[0]))) return bad();
        let declared = -1;
        for (const value of lengths) {
          if (!/^\d+$/.test(value) || !Number.isSafeInteger(+value) || declared >= 0 && declared !== +value) return bad();
          declared = +value;
        }
        const encoded = single('content-encoding') && !/^identity$/i.test(single('content-encoding'));
        const etag = single('etag');
        const validator = etag && !/^W\//i.test(etag) ? etag : single('last-modified');
        if (expectedValidator && validator !== expectedValidator) return bad();
        let total = encoded ? -1 : declared, span = -1;
        if (st === 206) {
          const cr = /^bytes (\d+)-(\d+)\/(\d+|\*)$/i.exec(single('content-range'));
          if (!ranged || encoded || values('content-range').length !== 1 || !cr) return bad();
          const a = +cr[1], b = +cr[2]; total = cr[3] === '*' ? -1 : +cr[3];
          if (![a, b, total].every(Number.isSafeInteger) || a !== start || b < a || b >= start + count || total >= 0 && b >= total) return bad();
          span = b - a + 1;
          if (span !== count && (total < 0 || b !== total - 1) || declared >= 0 && declared !== span) return bad();
        }
        if (expectedTotal >= 0 && total >= 0 && total !== expectedTotal) return bad();
        if (headOnly) return { st: st, total: total, validator: validator, body: null };
        const data = r.response;
        if (Object.prototype.toString.call(data) !== '[object ArrayBuffer]') return bad();
        if (!encoded && declared >= 0 && declared !== data.byteLength || span >= 0 && span !== data.byteLength) return bad();
        if (sizeOnly) return { st: st, total: total, validator: validator, body: null };
        if (st === 200) {
          total = data.byteLength;
          if (expectedTotal >= 0 && total !== expectedTotal) return bad();
          if (ranged) {
            if (start >= total) return bad();
            const end = Math.min(start + count, total);
            return { st: 206, total: total, validator: validator, body: start === 0 && end === total ? data : data.slice(start, end) };
          }
        }
        return { st: st, total: total, validator: validator, body: data };
      }
      try {
        request = x({
          method: 'GET', url: u, headers: headers, responseType: 'arraybuffer', timeout: 60000, anonymous: !!anon,
          onreadystatechange: (r) => {
            // A size probe never needs its body, including unknown-size/ignored Range.
            if (!sizeOnly || r.readyState !== 2 || !(r.status === 200 || r.status === 206)) return;
            if (r.status === 206 && !/content-range:/i.test(r.responseHeaders || '')) return;
            finish(parse(r, true), true);
          },
          onload: (r) => { if (!done) finish(parse(r, false)); },
          onerror: () => finish({ st: 502 }, true), ontimeout: () => finish({ st: 504 }, true), onabort: () => finish({ st: 499 }),
        });
        if (pendingAbort && request) request.abort();
      } catch (e) { finish({ st: 502 }, true); }
    });
  }
  const proxyJobs = new Map();
  let proxyActive = 0;
  const proxyWaiting = [];
  function pumpProxy() {
    while (proxyActive < 2 && proxyWaiting.length) {
      const entry = proxyWaiting.shift();
      if (entry.job.cancelled) { entry.resolve(false); continue; }
      proxyActive++; entry.resolve(true);
    }
  }
  function cancelProxyJob(job) {
    if (job.cancelled) return;
    job.cancelled = true;
    for (let i = proxyWaiting.length - 1; i >= 0; i--) {
      if (proxyWaiting[i].job === job) proxyWaiting.splice(i, 1)[0].resolve(false);
    }
    for (const abort of [...job.aborters]) { try { abort(); } catch (e) {} }
    pumpProxy();
  }
  async function proxyTransfer(job, run) {
    const acquired = await new Promise((resolve) => {
      if (job.cancelled) { resolve(false); return; }
      proxyWaiting.push({ job, resolve }); pumpProxy();
    });
    if (!acquired) return;
    try { if (!job.cancelled) await run(); }
    catch (e) { cancelProxyJob(job); }
    finally { proxyActive--; pumpProxy(); }
  }
  function proxyPause(job, ms) {
    return new Promise((resolve) => {
      let timer;
      const wake = () => { clearTimeout(timer); job.aborters.delete(wake); resolve(); };
      if (job.cancelled) { resolve(); return; }
      job.aborters.add(wake); timer = setTimeout(wake, ms);
    });
  }
  function proxyAlive(reply) {
    if (!reply) return null;
    return reply.ok === true && typeof reply.state === 'string' &&
      !/^(fertig|abgebrochen|Fehler\b)/i.test(reply.state);
  }
  // allow = domains whose browser session may be used, unchanged from the existing policy.
  async function proxyLoop(job, allow) {
    if (proxyJobs.has(job)) return;
    const state = { cancelled: false, aborters: new Set() };
    const ok = (u) => { const d = baseDomain(hostOf(u)); return !!d && (allow || []).indexOf(d) >= 0; };
    proxyJobs.set(job, state);
    const transfers = new Map();
    try {
      let idle = 0;
      while (!state.cancelled) {
        const r = await helper('/pull?job=' + job, 12000, null, null, state);
        if (!r) { if (++idle > 5) break; await proxyPause(state, 1000); continue; }
        idle = 0;
        if (r.done) break;
        const requests = r.reqs || [];
        if (!requests.length) continue; // /pull already provides the idle wait.
        // Keep this pulled batch while status is temporarily unknown; never re-pull it.
        let initialAlive = null;
        for (let attempt = 0; attempt < 3 && !state.cancelled; attempt++) {
          initialAlive = proxyAlive(await helper('/dlstate?id=' + job, 1200, null, null, state));
          if (initialAlive !== null) break; // Confirmed active or terminal, not a transport failure.
          if (attempt < 2) await proxyPause(state, 2000);
        }
        if (initialAlive !== true) { cancelProxyJob(state); break; }
        // Poll only while a batch owns active or queued work, one request at a time.
        let batchDone = false, stopWatch, missedStatus = 0;
        const watcher = (async () => {
          while (!batchDone && !state.cancelled) {
            await new Promise((resolve) => {
              let timer;
              stopWatch = () => { clearTimeout(timer); state.aborters.delete(stopWatch); resolve(); };
              state.aborters.add(stopWatch); timer = setTimeout(stopWatch, 2000);
            });
            if (batchDone || state.cancelled) break;
            const reply = await helper('/dlstate?id=' + job, 1200, null, null, state);
            const alive = proxyAlive(reply);
            if (alive === false || alive === null && ++missedStatus >= 3) cancelProxyJob(state);
            if (alive === true) missedStatus = 0;
          }
        })().catch(() => cancelProxyJob(state));
        try {
          await Promise.all(requests.map((q) => proxyTransfer(state, async () => {
            let g;
            if (!/^https?:\/\//i.test(q.u)) g = { st: 400 };
            else {
              const expected = transfers.get(q.u);
              g = await gmGet(q.u, q.o, q.l, q.s, !ok(q.u), expected && expected.validator, expected ? expected.total : -1, state);
              if (q.s && g.st < 400) transfers.set(q.u, { validator: g.validator, total: g.total });
            }
            if (state.cancelled) return;
            const st = g.st || 502, body = g.body && st < 400 ? g.body : new ArrayBuffer(0);
            const reply = await helper('/push?job=' + job + '&id=' + q.id + '&st=' + st + '&total=' + (g.total == null ? -1 : g.total), 60000, body, null, state);
            if (!reply || reply.ok !== true || st >= 400 && st < 500) cancelProxyJob(state);
          })));
        } finally { batchDone = true; if (stopWatch) stopWatch(); await watcher; }
      }
    } catch (e) { cancelProxyJob(state); }
    finally { cancelProxyJob(state); proxyJobs.delete(job); }
  }
  // Beim Wischen nicht jede Bewegung schicken: immer nur den neuesten Wert, sobald die vorige Antwort da ist
  const helperQ = {};
  function helperSend(kind, v) {
    const q = helperQ[kind] || (helperQ[kind] = { busy: false, want: null });
    q.want = v;
    if (!q.busy) helperPump(kind);
  }
  function helperPump(kind) {
    const q = helperQ[kind];
    if (q.want === null) { q.busy = false; return; }
    const v = q.want;
    q.want = null;
    q.busy = true;
    helper('/' + kind + '?v=' + v.toFixed(3)).then(() => setTimeout(() => helperPump(kind), 25));
  }
  const helperBusy = (kind) => !!(helperQ[kind] && helperQ[kind].busy);

  function finalUrlGM(u, xhr) {
    return new Promise((resolve) => {
      let done = false, req = null;
      const desc = (st, f) => 'HTTP ' + st + (f && f !== u ? ' → ' + hostOf(f) : ' (keine Weiterleitung)');
      const finish = (f, info) => {
        if (done) return;
        done = true;
        clearTimeout(timer);
        lastResolve = info;
        try { req && req.abort && req.abort(); } catch (e) {}
        resolve(f || u);
      };
      const timer = setTimeout(() => finish(u, 'Zeitüberschreitung'), 4000);
      try {
        req = xhr({
          method: 'GET',
          kadriPurpose: 'player-resolve',
          url: u,
          headers: { Range: 'bytes=0-1', Referer: mediaReferrer(u) },   // wie der Web-Player der Seite
          timeout: 4000,
          onreadystatechange: (r) => { if (r && r.readyState >= 2 && r.finalUrl) finish(r.finalUrl, desc(r.status, r.finalUrl)); },
          onload: (r) => finish((r && r.finalUrl) || u, desc(r && r.status, r && r.finalUrl)),
          onerror: () => finish(u, 'Anfrage abgelehnt'),
          ontimeout: () => finish(u, 'Zeitüberschreitung'),
        });
      } catch (e) { finish(u, 'nicht möglich (' + ((e && e.name) || 'Fehler') + ')'); }
    });
  }

  // Datei mit den Angaben der Seite anfragen (nur 2 Bytes) und die Endadresse nach Weiterleitungen nehmen
  async function finalUrl(u) {
    const xhr = gmXhr();
    if (xhr) return finalUrlGM(u, xhr);
    const ctl = typeof AbortController !== 'undefined' ? new AbortController() : null;
    const timer = setTimeout(() => { try { ctl && ctl.abort(); } catch (e) {} }, 2500);
    try {
      const res = await fetch(u, {
        headers: { Range: 'bytes=0-1' }, referrerPolicy: 'strict-origin-when-cross-origin',
        credentials: 'include',
        cache: 'no-store',
        signal: ctl ? ctl.signal : undefined,
      });
      clearTimeout(timer);
      const f = res.url || u;
      lastResolve = 'HTTP ' + res.status + (f !== u ? ' → ' + hostOf(f) : ' (keine Weiterleitung)');
      try { ctl && ctl.abort(); } catch (e) {}
      return f;
    } catch (e) {
      clearTimeout(timer);
      lastResolve = 'nicht möglich (' + ((e && e.name) || 'Fehler') + ')';
      return u;
    }
  }
