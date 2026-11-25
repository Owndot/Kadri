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
