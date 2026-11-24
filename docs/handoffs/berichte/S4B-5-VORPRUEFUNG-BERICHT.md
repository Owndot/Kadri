# S4b-5 – Vorprüfungs-Gleichlauf zwischen Kadri und Helper

Stand 23.11.2026.

**Commits und Rahmen:**
- **Kadri:** `test/s4b-dash`, Commit `f237546` (auf `1494e56`).
- **Helper:** neuer isolierter Testbranch `test/s4b5-dash`, Commit `f38c689` (auf `c485bb5` = `origin/test/s3d-dash`). **Nur Tests und ein CI-Trigger, kein Produktcode.**
- `main` beider Repos und die P4-Lieferpins sind unverändert.
- Der Kadri-Harness-Pin (`vendor/dash-harness/SOURCE` → `3887569`) bleibt gültig, weil sich der Produktcode des Helpers nicht ändert.
- Keine APK, keine ZIP, keine Installation, kein Merge.
- Keine Website-Regel, keine neue Codec-Unterstützung, keine Berechtigungs- oder Netzänderung.

## 1. Ist-Zustand: Abweichungen vor S4b-5

**Referenz:** was der Helper bei `dashplan` entscheidet:
- `DashManifest.parse`: Lesen, Vererbung, Adressierung und Stückfolge (`compute`: Fenster, Abdeckung, Grenzen);
- `DashProfile.check`;
- `DashPlan.build`;
- `DashEngine.options`.

**Kadri (`src/039`):**
- `dfpModel`: Lesen, Vererbung und Adressierung, gleich wie beim Helper (S3c);
- `dfpGate`: Profil, aber nur „soweit ohne Stückfolge entscheidbar“;
- `dashOfferFor` (`src/105`) bot an, sobald `gate.ok`.

| # | Bereich | Helper (dashplan-Grund) | Kadri vorher | Folge vorher | Vektoren |
|---|---|---|---|---|---|
| 1 | Zeitleiste: Lücke, Überschneidung, r=-1 ohne Vielfaches, S@d=0, leer | je Darstellung `timeline-gap/-overlap/-repeat`, `zero-duration`, `timeline-empty` → `dash_addressing` | nicht geprüft | **angeboten**, Helper lehnt erst nach dem Tipp ab | n02 n03 n22 n23 |
| 2 | Abdeckung: Spur ≠ Periodendauer (Toleranz 1 s, Periodenfenster); SegmentList-Einträge ≠ ⌈Dauer/@duration⌉ | `coverage-mismatch` → `dash_addressing` | nicht geprüft | **angeboten** (e3) | n01 (=e3) n04 n05 |
| 3 | Grenzen je Spur: > 20 000 Stücke, Stück > 3600 s, Zahl > 2^53−1, Adresse > 4096 Zeichen | `segments`, `segment-duration`, `number-range`, `uri-length` → `dash_addressing` | nicht geprüft | **angeboten** | n20 n24 |
| 4 | Gesamtgrenze der Auswertung (> 1 000 000 Stücke je MPD) | fatal beim Lesen → `mpd_limits` | nicht geprüft | **angeboten** | n21 |
| 5 | Plan: > 256 Paare, gleiche Adressen zweier Spuren, > 16 GiB je Paar | `options_limit`, `track_collision`, `size_limit` | nicht geprüft | **angeboten** | n25 n26 n27 |
| 6 | Optionen: Journalgrenze (Video + Ton > 20 002 Ressourcen) | `segments_limit` | nicht geprüft | **angeboten** | n28 |
| 7 | nur HE-AAC | Profil nimmt an, Optionen entfallen → `audio_codec` | Profil lehnt ab: `dash-audio-codec` | gleiche Folge, **anderer Code** | n12, S3c `vod-segmentlist` |
| 8 | Ton-Codec (z. B. Opus) | `dash_codec` | `dash-audio-codec` | gleiche Folge, anderer Code | n10 |
| 9 | Zusammenfassung „Adressierung“ | feste Liste (ADDRESSING, 20 Gründe) | engere Regex – neue Gründe wären `dash-unsupported` geworden | (vorher nicht erreichbar) | n02…n24 |
| 10 | mehrere BaseURL auf einer Ebene (d5) | fatal → `mpd_baseurl_multiple` | kein Abdruck (`baseurl-multiple`), Meldung „Stücke kommen von einem anderen Server“ bzw. „nicht prüfbar“ | gleiche Folge, **unklarer Grund** | n19 |
| 11 | andere fatale Lesefehler | `mpd_<grund>` | kein Abdruck, gleicher Grund | gleich | n17 n18 |
| 12 | Live, Typ, Perioden, DRM, Dauer unbekannt/zu lang, ohne Video/Ton, Container/Codec Video, gemuxt, Init fehlt, Byte-Bereiche, $Time$ ohne Zeitleiste, EssentialProperty | Profilgründe | gleich (S3c) | gleich | n06–n09 n11 n13–n16 n29–n31 |
| 14 | zwei Ton-Sets mit derselben Darstellungs-ID (gleiche Init-/Stückadressen) | `track_collision` (am echten Helfer-Code geprüft: `befund-ton-gemischt-helfer.log`) | ok – **angeboten**; der alte Test `test_dash_fp` „Ton gemischt“ hatte genau das festgeschrieben | **angeboten** | test_dash_fp |
| 13 | MPD > 4 MB | Abruf → `manifest_size` | kein Abdruck (`too-large`) | beide kein Angebot, Kadri ruft dashplan nie; **Code verschieden** (nicht als Vektor: 2 × 4 MB im Repo) | – |

