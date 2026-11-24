# S3e – DASH-Befund vom Samsung: Bindung (A) und VP9/Opus-WebM (B)

Stand 22.11.2026 – nur Diagnose, Architekturvorschlag und Testplan.

- Kein Push, kein Merge, keine neue APK, keine Beta.
- An keinem Repository wurde etwas geändert. Die Versuche liefen nur lokal (Scratchpad, Desktop-Chromium 153, headless).

Codestand: Kadri `520c0bf` (1.12.17) und Helfer `ee54864`.

---

## 0. Kurzantwort: Was verhindert die Zuordnung?

**Der blockierende Befund lautet: „Segmentprüfung 0 Treffer, 0 Init, kein struktureller Treffer“.**

Kadri bindet ein MPD nur, wenn der **Ressourcen-Beobachter des Fensters mit dem Player** (PerformanceObserver) Abrufe meldet, die **exakt** den aus dem MPD berechneten Stück-Adressen entsprechen: mindestens 3 aufeinanderfolgende Stücke einer Darstellung. Auf dem Samsung passte **keiner** der 46 beobachteten Abrufe. Er passte nicht einmal grob:
- kein gleicher Pfad auf anderem Host,
- kein gleicher Pfad mit anderer Query,
- kein gleiches Muster mit anderer Zeit,
- auch kein Init-Segment.

Daraus folgt in Kadri diese Kette:

| Schritt | Code | Ergebnis |
|---|---|---|
| Stückabgleich je Darstellung | `src/038-dash-manifest.js:385` (`dashBindDecision`) | 0 Treffer → `ambiguous (keine-treffer)` |
| einziger übriger Beleg: MPD kurz vor/nach Videostart geladen | `src/060-quellen-zuordnung.js:304` (`timingMatch`), `src/065-media-registry.js:196` | Bindung `ambiguous(start-timing)`; zeitliche Nähe bindet bewusst nie |
| Hinweis im Menü | `src/045-media-source.js:202`, `src/105-download-knopf.js:140` | „Vermutlich DASH-Stream – nicht sicher zugeordnet …“ |

**VP9/Opus/WebM ist nicht die Ursache des Bindungsfehlers.** Das habe ich im Versuch belegt (Abschnitt A2): Kadris Stück-Index ist codec-unabhängig. Bei einer echten VP9/Opus-WebM-DASH-Quelle mit SegmentTemplate und Timeline (`$Time$`) trifft er **30 von 30** Dateien exakt (Init und Stücke).

Das Format ist ein **zweites, unabhängiges Hindernis**. Auch nach erfolgreicher Bindung lehnt das S3-Profil `video/webm` und VP9/Opus ab (Helfer `DashProfile.java:95`, Kadri-Gate `src/039`). Das ist richtig so, siehe Teil B.

Es bleiben vier Erklärungen. Sie lassen sich auf dem Samsung unterscheiden, ohne etwas zu installieren (Abschnitt A4):

- **H1:** Die Stücke werden außerhalb der Sicht des Beobachters geladen, typischerweise in einem **Web-Worker**. Die MSE-Anhänge erfolgen trotzdem im Hauptthread.
- **H2:** Der Player **schreibt die Stück-Adressen um**, etwa über einen Anfragefilter, einen Proxy- oder Token-Pfad oder einen CDN-Pfad, der nicht im MPD steht. Er lädt also nicht die Adressen, die das MPD beschreibt.
- **H3:** Das gelesene MPD ist **nicht das abgespielte**, zum Beispiel ein Vorschau-, Trailer- oder Werbe-MPD. Das eigentliche Video kommt aus einer anderen, nicht gelesenen Quelle.
- **H4:** Seltener: Mehrere `BaseURL` mit unterschiedlichen Pfaden. Kadri rechnet mit der ersten, der Player wählt eine andere. Der Helfer lehnt solche MPDs ohnehin ab (`baseurl-multiple`).

---

## Teil A – Erkennung und Bindung

### A1. Was beobachtet Kadri heute, und wo?

