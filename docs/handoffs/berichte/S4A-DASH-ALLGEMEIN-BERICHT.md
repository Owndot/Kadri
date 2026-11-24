# S4a – Allgemeine DASH-Unterstützung: Analyse, Ursachen, UI-Spezifikation, Matrix, Plan S4b/S4c

Stand 23.11.2026.

**Was S4a ist:** reine Analyse und Prüfstand.
- Kein Produktcode geändert, keine Sicherheitsregel geändert.
- Keine APK, keine ZIP, kein Merge, keine Beta. Am Samsung nichts geändert.
- Neu ist nur Testmaterial auf dem Testbranch `test/s4a-dash-matrix` (siehe §8).

**Grundsatz:** Keine Domain-Sonderregel. Alle Szenarien laufen auf zwei neutralen lokalen Hosts:
- „Seite“ `127.0.0.1`;
- „CDN“ `cdn.example.org`, im Browser lokal aufgelöst.

Gemessen wurde mit der echten Erweiterung (Testbuild 1.12.18) und dem echten Helfer-Kanal (`3887569` = `ee54864` + Testcode).

---

## 1. Kurzfassung

1. **Der Kern trägt.** Ohne Lockerung bindet Kadri korrekt bei:
   - drei Player-Architekturen im Hauptthread: eigener Player (fetch), dash.js 4.7.4 (XHR), Shaka 4.11.7 (fetch);
   - allen SegmentTemplate-Formen: `$Number$` mit Timeline, `$Number$` mit fester Dauer, `$Time$` mit Timeline;
   - SegmentList mit Timeline;
   - 301-Umleitung von MPD und Stücken (Fall S3h);
   - je Stück 302 auf signierte CDN-Adressen;
   - absoluter CDN-BaseURL;
   - fremd-originigem iframe, auch zweifach verschachtelt;
   - Vorspann vor dem Hauptvideo im selben Element.

   Für `$Time$`, signierte Weiterleitungen und SegmentList+Timeline lief der Download bis zur fertigen Datei (824 580 Byte, wie S3h).
2. **Die Ursachen sind allgemein, nicht seitenspezifisch:**
   - unsichtbare Ladevorgänge: Worker, MSE im Worker, srcdoc-Fenster;
   - Ausweich-CDN über mehrere BaseURL;
   - Query-Token an den Stücken;
   - Fenster-Relay der Planung bei iframe-Playern;
   - abweichende Vorprüfung zwischen Kadri und Helfer;
   - Byte-Bereichs-Formen;
   - Codecs (VP9/Opus, HE-AAC).
3. **Die UI vermischt die Ebenen nachweislich.** In 8 Matrix-Szenarien zeigt Kadri „… derzeit nicht unterstützt“, obwohl Format und Helfer den Stream unterstützen und **nur die Zuordnung fehlt**. In 3 weiteren nennt die Hauptzeile „derzeit nicht unterstützt“ statt des konkreten Formats.
4. **Sicherheit:** In allen Läufen hat Kadri **nie falsch gebunden**:
   - Gegenproben ohne Bindung: falscher Host, Query-Token, Ausweich-CDN, Byte-Bereiche, MPD aus JSON;
   - zwei Videos gleichzeitig → keine Bindung;
   - Vorspann knapp vor dem Hauptvideo → keine Bindung;
   - realistischer Vorspann → Bindung an das Haupt-MPD, belegt über die Planoptionen 360p + 180p.

   Kein Helferabruf trug Cookie oder Authorization.
5. **WebM:** Media3 **1.11.1** (gepinnt) enthält `WebmMuxer`. Er schreibt nur VP8/VP9 + Opus/Vorbis und erzeugt eine spulbare Datei: Duration, Cues und SeekHead werden beim Schließen nachgetragen. CodecDelay/SeekPreRoll für Opus fehlen; das ist auf Emulatoren zu prüfen. Für VP9 + Opus ist **WebM-Ausgabe** gegenüber erzwungenem MP4 klar vorzuziehen (§6).

---

## 2. Heutige Architektur und ihre Grenzen

| Ebene | Wo (Kadri) | Was heute passiert | Grenze (gemessen) |
|---|---|---|---|
| **E1 Manifest erkannt/gelesen** | `page.js` (MAIN-Welt, alle Fenster außer about:blank/srcdoc) hakt `fetch`/`XHR` und liest MPD-Text; `src/040 notePlaylist` | MPD-Text aus Antworten der **Fenster-Hauptthreads**, `finalUrl` als Basis (S3h) | **Worker-Abrufe unsichtbar** (b1, b2: „gemeldete Listen 0“). **srcdoc-Fenster** ohne page.js (c2). **MPD aus API-JSON** (g1). Chrome-Build hat **kein `webRequest`** (nur `storage`, `declarativeNetRequestWithHostAccess`, `scripting`). Der Kommentar in `src/040` („auch aus Workern … per Content-Type“) gilt für Chrome nicht. |
| **E2 Bindung an das Video** | `src/038 dashSegmentIndex/dashMatchSegment/dashBindDecision`, `src/060 dashBindingFor` (PerformanceObserver im Fenster-Hauptthread, `from = loadstart − 3 s`) | Nur exakte Adresse (Schema, Host, Pfad, Query); ≥ 3 Stücke in Folge, ≤ 45 s Spanne, ≤ 20 s alt; genau ein Kandidat | **Erste BaseURL only** (d5). **Query-Token** (d4). **Byte-Bereiche** nicht prüfbar (e1). Treffer kurz vor dem `loadstart` des Hauptvideos zählen 3 s mit → **Konkurrenz** mit eng anschließendem Vorspann (f1b). |
| **E3 Format/Adressierung** | `src/039 dfpGate` (Kadri-Vorprüfung) | nur fMP4, H.264 (avc1/avc3) + AAC-LC `mp4a.40.2`, statisch, 1 Periode, ohne DRM | VP9/Opus, WebM, HE-AAC → `dash-codec`/`dash-audio-codec`. **Weicht vom Helfer ab:** e3 (Ton-Abdeckung, Kadri „bestanden“, Helfer `coverage-mismatch`). d5 (Kadri „nicht prüfbar“, Helfer `baseurl-multiple`). |
| **E4 Helfer-Fähigkeit** | `src/080 helperDl('caps')`, `hdlCapsNote` | `caps.dash` | **im iframe:** „Helfer-Fähigkeiten: noch nicht abgefragt“, obwohl ⬇ im Hauptfenster getippt wurde – die Fähigkeit wird je Fenster gehalten |
| **E5 Planung/Download/Remux** | Helfer `DashManifest/DashProfile/DashEngine`, Media3 `Mp4Muxer` 1.11.1 | Helfer lädt MPD selbst (ohne Cookie/Auth), plant, lädt, remuxt nach MP4 | **iframe-Relay:** Angebot erscheint, Planung kommt oft nicht zurück (c1/c3, §3 U4) |