**Ergebnis:**
- In 15 der 31 Ablehnungsvektoren hätte Kadri **angeboten**, obwohl der Helper ablehnt; dazu kommt Zeile 14 aus einem bestehenden Kadri-Test.
- In 3 weiteren (n10, n12, n19) stimmte die Folge, aber Code bzw. Meldung wichen ab.

## 2. Architekturentscheidung

- **Referenz ist der Helper**, sein Produktcode bleibt unverändert. Kadri überträgt dessen manifestabhängige Schritte 1:1 und deterministisch in `src/039`:
  - `dfpPeriodTiming` ← `DashManifest.periodTiming`
  - `dfpCompute`/`dfpExpand` ← `DashManifest.compute`/`expand`: Läufe, Periodenfenster, Abdeckung in exakter Arithmetik (BigInt, Dauern × 10^15, Rundung HALF_EVEN auf 10^-9 s wie `BigDecimal`), dieselben Grenzen, dieselben geteilten Stückfolgen.
  - `dfpWhy` ← `DashProfile.why`, jetzt mit HE-AAC im Profil wie beim Helper.
  - `dfpCollides` ← `DashPlan.collides`.
  - `dfpGate` ← `DashProfile.check` + `DashPlan.build` + `DashEngine.options` (nur die manifestabhängigen Teile).
- **Ein Code für beide Seiten:**
  - `gate.code` ist der Grund, den `dashplan` meldet: `ok`, `dash_addressing`, `mpd_limits`, `audio_codec` …; Kadri schreibt ihn mit Bindestrich.
  - Dazu `track` und `detail`: die blockierende Spurart und die Gründe ihrer Darstellungen (aus `DashProfile.Verdict.excluded`).
- **Anzeige bleibt Kadris Sache** (`gate.reason` → E3). Neu:
  - `dash-coverage` („Manifest widersprüchlich: Tonspur 24 s statt 20 s“, Zahlen aus dem MPD);
  - `dash-timeline`;
  - `dash-limit`;
  - `baseurl-multiple` in E2 und E3.
- **Bindung (`src/038`/`060`) und Fingerabdruck sind unverändert.** Der Abdruck-Text nutzt nur feste Felder; die 24 Golden-Vektoren aus S3c bleiben gleich (`test_dash_fp` 29/29).
- **Angebot:** Ohne `gate.ok` bietet Kadri nichts an und ruft `dashplan` nicht auf. Das ist unverändert; geändert hat sich nur, was `gate.ok` heißt.

