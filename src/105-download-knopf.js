  // ---------- P4c: Download-Knopf direkt am Video, neben „▶ Player“ ----------
  // Ein Tipp auf ⬇ öffnet immer zuerst die Auswahl (auch bei nur einer Option); erst ein Tipp auf einen Eintrag handelt.
  // Die Helfer-App steht oben; „Im Browser speichern/öffnen“, YTDLnis und Teilen bleiben ausdrücklich wählbare
  // Alternativen. Nie navigiert ein einfacher Tipp zur Videodatei oder startet einen Browser-Download. Der Kadri-Player
  // öffnet sich dabei nicht; das Video der Seite läuft unverändert weiter. Derselbe Weg wie im Player:
  //  - Quellen aus der gemeinsamen Registry (mediaRegistry) mit denselben Belegen: Adresse am Element, Stücke GENAU dieses
  //    Streams gerade geladen („läuft gerade, geprüft“), Seitendaten mit Video-ID, Adapter; dazu, was das Element
  //    nachweislich gerade abspielt (currentSrc, kein MSE). Nichts wird geraten, kein versteckter Player.
  //  - dieselbe Auswahl (selectDownloads/selectStreams, nur „attemptable“) und dieselbe Auflösung
  //    (resolveSelection/resolveStream inkl. Bindung, die der Helfer prüft);
  //  - dieselbe zentrale Download-Verwaltung im Hintergrund (start/hlsplan/hlsstart/find/cancel über KADRI_DOWNLOAD):
  //    dort werden auch doppelte Starts zwischen Knopf und Player erkannt.
  // HLS-Stücke werden nie als MP4 gespeichert (mediaDownloadState: Segmente/Listen sind keine MP4-Datei).
  // Lange drücken: Teilen wie bisher; YTDLnis, Browser und Teilen bleiben im Menü erreichbar.
  const pageDl = { busy: false, job: null, url: '' };
  // (Funktionsdeklarationen: ui() in 100 fragt pageDlShown() schon beim Start ab)
  function pageDlHelper() { return typeof KADRI_DOWNLOAD === 'function' && CONFIG.systemHelper !== false; }
  function pageDlShown() { return pageDlHelper() || SHOW_DOWNLOAD; }
  const pageDlActive = (j) => !!j && ['starting', 'unconfirmed', 'running', 'cancelling'].indexOf(j.state) >= 0;
  const pageDlText = (j) => tr(j.label) + (j.progress ? ' · ' + j.progress : '');

  // Das Element spielt nachweislich genau diese Adresse (currentSrc, kein MSE/Blob, Bild vorhanden): „diese Wiedergabe“.
  function pageDlObservePlaying(v, ctx) {
    let u = '';
    try { u = v.currentSrc || ''; } catch (e) { return; }
    if (!/^https?:/i.test(u) || v.srcObject || v.readyState < 2 || v.error) return;
    const isHls = /\.m3u8(\?|#|$)/i.test(u);
    const h = Math.min(v.videoWidth || 0, v.videoHeight || 0);
    mediaRegistry.observe(ctx, Object.assign({ url: u, provenance: { kind: 'element', origin: 'element-playing' },
      association: { state: 'bound', evidence: ['element-src', 'element-playing'] }, browser: 'loaded' }, isHls ? { kind: 'hls' } : {},
      h > 0 && !isHls ? { quality: { status: 'observed', value: { height: h }, evidenceIds: ['decoded-frame'] } } : {}));
  }
  // Auswählbare MP4-Dateien und Streams genau dieses Videos (wie beim Öffnen des Players, ohne ihn zu öffnen)
  function pageDlOptions(v, caps) {
    try { playerSources(v, {}); } catch (e) {}
    const ctx = mediaRegistry.contextFor(v);
    if (!ctx) return { mp4: [], hls: [], all: [], allS: [], dash: '' };
    try { pageDlObservePlaying(v, ctx); } catch (e) {}
    const snap = mediaRegistry.snapshot(ctx);
    const all = selectDownloads(snap, { supported: true }).map((o) => Object.assign({ ctx: ctx }, o));
    const allS = selectStreams(snap, { hls: !!(caps && caps.hls) }).map((o) => Object.assign({ ctx: ctx }, o));
    return { mp4: all.filter((o) => o.state === 'attemptable'), hls: allS.filter((o) => o.state === 'attemptable'), all: all, allS: allS,
      dash: mediaDashState([snap]) };
  }
  // Warum nichts angeboten wird (feste Texte, ohne Adresse)
  function pageDlReason(o, caps) {
    const rs = o.all.map((x) => x.reason).concat(o.allS.map((x) => x.reason));
    if (o.dash === 'bound') return 'DASH-Stream erkannt – derzeit nicht unterstützt';
    if (o.allS.some((x) => x.reason === 'helper-unavailable') || (!(caps && caps.hls) && o.allS.length)) return 'Stream erkannt – diese Helfer-App-Version speichert keine Streams';
    if (rs.indexOf('protected') >= 0) return 'Video geschützt (DRM/verschlüsselt) – nicht speicherbar';
    if (rs.indexOf('ambiguous') >= 0 || rs.indexOf('not-bound') >= 0) return 'Quelle nicht sicher diesem Video zugeordnet – Video kurz abspielen und erneut tippen';
    if (rs.indexOf('not-standalone') >= 0 || rs.indexOf('stream-not-supported') >= 0) return 'Nur Teilstücke eines Streams erkannt – Video abspielen und erneut tippen';
    // nur zeitlich vermutet: ehrlich so benennen (nach allen sicheren Gründen, nie als Angebot)
    if (o.dash === 'suspected') return 'Vermutlich DASH-Stream – nicht sicher zugeordnet und derzeit nicht unterstützt';
    return 'Keine speicherbare Videodatei erkannt – Video abspielen und erneut tippen';
  }
  const pageDlHelperText = (kind) => kind === 'unpaired'
    ? 'Helfer-App nicht gekoppelt – in den Kadri-Einstellungen „Helfer koppeln“'
    : kind === 'rejected' ? 'Die Helfer-App erkennt diese Kopplung nicht mehr – neu koppeln'
      : 'Helfer-App nicht erreichbar – App öffnen und erneut tippen';

  // Videodatei, die das Element nachweislich gerade abspielt (wie directUrl im Player): http(s), kein MSE/Blob, Bild
  // vorhanden, kein Stream (HLS/DASH). Nur sie wird dem Browser angeboten – keine behauptete oder geratene Quelle.
  function pageDlDirect(v) {
    let u = '';
    try { u = v.currentSrc || ''; } catch (e) { return ''; }
    if (!/^https?:/i.test(u) || v.srcObject || v.readyState < 2 || v.error) return '';
    return /\.(m3u8|mpd)(\?|#|$)/i.test(u) ? '' : u;
  }
  // Alternativen, nur auf ausdrücklichen Tipp (wie im Player): YTDLnis, Browser-Download, im Browser öffnen, Teilen.
  // „Im Browser herunterladen“ nur, wenn der Browser die Datei sicher als Download behandelt: Datei derselben Herkunft wie
  // die Seite (dort gilt das download-Attribut). Bei fremden Servern ignoriert der Browser es und öffnet die Datei als
  // Seite – dann gibt es diesen Eintrag nicht, nur das ausdrücklich so benannte „Im Browser öffnen“.
  function pageDlExternal(v, items) {
    let link = '';
    try { link = SHOW_DOWNLOAD ? postUrlFor(v) : ''; } catch (e) {}
    const d = pageDlDirect(v);
    // (ext: braucht einen frischen Tipp – steht die Auswahl im Hauptfenster, führt es diese Aktion selbst aus, src/035)
    if (link) items.push({ label: 'Mit YTDLnis', sub: 'Link an YTDLnis', ext: { k: 'ytdlnis', u: link }, fn: () => toYtdlnis(link) });
    if (d && sameOrigin(d) && !IS_ANDROID_UA()) {
      items.push({ label: 'Im Browser herunterladen', sub: 'Download-Manager des Browsers · bleibt auf dieser Seite', fn: () => {
        toast('Download wird vorbereitet …');
        browserDownload(d).then((ok) => toast(ok ? 'Download an Browser übergeben'
          : 'Die Seite sperrt den Download'));
      } });
    }
    if (d) {
      items.push({ label: 'Im Browser öffnen', sub: 'nur öffnen: neuer Tab, kein Download – dort ⋮ → Herunterladen', ext: { k: 'open', u: d }, fn: () => pageDlOpenTab(d) });
    }
    if (link || d) items.push({ label: 'Teilen …', sub: 'an eine andere App', ext: { k: 'share', u: link || d }, fn: () => shareUrl(link || d) });
    return items;
  }
  function pageDlOpenTab(d) {
    const w = window.open(d, '_blank');
    if (w) { try { w.opener = null; } catch (e) {} } else toast('Neuer Tab wurde blockiert – Pop-ups für diese Seite erlauben');
  }

  async function onPageDownload() {
    const v = active;
    if (!v) return;
    if (!pageDlHelper()) {   // ohne Helfer-Kanal (Firefox, Userscript): dieselbe Auswahl, nur die Alternativen
      const ext = pageDlExternal(v, []);
      if (ext.length) pageDlMenu('Speichern', ext); else toast('Kein Link zu diesem Video gefunden – Beitrag öffnen und nochmal versuchen');
      return;
    }
    if (pageDl.busy) return;
    pageDl.busy = true;
    try {
      // laufender Auftrag dieses Videos: Stand und Abbrechen statt eines zweiten Starts
      if (pageDl.job && pageDlActive(pageDl.job)) {
        const s = await helperDl('status', { id: pageDl.job.id });
        if (s && s.ok && s.value && s.value.job) { pageDl.job = s.value.job; hdlDiagUpdate(pageDl.job); }
        if (pageDlActive(pageDl.job)) { pageDlStatusMenu(v); return; }
      }
      const c = await helperDl('caps');
      const caps = c && c.ok && c.value;
      if (!caps || !caps.reachable) { pageDlMenu('Speichern', pageDlExternal(v, [{ label: pageDlHelperText(caps && caps.error), info: true }])); return; }
      if (!caps.supported) { pageDlMenu('Speichern', pageDlExternal(v, [{ label: 'Diese Helfer-App-Version kann keine direkten Downloads', info: true }])); return; }
      const o = pageDlOptions(v, caps);
      // läuft schon (z. B. aus dem Player gestartet)? dieselbe zentrale Verwaltung findet ihn
      const known = o.mp4.map((x) => mediaRegistry.resolveSelection(x.ctx, x.sourceId, x.revision))
        .concat(o.hls.map((x) => mediaRegistry.resolveStream(x.ctx, x.sourceId, x.revision)));
      for (const sel of known) {
        if (!sel.ok) continue;
        const f = await helperDl('find', { url: sel.url });
        if (f && f.ok && f.value && pageDlActive(f.value)) {
          if (!hdlDiagFor(f.value.id)) hdlDiagNew({ origin: '?', binding: '?', ageSec: -1, existing: true },
            f.value.kind === 'hls' ? null : sel.url, f.value);
          pageDl.job = f.value; pageDl.url = sel.url; pageDlStatusMenu(v); return;
        }
      }
      const n = o.mp4.length + o.hls.length;
      if (!n) { pageDlMenu('Speichern', pageDlExternal(v, [{ label: pageDlReason(o, caps), info: true }])); return; }
      // Immer zuerst die Auswahl, auch bei nur einer Option (kein Sofortstart). Tatsächlich Geladenes zuerst (MP4 oder Stream); sonst bisherige Reihenfolge (stabile Sortierung)
      // Direkter Download über die Helfer-App: je MP4-Variante ein Eintrag (Qualität in der Unterzeile), Streams mit
      // Qualitäts-/Tonauswahl; kein neuer Tab, keine Navigation
      const items = o.mp4.slice(0, 4).map((x) => ({ loaded: x.loaded, item: { label: 'Mit Helper herunterladen', sub: 'MP4' + (x.height ? ' · ' + x.height + 'p' : '') + ' · ' +
        tr('direkt in die Helfer-App · kein neuer Tab') + ' · ' + tr(hdlEvidenceText(x)), fn: () => pageDlStartMp4(x) } }))
        .concat(o.hls.slice(0, 2).map((x) => ({ loaded: x.loaded, item: { label: 'Stream mit Helper herunterladen …', sub: tr('als MP4 · Qualität und Ton wählen') + ' · ' +
          tr(hdlEvidenceText(x)), fn: () => pageDlPlan(x) } })))
        .sort((a, b) => Number(!!b.loaded) - Number(!!a.loaded)).map((e) => e.item);
      pageDlMenu('Speichern', pageDlExternal(v, items));
    } finally {
      pageDl.busy = false;
    }
  }
  function pageDlName() { return (pageTitle() || 'Video').slice(0, 100); }
  function pageDlPlaySample(v, u) {
    if (!v || !v.isConnected || v.srcObject) return null;
    try { if (!u || v.currentSrc !== new URL(u).href) return null; } catch (e) { return null; }
    const seconds = (r) => { let n = 0; try { for (let i = 0; i < r.length; i++) n += r.end(i) - r.start(i); } catch (e) {} return Math.round(n); };
    return { rs: v.readyState, w: v.videoWidth || 0, h: v.videoHeight || 0, buf: seconds(v.buffered),
      played: seconds(v.played), err: v.error ? v.error.code : 0, paused: !!v.paused };
  }
  function pageDlStarted(r, u, info, local) {
    if (r && r.ok && r.value && r.value.job) hdlDiagNew(Object.assign(info, { existing: !!r.value.existing }), u, r.value.job, local);
    else hdlDiagFailure(info, r);
    if (!r) { toast('Helfer-App nicht erreichbar'); return; }
    if (!r.ok) { toast((r.error && r.error.message) || 'Helfer-App: Verbindung fehlgeschlagen'); return; }
    pageDl.job = r.value.job; pageDl.url = u;
    toast(r.value.existing ? tr('Läuft schon') + ': ' + pageDlText(r.value.job) : r.value.job.state === 'unconfirmed'
      ? 'Verbindung unterbrochen – Stand wird geprüft' : 'Helfer-App lädt – du kannst die Seite verlassen; Fortschritt in der Benachrichtigung');
  }
  async function pageDlStartMp4(x) {
    const sel = mediaRegistry.resolveSelection(x.ctx, x.sourceId, x.revision);
    if (!sel.ok) { toast('Die Quelle hat sich geändert – bitte erneut tippen'); return; }
    const v = active;
    const info = Object.assign(hdlSourceInfo(x, pageDlPlaySample(v, sel.url)), { stage: 'start' });
    toast('Helfer-App startet den Download …');
    pageDlStarted(await helperDl('start', { url: sel.url, name: pageDlName() }), sel.url, info,
      info.play ? () => pageDlPlaySample(v, sel.url) : null);
  }
  async function pageDlPlan(x) {
    const sel = mediaRegistry.resolveStream(x.ctx, x.sourceId, x.revision);
    if (!sel.ok) { toast('Die Quelle hat sich geändert – bitte erneut tippen'); return; }
    const info = Object.assign(hdlSourceInfo(x), { stream: true, stage: 'hlsplan' });
    toast('Helfer-App prüft den Stream …');
    const r = await helperDl('hlsplan', { url: sel.url, bind: sel.bind });
    if (!r) { hdlDiagFailure(info, r); toast('Helfer-App nicht erreichbar'); return; }
    if (!r.ok || !r.value || !Array.isArray(r.value.options)) { hdlDiagFailure(info, r, sel.url); toast((r.error && r.error.message) || 'Stream lässt sich nicht speichern'); return; }
    const p = r.value;
    if (p.job && pageDlActive(p.job)) { hdlDiagNew(Object.assign(info, { existing: true }), null, p.job); pageDl.job = p.job; pageDl.url = sel.url; toast(tr('Läuft schon') + ': ' + pageDlText(p.job)); return; }
    const resume = p.job && p.job.state === 'interrupted' ? p.job : null;
    const go = (opt) => pageDlGo(sel.url, p.planId, opt, resume, x);
    // auch bei nur einer Qualität/Tonspur erst die Auswahl (wie im Player); gestartet wird nur per Tipp
    const dur = p.duration > 0 ? fmtTime(p.duration) : '';
    // Hauptzeile: die Qualität (1080p, 720p …); Ton, Laufzeit, Datenrate und Formathinweis gedämpft darunter
    pageDlMenu(resume ? 'Stream fortsetzen' : 'Stream speichern', p.options.slice(0, 12).map((o) => ({
      label: (resume ? tr('Fortsetzen') + ': ' : '') + (o.height ? o.height + 'p' : tr('Qualität unbekannt')),
      sub: [o.audio === 'muxed' ? tr('Ton im Stream') : tr('Ton') + ': ' + (o.audio.name || o.audio.lang || tr('eigene Spur')),
        dur, o.bandwidth ? Math.round(o.bandwidth / 1000) + ' kbit/s' : '',
        o.codecs === 'ok' ? '' : tr('Format wird beim Laden geprüft')].filter(Boolean).join(' · '),
      fn: () => go(o) })));
  }
  async function pageDlGo(u, planId, o, resume, x) {
    const info = Object.assign(hdlSourceInfo(x), { stream: true, planned: true, stage: resume ? 'hlsresume' : 'hlsstart' });
    toast(resume ? 'Helfer-App setzt den Download fort …' : 'Helfer-App startet den Download …');
    const r = await helperDl(resume ? 'hlsresume' : 'hlsstart', resume ? { id: resume.id, planId: planId, option: o.id } : { planId: planId, option: o.id, name: pageDlName() });
    pageDlStarted(r, u, info);
  }
  function pageDlStatusMenu(v) {
    const j = pageDl.job;
    const items = [{ label: 'Helfer-App: ' + tr(j.label), sub: j.progress || 'Stand wird abgefragt', info: true }];
    if (j.state !== 'cancelling') items.push({ label: 'Download abbrechen', sub: 'Helfer-App hört sofort auf und löscht die Teil-Datei', fn: async () => {
      const r = await helperDl('cancel', { id: j.id });
      if (!r || !r.ok) { toast((r && r.error && r.error.message) || 'Helfer-App nicht erreichbar'); return; }
      pageDl.job = r.value.job;
      toast(r.value.reachable ? pageDlText(r.value.job) : 'Helfer-App nicht erreichbar – Abbruch wird nachgeholt');
    } });
    pageDlMenu('Speichern', pageDlExternal(v, items));
  }

  // Auswahl als Bottom-Sheet über der Seite (nicht im Player): Einträge mit Unterzeile, mindestens 48 px hoch; das Video
  // läuft weiter. Alles liegt im geschlossenen Shadow DOM – darum keine Listener auf document: ein Außentipp ist ein Tipp
  // auf den eigenen abgedunkelten Hintergrund (Ziel = Hintergrund), Scrollen im Blatt schließt nie. Ein Eintrag löst
  // seine Aktion genau einmal aus; danach schließt das Blatt kontrolliert (öffnet die Aktion selbst ein neues, bleibt es).
  // Zurück-Taste: ein Verlaufseintrag nur für das Blatt (wie beim Player; nicht auf Facebook/Instagram).
  let pageDlEl = null;          // offenes Blatt (Hintergrund-Element)
  let pageDlHist = '';          // Kennung des eigenen Verlaufseintrags (in history.state) für die Zurück-Taste
  let pageDlBack = '';          // eigenes history.back() unterwegs: Kennung des Eintrags, den es verlassen soll
  let pageDlBackTimer = 0, pageDlBackTries = 0;
  let pageDlWantHist = false;   // Blatt offen, Verlaufseintrag erst setzen, wenn das eigene Zurück angewendet ist
  let pageDlFit = null;         // Anpassung an den sichtbaren Bereich (Systemleisten, Zoom, Tastatur)
  // visualViewport-Listener des bisherigen Blatts vollständig entfernen (beim Schließen und beim Ersetzen)
  function pageDlUnfit() {
    if (pageDlFit && window.visualViewport) { visualViewport.removeEventListener('resize', pageDlFit); visualViewport.removeEventListener('scroll', pageDlFit); }
    pageDlFit = null;
  }
  // Kennung im aktuellen history.state – nur sie belegt, dass der aktuelle Eintrag der eigene ist (Länge + Adresse nicht)
  function pageDlHistTok() {
    try { const st = history.state; return st && typeof st === 'object' && typeof st.__kadriDlSheet === 'string' ? st.__kadriDlSheet : ''; }
    catch (e) { return ''; }
  }
  // Verlaufseintrag nur für das offene Blatt: Zustand der Seite unverändert übernommen, dazu die eigene Kennung. Läuft noch
  // ein eigenes Zurück, erst danach setzen – sonst träfe das verspätete Zurück den neuen Eintrag (Blatt zu, nächste
  // Zurück-Taste verließe die Seite). Fremde Zustandsform (kein Objekt): kein Eintrag, nichts an der Seite verändert.
  function pageDlPushHist() {
    pageDlWantHist = false;
    if (META || !pageDlEl || pageDlHist) return;
    if (pageDlBack) { pageDlWantHist = true; return; }
    let st;
    try { st = history.state; } catch (e) { return; }
    if (st !== null && (typeof st !== 'object' || Array.isArray(st))) return;
    const tok = Math.random().toString(36).slice(2) + Date.now().toString(36);
    try { history.pushState(Object.assign({}, st || {}, { __kadriDlSheet: tok }), '', location.href); pageDlHist = tok; } catch (e) {}
  }
  // das eigene Zurück ist angewendet (der verlassene Eintrag ist nicht mehr der aktuelle): erst jetzt neu eintragen
  function pageDlBackSettled() {
    pageDlBack = ''; clearTimeout(pageDlBackTimer); pageDlBackTimer = 0;
    if (pageDlWantHist) pageDlPushHist();
  }
  // Sicherheitsnetz ohne popstate: nur prüfen, nie selbst eintragen, solange der alte eigene Eintrag noch der aktuelle ist
  // (dann kann das verspätete Zurück ihn noch verlassen). Höchstens 60 s, danach bleibt das Blatt ohne eigenen Eintrag.
  function pageDlBackCheck() {
    pageDlBackTimer = 0;
    if (!pageDlBack) return;
    if (pageDlHistTok() !== pageDlBack) { pageDlBackSettled(); return; }
    if (++pageDlBackTries < 120) pageDlBackTimer = setTimeout(pageDlBackCheck, 500);
  }
  function pageDlClose(fromBack) {
    if (!pageDlEl) return;
    pageDlEl.remove(); pageDlEl = null;
    pageDlUnfit();
    removeEventListener('keydown', pageDlKey);
    pageDlWantHist = false;
    const own = pageDlHist;
    pageDlHist = '';
    // Selbst zurück nur, wenn der aktuelle Eintrag nachweislich der eigene ist (seine Kennung im history.state)
    if (own && !fromBack && pageDlHistTok() === own) {
      pageDlBack = own; pageDlBackTries = 0;
      try { history.back(); } catch (e) { pageDlBack = ''; return; }
      pageDlBackTimer = setTimeout(pageDlBackCheck, 500);
    }
  }
  function pageDlKey(e) { if (e.key === 'Escape' && pageDlEl) { e.preventDefault(); pageDlClose(); } }
  addEventListener('popstate', () => {
    const tok = pageDlHistTok();
    if (pageDlBack) {                       // das eigene Zurück – nie ein Grund, ein (neues) Blatt zu schließen
      if (tok !== pageDlBack) pageDlBackSettled();
      return;
    }
    // Zurück-Taste: der eigene Eintrag des offenen Blatts ist nicht mehr der aktuelle
    if (pageDlEl && pageDlHist && tok !== pageDlHist) { pageDlHist = ''; pageDlClose(true); }
  });
  function pageDlMenu(title, items, here) {
    // eingebettetes Fenster, Knopf im Hauptfenster: die Auswahl erscheint dort (Aktionen bleiben hier, src/035)
    if (!here && IN_FRAME && fuiRelay()) { fuiFrameMenu(title, items); return; }
    ui();
    // ein neues Blatt ersetzt das offene (z. B. Qualität/Ton nach „Stream …“) – der Verlaufseintrag bleibt, die
    // visualViewport-Listener des alten Blatts werden entfernt
    if (pageDlEl) { pageDlEl.remove(); pageDlEl = null; }
    pageDlUnfit();
    const ov = h('div', { class: 'dlo' });
    const box = h('div', { class: 'dlm', role: 'menu', 'aria-label': tr(title) });
    box.appendChild(h('div', { class: 'dlg', 'aria-hidden': 'true' }));   // Griff (nur Anzeige)
    const head = h('div', { class: 'dlh' }, tr(title));
    box.appendChild(head);
    const list = h('div', { class: 'dll' });   // nur die Liste scrollt; Titel und „Schließen“ bleiben stehen
    box.appendChild(list);
    let used = false;   // genau eine Aktion je Blatt
    items.forEach((it) => {
      const b = h('button', { class: 'dli' + (it.info ? ' info' : ''), role: it.info ? 'note' : 'menuitem' }, tr(it.label));
      if (it.sub) b.appendChild(h('small', {}, tr(it.sub)));
      if (!it.info) b.addEventListener('click', (e) => {
        e.stopPropagation();
        if (used || pageDlEl !== ov) return;
        used = true;
        box.classList.add('used');
        try { it.fn(); } catch (err) {}
        if (pageDlEl === ov) pageDlClose();   // hat die Aktion kein neues Blatt geöffnet: jetzt schließen
      });
      else b.disabled = true;
      list.appendChild(b);
    });
    const close = h('button', { class: 'dli dlx', 'aria-label': 'Schließen' }, tr('Schließen'));
    close.addEventListener('click', (e) => { e.stopPropagation(); if (pageDlEl === ov) pageDlClose(); });
    box.appendChild(close);
    ov.appendChild(box);
    // Tipp auf den Hintergrund (nicht ins Blatt) schließt; click statt pointerdown – ein Wisch zum Scrollen ist kein Tipp
    ov.addEventListener('click', (e) => { e.stopPropagation(); if (e.target === ov && pageDlEl === ov) pageDlClose(); });
    root.appendChild(ov);
    pageDlEl = ov;
    // an den sichtbaren Bereich anpassen (Android-Systemleisten, Adressleiste, Zoom, kleine Displays)
    pageDlFit = () => {
      const vv = window.visualViewport;
      if (!vv || pageDlEl !== ov) return;
      ov.style.left = vv.offsetLeft + 'px'; ov.style.top = vv.offsetTop + 'px';
      ov.style.width = vv.width + 'px'; ov.style.height = vv.height + 'px';
    };
    pageDlFit();
    if (window.visualViewport) { visualViewport.addEventListener('resize', pageDlFit); visualViewport.addEventListener('scroll', pageDlFit); }
    addEventListener('keydown', pageDlKey);
    pageDlPushHist();   // (bei einem ersetzten Blatt bleibt der vorhandene Eintrag)
  }