**UI-Ebene** (`src/105 pageDlReason/pageDlReasonSub`, `src/180` Zeilen 537–554, Registry-Zeile `src/045`) – heute fünf Texte für alle Fälle:
- „DASH-Stream erkannt – derzeit nicht unterstützt“ (gebunden; Grund in der Unterzeile);
- „Vermutlich DASH-Stream – nicht sicher zugeordnet und derzeit nicht unterstützt“ (**jede** fehlende Bindung);
- „Quelle nicht sicher diesem Video zugeordnet – Video kurz abspielen und erneut tippen“ (auch bei Byte-Bereichen, wo erneutes Abspielen nichts ändert);
- „Keine speicherbare Videodatei erkannt …“;
- Registry/Diagnose bei jedem DASH-Eintrag: `Download unavailable(stream-not-supported)`, auch wenn gebunden und angeboten.

---

## 3. Allgemeine Ursachen – priorisiert, mit Nachweis

Die Kennungen (a1 …) sind die Szenarien des Prüfstands (§5). „Abgleich“ = Zeile `DASH-Abgleich` der anonymen Diagnose.

| Prio | Ursache (allgemein) | Nachweis | Häufigkeit / Wirkung | Richtung (S4b) |
|---|---|---|---|---|
| **U1** | **Fenster-Relay der DASH-Planung (iframe-Player)** | c1, c3: Bindung im eingebetteten Fenster korrekt (`bound (stueckfolge)`, Stücke exakt 11, Init 2), Angebot im Hauptfenster sichtbar. Nach dem Tipp: Toast „Helfer-App prüft den Stream …“ bleibt stehen, keine Auswahl. Über alle Läufe erreichte c1 nur **1 von 10** Mal die Auswahl, c3 **0 von 6** Mal. In einem Teil der Läufe lud der Helfer das MPD (dashplan kam an), in anderen nicht. Fenster-Diagnose: „Helfer-Fähigkeiten: noch nicht abgefragt“, „Helfer-Downloads: -“. | Eingebettete Player sind sehr verbreitet. **Produktfehler** auf der Bedienstrecke, nicht in der Bindung. | Ursache isolieren (Anfrage/Antwort zwischen Fenster-Kadri, Hintergrund und Hauptfenster-Auswahl), Fix, Matrix c1/c3 5 von 5. |
| **U2** | **Unsichtbare Ladevorgänge:** Worker-fetch, MSE im Worker, srcdoc-Fenster | b1 (fetch im Worker): „gemeldete Listen 0“, kein Manifest, keine Stückprüfung. b2 (MediaSource im Worker): ebenso. c2 (srcdoc): page.js fehlt, nur `ambiguous(near)`. S3e: Worker-Abrufe fehlen im Fenster-PerformanceObserver, MSE-Anhänge im Hauptthread sind sichtbar (bei b2 **nicht**). | Moderne Player können Abrufe in Worker auslagern. Heute: weder Manifest noch Stücke → keine Bindung. **Sicher** (keine falsche Bindung), aber kein Angebot. | Zwei Wege, beide **genehmigungspflichtig** (§7, S4b-7): (a) Chrome-Berechtigung `webRequest` nur beobachtend (Adresse, Zeit, Tab, Fenster – kein Inhalt, keine Kopfzeilen) für Stück-Evidenz auch aus Workern; MPD-Inhalt holt **der Helfer** beim Tipp (wie heute bei dashplan); (b) `dash-bytes`: Hash der MSE-Anhänge im Hauptthread gegen helfergeladene Stücke (hilft b1, nicht b2). srcdoc: `match_about_blank`/`match_origin_as_fallback` für page.js prüfen. |
| **U3** | **Ausweich-CDN: mehrere BaseURL** | d5: Player nutzt die zweite BaseURL. Abgleich „gleicher Pfad, anderer Host 8“, Stücke exakt 0. Kadri indiziert nur die erste BaseURL. Kadri-Vorprüfung „nicht prüfbar“; Helfer: `DashException: baseurl-multiple`. | DVB-DASH und große Anbieter nutzen mehrere BaseURL. | Alle **im MPD erklärten** Alternativen indizieren. Gebunden wird nur, wenn die beobachtete Folge genau zu **einer** erklärten Alternative passt (keine Lockerung: nur MPD-eigene Hosts). Der Helfer übernimmt die beobachtete Alternative als Hinweis, nur aus der erklärten Menge. |
| **U4** | **Query-Token an den Stücken, das das MPD nicht nennt** | d4: MPD `?tok=…`, Player hängt es an jedes Stück. Abgleich „nur Query abweichend 8“, exakt 0 → keine Bindung. | Häufig bei CDN-Token-Weitergabe. | Nur **standardisiert**: `UrlQueryInfo` (ISO/IEC 23009-1, Anhang I, `urn:mpeg:dash:urlparam:2014`) im MPD → erwartete Query = MPD-Query. Ohne Erklärung im MPD bleibt es bei „nicht gebunden“ mit konkretem Grund. Eine Heuristik „MPD-Query geerbt“ nur nach gesonderter Freigabe. |
| **U5** | **Vorprüfung Kadri ≠ Helfer** | e3: Kadri „Vorprüfung bestanden“, Angebot gezeigt; Helfer lehnt beim Plan mit `dash_addressing` ab (JVM: Ton `coverage-mismatch`, MPD beschreibt 24 s statt 20 s). Nutzer sieht erst nach dem Tipp „Stream-Form nicht unterstützt“. d5 analog (`baseurl-multiple`). | Jede Abweichung erzeugt ein Angebot, das dann scheitert. | Gemeinsame **Profil-Golden-Vektoren** (wie beim Fingerabdruck S3c), Kadri prüft Abdeckung/Mehrfach-BaseURL wie der Helfer. |
| **U6** | **Vorspann/Werbung unmittelbar vor dem Hauptvideo** | f1 (Vorspann spielt ≥ 6 s): **bound an das Haupt-MPD** (Optionen 360p + 180p; das Vorspann-MPD hat nur 180p). f1b (Haupt-MPD 2,5 s nach dem Vorspann geladen): beide `konkurrenz`, kein Angebot. | Vorgeladene Werbung kurz vor dem Hauptinhalt. Heute **sicher** (keine falsche Bindung), aber kein Angebot. | Verschärfung, keine Lockerung: Treffer nur ab dem `sourceopen` der **aktuellen** MediaSource des Elements zählen (Medien-Epoche je MSE statt `loadstart − 3 s`). |
| **U7** | **Byte-Bereiche** (eine Datei je Darstellung: SegmentList `mediaRange` / SegmentBase) | e1: `ambiguous (nicht-pruefbar)`, Vorprüfung „nicht prüfbar“. Helfer schließt `byte-range` aus. Menü rät fälschlich „Video kurz abspielen …“. | On-Demand-Profil, seltener im Web. | Zuerst nur Diagnose/UI korrekt. Bindung über (Adresse, Bereich) nur mit Range-Sicht (`webRequest` + `extraHeaders`) → nach U2-Entscheidung. |
| **U8** | **Manifest nicht als MPD-Abruf** (aus API-JSON, im Player erzeugt) | g1: kein Manifest, „Keine speicherbare Videodatei erkannt“. | Selten bis mittel. | Nur Diagnose („Stream ohne lesbares Manifest“). Kein Auslesen fremder JSON-Strukturen als Quelle (unsichere Zuordnung). |
| **U9** | **Codecs/Container** | h1 VP9+Opus WebM, h2 VP9+Opus fMP4: `bound (stueckfolge)` · Vorprüfung `dash-codec`. h3 AAC als `mp4a.40.5`: `dash-audio-codec`. | Der ursprüngliche Samsung-Befund (S3e) war VP9/Opus/WebM. | S4c (§6, §7). |
| – | Zwei Videos spielen gleichzeitig | f2: beide `mehrere-videos`, kein Angebot | gewollt (Sicherheit) | nur Text: „andere Videos anhalten“ |