- **Stückabrufe:** nur über `PerformanceObserver({type:'resource'})` im Hauptthread des Fensters, in dem Kadri läuft (`src/040-quellen-netzwerk.js:515`).
- **Zusätzliche Hooks:** fetch/XHR-Hooks in `page.js` (MAIN world) melden nur Listen (`.m3u8/.mpd` oder per Content-Type), keine Stücke.
- **Hintergrund:** Der Erweiterungshintergrund hat keine `webRequest`-Berechtigung, nur DNR, und sieht daher keine Abrufe.
- **Bekannte Grenze:** Im Code dokumentiert (`src/060:285`) und getestet (`tests/test_dash_bind.py`, Fall `worker`): Stücke aus Web-Workern → keine Treffer → `ambiguous`.

### A2. Versuche (lokal, reproduzierbar, Dateien unter `experiment/`)

**1. Echte VP9/Opus-WebM-Quelle**
- Erzeugt mit ffmpeg 6.1, `-dash_segment_type webm`: 1920×800 und 640×266 VP9 sowie zwei Opus-Sprachen, SegmentTemplate mit SegmentTimeline und `$Time$`.
- Darauf lief Kadris unveränderter Code aus `src/038`.

| Prüfung | Ergebnis |
|---|---|
| Darstellungen indexiert | 4 von 4 (`single 0`) |
| echte Dateien exakt zugeordnet | 30 von 30 (4 Init, 26 Stücke, richtige Darstellung und Nummer) |
| Gegenprobe: Pfad-Token eingefügt (`/tok123/…`) | `none` = „kein struktureller Treffer“ |
| Gegenprobe: Proxy-Pfad (`/proxy/…`) | `none` |
| Gegenprobe: anderer Host | `host` |
| Gegenprobe: Query angehängt | `query` |
| Gegenprobe: Zeit neben der Zeitleiste | `number` |

Daraus folgt: Das Samsung-Bild „alle `none`“ entsteht genau dann, wenn der **Pfad** abweicht (H2, H3, H4) oder die Stückabrufe gar nicht in der Liste sind (H1).

**2. Beobachtbarkeit:** dieselben 8 Stücke (Video und Ton), einmal im Hauptthread und einmal im Worker geladen. In beiden Fällen wird im Hauptthread an MSE angehängt.

| geladen in | PerformanceObserver sieht Stücke | MSE-Anhänge im Hauptthread |
|---|---|---|
| Hauptthread (`fetch`) | 8 | 8 |
| **Web-Worker** | **0** | **8** |

**3. Echte Player mit derselben WebM-Quelle**

| Player | lädt mit | beobachtete Stücke | MSE-Anhänge | davon byte-gleich mit der Datei |
|---|---|---|---|---|
| dash.js 4.7.4 | XHR, Hauptthread | 17 | 16 | **16 von 16** |
| Shaka 4.11.7 | fetch, Hauptthread | 12 | 12 | **12 von 12** |

Beide Player hängen WebM-Stücke **unverändert** an MSE an. Das ist die Grundlage für den Vorschlag in A5.

### A3. Was ist auf Android/Chromium tatsächlich beobachtbar?

| Quelle | Hauptthread im Fenster des Players | Worker | anderes (Unter-)Fenster | Bemerkung |
|---|---|---|---|---|
| PerformanceResourceTiming (Adresse, Initiator, Zeiten) | ja (auch fremde Hosts; Detailzeiten ohne Timing-Allow-Origin genullt) | **nein** (eigene Zeitleiste des Workers) | nur dort, wo Kadri selbst läuft | Zeitleisten-Puffer 250 Einträge; der Beobachter ist davon unabhängig |
| fetch/XHR-Hooks (`page.js`, MAIN) | ja | nein | ja in http(s)-Fenstern; **nicht** in about:blank/srcdoc/blob-Fenstern (kein `match_origin_as_fallback`) | Heute nur für Listen genutzt |
| MSE (`addSourceBuffer`, `appendBuffer`, `buffered`) | **ja**, auch wenn im Worker geladen wird (bei `blob:`-Quelle; auf dem Samsung: „MSE/blob“) | nur bei MSE-in-Worker; dann `srcObject` statt `blob:`, hier nicht der Fall | im Fenster des Videos | Inhalt der Anhänge sichtbar, aber **keine Adresse** |
| webRequest (Hintergrund) | – | ja | ja | Nicht angefordert; wäre eine neue, breite Berechtigung, siehe A6 |
| WebSocket/WebRTC/P2P-Auslieferung | nicht als Ressource | – | – | Wäre ein eigener Fall (H1-ähnlich) |

