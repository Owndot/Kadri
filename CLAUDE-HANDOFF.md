# Claude Code – Fortsetzung von Kadri und Android Helper

Stand: **2026-11-16**. Kurzer aktueller Einstieg; maßgebliche ausführliche Übergabe:
[P4C3-HANDOFF.md](P4C3-HANDOFF.md). Dortige ältere „Aktuell“-Abschnitte sind ausdrücklich Historie.
Helper-Vorbereitung: [P4C-VORBEREITUNG.md](https://github.com/Owndot/video-assistent-helper/blob/feature/c3-browser-downloads/P4C-VORBEREITUNG.md).

## Codex-Folgereview von Helper `291cff1` (CHANGES REQUIRED) – Stand 2026-11-17 (maßgeblich vor allem Folgenden)

Helper-Commit `947d806`. Details: [REVIEW-CODEX-FOLLOWUP.md](https://github.com/Owndot/video-assistent-helper/blob/feature/c3-browser-downloads/REVIEW-CODEX-FOLLOWUP.md).

**Korrektur meiner CI-Aussage zu `291cff1`:** API 29 war NICHT „nur SIZE“. Versuch 2 (Job `133674082860`) zeigte im
regulären Test `publishesThroughMediaStoreAndReadsBack` den Veröffentlichungsfehler `publish rows=0` (Eintrag über die
Downloads-Uri nicht mehr sichtbar, Markierung vorhanden; MediaProvider hatte die Datei laut Systemprotokoll bereits auf den
Endnamen umbenannt) und ≈3 s später einen OutOfMemoryError im Systemprozess (`DeadSystemException`, u. a. aus
`WakeLock.release` → Arbeiterfaden starb). Getrennte Befunde; ein Zusammenhang ist nicht belegt. „cleanup=none“ war keine
sichere Negativaussage. Die Ursache von `rows=0` ist **nicht** nachgewiesen.

Abgearbeitet: P1 Abschluss trotz Aufräumfehlern (8 Regressionsfälle, 7 auf altem Code rot), P2 Diagnose ohne
Provider-Abfrage auf dem Fehlerweg + konservative Zuordnung + H1/H2/H3-Sonden, P3 Testisolation + strenge
Mutationsbewertung (4 ungültige und 1 zufällig erkannte Probe gefunden und korrigiert), P4 Liefer-Gate
(`tools/device_gate.py`, 21 synthetische Fixtures; Paket-Job ohne ausdrückliche Freigabe übersprungen).
Lieferung bleibt **BLOCKED**, Produktion **UNAPPROVED**.

## Codex-Review abgeglichen – Helper `291cff1` (2026-11-16 spät, Historie – CI-Aussage zu API 29 korrigiert, s. o.)

Details und Belege: [REVIEW-CODEX-P4C3.md](https://github.com/Owndot/video-assistent-helper/blob/feature/c3-browser-downloads/REVIEW-CODEX-P4C3.md).
Erste App-Codeänderung seit `bd5ab29` (nur Klassifikation/Diagnose, keine Sicherheits-/Abbruchregel geändert, kein Retry):

- **A bestätigt + korrigiert:** Diagnose im Assertion-Text wurde vor `await` ausgewertet (2 Gerätetests).
- **B bestätigt + korrigiert:** `DirectDownloads` meldete lokale RuntimeExceptions als `failed:network`. Jetzt Ablage →
  `storage`, Listener/Unerwartetes → `internal`, `IOException` → `network`; Ursache nur Klasse + App-Stelle. JVM-Regressionstest
  (rot auf altem Code), dl-Mutationen 49/49. Kadri kennt `internal` bereits.
- **C umgesetzt:** `PendingEntry.commit` – genau ein Update; bei Fehlschlag `rows=`/`threw=`, `entry=`, `proof=`,
  `cleanup=removed-this-entry|ran-Nx|none`, `trail=` mit gemeinsamer Folgenummer. Auf API 29 im Gerät belegt:
  `threw=IllegalStateException(No item at …) entry=missing proof=gone cleanup=removed-this-entry(run1#3-#4) trail=insert#1,open#2,close#5,update!#6`.
- **D:** Produktionsstart kann keinen aktiven Eintrag bereinigen (nur Test-Reflection-Reset). Keine Produktänderung.
  `failed:network` in `publicFileForUninstallCheck` (`43883581638`) = möglicher Testinteraktions-Kandidat, nicht bewiesen.
- **E:** nur Vorschlag (Trennung Veröffentlichung/System-Metadaten); API 29 bleibt rot, keine Android-10-Freigabe.

CI `291cff1`: Lauf `43970471504` API 26 **PASS**, API 34 **PASS** (kein `failed:storage`), API 29 Versuch 1 **FAIL nur SIZE** (Versuch 2: zusätzlich `publish rows=0` und System-OOM – siehe oben)
(45/46, Sonde 165/165); Kern-/JVM-Job brach vor jedem Test an Maven-Central-429 ab → ein Re-Run. Validierung `43970471486`:
`download-manager-privacy` (`ReferrerDownloadTest`, DownloadManager wiederholte den GET) → ein Re-Run. HLS, Browser **PASS**.
**API-34-Ursache von `IOException: publish` weiter nicht nachgewiesen**; beim nächsten Auftreten Diagnose lesen.
Lieferung bleibt **BLOCKED**, Produktion **UNAPPROVED**.

## Ursachenanalyse API-34-`failed:storage` – Stand 2026-11-16 abends (Historie)

Helper-Commits nur Testcode/Doku (App-Code `app/src/main` = `bd5ab29`): `e600b79`, `8c81e83`, `e67a6a0`.

**CI (verifiziert):**
- `43886149524` (`e600b79`): API 26/34, Kern/JVM/Mutationen, Validierung, Browser, HLS **PASS**; API 29 **FAIL** nur SIZE.
- `43890527077` (`8c81e83`): Versuch 1 API-34-Job hing >30 min im SDK-Download (kein Test lief) → Lauf
  abgebrochen, fehlgeschlagene/abgebrochene Jobs auf demselben Commit neu gestartet (Infrastruktur, kein
  Test-Retry). Versuch 2: API 34 **PASS** (46/46, Wiederholung 22/22), API 26 **PASS**; API 29 **FAIL** nur SIZE.
- `43899801663` (`e67a6a0`): API 26/34 **PASS**, API 29 **FAIL** (Sonde OK, Rest im Log nicht neu geprüft).
- API 34 heute: 3 von 7 vollständigen Ausführungen gescheitert (2× `IOException: publish`, 1× `failed:network`
  ohne Ursache), die letzten 3 grün. **Grüne Läufe sind kein Fixnachweis.**

**Hypothesen:**
- **WIDERLEGT – Cleanup-Race als Ursache von `IOException: publish`:** deterministische Referenz
  (`processStartCleanupDuringAJobSignature`, API 29 und 34 identisch): Prozessstart-Bereinigung während eines
  Auftrags → Markierung weg, Eintrag weg (`rows=0`), `commit` wirft `IllegalStateException` („No item at …“).
  `IOException: publish` entsteht nur, wenn `update()` ohne Ausnahme ≠ 1 liefert, also bei noch vorhandenem Eintrag.
- **WIDERLEGT (Code) – Cleanup-Race in Produktion:** `Downloads.initialize` läuft nur in `HelferService.onCreate`
  vor `Mp4Downloads.get` (und im Legacy-`Downloads.start`); `initialized` wird nur bei Erfolg gesetzt und im
  App-Code nie zurückgesetzt; scheitert es, beendet sich der Dienst vor dem Anlegen der Engines.
- **WIDERLEGT (Sonde, je 140–170 Zyklen, API 29+34):** Pause bei offenem Stream, Pause vor Schließen/Veröffentlichen,
  abgebrochener Nachbar, Löschen einer 64-MiB-Datei unmittelbar vor dem Veröffentlichen, parallele Fremdlast im
  MediaProvider – keine einzige gescheiterte Veröffentlichung isoliert.
- **BESTÄTIGT (Code) – Fehlklassifizierung:** `DirectDownloads.run` meldet jede unerwartete RuntimeException und
  einen verkürzten Body ohne starken ETag als `failed:network` ohne Ursache. Eine verschwundene Zeile würde also
  als `network` erscheinen. Ursache des `network` in `publicFileForUninstallCheck` (`43883581638`) bleibt OFFEN.
- **OFFEN – warum `update(IS_PENDING=0, DISPLAY_NAME)` gelegentlich ≠ 1 liefert:** nur im Gesamtlauf. Diagnose ist
  jetzt in jedem MP4-Test aktiv (Zustand/Alter des Eintrags, Besitzmarkierung, Schreib-/Schließfehler,
  Zeitleiste testseitiger Bereinigungen, Serverfehler, `initialized`). Beim nächsten Auftreten auswerten.
- Geteilte Zustände im Testprozess geprüft: `HelferService` aus `ChannelInstrumentedTest` läuft weiter
  (Singletons, `SLOTS`), keine asynchrone Löschung gefunden; `newProcessCleanup` nur synchron in 3 Tests,
  keiner davon unter den gescheiterten.

Kein Produktfix, keine gelockerte Assertion, kein Retry. Lieferung bleibt **BLOCKED**.

## Claude-Fortsetzung 2026-11-16 – maßgeblich vor allen folgenden Abschnitten

Arbeitsverzeichnisse in dieser Umgebung: `/home/user/Kadri`, `/home/user/video-assistent-helper` (`/workspace` existiert nicht).
Anwendungscode unverändert: Kadri `7978a41`, Helper-App-Code (`app/src/main`) wie `bd5ab29`. Neue Helper-Commits
enthalten nur Gerätetests, Testskript und Doku: `d2f3884`, `52702f6`, `4cbfb2e`, `5fa8b6d`.

**CI-Auswertung (verifiziert):**
- Kanal-Lauf `43846760700` (Doku `1a80afe`): API 34 **grün** (46/46, Wiederholung 22/22). API 29 **zwei** Fehler:
  bekannter SIZE-Befund plus neu `cancelDuringRemuxIsFastAndLeavesNothing` (`memory` statt `cancelled`) bei
  `maxHeapMiB=16`, obwohl der Emulator `qemu.dalvik.vm.heapsize=512m` verlangte (16m = ART-Standard).
  In `43874560604` und `43879157709` wieder 512 MiB und dieser Test grün → **Umgebungsbefund**, kein App-Befund.
- Browser `43846760757` rot: Firefox-Timing `nonchronological/sparse samples` (23/24), bekannte Instabilität;
  auf `d2f3884` (`43874560582`) grün. Validierung/HLS auf `d2f3884` grün.
- **API-34-`failed:storage` lokalisiert:** Diagnose in `d2f3884` zeigt `cause: IOException: publish`, d. h.
  `Mp4Downloads.PendingEntry.commit()` – `update(IS_PENDING=0, DISPLAY_NAME)` betraf nicht genau einen Eintrag.
  Betroffen in `43874560604` und `43879157709` jeweils `interruptionFailsCleanOrResumesExactly` (Resume-Pfad,
  2 s Pause bei offenem Stream nach 3 MiB). Früher auch `publishesThroughMediaStoreAndReadsBack` (64 MiB).
  Sonde `MediaStorePublishProbeTest` ohne Pause auf API 34: **60/60 OK**. Folge in der App: vollständig geladene
  Datei wird danach durch `abort()` entfernt, Auftrag `failed:storage`. **Ursache des Updates noch offen.**
- `5fa8b6d`: Sondenvarianten (Pause bei offenem Stream / vor Schließen / vor Veröffentlichen / abgebrochener
  Nachbar) und Zustandsaufnahme im scheiternden Test. Ergebnis abwarten, dann gezielt korrigieren.

**Konsequenzen:** Vergleich auf exakt `bd5ab29` nicht wiederholt – der Fehler ist reproduzierbar und betrifft
denselben App-Code; ein Gate-PASS darauf wäre Zufall. Lieferung **BLOCKED**, bis die Veröffentlichung im
Resume-Pfad verstanden und korrigiert ist. Danach neuer Helper-`SOURCE_SHA` (Scope-Prüfung erlaubt sonst keine
Teständerungen) und Gate-Ergänzung `PUBLISH_PROBE_STATUS ok` (siehe Helper `P4-DELIVERY-DRAFT.md`). Kadri-Pin
`bd5ab29` kann bleiben, solange `app/src/main` und Desktop-Helper unverändert sind; bei App-Fix neu bewerten.
Reale HTTP 404/412 weiter **OFFEN / NEEDS_TEST**; Samsung-Diagnoseschritt erst nach geprüfter Lieferung.

## Ziel und wichtigste Einschränkung

Der Eigentümer will **vollständige Downloads unabhängig von laufender Wiedergabe**. Passives
Mitspeichern wurde ausdrücklich abgelehnt. Keine Aufnahme-UI entwickeln und keine bisherigen
Machbarkeitsprototypen als fertige Downloadlösung darstellen.

Reale HTTP 404/412 sind **OFFEN / NEEDS_TEST**. Es gibt eine geprüfte neue Diagnose, aber **keinen
nachgewiesenen Fix dieser realen Abruffehler und noch keine neue P4-Lieferung**.

## Verbindliche Repositories und Quellstände

| Repository | Bestehender Branch / Draft-PR | Letzter Anwendungscode / Testpin |
|---|---|---|
| [Owndot/Kadri](https://github.com/Owndot/Kadri) | `feature/c3-helper-mp4`, #11 | `7978a41232c3b1582289c53461da4fe63ad28ff9` |
| [Owndot/video-assistent-helper](https://github.com/Owndot/video-assistent-helper) | `feature/c3-browser-downloads`, #27 | `bd5ab293bbc6729cabafe72b6bd5606f8c74f5e5` |

Am 16. November vor dieser Dokumentationssicherung wurden genau diese Remote-HEADs verifiziert.
Danach nur Übergabedokumente/gesicherte Paketentwürfe; aktuellen Dokumentations-HEAD mit `git log -1`
ermitteln. Arbeitsverzeichnisse hier: `/workspace/Kadri`, `/workspace/video-assistent-helper`.
Nur bestehende Branches verwenden; keine neuen PRs, Merges, Tags oder Releases.

Verifizierte Dokumentations-Checkpoints: Kadri `a595bc721965f83c1ad944dc1e3002357972d714`
(danach dieser Statusnachtrag), Helper **`1a80afefffde319f9b13be4dc9c3b06f3a7918e1`**.
Anwendungsdateien gegenüber den obigen Code-SHAs unverändert; nur Root-Markdown-Dateien unterscheiden sich.

## Bestätigte Gerätebasis – nicht erneut als offenes Problem behandeln

Samsung Android 17 / One UI 9, Vivaldi; isolierte App `de.evp.helfer.p4test`, APK-Codebasis
`8b906c5`, versionCode 6; Kadri P4-Test-ID `pcccpjllneffccpenbepmfbkjedllkkf`.
Eigentümer bestätigte **F1/F2/R1/R2/C1 PASS**: neue Downloads nach Neustart, Fortschritt/Dateigröße,
HLS-/MP4-Wiederaufnahme nach Prozessende, persistenter Nutzerabbruch.
Auch TS/fMP4, getrennte/integr. Tonspuren, Qualitätswahl, Webseitenknopf, Netzunterbrechung,
Bildschirm aus und parallele Downloads funktionieren auf der kontrollierten Testseite.
Diese PASS gelten für die bisherige Basis, nicht automatisch für den aktuellen Diagnosebuild.

## Reale Befunde – anonymisierte Fallnamen

- **site-a:** deklarierte MP4-Alternativen 720p/1080p liefern beim Helper HTTP 404; anonymer
  Browservergleich ohne Cookies/Referer ebenfalls 404. Tatsächlich abgespielte Quelle ist HLS.
  Explizites „Stream speichern …“ scheitert mit HTTP 412 bei `hlsplan`, etwa 1 s nach Start.
  Welche Playlist scheitert, ist vom Gerät noch unbekannt. Kein Beweis für Cookie-, Token- oder Serverursache.
- **media-regression-b:** Download funktionierte laut Eigentümer mit der unmittelbar vorherigen
  installierten Version (genauer SHA unbekannt). Bericht zeigte `hlsplan`-Timeout nach 5 s.
  Die konkrete Transportfrist wurde bereits auf 25 s nur für `hlsplan` korrigiert und synthetisch geprüft.
  Kein neuer Geräte-PASS gemeldet.
- **media-regression-c:** HLS-Planung nach etwa 1 s abgelehnt; alte anonyme Kopie zeigte `[entfernt]`.
  Der feste Helper-Code fehlt weiterhin. Eine enge Ausnahme für 13 bekannte lange Codes wurde bereits
  eingebaut; keine Freitext-/URL-Ausnahme.

Keine realen Namen, Domains, IDs oder Tokens aus dem Chat in GitHub übernehmen.

## Implementiert und geprüft

**DONE – neue adressfreie HLS-Planungsdiagnose:**

- Helper `HlsEngine.plan()` ergänzt ausschließlich Fehlerantworten um
  `diag: {v:1, phase, playlists}`. Acht feste Phasen: `source_fetch`, `source_parse`, `source_options`,
  `video_fetch`, `video_parse`, `audio_fetch`, `audio_parse`, `plan_build`; Listenzähler 0–3.
- Einstiegsadresse ist vor erfolgreichem Parsen nicht zwingend ein Master. Keine URL-/Header-/ID-Felder,
  keine zusätzlichen Requests/Retryänderungen; erfolgreiche Planantworten und Downloadlogik unverändert.
- Kadri **1.12.16**, Basis 19.30: `channel/channel-downloads.js`, `channel/channel-service.js` und
  `src/080-helper-app.js` filtern die Diagnose an den Übergängen. Direkter Webseitenknopf und Player
  verwenden denselben Diagnosepfad. Alte Helper ohne `diag` bleiben kompatibel.
- `vendor/kadri-pairing-poc/SOURCE` zeigt auf `bd5ab29`. WASM/Glue unverändert; CI hat den Neuaufbau
  und Bytevergleich durchgeführt. Kein neuer Kanalbefehl und keine Änderung der Kryptografie.
- Lokal: HLS-Koordinator **255/255**, Kadri HLS-Unit **80/80**, Diagnose **48/48**, echter
  verschlüsselter Kanal/Helper **103/103**. 404/412 an Einstieg/Video/Audio, Parserfehler, Redirect-404,
  Abbruch-/Resume-Regressionen und Datenschutz geprüft.
- Grenze: Diagnose präzisiert nur `hlsplan`. Spätere Init-/Segmentfehler, Start/Wiederaufnahme und
  Redirect-Ketten erhalten damit noch keine genaue Ressourcenphase. Timeout ohne Antwort bleibt unbekannt.

Details: [Helper-Diagnose](https://github.com/Owndot/video-assistent-helper/blob/feature/c3-browser-downloads/P4-HLS-PLAN-DIAG.md).

## CI – am 16. November abgefragt

| Lauf | Ergebnis |
|---|---|
| [Kadri 42547277661](https://github.com/Owndot/Kadri/actions/runs/42547277661) | **DONE: alle fünf Jobs grün**, einschließlich echter Helper-/Browser-/Mutationsprüfungen |
| [Helper HLS 42547144187](https://github.com/Owndot/video-assistent-helper/actions/runs/42547144187) | **DONE: alle drei Jobs grün**, Kern/Mutationen, Remuxer, Lieferkette |
| [Helper Validierung 42547150099](https://github.com/Owndot/video-assistent-helper/actions/runs/42547150099) | **DONE: alle ausgeführten Jobs grün**, optionale Beta-Evidenz übersprungen |
| [Helper Browser 42547150138](https://github.com/Owndot/video-assistent-helper/actions/runs/42547150138) | **DONE: alle vier Jobs grün** |
| [Helper Kanal 42547150112](https://github.com/Owndot/video-assistent-helper/actions/runs/42547150112) | JVM/Kanal/Netz/MP4-Mutationen, Signierprüfung, API 26 grün; API 29 und zunächst API 34 rot, siehe unten |

**BLOCKED – Testlieferung wegen API 34:** erster Job `128934502193`,
`Mp4DownloadsInstrumentedTest.publishesThroughMediaStoreAndReadsBack`, Zeile 365:
erwartet `done`, erhalten `failed:storage`, **46 Tests / 1 Fehlschlag**. Das ist **nicht** der
bekannte Android-10-SIZE-Fehler. Die zusätzliche absichtlich fehlschlagende Prüfung der alten
Publikationsimplementierung im selben Log ist ein erwarteter Mutationsnachweis; nicht damit verwechseln.

Der betroffene MP4-Code/Test wurde durch `bd5ab29` nicht geändert; die neue HLS-Planungsdiagnose
wird in diesem MP4-Test nicht aufgerufen. Das erklärt die Ursache nicht. Der Test an Zeile 365
gibt `engine.diagnostics(id)` noch nicht aus, obwohl diese vorhandene Methode in anderen
Speichertests bereits für genauere Ursachen verwendet wird.

**BLOCKED – unveränderter Vergleich abgebrochen:** am 16. November gezielt den API-34-Job
neu gestartet; neuer Job **`133224722018`**, gleicher Workflow/Quellcommit. Dieser wurde durch
den Übergabe-Push und die bestehende Regel `cancel-in-progress: true` abgebrochen: **kein PASS und
kein abgeschlossener Vergleich**. Job-Log: `The operation was canceled.` Keine Assertion gelockert.
Ein grüner Vergleich erklärt den ersten Fehler nicht. Bei erneutem Fehlschlag zuerst die Testdiagnose an der genannten
Assertion ergänzen (auch Sampler im Fehlerfall sauber beenden), dann den konkreten Ablagefehler
ermitteln. Kein pauschales Retry und keine Aufweichung der Veröffentlichungsprüfungen.

**IN_PROGRESS – automatische CI des abschließenden Helper-Dokumentationsstands `1a80afe`:**
[Kanal/Emulatoren 43846760700](https://github.com/Owndot/video-assistent-helper/actions/runs/43846760700),
[Validierung 43846760650](https://github.com/Owndot/video-assistent-helper/actions/runs/43846760650),
[Browser 43846760757](https://github.com/Owndot/video-assistent-helper/actions/runs/43846760757).
Ergebnisse noch nicht bestätigt. Vorherige Dokumentationsläufe `43846359240/43846359336/43846359285`
wurden durch den abschließenden Statuscheckpoint ersetzt; nicht als zusätzliche Testergebnisse zählen.
PR-Pfadfilter betrachten die PR-Änderungen gegen die Basis: auch ein Dokumentationspush kann dadurch
diese CI erneut starten. **Während des nächsten gezielten Vergleichs keinen Helper-Checkpoint pushen.**

**BLOCKED – P4B-A10-SIZE bleibt rot:** erster API-29-Job `128934502145` bestätigt nur den bekannten
Fehler: tatsächliche Datei 64 MiB, MediaStore-SIZE 0. Eigentümer-Ausnahme ausschließlich für
isolierten Samsung-Test auf Android 17; keine Produktions-/Android-10-Freigabe.

Alter separater CI-Befund zu `95aa0f5`: DownloadManager sah zwei GETs statt genau einem.
Unveränderte Wiederholung [42514524882](https://github.com/Owndot/video-assistent-helper/actions/runs/42514524882)
grün, Ursache nicht bewiesen; aktuelle Validierung `42547150099` ebenfalls grün.

## Testlieferung – vorbereitet, nicht gestartet

**BLOCKED:** Keine neue APK oder Erweiterung verteilt. Aktive Paketworkflows bleiben unverändert.
Die vollständigen vorbereiteten Workflow-Diffs sind als Markdown gesichert, nicht mehr als
uncommittete aktive Workflowänderungen:

- [Kadri P4-DELIVERY-DRAFT.md](P4-DELIVERY-DRAFT.md)
- [Helper P4-DELIVERY-DRAFT.md](https://github.com/Owndot/video-assistent-helper/blob/feature/c3-browser-downloads/P4-DELIVERY-DRAFT.md)

Entwurfspaar: Kadri `7978a41`, Helper `bd5ab29`. Nach Codeänderungen Pins aktualisieren.
Erst nach CI-Bewertung vorhandene isolierte Workflows verwenden. Der neue Wegwerf-Signierer
verlangt Ersetzen **nur** der P4-Test-App und erneutes Koppeln; laufende P4-Aufträge vorher abschließen.
Kadri-P4-Erweiterung nur aktualisieren. Keine vorzeitige Installationsaufforderung.

Altes Kadri-Artefakt zu `7811d5a` war nur bis **10. November** verfügbar; nicht als aktuellen
Download empfehlen. Auch der alte API-34-Bericht `13643824135` liefert am 16. November API-404;
nicht als gelesen ausgeben. Der Job-Log belegte den oben genannten Fehler; noch kein gespeicherter
vollständiger Bericht. Neue Berichte rechtzeitig sichern.

Lokales Vergleichsarchiv der neuen Erweiterung: `/tmp/kadri-p4-7978a41-expected.zip`, SHA-256
`4b5d36dbfdd87a1cc07854d5c8a043d1a77322381c607c7eccc2782d7b5ddd4e`.
Das ist **kein ausgeliefertes CI-Artefakt**. Verfügbarkeit lokaler `/tmp`-Dateien prüfen.

## Vollständiger Browserabruf – geprüfte Grenze

**DONE / BLOCKED:** [Browserentwurf](P4-BROWSER-DOWNLOAD-ENTWURF.md) und
`tests/browser_address_space_probe.py`, Kadri `7958104`: Chromium 141/156, 15 Beobachtungen.
Direktes `fetch(...,{targetAddressSpace:'public'})` blockiert HTTP zum Loopbackziel erst nach
TCP-Verbindung. Nur im `Request`-Konstruktor gesetzt erreicht auch HTTP das Ziel; erneutes Setzen
beim Fetch blockiert wieder HTTP. Öffentliches Ziel/Ursprung sind simulierte Klassifizierungen,
kein dynamischer Rebinding- oder Samsung-Nachweis. Kein gleichwertiger Ersatz für SafeHttpClient
vor Verbindungsaufbau; keinen allgemeinen Browserproxy aktivieren.

Frühere Browser-Sitzungs- und Capture-/Ablagetests sind isolierte Vorarbeit. Sie belegen keine
reale Cookie-Ursache und keinen fertigen vollständigen Downloadmodus. Passive Capture-UI nicht weiterbauen.

## Exakt weiterarbeiten

1. **IN_PROGRESS:** Kanal-/Emulatorlauf `43846760700` auswerten; `133224722018` ist abgebrochen,
   nicht bestanden. Bei erneutem Speicherfehler zuerst konkrete Testdiagnose nachrüsten. Wenn der
   Dokumentationslauf besteht, für die geplante Lieferung den abgebrochenen API-34-Vergleich auf
   **exakt `bd5ab29`** einmal abschließen, nachdem keine konkurrierende Helper-CI mehr läuft.
   Der Paketworkflow verlangt den exakten Quellcommit; andere grüne SHAs ersetzen diese Prüfung nicht.
   Ersten Fehlschlag, Abbruch und abgeschlossenen Vergleich getrennt dokumentieren.
2. **BLOCKED / TODO:** Lieferentscheidung erst mit geklärter CI-Situation; Ausnahme unverändert
   nur P4B-A10-SIZE. Bestehende Paketentwürfe verwenden, exakte SHAs und Artefakte verifizieren.
3. **NEEDS_TEST:** nach geprüfter Lieferung Samsung: Seite neu laden → „Stream speichern …“ →
   Fehler abwarten → Erweiterungsmenü → „Diagnose anzeigen“ → **„Anonymisiert kopieren“**.
   Benötigt: Grund/HTTP, Planungsschritt, Listenanzahl. Keine URLs/Rohdiagnosen anfordern.
4. **TODO:** erst mit realem Phasenbefund gezielt die Abrufursache prüfen und ggf. beheben.
   Keine Cookies/Referer/Authorization/Sitzungen zum Helper, keine geratenen MP4-Adressen,
   keine Retry-Erhöhung, kein DRM-/Zugangskontroll-Bypass.
5. **TODO danach:** echter MP4-SourceVault-Prozessneustart, bytegenaues MP4-Resume (bisher Byte 0
   mit ETag-/Längenprüfung), Keystore-/SourceVault-Lebenszyklusreview. Noch nicht als erledigt markieren.

## Lokale Befehle und unveränderliche Grenzen

Installierte Werkzeuge bei Bedarf prüfen: Java unter `/workspace/toolchains/jdk-21.0.13+9`,
Playwright-Python `/workspace/toolchains/pw/bin/python`, Chromium `/usr/bin/chromium`.
Vollständige HLS-Fixtures `/tmp/helper-hls-plan-fixtures`, Desktop-Helper `/tmp/helper-plan-channel`;
bei fehlenden Tempdateien mit den vorhandenen Repositoryskripten neu erzeugen.

```sh
# Kadri
node tests/channel/hls_unit_check.js
node tests/download_diag_check.js
HELPER_HOST_DIR=/tmp/helper-plan-channel node tests/channel/hls_integration_check.js
node tools/build.js --test
node tests/confidential_names_check.js
# Helper, Java im PATH
bash tests/java/hls/run.sh /tmp/helper-hls-plan-fixtures /workspace/toolchains/safe-http-deps
bash tools/check-network-layer.sh
```

Für tatsächliche APK-Verifikation wurden offizielle, gegen bestehende Gradle-SHA-Pins geprüfte
Werkzeuge unter `/workspace/toolchains/apk-check` vorbereitet; `/tmp/VerifyP4Apk.java` verwendet
Googles `ApkVerifier`. Noch keine neue APK damit geprüft. GitHub-App kann Actions-Artefakte
herunterladen; `gh run download` scheiterte zuvor am temporären Blob-Redirect.

Produktion **UNAPPROVED**. Keine Produktionssignierung, Änderung des kompromittierten alten
Signierers, bestehender C3-/Produktionsinstallationen oder Sicherheitsvalidatoren. Noise KK,
SafeHttpClient und Integritäts-/Quellbindung erhalten. Persistenter Nutzerabbruch hat Vorrang.
Grüne CI ist keine unabhängige Sicherheitsfreigabe. Regelmäßig auf bestehende Branches pushen
und diese Übergabe bei neuen Befunden aktualisieren.