Ebenfalls geprüft und **ohne Befund**:
- **Weiterleitungen:**
  - d1 (301 wie githack, dash.js löst gegen `responseURL` auf) → bound.
  - d3: Jedes Stück wird per 302 auf eine signierte CDN-Adresse umgeleitet. Die Zeitleiste nennt die Ausgangsadresse, die exakt im MPD steht → bound. Der Helfer folgte den Weiterleitungen, die Datei ist vollständig.
- **Host-Wechsel über absolute BaseURL** (d6) → bound.
- **Gegenprobe d2** (Auflösung gegen angefragte Adresse = S3h-Fehler) → korrekt nicht gebunden.
- **Adressierungen** a4 (`$Number$` mit Dauer), a5 (`$Time$`) und e2 (SegmentList + Timeline, Shaka) → bound, Plan.
- **Downloads:** Für a5 und e2 lief der Download bis zur fertigen Datei, für d3 ebenso.
- **Nebenbefund dash.js 4.7.4:** Bei SegmentList **mit** SegmentTimeline fordert dash.js Stück 1 fünfmal an und kommt nicht weiter. Kadri bindet dann richtig nicht (`zu-wenig-folge`). Die Matrix nutzt dafür Shaka.

---

## 4. Diagnose- und UI-Spezifikation (S4b)

### 4.1 Ebenenmodell (eine reine Funktion, Kadri)
`dashLevels(snapshot, offer, caps, job)` → je Ebene **Zustand + fester Code**, die erste nicht erfüllte Ebene bestimmt die Hauptzeile:

