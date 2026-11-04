    // ----- Bedienelemente -----
    // Play nach dem Ende: Sprung an den Anfang ist dann gewollt (nicht als Schleife werten)
    function togglePlay() { const m = M(); if (m.paused) { if (st.heldAtEnd(m)) { try { m.currentTime = 0; } catch (e) {} }   // am Ende angehalten: von vorn
        st.endHold = false; st.userSeekAt = Date.now(); m.play().catch(() => {}); } else { st.userPauseAt = Date.now(); m.pause(); } showControls(); }
    function seekBy(d) {
      const m = M();
      const max = isFinite(m.duration) ? m.duration - 0.5 : m.currentTime + d;
      st.userSeekAt = Date.now();
      try { m.currentTime = clamp(m.currentTime + d, 0, max); } catch (e) {}
      updateUI();
    }
    const SPEEDS = [1, 1.25, 1.5, 2, 0.5, 0.75];
    const AUTO_OVER = 0.14;   // so weit unter 0 % weiterwischen = Auto (dazwischen bleibt es ganz dunkel)
    // Nur wenn ausdrücklich gewünscht (Einstellung autoRotate): Querformat-Videos automatisch drehen
    function autoOrient(w, hgt) {
      if (!CONFIG.autoRotate || !w || !hgt || !isFs()) return;
      st.orient = w > hgt ? 'landscape' : 'portrait';
      lockO(st.orient);
    }
    // Eingebettetes Fenster: Vollbild und Drehen erledigt die Hauptseite für uns (siehe "Eingebettete Fenster")
    function isFs() { return !!(document.fullscreenElement || document.webkitFullscreenElement || (st.framed && st.rfs)); }
    function lockO(o) {
      if (st.framed) { fpost(window.parent, { t: 'orient', o: o || '' }); return; }
      try {
        if (o) screen.orientation.lock(o).catch(() => {});
        else if (screen.orientation && screen.orientation.unlock) screen.orientation.unlock();
      } catch (e) {}
    }
    // Echter Vollbildmodus (dabei zeigt der Browser seinen Hinweis "Zum Beenden…" – nur auf Wunsch)
    function enterFs() {
      if (st.framed) {
        return new Promise((res) => {
          const done = () => { if (st.fsWait === done) st.fsWait = null; clearTimeout(tm); st.wasFs = isFs(); res(); };
          st.fsWait = done;
          fpost(window.parent, { t: 'take', fs: true });
          // Hauptseite antwortet nicht (Skript dort aus)? Dann wie bisher selbst versuchen – der Tipp gilt noch
          const tm = setTimeout(() => {
            if (st.fsWait !== done) return;
            st.fsWait = null;
            if (!fb.ack) { st.framed = false; enterFs().then(res); } else { st.wasFs = isFs(); res(); }
          }, 700);
        });
      }
      try {
        const rq = wrap.requestFullscreen || wrap.webkitRequestFullscreen;
        const pr = rq && rq.call(wrap, { navigationUI: 'hide' });
        if (pr && pr.then) return pr.then(() => { st.wasFs = true; }, () => { st.wasFs = false; });
        if (rq) st.wasFs = true;
      } catch (e) {}
      return Promise.resolve();
    }
    function exitFs() {
      lockO('');
      if (st.framed) fpost(window.parent, { t: 'exitfs' });
      try { if (document.fullscreenElement && document.exitFullscreen) document.exitFullscreen().catch(() => {}); } catch (e) {}
      st.orient = '';
    }
    const stop = (e) => { e.stopPropagation(); };
    // Vollbild verloren (z. B. durch Drehen)? Beim nächsten Tipp zurückholen – nur mit Tipp erlaubt der Browser das
    function regainFs() {
      if (!CONFIG.startFullscreen || isFs() || vp !== st) return;
      enterFs().then(() => {
        if (!isFs()) return;
        st.fsStart = true;
        st.fsLost = false;
        if (st.orient) lockO(st.orient);
      });
    }
    // (Bild-in-Bild holt das Vollbild NICHT zurück – das würde den Tipp "verbrauchen", den Bild-in-Bild braucht)
    const on = (el, fn) => { if (el) el.addEventListener('click', (e) => { stop(e); if (el !== bClose && el !== bRot && el !== bPip && el !== bDl) regainFs(); fn(); showControls(); }); };
    on(bClose, () => closePlayer());
    on(bPlay, togglePlay);
    const btnSkip = (dir) => {
      const now = Date.now();
      seekBy(dir * SKIP());
      if (st.skipRun && st.skipRun.zone === dir && now < st.skipRun.until) st.skipRun.total += SKIP();
      else st.skipRun = { zone: dir, total: SKIP() };
      st.skipRun.until = now + 650;
      showSkipFx(dir, st.skipRun.total);
    };
    on(bBack, () => btnSkip(-1));
    on(bFwd, () => btnSkip(1));
    const spLabel = (v) => String(v).replace('.', UI_EN() ? '.' : ',') + '×';
    const setSpeed = (v) => { st.speed = v; M().playbackRate = v; bSpeed.textContent = spLabel(v); };
    on(bSpeed, () => setSpeed(SPEEDS[(SPEEDS.indexOf(st.speed) + 1) % SPEEDS.length]));   // unsichtbar – nur für alte Wege
    // Tempo im ⋮-Menü: Liste zum Antippen (wie YouTube), langsam → schnell
    const openSpeed = () => openMenu('Geschwindigkeit', SPEEDS.slice().sort((a, b) => a - b).map((v) => ({
      label: v === 1 ? spLabel(1) + ' · Normal' : spLabel(v), cur: v === st.speed, fn: () => { setSpeed(v); toast(spLabel(v)); },
    })), false, openMore);
    // Bild-in-Bild: kleines Fenster über anderen Apps. Dabei endet das Vollbild – das darf den Player NICHT schließen.
    const pipFallback = () => {
      // Manche Android-Browser kennen nur das automatische Bild-in-Bild: Video im Vollbild + zum Startbildschirm wischen
      const hint = () => toast('Zum Startbildschirm wischen – das Video läuft im kleinen Fenster weiter (Bild-in-Bild für den Browser in den Android-Einstellungen erlauben)');
      if (isFs()) { hint(); return; }
      enterFs().then(() => { if (isFs()) { st.fsStart = true; hint(); } else toast('Bild-in-Bild ist hier nicht möglich'); });
    };
    // Bild-in-Bild nur, wo es zuverlässig läuft: NICHT beim Spiegeln und nicht auf Facebook/Instagram/Threads –
    // dort hält die Seite ihr Video im Hintergrund an, das kleine Fenster stünde still. Dann gibt es weder den
    // Knopf noch das automatische kleine Fenster beim Wischen zum Startbildschirm (auch nicht für das Seitenvideo).
    // (Kadri: im EIGENEN Player auch auf Facebook/Instagram – die Seite kann ihn dort nicht anhalten)
    st.pipOk = !!bPip && (!META || IS_KADRI);
    function setPipAllowed(ok) {
      ok = !!ok && !!bPip && (!META || IS_KADRI);
      st.pipOk = ok;
      try { vid.disablePictureInPicture = !ok; } catch (e) {}
      if (bPip) bPip.style.display = ok ? '' : 'none';
      if (ok) return;
      if (st.origNoPip === undefined) {
        st.origNoPip = !!orig.disablePictureInPicture;
        st.cleanup.push(() => { try { orig.disablePictureInPicture = st.origNoPip; } catch (e) {} });
      }
      try { orig.disablePictureInPicture = true; } catch (e) {}
      if (pipIsOurs(vid)) { try { document.exitPictureInPicture().catch(() => {}); } catch (e) {} }
    }
    st.setPipAllowed = setPipAllowed;
    on(bPip, () => {
      if (!st.pipOk) return;
      if (pipIsOurs(vid)) { document.exitPictureInPicture().catch(() => {}); return; }
      st.pipAt = Date.now();
      let pr;
      try { vid.disablePictureInPicture = false; pr = vid.requestPictureInPicture(); } catch (e) { pr = Promise.reject(e); }
      Promise.resolve(pr).then(() => { st.pipAt = Date.now(); }, () => { st.pipAt = 0; pipFallback(); });
    });
    const onPipEnter = () => { st.pipAt = Date.now(); st.fsStart = false; };
    const onPipLeave = () => { st.pipAt = Date.now(); };
    vid.addEventListener('enterpictureinpicture', onPipEnter);
    vid.addEventListener('leavepictureinpicture', onPipLeave);
    // Herunterladen: Teilen-Menü öffnen (z. B. YTDLnis) – der Player bleibt offen
    // Läuft eine echte Videodatei (MP4/WebM, kein Stream)? Dann lässt sie sich direkt speichern.
    const directUrl = () => (st.mode === 'own' && !st.hls && st.cur && /^https?:/i.test(st.cur) && !PLAYLIST_RE.test(st.cur) && !/\.mpd(\?|#|$)/i.test(st.cur)) ? st.cur : '';
    // Download und Teilen nur zeigen, wenn sie für DIESES Video auch funktionieren:
    // Download = Datei zum Speichern oder ein Link genau dieses Videos für YTDLnis (dazu ggf. die Helfer-App, hdlProbe)
    // Teilen   = eine Adresse, die eine andere App abspielen kann
    st.refreshDl = () => {
      let link = '';
      try { link = SHOW_DOWNLOAD ? postUrlFor(orig) : ''; } catch (e) {}
      bDl.hidden = !(directUrl() || link || hdlShown());
      hdlProbe();
      if (bExt) bExt.hidden = !((st.mode === 'own' && st.cur) || st.igUrl || st.ttUrl);
    };
    // ---------- Helfer-App: direkte MP4-Downloads (Phase C3) ----------
    // Nur MP4-Dateien, die der Player selbst direkt abspielt (directUrl, kein Stream, kein blob:). Erst ein Tipp auf
    // „Mit der Helfer-App speichern“ startet; der Helfer lädt die Datei ohne Cookies, Referer oder Sitzung des Browsers
    // über den verschlüsselten Kanal. Verlangt der Server eine Anmeldung, scheitert es mit Hinweis – kein anderer Weg.
    // Der Auftrag liegt im Hintergrund (überdauert Browser- und Helfer-Neustart); der Player fragt nur nach dem Stand,
    // solange er offen und sichtbar ist.
    const hdlUrl = () => {
      const d = directUrl();
      // st.cur ist beim Öffnen zunächst nur ein Kandidat. Das sichtbare Bild kann noch vom Seitenplayer kommen.
      // Erst die tatsächlich geladene eigene Quelle freigeben; auch bei Qualitätswechseln keine alte Datei nehmen.
      if (!d || vid.readyState < 2 || vid.error || vid.srcObject) return '';
      try { if (vid.currentSrc !== new URL(d).href) return ''; } catch (e) { return ''; }
      return !/\.(webm|ogv|ogg|mkv|mov|avi)(\?|#|$)/i.test(d) ? d : '';
    };
    st.hdl = { ok: false, checked: '', pending: null, gen: 0, job: null, url: '', busy: false, timer: 0 };
    // ---------- Downloadauswahl aus dem gemeinsamen Quellenbestand (P2) ----------
    // Angeboten wird jede MP4, die nach den Belegen eigenständig, an dieses Video gebunden und auswählbar ist – unabhängig
    // davon, was der Player gerade spielt (HLS läuft weiter, nichts wird umgeschaltet). Zwei Herkünfte: (1) die vom eigenen
    // Player tatsächlich geladene Datei (Kontext des eigenen Videoelements; jeder Quellwechsel = neue Epoche), (2) beim
    // Öffnen und im Menü beobachtete Quellen des Originalvideos (Kontext vom Öffnen: wechselt die Seite das Medium, ist er
    // veraltet und davon wird nichts mehr angeboten). Das Menü startet nichts und ruft keine Medien ab; erst der Tipp auf
    // einen Eintrag startet genau einen Auftrag. Der Helfer prüft den Abruf selbst (Netz, Status, Länge, Typ, Signatur).
    if (!st.media) st.media = { orig: null, own: null };
    function hdlOwnObserve() {
      const u = hdlUrl();
      if (!u) return '';
      const c = mediaRegistry.contextFor(vid);
      st.media.own = c;
      const h = Math.min(vid.videoWidth || 0, vid.videoHeight || 0);
      const r = mediaRegistry.observe(c, Object.assign({ url: u, provenance: { kind: 'player', origin: 'own-player' },
        association: { state: 'bound', evidence: ['own-player-loaded'] }, browser: 'loaded' },
        h > 0 ? { quality: { status: 'observed', value: { height: h }, evidenceIds: ['decoded-frame'] } } : {}));
      return r.ok ? r.sourceId : '';
    }
    function hdlOptions(refresh) {
      const caps = { supported: true }, out = [];
      const own = hdlOwnObserve();
      if (own && st.media.own) selectDownloads(mediaRegistry.snapshot(st.media.own), caps).forEach((o) => { if (o.sourceId === own) out.push(Object.assign({ ctx: st.media.own }, o)); });
      if (st.media.orig) {
        if (refresh) mediaObserveLight(orig, st.media.orig);
        const dup = hdlUrl() ? mediaRegistry.idOf(st.media.orig, hdlUrl()) : '';
        selectDownloads(mediaRegistry.snapshot(st.media.orig), caps).forEach((o) => { if (o.sourceId !== dup) out.push(Object.assign({ ctx: st.media.orig }, o)); });
      }
      return out;
    }
    const hdlAttemptable = (refresh) => hdlOptions(refresh).filter((o) => o.state === 'attemptable');
    // Adresse, für die geprüft wird (caps/find): die geladene eigene Datei, sonst die erste auswählbare Alternative
    function hdlPrimary() {
      const u = hdlUrl();
      if (u) return u;
      const o = hdlAttemptable(false)[0];
      if (!o) return '';
      const r = mediaRegistry.resolveSelection(o.ctx, o.sourceId, o.revision);
      return r.ok ? r.url : '';
    }
    const hdlShown = () => !!(st.hdl.ok && hdlAttemptable(false).length);
    // Gehört der laufende Auftrag zu diesem Player (eine seiner bekannten Quellen)?
    const hdlJobHere = () => !!st.hdl.url && (st.hdl.url === hdlUrl() || !!(st.media.orig && mediaRegistry.idOf(st.media.orig, st.hdl.url)) ||
      !!(st.media.own && mediaRegistry.idOf(st.media.own, st.hdl.url)));
    const hdlActive = (j) => !!j && ['starting', 'unconfirmed', 'running', 'cancelling'].indexOf(j.state) >= 0;
    const hdlText = (j) => tr(j.label) + (j.progress ? ' · ' + j.progress : '');
    // Diagnose der Helfer-Downloads: Zustand liegt seitenweit in 080 (hdlDiags), hier nur die Angaben zur Quelle (ohne Adresse)
    // Angaben zur Quelle beim Tipp festhalten (danach kann der Player schon zu sein)
    function hdlDiagInfo(o) {
      let e = null;
      try { e = mediaRegistry.snapshot(o.ctx).find((x) => x.sourceId === o.sourceId) || null; } catch (x) {}
      const first = e && e.provenance && e.provenance[0];
      return {
        origin: e ? e.provenance.map((p) => p.kind + '/' + p.origin).join('+') : '?',
        binding: e && e.association ? e.association.state + ':' + e.association.evidence.join(',') : '?',
        kind: e ? e.kind : '?', role: e ? e.role : '?',
        height: e && e.quality && e.quality.status !== 'unknown' && e.quality.value ? e.quality.value.height || 0 : 0,
        ageSec: first && first.observedAt ? Math.round((Date.now() - first.observedAt) / 1000) : -1,
        loaded: !!(e && e.browser === 'loaded'),
      };
    }
    st.hdlDiagText = () => hdlDiagText(hdlDiags[0]);
    hdlDiagChanged = () => { if (vp === st) { try { bDl.dataset.hdlDiag = st.hdlDiagText(); } catch (e) {} } };
    st.cleanup.push(() => { if (vp === st) hdlDiagChanged = null; });
    function hdlSet(j, quiet) {
      const before = st.hdl.job;
      st.hdl.job = j || null;
      if (j) hdlDiagUpdate(j);
      bDl.classList.toggle('on', hdlActive(j));
      if (!quiet && j && before && before.id === j.id && before.state !== j.state && !hdlActive(j)) toast(j.label);
      if (menuOpen() && st.hdl.menu) dlMenu(false, true);   // offenes Menü zeigt den Stand live
      if (hdlActive(j)) hdlWatch(); else hdlStop();
    }
    function hdlStop() { clearTimeout(st.hdl.timer); st.hdl.timer = 0; }
    // Stand abfragen: alle 1,5 s, nur solange der Player offen und die Seite sichtbar ist (Android: Tab im
    // Hintergrund → keine Abfragen; beim Zurückkommen geht es weiter, der Helfer lädt unabhängig davon).
    function hdlWatch() {
      if (st.hdl.timer) return;
      st.hdl.timer = setTimeout(function tick() {
        st.hdl.timer = 0;
        const j = st.hdl.job;
        if (vp !== st || !hdlActive(j)) return;
        if (document.hidden) { st.hdl.timer = setTimeout(tick, 1500); return; }
        helperDl('status', { id: j.id }).then((r) => {
          if (vp !== st || !st.hdl.job || st.hdl.job.id !== j.id) return;
          if (r && r.ok && r.value && r.value.job) { hdlSet(r.value.job); if (!r.value.reachable) hdlWatch(); }
          else hdlWatch();
        });
      }, 1500);
    }
    const onHdlVis = () => { if (!document.hidden && hdlActive(st.hdl.job)) { hdlStop(); hdlWatch(); } };
    onVisChange(onHdlVis);
    st.cleanup.push(() => { hdlStop(); offVisChange(onHdlVis); });
    // Kann der gekoppelte Helfer das? Und läuft für diese Datei schon ein Auftrag (z. B. nach Neustart des Browsers)?
    // Drei getrennte Dinge: pending = die laufende Prüfung (Adresse + Generation), checked = die Adresse, für die
    // caps und find vollständig beantwortet sind, gen = Zähler. Eine veraltete Antwort (anderer Player, neuere
    // Prüfung, Quelle inzwischen ungeeignet oder eine andere) wird verworfen, OHNE die spätere Prüfung derselben
    // Adresse zu sperren. Neu geprüft wird nur auf einen Anlass (Laden, Sprung fertig, Quellwechsel) – keine
    // Schleife, keine Wiederholung von selbst und kein Medienabruf (caps/find fragen nur den Helfer).
    // Zustand der Prüfung am Download-Knopf (im geschlossenen Shadow-DOM; nur Zustand und Zähler, nie eine Adresse) –
    // für die Diagnose der Tests, wenn ein erwarteter Eintrag fehlt.
    const hdlMark = (s) => { try { bDl.dataset.hdl = s; bDl.dataset.hdlGen = String(st.hdl.gen); } catch (e) {} };
    function hdlProbe() {
      if (typeof KADRI_DOWNLOAD !== 'function') return;   // (Firefox/Userscript: kein Kanal zur Helfer-App)
      const u = hdlPrimary();
      if (!u || st.hdl.checked === u || (st.hdl.pending && st.hdl.pending.u === u)) return;
      const gen = ++st.hdl.gen;
      st.hdl.pending = { u, gen };
      hdlMark('pending');
      const current = () => vp === st && !!st.hdl.pending && st.hdl.pending.gen === gen;
      const drop = (why) => { st.hdl.pending = null; hdlMark(why); };
      helperDl('caps').then((r) => {
        if (!current()) return;
        if (hdlPrimary() !== u) { drop('stale'); hdlProbe(); return; }   // (eine jetzt geeignete andere Quelle gleich prüfen)
        const v = r && r.ok && r.value;
        st.hdl.ok = !!(v && v.supported);
        if (!(v && v.reachable)) { drop('unreachable'); return; }   // vorübergehend: ein späterer Anlass prüft erneut
        if (!st.hdl.ok) { st.hdl.checked = u; drop('unsupported'); return; }
        hdlMark('find');
        st.refreshDl();
        helperDl('find', { url: u }).then((f) => {
          if (!current()) return;
          if (hdlPrimary() !== u) { drop('stale'); hdlProbe(); return; }
          if (!(f && f.ok)) { drop('unreachable'); return; }
          st.hdl.checked = u; st.hdl.url = u; drop('ok');
          // laufender Auftrag zu dieser Datei (z. B. nach Neuöffnen des Players): Diagnose auch dafür, Quelle unbekannt
          if (f.value && hdlActive(f.value) && !hdlDiagFor(f.value.id)) hdlDiagNew({ origin: '?', binding: '?', ageSec: -1, existing: true }, u, f.value);
          hdlSet(f.value && hdlActive(f.value) ? f.value : null, true);
        });
      });
    }
    // Start nach Tipp. Doppelte Tipps: solange ein Start läuft, nichts; dieselbe Datei im Hintergrund → derselbe Auftrag.
    function hdlStart(o) {
      if (!o || st.hdl.busy) return;
      // Nur die aktuell gebundene, unveränderte Quelle dieses Players (Revision/Epoche/Dokument geprüft)
      const sel = mediaRegistry.resolveSelection(o.ctx, o.sourceId, o.revision);
      if (!sel.ok) { toast('Die Quelle hat sich geändert – bitte erneut auswählen'); return; }
      const u = sel.url;
      if (hdlActive(st.hdl.job) && st.hdl.url === u) { toast(hdlText(st.hdl.job)); return; }
      st.hdl.busy = true;
      toast('Helfer-App startet den Download …');
      const info = hdlDiagInfo(o);
      helperDl('start', { url: u, name: (pageTitle() || 'Video').slice(0, 100) }).then((r) => {
        st.hdl.busy = false;
        // Diagnose unabhängig vom Player: auch wenn er inzwischen zu oder ersetzt ist (Gerätetest R3)
        if (r && r.ok && r.value && r.value.job) hdlDiagNew(Object.assign(info, { existing: !!r.value.existing }), u, r.value.job);
        if (vp !== st) return;
        if (!r) { toast('Helfer-App nicht erreichbar'); return; }
        if (!r.ok) { toast((r.error && r.error.message) || 'Helfer-App: Verbindung fehlgeschlagen'); return; }
        st.hdl.url = u;
        hdlSet(r.value.job, true);
        toast(r.value.existing ? tr('Läuft schon') + ': ' + hdlText(r.value.job) : (r.value.job.state === 'unconfirmed'
          ? 'Verbindung unterbrochen – Stand wird geprüft' : 'Helfer-App lädt – Fortschritt hier im Menü und in der Benachrichtigung'));
      });
    }
    function hdlCancel() {
      const j = st.hdl.job;
      if (!hdlActive(j)) return;
      helperDl('cancel', { id: j.id }).then((r) => {
        if (vp !== st) return;
        if (!r || !r.ok) { toast((r && r.error && r.error.message) || 'Helfer-App nicht erreichbar'); return; }
        hdlSet(r.value.job, true);
        toast(r.value.reachable ? hdlText(r.value.job) : 'Helfer-App nicht erreichbar – Abbruch wird nachgeholt');
      });
    }
    function browserSave(d) {
      toast('Download wird vorbereitet …');
      browserDownload(d).then((ok) => {
        if (ok) { toast('Download läuft im Browser – du kannst die Seite verlassen'); return; }
        // Der Server gibt die Datei nicht als Download frei: alle Wege zur Auswahl
        dlMenu(true);
      });
    }
    // Alle Wege zum Speichern (langes Drücken auf ⬇, oder wenn der Browser nicht darf)
    // An YTDLnis / eine andere App übergeben: Der Browser verliert dabei das Vollbild (und holt es ohne Berührung nicht
    // zurück). Darum: Player hält an, und kommst du zurück, ist er zu – die Seite steht an deiner Stelle.
    const dlOut = (f) => {
      st.dlAt = Date.now(); st.dlCancel = false;
      const r = f();
      // Teilen-Menü abgebrochen? Dann bleibt der Player offen
      if (r && r.then) r.then((ok) => { if (!ok) { st.dlCancel = true; st.dlAt = 0; } });
    };
    function dlMenu(browserFailed, keep) {
      const d = directUrl();
      let link = '';
      try { link = SHOW_DOWNLOAD ? postUrlFor(orig) : ''; } catch (e) {}
      const items = [];
      st.hdl.menu = false;
      const opts = st.hdl.ok ? hdlOptions(!keep) : [];
      const can = opts.filter((o) => o.state === 'attemptable');
      const j = hdlActive(st.hdl.job) && hdlJobHere() ? st.hdl.job : null;
      if (j || can.length) {
        st.hdl.menu = true;
        if (j) {
          items.push({ label: 'Helfer-App: ' + tr(j.label), sub: j.progress || 'Stand wird abgefragt', stay: true, fn: () => {} });
          if (j.state !== 'cancelling') items.push({ label: 'Download abbrechen', sub: 'Helfer-App hört sofort auf und löscht die Teil-Datei', fn: hdlCancel });
        } else {
          // je auswählbare MP4 ein Eintrag (beste bekannte Qualität zuerst); keine Qualitätsangabe = unbekannt
          can.slice(0, 4).forEach((o) => items.push({ label: 'Mit der Helfer-App speichern',
            sub: 'direkt aufs Handy · ohne Anmeldung der Seite' + (o.height ? ' · ' + o.height + 'p' : ''), fn: () => hdlStart(o) }));
        }
      } else if (st.hdl.ok) {
        // erkannt, aber (noch) nicht über die Helfer-App: verständlich sagen warum – ohne Adresse
        if (st.hls || PLAYLIST_RE.test(st.cur || '')) items.push({ label: 'Helfer-App: Stream erkannt', sub: 'HLS/DASH speichert die Helfer-App noch nicht', stay: true, fn: () => {} });
        else if (opts.some((o) => o.reason === 'ambiguous' || o.reason === 'not-bound')) items.push({ label: 'Helfer-App: MP4 nicht sicher zugeordnet', sub: 'gehört nicht nachweislich zu diesem Video – nicht angeboten', stay: true, fn: () => {} });
      }
      if (link) items.push({ label: 'Mit YTDLnis', sub: 'direkt öffnen', fn: () => dlOut(() => toYtdlnis(link)) });
      if (d && !browserFailed) items.push({ label: 'Im Browser speichern', sub: 'Download des Browsers', fn: () => browserSave(d) });
      if (d) {
        items.push({ label: 'Im Browser öffnen', sub: 'dort ⋮ → Herunterladen', fn: () => {
          const w = window.open(d, '_blank');
          if (w) { try { w.opener = null; } catch (e) {} } else toast('Neuer Tab wurde blockiert – Pop-ups für diese Seite erlauben');
        } });
        items.push({ label: 'Hier speichern', sub: 'Player bis zum Ende offen lassen', fn: () => directDownload(d, () => toast('Die Seite sperrt den Download')) });
      }
      if (link || d) items.push({ label: 'Teilen …', sub: 'an eine andere App', fn: () => dlOut(() => shareUrl(link || d)) });
      if (!items.length) { toast('Für dieses Video gibt es keine Datei zum Herunterladen'); return; }
      openMenu('Herunterladen', items, keep);
    }
    // Tipp: der beste Weg von selbst
    //  1. Seiten, die yt-dlp kennt → YTDLnis (beste Qualität mit Ton)
    //  2. Helfer-App kann die MP4-Datei speichern → Auswahl (sie startet nur auf ausdrücklichen Tipp)
    //  3. Videodatei → Download des Browsers
    //  4. sonst YTDLnis mit dem Link · ohne alles: Hinweis
    on(bDl, () => {
      const d = directUrl();
      let link = '';
      try { link = SHOW_DOWNLOAD ? postUrlFor(orig) : ''; } catch (e) {}
      if (link && onSite(CONFIG.ytdlpSites)) { if (CONFIG.downloader === 'share') dlOut(() => shareUrl(link)); else dlOut(() => toYtdlnis(link)); return; }
      if (hdlShown()) { dlMenu(); return; }   // Helfer-App kann die Datei speichern: Auswahl zeigen, nichts von selbst
      if (d) { browserSave(d); return; }
      if (link) { if (CONFIG.downloader === 'share') dlOut(() => shareUrl(link)); else dlOut(() => toYtdlnis(link)); return; }
      dlMenu();
    });
    bDl.addEventListener('contextmenu', (e) => { e.preventDefault(); e.stopPropagation(); dlMenu(); });
    // Teilen: der Link zum Video – Beitrag (Instagram/Facebook/TikTok …), sonst die Seite. In einem eingebetteten
    // Fenster fragt das Skript die Hauptseite nach ihrer Adresse (nur für das Fenster, das gerade den Player zeigt).
    on(bShare, () => {
      const title = pageTitle();
      if (IN_FRAME) {
        let done = false;
        const own = () => { if (done) return; done = true; shareLinkTo(location.href.split('#')[0], title); };
        fb.onPageUrl = (u, t) => { if (done) return; done = true; fb.onPageUrl = null; shareLinkTo(u || location.href.split('#')[0], t || title); };
        fpost(window.parent, { t: 'askurl' });
        setTimeout(own, 500);
        return;
      }
      let link = '';
      try { link = postUrlFor(orig); } catch (e) {}
      shareLinkTo(link || location.href.split('#')[0], title);
    });
    on(bExt, () => {
      const t = M().currentTime;
      const go = (u) => { closePlayer(); try { orig.currentTime = t; } catch (e) {} openExternal(u, orig, CONFIG.player); };
      const u = st.cur || (resolve(orig) || {}).best;
      if (u) {
        // Geschützte Dateien der Seite selbst (z. B. /get_file/…): Die Adresse leitet nur MIT Browsersitzung zur echten
        // Datei weiter – VLC hat die nicht. Darum die Weiterleitung hier auflösen und die Endadresse übergeben.
        if (needsResolve(u)) {
          if (st.extUrl && st.extFor === u) { go(st.extUrl); return; }
          toast('Bereite Video vor …');
          finalUrl(u).then((f) => { if (vp === st) go(f); }, () => { if (vp === st) go(u); });
          return;
        }
        go(u);
        return;
      }
      // Instagram (Bild + Ton getrennt): fertige MP4 mit Ton nehmen – meist schon beim Öffnen im Hintergrund geholt
      if (IG) {
        if (st.igUrl) { go(st.igUrl); return; }
        toast('Suche die Videodatei …');
        igVideoUrl(orig).then((x) => { if (vp !== st) return; if (x) go(x); else shareLink('Keine Videodatei mit Ton gefunden (' + igLog + ')'); });
        return;
      }
      if (TT) {
        if (st.ttUrl) { go(st.ttUrl); return; }
        toast('Suche die Videodatei …');
        ttVideoUrl(orig).then((x) => { if (vp !== st) return; if (x) go(x); else shareLink('Keine Videodatei gefunden (' + ttLog + ')'); });
        return;
      }
      shareLink('Für dieses Video gibt es keine Datei-Adresse');
    });
    // Weiterleitung schon beim Laden im Hintergrund auflösen (2 Bytes), damit "In App öffnen" sofort klappt
    st.prefetchExt = () => {
      const u = st.mode === 'own' ? st.cur : '';
      if (!u || st.extFor === u || !needsResolve(u)) return;
      st.extFor = u; st.extUrl = '';
      finalUrl(u).then((f) => { if (st.extFor === u) st.extUrl = f; }, () => {});
    };
    // Keine Datei zum Übergeben: wenigstens den Link GENAU dieses Videos teilen (z. B. an NewPipe, YTDLnis …)
    function shareLink(why) {
      const link = postUrlFor(orig);
      if (!link) { toast(why); return; }
      if (navigator.share) {
        toast(why + ' – Link wird geteilt');
        navigator.share({ url: link }).catch(() => {});
      } else copyText(link, why + ' – Link kopiert');
    }
    if (TT) ttVideoUrl(orig).then((x) => { if (x) { st.ttUrl = x; st.refreshDl(); } }, () => {});
    // Instagram: MP4 mit Ton schon vorab holen, damit "In App öffnen" sofort klappt (nur eine kleine Datenabfrage)
    if (IG) igVideoUrl(orig).then((x) => { if (x) { st.igUrl = x; st.refreshDl(); } }, () => {});
    vid.addEventListener('loadeddata', () => { if (vp === st) st.refreshDl(); });
    // Wieder geeignet nach einem Sprung/Puffern (z. B. springt die Brücke beim Öffnen): danach kommt kein loadeddata
    // mehr. hdlProbe tut nichts, wenn die Quelle schon geprüft ist oder gerade geprüft wird.
    ['canplay', 'seeked'].forEach((ev) => vid.addEventListener(ev, () => { if (vp === st) hdlProbe(); }));
    st.refreshDl();