## 3. Gemeinsame Golden-Vektoren `dash-gate/1`

**Ablage und Versionierung:**
- Kadri: `tests/web/dash/gate/`; Helper: `tests/java/dash/fixtures/gate/`, byte-gleich.
- 41 neutrale MPDs, `gate-v1-vectors.tsv` mit SHA-256 je Datei, dazu der Erzeuger `erzeuge_fixtures.py` (nur Bausteine).

**Erwartungen von Hand** aus der MPD-Semantik, mit Rechenweg in der Spalte `begruendung`, nicht aus einer Implementierung erzeugt. Spalten:
- Ergebnis (angeboten/abgelehnt);
- einheitlicher Code (wie `dashplan`);
- blockierende Spur und Gründe;
- Stücke/Abdeckung je Darstellung im Periodenfenster;
- Adressierung;
- Kadris Anzeigegrund.

**Angeboten (10):**

| Vektor | Kern |
|---|---|
| g01–g05 | alle Adressierungen: Number+Zeitleiste, Number+@duration, Time+Zeitleiste, Liste+Zeitleiste, Liste+@duration |
| g06 | Packager-Rest 20,053 s, Toleranz |
| g07 | Ton über das Periodenende hinaus: Stück 6 außerhalb des Fensters |
| g08 | AAC-LC + HE-AAC, nur LC-Paare |
| g09 | BaseURL-Kette mit je einer pro Ebene |
| g10 | H.264 + HEVC, nur H.264 |

**Abgelehnt (31):** Die Negativtests der Vorgabe sind so abgedeckt:

| Vorgabe | Vektoren |
|---|---|
| Lücken/Überschneidungen | n02, n03 (+ n22, n23) |
| unvollständige Spur | n04 (Video 12 s), n05 (Ton 16 s), n01/e3 (Ton 24 s) |
| unterschiedliche A/V-Dauer | n05; Gegenprobe g07 (längerer Ton wird am Periodenende abgeschnitten → angeboten) |
| Initialisierung fehlt/unbekannt | n06, n07 (Init nur als Byte-Bereich) |
| nicht unterstützte Adressierung | n07, n08 |
| unbekannte Codec-Kombination | n09 (HEVC), n10 (Opus), n11 (gemuxt), n12 (nur HE-AAC) |
| dynamisch | n14 |
| mehrere Perioden | n15 |
| DRM | n16 |
| widersprüchlich | n17 (@duration + Zeitleiste), n18 (gemischt), n23 |
| übergroß | n20 (> 20 000 Stücke), n21 (> 1 Mio. Auswertung), n24 (Stück > 1 h), n26 (Optionen), n27 (Größe), n28 (Journal) |
| sonst | n13 (ohne Ton), n19 (Mehrfach-BaseURL = d5), n25 (Kollision), n29 (Dauer unbekannt), n30 (Typ), n31 (EssentialProperty) |

**Geprüft wird unabhängig auf beiden Seiten:**

| Prüfung | Ergebnis |
|---|---|
| Kadri `tests/test_dash_gate.py`: echte `src/038`/`039`/`046` im Chromium-DOMParser, je Vektor alle Spalten hart | 53/53 |
| Helper `TestDashGate` (Kern: Lesen, Profil, Plan, Abdeckung, Adressierung, Spur und Gründe) | 42/42 |
| Helper `TestDashEngine.gateVectors`: **echter `dashplan`** über SafeHttpClient gegen einen lokalen Server, Grund wörtlich; g08 nur AAC-LC-Optionen | 41/41, Suite 155/155 |
| Abweichung zwischen Handerwartung und einer der beiden Implementierungen | **keine** |

Einzige Korrektur am Test: Meine Erwartung für die alte S3c-Fixture `vod-segmentlist.mpd` war falsch. Sie hat nur HE-AAC und wurde auch vorher nicht angeboten; jetzt meldet sie den Helper-Code `audio_codec`.