| Ebene | ok | Codes (nicht ok) |
|---|---|---|
| E1 Manifest | `read` | `none` (kein MPD gesehen) · `unread` (Adresse bekannt, Text nicht gelesen) · `invalid` (kein gültiges MPD) · `too-large` |
| E2 Bindung | `bound` | `no-hits` mit Unterklasse aus dem Abgleich: `host` · `query` · `number` · `none` · `invisible` (MSE aktiv, aber 0 beobachtete Medienabrufe) · `few` (zu-wenig-folge) · `stale` (nicht-aktiv) · `multi-video` · `competing` · `duration` · `uncheckable` (Byte-Bereiche/Einzeldatei) |
| E3 Format | `ok` | `video-codec:<familie>` · `audio-codec:<familie>` (aac-he, opus, …) · `container:<webm>` · `addressing:<form>` · `live` · `protected` · `multiperiod` · `duration` · `unchecked` (Vorprüfung nicht möglich) |
| E4 Helfer | `ok` | `unpaired` · `unreachable` · `no-dash` · `unknown` (noch nicht abgefragt) |
| E5 Plan/Download | `planned`/`done` | `plan:<helfer-grund>` (z. B. `dash_addressing/coverage`) · `fetch:<grund>` · `remux:<grund>` · `cancelled` |

**Anonyme Diagnose**, neue Zeile:

`DASH-Ebenen: Manifest gelesen · Bindung nein (no-hits/host) · Format ok · Helfer ok · Plan –`

Die Registry-Zeile `Download unavailable(stream-not-supported)` entfällt für DASH. An ihre Stelle tritt die erste nicht erfüllte Ebene.

### 4.2 Texte (Hauptzeile · Unterzeile), nie „nicht unterstützt“, wenn nur E1/E2 fehlt

| Fall | Hauptzeile | Unterzeile |
|---|---|---|
| E1 `none`/`unread` bei laufendem MSE | DASH vermutet – Manifest nicht lesbar | Die Seite lädt den Stream verdeckt (z. B. im Hintergrund-Thread) |
| E2 `host` | DASH-Stream erkannt – Zuordnung nicht nachgewiesen | Stücke kommen von einem anderen Server als im Manifest angegeben |
| E2 `query` | (wie oben) | Stück-Adressen tragen Zusatzparameter, die das Manifest nicht nennt |
| E2 `invisible` | (wie oben) | Ladevorgänge der Seite sind nicht sichtbar (Hintergrund-Thread) |
| E2 `few` / `stale` | (wie oben) | Video einige Sekunden weiterlaufen lassen und erneut tippen |
| E2 `competing` | (wie oben) | Mehrere Streams passen (z. B. Werbung) – nach der Werbung erneut tippen |
| E2 `multi-video` | (wie oben) | Mehrere Videos spielen – andere anhalten und erneut tippen |
| E2 `duration` | (wie oben) | Länge des Streams passt nicht zum Video |
| E2 `uncheckable` | DASH-Stream erkannt – Zuordnung hier nicht möglich | Stream-Form (Byte-Bereiche einer Datei) erlaubt keinen sicheren Nachweis |
| E3 `video-codec`/`audio-codec`/`container` | DASH-Stream zugeordnet – Format wird noch nicht gespeichert | konkret: „Video VP9 · Ton Opus (WebM)“ bzw. „Ton HE-AAC (nur AAC-LC)“ |
| E3 `live`/`protected`/`multiperiod` | DASH-Stream zugeordnet – nicht speicherbar | Live-Stream · geschützt (DRM) · mehrere Abschnitte |
| E3 `unchecked` | DASH-Stream zugeordnet – Manifest nicht prüfbar | z. B. „mehrere Server-Alternativen im Manifest“ |
| E4 | DASH-Stream zugeordnet – Helfer-App kann ihn nicht speichern | Helfer-App ohne DASH · nicht erreichbar · nicht gekoppelt |
| E5 `plan:*` | (Toast) Helfer-App: Stream-Form nicht speicherbar | konkret (Abdeckung, Lücke, Adressierung) |
| alles ok | DASH-Stream mit Helper herunterladen … | als MP4/WebM · Qualität und Ton wählen |

**Regeln:**
- Feste Texte, keine Adresse.
- Englische Übersetzung je Text.
- Player-Menü (`src/180`) und Webseiten-Knopf (`src/105`) nutzen **dieselbe** Funktion.
- Der Diagnose-Hinweis „Hinweis im Menü“ zeigt denselben Text.
- „derzeit nicht unterstützt“ darf nur bei E3/E4 stehen.

**Gemessene Abweichungen von dieser Regel (heute):**
- „Vermutlich DASH-Stream – nicht sicher zugeordnet und **derzeit nicht unterstützt**“ bei b1, b2, c2, d2, d4, d5, f1b, f2: Format H.264/AAC und Helfer würden speichern.
- „Quelle nicht sicher … – Video kurz abspielen und erneut tippen“ bei e1: falscher Rat.
- „DASH-Stream erkannt – derzeit nicht unterstützt | Format nicht unterstützt (nur H.264 mit AAC)“ bei h1/h2: Die Hauptzeile nennt das Format nicht.

---

## 5. Prüfstand und Ergebnis (Endlauf)

`tests/s4a_dash_player_matrix.py`, lokal, nicht in CI.

**Material:**
- S3d-Fixture: H.264 + AAC-LC, 20 s;
- `tests/make_s4a_fixtures.sh`, **bitgleich reproduzierbar** (zweimal erzeugt, 31 Prüfsummen gleich): Einzeldatei mit Byte-Bereichen, VP9+Opus WebM, VP9+Opus fMP4.

**Player:**
- dash.js 4.7.4: `dashjs-4.7.4.tgz` sha256 `62a9c283…78ed`, `dash.all.min.js` `3a1db51e…0df`;
- Shaka 4.11.7: `shaka-player-4.11.7.tgz` sha256 `81e4c1c9…656a`, `shaka-player.compiled.js` `d2df9207…8553`;
- eigener Testplayer `tests/web/s4a/own.js` + `own-worker.js` für Architekturen, die dash.js/Shaka nicht abbilden: Worker, MSE im Worker, Auflösung gegen angefragte Adresse, Query-Weitergabe, Ausweich-BaseURL, MPD aus JSON, zwei Videos, Vorspann.