### A4. Prüfung auf dem echten Samsung (ohne Installation)

**Stufe 0 – sofort, ohne jede Änderung: vorhandene anonymisierte Diagnose.**

Diagnose **im Fenster des Players** abrufen: lange auf ▶ drücken, das eingebettete Fenster hat eine eigene Diagnose. Dann diese Zeilen ganz übermitteln. Sie sind schon anonymisiert, ohne Adressen und Hosts.
- `Fenster-Ebene … · Mitleser in der Seite aktiv/fehlt`
- `Video-Element: Quelle … · Auflösung …p · gepuffert … s` (und ob „in leerem Unterfenster“)
- `DASH-Manifest: … Video 3 (…; bis ___p) …`
- `DASH-Stückprüfung …` und `DASH-Abgleich …` (alle Klassen einzeln)
- `Ladevorgänge hier (Beobachter …) … seit Videostart N (Art:Endung: …) · Medien-Kandidaten …`
- `Ladevorgänge hier (Zeitleisten-Puffer …)`

So werden die Zeilen gelesen:

| Beobachtung | spricht für |
|---|---|
| `DASH-Manifest … bis Xp`, und X ist **nicht** 800, obwohl das Video 800p zeigt (bei 1920×800 sind beide 800) | **H3** (anderes MPD) |
| Unter „Art:Endung“ kaum Einträge der Art `xhr/fetch` mit der Stückendung (z. B. `webm`), obwohl laut Puffer 139 s geladen sind | **H1** |
| Viele `xhr:webm`/`fetch:webm` (oder `ohne-endung`), etwa so viele wie für 139 s nötig, aber alle `kein struktureller Treffer` | **H2** oder **H3** |
| „in leerem Unterfenster“ oder „Mitleser fehlt“ | Player in about:blank/srcdoc-Fenster, Sonderfall von H1 |

Faustregel: Für 139 s Puffer braucht ein Player mindestens etwa 2 × 139 s / Stücklänge Abrufe, also ≥ 28 bei 10-s-Stücken, plus Init. Die gemeldeten **25 Medien-Kandidaten** liegen schon darunter. Das ist ein **Hinweis auf H1**, aber kein Beweis, denn die Stücklänge kennen wir nicht und die Kandidaten können auch andere Abrufe sein.

**Stufe 1 – genauer, ohne Installation, nur mit Freigabe:** `chrome://net-export` im selben Browser, falls dieser Chromium-Build die Seite anbietet.
1. Aufzeichnung starten, Video etwa 30 s abspielen, Aufzeichnung stoppen.
2. Die Datei enthält alle Abrufe, auch aus Workern und Unterfenstern, und damit **volle Adressen**. Sie muss auf deinem Gerät bzw. PC bleiben und **nie in den Chat oder nach GitHub**. Beim Start „Strip private information“ wählen.
3. Auswerten würdest du sie mit einem Offline-Skript, das ich auf Wunsch liefere. Es gibt nur Klassen aus: „Stückpfade passen zum MPD-Muster ja/nein“, „gemeinsamer Ordner“, „Nummer in der Zeitleiste ja/nein“, Anzahl je Klasse.

So unterscheidet die Aufzeichnung die Hypothesen:
- Stücke laut Aufzeichnung vorhanden und passend, im Beobachter aber fehlend → **H1**.
- Stücke vorhanden, Pfad weicht ab → **H2**.
- Keine Stücke zu diesem MPD, aber andere Medienabrufe → **H3**.

**Stufe 2 – am genauesten, braucht eine Geräteänderung:** USB-Debugging (Entwickleroptionen) und Remote-DevTools (`chrome://inspect` am PC).
- Der Network-Tab zeigt den Initiator (Worker oder Hauptthread), das Fenster und die Adresse. Das ist der direkte Vergleich mit dem MPD.
- **Nur nach ausdrücklicher Freigabe**, denn es ist eine Änderung am Samsung.