## 4. e3 und d5

| | vorher | jetzt |
|---|---|---|
| e3 (Matrix) | zugeordnet, angeboten, Helper lehnt nach dem Tipp ab (`dash_addressing`) | zugeordnet, **kein Angebot**, E3/coverage: „DASH-Stream zugeordnet – nicht speicherbar · Manifest widersprüchlich: Tonspur 24 s statt 20 s“. Hart geprüft: **der Helper lädt das MPD nicht (kein dashplan)**; Bindung unverändert (bound, stueckfolge) |
| d5 (Matrix) | E2/host „Stücke kommen von einem anderen Server als im Manifest angegeben“ | E2/baseurl-multiple „DASH-Stream erkannt – nicht speicherbar · Manifest nennt mehrere Server-Alternativen (BaseURL) – noch nicht unterstützt“ |

**d5 im Einzelnen:**
- Ist die Bindung über die erste BaseURL gelungen, meldet Kadri E3/baseurl-multiple mit demselben Satz.
- Der Helper meldet `mpd_baseurl_multiple`.
- Die Diagnose nennt „Vorprüfung nicht prüfbar (baseurl-multiple)“.
- Keine alternative CDN-Adresse wird freigeschaltet (S4b-6).

**Diagnose allgemein:** Sie nennt zusätzlich den Helper-Code, z. B. „Vorprüfung dash-coverage (Helfer dash_addressing · audio: coverage-mismatch)“.

## 5. Offener Sicherheitsrest aus S4b-4: Anfragebeginn fehlt

**Befund** (`befund_anfragebeginn_unbekannt.py`): echter Code in Chromium. Drei Stücke werden vor der neuen Epoche angefragt, kommen danach an, und das MPD wird danach gelesen.

| Anfragebeginn im Beobachter | Ergebnis |
|---|---|
| bekannt | keine-treffer, 0 Treffer |
| unbekannt (0) | **bound (stueckfolge), 3 Treffer, gespielt [1]** |
| unbekannt (undefined) | **bound (stueckfolge), 3 Treffer, gespielt [1]** |

**Ursache:** `dashSee` setzt bei fehlendem Anfragebeginn `s = t`, also die Ankunft. Damit gilt ein unbekannter Beginn als Epochenbeweis.

**Erreichbarkeit heute:** praktisch keine.
- Der Beobachter liefert in Chromium und Firefox immer `startTime` (> 0) und `timeOrigin`; auch ohne Timing-Allow-Origin.
- Die fetch-/XHR-Mitleser rufen `seeUrl` beim Absenden; dort ist `t` bereits der Anfragebeginn.
- Unbekannt wäre er nur ohne `performance.timeOrigin`, also in sehr alten Browsern, oder bei einem Eintrag ohne `startTime`.
- Trotzdem ist es ein struktureller Rest.

**Minimaler Lösungsvorschlag (nicht umgesetzt – Änderung der Bindungslogik, braucht Freigabe):**
1. **`dashSee`:**
   - Ist die Ankunft bekannt, der Anfragebeginn aber nicht, wird `s = null` gespeichert (unbekannt).
   - Ohne Ankunft (Mitleser beim Absenden) bleibt `s = t`: Das ist der echte Anfragezeitpunkt.
2. **`dashBindDecision` (`src/038`) und `dashOfferOf`:** Treffer mit `s == null` zählen nicht als Beleg der aktuellen Epoche (fail-closed). Heute steht dort der Rückfall `h.s != null ? h.s : h.t`.
3. **Diagnose:** „Anfragebeginn unbekannt: n Abrufe“; E2 bei ausschließlich solchen Treffern mit eigenem Code (z. B. `start-unknown`, „Ladebeginn nicht feststellbar – kein sicherer Nachweis“).
4. **Folge:** In Chromium und Firefox ändert sich nichts (Beginn immer bekannt); prüfbar mit der vollständigen Matrix. Ohne Resource-Timing-Beginn gibt es keine DASH-Bindung mehr statt einer möglichen falschen.