**Hart geprüft:** nur Sicherheit.
- „nie binden“ bei d2, d4, d5, e1, g1;
- „richtiges Manifest“ bei f1/f1b;
- Diagnose anonym.

Alles andere wird gemessen.

Endlauf `matrix-endlauf.log`: **35 von 35** Prüfungen bestanden, 26 Szenarien.

| Szenario | Beschreibung | MPD gelesen | Bindung (Grund) | Abgleich: exakt · nur Query · anderer Host | Vorprüfung | Angebot/Menü heute | Plan / Datei |
|---|---|---|---|---|---|---|---|
| a1 | eigener Player, Hauptthread, fetch · Timeline + $Number$ | ja | bound (stueckfolge) | 8 · 0 · 0 | bestanden | Angebot | Optionen 360p + 180p |
| a2 | dash.js 4.7.4, Hauptthread, XHR · Timeline + $Number$ | ja | bound (stueckfolge) | 11 · 0 · 0 | bestanden | Angebot | Optionen 360p + 180p |
| a3 | Shaka 4.11.7, Hauptthread, fetch · Timeline + $Number$ | ja | bound (stueckfolge) | 10 · 0 · 0 | bestanden | Angebot | Optionen 360p + 180p |
| a4 | dash.js · SegmentTemplate $Number$ mit fester Dauer (ohne Timeline) | ja | bound (stueckfolge) | 10 · 0 · 0 | bestanden | Angebot | Optionen 360p + 180p |
| a5 | dash.js · SegmentTemplate $Time$ + Timeline | ja | bound (stueckfolge) | 11 · 0 · 0 | bestanden | Angebot | Optionen 360p + 180p · Datei 824580 B |
| b1 | eigener Player · MPD und Stücke per fetch im Dedicated Worker, MSE im Hauptthread | nein | vermutet (near) | – · – · – | – | Vermutlich DASH-Stream – nicht sicher zugeordnet und derzeit nicht unterstützt | – |
| b2 | eigener Player · MediaSource im Dedicated Worker (MediaSourceHandle) | nein | vermutet (near) | – · – · – | – | Vermutlich DASH-Stream – nicht sicher zugeordnet und derzeit nicht unterstützt | – |
| c1 | dash.js in fremd-originigem iframe (CDN-Host) | ja | bound (stueckfolge) | 11 · 0 · 0 | bestanden | Angebot | Helfer-App prüft den Stream … (hängt, U1) |
| c2 | eigener Player in srcdoc-iframe | nein | vermutet (near) | – · – · – | – | Vermutlich DASH-Stream – nicht sicher zugeordnet und derzeit nicht unterstützt | – |
| c3 | dash.js zweifach verschachtelt (Seite → fremd → Seite) | ja | bound (stueckfolge) | 11 · 0 · 0 | bestanden | Angebot | Helfer-App prüft den Stream … (hängt, U1) |
| d1 | dash.js · MPD + Stücke 301 auf CDN-Host (wie githack), Auflösung gegen endgültige Adresse | ja | bound (stueckfolge) | 11 · 0 · 0 | bestanden | Angebot | Optionen 360p + 180p |
| d2 | eigener Player · wie d1, aber Auflösung gegen ANGEFRAGTE Adresse (Gegenprobe, Fehler S3h) | ja | ambiguous (keine-treffer) | 0 · 0 · 8 | bestanden | Vermutlich DASH-Stream – nicht sicher zugeordnet und derzeit nicht unterstützt | – |
| d3 | dash.js · jedes Stück 302 auf signierte CDN-Adresse (?exp&sig) | ja | bound (stueckfolge) | 11 · 0 · 0 | bestanden | Angebot | Optionen 360p + 180p · Datei 824580 B |
| d4 | eigener Player · MPD mit ?tok=…, Token an jedes Stück angehängt (MPD nennt es nicht) | ja | ambiguous (keine-treffer) | 0 · 8 · 0 | bestanden | Vermutlich DASH-Stream – nicht sicher zugeordnet und derzeit nicht unterstützt | – |
| d5 | eigener Player · zwei BaseURL (Seite, CDN), Player nimmt die zweite (Ausweich-CDN) | ja | ambiguous (keine-treffer) | 0 · 0 · 8 | nicht prüfbar | Vermutlich DASH-Stream – nicht sicher zugeordnet und derzeit nicht unterstützt | – |
| d6 | dash.js · absolute BaseURL auf CDN-Host | ja | bound (stueckfolge) | 11 · 0 · 0 | bestanden | Angebot | Optionen 360p + 180p |
| e1 | dash.js · Einzeldatei je Darstellung, SegmentList mit mediaRange (Byte-Bereiche) | ja | ambiguous (nicht-pruefbar) | 0 · 0 · 0 | nicht prüfbar | Quelle nicht sicher diesem Video zugeordnet – Video kurz abspielen und erneut tippen | – |
| e2 | Shaka · SegmentList + SegmentTimeline mit einzeln signierten SegmentURL | ja | bound (stueckfolge) | 10 · 0 · 0 | bestanden | Angebot | Optionen 360p + 180p · Datei 824580 B |
| e3 | dash.js · SegmentList mit fester Dauer, Ton-Abdeckung im MPD falsch (24 s statt 20 s) – Vorprüfungs-Gegenprobe | ja | bound (stueckfolge) | 10 · 0 · 0 | bestanden | Angebot | Stream-Form nicht unterstützt |
| f1 | eigener Player · erst Vorspann-MPD (nur 180p, 3 Stücke), dann Haupt-MPD im selben Video | ja | ambiguous (keine-treffer); bound (stueckfolge) | 0 · 0 · 0 | bestanden | Angebot | Optionen 360p + 180p |
| f1b | eigener Player · wie f1, aber Haupt-MPD startet 2,5 s nach dem Laden des Vorspanns (Vorspann vorgeladen) | ja | ambiguous (konkurrenz); ambiguous (konkurrenz) | 6 · 0 · 0 | bestanden | Vermutlich DASH-Stream – nicht sicher zugeordnet und derzeit nicht unterstützt | – |
| f2 | eigener Player · zwei Videos gleichzeitig, zwei MPDs | ja | ambiguous (mehrere-videos); ambiguous (mehrere-videos) | 8 · 0 · 0 | bestanden | Vermutlich DASH-Stream – nicht sicher zugeordnet und derzeit nicht unterstützt | – |
| g1 | eigener Player · MPD-Text aus API-JSON (kein .mpd-Abruf) | nein | kein Manifest | – · – · – | – | Keine speicherbare Videodatei erkannt – Video abspielen und erneut tippen | – |
| h1 | dash.js · VP9 + Opus in WebM | ja | bound (stueckfolge) | 11 · 0 · 0 | dash-codec | DASH-Stream erkannt – derzeit nicht unterstützt · „Format nicht unterstützt (nur H.264 mit AAC)“ | – |
| h2 | dash.js · VP9 + Opus in fMP4 | ja | bound (stueckfolge) | 11 · 0 · 0 | dash-codec | DASH-Stream erkannt – derzeit nicht unterstützt · „Format nicht unterstützt (nur H.264 mit AAC)“ | – |
| h3 | eigener Player · AAC als mp4a.40.5 (HE-AAC) gekennzeichnet | ja | bound (stueckfolge) | 8 · 0 · 0 | dash-audio-codec | DASH-Stream erkannt – derzeit nicht unterstützt · „Tonformat nicht unterstützt (nur AAC-LC)“ | – |

