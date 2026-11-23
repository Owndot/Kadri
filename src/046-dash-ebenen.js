  // ================= S4b: DASH in fünf getrennten Ebenen (eine Entscheidung für Menü, Player und Diagnose) =================
  // E1 Manifest gelesen? · E2 sicher diesem Video zugeordnet? · E3 Format/Adressierung unterstützt? · E4 Helfer verfügbar
  // und fähig? · E5 Planung/Download. Jede Ebene hat einen festen, maschinenlesbaren Code; die ERSTE blockierende Ebene
  // (E1…E4) bestimmt die Hauptmeldung, weitere bekannte Hindernisse stehen nur in der Diagnose. „Nicht unterstützt“ nur bei
  // E3/E4 – eine fehlende Bindung (E2) oder ein nicht lesbares Manifest (E1) ist kein fehlendes Format.
  // Diese Datei ändert keine Entscheidung über Bindung oder Angebot: sie liest die vorhandenen Ergebnisse (src/038–045,
  // src/060, dashOfferFor in src/105) und benennt sie. Keine Adresse, kein Seitentext in Codes oder Meldungen.

  // Codec-Bezeichnung aus einem RFC-6381-Kürzel (nur feste Namen, kein Text aus dem MPD)
  function dashCodecName(c) {
    const s = String(c || '').trim().toLowerCase(), x = s.split('.')[0];
    if (x === 'avc1' || x === 'avc3') return 'H.264';
    if (x === 'hvc1' || x === 'hev1') return 'HEVC';
    if (x === 'dvh1' || x === 'dvhe') return 'Dolby Vision';
    if (x === 'vp09' || x === 'vp9') return 'VP9';
    if (x === 'vp08' || x === 'vp8') return 'VP8';
    if (x === 'av01') return 'AV1';
    if (x === 'mp4a') {
      const o = s.split('.').slice(1).join('.');
      return o === '40.2' ? 'AAC-LC' : o === '40.5' ? 'HE-AAC' : o === '40.29' ? 'HE-AAC v2' : /^40(\.|$)/.test(o) || o === '67' ? 'AAC'
        : o === '6b' || o === '69' ? 'MP3' : o === 'a5' ? 'AC-3' : o === 'a6' ? 'E-AC-3' : 'MPEG-4 Audio';
    }
    if (x === 'ac-3') return 'AC-3';
    if (x === 'ec-3') return 'E-AC-3';
    if (x === 'ac-4') return 'AC-4';
    if (x === 'opus') return 'Opus';
    if (x === 'vorbis') return 'Vorbis';
    if (x === 'flac') return 'FLAC';
    return '';
  }
  // Rohdaten für die Formatbenennung aus dem gelesenen MPD (privat, nur intern): je Darstellung Art, Container, Codec-Namen
  function dashRawFormats(parsed) {
    const out = { video: [], audio: [], container: [] };
    if (!parsed || !parsed.root) return out;
    const add = (arr, v) => { if (v && arr.indexOf(v) < 0 && arr.length < 8) arr.push(v); };
    dashKids(parsed.root, 'Period').slice(0, 8).forEach((per) => dashKids(per, 'AdaptationSet').slice(0, 64).forEach((a) => dashKids(a, 'Representation').slice(0, 64).forEach((r) => {
      const at = (k) => r.getAttribute(k) || a.getAttribute(k) || '';
      const mime = String(at('mimeType')).toLowerCase(), ct = String(a.getAttribute('contentType') || '').toLowerCase();
      const kind = ct === 'video' || ct === 'audio' ? ct : /^video\//.test(mime) ? 'video' : /^audio\//.test(mime) ? 'audio' : '';
      if (!kind) return;
      String(at('codecs')).split(',').forEach((c) => add(out[kind], dashCodecName(c) || 'unbekannt'));
      const cont = dashContainer(mime);
      add(out.container, cont === 'mp4' ? 'MP4' : cont === 'webm' ? 'WebM' : cont === 'unknown' ? '' : cont);
    })));
    return out;
  }

  const DASH_LV_E2 = { 'keine-treffer': 'none', 'zu-wenig-folge': 'few', 'nicht-aktiv': 'stale', 'mehrere-videos': 'multi-video',
    konkurrenz: 'competing', 'dauer-abweicht': 'duration', 'nicht-pruefbar': 'uncheckable', 'start-unknown': 'start-unknown' };
  const DASH_LV_E3 = { 'dash-live': 'live', 'dash-type': 'live', 'dash-protected': 'protected', 'dash-multiperiod': 'multiperiod',
    'dash-duration-unknown': 'duration-unknown', 'dash-duration-limit': 'duration-limit', 'dash-no-audio': 'no-audio', 'dash-no-video': 'no-video',
    'dash-addressing': 'addressing', 'dash-codec': 'format', 'dash-audio-codec': 'audio-codec', 'dash-unsupported': 'unsupported',
    // S4b-5: Gründe aus der Vorprüfung im Gleichlauf mit dem Helfer (src/039 dfpGate)
    'dash-coverage': 'coverage', 'dash-timeline': 'timeline', 'dash-limit': 'limit' };
  // Reine Entscheidung. inp: {
  //   read: gültiges MPD gelesen · invalid: nur verworfene MPD-Texte · invisible: MSE läuft, aber kein Medienabruf sichtbar ·
  //   gone/changed: Angebot zwischen Prüfung und Tipp verschwunden bzw. Quelle gewechselt ·
  //   bound · bindReason (Grund der Stückprüfung, src/038) · cls { host, query, number } (Abgleich des Kandidaten) ·
  //   protectedSource (Registry) · gate { ok, reason, coverage } | null · fpError · fpCode (Grund ohne Abdruck, z. B. baseurl-multiple) ·
  //   fmt { video, audio, container } ·
  //   caps { known, reachable, supported, dash, error } · job { state, reason, stage } | null }
  // Ergebnis: { e1..e5: { ok, code }, first: 'E1'…'E4' | '', code: 'E2/host' …, main, sub } – Texte deutsch, t übersetzt Teile.
  function dashLevels(inp, t) {
    t = typeof t === 'function' ? t : (x) => x;
    const L = { e1: { ok: true, code: 'read' }, e2: { ok: true, code: 'bound' }, e3: { ok: true, code: 'ok' }, e4: { ok: true, code: 'ok' }, e5: { ok: true, code: 'none' } };
    // E1
    if (inp.gone) L.e1 = { ok: false, code: 'gone' };
    else if (!inp.read) L.e1 = { ok: false, code: inp.invalid ? 'invalid' : inp.invisible ? 'unread-invisible' : 'unread' };
    // E2 (nur mit gelesenem MPD prüfbar)
    if (!L.e1.ok) L.e2 = { ok: false, code: 'n/a' };
    else if (inp.changed) L.e2 = { ok: false, code: 'changed' };
    else if (!inp.bound) {
      let c = DASH_LV_E2[inp.bindReason] || 'none';
      if (c === 'none') { const k = inp.cls || {}; c = k.host > 0 ? 'host' : k.query > 0 ? 'query' : k.number > 0 ? 'number' : inp.invisible ? 'invisible' : 'none'; }
      // S4b-4: Beginn des Mediums nicht gesehen (nur ab Beobachtung gezählt) und zu wenig gesehen: das konkret sagen
      if (inp.epochLate && (c === 'none' || c === 'few' || c === 'stale' || c === 'invisible')) c = 'epoch-late';
      // S4b-5: Manifest mit mehreren Server-Alternativen (BaseURL) – vor S4b-6 weder zuordenbar noch speicherbar (Helfer:
      // mpd_baseurl_multiple); den Grund nennen statt „anderer Server“ oder „weiter abspielen“
      if (inp.fpCode === 'baseurl-multiple') c = 'baseurl-multiple';
      L.e2 = { ok: false, code: c };
    }
    // E3 (unabhängig von E2, sobald ein MPD gelesen ist; Schutz laut Registry gilt immer)
    const fmt = inp.fmt || { video: [], audio: [], container: [] };
    if (inp.protectedSource) L.e3 = { ok: false, code: 'protected' };
    else if (!L.e1.ok) L.e3 = { ok: false, code: 'n/a' };
    else if (inp.fpError || !inp.gate) L.e3 = { ok: false, code: inp.fpCode === 'baseurl-multiple' ? 'baseurl-multiple' : 'unchecked' };
    else if (!inp.gate.ok) {
      let c = DASH_LV_E3[inp.gate.reason] || 'unsupported';
      if (c === 'audio-codec' && fmt.audio.some((n) => /^HE-AAC/.test(n))) c = 'audio-he-aac';
      if (c === 'format' && fmt.audio.some((n) => /^HE-AAC/.test(n)) && fmt.video.every((n) => n === 'H.264') && fmt.container.every((n) => n === 'MP4')) c = 'audio-he-aac';
      L.e3 = { ok: false, code: c };
    }
    // E4
    const cp = inp.caps || {};
    if (!cp.known) L.e4 = { ok: true, code: 'unknown' };   // noch nicht abgefragt: kein Hindernis, nur offen
    else if (!cp.reachable) L.e4 = { ok: false, code: cp.error === 'unpaired' || cp.error === 'rejected' ? cp.error : 'unreachable' };
    else if (!cp.supported) L.e4 = { ok: false, code: 'no-downloads' };
    else if (!cp.dash) L.e4 = { ok: false, code: 'no-dash' };
    // E5 (nur Diagnose)
    const j = inp.job;
    if (j) {
      const r = /^[a-z0-9_-]{1,40}$/.test(j.reason || '') ? j.reason : '';
      L.e5 = j.state === 'done' ? { ok: true, code: 'done' } : j.state === 'rejected' ? { ok: false, code: 'plan-rejected' + (r ? '/' + r : '') }
        : j.state === 'failed' || j.state === 'error' || j.state === 'interrupted' ? { ok: false, code: 'failed' + (r ? '/' + r : '') }
          : { ok: true, code: j.state === 'planned' ? 'planned' : 'running' };
    }
    const first = !L.e1.ok ? 'E1' : !L.e2.ok ? 'E2' : !L.e3.ok ? 'E3' : !L.e4.ok ? 'E4' : '';
    const out = Object.assign(L, { first: first, code: first ? first + '/' + L[first.toLowerCase()].code : '', main: '', sub: '' });
    if (!first) return out;
    const fmtSub = () => {
      const p = [];
      if (fmt.video.length) p.push(t('Video') + ' ' + fmt.video.join('/'));
      if (fmt.audio.length) p.push(t('Ton') + ' ' + fmt.audio.join('/'));
      if (fmt.container.length) p.push(fmt.container.join('/'));
      return (p.length ? p.join(' · ') + ' – ' : '') + t('gespeichert wird bisher nur H.264 mit AAC-LC (MP4)');
    };
    const T = {
      'E1/unread': ['DASH vermutet – Manifest nicht lesbar', 'Manifest wurde nicht mitgelesen – Seite neu laden und das Video starten'],
      'E1/unread-invisible': ['DASH vermutet – Manifest nicht lesbar', 'Die Seite lädt den Stream verdeckt (Hintergrund-Thread oder eingebettetes Dokument) – kein sicherer Nachweis möglich'],
      'E1/invalid': ['DASH vermutet – Manifest nicht auswertbar', 'Inhalt ist kein gültiges, lesbares MPD'],
      'E1/gone': ['DASH-Stream erkannt – Manifest nicht mehr verfügbar', 'Video kurz abspielen und erneut tippen'],
      'E2/host': ['DASH-Stream erkannt – Zuordnung zum Video nicht nachgewiesen', 'Stücke kommen von einem anderen Server als im Manifest angegeben'],
      'E2/query': ['DASH-Stream erkannt – Zuordnung zum Video nicht nachgewiesen', 'Stück-Adressen tragen Zusatzparameter, die das Manifest nicht nennt'],
      'E2/number': ['DASH-Stream erkannt – Zuordnung zum Video nicht nachgewiesen', 'Geladene Stücke passen nicht zur Zeitleiste des Manifests'],
      'E2/invisible': ['DASH-Stream erkannt – Zuordnung zum Video nicht nachgewiesen', 'Ladevorgänge der Seite sind nicht sichtbar (Hintergrund-Thread) – kein sicherer Nachweis möglich'],
      'E2/none': ['DASH-Stream erkannt – Zuordnung zum Video nicht nachgewiesen', 'Noch keine Stücke dieses Manifests gesehen – Video einige Sekunden abspielen und erneut tippen'],
      'E2/few': ['DASH-Stream erkannt – Zuordnung zum Video nicht nachgewiesen', 'Erst wenige Stücke gesehen – Video einige Sekunden weiterlaufen lassen und erneut tippen'],
      'E2/stale': ['DASH-Stream erkannt – Zuordnung zum Video nicht nachgewiesen', 'Stücke zuletzt vor über 20 s geladen – Video kurz abspielen und erneut tippen'],
      'E2/multi-video': ['DASH-Stream erkannt – Zuordnung zum Video nicht nachgewiesen', 'Mehrere Videos spielen gleichzeitig – die anderen anhalten und erneut tippen'],
      'E2/competing': ['DASH-Stream erkannt – Zuordnung zum Video nicht nachgewiesen', 'Mehrere Streams passen (z. B. Werbung) – nach der Werbung erneut tippen'],
      'E2/duration': ['DASH-Stream erkannt – Zuordnung zum Video nicht nachgewiesen', 'Länge des Streams passt nicht zum Video'],
      'E2/uncheckable': ['DASH-Stream erkannt – Zuordnung hier nicht möglich', 'Stream-Form (Byte-Bereiche einer Datei) erlaubt keinen sicheren Nachweis'],
      'E2/changed': ['DASH-Stream erkannt – Quelle hat sich geändert', 'Erneut tippen'],
      'E2/epoch-late': ['DASH-Stream erkannt – Zuordnung zum Video nicht nachgewiesen', 'Kadri sieht dieses Video erst seit kurzem – einige Sekunden weiterlaufen lassen und erneut tippen'],
      'E2/start-unknown': ['DASH-Stream erkannt – Zuordnung zum Video nicht nachgewiesen', 'Ladebeginn der Stücke nicht feststellbar – kein sicherer Nachweis möglich'],
      'E2/baseurl-multiple': ['DASH-Stream erkannt – nicht speicherbar', 'Manifest nennt mehrere Server-Alternativen (BaseURL) – noch nicht unterstützt'],
      'E3/format': ['DASH-Stream zugeordnet – Format wird noch nicht gespeichert', null],
      'E3/audio-codec': ['DASH-Stream zugeordnet – Tonformat wird noch nicht gespeichert', null],
      'E3/audio-he-aac': ['DASH-Stream zugeordnet – Tonformat HE-AAC wird noch nicht gespeichert', 'Ton HE-AAC – gespeichert wird bisher nur AAC-LC'],
      'E3/live': ['DASH-Stream zugeordnet – nicht speicherbar', 'Live-Stream'],
      'E3/protected': ['DASH-Stream – nicht speicherbar', 'Geschützt (DRM)'],
      'E3/multiperiod': ['DASH-Stream zugeordnet – nicht speicherbar', 'Mehrere Abschnitte (Perioden) – noch nicht unterstützt'],
      'E3/duration-unknown': ['DASH-Stream zugeordnet – nicht speicherbar', 'Länge unbekannt'],
      'E3/duration-limit': ['DASH-Stream zugeordnet – nicht speicherbar', 'Zu lang (über 48 h)'],
      'E3/no-audio': ['DASH-Stream zugeordnet – nicht speicherbar', 'Ohne Ton (gespeichert wird nur mit Tonspur)'],
      'E3/no-video': ['DASH-Stream zugeordnet – nicht speicherbar', 'Kein Video'],
      'E3/addressing': ['DASH-Stream zugeordnet – Stream-Form wird noch nicht gespeichert', 'Adressierung der Stücke nicht unterstützt'],
      'E3/unsupported': ['DASH-Stream zugeordnet – Stream-Form wird noch nicht gespeichert', 'Aufbau des Manifests nicht unterstützt'],
      'E3/coverage': ['DASH-Stream zugeordnet – nicht speicherbar', null],
      'E3/timeline': ['DASH-Stream zugeordnet – nicht speicherbar', 'Manifest widersprüchlich: Zeitleiste der Stücke mit Lücken oder Überschneidungen'],
      'E3/limit': ['DASH-Stream zugeordnet – nicht speicherbar', 'Zu viele Stücke oder zu groß für einen Download'],
      'E3/baseurl-multiple': ['DASH-Stream zugeordnet – nicht speicherbar', 'Manifest nennt mehrere Server-Alternativen (BaseURL) – noch nicht unterstützt'],
      'E3/unchecked': ['DASH-Stream zugeordnet – Manifest nicht prüfbar', 'Aufbau nicht eindeutig (z. B. mehrere Server-Alternativen)'],
      'E3/n/a': ['DASH-Stream – nicht speicherbar', 'Geschützt (DRM)'],
      'E4/unpaired': ['DASH-Stream zugeordnet – Helfer-App nicht gekoppelt', 'In den Kadri-Einstellungen „Helfer koppeln“'],
      'E4/rejected': ['DASH-Stream zugeordnet – Helfer-App erkennt die Kopplung nicht mehr', 'Neu koppeln'],
      'E4/unreachable': ['DASH-Stream zugeordnet – Helfer-App nicht erreichbar', 'App öffnen und erneut tippen'],
      'E4/no-downloads': ['DASH-Stream zugeordnet – Helfer-App kann ihn nicht speichern', 'Diese Helfer-App-Version kann keine direkten Downloads'],
      'E4/no-dash': ['DASH-Stream zugeordnet – Helfer-App kann ihn nicht speichern', 'Diese Helfer-App-Version speichert kein DASH'],
    };
    const e = T[out.code] || T[first + '/' + 'unsupported'] || ['DASH-Stream – nicht speicherbar', ''];
    out.main = t(e[0]);
    // E3/coverage: konkret, welche Spur welche Länge beschreibt (aus dem MPD, src/039) – z. B. „Tonspur 24 s statt 20 s“
    const cov = inp.gate && inp.gate.coverage;
    out.sub = out.code === 'E3/coverage'
      ? t('Manifest widersprüchlich') + ': ' + (cov ? t(cov.track === 'audio' ? 'Tonspur' : 'Videospur') + ' ' + cov.described + ' s ' + t('statt') + ' ' + cov.period + ' s'
        : t('Länge der Spuren passt nicht zur Dauer'))
      : e[1] === null ? fmtSub() : t(e[1] || '');
    if (out.code === 'E3/audio-codec' && fmt.audio.length) out.sub = t('Ton') + ' ' + fmt.audio.join('/') + ' – ' + t('gespeichert wird bisher nur AAC-LC');
    return out;
  }
  // Kurzform für die anonyme Diagnose (nur feste Codes)
  const dashLevelsLine = (lv) => 'DASH-Ebenen: E1 ' + lv.e1.code + ' · E2 ' + lv.e2.code + ' · E3 ' + lv.e3.code + ' · E4 ' + lv.e4.code + ' · E5 ' + lv.e5.code +
    ' · erste blockierende Ebene ' + (lv.first || '-') + (lv.first ? ' (' + lv.code + ')' : '');
  // Eingaben für dashLevels aus dem laufenden Zustand – für Webseiten-Knopf (src/105), Player-Menü (src/180) und
  // Diagnose (src/280) dieselbe Funktion. snaps: Registry-Snapshots des Videos (Originalvideo, ggf. eigener Player);
  // caps: { known, reachable, supported, dash, error }; offer: Ergebnis von dashOfferFor (oder null). null = kein DASH.
  function dashLevelsFor(v, snaps, caps, offer) {
    const ents = [];
    (snaps || []).forEach((sn) => (sn || []).forEach((s) => { if (s && s.kind === 'dash' && (s.role === 'manifest' || s.role === 'unknown')) ents.push(s); }));
    if (!ents.length) return null;
    let b = { list: [], res: {} };
    try { if (v) b = dashBindingFor(v); } catch (e) {}
    // Kandidat: das gebundene MPD, sonst das mit den meisten Treffern bzw. der längsten Folge
    let cand = null, best = -1;
    b.list.forEach((e) => { const r = b.res[e.key] || {}; const sc = (r.state === 'bound' ? 1e9 : 0) + (r.hits || 0) * 1000 + (r.run || 0); if (sc > best) { best = sc; cand = e; } });
    const r = cand ? (b.res[cand.key] || {}) : {};
    const cls = { host: 0, query: 0, number: 0 };
    let media = 0;
    const from = v ? dashFromOf(v) : 0;
    try {
      recentRes.forEach((x) => {
        const st = resAt(x);
        if (st === null || st < from) return;   // (unbekannter Anfragebeginn: nicht der aktuellen Epoche zugerechnet)
        // (Medienabrufe der Seite: nur xhr/fetch/Medien-Element – „other“ sind u. a. Worker-Skripte, Beacons)
        if (/^(xmlhttprequest|fetch|video|audio)$/.test(x.it || '')) media++;
        if (cand && cand.p.dashIdx) { const k = dashDiagClassify(cand.p.dashIdx, x.k); if (k in cls) cls[k]++; }
      });
    } catch (e) {}
    let mse = false;
    try { mse = !!v && (!!v.srcObject || /^blob:/.test(v.currentSrc || '')); } catch (e) {}
    const fp = cand ? cand.p.dashFp : null, oc = offer && offer.code ? offer.code : '';
    let job = null;
    try { job = hdlDiags.find((d) => d.dash === true || d.type === 'dash') || null; } catch (e) {}
    const lv = dashLevels({
      read: b.list.length > 0, invalid: !b.list.length && Object.keys(dashRejected).length > 0, invisible: mse && media === 0,
      gone: oc === 'manifest-gone', changed: oc === 'source-changed',
      bound: mediaDashState(snaps) === 'bound', bindReason: r.reason || '', cls: cls,
      epochLate: (() => { try { const ep = v ? dashEpochOf(v) : null; return !!ep && (ep.by === 'beobachtet' || ep.by === 'quellwechsel') && Date.now() - ep.at < 30000; } catch (e) { return false; } })(),
      protectedSource: oc === 'protected' || ents.some((s) => s.protection === 'encrypted' || s.protection === 'drm'),
      gate: fp && !fp.error ? fp.gate : null, fpError: !fp || !!fp.error, fpCode: fp && fp.error ? String(fp.error) : '',
      fmt: (cand && cand.p.dashFmt) || { video: [], audio: [], container: [] },
      caps: caps || { known: false }, job: job }, typeof tr === 'function' ? tr : null);
    lv.offer = !!(offer && offer.offer);
    return lv;
  }
  // Fähigkeit der Helfer-App für dashLevels aus einer caps-Antwort ({ reachable, supported, dash, error }) bzw. null
  const dashCapsOf = (c) => (c ? { known: true, reachable: !!c.reachable, supported: !!c.supported, dash: !!(c.supported && c.dash), error: c.error || '' } : { known: false });