## 6. Gegenprobe

| Prüfung | alter Stand | neuer Stand |
|---|---|---|
| Kadri `test_dash_gate.py` | **9/53** am Stand `1494e56` (`gegenprobe-1494e56-test_dash_gate.log`): 15 der 31 Ablehnungsvektoren angeboten (n01–n05, n20–n28), Codes n10/n12 verschieden, e3 ohne Abdeckungsgrund, d5 E2/host | 53/53 |
| Matrix e3 | angeboten, Helper lehnte nach dem Tipp ab (S4b-4-Lauf) | kein Angebot, kein `dashplan` |
| Kadri `test_dash_fp`, neuer Fall „gleiche ID in zwei Ton-Sets“ | `ok: True` – angeboten (`gegenprobe-1494e56-dash_fp-detect.log`) | `track-collision` wie der Helper; der alte Fall „Ton gemischt“ läuft mit verschiedenen IDs weiter (nur AAC-LC) |
| Helper | Produktcode unverändert; die Handerwartungen trafen ohne Korrektur zu (Referenzseite) | – |

## 7. Regressionen

| Prüfung | Ergebnis |
|---|---|
| **Kadri** Golden-Vektoren `test_dash_gate.py` | **53/53** (alter Stand 9/53) |
| Player-Matrix vollständig (S4a/S4b, alle Szenarien, harte Assertions) | **271/271** (`endstand/matrix-voll.log`; vorher 269 + 2 neue: e3 kein dashplan, d5-Grund) |
| Node-Checks (27, u. a. dash_bind 29, dash_epoch 13, dash_diag 31, dash_message 60, frame_ui_rid 36, download_diag 102, Vertraulichkeits-Check) | alle grün, FAILS=0 |
| Browser-Suiten, alle 31 `tests/test_*.py` (MP4, HLS, DASH, iframe/Fenster, Kanal/Helfer, Sicherheit/Angriff/LAN/DNR) | 30/31 grün, z. B. test_mp4 143/143, test_direct_dl 87/87, test_frame_ui 61/61, test_dash_mpd 61/61, test_guard 61/61, test_dash_backfill 23/23 |
| Erster Lauf `test_dash_fp`, `test_dash_dl` | je 1 Fehler: Kollisionsfall (siehe §1 Zeile 14) bzw. erweiterte Diagnosezeile. Ursache geklärt, Tests korrigiert; Nachlauf 30/30 und 37/37 (`endstand/suites-nachlauf.log`) |
| S3h Weiterleitungs-E2E (echter Helfer) | 20/20 |
| S3d DASH-E2E mit Download (echter Helfer) | alle bestanden |
| **Helper** `tests/java/dash/run.sh`: TestDash + TestDashGate | 293/293 + **42/42** |
| Helper `tests/java/dashdl/run.sh`: TestDashEngine inkl. 41 Vektoren über den echten dashplan | **155/155** |
| Helper Mutationsprüfung `dash` / `dashdl` | 58/58 bzw. 53/53 getötet |
| Helper-CI `dash-core` auf `f38c689` | gestartet (https://github.com/Owndot/video-assistent-helper/actions/runs/45285553183), Ergebnis bei Abgabe noch offen |

**Vorbestehender Fehler, gesondert ausgewiesen – NICHT bestanden:**
- `test_detect.py`: 2 Fehler, identisch an `008e971`, `7030444`, `1494e56` (`gegenprobe-1494e56-dash_fp-detect.log`) und am neuen Stand.
- Das hier installierte Chromium spielt einen HLS-Stream ohne Dateiendung selbst.
- Das betrifft HLS und die Browserversion, nicht DASH oder S4b-5. Unverändert, nicht ausgenommen.

**Umgebung:** test_dnr_scope braucht wie zuvor den Verweis auf den installierten Browser (nur im Container, Test unverändert).

## 8. Diff

**Kadri:**

| Datei | Änderung |
|---|---|
| `src/039-dash-fingerprint.js` | Vorprüfung als Übertragung von `DashManifest.compute`/`DashProfile`/`DashPlan`/`DashEngine.options`; `dfpMedia` liefert Präfix/Suffix; Adressierung je Darstellung |
| `src/046-dash-ebenen.js` | E3 `coverage`/`timeline`/`limit`/`baseurl-multiple`, E2 `baseurl-multiple`, Abdeckungstext mit Zahlen |
| `src/105-download-knopf.js` | Gründe für das Menü des eigenen Players |
| `src/280-diagnose.js` | Helper-Code und Lesefehler in „Vorprüfung …“ |
| `src/020-einstellungen-sprache.js` | Englisch |
| `tests/test_dash_gate.py` | neu |
| `tests/web/dash/gate/` | 41 MPDs, Vektortabelle, Erzeuger |
| `tests/s4a_dash_player_matrix.py` | e3: kein Angebot, E3/coverage, kein `dashplan`; d5: E2/baseurl-multiple |
| `.github/workflows/dash-e2e.yml` | `test_dash_gate.py` mit aufgenommen |

**Helper (nur Tests, kein Produktcode):**

| Datei | Änderung |
|---|---|
| `tests/java/dash/fixtures/gate/` | byte-gleiche Fixtures |
| `TestDashGate.java` | neu |
| `run.sh` | ruft `TestDashGate` mit auf |
| `TestDashEngine.gateVectors` | Vektoren über den echten `dashplan`; `dashdl/run.sh` übergibt dafür den Fixture-Pfad |
| `.github/workflows/dash-core.yml` | Trigger `test/s4b5-*` |

## 9. Verbleibende Risiken und Grenzen

- **Nach dem Plan:**
  - Netz und Inhalt bleiben Sache des Helpers und sind nicht aus dem MPD vorhersagbar: HTTP-Fehler, ein MPD, das der Helper anders bekommt (`manifest_mismatch`), Init-Prüfung beim Download (`codec_mismatch`, `encrypted`).
  - Diese Fälle können weiterhin erst nach dem Tipp scheitern; Kadri meldet sie dann (E5).
- **MPD > 4 MB:** Beide bieten nicht an, die Codes unterscheiden sich (Tabelle Zeile 13).
- **Leerraum in Codec-Angaben:** Java `trim()` entfernt nur Zeichen ≤ U+0020, JavaScript `trim()` auch Unicode-Leerraum. Bei exotischen Leerzeichen in `@codecs` könnte Kadri strenger oder lockerer als der Helper sein. Nicht als Vektor; Auswirkung höchstens eine Ablehnung beim Plan.
- **Rechenaufwand:** Kadri wertet jetzt jede Stückfolge aus, wie der Helper, höchstens 1 Mio. Stücke je MPD. Übliche MPDs: wenige tausend Schritte.
- **Anfragebeginn unbekannt:** siehe §5, Vorschlag offen.
- **Mehrere BaseURL:** bis S4b-6 abgelehnt (d5).
- **Android:** nicht geprüft; dieselbe Web-API und derselbe Code.

## 10. Dateien

- `S4B-5-VORPRUEFUNG-BERICHT.md` – dieser Bericht
- `kadri-s4b5.patch`, `helper-s4b5.patch`
- `dash-gate-v1/` – Golden-Vektoren (Tabelle + 41 MPDs + Erzeuger)
- `gegenprobe-1494e56-test_dash_gate.log`, `neu-test_dash_gate.log`
- `befund_anfragebeginn_unbekannt.py`, `befund_anfragebeginn_unbekannt.log`
- `befund-ton-gemischt-helfer.log`, `gegenprobe-1494e56-dash_fp-detect.log`
- `helper-dash-core.log`, `helper-dashdl.log`, `helper-dash-mutation.log`, `helper-dashdl-mutation.log`
- `matrix-gezielt.log`, `endstand/`
- `SHA256SUMS`

**STOP vor S4b-6.**