Helfer-Abrufe: Cookie/Authorization in keinem Lauf (alle sauber).

---

## 6. Unterstützungsmatrix

**Legende:** ✓ belegt · ✗ nicht unterstützt · ○ offen/zu prüfen · – entfällt

### 6.1 Container und Segmentform

| Form | Kadri-Bindung | Kadri-Vorprüfung | Helfer-Profil | Beleg |
|---|---|---|---|---|
| fMP4 · SegmentTemplate `$Number$` + Timeline | ✓ | ✓ | ✓ | a1–a3, c1, c3, d1, d3, d6 |
| fMP4 · SegmentTemplate `$Number$` + Dauer | ✓ | ✓ | ✓ | a4 |
| fMP4 · SegmentTemplate `$Time$` + Timeline | ✓ | ✓ | ✓ Datei fertig | a5 |
| fMP4 · `$Time$` ohne Timeline | ✓ (nur Vielfache der Dauer) | ✗ `time-without-timeline` | ✗ | Code |
| fMP4 · SegmentList + Timeline | ✓ | ✓ | ✓ Datei fertig | e2 (Shaka) |
| fMP4 · SegmentList + Dauer | ✓ | ✓ (Abdeckung **nicht** geprüft) | ✓ nur bei exakter Abdeckung | e3 (U5) |
| Einzeldatei · SegmentList `mediaRange` / SegmentBase | ✗ nicht prüfbar | ✗ | ✗ `byte-range` | e1 |
| mehrere BaseURL (Ausweich-CDN) | ✗ (nur erste) | ✗ nicht prüfbar | ✗ `baseurl-multiple` | d5 (U3) |
| WebM-Stücke (Matroska) | ✓ | ✗ `dash-codec` | ✗ | h1 |
| Live (`dynamic`), Mehrperioden, ContentProtection | – | ✗ (gewollt) | ✗ | Code |

### 6.2 Codecs

| Video | Ton | Kadri heute | Helfer heute | Ziel |
|---|---|---|---|---|
| H.264 (avc1/avc3) | AAC-LC `mp4a.40.2` | ✓ | ✓ → MP4 | – |
| H.264 | HE-AAC v1 `mp4a.40.5` / v2 `mp4a.40.29` | ✗ `dash-audio-codec` (h3) | ✗ `codec_mismatch` (Fmp4Inspect) | MP4, S4c-6 |
| VP9 `vp09.*` | Opus | ✗ `dash-codec` (h1, h2) | ✗ | **WebM**, S4c-2…5 |
| VP9 | AAC / H.264 + Opus (gemischt) | ✗ | ✗ | zunächst nicht angeboten, eigener Grund |
| AV1, HEVC | beliebig | ✗ | ✗ | nicht Teil von S4 (WebmMuxer 1.11.1 kennt kein AV1) |

### 6.3 Sichere Bindung (Architektur)

| Architektur | heute | Beleg |
|---|---|---|
| Hauptthread fetch/XHR (eigener Player, dash.js, Shaka) | ✓ | a1–a3 |
| fremd-originiges iframe, auch verschachtelt | ✓ Bindung · ✗ Planung über Relay (U1) | c1, c3 |
| srcdoc-iframe | ✗ (nur vermutet) | c2 |
| Worker-fetch, MSE im Worker | ✗ (nichts sichtbar) | b1, b2 |
| MPD-Umleitung · Stück-Umleitung auf signierte Adressen · absolute CDN-BaseURL | ✓ | d1, d3, d6 |
| Query-Token nicht im MPD | ✗ (gewollt bis UrlQueryInfo) | d4 |
| Vorspann im selben Element | ✓ (≥ Vorspannlänge) · ✗ bei < 3 s Abstand | f1, f1b |
| zwei Videos gleichzeitig | ✗ (gewollt) | f2 |
| MPD aus JSON/erzeugt | ✗ | g1 |