**Stufe 3 – braucht eine neue Kadri-Test-ZIP, später:** „Diagnose Stufe 2“, nur Zählungen.
- MSE-Anhänge je SourceBuffer (Art video/audio, Containerfamilie aus `addSourceBuffer`) gegenüber beobachteten Stückabrufen;
- Zahl der erzeugten Worker (passiv gezählt);
- Pfadform-Klassen (gleiche Ordnertiefe, gemeinsamer Ordnerpräfix, Nummer in der Zeitleiste).

Damit wird die Unterscheidung eindeutig:

| MSE-Anhänge | beobachtete Stückabrufe | Ursache |
|---|---|---|
| viele | ~0 | H1 |
| viele | ≈ Anhänge, alle `none` | H2 (Nummer in der Zeitleiste) oder H3 (Nummer nicht in der Zeitleiste, Höhe passt nicht) |

### A5. Vorschlag: sichere Erkennung ohne Abschwächung – „Inhaltsbeleg“ `dash-bytes`

**Idee:** Wenn die Adresse nicht beobachtbar ist (H1) oder umgeschrieben wird (H2), wird die **Identität über den Inhalt** belegt. Die Bytes, die der Player an MSE anhängt, müssen byte-gleich mit Stücken sein, die der Helfer selbst von den Adressen **aus dem MPD** lädt. Das ist mindestens so streng wie heute: Gleiche Bytes eines VP9- oder Opus-Stücks bei zwei verschiedenen Videos sind praktisch ausgeschlossen. Bei H3 entsteht dagegen korrekt **keine** Bindung.

**Ablauf (nur nach Tipp auf ⬇, nie automatisch):**

1. **`page.js` (MAIN):**
   - Passiver Wrapper um `SourceBuffer.prototype.appendBuffer`. Er ruft das Original **unverändert und synchron** auf und berechnet nebenbei SHA-256 einer Kopie.
   - Je SourceBuffer höchstens die letzten 24 Anhänge, jeder ≤ 16 MB. Gespeichert werden nur Hash, Länge, Zeit und Art; **keine Bytes, keine Adressen**.
   - Zuordnung SourceBuffer → MediaSource → `blob:`-Adresse → `video.currentSrc` über einen passiven Wrapper um `URL.createObjectURL`. So zählt nur das MSE **dieses** Videos.
2. **Kadri**, nur wenn **genau ein** gelesenes MPD `ambiguous (keine-treffer)` ist und das Video per MSE spielt:
   - Kadri bittet den Helfer mit dem neuen Befehl `dashprobe` um die SHA-256-Werte von Init und **3 aufeinanderfolgenden Stücken** je in Frage kommender Darstellung, nahe der aktuellen Wiedergabeposition (Zeit aus der Zeitleiste).
   - Der Helfer lädt sie über die **bestehende gehärtete Netzschicht**: keine Cookies, AddressPolicy, Größengrenzen. Danach verwirft er sie.
3. **`bound` mit Beleg `dash-bytes`** nur, wenn **alle** Bedingungen gelten:
   - Init byte-gleich;
   - ≥ 2 aufeinanderfolgende Medienstücke derselben Darstellung byte-gleich mit Anhängen **seit dem Start dieses Mediums**;
   - genau ein MPD erfüllt das;
   - kein anderes Video spielt;
   - die Dauer passt;
   - die Abfrage ist höchstens 20 s alt.
4. Alles andere bleibt `ambiguous`:
   - Teil- oder zusammengesetzte Anhänge (chunked);
   - vom Player veränderte Bytes;
   - der Helfer kann die Adressen nicht laden (dann wäre auch der Download unmöglich);
   - Konkurrenz zweier MPDs.

   Die heutige URL-Bindung bleibt **unverändert**. `dash-bytes` ist ein **zusätzlicher**, gleich strenger Beleg, keine Lockerung.

**Vertrauensniveau:**
- Die Seite könnte gefälschte Anhang-Meldungen senden. Das ist dasselbe Niveau wie heute, denn eine Seite kann auch Abrufe zum Schein auslösen.
- Für eine Fälschung müsste die Seite genau die Bytes kennen, die der Helfer vom MPD lädt. Sie würde also nur an ihr eigenes Video binden. Das wird dokumentiert und getestet.

