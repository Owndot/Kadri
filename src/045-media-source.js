  // ---------- Gemeinsames Quellenmodell (Phase C3, P1) ----------
  // Ein Eintrag beschreibt EINE beobachtete Medienadresse für GENAU einen Player (Videoelement) in genau diesem Dokument.
  // Er hält fest, was über sie bekannt ist – und woher: Typ (mp4/hls/dash), Rolle (eigenständige Datei, Haupt-/Unterliste,
  // Stück, Init, Einzelspur), Qualität, Ton, Bild, Dauer, MIME jeweils als „unbekannt“ oder mit Status claimed (die Seite
  // behauptet es), observed (beim Laden gesehen) oder verified (unabhängig geprüft) samt Belegen. Unbekannt heißt
  // unbekannt – nie „vorhanden“, „unverschlüsselt“ oder „geprüft“. Angaben der Seite bleiben untrusted, auch wenn sie
  // plausibel sind. Nur reine Daten und Prüfungen hier; die Registry (065) verwaltet Einträge, Kontexte und Budgets.
  // Die genaue Adresse bleibt privat in der Registry (nie in Speicher, Protokoll oder Oberfläche).
  const MEDIA_LIMITS = Object.freeze({ perPlayer: 64, perDocument: 256, players: 16, urlLen: 4096, evidence: 8, provenance: 6, text: 200 });
  const MEDIA_KINDS = ['mp4', 'hls', 'dash', 'unsupported', 'unknown'];
  // manifest: DASH-MPD (beschreibt alle Darstellungen eines Videos; Gegenstück zur HLS-Hauptliste „master“)
  const MEDIA_ROLES = ['standalone', 'master', 'media-playlist', 'manifest', 'segment', 'init', 'track', 'unknown'];
  const MEDIA_KNOW = ['unknown', 'claimed', 'observed', 'verified'];
  const MEDIA_ASSOC = ['unbound', 'ambiguous', 'bound'];
  const MEDIA_PROTECTION = ['unknown', 'clear', 'encrypted', 'drm'];
  const MEDIA_PROVENANCE = ['element', 'network', 'page-metadata', 'manifest', 'adapter', 'player'];
  const MEDIA_BROWSER = ['unknown', 'loaded', 'failed'];
  const MEDIA_OBS_KEYS = ['url', 'kind', 'role', 'mime', 'quality', 'duration', 'audio', 'video', 'provenance', 'association', 'protection', 'browser', 'manifest'];
  const mediaIsObj = (x) => !!x && typeof x === 'object' && !Array.isArray(x) && Object.getPrototypeOf(x) === Object.prototype;
  const mediaOnlyKeys = (o, keys) => Object.keys(o).every((k) => keys.indexOf(k) >= 0);
  const mediaText = (s, max) => typeof s === 'string' && s.length > 0 && s.length <= (max || MEDIA_LIMITS.text) && !/[\u0000-\u001f]/.test(s);
  // Exakte Transportadresse: nur http(s), begrenzt, unverändert (Query-Reihenfolge, doppelte Parameter, %-Escapes)
  function mediaUrlOk(u) {
    if (typeof u !== 'string' || !u || u.length > MEDIA_LIMITS.urlLen || /[\u0000- \u007f]/.test(u)) return false;
    try { const x = new URL(u); return (x.protocol === 'http:' || x.protocol === 'https:') && !x.username && !x.password; } catch (e) { return false; }
  }
  // Typ aus Pfad bzw. MIME. Der PFAD zählt, nicht ein „.mp4“ irgendwo davor (…/720.mp4:hls:manifest.m3u8 ist HLS).
  function mediaKindOf(u, mime) {
    let p = '';
    try { p = new URL(u).pathname.toLowerCase(); } catch (e) { return 'unknown'; }
    const tag = /#kadri\.(m3u8|mpd)$/i.exec(u || '');
    const m = String(mime || '').toLowerCase().split(';')[0].trim();
    if (tag) return tag[1].toLowerCase() === 'mpd' ? 'dash' : 'hls';
    if (/\.m3u8?$/.test(p) || m === 'application/vnd.apple.mpegurl' || m === 'application/x-mpegurl' || m === 'audio/mpegurl') return 'hls';
    if (/\.mpd$/.test(p) || m === 'application/dash+xml') return 'dash';
    // (…/123.mp4/ mit Schrägstrich am Ende: übliche Form von Video-Seiten wie get_file – ebenfalls die MP4-Datei)
    if (/\.(mp4|m4v)\/?$/.test(p) || m === 'video/mp4') return 'mp4';
    if (/\.(webm|ogv|ogg|mkv|mov|avi|flv|ts|m4s|m4a|aac|mp3)$/.test(p) || /^(video|audio)\/(webm|ogg|x-matroska|quicktime|mp2t)$/.test(m)) return 'unsupported';
    return 'unknown';
  }
  // Die Adresse kann auch ohne .mpd-Endung oder mit irreführender Dateiendung ein gelesenes MPD sein.
  const mediaIsDashManifest = (u) => mediaKindOf(u, '') === 'dash' ||
    (typeof dashSummaryOf === 'function' && !!dashSummaryOf(u));
  // Medienwechsel am Element, einschließlich einer neuen src vor dem ersten Browserereignis.
  function mediaOutputContext(v, current) {
    const src = v.src, playing = v.currentSrc, object = v.srcObject;
    const ctx = mediaRegistry.contextFor(v);
    return () => {
      if ((current && !current()) || !v.isConnected || v.src !== src || v.srcObject !== object ||
          (playing && v.currentSrc !== playing)) return false;
      const now = mediaRegistry.contextFor(v);
      return now.documentKey === ctx.documentKey && now.playerId === ctx.playerId && now.mediaEpoch === ctx.mediaEpoch;
    };
  }
  // Behalte Ursprung, bekannte Ziele und jede Ablehnung für genau diese Auswahl.
  function mediaOutputFor(origin, current, v) {
    const page = location.href.split('#')[0];
    const selection = { keys: new Set(), blocked: false };
    if (typeof watchDashOutput === 'function') watchDashOutput(selection);
    const allowed = (target = origin) => {
      if (!origin || !target || selection.blocked || location.href.split('#')[0] !== page || (current && !current())) return false;
      selection.keys.add(dashUrlKey(target));
      const ctx = v && mediaRegistry.contextFor(v);
      selection.blocked = ctx ? !mediaRegistry.playbackAllowed(ctx, origin) || !mediaRegistry.playbackAllowed(ctx, target)
        : mediaIsDashManifest(origin) || mediaIsDashManifest(target);
      return !selection.blocked;
    };
    allowed();
    return allowed;
  }
  // Knowledge<T>: { status:'unknown' } | { status, value, evidenceIds }. check(value) prüft den Wert.
  function mediaKnowledge(k, check) {
    if (k === undefined) return { status: 'unknown' };
    if (!mediaIsObj(k) || MEDIA_KNOW.indexOf(k.status) < 0) return null;
    if (k.status === 'unknown') return mediaOnlyKeys(k, ['status']) ? { status: 'unknown' } : null;
    if (!mediaOnlyKeys(k, ['status', 'value', 'evidenceIds']) || !check(k.value)) return null;
    const ev = k.evidenceIds === undefined ? [] : k.evidenceIds;
    if (!Array.isArray(ev) || ev.length > MEDIA_LIMITS.evidence || !ev.every((x) => mediaText(x, 64))) return null;
    return { status: k.status, value: mediaIsObj(k.value) ? Object.assign({}, k.value) : k.value, evidenceIds: ev.slice() };
  }
  const mediaNum = (lo, hi) => (x) => typeof x === 'number' && isFinite(x) && x >= lo && x <= hi;
  const mediaQualityOk = (q) => mediaIsObj(q) && mediaOnlyKeys(q, ['height', 'width', 'bitrate']) && Object.keys(q).length > 0 &&
    (q.height === undefined || (Number.isInteger(q.height) && q.height > 0 && q.height <= 8640)) &&
    (q.width === undefined || (Number.isInteger(q.width) && q.width > 0 && q.width <= 15360)) &&
    (q.bitrate === undefined || mediaNum(1, 1e9)(q.bitrate));
  const mediaTrackOk = (t) => mediaIsObj(t) && mediaOnlyKeys(t, ['present', 'codec', 'language']) && typeof t.present === 'boolean' &&
    (t.codec === undefined || mediaText(t.codec, 64)) && (t.language === undefined || mediaText(t.language, 35));
  // ---------- Zusammenfassung eines DASH-Manifests (aus src/038, hier unabhängig und streng geprüft) ----------
  // Nur technische Kategorien und Zahlen – keine Adresse, kein Pfad, keine Kennung (Darstellungs-IDs, KIDs, BaseURL fehlen
  // absichtlich). Offen für weitere Codecs/Container/Adressierungen: neue Werte kommen in diese Listen, das Format (v)
  // bleibt. protection.signaled=false heißt nur „im MPD nicht angegeben“ – nie „unverschlüsselt“.
  const MEDIA_DASH = Object.freeze({
    types: ['static', 'dynamic', 'unknown'],
    errors: ['', 'doctype', 'too-large', 'parse', 'not-mpd', 'limits'],
    kinds: ['video', 'audio', 'text', 'image', 'other'],
    containers: ['mp4', 'webm', 'mp2t', 'text', 'image', 'other', 'unknown'],
    codecs: ['avc', 'hevc', 'vvc', 'vp8', 'vp9', 'av1', 'aac', 'mp3', 'ac3', 'ec3', 'ac4', 'opus', 'vorbis', 'flac', 'dts',
      'ttml', 'webvtt', 'other', 'unknown'],
    addressing: ['template-timeline', 'template-duration', 'template-other', 'list', 'base', 'single-file', 'unknown'],
    systems: ['cenc', 'cbcs', 'widevine', 'playready', 'clearkey', 'fairplay', 'marlin', 'other'],
    tracks: 64, list: 8,
  });
  const mediaInt = (lo, hi) => (x) => Number.isInteger(x) && x >= lo && x <= hi;
  const mediaSubset = (a, all, max) => Array.isArray(a) && a.length <= max && a.every((x) => all.indexOf(x) >= 0) && new Set(a).size === a.length;
  function mediaDashTrackOk(t) {
    const D = MEDIA_DASH;
    return mediaIsObj(t) && mediaOnlyKeys(t, ['kind', 'container', 'codecs', 'width', 'height', 'bandwidth', 'lang', 'addressing', 'protected']) &&
      D.kinds.indexOf(t.kind) >= 0 && D.containers.indexOf(t.container) >= 0 && mediaSubset(t.codecs, D.codecs, 4) &&
      (t.width === null || mediaInt(1, 15360)(t.width)) && (t.height === null || mediaInt(1, 8640)(t.height)) &&
      (t.bandwidth === null || mediaInt(1, 1e9)(t.bandwidth)) && (t.lang === '' || (typeof t.lang === 'string' && /^[a-z]{2,3}(-[a-z0-9]{1,8}){0,2}$/.test(t.lang))) &&
      D.addressing.indexOf(t.addressing) >= 0 && typeof t.protected === 'boolean';
  }
  function mediaManifestOk(m) {
    const D = MEDIA_DASH;
    if (!mediaIsObj(m) || !mediaOnlyKeys(m, ['format', 'v', 'error', 'type', 'periods', 'adaptationSets', 'representations', 'duration',
      'addressing', 'protection', 'tracks'])) return false;
    if (m.format !== 'dash' || m.v !== 1 || D.errors.indexOf(m.error) < 0 || D.types.indexOf(m.type) < 0) return false;
    if (!mediaInt(0, 64)(m.periods) || !mediaInt(0, 4096)(m.adaptationSets) || !mediaInt(0, 4096)(m.representations)) return false;
    if (m.duration !== null && !mediaNum(0, 1e7)(m.duration)) return false;
    if (!mediaSubset(m.addressing, D.addressing, D.list)) return false;
    const p = m.protection;
    if (!mediaIsObj(p) || !mediaOnlyKeys(p, ['signaled', 'systems', 'defaultKid']) || typeof p.signaled !== 'boolean' ||
        !mediaSubset(p.systems, D.systems, D.list) || typeof p.defaultKid !== 'boolean' || (!p.signaled && (p.systems.length || p.defaultKid))) return false;
    if (!Array.isArray(m.tracks) || m.tracks.length > D.tracks || m.tracks.length > m.representations || !m.tracks.every(mediaDashTrackOk)) return false;
    if (m.error && (m.tracks.length || m.periods || p.signaled)) return false;   // nicht auswertbar: keine Angaben behaupten
    return true;
  }
  // Strenge Prüfung einer Beobachtung. Unbekannte Felder, überlange oder fremde Adressen, falsche Zahlen → abgelehnt.
  function mediaValidObservation(o) {
    const no = (reason) => ({ ok: false, reason: reason });
    if (!mediaIsObj(o)) return no('shape');
    if (!mediaOnlyKeys(o, MEDIA_OBS_KEYS)) return no('unknown-field');
    if (!mediaUrlOk(o.url)) return no('url');
    if (o.kind !== undefined && MEDIA_KINDS.indexOf(o.kind) < 0) return no('kind');
    if (o.role !== undefined && MEDIA_ROLES.indexOf(o.role) < 0) return no('role');
    if (o.protection !== undefined && MEDIA_PROTECTION.indexOf(o.protection) < 0) return no('protection');
    if (o.browser !== undefined && MEDIA_BROWSER.indexOf(o.browser) < 0) return no('browser');
    // Manifest-Zusammenfassung nur für DASH-Manifeste (Rolle manifest), streng geprüft
    if (o.manifest !== undefined && (!mediaManifestOk(o.manifest) || o.role !== 'manifest' ||
        (o.kind !== undefined ? o.kind : mediaKindOf(o.url, '')) !== 'dash')) return no('manifest');
    const pv = o.provenance;
    if (!mediaIsObj(pv) || !mediaOnlyKeys(pv, ['kind', 'origin']) || MEDIA_PROVENANCE.indexOf(pv.kind) < 0 || !mediaText(pv.origin, 64)) return no('provenance');
    const as = o.association;
    if (!mediaIsObj(as) || !mediaOnlyKeys(as, ['state', 'evidence']) || MEDIA_ASSOC.indexOf(as.state) < 0 ||
        !Array.isArray(as.evidence) || as.evidence.length > MEDIA_LIMITS.evidence || !as.evidence.every((x) => mediaText(x, 64))) return no('association');
    if (as.state === 'bound' && !as.evidence.length) return no('bound-without-evidence');   // Bindung nur mit Beleg
    const mime = mediaKnowledge(o.mime, (x) => mediaText(x, 100) && /^[a-z0-9.+-]+\/[a-z0-9.+-]+$/i.test(x));
    const quality = mediaKnowledge(o.quality, mediaQualityOk);
    const duration = mediaKnowledge(o.duration, mediaNum(0, 1e7));
    const audio = mediaKnowledge(o.audio, mediaTrackOk);
    const video = mediaKnowledge(o.video, mediaTrackOk);
    if (!mime || !quality || !duration || !audio || !video) return no('knowledge');
    // „verified“ nur aus unabhängiger Prüfung – nie aus Angaben der Seite (Seitendaten, Element, Adapter)
    if ([quality, duration, audio, video, mime].some((k) => k.status === 'verified') && pv.kind !== 'player') return no('unverifiable-claim');
    return { ok: true, value: {
      url: o.url, kind: o.kind || mediaKindOf(o.url, mime.status !== 'unknown' ? mime.value : ''), role: o.role || 'unknown',
      mime: mime, quality: quality, duration: duration, audio: audio, video: video,
      provenance: { kind: pv.kind, origin: pv.origin }, association: { state: as.state, evidence: as.evidence.slice() },
      protection: o.protection || 'unknown', browser: o.browser || 'unknown',
      manifest: o.manifest === undefined ? null : JSON.parse(JSON.stringify(o.manifest)),
    } };
  }
  // Downloadstatus einer Quelle (nur Beurteilung – startet nichts). attemptable = nach bekannten Kriterien bewusst
  // auswählbar; der Helfer prüft beim Abruf selbst (Netzgrenzen, Status, Länge, Typ, Signatur). Kein Erfolgsversprechen.
  // Vom Kadri-Player selbst nachweislich abgespielte Datei (Herkunft player, Beleg own-player-loaded, Bilddaten geladen):
  // ihr Typ ist oft nicht an der Adresse erkennbar (ohne Endung). Dann trotzdem auswählbar – die Helfer-App prüft
  // Content-Type und MP4-Signatur selbst und lehnt anderes ab. Nie für Angaben der Seite, Adapter oder Netzbeobachtungen.
  const mediaOwnPlayed = (s) => s.kind === 'unknown' && s.browser === 'loaded' && s.association.state === 'bound' &&
    s.association.evidence.indexOf('own-player-loaded') >= 0 && s.provenance.some((p) => p.kind === 'player');
  function mediaDownloadState(s) {
    if (s.kind === 'hls' || s.kind === 'dash' || s.role === 'master' || s.role === 'media-playlist' || s.role === 'manifest') return { state: 'unavailable', reason: 'stream-not-supported' };
    if (s.kind === 'unsupported') return { state: 'unavailable', reason: 'container-not-supported' };
    if (s.role === 'segment' || s.role === 'init' || s.role === 'track') return { state: 'unavailable', reason: 'not-standalone' };
    if (s.protection === 'encrypted' || s.protection === 'drm') return { state: 'unavailable', reason: 'protected' };
    if (s.kind !== 'mp4' && !mediaOwnPlayed(s)) return { state: 'candidate', reason: 'type-unknown' };
    if (s.association.state !== 'bound') return { state: 'candidate', reason: s.association.state === 'ambiguous' ? 'ambiguous' : 'not-bound' };
    if (s.browser === 'failed') return { state: 'candidate', reason: 'browser-failed' };
    return { state: 'attemptable', reason: null };
  }
  // Auswahl für das Download-Menü: nur MP4-Einträge; tatsächlich geladene zuerst, danach beste bekannte Höhe. caps: { supported, active }.
  // Reine Funktion über einem Snapshot – kein Netzabruf, keine Medien-Probe.
  // identity trennt belegte Gleichheit von bloßer Zuordnung (Gerätetest R2: eine am Element genannte MP4 hatte 12 s, der
  // laufende Stream 60 s): 'played' = genau diese Datei hat der Browser in diesem Player geladen und Bilder daraus gezeigt
  // (browser: loaded) – sie IST das gesehene Video; 'declared' = die Seite ordnet sie dem Video zu (<source>, src,
  // Seitendaten, Adapter), Inhalt und Länge sind nicht geprüft. Kein Abruf, um das zu klären.
  // loaded: der Browser hat genau diese Quelle tatsächlich geladen (MP4: browser loaded; HLS zusätzlich: Stücke genau
  // dieses Streams geladen, "segments-loaded"). Tatsächlich Geladenes steht vor bloß behaupteten Varianten (Adapter,
  // Seitendaten) – auch vor einer höheren, nur behaupteten Qualität (Samsung-Test: behauptete 1080p-MP4 → HTTP 404).
  const mediaSourceLoaded = (s) => s.browser === 'loaded' ||
    (s.kind === 'hls' && s.association.state === 'bound' && s.association.evidence.indexOf('segments-loaded') >= 0);
  function selectDownloads(snapshot, caps) {
    const out = [];
    (snapshot || []).forEach((s, i) => {
      if (s.kind !== 'mp4' && !mediaOwnPlayed(s)) return;
      let d = mediaDownloadState(s);
      if (d.state === 'attemptable' && !(caps && caps.supported)) d = { state: 'unavailable', reason: 'helper-unavailable' };
      if (d.state === 'attemptable' && caps && caps.active === s.sourceId) d = { state: 'active', reason: null };
      const h = s.quality.status !== 'unknown' && s.quality.value.height ? s.quality.value.height : 0;
      out.push({ sourceId: s.sourceId, revision: s.revision, state: d.state, reason: d.reason, height: h, quality: s.quality.status,
        identity: s.browser === 'loaded' ? 'played' : 'declared', loaded: mediaSourceLoaded(s), typeChecked: s.kind === 'mp4', i: i });
    });
    out.sort((a, b) => (Number(b.loaded) - Number(a.loaded)) || (b.height - a.height) || (a.i - b.i));
    out.forEach((x) => { delete x.i; });
    return out;
  }
  // ---------- P4b: HLS-Streams über die Helfer-App ----------
  // Speicherbar (Versuch) ist eine HLS-Liste (Haupt- oder Medienliste), die an genau dieses Video gebunden und nicht als
  // verschlüsselt bekannt ist. Ob sie wirklich ein unterstütztes VOD-Profil ist (H.264/AAC, TS/fMP4, ohne AES/DRM, nicht
  // live), prüft erst der Helfer streng beim Plan (hlsplan) – hier kein Abruf. DASH hat eine eigene, strengere Auswahl
  // (selectDashStreams) – über diesen HLS-Weg nie.
  function mediaStreamState(s) {
    if (s.kind === 'dash') return { state: 'unavailable', reason: 'dash-not-supported' };
    if (s.kind !== 'hls') return { state: 'unavailable', reason: 'not-a-stream' };
    if (s.role !== 'master' && s.role !== 'media-playlist' && s.role !== 'unknown') return { state: 'unavailable', reason: 'not-standalone' };
    if (['encrypted', 'drm'].indexOf(s.protection) >= 0) return { state: 'unavailable', reason: 'protected' };
    if (s.association.state === 'bound') return { state: 'attemptable', reason: null };
    return { state: 'candidate', reason: s.association.state === 'ambiguous' ? 'ambiguous' : 'not-bound' };
  }
  // P0-A: Netzbeobachtung liefert Kandidaten, aber keinen Nachweis am Videoelement.
  // Auch alte Registry-Einträge mit "bound" bleiben ohne DASH-Freigabe.
  function mediaDashState(snapshots) {
    const candidate = (snapshots || []).some((snap) => (snap || []).some((s) =>
      s && s.kind === 'dash' && (s.role === 'manifest' || s.role === 'unknown') &&
      s.association && (s.association.state === 'bound' || s.association.state === 'ambiguous')));
    return candidate ? 'suspected' : '';
  }
  function mediaDashStreamState(s) {
    if (!s || s.kind !== 'dash') return { state: 'unavailable', reason: 'not-dash' };
    if (s.role !== 'manifest' && s.role !== 'unknown') return { state: 'unavailable', reason: 'not-standalone' };
    if (['encrypted', 'drm'].indexOf(s.protection) >= 0) return { state: 'unavailable', reason: 'protected' };
    return { state: 'candidate', reason: s.association.state === 'unbound' ? 'not-bound' : 'ambiguous' };
  }
  function selectDashStreams(snapshot) {
    return (snapshot || []).filter((s) => s && s.kind === 'dash').map((s) => {
      const d = mediaDashStreamState(s);
      return { sourceId: s.sourceId, revision: s.revision, state: d.state, reason: d.reason, role: s.role, loaded: false };
    });
  }
  // Auswahl „Stream speichern …“: gebundene Haupt-/Medienlisten; tatsächlich geladene zuerst, Hauptliste vor Medienliste.
  function selectStreams(snapshot, caps) {
    const out = [];
    (snapshot || []).forEach((s, i) => {
      if (s.kind !== 'hls') return;
      let d = mediaStreamState(s);
      if (d.state === 'attemptable' && !(caps && caps.hls)) d = { state: 'unavailable', reason: 'helper-unavailable' };
      out.push({ sourceId: s.sourceId, revision: s.revision, state: d.state, reason: d.reason, role: s.role,
        identity: s.browser === 'loaded' ? 'played' : 'declared', loaded: mediaSourceLoaded(s), i: i });
    });
    const rank = (x) => (x.loaded ? 0 : 2) + (x.role === 'master' ? 0 : 1);
    out.sort((a, b) => (rank(a) - rank(b)) || (a.i - b.i));
    out.forEach((x) => { delete x.i; });
    return out;
  }