### 6.4 Remuxer und Ausgabe (Helfer, Media3 1.11.1, minSdk der Module 23, App minSdk 26)

| Eingang | Weg | Ausgabe | API 26 / 29 / 34 |
|---|---|---|---|
| fMP4 H.264 + AAC-LC | Fmp4Inspect → `Mp4Muxer` | MP4 | ✓ (S3d-CI, Emulatoren 26/29/34) |
| fMP4 H.264 + HE-AAC | wie oben, `esds` unverändert durchreichen | MP4 | ○ (S4c-6; Wiedergabe HE-AAC in MP4 ist seit Android 4.1 Plattformformat, auf 26/29/34 zu belegen) |
| WebM VP9 + Opus | `MatroskaExtractor` (media3-extractor 1.11.1, schon Abhängigkeit) → `WebmMuxer` | **WebM** | ○ (S4c-4) |
| fMP4 VP9 + Opus | `FragmentedMp4Extractor` → `WebmMuxer` | **WebM** | ○ (S4c-4) |
| VP9 + Opus → MP4 | `Mp4Muxer` kann VP9 (`vpcC`) und Opus (`dOps`) | MP4 | **nicht empfohlen** (unten) |

**WebmMuxer 1.11.1 – geprüft (Bytecode der gepinnten AAR):**
- `@UnstableApi`.
- `isMimeTypeSupported`: **nur** `video/x-vnd.on2.vp8`, `video/x-vnd.on2.vp9`, `audio/opus`, `audio/vorbis`.
- `close()` erzeugt den letzten Cluster und schreibt **Cues** (`0x1C53BB6B`). Danach trägt es die Segmentgröße, **Info mit Duration** und **SeekHead** an reservierter Stelle nach.
  - Voraussetzung: seekbarer Ausgang (`SeekableMuxerOutput`); Datei ist ok.
- Cluster höchstens 2 s (`MAX_CLUSTER_DURATION_US`), Samples je Cluster zeitlich sortiert (PriorityQueue).
- **Audio-TrackEntry schreibt kein CodecDelay (0x56AA) und kein SeekPreRoll (0x56BB).** Für Opus steht der Pre-Skip zwar im OpusHead (CodecPrivate). Fehlendes SeekPreRoll kann aber nach dem Spulen kurze Störgeräusche geben. Auf API 26/29/34 prüfen (S4c-4); notfalls ergänzen, nur nach Befund.

**Warum WebM statt erzwungenem MP4:**
- Bei VP9 aus WebM fehlt in der Regel CodecPrivate. `Mp4Muxer` verlangt aber `csd-0` für `vpcC` („csd-0 is not found in the format for vpcC box“). Wir müssten `vpcC` aus dem VP9-Frame-Header selbst bauen.
- Opus in MP4 ist auf älteren Android-Versionen kein garantiertes Plattformformat; WebM mit VP9/Opus ist es. Die genaue Untergrenze belegt S4c-4 auf Emulatoren, nicht aus dem Gedächtnis.
- WebM-Ausgabe spart Umkodierung und Header-Synthese.

**HE-AAC gesondert:**
- Keine neue Engine nötig, aber drei echte Risiken:
  1. **Implizite SBR-Signalisierung:** AudioSpecificConfig mit AOT 2 → Abspieler zeigen halbe Abtastrate.
  2. **Explizit** (AOT 5/29): Kernrate gegenüber Ausgaberate bei `mdhd`-Zeitskala und Dauer.
  3. **HE-AAC v2 (PS):** Mono-Kern, Stereo-Ausgabe.
- Hier keine HE-AAC-Fixture erzeugbar (ffmpeg ohne HE-AAC-Encoder; h3 ist nur ein **umetikettiertes** AAC-LC, prüft also nur die Kadri-Vorprüfung).
- Vorschlag: Fixture auf dem Emulator mit `MediaCodec` (AAC-Encoder, Profil `AACObjectHE` und `AACObjectHE_PS`) erzeugen. Herkunft und Prüfsumme festhalten.

---

## 7. Plan S4b und S4c (kleine Schritte, je mit Matrix + bestehenden Regressionen, keine APK ohne GO)