**Kosten:**
- Ein paar MB Abruf pro Tipp, nur nach Nutzertipp.
- SHA-256 auf höchstens 24 Puffer je Spur (über `crypto.subtle`, asynchron).
- Neuer Helfer-Befehl mit eigenen Grenzen.
- Das Angebot erscheint danach erst, wenn auch das **Profil** passt (Teil B). Für diese Quelle also erst mit S4w.

### A6. Bewusst verworfen (würde Schutz oder Strenge schwächen)

- **Zeitabgleich MSE-Puffer gegen Zeitleiste als Bindung:** Gleich lange Stücke identifizieren kein Video. Höchstens als Diagnose.
- **Lockerung auf „gleicher Pfad, anderer Host/Query“ oder Ähnlichkeit:** Damit wäre die Identität nicht mehr nachweisbar (Query-Identität, Testfälle `qtwo`/`qwrong`).
- **`webRequest`-Berechtigung:** Der Hintergrund sähe dann alle Adressen aller Tabs. Das ist neuer Berechtigungsumfang, die Unterstützung in Android-Chromium-Browsern ist unsicher, und es bräuchte eine eigene Sicherheitsprüfung (DNR-SCOPE). Nicht ohne gesonderte Entscheidung.
- **Code in Worker einschleusen oder `Worker` umbauen:** Das greift in den Seitencode ein und bricht bei CSP-, Modul- und blob-Workern.

### A7. Regressionen (Chromium mit der Erweiterung, Muster `tests/test_dash_bind.py`; reine Entscheidung in Node)

| ID | Fall | Erwartung |
|---|---|---|
| RA1 | Stücke im Worker, MSE im Hauptthread (fMP4 **und** WebM) | heute `ambiguous (keine-treffer)`; mit `dash-bytes` erst nach byte-gleicher Helfer-Probe `bound` |
| RA2 | Seite spielt B, gelesen ist MPD A mit gleicher Zeitleiste | `ambiguous` (Bytes ungleich) |
| RA3 | Player schreibt den Pfad um (Token/Proxy), MPD-Adressen ladbar | URL-Weg `ambiguous`; `dash-bytes` → `bound` |
| RA4 | Player hängt geteilte oder zusammengefügte Stücke an | `ambiguous` |
| RA5 | Player verändert die Bytes | `ambiguous` |
| RA6 | gefälschte Anhang-Meldungen mit falschen Hashes | keine Bindung |
| RA7 | Medienwechsel: Anhänge vor dem Start des Mediums | nicht gezählt |
| RA8 | zwei Videos spielen | `mehrere-videos` |
| RA9 | Helfer nicht erreichbar, 403/404, zu groß | `ambiguous`, kein Angebot |
| RA10 | zwei MPDs mit identischen Bytes (Spiegel-CDN) | `konkurrenz` |
| RA11 | Player im fremden iframe / im srcdoc-Fenster | wie der Hauptfall bzw. dokumentiert `ambiguous` |
| RA12 | alle bestehenden `test_dash_bind`/`test_dash_diag`-Fälle | unverändert grün |
| RA13 | Mutationsproben: 1 statt 2 Stücke, Init ignoriert, Medienstart ignoriert, Konkurrenz ignoriert | Tests schlagen fehl |
| RA14 | Diagnose: keine Hashes und keine Adressen in der Ausgabe | nur Zählungen |

---

## Teil B – Machbarkeit: statische DASH-WebM-Downloads (VP9 + Opus)

### B1. Ist-Stand

**Helfer S3 (fail-closed):**
- nur `video/mp4` mit `avc1/avc3` und `audio/mp4` mit `mp4a.40.2/5/29`;
- Prüfung per `Fmp4Inspect`;
- Zusammensetzen mit Media3 `Mp4Muxer` 1.11.1 zu MP4.

Für diese Quelle ergibt das `dash-codec` (container/codec). Das ist korrekt, kein Fehler.

**Der Stückabruf ist containerneutral wiederverwendbar.** Das betrifft SegmentTemplate/Timeline, `DashTemplate`/`DashPlan`, Fingerabdruck, Journal, Fortsetzen und Grenzen. Neu sind Prüfung und Zusammensetzen.

