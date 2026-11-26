  // hls.js 1.7.3: Level.uri ist die aktive URI, Level.url enthält die Adressen des Levels.
  function hlsLevelAllowed(level, allowed) {
    return !!level && allowed(level.uri) && level.url.every((url) => allowed(url));
  }
  function pruneHlsLevels(hls, allowed, rejected) {
    const remove = hls.levels.map((level, index) => ({ level, index }))
      .filter(({ level }) => level === rejected || !hlsLevelAllowed(level, allowed));
    if (remove.length === hls.levels.length) return false;
    remove.reverse().forEach(({ index }) => hls.removeLevel(index));
    return true;
  }
  function guardedHlsLoader(allowed, rejected) {
    // pLoader erfasst Master, Level, Audio und Untertitel. BaseLoader ruft loadInternal auch bei Retries auf.
    return class extends Hls.DefaultConfig.loader {
      abort() {
        this.denial = null;
        super.abort();
      }
      loadInternal() {
        const { context, callbacks, stats } = this;
        if (!context || !callbacks) return;
        const track = context.levelOrTrack;
        const sourceAllowed = !track || (Array.isArray(track.url) ? hlsLevelAllowed(track, allowed) : allowed(track.url));
        if (sourceAllowed && allowed(context.url)) { super.loadInternal(); return; }
        // Erst nach Rückkehr zum Playlist-Controller abrechnen. Beim Abbruch ist der Vorgang bereits erledigt.
        const denial = this.denial = {};
        queueMicrotask(() => {
          if (this.context !== context || this.callbacks !== callbacks || this.denial !== denial) return;
          if (!rejected(context)) callbacks.onError({ code: 403, text: 'Playlist gesperrt' }, context, null, stats);
        });
      }
    };
  }
  function recoverHlsLevel(hls, context, allowed, media, preview = false) {
    // Eine späte Klassifikation kann auch bei automatischer Auswahl eintreffen. Der abgewiesene Level muss
    // aus der Instanz verschwinden, damit er nach Ablauf der Bibliotheks-Fehlerstrafe nicht erneut gewählt wird.
    const rejected = context.levelOrTrack;
    if (context.type !== 'level' || !hls.levels.includes(rejected) ||
        !hls.levels.some((level) => level !== rejected && hlsLevelAllowed(level, allowed))) return false;
    hls.stopLoad();
    pruneHlsLevels(hls, allowed, rejected);
    hls.startLevel = preview ? 0 : hls.levels.length - 1;
    hls.loadLevel = preview ? 0 : -1;
    hls.nextLoadLevel = hls.startLevel;
    hls.startLoad(media.currentTime || -1);
    return true;
  }
  // ---------- Natives HLS-Original: Start durch Kadri nur mit vollständiger, gültiger Masterentscheidung ----------
  // Ein natives Seitenvideo lädt die Varianten seiner Hauptliste ohne Kadris Prüfung. Je Playerinstanz und exakter
  // Hauptlistenadresse (Herkunft, Pfad, Query) gilt deshalb ein kleiner, nachvollziehbarer Zustand:
  //   (kein Eintrag) Analyse nicht begonnen            pending   Analyse läuft (ab loadSource)
  //   complete       Hauptliste vollständig gelesen    failed    Abruf/Parsen fehlgeschlagen oder abgebrochen
  //   denied         eine Adresse dieser Hauptliste wurde abgelehnt (bleibt bestehen)
  // Eine neue Analyse derselben Hauptliste setzt pending und überholt die vorige; Rückmeldungen eines alten Laufs
  // zählen nicht. Freigabe nur bei complete ohne pending/failed/denied und wenn jede erfasste Adresse heute zulässig
  // ist. Fehlender Eintrag, laufende oder gescheiterte Analyse: keine Freigabe – unbekannt ist nicht erlaubt.
  const HLS_MASTER_RECS = 8;
  function hlsMasterRec(st, master, create) {
    const key = dashUrlKey(master);
    if (!key) return null;
    if (!st.hlsMasters) st.hlsMasters = new Map();
    let rec = st.hlsMasters.get(key) || null;
    if (!rec && create && st.hlsMasters.size < HLS_MASTER_RECS) {
      rec = { urls: [], pending: false, complete: false, failed: false, denied: false, run: null };
      st.hlsMasters.set(key, rec);
    }
    return rec;
  }
  function hlsMasterBegin(st, master) {
    const rec = hlsMasterRec(st, master, true);
    if (!rec) return null;
    const run = {};
    rec.run = run; rec.pending = true;
    return run;
  }
  function hlsLevelUrls(data) {
    const urls = [];
    const add = (u) => { if (typeof u === 'string' && u && urls.indexOf(u) < 0 && urls.length < 512) urls.push(u); };
    ((data && data.levels) || []).forEach((l) => { add(l.uri); (Array.isArray(l.url) ? l.url : [l.url]).forEach(add); });
    ((data && data.audioTracks) || []).concat((data && data.subtitleTracks) || []).forEach((t) => add(t.url));
    return urls;
  }
  function hlsMasterParsed(st, master, run, data) {
    const rec = hlsMasterRec(st, master, false);
    if (!rec || rec.run !== run || !rec.pending) return rec;
    rec.urls = hlsLevelUrls(data);
    rec.pending = false; rec.failed = false; rec.complete = true;
    return rec;
  }
  function hlsMasterFailed(st, master, run) {
    const rec = hlsMasterRec(st, master, false);
    if (rec && rec.run === run && rec.pending) { rec.pending = false; rec.failed = true; }
  }
  function noteHlsDenial(st, master) {
    const rec = hlsMasterRec(st, master, true);
    if (rec) rec.denied = true;   // ohne Platz für einen Eintrag bleibt die Hauptliste unbekannt: keine Freigabe
  }
  // Ist die Adresse eine HLS-Hauptliste, darf Kadri das native Original nur mit positiver Masterentscheidung starten.
  function hlsNativeStartAllowed(st, url) {
    if (!url) return true;   // keine prüfbare Adresse (MediaSource/Blob der Seite): keine HLS-Entscheidung
    const rec = st.hlsMasters ? st.hlsMasters.get(dashUrlKey(url)) : null;
    if (!rec && mediaKindOf(url, '') !== 'hls') return true;   // keine Hauptliste: Quellenprüfung allein entscheidet
    if (st.noNativeHlsStart || !rec) return false;
    return rec.complete && !rec.pending && !rec.failed && !rec.denied && rec.urls.every((u) => mediaSourceAllowed(u));
  }
