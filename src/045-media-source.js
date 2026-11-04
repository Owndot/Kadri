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
  const MEDIA_ROLES = ['standalone', 'master', 'media-playlist', 'segment', 'init', 'track', 'unknown'];
  const MEDIA_KNOW = ['unknown', 'claimed', 'observed', 'verified'];
  const MEDIA_ASSOC = ['unbound', 'ambiguous', 'bound'];
  const MEDIA_PROTECTION = ['unknown', 'clear', 'encrypted', 'drm'];
  const MEDIA_PROVENANCE = ['element', 'network', 'page-metadata', 'manifest', 'adapter', 'player'];
  const MEDIA_BROWSER = ['unknown', 'loaded', 'failed'];
  const MEDIA_OBS_KEYS = ['url', 'kind', 'role', 'mime', 'quality', 'duration', 'audio', 'video', 'provenance', 'association', 'protection', 'browser'];
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
    if (/\.(mp4|m4v)$/.test(p) || m === 'video/mp4') return 'mp4';
    if (/\.(webm|ogv|ogg|mkv|mov|avi|flv|ts|m4s|m4a|aac|mp3)$/.test(p) || /^(video|audio)\/(webm|ogg|x-matroska|quicktime|mp2t)$/.test(m)) return 'unsupported';
    return 'unknown';
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
    } };
  }
  // Downloadstatus einer Quelle (nur Beurteilung – startet nichts). attemptable = nach bekannten Kriterien bewusst
  // auswählbar; der Helfer prüft beim Abruf selbst (Netzgrenzen, Status, Länge, Typ, Signatur). Kein Erfolgsversprechen.
  function mediaDownloadState(s) {
    if (s.kind === 'hls' || s.kind === 'dash' || s.role === 'master' || s.role === 'media-playlist') return { state: 'unavailable', reason: 'stream-not-supported' };
    if (s.kind === 'unsupported') return { state: 'unavailable', reason: 'container-not-supported' };
    if (s.role === 'segment' || s.role === 'init' || s.role === 'track') return { state: 'unavailable', reason: 'not-standalone' };
    if (s.protection === 'encrypted' || s.protection === 'drm') return { state: 'unavailable', reason: 'protected' };
    if (s.kind !== 'mp4') return { state: 'candidate', reason: 'type-unknown' };
    if (s.association.state !== 'bound') return { state: 'candidate', reason: s.association.state === 'ambiguous' ? 'ambiguous' : 'not-bound' };
    if (s.browser === 'failed') return { state: 'candidate', reason: 'browser-failed' };
    return { state: 'attemptable', reason: null };
  }
  // Auswahl für das Download-Menü: nur MP4-Einträge, beste bekannte Höhe zuerst. caps: { supported, active }.
  // Reine Funktion über einem Snapshot – kein Netzabruf, keine Medien-Probe.
  function selectDownloads(snapshot, caps) {
    const out = [];
    (snapshot || []).forEach((s, i) => {
      if (s.kind !== 'mp4') return;
      let d = mediaDownloadState(s);
      if (d.state === 'attemptable' && !(caps && caps.supported)) d = { state: 'unavailable', reason: 'helper-unavailable' };
      if (d.state === 'attemptable' && caps && caps.active === s.sourceId) d = { state: 'active', reason: null };
      const h = s.quality.status !== 'unknown' && s.quality.value.height ? s.quality.value.height : 0;
      out.push({ sourceId: s.sourceId, revision: s.revision, state: d.state, reason: d.reason, height: h, quality: s.quality.status, i: i });
    });
    out.sort((a, b) => (b.height - a.height) || (a.i - b.i));
    out.forEach((x) => { delete x.i; });
    return out;
  }