### B2. Wie sieht DASH-WebM tatsächlich aus? (Versuch, `experiment/ergebnis-webm-struktur.txt`)

**Init:**
- EBML-Header, dann `Segment` mit **unbekannter Größe**, darin SeekHead, Void, Info (**ohne Duration**), Tracks mit **einer** TrackEntry und Tags;
- **TrackNumber = 1 bei Video und Ton**;
- Opus mit `CodecDelay`, `SeekPreRoll` und `CodecPrivate` (OpusHead, 19 B).

**Stücke:** nur `Cluster`, **keine Cues**.

**Einfaches Aneinanderhängen** (Init + Stücke) ist zwar dekodierbar, aber:
- **Dauer unbekannt** (`N/A` in ffprobe);
- **nicht spulbar** (keine Cues);
- Video und Ton liegen in **zwei** Dateien, und die Spurnummern kollidieren.

Daher gilt: Nötig ist ein echtes Remuxing ohne Neukodierung, also Blöcke kopieren, neu verschränken und indexieren.

### B3. Optionen

| | Ausgabe | Weg | Vorteile | Nachteile |
|---|---|---|---|---|
| **W1 (empfohlen)** | `.webm` (`video/webm`) | eigener, strenger EBML-Leser für Init und Cluster, eigener WebM-Schreiber in Java; Blöcke 1:1 kopiert | deterministisch, im JVM testbar, unabhängig von Android-Version und Gerät, volle Kontrolle über Prüfungen | eigener Code (Schätzung 1 500–2 500 Zeilen inkl. Tests), Pflege |
| W2 | `.webm` | Media3 `MatroskaExtractor` → `android.media.MediaMuxer` (`MUXER_OUTPUT_WEBM`) | wenig eigener Code | Plattformverhalten je Version und Hersteller (VP9/Opus im WebM-Muxer auf API 26/29/34 erst zu belegen), nicht im JVM testbar, nicht deterministisch; Cues/Duration hängen vom Gerät ab |
| M1 | `.mp4` | VP9 (`vp09`) + Opus (`Opus`/`dOps`) in ISO-BMFF über Media3 `Mp4Muxer` | gleiche Pipeline wie S3 | Unterstützung im gepinnten Mp4Muxer 1.11.1 ungeprüft; Opus-Pre-skip auf Edit-List abbilden; geringere Abspielkompatibilität; „nicht einfach MP4 voraussetzen“ |
| MKV | `.mkv` | wie W1 mit DocType `matroska` | erlaubt Codecs außerhalb von WebM | hier unnötig (VP9+Opus sind WebM-konform); in Android-Galerien teils schlechter unterstützt |

**Media3 und Android:**
- **Lesen:** Media3 `MatroskaExtractor` (in `media3-extractor` 1.11.1, schon im Helfer) liest WebM/VP9/Opus. Er eignet sich als **unabhängige Gegenprüfung** des eigenen Schreibers.
- **Dekodieren:** VP9 und Opus dekodiert die Plattform über MediaCodec (Software-Decoder in AOSP, auf Samsung meist Hardware-VP9). Media3-Decoder-Erweiterungen (libvpx/libopus, nativ) sind **nicht nötig** und wegen nativer Bibliotheken (16-KB-Ausrichtung) nicht empfohlen.
- **Schreiben:** Nach meinem Stand bietet Media3 keinen WebM-Muxer an. Das muss gegen 1.11.1 belegt werden, bevor W1 endgültig gegen W2/M1 gewählt wird.

### B4. Profil „S4w“ – Prüfungen (fail-closed, feste Gründe ohne Adressen)

**MPD:**
- statisch, eine Periode, keine ContentProtection, Dauer bekannt und innerhalb der Grenzen;
- Video `video/webm` mit `vp9` oder `vp09.00.*` (**Profil 0, 8 bit**);
- Ton `audio/webm` mit `opus`;
- nicht gemuxt; Init vorhanden;
- Adressierung wie S3 (Template mit Timeline oder Number/duration);
- `startWithSAP` bzw. Keyframe-Anfang je Stück.