### S4b – Ebenen, Texte, allgemeine Bindungsursachen (Kadri, wo nötig Helfer)
1. **S4b-1 Ebenenmodell:** `dashLevels` als reine Funktion + Diagnosezeile „DASH-Ebenen …“. Node-Tests je Code. **Kein** Verhaltenswechsel bei Angebot/Bindung.
2. **S4b-2 Texte** nach §4.2 in `src/105`, `src/180`, Registry/Diagnose und Englisch. Die Matrix prüft je Szenario den erwarteten Text, damit die Abweichungen aus §4.2 hart abgesichert sind.
3. **S4b-3 Fenster-Relay der Planung (U1):** Ursache isolieren (Bedienweg Hauptfenster → Fenster-Kadri → Kanal → zurück), Fix. Die Helfer-Fähigkeit wird im Hauptfenster abgefragt und dem Fenster übergeben. Abnahme: c1/c3 5 von 5 bis zur Auswahl, plus ein Download.
4. **S4b-4 Medien-Epoche je MediaSource (U6):** Treffer nur ab `sourceopen` der aktuellen MSE. Abnahme: f1b bindet an das Haupt-MPD (Optionen 360p + 180p); f1, f2 unverändert.
5. **S4b-5 Vorprüfungs-Gleichlauf (U5):** gemeinsame Profil-Vektoren Kadri ↔ Helfer (Abdeckung, Mehrfach-BaseURL, Adressierungen). Abnahme: e3 → kein Angebot, Grund „Stream-Form“ schon vor dem Tipp.
6. **S4b-6 Mehrere BaseURL (U3)**, Kadri und Helfer. Nur im MPD erklärte Alternativen; Bindung, wenn die Folge genau eine Alternative trifft. Der Helfer nimmt die beobachtete Alternative als Hinweis. Abnahme: d5 bound; Gegenprobe mit einem Host, der **nicht** im MPD steht → nie bound.
7. **S4b-7 Unsichtbare Ladevorgänge (U2) – nur Entscheidungsvorlage, keine Umsetzung ohne Freigabe:**
   - (a) Chrome-Berechtigung `webRequest`, nur beobachtend, nur Adresse/Zeit/Tab/Fenster;
   - (b) `dash-bytes` (MSE-Anhänge);
   - (c) `match_origin_as_fallback` für srcdoc.

   Mit Datenschutz- und Berechtigungsfolgen. Die Berechtigungswarnung im Store ändert sich bei (a) nicht, da `<all_urls>` schon besteht. Das ist noch auf der Zielplattform (Kiwi/Edge Android) zu prüfen.
8. **S4b-8 (optional, gesonderte Freigabe) `UrlQueryInfo` (U4)**: nur standardisierte Erklärung im MPD.

### S4c – Formate (Helfer, dann Kadri-Vorprüfung)
1. **S4c-1 Fixtures:**
   - VP9/Opus WebM und fMP4 sind mit `make_s4a_fixtures.sh` fertig;
   - Helfer-Kopie mit Prüfsummen;
   - HE-AAC v1/v2 auf dem Emulator per MediaCodec erzeugen, Herkunft dokumentieren.
2. **S4c-2 JVM-PoC WebM → WebM:**
   - Init + Cluster → `MatroskaExtractor` → `WebmMuxer`;
   - unabhängige Prüfung (ffprobe in CI und eigener EBML-Leser): Duration, Cues je Video-Keyframe, monotone Zeitstempel, A/V-Lage (Blitz und Ton alle 2 s), Spulen.
3. **S4c-3 fMP4 VP9/Opus → WebM** (FragmentedMp4Extractor → WebmMuxer), dieselben Prüfungen.
4. **S4c-4 Emulator 26/29/34:**
   - `MediaExtractor` + `MediaPlayer` + ExoPlayer öffnen, Dauer, Spulen auf 3 Positionen, A/V-Versatz;
   - Opus nach dem Spulen auf fehlendes SeekPreRoll prüfen;
   - MediaStore `video/webm` (29+) bzw. öffentlicher Download-Ordner (26–28) wie bei MP4.
5. **S4c-5 Profil/Gate:**
   - Helfer `DashProfile` + Kadri `dfpGate` erweitern: Ausgabe deterministisch (H.264+AAC → MP4, VP9+Opus → WebM);
   - gemischte Kombinationen mit eigenem Grund ablehnen;
   - Optionsbeschriftung „WebM · VP9 + Opus“, Dateiendung `.webm`.
6. **S4c-6 HE-AAC → MP4:** ASC-Auswertung (AOT 2/5/29, implizit/explizit) in Fmp4Inspect, `esds` unverändert, Emulator-Wiedergabe 26/29/34. Bis dahin eigener Grund „Ton HE-AAC“.
7. **S4c-7 Ende-zu-Ende:** Matrix h1/h2/h3 → Angebot, Plan, Download, Datei prüfen. Danach erst Test-APK/ZIP nach deinem GO.

**Media3:** Bei **1.11.1** bleiben (gepinnt, geprüft). 1.12.0-beta01 ist verfügbar, aber Beta → kein Wechsel in S4.

---

## 8. Sicherheitsgrenzen (unverändert, gelten für S4b/S4c)
- Keine DRM-Umgehung. ContentProtection bleibt ein Ausschluss.
- Keine unsichere Quellenzuordnung:
  - Bindung nur über beobachtete Stückfolgen exakter, im MPD erklärter Adressen;
  - nie über Zeitnähe, Videolänge oder ähnliche Adressen;
  - Erweiterungen (BaseURL-Alternativen, UrlQueryInfo) nur aus dem MPD selbst.
- Kein Weiterreichen von Cookies oder Authorization. In allen Matrix-Läufen trug kein Helferabruf eines davon.
- Keine unkontrollierten externen Abrufe: Kadri ruft weiterhin nichts selbst ab; der Helfer lädt nur nach Tipp, nur das gebundene MPD und dessen Stücke.
- Keine Domain-Sonderregeln.

## 9. Lieferung
- Testbranch `test/s4a-dash-matrix` = `72c4655` (auf `4290251`), nur Testmaterial. `main` unverändert (`cd00ded`):
  - `tests/s4a_dash_player_matrix.py`;
  - `tests/make_s4a_fixtures.sh`;
  - `tests/web/s4a/own.js`, `own-worker.js`.
- Dateien:
  - dieser Bericht;
  - `matrix-endlauf.log` (Endlauf);
  - `s4a-matrix.json` (Messwerte je Szenario, anonyme Diagnosen);
  - `iframe-wiederholungen.txt` (U1);
  - `kadri-s4a.patch`;
  - `fixtures-SHA256SUMS`;
  - `SHA256SUMS`.

**STOP** – zur technischen Prüfung und Freigabe von S4b (und Entscheidung zu S4b-7/-8).
