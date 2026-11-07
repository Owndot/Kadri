  // ---------- P4c: Download-Knopf direkt am Video, neben „▶ Player“ ----------
  // Ein Tipp auf ⬇ speichert das laufende Video der Seite über die Helfer-App, ohne den Kadri-Player zu öffnen; das Video
  // der Seite läuft dabei unverändert weiter. Derselbe Weg wie im Player:
  //  - Quellen aus der gemeinsamen Registry (mediaRegistry) mit denselben Belegen: Adresse am Element, Stücke GENAU dieses
  //    Streams gerade geladen („läuft gerade, geprüft“), Seitendaten mit Video-ID, Adapter; dazu, was das Element
  //    nachweislich gerade abspielt (currentSrc, kein MSE). Nichts wird geraten, kein versteckter Player.
  //  - dieselbe Auswahl (selectDownloads/selectStreams, nur „attemptable“) und dieselbe Auflösung
  //    (resolveSelection/resolveStream inkl. Bindung, die der Helfer prüft);
  //  - dieselbe zentrale Download-Verwaltung im Hintergrund (start/hlsplan/hlsstart/find/cancel über KADRI_DOWNLOAD):
  //    dort werden auch doppelte Starts zwischen Knopf und Player erkannt.
  // HLS-Stücke werden nie als MP4 gespeichert (mediaDownloadState: Segmente/Listen sind keine MP4-Datei).
  // Lange drücken: Teilen wie bisher; YTDLnis/Teilen bleiben im Menü erreichbar.
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
    if (!ctx) return { mp4: [], hls: [], all: [], allS: [] };
    try { pageDlObservePlaying(v, ctx); } catch (e) {}
    const snap = mediaRegistry.snapshot(ctx);
    const all = selectDownloads(snap, { supported: true }).map((o) => Object.assign({ ctx: ctx }, o));
    const allS = selectStreams(snap, { hls: !!(caps && caps.hls) }).map((o) => Object.assign({ ctx: ctx }, o));
    return { mp4: all.filter((o) => o.state === 'attemptable'), hls: allS.filter((o) => o.state === 'attemptable'), all: all, allS: allS };
  }
  // Warum nichts angeboten wird (feste Texte, ohne Adresse)
  function pageDlReason(o, caps) {
    const rs = o.all.map((x) => x.reason).concat(o.allS.map((x) => x.reason));
    if (rs.indexOf('dash-not-supported') >= 0) return 'DASH-Stream erkannt – speichert die Helfer-App nicht';
    if (o.allS.some((x) => x.reason === 'helper-unavailable') || (!(caps && caps.hls) && o.allS.length)) return 'Stream erkannt – diese Helfer-App-Version speichert keine Streams';
    if (rs.indexOf('protected') >= 0) return 'Video geschützt (DRM/verschlüsselt) – nicht speicherbar';
    if (rs.indexOf('ambiguous') >= 0 || rs.indexOf('not-bound') >= 0) return 'Quelle nicht sicher diesem Video zugeordnet – Video kurz abspielen und erneut tippen';
    if (rs.indexOf('not-standalone') >= 0 || rs.indexOf('stream-not-supported') >= 0) return 'Nur Teilstücke eines Streams erkannt – Video abspielen und erneut tippen';
    return 'Keine speicherbare Videodatei erkannt – Video abspielen und erneut tippen';
  }
  const pageDlHelperText = (kind) => kind === 'unpaired'
    ? 'Helfer-App nicht gekoppelt – in den Kadri-Einstellungen „Helfer koppeln“'
    : kind === 'rejected' ? 'Die Helfer-App erkennt diese Kopplung nicht mehr – neu koppeln'
      : 'Helfer-App nicht erreichbar – App öffnen und erneut tippen';

  // Externe Wege bleiben erreichbar (wie bisher über ⬇ am Video bzw. lange drücken)
  function pageDlExternal(v, items) {
    let link = '';
    try { link = SHOW_DOWNLOAD ? postUrlFor(v) : ''; } catch (e) {}
    if (link) {
      items.push({ label: 'Mit YTDLnis', sub: 'Link an YTDLnis', fn: () => toYtdlnis(link) });
      items.push({ label: 'Link teilen', sub: 'Teilen-Menü', fn: () => shareUrl(link) });
    }
    return items;
  }

  async function onPageDownload() {
    const v = active;
    if (!v) return;
    if (!pageDlHelper()) { onDownload(); return; }   // ohne Helfer-Kanal (Firefox, Userscript): wie bisher
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
      if (o.mp4.length === 1 && !o.hls.length) { await pageDlStartMp4(o.mp4[0]); return; }   // eindeutig: ein Tipp genügt
      if (o.hls.length === 1 && !o.mp4.length) { await pageDlPlan(o.hls[0]); return; }
      const items = [];
      o.mp4.slice(0, 4).forEach((x) => items.push({ label: 'MP4' + (x.height ? ' · ' + x.height + 'p' : ''), sub: tr('Helfer-App · direkt aufs Handy') + ' · ' +
        tr(x.identity === 'played' ? 'diese Wiedergabe' : 'laut Seite, Länge/Inhalt ungeprüft'), fn: () => pageDlStartMp4(x) }));
      o.hls.slice(0, 2).forEach((x) => items.push({ label: 'Stream speichern …', sub: tr('Helfer-App · Qualität und Ton wählen') + ' · ' +
        tr(x.identity === 'played' ? 'diese Wiedergabe' : 'laut Seite, Länge/Inhalt ungeprüft'), fn: () => pageDlPlan(x) }));
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
    if (r && r.ok && r.value && r.value.job) hdlDiagNew(Object.assign(info, { existing: !!r.value.existing }), info.stream ? null : u, r.value.job, local);
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
    if (!r.ok || !r.value || !Array.isArray(r.value.options)) { hdlDiagFailure(info, r); toast((r.error && r.error.message) || 'Stream lässt sich nicht speichern'); return; }
    const p = r.value;
    if (p.job && pageDlActive(p.job)) { hdlDiagNew(Object.assign(info, { existing: true }), null, p.job); pageDl.job = p.job; pageDl.url = sel.url; toast(tr('Läuft schon') + ': ' + pageDlText(p.job)); return; }
    const resume = p.job && p.job.state === 'interrupted' ? p.job : null;
    const go = (opt) => pageDlGo(sel.url, p.planId, opt, resume, x);
    if (p.options.length === 1) { await go(p.options[0]); return; }   // eine Qualität, ein Ton: direkt
    const dur = p.duration > 0 ? fmtTime(p.duration) + ' · ' : '';
    pageDlMenu(resume ? 'Stream fortsetzen' : 'Stream speichern', p.options.slice(0, 12).map((o) => ({
      label: (resume ? tr('Fortsetzen') + ': ' : '') + (o.height ? o.height + 'p' : tr('Qualität unbekannt')) + ' · ' +
        (o.audio === 'muxed' ? tr('Ton im Stream') : tr('Ton') + ': ' + (o.audio.name || o.audio.lang || tr('eigene Spur'))),
      sub: dur + (o.bandwidth ? Math.round(o.bandwidth / 1000) + ' kbit/s' : '') + (o.codecs === 'ok' ? '' : ' · ' + tr('Format wird beim Laden geprüft')),
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

  // Kleines Menü am Knopf (nicht im Player): Einträge mit Unterzeile; Tipp daneben schließt. Das Video läuft weiter.
  let pageDlEl = null;
  function pageDlClose() { if (pageDlEl) { pageDlEl.remove(); pageDlEl = null; } }
  function pageDlMenu(title, items) {
    ui();
    pageDlClose();
    const box = h('div', { class: 'dlm', role: 'menu' });
    box.appendChild(h('div', { class: 'dlh' }, tr(title)));
    items.forEach((it) => {
      const b = h('button', { class: 'dli' + (it.info ? ' info' : ''), role: it.info ? 'note' : 'menuitem' }, tr(it.label));
      if (it.sub) b.appendChild(h('small', {}, tr(it.sub)));
      if (!it.info) b.addEventListener('click', (e) => { e.stopPropagation(); pageDlClose(); try { it.fn(); } catch (err) {} });
      else b.disabled = true;
      box.appendChild(b);
    });
    const close = h('button', { class: 'dli dlx', 'aria-label': 'Schließen' }, tr('Schließen'));
    close.addEventListener('click', (e) => { e.stopPropagation(); pageDlClose(); });
    box.appendChild(close);
    root.appendChild(box);
    // am Knopf ausrichten (unter- oder oberhalb, innerhalb des Bildschirms)
    const pr = pill.getBoundingClientRect();
    const vw = window.innerWidth, vh = window.innerHeight, w = Math.min(320, vw - 16);
    box.style.width = w + 'px';
    box.style.left = Math.max(8, Math.min(vw - w - 8, pr.right - w)) + 'px';
    const below = pr.bottom + 8, hgt = box.offsetHeight || 200;
    box.style.top = (below + hgt < vh - 8 ? below : Math.max(8, pr.top - hgt - 8)) + 'px';
    pageDlEl = box;
    setTimeout(() => document.addEventListener('pointerdown', function out(e) {
      if (!pageDlEl) { document.removeEventListener('pointerdown', out, true); return; }
      if (e.composedPath && e.composedPath().indexOf(pageDlEl) >= 0) return;
      document.removeEventListener('pointerdown', out, true);
      pageDlClose();
    }, true), 0);
  }