**Init:**
- DocType `webm`; DocTypeReadVersion ≤ 2; EBMLMaxIDLength 4; EBMLMaxSizeLength 8;
- genau ein Segment und eine TrackEntry; TrackType passt; CodecID `V_VP9` bzw. `A_OPUS`;
- **keine `ContentEncodings`** (Verschlüsselung/Kompression) → `dash-protected`;
- Opus: `OpusHead` v1, 1–2 Kanäle (Mapping-Familie 0), Pre-skip passt zu `CodecDelay`, `SeekPreRoll` vorhanden;
- Video: Breite und Höhe wie im MPD; `Colour` nur SDR; keine `BlockAdditionMapping` (HDR10+/DV). Profil 2/HDR und Mehrkanal zunächst ablehnen.

**Stücke:**
- nur Cluster (Cues und Void werden verworfen);
- Blöcke nur `SimpleBlock`/`BlockGroup` (mit `BlockDuration`, `ReferenceBlock`, **`DiscardPadding`** – für Opus-Ende zwingend übernehmen);
- **keine Lacing** und keine BlockAdditions in Stufe 1;
- Blöcke nur TrackNumber 1; Video beginnt mit Keyframe; Zeiten innerhalb der Spur monoton;
- erster Block ≈ `S@t`/timescale (abzüglich `presentationTimeOffset`, Toleranz 1 Frame bzw. ≤ 20 ms);
- keine Lücke und keine Überlappung zum Vorgänger über der Toleranz;
- Größen- und Tiefengrenzen; unbekannte Größe nur bei Segment/Cluster im Eingang.

**Ausgabe:**
- **Neu einlesen** mit dem eigenen Leser **und** mit Media3 `MatroskaExtractor`;
- Sample-Anzahl je Spur gleich der Eingabe;
- Dauer Video/Ton ≈ MPD-Dauer (Toleranz wie S3);
- spulbar (Cues vorhanden, `SeekMap.isSeekable`);
- A/V-Versatz ≤ 1 Audio-Frame.

### B5. Dauer, Zeitstempel, Spuren

- **Ausgabe:** EBML-Header (`webm`), Segment mit bekannter Größe, SeekHead (Platz reserviert, am Ende nachgetragen), Info mit `TimecodeScale` 1 ms und **Duration** = max(Ende Video, Ende Ton).
- **Tracks:** 1 = VP9, 2 = Opus. Felder werden kopiert: CodecPrivate, CodecDelay, SeekPreRoll, Pixel- und Anzeigegröße, Colour.
- **Cluster:** je Video-Keyframe, höchstens ~5 s (relative Blockzeit int16 ≤ 32,767 s). Blöcke beider Spuren zeitlich verschränkt. **Cues** je Video-Keyframe am Ende.
- **Zeitbasis:**
  - Ein **gemeinsamer** Versatz wird abgezogen (kleinster Start über beide Spuren). Den relativen A/V-Versatz nie je Spur getrennt verschieben; im Versuch beginnt Video bei 7 ms und Ton bei 0.
  - `TimecodeScale` ≠ 1 ms im Eingang wird umgerechnet, mit Rundungsprüfung.
- **Spuren:** Stufe 1 hat genau eine Videospur und eine gewählte Tonspur. Die Quelle hat 7 Opus-Darstellungen, die Sprache wird im Blatt gewählt wie bei S3c. Mehrere Tonspuren in einer Datei kämen in Stufe 2.
- **Speicherung:** MediaStore `video/webm`, Endung `.webm`, Ordner `Download/Video-Assistent`. Datei wird gestreamt geschrieben, nicht im RAM gehalten.

### B6. Aufwand und Risiken

