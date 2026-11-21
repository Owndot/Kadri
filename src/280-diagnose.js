  // ---------- Diagnose auch ohne Button: über das Violentmonkey-Menü ----------
  function biggestVideo() {
    let best = null, area = 0;
    allVideos().forEach((v) => { const a = visibleArea(v); if (a > area) { area = a; best = v; } });
    return best || allVideos()[0] || null;
  }
  function videoReport() {
    const vids = allVideos();
    const lines = ['Rahmen: ' + (window.top === window ? 'Hauptseite' : 'eingebettet (iframe) auf ' + location.hostname),
      'Alle Videos (' + vids.length + ', davon im Shadow-DOM: ' + shadowVids.length + '):'];
    vids.slice(0, 8).forEach((v, i) => {
      const r = v.getBoundingClientRect();
      lines.push(' ' + (i + 1) + '. ' + Math.round(r.width) + '×' + Math.round(r.height) +
        ' | ' + (v.paused ? 'pausiert' : 'läuft') + ' | sichtbar ' + Math.round(visibleArea(v)) +
        ' | ' + String(v.currentSrc || v.src || '-').slice(0, 60));
    });
    const fr = document.getElementsByTagName('iframe');
    lines.push('Eingebettete Fenster (iframes): ' + fr.length + (fr.length ? ' – ' + Array.prototype.slice.call(fr, 0, 4).map((f) => hostOf(f.src) || '-').join(', ') : ''));
    lines.push('Download-Button hier: ' + (SHOW_DOWNLOAD ? 'ja' : 'nein') + ' | nur Download: ' + (DOWNLOAD_ONLY ? 'ja' : 'nein'));
    try {
      lines.push('Oberfläche: ' + (!hostEl ? 'nicht erstellt' :
        (hostEl.isConnected ? 'eingesetzt in ' + (hostEl.parentNode && hostEl.parentNode.nodeName) : 'von der Seite entfernt') +
        ' | display=' + getComputedStyle(hostEl).display + ' | visibility=' + getComputedStyle(hostEl).visibility +
        ' | Button: ' + (pill ? pill.className + ' @ ' + pill.style.left + ',' + pill.style.top + ' | Breite ' + pill.offsetWidth : '-') +
        ' | Bereich: ' + (typeof GM_info !== 'undefined' && GM_info && GM_info.injectInto ? GM_info.injectInto : '?')));
    } catch (e) {}
    return maskUrls(lines.join('\n'));
  }
  // Datenschutz: Adressen in der Diagnose ohne die Werte nach „?“ und „#“ (dort stehen oft Zugangsschlüssel,
  // Sitzungs- oder Nutzerkennungen). Die Namen der Angaben bleiben sichtbar – für die Fehlersuche reicht das.
  // Dazu lange, zufällig aussehende Teile im Pfad (Zugangsschlüssel stehen auch dort: /token/9fA3…/video.m3u8):
  // ab 24 Zeichen mit Ziffern UND Buchstaben → die ersten 4 Zeichen und „…“.
  function maskUrls(text) {
    return String(text).replace(/([?&#;][A-Za-z0-9_.\-\[\]%]{1,40}=)[^&#\s|…'")]+/g, '$1…').replace(/(#)[A-Za-z0-9_\-]{16,}/g, '$1…')
      .replace(/[A-Za-z0-9_\-~.%+=]{24,}/g, (s) => (/[0-9]/.test(s) && /[A-Za-z]/.test(s) && !/^[a-z]+(\.[a-z]+)+$/i.test(s) ? s.slice(0, 4) + '…' : s));
  }
  // Ende einer Adresse für die Diagnose: ERST bereinigen, dann kürzen (sonst bliebe vom „?token=…“ nur der Wert übrig)
  const urlTail = (u, n) => '…' + maskUrls(String(u || '').split('#')[0]).slice(-n);
  // ---------- Anonymisierte Diagnose (zum Weitergeben) ----------
  // Aus festen technischen Feldern neu zusammengesetzt – NICHT aus der Diagnose oben gefiltert. Keine Hostnamen,
  // Seitenadressen, Pfade, Abfragen, Video-Kennungen, Seitentitel oder Dateinamen. Danach entfernt ein Sicherheitsfilter
  // zusätzlich alles, was wie eine Adresse, Domain oder lange Kennung aussieht.
  const anonKind = (u) => (/^blob:/i.test(u) ? 'blob' : /\.m3u8(\?|#|$)/i.test(u) ? 'hls' : /\.mpd(\?|#|$)/i.test(u) ? 'dash' : /\.(mp4|m4v)(\?|#|$)/i.test(u) ? 'mp4' :
    /\.(m4s|ts|cmfv|cmfa|m4a|aac)(\?|#|$)/i.test(u) ? 'segment-datei' : /^https?:/i.test(u) ? 'sonstige' : '-');
  function anonScrub(t) {
    // Nur diese vollständigen festen Codes des gepinnten Helpers sind öffentliche Protokollbegriffe.
    // Einige sind ≥ 20 Zeichen lang und wurden bisher wie private Kennungen entfernt. Keine allgemeine
    // Ausnahme für „blocked_*“, Unterstriche oder längere Fehlertexte: unbekannte Werte bleiben verborgen.
    const publicCodes = new Set(['no_supported_variant', 'av_duration_mismatch', 'attributes_duplicate', 'stream_inf_without_uri',
      'blocked_automatic_retry', 'blocked_bad_argument', 'blocked_body_too_large', 'blocked_credential_header',
      'blocked_credentials_in_url', 'blocked_headers_too_large', 'blocked_redirect_target',
      'blocked_redirect_without_location', 'blocked_too_many_redirects',
      // feste Gründe der Quellenauswahl (src/045) – sonst verschwände genau der Grund, warum nichts angeboten wird
      'stream-not-supported', 'container-not-supported']);
    return String(t).replace(/[a-z][a-z0-9+.-]*:\/\/\S*/gi, '[entfernt]')
      .replace(/\b(?:[a-z0-9_-]+\.)+[a-z][a-z0-9-]{1,}\b/gi, (m) => (/^\d+(\.\d+)+$/.test(m) ? m : '[entfernt]'))
      .replace(/[A-Za-z0-9_~%+=-]{20,}/g, (m) => publicCodes.has(m) ? m : '[entfernt]');
  }
  // ---------- Fenster und Quellen des Videos (anonym) ----------
  // Für Videos in eingebetteten Fenstern: läuft Kadri dort, sieht der Mitleser in der Seite (page.js) Listen, was spielt
  // das Element (Blob/MSE, HLS, MP4 …), was lädt die Seite (nur Art und Endung, nie Adresse/Host/Pfad), welche Quellen
  // kennt die Registry für GENAU dieses Video und warum bietet die Auswahl sie an oder nicht. Nur Arten und Zählungen.
  const anonExt = (u) => {
    let p = '';
    try { p = new URL(u, location.href).pathname.toLowerCase(); } catch (e) { return '-'; }
    const m = /\.([a-z0-9]{1,5})$/.exec(p), x = m ? m[1] : '';
    return !x ? 'ohne-endung' : /^(m3u8|mpd)$/.test(x) ? 'liste' : /^(ts|m4s|m4v|m4a|aac|cmfv|cmfa)$/.test(x) ? 'stueck' : x === 'mp4' ? 'mp4' :
      /^(jpe?g|png|gif|webp|ico|bmp|svg)$/.test(x) ? 'bild' : /^(txt|json|js|html?|php|css|xml)$/.test(x) ? 'text' : 'andere';
  };
  const anonCount = (o) => Object.keys(o).sort().map((k) => k + ' ×' + o[k]).join(', ') || '-';
  const anonPick = (list) => { const c = {}; (list || []).forEach((x) => { const k = x.state + (x.reason ? '(' + x.reason + ')' : ''); c[k] = (c[k] || 0) + 1; }); return anonCount(c); };
  // DASH-Manifest eines Eintrags: nur Kategorien und Zählungen (keine Kennungen, keine Adressen, keine Sprachcodes)
  function anonDashLine(m) {
    if (m.error) return '    DASH-Manifest: nicht auswertbar (' + m.error + ')';
    const by = (k) => m.tracks.filter((t) => t.kind === k);
    const fam = (ts) => { const c = {}; ts.forEach((t) => t.codecs.forEach((x) => { c[x] = (c[x] || 0) + 1; })); return anonCount(c); };
    const cont = (ts) => Array.from(new Set(ts.map((t) => t.container))).join('/') || '-';
    const v = by('video'), a = by('audio');
    const maxH = v.reduce((h, t) => Math.max(h, t.height || 0), 0);
    const langs = new Set(a.map((t) => t.lang).filter(Boolean)).size;
    return '    DASH-Manifest: ' + (m.type === 'static' ? 'VOD' : m.type === 'dynamic' ? 'Live' : '?') + ' · Perioden ' + m.periods +
      ' · AdaptationSets ' + m.adaptationSets + ' · Darstellungen ' + m.representations +
      ' · Video ' + v.length + (v.length ? ' (' + fam(v) + '; ' + cont(v) + (maxH ? '; bis ' + maxH + 'p' : '') + ')' : '') +
      ' · Audio ' + a.length + (a.length ? ' (' + fam(a) + '; ' + cont(a) + '; Sprachen ' + langs + ')' : '') +
      ' · Text ' + by('text').length + ' · Bild ' + by('image').length + ' · Adressierung ' + (m.addressing.join(',') || '-') +
      ' · Schutz angegeben: ' + (m.protection.signaled ? 'ja (' + (m.protection.systems.join(',') || '?') + (m.protection.defaultKid ? ', KID' : '') + ')'
        : 'nein (Verschlüsselung damit nicht ausgeschlossen)');
  }
  function anonSnapLines(L, snap) {
    snap.slice(0, 24).forEach((s, i) => {
      const q = s.quality && s.quality.status !== 'unknown' && s.quality.value && s.quality.value.height ? s.quality.value.height + 'p (' + s.quality.status + ')' : 'Höhe ?';
      L.push(' ' + (i + 1) + '. ' + s.kind + ':' + s.role + ' · Bindung ' + (s.association ? s.association.state + '(' + s.association.evidence.join(',') + ')' : '?') +
        ' · ' + q + ' · Browser ' + (s.browser || '?') + ' · Herkunft ' + (s.provenance || []).map((x) => x.kind + ':' + x.origin).join('+') +
        ' · Download ' + (s.download ? s.download.state + (s.download.reason ? '(' + s.download.reason + ')' : '') : '?'));
      if (s.manifest) L.push(anonDashLine(s.manifest));
    });
  }
  function diagFrameSources(L) {
    let depth = 0;
    try { for (let w = window; w !== w.parent && depth < 9; w = w.parent) depth++; } catch (e) {}
    let pong = false;
    try { const f = () => { pong = true; }; document.addEventListener('kadri-pong', f); document.dispatchEvent(new Event('kadri-ping')); document.removeEventListener('kadri-pong', f); } catch (e) {}
    L.push('Fenster-Ebene ' + depth + (IN_FRAME ? ' (Kadri hier nachgeladen)' : '') + ' · Mitleser in der Seite ' + (pong ? 'aktiv' : 'fehlt') +
      ' · gemeldete Listen ' + netSeen.pl + ' · per Typ erkannt ' + netSeen.src +
      (IN_FRAME && fui.n ? ' · Knopf/Auswahl ' + (fui.local ? 'hier (Rückfall)' : fui.mode === 'remote' ? 'im Hauptfenster' : fui.mode === 'busy' ? 'nicht nötig' : 'hier') : '') +
      (!IN_FRAME && fuiTop.regs.size ? ' · Video in eingebettetem Fenster: ' + fuiTop.regs.size + ' – dessen Diagnose: lange auf ▶ drücken' : ''));
    const v = active || biggestVideo();
    if (v) {
      let cs = '';
      try { cs = v.currentSrc || ''; } catch (e) {}
      let buf = 0;
      try { for (let i = 0; i < v.buffered.length; i++) buf += v.buffered.end(i) - v.buffered.start(i); } catch (e) {}
      L.push('Video-Element: Quelle ' + (v.srcObject ? 'srcObject' : cs ? anonKind(cs) : 'keine') + ' · ' + (v.paused ? 'pausiert' : 'läuft') +
        ' · Bereitschaft ' + v.readyState + (v.error ? ' · Fehler ' + v.error.code : '') + ' · Auflösung ' + Math.min(v.videoWidth || 0, v.videoHeight || 0) + 'p' +
        ' · gepuffert ' + Math.round(buf) + ' s · DRM ' + (v.mediaKeys ? 'ja' : 'nein') + (shadowVids.indexOf(v) >= 0 ? ' · im Shadow-DOM' : '') +
        (v.ownerDocument !== document ? ' · in leerem Unterfenster' : ''));
      // dieselbe Auswertung wie beim Tipp auf ⬇ (ohne Abruf; Fähigkeiten der Helfer-App hier angenommen)
      const caps = { supported: true, hls: true };
      let o = null;
      try { o = pageDlOptions(v, caps); } catch (e) {}
      let snap = [];
      try { const c = mediaRegistry.contextFor(v); if (c) snap = mediaRegistry.snapshot(c); } catch (e) {}
      L.push('Quellen am Video (' + snap.length + '):');
      anonSnapLines(L, snap);
      if (o) L.push('Auswahl MP4: ' + anonPick(o.all) + ' · Auswahl Stream: ' + anonPick(o.allS) +
        (o.mp4.length + o.hls.length ? '' : ' · Hinweis im Menü: ' + pageDlReason(o, caps)));
    } else L.push('Video-Element: keines');
    let rs = [];
    try { rs = performance.getEntriesByType('resource'); } catch (e) {}
    const now = performance.now(), cls = {};
    rs.forEach((e) => {
      if (!/^(xmlhttprequest|fetch|video|audio|other)$/.test(e.initiatorType) || now - e.startTime > 120000) return;
      const k = (e.initiatorType === 'xmlhttprequest' ? 'xhr' : e.initiatorType) + ':' + anonExt(e.name);
      cls[k] = (cls[k] || 0) + 1;
    });
    L.push('Ladevorgänge hier (letzte 2 min, Art:Endung): ' + anonCount(cls) + ' · Zeitleiste ' + rs.length + (rs.length >= 250 ? ' (voll – Neueres fehlt evtl.)' : ''));
  }
  function diagAnon() {
    const L = [];
    L.push('Kadri – anonymisierte Diagnose · ' + (typeof KADRI_VERSION !== 'undefined' ? 'Kadri ' + KADRI_VERSION + ' · ' : '') + 'Skript 19.30');
    const ua = navigator.userAgent, bm = /(Chrome|Firefox)\/(\d+)/.exec(ua);
    L.push('Browser: ' + (bm ? bm[1] + ' ' + bm[2] : '?') + (/Android/.test(ua) ? ' · Android' : '') + ' · Fenster: ' + (IN_FRAME ? 'eingebettet' : 'Hauptseite') +
      ' · Videos auf der Seite: ' + allVideos().length);
    try { diagFrameSources(L); } catch (e) { L.push('Fenster/Quellen: Fehler ' + ((e && e.name) || '')); }
    const p = vp;
    if (p) {
      const v = p.vid;
      L.push('Player: offen · Modus ' + p.mode + ' · Wiedergabe ' + (p.hls ? 'hls' : anonKind(p.cur || '')) +
        (v ? ' · Bereitschaft ' + v.readyState + (v.error ? ' · Fehler ' + v.error.code : '') + ' · Auflösung ' + Math.min(v.videoWidth || 0, v.videoHeight || 0) + 'p' : '') +
        ' · Helfer-Downloads ' + (p.hdl ? (p.hdl.ok ? 'unterstützt' : p.hdl.pending ? 'wird geprüft' : 'nicht bestätigt') : '-'));
      [['Originalvideo', p.media && p.media.orig], ['eigener Player', p.media && p.media.own]].forEach((c) => {
        if (!c[1]) return;
        let snap = [];
        try { snap = mediaRegistry.snapshot(c[1]); } catch (e) {}
        L.push('Quellen ' + c[0] + ' (' + snap.length + '):');
        anonSnapLines(L, snap);
        // was der eigene Player selbst belegt hat, aber die Auswahl am schwebenden Knopf (Originalvideo) nicht sieht
        try { L.push('  Auswahl MP4: ' + anonPick(selectDownloads(snap, { supported: true })) + ' · Stream: ' + anonPick(selectStreams(snap, { hls: true }))); } catch (e) {}
      });
    } else L.push('Player: geschlossen');
    // Netzwerk: Art und Rolle der beobachteten Adressen (Rolle aus gelesenen Listen, sonst eindeutige Muster) – nur Zählungen
    const roles = {};
    let net = [];
    try { net = recent(); } catch (e) {}
    net.forEach((u) => { let r = 'unknown'; try { r = mediaRoleHint(u); } catch (e) {} const k = anonKind(u) + ':' + r; roles[k] = (roles[k] || 0) + 1; });
    L.push('Netzwerk (zuletzt beobachtet, Art:Rolle): ' + (Object.keys(roles).sort().map((k) => k + ' ×' + roles[k]).join(', ') || '-') +
      ' · Listen gelesen ' + plInfo.size + ' (davon DASH-Manifeste ' + Array.from(plInfo.values()).filter((x) => x.kind === 'dash').length + ')' +
      ' · Rollen aus Listen ' + plParts.size);
    L.push('Helfer-Downloads (jüngste zuerst): ' + (hdlDiags.length ? '' : '-'));
    hdlDiags.forEach((d, i) => L.push(' ' + (i + 1) + '. ' + hdlDiagText(d)));
    return anonScrub(L.join('\n'));
  }
  function showDiagBox(text) {
    ui();
    const box = h('div', { class: 'diag' });
    const ta = h('textarea', { readonly: 'readonly' });
    ta.value = text;
    const copy = h('button', null, 'Kopieren');
    const close = h('button', null, 'Schließen');
    copy.addEventListener('click', () => { ta.select(); copyText(ta.value, 'Diagnose kopiert'); });
    // Anonymisiert: zeigt genau den Text, der kopiert wird (zum Weitergeben ohne Seitenbezug)
    const anon = h('button', { class: 'danon' }, 'Anonymisiert kopieren');
    anon.addEventListener('click', () => { let t = ''; try { t = diagAnon(); } catch (e) { t = 'Kadri – anonymisierte Diagnose: Fehler ' + ((e && e.name) || ''); } ta.value = t; ta.select(); copyText(t, 'Anonymisierte Diagnose kopiert'); });
    close.addEventListener('click', () => box.remove());
    box.append(h('div', { class: 'dh' }, 'Video-Assistent · Diagnose'), ta, h('div', { class: 'db' }, copy, anon, close));
    root.append(box);
    attachHost();
    // Prüfen, ob das Fenster wirklich sichtbar ist – sonst Notlösung im Aufrufer
    if (!hostEl || !hostEl.isConnected || !box.getBoundingClientRect().height) { box.remove(); throw new Error('Fenster nicht sichtbar'); }
  }
  function openDiag() {
    let text = '';
    try {
      const v = active || biggestVideo();
      text = diag(v, resolve(v)) + '\n' + videoReport();
    } catch (e) {
      text = 'Fehler beim Erstellen der Diagnose: ' + ((e && (e.stack || e.message)) || e);
      try { text += '\n' + videoReport(); } catch (e2) {}
    }
    try {
      showDiagBox(text);
    } catch (e) {
      // Notlösung: Eingabefeld des Browsers – dort lässt sich der Text markieren und kopieren
      try { prompt('Diagnose – alles markieren und kopieren:', text.replace(/\n/g, ' | ')); }
      catch (e2) { try { alert(text); } catch (e3) {} }
    }
  }
  try {
    const reg = (typeof GM_registerMenuCommand === 'function' && GM_registerMenuCommand) ||
      (typeof GM !== 'undefined' && GM && typeof GM.registerMenuCommand === 'function' && GM.registerMenuCommand);
    if (reg) reg(window.top === window ? 'Diagnose anzeigen' : 'Diagnose anzeigen (eingebettet: ' + location.hostname + ')', openDiag);
  } catch (e) {}

  // ---------- Diagnose (lange auf "Player" drücken) ----------
  function diag(v, r) {
    return maskUrls([
      'Video-Assistent 19.30',
      'Seite: ' + location.host + location.pathname,
      'Video-src: ' + (v ? String(v.currentSrc || v.src || '-').slice(0, 90) : 'kein Video'),
      'Ergebnis: ' + (r.how || 'nichts') + (r.best ? ' – ' + r.best.slice(0, 110) : ''),
      'Zuordnung über: ' + (lastVia || '-') + ' | Laufendes Video: ' + (function () { const f = assetFor(v); return (f.asset || '-') + ' (' + f.via + (f.sure ? ', sicher' : '') + ')'; })() +
        ' | geladene Videos: ' + Array.from(assetHits.keys()).slice(-4).map((a) => a + '×' + assetHits.get(a).length).join(', '),
      'Link zum Video: ' + (function () { try { const u = postUrlFor(v); return (u || '-') + ' (' + (postUrlFor.via || '-') + ') | Video-ID im Kasten: ' + (fbVideoId(v) || '-'); } catch (e) { return '-'; } })(),
      'Spiegeln: ' + (vp && vp.mode === 'capture' ? 'aktiv, ' + (vp.mirrorFix || 0) + '× neu verbunden' + (vp.mirrorWhy ? ' (zuletzt: ' + vp.mirrorWhy + ')' : '') : (FB_MIRROR ? 'bereit' : 'aus')),
      'Puffer-Spur: ' + (function () { if (!v) return '-'; const m = creditsFor(v, 0); const l = (bufCredit.get(v) || []).length; return l + ' Zuwächse | ' + (Array.from(m.entries()).map((e) => e[0].slice(-6) + ':' + e[1].toFixed(1)).join(', ') || '-'); })(),
      'HD nachladen: ' + hdLog + ' | Weiterleitung: ' + lastResolve + (PH ? ' | Seite-A-MP4: ' + phLog : '') + (IG ? ' | Instagram-MP4: ' + igLog : '') + (TT ? ' | TikTok: ' + ttLog + ' · ' + (ttPostUrl(v) || 'kein Link') : ''),
      'Öffnen (zuletzt): ' + (function () {
        const o = openTimes;
        if (!o) return '-';
        const ms = (x) => (x ? Math.round(x - o.t0) + ' ms' : '–');
        return 'sichtbar nach ' + ms(o.vis) + ' · Bild der Seite live nach ' + ms(o.live) + ' · eigenes Video nach ' + ms(o.own) +
          ' · ' + (o.how || '-') + (o.swap ? ' nach ' + ms(o.swap) : '') + (typeof o.gap === 'number' ? ' (Abstand ' + Math.abs(o.gap).toFixed(2) + ' s)' : '');
      })(),
      'Zuletzt geöffnet: ' + (lastIntent.t ? Math.round((Date.now() - lastIntent.t) / 1000) + ' s her | ' + lastIntent.how + ' | ' + hostOf(lastIntent.url) + ' ' + urlTail(lastIntent.url, 50) : '-'),
      'Nächstes-Reel-Countdown abgebrochen: ' + nextCancels + '×',
      'Bild-in-Bild: Browser ' + (document.pictureInPictureEnabled ? 'kann es' : 'kann es für Webseiten nicht (nur Wischen zum Startbildschirm)') +
        ' | im Player: ' + (vp ? (vp.pipOk ? 'erlaubt' : 'aus') + ' (' + (vp.mode === 'capture' ? 'gespiegelt' + (kadriPage() ? ', Schild' : '') : 'eigener Player') + ')' : 'zu') +
        ' | Helfer-Download: ' + (hdlDiags.length ? hdlDiags.map(hdlDiagText).join(' || ') : '-') +
        ' | Vorschau (' + (CONFIG.seekPreview === 'thumb' ? 'kleines Bild' : 'im Bild') + '): ' + (vp ? (vp.prevWhy || (vp.mode === 'own' ? 'noch nicht gespult' : vp.fbPrev && (vp.fbBad || []).indexOf(vp.fbPrev) < 0 ? 'Bilder aus der MP4 (gespiegelt)' : 'nur Zeit (gespiegelt)')) : '-') +
        (vp && vp.prevFirst ? ' · erstes Bild nach ' + (vp.prevFirst / 1000).toFixed(1) + ' s' : '') + (vp && vp.prevMiss ? ' · ' + vp.prevMiss + '× ohne Bild' : '') +
        ' | Lupe: ' + (vp ? vp.lupeWhy || 'noch nicht gespult' : '-') + (vp && vp.scrubSizes ? ' | Bildgrößen beim Spulen: ' + vp.scrubSizes : '') + (vp && vp.subsWhy ? ' | Untertitel der Seite: ' + vp.subsWhy : ''),
      'Stream-Nachweis: ' + (r.proof || '-') + ' | Listen gelesen: ' + plInfo.size + ' | Stück-Ordner: ' + segHits.size +
        (function () { const p = playingStream(navAt); return p ? ' | lädt gerade: ' + hostOf(p.u) + ' ' + urlTail(p.u, 40) : ''; })(),
      'Kodierung: ' + (r.best ? encTag(r.best) || '-' : '-'),
      'IDs am Video: ' + (r.ids.slice(0, 12).join(', ') || '-'),
      'Meta-Einträge: ' + metaCount + ' (Schlüssel: ' + metaMap.size + ') | API-Antworten: ' + bodiesRead + ' | Netzwerk-Quellen: ' + sources.length,
      'Videos auf der Seite: ' + allVideos().length,
      'Browser: ' + navigator.userAgent.slice(0, 120),
      'Reihenfolge beim Tippen (' + ((r.list || []).length) + '):',
    ].concat((r.list || []).map((x, i) => ' ' + (i + 1) + '. ' + x.how + ' | ' + typeShort(x.u) + ' | ' + hostOf(x.u) + ' ' + urlTail(x.u, 40)))
    .concat([
      'Netzwerk-Quellen (letzte 5):',
    ]).concat(recent().slice(-5).map((x) => ' - ' + typeShort(x) + ' | ' + hostOf(x) + ' ' + urlTail(x, 40)))
    .concat([
      'Adressen zu diesem Video (' + lastNear.length + '):',
    ]).concat(lastNear.slice(0, 12).map((c, i) =>
      ' ' + (i + 1) + '. ' + c.kind + ' ' + (c.res ? c.res + 'p' : '?') + ' | ID ' + (c.asset || '-') + ' | ' + (c.tag || 'kein Tag').slice(0, 50) + ' | ' + String(c.from || '').slice(0, 40)
    )).join('\n'));
  }
})();
