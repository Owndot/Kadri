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
  function guardedHlsLoader(allowed, rejected, onManifest) {
    // pLoader erfasst Master, Level, Audio und Untertitel. BaseLoader ruft loadInternal auch bei Retries auf.
    return class extends Hls.DefaultConfig.loader {
      // Dokumentierte Loader-Schnittstelle: der empfangene Mastertext geht zusätzlich an die Masteranalyse (src/170).
      load(context, config, callbacks) {
        if (onManifest && context && context.type === 'manifest' && callbacks && typeof callbacks.onSuccess === 'function') {
          const success = callbacks.onSuccess;
          callbacks = Object.assign({}, callbacks, { onSuccess: (response, stats, ctx, details) => {
            try { onManifest(response, ctx || context); } catch (e) {}
            return success(response, stats, ctx, details);
          } });
        }
        return super.load(context, config, callbacks);
      }
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
  //   incomplete     nicht jede Adresse erfasst: Budget erschöpft, dynamische Pfade (Content Steering, Variablen)
  //                  oder nicht auswertbare Angabe (bleibt bestehen)
  // Vollständig heißt: jede URI-Zeile und jedes URI-Attribut des tatsächlich empfangenen Mastertexts (auch I-Frame-,
  // Session- und Mediengruppen, die hls.js nicht als Level führt) sowie die Level-/Alias-/Spuradressen von hls.js.
  // Eine neue Analyse derselben Hauptliste setzt pending und überholt die vorige; Rückmeldungen eines alten Laufs
  // zählen nicht. Innerhalb derselben Playerinstanz und Hauptlistenadresse ist das Wissen monoton: erfasste Adressen,
  // denied und incomplete werden nie zurückgenommen. Eine andere Adresse (auch nur andere Query) oder ein neuer Player
  // beginnt mit eigenem Eintrag. Freigabe nur bei complete ohne pending/failed/denied und wenn jede erfasste Adresse heute zulässig
  // ist. Fehlender Eintrag, laufende oder gescheiterte Analyse: keine Freigabe – unbekannt ist nicht erlaubt.
  // Budget: höchstens 512 eindeutige Adressen (Herkunft, Pfad, Query) je Hauptliste und 8 Hauptlisten je Player.
  // Duplikate zählen nicht; die 513. eindeutige Adresse wird nicht gespeichert, sondern macht den Eintrag unvollständig.
  const HLS_MASTER_RECS = 8, HLS_MASTER_URLS = 512;
  // Form und Länge vor jeder Aufnahme: vollständige Eingabe samt Fragment höchstens MEDIA_LIMITS.urlLen Zeichen,
  // http(s) ohne Zugangsdaten (mediaUrlOk); das Fragment fällt erst danach aus dem Schlüssel.
  const hlsUrlOk = (u) => typeof u === 'string' && u.length <= MEDIA_LIMITS.urlLen && mediaUrlOk(u.split('#')[0]);
  function hlsMasterRec(st, master, create) {
    if (!hlsUrlOk(master)) return null;   // keine Aufnahme, also keine Freigabe für diese Hauptliste
    const key = dashUrlKey(master);
    if (!key) return null;
    if (!st.hlsMasters) st.hlsMasters = new Map();
    let rec = st.hlsMasters.get(key) || null;
    if (!rec && create && st.hlsMasters.size < HLS_MASTER_RECS) {
      rec = { urls: [], keys: new Set(), pending: false, complete: false, failed: false, denied: false, incomplete: false, run: null };
      st.hlsMasters.set(key, rec);
    }
    return rec;
  }
  function hlsMasterBegin(st, master) {
    const rec = hlsMasterRec(st, master, true);
    if (!rec) return null;
    // Erneute Analyse: pending, failed und complete gelten je Lauf. Adressen werden nur vereinigt (gemeinsames
    // Budget), denied und incomplete bleiben – eine kürzere oder ältere Liste nimmt kein früheres Wissen zurück.
    const run = {};
    rec.run = run; rec.pending = true; rec.failed = false; rec.complete = false;
    return run;
  }
  function hlsMasterAdd(rec, u) {
    const key = hlsUrlOk(u) ? dashUrlKey(u) : '';
    if (!key) { rec.incomplete = true; return; }   // überlang, nicht http(s) oder mit Zugangsdaten: nicht gespeichert
    if (rec.keys.has(key)) return;
    if (rec.keys.size >= HLS_MASTER_URLS) { rec.incomplete = true; return; }
    rec.keys.add(key); rec.urls.push(u);
  }
  // Empfangener Mastertext (Basis: tatsächliche Antwortadresse wie bei hls.js)
  const HLS_URI_ATTR = /\bURI="([^"]*)"/g;
  function hlsMasterText(st, master, run, base, text) {
    const rec = hlsMasterRec(st, master, false);
    if (!rec || rec.run !== run || !rec.pending) return;
    if (typeof text !== 'string' || !/^\uFEFF?#EXTM3U/.test(text)) { rec.failed = true; return; }
    run.text = true;
    noteMediaType(master, 'hls'); if (base) noteMediaType(base, 'hls');
    // Medienplaylist: Stücke, Init und Schlüssel sind keine Playlists (wie beim Playlist-Guard); als weitere Playlist
    // verweist dort nur RENDITION-REPORT. Dynamische Angaben (Variablen, Content Steering) gelten in beiden Arten.
    const media = /^#EXT(?:INF|-X-TARGETDURATION):/m.test(text);
    for (const raw of text.split(/\r\n|\r|\n/)) {
      const line = raw.trim();
      if (!line) continue;
      if (line.indexOf('{$') >= 0 || /^#EXT-X-(?:CONTENT-STEERING|DEFINE)\b/.test(line)) rec.incomplete = true;
      if (media && !/^#EXT-X-RENDITION-REPORT:/.test(line)) continue;
      const refs = [];
      if (line[0] === '#') {
        HLS_URI_ATTR.lastIndex = 0;
        for (let m = HLS_URI_ATTR.exec(line); m; m = HLS_URI_ATTR.exec(line)) refs.push(m[1]);
      } else refs.push(line);
      for (const ref of refs) {
        let abs = '';
        if (ref.indexOf('{$') < 0) { try { abs = new URL(ref, base).href; } catch (e) {} }
        if (abs) hlsMasterAdd(rec, abs); else rec.incomplete = true;
      }
    }
  }
  function hlsMasterParsed(st, master, run, data) {
    const rec = hlsMasterRec(st, master, false);
    if (!rec || rec.run !== run || !rec.pending) return rec;
    ((data && data.levels) || []).forEach((l) => { hlsMasterAdd(rec, l.uri); (Array.isArray(l.url) ? l.url : [l.url]).forEach((u) => hlsMasterAdd(rec, u)); });
    ((data && data.audioTracks) || []).concat((data && data.subtitleTracks) || []).forEach((t) => hlsMasterAdd(rec, t.url));
    rec.pending = false;
    if (run.text && !rec.failed) { rec.complete = true; } else { rec.complete = false; rec.failed = true; }
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
  // Darf Kadri das native Original mit dieser Adresse starten? Typ nach Belegen (src/040 mediaTypeOf), nicht nach
  // Schreibweise: HLS (auch endungslos, .m3u, irreführendes .mp4) nur mit positiver Masterentscheidung; DASH nie;
  // eine Datei mit eigener Probe oder – wie bisher – mit Dateiendung ohne Gegenbeleg; unbekannter Typ: nicht.
  function hlsNativeStartAllowed(st, url) {
    if (!url) return true;   // keine prüfbare Adresse (MediaSource/Blob der Seite): keine Typentscheidung möglich
    const rec = st.hlsMasters ? st.hlsMasters.get(dashUrlKey(url)) : null;
    const type = mediaTypeOf(url);
    if (type === 'dash') return false;
    if (!rec && type !== 'hls') return type === 'file' || type === 'claimed-file';
    if (st.noNativeHlsStart || !rec) return false;
    return rec.complete && !rec.pending && !rec.failed && !rec.denied && !rec.incomplete &&
      rec.urls.every((u) => mediaSourceAllowed(u));
  }