| Paket | Inhalt | Schätzung |
|---|---|---|
| B-0 | Fixtures und Generator (ffmpeg VP9/Opus, `$Time$`/`$Number$`) plus Negativ-Fixtures: Lacing, ContentEncodings, Profil 2/HDR, Mehrkanal, BlockAdditions, Cues im Stück, Lücke/Überlappung, Zeitsprung, unbekannte Elemente | 2 Tage |
| B-1 | strenger EBML/WebM-Leser, Init- und Stückprüfung (JVM) | 3 Tage |
| B-2 | WebM-Schreiber: Mux, Cues, Duration, SeekHead (JVM, Golden-Tests) | 3–4 Tage |
| B-3 | Profil S4w in `DashProfile` (Java) **und** Kadri-Gate `src/039` (JS, Kreuzvektoren wie die 24 Golden-Vektoren); Protokoll: Fähigkeit `dash.webm`, Container in `dashplan`/Status; Texte im Blatt | 2–3 Tage |
| B-4 | Android: Zweig in `DashEngine`, MediaStore, Verifikation (Media3-Extractor + MediaCodec-Probe), Emulator API 26/29/34 | 3 Tage |
| B-5 | E2E Kadri ↔ echter Helfer-Harness, Mutationsproben, Doku | 2 Tage |
| | **Summe** | **≈ 15–18 Arbeitstage**, danach eine Samsung-Testrunde |

**Risiken:**
- WebM-Wiedergabe in Samsung-Galerie und -Videoplayer (Gerätetest; VLC als Gegenprobe);
- Opus Pre-skip/DiscardPadding falsch übernommen (hörbare Knackser, Dauer ±): eigene Tests;
- Stücke ohne Keyframe-Anfang;
- große Dateien (> 4 GB, lange Filme) und Speicherplatz;
- HDR/Profil 2 und Mehrkanal sind zunächst ausgeschlossen. Das ist absichtlich: ablehnen statt still falsch.
- **Teil B allein hilft auf dieser Seite nicht.** Ohne Lösung von A bleibt sie `suspected`.

### B7. Teststrategie

- **JVM:**
  - EBML-Grenzfälle (vint 1–8 Byte, unbekannte Größe, Grenzen, gekürzte Daten);
  - Fuzz/Mutation (abgeschnitten, Größen gekippt): nur `DashException`, kein OOM, kein Hänger.
- **Golden:** Ausgabe der Fixture gegen ffprobe (Spuren, Dauer, Paketanzahl) und **Frame-MD5 je Spur** (`ffmpeg -f framemd5 -c copy`). Die Ausgabe muss byte-gleiche Frames wie die Eingabe haben, nur neu verpackt.
- **Dekodieren:** `ffmpeg -v error -i out.webm -f null -` ohne Fehler, auch nach `-ss` (Spulen).
- **Emulator API 26/29/34:**
  - voller `DashEngine`-Weg mit lokalem Testserver;
  - MediaStore-Eintrag;
  - Media3-Extractor: spulbar, Dauer;
  - MediaCodec dekodiert die ersten und letzten Frames;
  - Abbruch und Fortsetzen.
- **Kadri:**
  - Gate-Vektoren S4w (JS = Java);
  - Blatt zeigt „WebM“;
  - alte Helfer ohne `dash.webm` → kein Angebot.
- **Samsung (nach Freigabe eines Builds):** öffentliche VP9/Opus-DASH-Testseite (wie `p4-hls.html`). Fälle: Download, Wiedergabe in Galerie und Player, Spulen, Tonsprache, Netzabbruch und Fortsetzen, Abbruch.

---

## Grenzen eingehalten

- Keine Codeänderung in den Repositories.
- Kein Push, kein Merge, keine APK, keine Beta.
- Keine Sicherheitssperre gelockert, keine automatische Downloadfreigabe.
- Keine Installation und keine Änderung am Samsung.
- Die Versuche nutzen nur selbst erzeugte Testdaten. Keine Seitennamen, Adressen oder Gerätedaten in den Dateien.

## Erbetene Entscheidungen

1. **Stufe 0:** Bitte die genannten Diagnosezeilen aus dem Player-Fenster schicken. Danach kann ich H1/H2/H3 eingrenzen.
2. **Stufe 1 oder 2:** Freigabe für `chrome://net-export` (Offline-Skript von mir, Datei bleibt bei dir) oder USB-Debugging?
3. **Richtung A:** Den Inhaltsbeleg `dash-bytes` (A5) als nächsten Entwurf ausarbeiten? Erst Code und Tests auf einem Testbranch, ohne Lieferung.
4. **Richtung B:** W1 (eigener WebM-Schreiber, Ausgabe `.webm`) bestätigen? Vorher prüfe ich, was der gepinnte Media3 1.11.1 tatsächlich kann (WebM-Muxer ja/nein, VP9/Opus im Mp4Muxer).
