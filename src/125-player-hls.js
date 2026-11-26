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
  // Variantenentscheidung des eigenen Players für genau diese Hauptliste. Ein natives Seitenvideo mit derselben
  // Hauptliste lädt die Varianten ohne Kadris Prüfung. Eine einmal abgelehnte Variante sperrt deshalb jeden von Kadri
  // ausgelösten Start dieses Originals, auch nach Capture-Rückfall oder Rückgabe. Gebunden an die Playerinstanz und
  // die exakte Hauptlistenadresse: eine andere Quelle desselben Elements wird neu bewertet.
  function noteHlsMaster(st, master, data) {
    const urls = new Set();
    const add = (u) => { if (typeof u === 'string' && u && urls.size < 512) urls.add(u); };
    ((data && data.levels) || []).forEach((l) => { add(l.uri); (Array.isArray(l.url) ? l.url : [l.url]).forEach(add); });
    ((data && data.audioTracks) || []).concat((data && data.subtitleTracks) || []).forEach((t) => add(t.url));
    const rec = { urls: Array.from(urls), denied: false };
    if (!st.hlsMasters) st.hlsMasters = new Map();
    st.hlsMasters.set(dashUrlKey(master), rec);
    return rec;
  }
  function noteHlsDenial(st, master) {
    const rec = st.hlsMasters && st.hlsMasters.get(dashUrlKey(master));
    if (rec) rec.denied = true;
    else noteHlsMaster(st, master, null).denied = true;
  }
  // Darf Kadri das Seitenvideo mit dieser Adresse selbst starten? Prüft den heutigen Klassifikationsstand jeder
  // bekannten Variante erneut und behält eine frühere Ablehnung.
  function hlsOrigStartBlocked(st, url) {
    if (!url) return false;
    if (st.noNativeHlsStart && PLAYLIST_RE.test(url)) return true;
    const rec = st.hlsMasters && st.hlsMasters.get(dashUrlKey(url));
    return !!rec && (rec.denied || rec.urls.some((u) => !mediaSourceAllowed(u)));
  }
