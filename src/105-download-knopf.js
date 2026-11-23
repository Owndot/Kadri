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
  const pageDl = { busy: false, job: null, url: '', rid: '' };
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
  // ---------- S3c: DASH-Streams (gemeinsam für Webseitenknopf und Player) ----------
  // Angebot nur, wenn ALLES zutrifft: das MPD ist an genau dieses Video gebunden (bound, Beleg dash-segments, genau eines –
  // selectDashStreams), Kadri hat es gelesen und daraus Fingerabdruck und S3-Vorprüfung berechnet (src/039: fMP4/H.264 mit
  // AAC-LC, statisch, eine Periode, ohne ContentProtection) und der Helfer meldet die Fähigkeit "dashdl" (caps.dash).
  // Ergebnis: { x, offer } – sonst { reason } (fester Hinweistext) oder null (kein gebundenes DASH-Manifest).
  function dashOfferFor(list, from) {
    // (S3g: je Grund zusätzlich ein fester Code für die anonyme Diagnose – die Entscheidung selbst ist unverändert)
    const bound = (list || []).filter((x) => x.state === 'attemptable' || x.reason === 'helper-unavailable');
    if (!bound.length) return (list || []).some((x) => x.reason === 'protected') ? { reason: 'geschützt (DRM) – nicht speicherbar', code: 'protected' } : null;
    const x = bound[0];
    if (x.reason === 'helper-unavailable') return { reason: 'diese Helfer-App-Version speichert kein DASH', code: 'helper-no-dash' };
    const sel = mediaRegistry.resolveDash(x.ctx, x.sourceId, x.revision);
    if (!sel.ok) return { reason: 'Quelle hat sich geändert – erneut tippen', code: 'source-changed' };
    const offer = dashOfferOf(sel.url, from);
    if (!offer) return { reason: 'Manifest nicht mehr verfügbar – Video kurz abspielen und erneut tippen', code: 'manifest-gone' };
    if (offer.error || !offer.fp) return { reason: 'Manifest nicht prüfbar', code: 'manifest-unchecked' };
    if (!offer.gate || !offer.gate.ok) return { reason: dashGateText(offer.gate && offer.gate.reason), code: dashGateCode(offer.gate && offer.gate.reason) };
    return { x: x, sel: sel, offer: offer };
  }
  const DASH_GATE_CODES = ['dash-live', 'dash-protected', 'dash-multiperiod', 'dash-codec', 'dash-audio-codec', 'dash-no-audio', 'dash-no-video',
    'dash-addressing', 'dash-duration-unknown', 'dash-duration-limit'];
  const dashGateCode = (r) => (DASH_GATE_CODES.indexOf(r) >= 0 ? r : 'dash-unsupported');
  function dashGateText(r) {
    return ({ 'dash-live': 'Live-Stream – nicht speicherbar', 'dash-protected': 'geschützt (DRM) – nicht speicherbar',
      'dash-multiperiod': 'mehrere Abschnitte (Perioden) – nicht unterstützt', 'dash-codec': 'Format nicht unterstützt (nur H.264 mit AAC)',
      'dash-audio-codec': 'Tonformat nicht unterstützt (nur AAC-LC)', 'dash-no-audio': 'ohne Ton – nicht speicherbar',
      'dash-no-video': 'kein Video', 'dash-addressing': 'Stream-Form nicht unterstützt', 'dash-duration-unknown': 'Länge unbekannt – nicht speicherbar',
      'dash-duration-limit': 'zu lang (über 48 h)' })[r] || 'Stream-Form nicht unterstützt';
  }
  // Optionen des Helfers den Darstellungen des eigenen Modells zuordnen: Höhe, Breite, Sprache und Summe der Bandbreiten
  // (Video + Ton) müssen GENAU ein Paar ergeben – sonst ist die Option nicht eindeutig zuordenbar und entfällt. Der Ton wird
  // immer sichtbar benannt (Sprache bzw. „Tonspur n“, wenn es mehrere gibt) – keine stillschweigende Wahl einer Spur.
  function dashOptionItems(plan, gate) {
    const audio = gate.audio;
    const name = (a) => {
      let n = '';
      try { n = a.lang && typeof Intl !== 'undefined' && Intl.DisplayNames ? new Intl.DisplayNames(['de'], { type: 'language' }).of(a.lang) : ''; } catch (e) { n = ''; }
      return n || a.lang || '';
    };
    const audioLabel = (a) => {
      const k = audio.indexOf(a), same = audio.filter((b) => b.lang === a.lang).length;
      if (audio.length === 1) return tr('Ton') + ': ' + (name(a) || tr('Sprache nicht angegeben'));
      return tr('Ton') + ': ' + (name(a) ? name(a) + (same > 1 ? ' · ' + tr('Tonspur') + ' ' + (k + 1) : '') : tr('Tonspur') + ' ' + (k + 1) + ' (' + tr('Sprache nicht angegeben') + ')');
    };
    const out = [];
    plan.options.forEach((o) => {
      const pairs = [];
      gate.video.forEach((v) => audio.forEach((a) => {
        if (v.height === o.height && v.width === o.width && a.lang === o.lang && v.bandwidth + a.bandwidth === o.bandwidth) pairs.push({ v, a });
      }));
      if (pairs.length !== 1) return;
      out.push({ o: o, v: pairs[0].v, a: pairs[0].a, label: (o.height ? o.height + 'p' : tr('Qualität unbekannt')) + ' · ' + audioLabel(pairs[0].a) });
    });
    out.sort((p, q) => Number(q.o.played) - Number(p.o.played) || q.o.height - p.o.height || audio.indexOf(p.a) - audio.indexOf(q.a));
    return out;
  }
  // S3c-Fix: Ist das geplante Angebot noch genau dasselbe? Geprüft nach der (asynchronen) Planantwort und unmittelbar vor
  // dashstart: Player-Kontext und Medien-Epoche gültig, dieselbe Quelle in derselben Revision, weiterhin sicher gebunden
  // (bound + dash-segments) und als EINZIGES MPD (kein konkurrierendes gebunden), dieselbe Adresse und derselbe Fingerabdruck,
  // dieselbe Bindung {player, gen, rev}. Sonst false – der Aufrufer sendet nichts und meldet DASH_CHANGED.
  const DASH_CHANGED = 'Quelle hat sich geändert – erneut auswählen';
  function dashOfferStill(d, bind) {
    if (!d || !d.x || !d.offer || !d.v || !bind) return false;
    let now = null;
    try {
      dashObserveFor(d.v, d.x.ctx);   // inzwischen gebundene MPDs (auch konkurrierende) nachtragen
      const list = selectDashStreams(mediaRegistry.snapshot(d.x.ctx), { dash: true }).map((o) => Object.assign({ ctx: d.x.ctx }, o));
      now = dashOfferFor(list, dashFromOf(d.v));
    } catch (e) { return false; }
    if (!now || !now.offer || now.x.sourceId !== d.x.sourceId || now.x.revision !== d.x.revision) return false;
    if (now.offer.url !== d.offer.url || now.offer.fp !== d.offer.fp) return false;
    // kein anderes MPD inzwischen an dieses Video gebunden oder mit ihm in Konkurrenz (dieselben Stücke beschrieben) – die
    // Registry hält nur Bindungen; eine Konkurrenz zeigt allein die aktuelle Entscheidung (src/060 dashBindingFor)
    try {
      const mine = dashInfo.get(dashUrlKey(new URL(d.offer.url).href)), b = dashBindingFor(d.v);
      if (!mine || b.list.some((e) => e.p !== mine && b.res[e.key] && (b.res[e.key].state === 'bound' || b.res[e.key].reason === 'konkurrenz'))) return false;
    } catch (e) { return false; }
    const sel = mediaRegistry.resolveDash(d.x.ctx, d.x.sourceId, d.x.revision);
    return !!(sel.ok && sel.bind.player === bind.player && sel.bind.gen === bind.gen && sel.bind.rev === bind.rev);
  }
  // played-Hinweis für den Helfer: Nummern der Darstellungen mit beobachteten Stücken (nur Zahlen, ≤ 8)
  const dashPlayedArg = (offer) => (offer.played.length ? offer.played.join(',') : undefined);

  // Auswählbare MP4-Dateien und Streams genau dieses Videos (wie beim Öffnen des Players, ohne ihn zu öffnen)
  function pageDlOptions(v, caps) {
    try { playerSources(v, {}); } catch (e) {}
    const ctx = mediaRegistry.contextFor(v);
    if (!ctx) return { mp4: [], hls: [], all: [], allS: [], dash: '', dashOffer: null };
    try { pageDlObservePlaying(v, ctx); } catch (e) {}
    const snap = mediaRegistry.snapshot(ctx);
    const all = selectDownloads(snap, { supported: true }).map((o) => Object.assign({ ctx: ctx }, o));
    const allS = selectStreams(snap, { hls: !!(caps && caps.hls) }).map((o) => Object.assign({ ctx: ctx }, o));
    // S3c: gebundenes DASH (Stückfolgen seit dem Medienstart dieses Videos nachtragen, dann die strenge Auswahl)
    try { dashObserveFor(v, ctx); } catch (e) {}
    const snap2 = mediaRegistry.snapshot(ctx);
    const allD = selectDashStreams(snap2, { dash: !!(caps && caps.dash) }).map((o) => Object.assign({ ctx: ctx }, o));
    let dashOffer = null;
    try { dashOffer = dashOfferFor(allD, dashFromOf(v)); } catch (e) { dashOffer = null; }
    if (dashOffer && dashOffer.offer) dashOffer.v = v;   // (für die Nachprüfung vor Auswahl und Start)
    // S4b: dieselbe Ebenen-Entscheidung wie Player-Menü und Diagnose (src/046)
    let dashLv = null;
    try { dashLv = dashLevelsFor(v, [snap2], dashCapsOf(caps && 'reachable' in caps ? caps : null), dashOffer); } catch (e) { dashLv = null; }
    return { mp4: all.filter((o) => o.state === 'attemptable'), hls: allS.filter((o) => o.state === 'attemptable'), all: all, allS: allS,
      dash: mediaDashState([snap2]), dashOffer: dashOffer, dashLv: dashLv };
  }
  // Warum nichts angeboten wird (feste Texte, ohne Adresse)
  function pageDlReason(o, caps) {
    const rs = o.all.map((x) => x.reason).concat(o.allS.map((x) => x.reason));
    // S4b: DASH nach Ebenen (src/046) – gebunden oder mit gelesenem MPD vor den allgemeinen Gründen (deren „nicht sicher
    // zugeordnet“ gehört dann oft nur zu Teilen desselben Streams); nur vermutet erst nach allen sicheren Gründen
    const lv = o.dashLv && o.dashLv.first ? o.dashLv : null;
    o.dashWhy = false;
    if (lv && (o.dash === 'bound' || lv.e1.ok)) { o.dashWhy = true; return lv.main; }   // (Grund in der Unterzeile, pageDlReasonSub)
    if (o.allS.some((x) => x.reason === 'helper-unavailable') || (!(caps && caps.hls) && o.allS.length)) return 'Stream erkannt – diese Helfer-App-Version speichert keine Streams';
    if (rs.indexOf('protected') >= 0) return 'Video geschützt (DRM/verschlüsselt) – nicht speicherbar';
    if (rs.indexOf('ambiguous') >= 0 || rs.indexOf('not-bound') >= 0) return 'Quelle nicht sicher diesem Video zugeordnet – Video kurz abspielen und erneut tippen';
    if (rs.indexOf('not-standalone') >= 0 || rs.indexOf('stream-not-supported') >= 0) return 'Nur Teilstücke eines Streams erkannt – Video abspielen und erneut tippen';
    // nur zeitlich vermutet: ehrlich so benennen (nach allen sicheren Gründen, nie als Angebot)
    if (lv) { o.dashWhy = true; return lv.main; }
    return 'Keine speicherbare Videodatei erkannt – Video abspielen und erneut tippen';
  }
  // S3c: Unterzeile zum Hinweis „DASH-Stream erkannt …“: warum nicht angeboten (fester Text, ohne Adresse)
  const pageDlReasonSub = (o) => (o.dashWhy && o.dashLv ? o.dashLv.sub : '');
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

  // ---------- S4b: Ablauf-Kennung je Tipp (Warteblatt, veraltete Antworten und Hinweise) ----------
  // Jeder Tipp, der einen Ablauf startet (⬇, ein Eintrag des Blatts), bekommt eine Kennung. Folge-Auswahl und Hinweise
  // des Ablaufs gelten nur, solange er der aktuelle ist und nicht bewusst abgebrochen wurde (Warteblatt geschlossen,
  // Zeit abgelaufen). Eingebettetes Fenster mit Auswahl im Hauptfenster: die Kennung kommt von dort (fui.rid), und das
  // Hauptfenster entscheidet (src/035).
  const pageDlFlow = { id: '', cancelled: [] };
  const pageDlNewId = () => { try { const a = new Uint8Array(4); crypto.getRandomValues(a); return Array.from(a, (b) => b.toString(16).padStart(2, '0')).join(''); } catch (e) { return ''; } };
  const pageDlRelayed = () => IN_FRAME && !!fui.n && !fui.local;
  const pageDlRid = () => (pageDlRelayed() ? fui.rid : pageDlFlow.id);
  function pageDlFlowStart() { if (!pageDlRelayed()) pageDlFlow.id = pageDlNewId(); return pageDlRid(); }
  const pageDlFlowOk = (id) => pageDlRelayed() || !id || (id === pageDlFlow.id && pageDlFlow.cancelled.indexOf(id) < 0);
  function pageDlFlowCancel(id, why) {
    if (!id) return;
    pageDlFlow.cancelled.push(id); if (pageDlFlow.cancelled.length > 16) pageDlFlow.cancelled.shift();
    fuiLog(id, 'ablauf:abgebrochen', why || '');
    if (!IN_FRAME) fuiTopCancel(id);
  }
  // Folge-Auswahl bzw. Hinweis eines Ablaufs: nur, solange er gilt; ein Ergebnis-Hinweis schließt sein Warteblatt
  const PAGE_DL_PROGRESS = ['Helfer-App prüft den Stream …', 'Helfer-App startet den Download …', 'Helfer-App setzt den Download fort …'];
  function pageDlToastR(msg, rid) {
    const prog = PAGE_DL_PROGRESS.indexOf(msg) >= 0;
    if (pageDlRelayed() && fuiRelay()) { toast(msg, { rid: rid, prog: prog }); return; }   // das Hauptfenster entscheidet
    if (!pageDlFlowOk(rid)) { fuiLog(rid, 'hinweis:veraltet', ''); return; }
    if (!prog) pageDlWaitDone(rid);
    toast(msg);
  }
  async function onPageDownload() {
    const v = active;
    if (!v) return;
    // (Auswahl mit der Kennung des LETZTEN ⬇-Tipps: ein zweiter Tipp, während dieser Ablauf noch läuft, übernimmt ihn –
    // dieselbe Aktion; sonst wäre die Antwort für das Hauptfenster veraltet und der zweite Tipp bliebe ohne Antwort)
    pageDl.rid = pageDlFlowStart();
    const pageDlMenu = (t, it) => pageDlMenuR(t, it, pageDl.rid), toast = (m) => pageDlToastR(m, pageDl.rid);
    if (!pageDlHelper()) {   // ohne Helfer-Kanal (Firefox, Userscript): dieselbe Auswahl, nur die Alternativen
      const ext = pageDlExternal(v, []);
      if (ext.length) pageDlMenu('Speichern', ext); else toast('Kein Link zu diesem Video gefunden – Beitrag öffnen und nochmal versuchen');
      return;
    }
    if (pageDl.busy) { fuiLog(pageDl.rid, 'dl:laeuft-schon', 'kennung-uebernommen'); return; }
    pageDl.busy = true;
    try {
      // laufender Auftrag dieses Videos: Stand und Abbrechen statt eines zweiten Starts
      if (pageDl.job && pageDlActive(pageDl.job)) {
        const s = await helperDl('status', { id: pageDl.job.id });
        if (s && s.ok && s.value && s.value.job) { pageDl.job = s.value.job; hdlDiagUpdate(pageDl.job); }
        if (pageDlActive(pageDl.job)) { pageDlStatusMenu(v, pageDl.rid); return; }
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
          pageDl.job = f.value; pageDl.url = sel.url; pageDlStatusMenu(v, pageDl.rid); return;
        }
      }
      const dashOk = o.dashOffer && o.dashOffer.offer ? o.dashOffer : null;
      const n = o.mp4.length + o.hls.length + (dashOk ? 1 : 0);
      if (!n) { pageDlMenu('Speichern', pageDlExternal(v, [Object.assign({ label: pageDlReason(o, caps), info: true }, pageDlReasonSub(o) ? { sub: pageDlReasonSub(o) } : {})])); return; }
      // Immer zuerst die Auswahl, auch bei nur einer Option (kein Sofortstart). Tatsächlich Geladenes zuerst (MP4 oder Stream); sonst bisherige Reihenfolge (stabile Sortierung)
      // Direkter Download über die Helfer-App: je MP4-Variante ein Eintrag (Qualität in der Unterzeile), Streams mit
      // Qualitäts-/Tonauswahl; kein neuer Tab, keine Navigation
      const items = o.mp4.slice(0, 4).map((x) => ({ loaded: x.loaded, item: { label: 'Mit Helper herunterladen', sub: 'MP4' + (x.height ? ' · ' + x.height + 'p' : '') + ' · ' +
        tr('direkt in die Helfer-App · kein neuer Tab') + ' · ' + tr(hdlEvidenceText(x)), fn: () => pageDlStartMp4(x) } }))
        .concat(o.hls.slice(0, 2).map((x) => ({ loaded: x.loaded, item: { label: 'Stream mit Helper herunterladen …', sub: tr('als MP4 · Qualität und Ton wählen') + ' · ' +
          tr(hdlEvidenceText(x)), fn: () => pageDlPlan(x), wait: true } })))
        // S3c: DASH – erst Plan beim Helfer (er lädt und prüft das MPD selbst, Fingerabdruck), dann Qualität und Ton wählen
        .concat(dashOk ? [{ loaded: true, item: { label: 'DASH-Stream mit Helper herunterladen …', sub: tr('als MP4 · Qualität und Ton wählen') + ' · ' +
          tr('Stücke dieses Streams gerade geladen'), fn: () => pageDlDashPlan(dashOk), wait: true } }] : [])
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
  function pageDlStarted(r, u, info, local, rid) {
    const toast = (m) => pageDlToastR(m, rid);
    if (r && r.ok && r.value && r.value.job) hdlDiagNew(Object.assign(info, { existing: !!r.value.existing }), u, r.value.job, local);
    else hdlDiagFailure(info, r);
    if (!r) { toast('Helfer-App nicht erreichbar'); return; }
    if (!r.ok) { toast((r.error && r.error.message) || 'Helfer-App: Verbindung fehlgeschlagen'); return; }
    pageDl.job = r.value.job; pageDl.url = u;
    toast(r.value.existing ? tr('Läuft schon') + ': ' + pageDlText(r.value.job) : r.value.job.state === 'unconfirmed'
      ? 'Verbindung unterbrochen – Stand wird geprüft' : 'Helfer-App lädt – du kannst die Seite verlassen; Fortschritt in der Benachrichtigung');
  }
  async function pageDlStartMp4(x) {
    const rid = pageDlRid(), toast = (m) => pageDlToastR(m, rid);
    const sel = mediaRegistry.resolveSelection(x.ctx, x.sourceId, x.revision);
    if (!sel.ok) { toast('Die Quelle hat sich geändert – bitte erneut tippen'); return; }
    const v = active;
    const info = Object.assign(hdlSourceInfo(x, pageDlPlaySample(v, sel.url)), { stage: 'start' });
    toast('Helfer-App startet den Download …');
    pageDlStarted(await helperDl('start', { url: sel.url, name: pageDlName() }), sel.url, info,
      info.play ? () => pageDlPlaySample(v, sel.url) : null, rid);
  }
  async function pageDlPlan(x) {
    const rid = pageDlRid(), pageDlMenu = (t, it) => pageDlMenuR(t, it, rid), toast = (m) => pageDlToastR(m, rid);
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
  // S3c: DASH – Plan holen (der Helfer lädt das MPD, vergleicht den Fingerabdruck, prüft das Profil), dann die eindeutig
  // zugeordneten Optionen zeigen; gestartet wird nur per Tipp auf eine Option (dashstart)
  async function pageDlDashPlan(d) {
    const rid = pageDlRid(), t0 = Date.now(), pageDlMenu = (t, it) => pageDlMenuR(t, it, rid), toast = (m) => pageDlToastR(m, rid);
    fuiLog(rid, 'plan:start', '');
    const sel = mediaRegistry.resolveDash(d.x.ctx, d.x.sourceId, d.x.revision);
    if (!sel.ok) { fuiLog(rid, 'plan:ende', 'quelle-geaendert'); toast('Die Quelle hat sich geändert – bitte erneut tippen'); return; }
    const info = Object.assign(hdlSourceInfo(d.x), { stream: true, dash: true, stage: 'dashplan' });
    toast('Helfer-App prüft den Stream …');
    fuiLog(rid, 'plan:helfer-send', '');
    const r = await helperDl('dashplan', Object.assign({ url: d.offer.url, fp: d.offer.fp, bind: sel.bind }, dashPlayedArg(d.offer) ? { played: dashPlayedArg(d.offer) } : {}));
    fuiLog(rid, 'plan:helfer-antwort', (!r ? 'keine' : r.ok && r.value && Array.isArray(r.value.options) ? 'ok:' + r.value.options.length : 'fehler:' + hdlDiagCode(r.error && (r.error.reason || r.error.kind))) + ' ms=' + (Date.now() - t0));
    if (!r) { hdlDiagFailure(info, r); toast('Helfer-App nicht erreichbar'); return; }
    if (!r.ok || !r.value || !Array.isArray(r.value.options)) { hdlDiagFailure(info, r); toast((r.error && r.error.message) || 'Stream lässt sich nicht speichern'); return; }
    const p = r.value;
    if (p.job && pageDlActive(p.job)) { fuiLog(rid, 'plan:ende', 'laeuft-schon'); hdlDiagNew(Object.assign(info, { existing: true }), null, p.job); pageDl.job = p.job; pageDl.url = d.offer.url; toast(tr('Läuft schon') + ': ' + pageDlText(p.job)); return; }
    if (!dashOfferStill(d, sel.bind)) { fuiLog(rid, 'plan:ende', 'nicht-mehr-aktuell'); toast(DASH_CHANGED); return; }   // Quelle während des Plans gewechselt: keine Auswahl
    const items = dashOptionItems(p, d.offer.gate);
    fuiLog(rid, 'plan:optionen', 'n=' + items.length);
    if (!items.length) { hdlDiagFailure(info, { ok: false, error: { kind: 'plan', reason: 'ambiguous' } }); toast('Auswahl nicht eindeutig zuordenbar – nicht angeboten'); return; }
    const dur = p.duration > 0 ? fmtTime(p.duration) : '';
    pageDlMenu('DASH-Stream speichern', items.slice(0, 12).map((it) => ({
      label: it.label,
      sub: [it.o.played ? tr('läuft gerade') : '', dur, it.o.bandwidth ? Math.round(it.o.bandwidth / 1000) + ' kbit/s' : '', 'H.264 + AAC'].filter(Boolean).join(' · '),
      fn: () => pageDlDashGo(d.offer.url, p.planId, it.o, d.x, d, sel.bind) })));
  }
  async function pageDlDashGo(u, planId, o, x, d, bind) {
    const rid = pageDlRid(), toast = (m) => pageDlToastR(m, rid);
    if (!dashOfferStill(d, bind)) { toast(DASH_CHANGED); return; }   // unmittelbar vor dashstart erneut: sonst nichts senden
    const info = Object.assign(hdlSourceInfo(x), { stream: true, dash: true, planned: true, stage: 'dashstart' });
    toast('Helfer-App startet den Download …');
    pageDlStarted(await helperDl('dashstart', { planId: planId, option: o.id, name: pageDlName() }), u, info, null, rid);
  }
  async function pageDlGo(u, planId, o, resume, x) {
    const rid = pageDlRid(), toast = (m) => pageDlToastR(m, rid);
    const info = Object.assign(hdlSourceInfo(x), { stream: true, planned: true, stage: resume ? 'hlsresume' : 'hlsstart' });
    toast(resume ? 'Helfer-App setzt den Download fort …' : 'Helfer-App startet den Download …');
    const r = await helperDl(resume ? 'hlsresume' : 'hlsstart', resume ? { id: resume.id, planId: planId, option: o.id } : { planId: planId, option: o.id, name: pageDlName() });
    pageDlStarted(r, u, info, null, rid);
  }
  function pageDlStatusMenu(v, rid) {
    const j = pageDl.job;
    const items = [{ label: 'Helfer-App: ' + tr(j.label), sub: j.progress || 'Stand wird abgefragt', info: true }];
    if (j.state !== 'cancelling') items.push({ label: 'Download abbrechen', sub: 'Helfer-App hört sofort auf und löscht die Teil-Datei', fn: async () => {
      const crid = pageDlRid(), toast = (m) => pageDlToastR(m, crid);
      const r = await helperDl('cancel', { id: j.id });
      if (!r || !r.ok) { toast((r && r.error && r.error.message) || 'Helfer-App nicht erreichbar'); return; }
      pageDl.job = r.value.job;
      toast(r.value.reachable ? pageDlText(r.value.job) : 'Helfer-App nicht erreichbar – Abbruch wird nachgeholt');
    } });
    pageDlMenuR('Speichern', pageDlExternal(v, items), rid);
  }
  function pageDlMenuR(title, items, rid) {
    if (!pageDlFlowOk(rid)) { fuiLog(rid, 'blatt:veraltet', ''); return; }   // abgelöster oder abgebrochener Ablauf
    pageDlMenu(title, items, false, rid);
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
  let pageDlSR = false;         // Scroll-Wiederherstellung des Seiteneintrags für die Dauer des eigenen Eintrags ausgesetzt
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
    // Rückkehr auf den Seiteneintrag (eigenes Zurück oder Zurück-Taste) darf die Seite nicht scrollen: manche Chromium-
    // Fassungen (z. B. 141) stellen sonst den Stand vom Öffnen wieder her – die Seite springt, und das Scrollen blendet
    // ⬇ kurz aus. Nur bei "auto" der Seite: für den Seiteneintrag vorübergehend "manual", der eigene Eintrag bleibt "auto".
    let sr = '';
    try { sr = history.scrollRestoration; if (sr === 'auto') history.scrollRestoration = 'manual'; } catch (e) { sr = ''; }
    try { history.pushState(Object.assign({}, st || {}, { __kadriDlSheet: tok }), '', location.href); pageDlHist = tok; } catch (e) {}
    if (sr !== 'auto') return;
    if (pageDlHist === tok) { try { history.scrollRestoration = 'auto'; } catch (e) {} pageDlSR = true; }
    else { try { history.scrollRestoration = 'auto'; } catch (e) {} }   // kein Eintrag entstanden: Seite unverändert
  }
  // Wieder auf dem Seiteneintrag (kein eigener Eintrag mehr aktuell): dessen Scroll-Wiederherstellung zurück auf "auto".
  // Erst nach dem Zurück, nicht in popstate selbst – die Wiederherstellung des Browsers folgt erst danach.
  function pageDlSRRestore() {
    if (!pageDlSR || pageDlHistTok()) return;
    pageDlSR = false;
    setTimeout(() => { try { if (!pageDlHistTok() && history.scrollRestoration === 'manual') history.scrollRestoration = 'auto'; } catch (e) {} }, 0);
  }
  // das eigene Zurück ist angewendet (der verlassene Eintrag ist nicht mehr der aktuelle): erst jetzt neu eintragen
  function pageDlBackSettled() {
    pageDlBack = ''; clearTimeout(pageDlBackTimer); pageDlBackTimer = 0;
    pageDlSRRestore();
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
  // S4b: Warteblatt – nach einem Eintrag mit Folge-Auswahl (Plan) bleibt das Blatt offen („Helfer-App prüft …“), bis die
  // Auswahl oder ein Ergebnis kommt. Bewusst geschlossen (Schließen, Hintergrund, Escape, Zurück) oder nach Ablauf der Frist
  // ist der Ablauf abgebrochen: spätere Auswahl und Hinweise dazu werden verworfen (oben und über das Fenster-Relay).
  const PAGE_DL_WAIT = 45000;   // = FUI_MENU_WAIT (src/035): Planung beim Helfer 25 s + Warteschlange
  const PAGE_DL_BEWUSST = ['schliessen', 'hintergrund', 'escape', 'popstate'];
  function pageDlWaitOn(ov, box, id) {
    ov.waitId = id;
    box.classList.add('wait');
    box.querySelectorAll('.dli:not(.dlx)').forEach((b) => { b.disabled = true; });
    const w = h('div', { class: 'dlw', role: 'status' }, tr('Helfer-App prüft … – Auswahl erscheint gleich hier'));
    const list = box.querySelector('.dll');
    if (list) box.insertBefore(w, list); else box.appendChild(w);
    fuiLog(id, 'blatt:wartet', '');
    ov.waitT = setTimeout(() => {
      if (pageDlEl !== ov || ov.waitId !== id) return;
      pageDlFlowCancel(id, 'zeit');
      pageDlClose(false, 'zeit');
      toast('Keine Antwort der Helfer-App – nichts gestartet. Bitte erneut tippen');
    }, PAGE_DL_WAIT);
  }
  function pageDlWaitDone(id) { if (id && pageDlEl && pageDlEl.waitId === id) pageDlClose(false, 'ergebnis'); }
  function pageDlClose(fromBack, why) {
    if (!pageDlEl) return;
    fuiLog(pageDlEl.waitId || '', 'blatt:zu', (fromBack ? 'zurueck' : 'selbst') + (why ? ' ' + why : '') + ' hist=' + (pageDlHist ? 'eigen' : '-'));
    if (pageDlEl.waitT) clearTimeout(pageDlEl.waitT);
    if (pageDlEl.waitId && PAGE_DL_BEWUSST.indexOf(why) >= 0) pageDlFlowCancel(pageDlEl.waitId, why);
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
  function pageDlKey(e) { if (e.key === 'Escape' && pageDlEl) { e.preventDefault(); pageDlClose(false, 'escape'); } }
  addEventListener('popstate', () => {
    const tok = pageDlHistTok();
    if (pageDlEl || pageDlBack) fuiLog('', 'blatt:popstate', (pageDlBack ? 'eigenes-zurueck ' : '') + 'eintrag=' + (tok ? (tok === pageDlHist ? 'eigen' : tok === pageDlBack ? 'alt' : 'fremd-kadri') : 'seite'));
    if (pageDlBack) {                       // das eigene Zurück – nie ein Grund, ein (neues) Blatt zu schließen
      if (tok !== pageDlBack) pageDlBackSettled();
      return;
    }
    // Zurück-Taste: der eigene Eintrag des offenen Blatts ist nicht mehr der aktuelle
    if (pageDlEl && pageDlHist && tok !== pageDlHist) { pageDlHist = ''; pageDlClose(true, 'popstate'); }
    pageDlSRRestore();
  });
  // rid (nur eingebettetes Fenster): Kennung des Tipps, zu dem der aufrufende Ablauf gehört (src/035 fuiFrameMenu)
  function pageDlMenu(title, items, here, rid) {
    // eingebettetes Fenster, Knopf im Hauptfenster: die Auswahl erscheint dort (Aktionen bleiben hier, src/035)
    if (!here && IN_FRAME && fuiRelay()) { fuiFrameMenu(title, items, rid); return; }
    if (IN_FRAME && fui.n) fuiLog(fui.rid, 'frame:menu-lokal', here ? 'ausdruecklich' : vp ? 'player-offen' : fui.local ? 'lokal' : 'relay-abgelaufen');
    ui();
    // ein neues Blatt ersetzt das offene (z. B. Qualität/Ton nach „Stream …“) – der Verlaufseintrag bleibt, die
    // visualViewport-Listener des alten Blatts werden entfernt
    if (pageDlEl) { if (pageDlEl.waitT) clearTimeout(pageDlEl.waitT); pageDlEl.remove(); pageDlEl = null; }   // (Warteblatt: ersetzt, kein Abbruch)
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
        // eigener Eintrag: neuer Ablauf mit eigener Kennung; Eintrag aus dem Fenster-Relay: dessen Kennung (fuiTopPick)
        const fid = it.relay ? '' : pageDlFlowStart();
        let ret;
        try { ret = it.fn(); } catch (err) {}
        if (pageDlEl !== ov) return;   // die Aktion hat schon ein neues Blatt geöffnet
        const wid = it.relay ? (typeof ret === 'string' ? ret : '') : fid;
        if (it.wait && wid) pageDlWaitOn(ov, box, wid);
        else pageDlClose(false, 'nach-aktion');   // keine Folge-Auswahl: jetzt schließen
      });
      else b.disabled = true;
      list.appendChild(b);
    });
    const close = h('button', { class: 'dli dlx', 'aria-label': 'Schließen' }, tr('Schließen'));
    close.addEventListener('click', (e) => { e.stopPropagation(); if (pageDlEl === ov) pageDlClose(false, 'schliessen'); });
    box.appendChild(close);
    ov.appendChild(box);
    // Tipp auf den Hintergrund (nicht ins Blatt) schließt; click statt pointerdown – ein Wisch zum Scrollen ist kein Tipp
    ov.addEventListener('click', (e) => { e.stopPropagation(); if (e.target === ov && pageDlEl === ov) pageDlClose(false, 'hintergrund'); });
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
    fuiLog('', 'blatt:auf', 'n=' + items.length + ' hist=' + (pageDlHist ? 'eigen' : pageDlWantHist ? 'wartet' : '-') + (pageDlBack ? ' zurueck-unterwegs' : ''));
  }
