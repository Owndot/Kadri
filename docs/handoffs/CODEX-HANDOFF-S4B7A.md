# Übergabe an OpenAI Codex – Kadri und Video-Assistent-Helper (Stand S4b-7a)

Stand: 24.11.2026. Verfasst von Claude (Claude Code) als letzte Aufgabe vor der Übergabe der technischen Leitung an Codex.

Dieses Dokument ist ohne den bisherigen Chat verständlich. Es fasst den Stand zusammen, verweist auf Code und Commits
und trennt dabei streng:

- **[PRODUKT]**: im Produktcode der Testbranches implementiert und durch Tests belegt;
- **[STUDIE]**: nur in einem Prüfstand bzw. einer Messsonde nachgewiesen, **nicht** im Produkt;
- **[VORSCHLAG]**: nicht umgesetzt;
- **[UNBEKANNT]**: nicht geprüft oder nicht belegbar.

Alle Aussagen über Testergebnisse stammen aus den archivierten Phasenberichten (`docs/handoffs/berichte/`, unverändert
übernommen). Die dort genannten Logdateien und Pfade unter `/tmp/claude-0/…` existieren **nicht mehr** (flüchtiger
Arbeitsordner). Codex soll keine Behauptung ungeprüft übernehmen (Abschnitt 9).

---

## 0. Stände (verifiziert am 24.11.2026 per `git ls-remote`)

| Repository | Branch | Commit | Rolle |
|---|---|---|---|
| `Owndot/Kadri` | `test/s4b-dash` | `33c8e6a39d471df48bb0e9830455bac8e93e9af3` (+ dieser Doku-Commit) | Entwicklungsstand Browser-Erweiterung (DASH S3c–S4b-8, Studie S4b-7a) |
| `Owndot/video-assistent-helper` | `test/s4b5-dash` | `6e553fcb82b437ce0be487233dd35f41958bade6` | Entwicklungsstand Helfer (DASH S3a/S3b + S4b-5/6/8) |
| `Owndot/Kadri` | `main` | `cd00ded7d68b3d2e8af9d2724cee03e7d351f091` | stabiler Stand (Merge PR #9), **unverändert lassen** |
| `Owndot/video-assistent-helper` | `main` | `bb8a42d83eac108c098600e50a20208446134e65` | stabiler Stand, **unverändert lassen** |

**Unverändert zu halten:**
- **P4-Lieferpins:** in `Kadri/.github/workflows/p4-test-extension.yml` stehen `SOURCE_SHA 7978a41`, `HELPER_SHA 546af14` und `WASM_CORE_ORIGIN_SHA bd5ab29`. `s3d-test-delivery.yml` prüft, dass sie unverändert sind.
- **WASM-Pin:** `vendor/kadri-pairing-poc/SOURCE` (Helfer `bd5ab29` + SHA-256 von JS und WASM).
- **Keine veröffentlichte Version** wurde geändert. Es gibt keine neue APK oder ZIP und keinen Merge. Den Entwicklungsstand der Testbranches hat **kein Android-Gerät** abgenommen.

**Zuletzt intern ausgelieferte Testpakete** (älter als der Entwicklungsstand, nur zur Orientierung):
- Kadri-Test-ZIP 1.12.18 (`a1b3f63`, S3g);
- `helper-p4test-4` (aus `ee54864`, temporärer Signierer).

**Harness-Pin (Kadri):** `vendor/dash-harness/SOURCE` → Helfer `6e553fc` (Produktbasis `ee54864`). Diesen Helfer-Commit baut `dash-e2e.yml` **nur als Desktop-Gegenstelle** (ChannelServer + DashEngine über `tests/java/channel/build.sh`), nie als Auslieferung.

---

## A. Projektüberblick

### A1. Was die Teile leisten

- **Kadri** (`Owndot/Kadri`): Browser-Erweiterung, Vollbild-Videoplayer über beliebigen Seiten.
  - **Player:** Gesten, Spul-Vorschau, Untertitel, Bild-in-Bild, Ambient-Licht.
  - **Erkennung:** Kadri erkennt die tatsächlich laufende Quelle (MP4, HLS, DASH) eines Videoelements.
  - **Download:** bietet sie zum Download an, entweder über die Helfer-App oder über externe Apps (YTDLnis, Teilen-Menü, Browser-Download).
  - **Herkunft:** Kadri ist die Erweiterungsfassung des Userscripts „Video-Assistent“. Siehe `README.md` und `ENTWICKLUNG.md`.
- **Video-Assistent-Helper** (`Owndot/video-assistent-helper`):
  - **Android-App** (`app/`): Helligkeit, Lautstärke und Downloads, also alles, was ein Browser nicht darf.
  - **Download-Engines:** MP4 (C2), HLS → MP4 (P4b), DASH-VOD → MP4 (S3).
  - **Userscript:** Das Repository enthält auch das Userscript (`userscript/`, `src/`).
- **Verschlüsselter Kanal:**
  - Kadri spricht den Helfer nur über `127.0.0.1:47899` an (SPAKE2-Kopplung + Noise KK, Rust-Kern als WASM in Kadri, JNI im Helfer).
  - Doku: Kadri `HELPER-CHANNEL-INTEGRATION.md`, `SECURITY-REVIEW-CHANNEL.md`; Helfer `HELPER-CHANNEL.md`.
  - Der alte Port 47811 ist gesperrt (DNR-Regel 40/51–58).
- **Externe Player/Apps:** YTDLnis (`src/070-extern-ytdlnis.js`), Android-Teilen-Menü.

### A2. Zielplattformen

| Plattform | Stand |
|---|---|
| Samsung (Android 17) mit **Vivaldi Android** | Hauptziel. Frühere Phasen (C3, S3d) wurden auf Vivaldi 8.2.4147.201 mit entpackten Testerweiterungen geprüft (Helfer-Doku `S26-ANDROID17-TEST.md`). **Der aktuelle Entwicklungsstand (S4b-x) ist auf keinem Gerät geprüft.** |
| Desktop-Chromium | Alle automatisierten Browsertests (Playwright, `dist/test`) |
| Firefox | MV2-Fassung `firefox/` vorhanden: ohne `page.js` und `sub.js`, ohne Kanal zum Helfer, Streams per `webRequest.onHeadersReceived`. **Keine Firefox-Tests** (Tests laufen nur in Chromium). |

### A3. Medienfunktionen

| Format | Produktstand (Testbranches) |
|---|---|
| **MP4** | Download über den Helfer (C2: Resume nur mit starkem ETag + If-Range, MediaStore-Veröffentlichung), über den Browser oder YTDLnis |
| **HLS** | Player über hls.js 1.7.3 (`vendor/`). Helfer-Download (P4b): `hlsplan`/`hlsstart`, strenge Policy, Media3-Remux nach MP4 (`hlsmux/Media3HlsRemuxer.java`) |
| **DASH** | **[PRODUKT]** Nur VOD: statisch, eine Periode, ohne DRM, fMP4 mit H.264 (avc1/avc3) + AAC-LC (`mp4a.40.2`). Bindung nur über exakt beobachtete Stückfolgen. Mehrere BaseURL (S4b-6), Annex-I-Minimalform (S4b-8). Download und Remux im Helfer (`dashdl/DashEngine.java`). **Nicht:** Live, Mehrperioden, DRM, VP9/Opus/WebM, HE-AAC, Byte-Bereiche (SegmentBase/indexRange), Worker- oder srcdoc-Player |

### A4. Architektur- und Sicherheitsgrundsätze

Diese Grundsätze hat der Eigentümer vorgegeben und in jeder Phase bestätigt:

1. **Keine websitespezifischen Sonderregeln.** Ein vertraulicher Seitenname darf in keiner getrackten Datei stehen; `tests/confidential_names_check.js` prüft das über FNV-Hashes.
2. **Bindung nur mit Beweis.** Nie über Zeitnähe, Videolänge, ähnliche Adressen oder Host-Gleichsetzung. Im Zweifel keine Bindung („fail closed“).
3. **Keine Weitergabe von Cookies, Authorization oder Request-Bodies.**
   - Der Helfer lädt alles selbst über `SafeHttpClient`, ohne Zugangsdaten.
   - Kadris eigene Anfragen entfernen Cookie und Authorization an fremde Seiten (DNR-Regel 80).
4. **SSRF-Schutz:**
   - Helfer: `net/AddressPolicy`, `GuardedSocketFactory`, `NetRules`; private Netze, Weiterleitungsziele, NAT64.
   - Kadri: DNR-Regeln 51–58/70 und `guard` in `background.js`.
5. **Keine DRM-Umgehung.** ContentProtection irgendwo im MPD bedeutet Ablehnung (`dash-protected`).
6. **Gleichlauf Kadri ↔ Helfer.** Kadris Vorprüfung entscheidet wie der Helfer; das belegen gemeinsame Golden-Vektoren (dash-gate/1).
7. **Keine neuen Berechtigungen** in der normalen Erweiterung ohne Freigabe. Heute: `storage`, `declarativeNetRequestWithHostAccess`, `scripting`, Hosts `<all_urls>`. **Kein `webRequest` in Chrome.**
8. **Datenschutz der Diagnose:** Langdruck und Diagnosefeld sind standardmäßig anonym, ohne Adressen und Tokens. Die volle Fassung gibt es nur über einen ausdrücklich benannten Knopf.
9. **Arbeitsweise:** nur isolierte Testbranches; kein Merge, kein Release, keine APK/ZIP ohne ausdrückliche Freigabe; Berichte auf Deutsch.

---

## B. Repository- und Entwicklungsstand

### B1. Verhältnis der Repositories

- **Kadri baut seine Skriptteile aus `src/*.js`.** Historisch kamen sie aus dem Userscript-Repository (`tools/sync-src.sh` kopiert `../video-assistent-helper/src/*.js` und **löscht vorher alle** `src/*.js`).
- **Warnung:** Seit S3c sind die DASH-Module nur in Kadri entstanden: `src/038`, `039`, `045`, `046`, `065` und große Teile von `040`, `060`, `105`, `180`, `280`. Im Helfer-`src/` fehlen sie.
- **[RISIKO] `tools/sync-src.sh` würde sie löschen.** Nicht ausführen, bevor die Quellen zusammengeführt sind.
- **DASH-Logik doppelt:** Kadri `src/038`/`src/039` (JavaScript) und Helfer `de.evp.helfer.dash` (Java) setzen dieselbe DASH-Logik **bewusst doppelt** um: Kadri entscheidet die Vorprüfung, der Helfer lädt und prüft selbst. Den Gleichlauf belegen byte-gleiche Fixtures:
  - Kadri `tests/web/dash/gate/` ↔ Helfer `tests/java/dash/fixtures/gate/`;
  - 94 MPDs, 109 Vektoren;
  - Fingerabdruck-Tabelle `gate-v1-fp.tsv`.

### B2. Bauen und Testen

**Kadri** (Node 20+, Python 3 mit Playwright, Chromium):
```
node tools/build.js                 # dist/chrome, dist/firefox, ZIPs (dist/ ist nicht getrackt)
node tools/build.js --test          # zusätzlich dist/test (offenes Shadow-DOM, data-kadri-test)
tests/run_all.sh                    # alle tests/test_*.py (xvfb-run ohne Bildschirm); TESTS="test_x.py" für einzelne
node tests/<name>_check.js          # Node-Einheitstests (dash_*, frame_ui_*, media_registry, guard, …)
node tests/channel/<name>.js        # Kanal-, DASH-, HLS-, Download-Integrationstests (brauchen teils HELPER_HOST_DIR)
node tests/confidential_names_check.js
```
Wichtige DASH-Tests:
- `tests/test_dash_{gate,urlparam,alt,bind,fp,mpd,msg,dl,backfill,start_unknown}.py`;
- `tests/dash_*_check.js`;
- `tests/channel/dash_{unit,integration}_check.js`.

**Player-Matrix** (lokaler Prüfstand, nicht in CI, rund 1 h):
```
tests/make_s4a_fixtures.sh /tmp/s4a-fx
S4A_FIXTURES=/tmp/s4a-fx S4A_PLAYERS=<Ordner mit dashjs-4.7.4/, dashjs-5.2.1/, shaka-player-4.11.7/ aus npm pack> \
HELPER_HOST_DIR=<Ausgabe von helper/tests/java/channel/build.sh am Harness-Pin> KADRI_CHROMIUM=<chrome> \
  xvfb-run -a python3 tests/s4a_dash_player_matrix.py [SZENARIO …]
```
Letztes Ergebnis 339/339 (Kadri `33c8e6a`, Helfer-Harness `6e553fc`). Die Player-Pakete liegen nicht im Repository.

**Studie S4b-7a** (nur Test, eigene Messsonde): `xvfb-run -a python3 tests/s4b7_webrequest_study.py [OUT]`. Dazu `HELPER_DIR=<Helfer-Checkout> python3 tests/s4b7_essential_audit.py [OUT]`.

**Helfer** (JDK 17+, Gradle-Wrapper, Android SDK für die App):
```
tests/java/dash/run.sh              # DASH-Kern JVM: Parser, Profil, Plan, Fingerabdruck, dash-gate/1
tests/java/dash/mutation.py         # Mutationsprüfung DASH-Kern
tests/java/dashdl/run.sh FX [CACHE] # DashEngine/DashFetch/Fmp4Inspect (JVM); Fixtures FX aus make-dash-fixtures.sh (ffmpeg)
tests/java/dashdl/run_remux.sh      # Media3-Remux
tests/java/channel/build.sh OUT     # Desktop-Helfer (Kanal + Engines) für Kadris E2E-Tests
tests/java/run_core_tests.sh        # weitere Kerne (siehe ENTWICKLUNG.md des Helfers)
./gradlew assembleDebug             # Android-Build (lokal hier NICHT ausgeführt für S4b-x)
```

### B3. Wichtige Dateien

**Kadri** (`src/` = gemeinsames Skript, `chrome/` = MV3-Hülle):

| Datei | Aufgabe |
|---|---|
| `chrome/manifest.json` | Berechtigungen; `page.js` (MAIN-Welt, `all_frames`), `content.js` (nur Hauptfenster), `sub.js` (alle Fenster); **ohne** `match_about_blank`/`match_origin_as_fallback` |
| `chrome/page.js` | MAIN-Welt: liest Antworten von `fetch`/XHR mit (Stream-Listen, MPD-Text, max. 4 MB), Schild für Bild-in-Bild |
| `chrome/background.js` | Anfragen im Auftrag (`guard`), DNR-Sitzungsregeln, Nachladen von Kadri/hls.js in Fenster |
| `chrome/prelude.js` | GM-API-Ersatz; Feldprüfung der Helfer-Nachrichten (`alt`, …) |
| `channel/channel-*.js` | Kanal: Sitzung, Transport, Store, Downloads (`dashPlan`/`dashStart`, `channel-downloads.js:497`) |
| `src/030`, `src/035` | eingebettete Fenster, `frameKey` je Seite, Fenster-UI-Relay mit Anfragekennung (`rid`/`seq`) |
| `src/038-dash-manifest.js` | sicheres MPD-Parsing (`dashParse` :70), Stückindex (`dashSegmentIndex` :233), Abgleich (`dashMatchSegment` :373), Bindungsentscheidung (`dashBindDecision` :434), Annex-I-Erkennung (`dashHasUrlParam` :219) |
| `src/039-dash-fingerprint.js` | Modell wie der Helfer (`dfpModel` :528), Fingerabdruck `kadri-dash-fp/1` (`dashFingerprint` :959), Vorprüfung (`dfpGate` :880, `dfpWhy` :835, `dashGateFor` :987), BaseSelection (`dfpSelection` :380), Annex I (`dfpUrlParam` :330) |
| `src/040-quellen-netzwerk.js` | Ressourcenbeobachter (`PerformanceObserver` :544, `seeUrl` :153), MPD-Verarbeitung (`notePlaylist` :323), Treffer (`dashHit` :429, `dashSee` :436, `obsNote` :449), `dashOfferOf` :494 |
| `src/045-media-source.js` | Quellenmodell (Typ, Rolle, Herkunft, Zuordnung `unbound/ambiguous/bound`) |
| `src/046-dash-ebenen.js` | Ebenenmodell E1–E5 (`dashLevels` :67, `dashLevelsFor` :193), eine Entscheidung für Menü, Player und Diagnose |
| `src/060-quellen-zuordnung.js` | Medien-Epoche je Video, `dashBindingFor` :329 |
| `src/065-media-registry.js` | Registry: `documentKey`, `playerId`, `mediaEpoch` (neu bei `emptied`/`loadstart`), Revisionen; `bind = {player, gen, rev}` |
| `src/080-helper-app.js` | `helperDl` (caps, dashplan, dashstart, …), gemerkte Helfer-Fähigkeiten |
| `src/105-download-knopf.js` | Angebot (`dashOfferFor` :38), Planung (:349), Prüfung unmittelbar vor `dashstart` (:371) |
| `src/180`, `src/280` | Player-Menü, Diagnose (anonym) |

**Helfer** (`app/src/main/java/de/evp/helfer/`):

| Datei | Aufgabe |
|---|---|
| `ControlCommands.java` | Befehlsschema (strikt, siehe Kopfkommentar :15–40), Fähigkeiten `dashdl` (:186–194: `ctx`, `alt`, `urlq`) |
| `ChannelServer.java`, `HelferService.java` | Kanal-Server, Dienst |
| `dash/DashXml.java` | gehärtetes XML (keine DTD/Entities, Grenzen, Namensräume) |
| `dash/DashManifest.java`, `DashTemplate`, `DashUrl`, `DashNum`, `DashLimits` | Lesen, Vererbung, Adressierung, Stückfolgen, Grenzen |
| `dash/DashProfile.java` | S3-Profil, Ausschlussgründe (`set-essential`, `rep-essential`, `codec`, …) |
| `dash/DashPlan.java`, `DashFingerprint.java`, `BaseSelection.java`, `DashUrlParam.java` | Plan, Fingerabdruck, Auswahl mehrerer BaseURL, Annex I |
| `dashdl/DashEngine.java`, `DashFetch.java`, `Fmp4Inspect.java` | Laden, Prüfen der Fragmente (Codec, AAC-LC, Dauer), Remux |
| `DashCore.java`, `DashDownloads.java` | Anbindung an App und Journal |
| `net/SafeHttpClient.java`, `AddressPolicy`, `GuardedSocketFactory`, `NetRules`, `Nat64Discovery`, `RequestContext` | Netzschicht ohne Cookies, mit SSRF-Schutz |
| `hlsmux/`, `hls/`, `Mp4Downloads`, `dl/` | HLS- und MP4-Pfade |

### B4. CI

**Kadri** (`.github/workflows/`):

| Workflow | Zweck |
|---|---|
| `ci.yml` | Push auf `main`, PRs, manuell; ubuntu-24.04. Jobs u. a. Build, Browsertests, `helper-channel` |
| `dash-e2e.yml` | **nur manuell** auf `test/s4b-dash`: baut den Desktop-Helfer am Harness-Pin (prüft den exakten SHA), DASH-Einheits- und E2E-Tests. Letzter Lauf: Run `45356996007` auf `5dd720a`, erfolgreich. Auf `33c8e6a` nicht gestartet (nur Testdateien geändert) |
| `p4-test-extension.yml`, `s3d-test-delivery.yml`, `c3-test-extension.yml`, `channel-device-package.yml`, `c3-site-diagnosis.yml`, `performance-validation.yml` | Liefer- und Sondernachweise mit Sperren/Pins; nicht ohne Freigabe auslösen |

**Helfer:**
- `dash-core.yml`: Trigger auch auf `test/s3d-*` und `test/s4b5-*`; JVM-Tests, Mutationen, Media3-Remux.
- `helper-channel.yml`: Emulatoren API 26/29/34.
- Weitere: `build.yml`, `hls-download.yml`, `android-e2e*.yml` u. a.

**Bekannte Umgebungsprobleme:**
- `ubuntu-latest` ist 26.04; die Kadri-Jobs sind deshalb auf `ubuntu-24.04` gepinnt (S3d).
- Maven Central 429 hat `dash-e2e` einmal ohne Ergebnis gelassen (S4b-6, Run `45297865408`); in S4b-8 ist der Lauf wieder grün.
- Der Kadri-Job `helper-channel` in `ci.yml` war in S3d durch Altbefunde rot, die vor S3c bestanden (Bericht `DASH-S3D-*.md`). Den aktuellen Stand prüfen.
- Helfer API 29: Altbefund `P4B-A10-SIZE` (MediaStore-Veröffentlichung, rows=0), siehe Helfer-Doku `DOWNLOADS-P4B.md` und `FINAL-DEVICE-VALIDATION.md`.
- **Lokal: `test_detect.py` hat 2 Fehler.** Das verwendete Chromium spielt einen endungslosen HLS-Stream selbst, statt hls.js zu nutzen. In der CI (`build-test`) war der Test grün. Siehe Abschnitt 3.

### B5. Branches

| Zweck | Branch |
|---|---|
| stabil / Release-Grundlage | `main` (beide) – **nicht bearbeiten** |
| aktueller DASH-Entwicklungsstand | Kadri `test/s4b-dash`, Helfer `test/s4b5-dash` |
| ältere isolierte Testbranches | Kadri `test/s3d-*`, `test/s3g-dash-diag`, `test/s3h-dash-page-redirect`, `test/s4a-dash-matrix`; Helfer `test/s3d-dash`, `dash-s3a`, `dash-s3b` |
| Integration Kanal (älter) | `feature/helper-channel-control` (in `main` gemergt über PR #9) |

Neue Arbeit gehört auf neue, isolierte Testbranches **auf** den obigen Ständen, nicht auf `main`.

---

## C. Bisherige Entwicklungsphasen

Commits beziehen sich auf Kadri `test/s4b-dash` bzw. Helfer `test/s4b5-dash`, wenn nicht anders vermerkt. Berichte liegen in `docs/handoffs/berichte/`. Für S3a–S3c gibt es Doku in den Repos: Helfer `DASH-S3A.md`, `DASH-S3B.md`; Kadri `DASH-S3C.md`.

### S3a/S3b – DASH-Kern und -Download im Helfer
- **Problem:** DASH-Seiten ließen sich nicht speichern.
- **Lösung:**
  - **S3a** (Helfer `64e58d0`, `4a3bc42`): gehärteter MPD-Parser, S3-Profil, vollständiger VOD-Plan, Strukturfingerabdruck v1 (nur JVM).
  - **S3b** (`54398dd`, Prüfungen `5657b0e`, `ee54864`): Download-Koordinator fMP4 H.264 + AAC → MP4. Nur AAC-LC (AudioSpecificConfig), strikte Dauer- und Vollständigkeitsprüfung gegen die tatsächliche Fragmentdauer.
- **Tests:** JVM-Tests, Mutationsprüfung, Media3-Remux; `DashDownloadsInstrumentedTest` API 26/29/34 bestanden (S3d).
- **Grenzen:**
  - nur VOD, eine Periode, fMP4 AVC/AAC-LC;
  - `DashProfile` lässt `mp4a.40.5/29` zu, `Fmp4Inspect` lehnt sie ab (gleiches Ergebnis, Aufräumpunkt).

### S3c – Kadri speichert DASH über den Helfer
- **Problem:** Kadri muss das MPD des laufenden Videos sicher bestimmen und dem Helfer übergeben.
- **Lösung** (`fe72988`, Review `09d32fb`; Vorstufen S0–S2 `93613ea`…`b4a8289`):
  - MPD nur gebunden über beobachtete Stückfolgen (≥ 3 in Folge, exakte Adresse inkl. Query).
  - Fingerabdruck `kadri-dash-fp/1` in JS, Vorprüfung `dfpGate`, `dashplan`/`dashstart` über den Kanal.
  - Das Angebot wird vor der Auswahl und unmittelbar vor `dashstart` erneut geprüft.
- **Tests:** 24 Fingerabdruck-Golden-Vektoren, Node- und Chromium-Tests, E2E gegen den echten Helfer.
- **Grenze:** Grundlage der Bindung ist der Resource-Timing-Beobachter im Hauptthread des Fensters, also ohne Worker.

### S3d – CI und Emulator-Abnahme
- **Lösung:** `dash-e2e.yml` mit eigenem Harness-Pin (`ad99e1f`), Test-Liefernachweis (`ca56f7f`), Jobs auf ubuntu-24.04.
- **Ergebnis:** Helfer-Instrumentationstests API 26/29/34 bestanden; Altbefunde (`helper-channel`, `P4B-A10-SIZE`) dokumentiert, nicht behoben.
- **Teil 2:** Samsung-Paketprüfung; Signaturkonflikt der alten App belegt (Berichte `DASH-S3D-TEIL2*.md`).

### S3e – Befund Samsung: keine Bindung, VP9/Opus
- **Problem:** Auf dem Gerät keine Bindung, 0 von 46 beobachteten Abrufen passten.
- **Ursache:** Die beobachteten Stückadressen trafen den Index nicht. VP9/Opus/WebM ist **nicht** die Ursache: Der Index ist codec-unabhängig, 30/30 Treffer im Versuch.
- **Ergebnis:** Nur Bericht (`DASH-S3E-WEBM-BEFUND.md`) mit Architekturvorschlag für VP9/Opus/WebM (S4c).

### S3f/S3g/S3h – Testseite, Diagnose, Weiterleitung
- **S3f:** öffentliche HTTPS-DASH-Testseite (`bf9bc06`). Ablehnungen von VP9/WebM und HE-AAC sind korrekt fail-closed.
- **S3g:** Die Diagnose zeigte eine angenommene Helfer-Fähigkeit statt der tatsächlichen.
  - Fix `8b38bbb` (G1/G2) und `8ad03f9` (G3, nur Anzeige).
  - Kadri-Test-ZIP 1.12.18 (`a1b3f63`).
- **S3h:** keine Bindung auf dem Gerät.
  - **Ursache:** Die **Testseite** löste Stücke gegen die angefragte statt gegen die endgültige MPD-Adresse auf (githack 301). Die Zeitleiste führte die Ausgangsadresse, deshalb entstand korrekt keine Bindung.
  - **Fix:** nur die Testseite (`4290251`). Kadri nutzt die endgültige Adresse.

### S4a – Allgemeine DASH-Analyse und Player-Matrix
- **Prüfstand:** `tests/s4a_dash_player_matrix.py` (`72c4655`) mit
  - eigenem Player sowie dash.js 4.7.4, 5.2.1 und Shaka 4.11.7;
  - zwei neutralen Hosts;
  - echter Erweiterung und echtem Helfer-Kanal.
- **Befunde:** Allgemeine Ursachen fehlender Angebote sind:
  - Worker, MSE im Worker, srcdoc;
  - mehrere BaseURL;
  - Query-Token;
  - Fenster-Relay;
  - abweichende Vorprüfung;
  - Byte-Bereiche;
  - Codecs.

  Die UI vermischte die Ebenen. Kadri hat **in keinem Lauf falsch gebunden**.
- **Ergebnis:** Plan S4b/S4c im Bericht `S4A-DASH-ALLGEMEIN-BERICHT.md`.

### S4b-3 – Fenster-Relay der Planung (`6a1e184`)
- **Problem:** Planung im iframe kam scheinbar nicht zurück.
- **Ursache:** Die Wartebedingung des **Prüfstands** war falsch.
- **Echte Produktfehler, dabei gefunden und behoben:**
  - keine Antwortzuordnung: eine veraltete Auswahl wurde angenommen;
  - ein zweiter Tipp wurde ignoriert.
- **Lösung:** Anfragekennung (`rid`/`seq`) je Tipp; der laufende Ablauf übernimmt die Kennung des neueren Tipps.
- **Abnahme:** c1/c3 5/5 Planungen und Downloads; c1n (veraltete Antwort) abgelehnt.

### S4b-1/2 – Ebenen E1–E5 (`008e971`)
- **Problem:** Irreführende Meldungen („derzeit nicht unterstützt“, wo nur die Bindung fehlte).
- **Lösung:**
  - `src/046` mit fünf Ebenen:
    - E1 Manifest;
    - E2 Bindung;
    - E3 Format;
    - E4 Helfer-Fähigkeit;
    - E5 Planung/Download.
  - feste Codes, eine Entscheidungsfunktion für Menü, Player und Diagnose;
  - anonymer Langdruck;
  - Warteblatt bei laufender Planung; Kanal-Abbruch nach 25 s, Frist 45 s.
- **Tests:** `dash_message_check.js` 60/60; Matrix prüft Ebenencodes hart.

### S4b-4 – Medien-Epochen (`7030444`, Fix `1494e56`)
- **Problem:** Das Zählfenster „ab `loadstart` − 3 s“ verursachte Konkurrenz (Vorspann) und zählte Stücke über Epochen hinweg.
- **Lösung:**
  - Ein Stück zählt nur, wenn sein **Anfragebeginn** in der aktuellen Medien-Epoche des Elements liegt. Grundlage sind die Epochen der Registry (`src/065`).
  - Ohne sichtbares `loadstart` (Shadow-DOM, Firefox) zählt erst der Beobachtungsbeginn, ohne Toleranz.
  - Das Diagnosefenster ist anonym.
- **Fix:**
  - **P1:** Rückgefüllte Treffer (`notePlaylist` → `dashHit`) hatten keinen Anfragebeginn.
  - **P2:** Die Diagnose nutzte die Ankunft statt des Anfragebeginns.
  - Neuer Test: `test_dash_backfill.py`.
- **Grenzen:**
  - Shadow-DOM-Player (s1): `loadstart` ist nicht `composed`.
  - Werbung in derselben MediaSource: eine Epoche, Konkurrenz.

### S4b-5 – Vorprüfungs-Gleichlauf (`f237546`; Helfer nur Tests `f38c689`)
- **Problem:** Kadri bot an, wo der Helfer erst nach dem Tipp ablehnte:
  - Zeitleistenfehler;
  - Abdeckung;
  - Grenzen;
  - Kollisionen;
  - Journalgrenze.
- **Lösung:** Kadris Vorprüfung entscheidet wie `dashplan`. Gemeinsame Golden-Vektoren **dash-gate/1**: Fixtures byte-gleich, Erwartungen von Hand hergeleitet, nicht aus einer Implementierung erzeugt.

### S4b-6 – P1 Anfragebeginn + mehrere BaseURL (`2022767`, `72d5a46`; Helfer `be157b2`, Tests `1ef214b`)
- **Teil A (P1):**
  - **Befund:** Ein unbekannter Anfragebeginn wurde still durch die Ankunft ersetzt. Ein vor der Epoche angefragtes Stück konnte dadurch die neue Epoche belegen.
  - **Fix:** Ein unbekannter Anfragebeginn belegt die Epoche nie.
- **Teil B:**
  - Index je erklärter BaseURL-Alternative; exakte Treffer; `alt-mixed`/`alt-competing` → keine Bindung.
  - Gemeinsame Auswahl `BaseSelection` (`m:1;s3:0`), die nur im MPD erklärte Indizes wählen kann.
  - Fingerabdruck über alle Alternativen; `dashplan` v2 mit `alt` nur bei Fähigkeit `dashdl.alt`.
  - Grenzen: 8 BaseURL je Element, 16 Kombinationen je Darstellung, 256 Indexeinträge.
- **Abnahme:** Download über die zweite BaseURL (Matrix d5); CDN-Wechsel (d8) → keine Bindung.

### S4b-8 – Annex I UrlQueryInfo (`5dd720a`; Helfer `6e553fc`)
- **Grundlage:** MPEG-Schema und dash.js. **Der Normtext lag nicht vor.**
- **Minimalform:**
  - `urn:mpeg:dash:urlparam:2014`;
  - `UrlQueryInfo` mit genau `queryTemplate="$querypart$"` und `useMPDUrlQuery="true"`.

  Die Query der **endgültigen** MPD-Adresse wird unverändert an Init- und Stückadressen gehängt.
- **Alles andere fatal:** `urlparam-unsupported`, `-template`, `-conflict`, `-limits`, `-query`.
- **Protokoll:** Fähigkeit `dashdl.urlq`, sonst E4 `no-urlq`.
- **Tests:** Vektoren u01–u38 (109 Zeilen), `test_dash_urlparam.py` 32/32, Matrix u1–u6, volle Matrix 339/339.

### S4b-7a – Machbarkeitsstudie Worker/Rahmen (`33c8e6a`, nur Tests) → Abschnitt E

---

## D. Aktuelle DASH-Architektur [PRODUKT]

1. **Manifest-Erkennung und Parsing (E1):**
   - `chrome/page.js` (MAIN-Welt) liest `fetch`/XHR-Antworten der **Fenster-Hauptthreads** mit und reicht MPD-Text weiter.
   - `src/040 notePlaylist` (:323) verarbeitet nur gültige MPD:
     - `dashParse` (`src/038:70`): sicherer DOMParser-Weg, keine DTD, Grenzen;
     - Zusammenfassung, Fingerabdruck, Index.
   - Basis für relative Adressen ist die **endgültige** Adresse (`finalUrl || reqUrl`).
   - **Nicht erfasst:** Abrufe aus Workern, Service Workern, srcdoc- und about:blank-Rahmen (dort laufen `page.js`/`sub.js` nicht), MPD aus JSON-APIs.
2. **Stückindex und Bindung (E2):**
   - **Index:** `dashSegmentIndex` (`src/038:233`) berechnet alle Init- und Stückadressen je Darstellung (und je BaseURL-Alternative), mit Annex-I-Query.
   - **Beobachtung:** Der `PerformanceObserver` (`src/040:544`) meldet Ressourcenabrufe des Fensters mit Ankunft **und** Anfragebeginn (`seeUrl` :153).
   - **Treffer:** `dashMatchSegment` (:373) gleicht **exakte** Adressen ab: Schema, Host, Pfad, Query.
   - **Entscheidung:** `dashBindDecision` (:434):
     - ≥ 3 zusammenhängende Stücke einer Darstellung;
     - Spanne und Alter begrenzt;
     - genau ein Kandidat, sonst `ambiguous`;
     - Gründe u. a. `keine-treffer`, `zu-wenig-folge`, `konkurrenz`, `mehrere-videos`, `alt-mixed`, `urlparam`.
   - `dashBindingFor` (`src/060:329`) verbindet Element, Epoche und Bindung.
3. **Medien-Epochen:**
   - **Registry (`src/065`):** `mediaEpoch` je Videoelement, neu bei `emptied`/`loadstart`; `bind = {player, gen, rev}`.
   - Ein Stück zählt nur mit **bekanntem Anfragebeginn ≥ Epochenbeginn** (S4b-4/S4b-6).
   - Der Helfer bekommt `bind` als Kontext. `dashstart` verlangt dieselbe Quelle, Revision und Epoche (`src/105:101`, `:371`).
4. **iframe-Relay:**
   - Videos in fremden Fenstern bekommen das Menü im Hauptfenster (`src/035`).
   - Nachrichten tragen den `frameKey`: je Seite aus Grundschlüssel und `ancestorOrigins`; ohne `ancestorOrigins` gibt es keinen Schlüssel.
   - Jeder Tipp hat eine Anfragekennung. Veraltete Antworten werden oben und im Fenster verworfen (S4b-3).
5. **Vorprüfung und E1–E5:**
   - `dfpModel`/`dfpGate`/`dashGateFor` (`src/039`) entscheiden wie Helfer-`dashplan`: Profil, Adressierung, Abdeckung, Grenzen, Kollisionen, Journalgrenze.
   - `dashLevels`/`dashLevelsFor` (`src/046`) liefern die erste blockierende Ebene mit festem Code. Menü, Player und Diagnose nutzen dieselbe Funktion.
6. **Fingerabdruck und Manifestwechsel-Schutz:**
   - `kadri-dash-fp/1` (`dashFingerprint` :959 ↔ Helfer `DashFingerprint.java`): Struktur über alle Alternativen.
   - Der Helfer lädt das MPD selbst und vergleicht. Abweichung → `manifest_mismatch` (Plan) bzw. `plan_changed` (Start). Nichts wird geladen.
7. **Mehrere BaseURL:** siehe S4b-6. `BaseSelection` kann nie einen Host einführen. Die Netzpolitik (DNS, Ports) entscheidet nur der Helfer (`blocked_host`).
8. **UrlQueryInfo:** siehe S4b-8 (`dfpUrlParam` :330 ↔ `DashUrlParam.java`).
9. **Helfer-Fähigkeiten und Protokoll:**
   - `caps` → `"dashdl":{"v":1,"profiles":["fmp4-avc-aac"],"fp":"kadri-dash-fp/1","ctx":1,"alt":1,"urlq":1}` (`ControlCommands.java:186–194`).
   - `dashplan` v1/v2 (`url`, `fp`, `bind`, `played`, `ref`, `ua`, `alt`) und `dashstart` v1. Felder werden streng geprüft, unbekannte Felder abgelehnt.
10. **Netz-, Cookie- und SSRF-Schutz:**
    - **Helfer:** `SafeHttpClient`:
      - keine Cookies, keine Authorization, keine Origin;
      - `AddressPolicy` (private Netze, Metadaten-IPs, Ports), `GuardedSocketFactory` (Prüfung beim Verbinden), Weiterleitungen neu geprüft, NAT64.
      - Zusätzlich die frühe statische Prüfung jeder geplanten Adresse.
    - **Kadri:** DNR-Regeln, `guard` in `background.js`. Kadri ruft für DASH selbst nichts ab.
11. **DRM:** ContentProtection an **jeder** Stelle im MPD (auch schemafremd) → `dash-protected`, auf beiden Seiten.
12. **Download und Remux:**
    - `DashEngine` lädt Init und Stücke der gewählten Video- und Tondarstellung.
    - `Fmp4Inspect` prüft Codec, AAC-LC, Zeitskalen und Dauer.
    - Remux nach MP4 mit Media3 (`Mp4Muxer`).
    - Jeder Versuch, auch eine Wiederaufnahme, lädt das MPD neu und vergleicht den Fingerabdruck (`plan_changed`).
    - Journal über den HLS-Journal-Mechanismus; Anbindung in `DashDownloads.java`. Details: Helfer `DASH-S3B.md`.

---

## E. Ergebnisse der Studie S4b-7a [STUDIE]

Vollständiger Bericht: `docs/handoffs/berichte/S4B-7A-BERICHT.md`. Code: `tests/s4b7/probe/` (eigene Messsonde, **nicht Kadri**), `tests/s4b7_webrequest_study.py`, `tests/s4b7_essential_audit.py`, `tests/s4b7/essential/`.

> **Nichts davon ist im Produkt.** Die normale Erweiterung hat weder `webRequest` noch MSE-Hashing noch
> `match_about_blank`. Alle Ergebnisse stammen aus Desktop-Chromium mit lokalen Testseiten.

1. **Worker-fetch (b1) und MediaSource im Worker (b2):**
   - `webRequest` (nur beobachtend) sah MPD und alle Stücke.
   - Jede Anfrage trug `tabId`, `frameId` und `documentId` des Dokuments, **das den Worker erzeugt hat**; `type` war immer `xmlhttprequest`.
   - Es gibt **keinen** Bezug zum Worker oder zum Videoelement.
2. **R1 (Dokument + Netz + Epoche):**
   - Regel: Stück-Anfragen unter der `documentId` des Videos nach dessen `loadstart`, mindestens 3 zusammenhängend.
   - Gebunden wird nur bei genau 1 Video und genau 1 MPD im Dokument.
   - **Ergebnis:**
     - **richtig:** Einzelvideo-Fälle (m1, b1, b2, c2, c2w, nest, xo, ck, nav, wrst, swch, redir);
     - **keine Bindung:** zwei Videos, Vorladen, Werbung + Zweitvideo.
   - In 56/56 Regelprüfungen wurde nie falsch gebunden.
3. **R2 (Hash der angehängten MSE-Bytes):**
   - Die Sonde hakte in der MAIN-Welt `SourceBuffer.prototype.appendBuffer`, `MediaSource.addSourceBuffer` und `URL.createObjectURL`.
   - Sie hashte eine Kopie jedes Anhangs (SHA-256, 12-Byte-Präfix; Median 0,2 ms, max. 2,6 ms bei bis zu 170 KB).
   - Sie trennte zwei Videos, Vorladen, das versteckte Zweitvideo und Werbung → Hauptfilm.
   - Bei byte-gleichen Stücken zweier MPDs: keine Bindung.
   - **Wichtige Einschränkung des Nachweises:** Die Zuordnung „Hash → (Darstellung, Stücknummer)“ kam im Prüfstand aus einer **vorab aus den Fixture-Dateien berechneten Tabelle** (`HASH` in `tests/s4b7_webrequest_study.py`). Der Prüfstand kannte die Bytes jedes Stücks also im Voraus.
     - `webRequest` liefert **keine Bodies**.
     - Im Produkt fehlt diese Beweisquelle.
     - Wie die angehängten Bytes mit den beobachteten Netzabrufen verknüpft werden sollen, ist **offen** (Abschnitt 9, Frage 4).
     - Der Bericht S4B-7A empfiehlt R2 als „den Beweis“. Diese Empfehlung ist unter diesem Vorbehalt zu lesen.
   - **Nicht verfügbar** bei MediaSourceHandle (MSE im Worker): Im Hauptthread gibt es dann keine SourceBuffer.
   - **In unsicheren Kontexten** (http-Rahmen) fehlt `crypto.subtle`. Die Sonde fiel auf FNV-1a zurück; das ist **kein** Produktbeweis.
4. **srcdoc / about:blank:**
   - **srcdoc:**
     - Inhaltsskripte laufen mit `match_about_blank` und `match_origin_as_fallback`.
     - Der Rahmen hat eine eigene `documentId`, die Abrufe gehören zu ihr.
   - **about:blank:**
     - Alle gemessenen Abrufwege tragen die `documentId` der **Eltern-Seite**: `contentWindow.fetch`, eigenes Skript (fetch und XHR).
     - Medienereignisse kommen dagegen aus dem Rahmen-Dokument. R1 und R2 binden dort nicht.
   - **Nach `document.open/write`** in about:blank sah die Sonde keine Medienereignisse mehr: Die Listener am Dokument waren entfernt.
5. **Service Worker:** Abrufe mit `tabId −1`, ohne `documentId`; nicht zuordenbar.
6. **Uhren:**
   - `webRequest.timeStamp − Date.now()` beim Absenden: Median 1,9–2,3 ms, max. 11,5 ms, im Hauptthread und im Worker.
   - Damit liegt `webRequest.timeStamp` auf der Epochenachse von `Date.now()`.
7. **MPD-Neulesen ohne Cookies:**
   - Die Sonde ließ das MPD einmal vom Inhaltsskript **des zugeordneten Dokuments** mit `credentials: 'omit'` neu laden.
   - **Ergebnis:**
     - byte-gleich, auch über einen fremden Host (CORS) und an der endgültigen Adresse nach 302;
     - ein Cookie-pflichtiges MPD → 403, also kein Abdruck (fail closed).
   - Ein zusätzlicher Abruf je MPD ist für den Server und für `webRequest` sichtbar.
8. **Grenzen des Desktop-Nachweises:**
   - lokale Hosts und ein eigener Testplayer;
   - Fixture-Bytes sind über mehrere MPDs identisch (deshalb wählten die Szenarien verschiedene Darstellungen);
   - kein echtes CDN, kein HTTPS bei den meisten Fällen, keine Last.
9. **Vivaldi Android:**
   - Die Chromium-Feature-Dateien (Zweig `main`, 24.11.2026) führen `webRequest` ohne Plattformsperre. Das gilt formal also auch für `desktop_android`.
   - Ob Vivaldi die Ereignisse samt `documentId` liefert, wie Uhr und Service-Worker-Laufzeit sich verhalten und was Hashing auf dem Gerät kostet: **[UNBEKANNT]**.
   - Ein Gerätetest erfordert die Installation der Messsonde und damit die **Freigabe des Eigentümers**.
   - **Vivaldi Android gilt deshalb nicht als unterstützt** für Worker- oder Rahmen-Erkennung.
10. **EssentialProperty-Audit:**
    - Kadri und Helfer übergehen identisch ein unbekanntes EssentialProperty auf MPD-Ebene, auf Period-Ebene und an schemafremden Stellen. Sie **bieten an**.
    - dash.js 5.2.1 filtert ebenfalls nur AdaptationSet, Representation und Preselection.
    - Vorschlag `mpd-essential` mit Fixtures e01–e11 (`tests/s4b7/essential/vorschlag.tsv`).
    - Gegenprobe: keine der 278 bestehenden MPD-Fixtures wäre betroffen.
    - **Nicht umgesetzt.**

---

## 3. Offene Fehler und Risiken

Einstufung:
- **F** = nachgewiesener Produktfehler;
- **E** = bestätigte Einschränkung;
- **R** = potenzielles Risiko;
- **H** = nicht verifizierte Hypothese.

| # | Punkt | Einstufung | Beleg / Ort |
|---|---|---|---|
| 1 | Worker-DASH (b1/b2) und srcdoc/about:blank-Player werden nicht erkannt: kein MPD-Text, keine Bindung, kein Angebot | E | Matrix b1/b2/c2; `chrome/manifest.json` |
| 2 | R2 ohne Beweisquelle für die Netzbytes: Die Studie nutzte vorab bekannte Fixture-Hashes, `webRequest` liefert keine Bodies | E (für die Studie) / R (für jede Umsetzung) | `tests/s4b7_webrequest_study.py` (`HASH`) |
| 3 | R2 nicht verfügbar bei MediaSourceHandle (MSE im Worker); mit mehreren Videos dann gar keine Bindung | E | Studie b2/two2 |
| 4 | Mehrdeutigkeit bei mehreren Videos, mehreren MPDs oder identischen Stückinhalten (z. B. dieselbe Werbung in zwei Playern): keine Bindung | E | Studie twosame, twoad/v1; Matrix f2 |
| 5 | about:blank-Rahmen: Abrufe unter der Eltern-`documentId`; nach `document.open` keine Ereignisse mehr | E (Desktop) | Studie blankf, c2b, c2bw |
| 6 | Unbekanntes EssentialProperty auf MPD-/Period-Ebene bzw. an schemafremden Stellen wird übergangen und **angeboten** | F (Abweichung vom Grundsatz „nicht verstanden → nicht deuten“; Normtext nicht geprüft) | `tests/s4b7_essential_audit.py` 22/22; `dfpWhy` `src/039:835`; `DashProfile.why` |
| 7 | `test_detect.py`: 2 Fehler lokal. Chromium spielt den endungslosen HLS-Stream selbst; Ursache Umgebung bzw. Browserversion, in CI grün | E (Testumgebung) / H (ob ein Produktaspekt dahintersteckt, ist nicht untersucht) | Berichte S4b-4 bis S4b-8 |
| 8 | UrlQueryInfo nur Minimalform, ohne Normtext. Umkodierung durch Player (dash.js bei `/ : + , @ $ ; =`) führt zu keiner Bindung. Rotierende Tokens führen zu `manifest_mismatch` | E | `S4B-8-BERICHT.md` §9 |
| 9 | Shadow-DOM-Player: `loadstart` ist nicht `composed`. Bindung erst ab Beobachtungsbeginn; kurze bzw. vorgepufferte Videos bleiben ungebunden | E | `S4B-4-MEDIEN-EPOCHEN-BERICHT.md` §5 |
| 10 | UI-Tests laufen gegen `dist/test` (offenes Shadow-DOM), nicht gegen die Auslieferungsfassung | E | `tools/build.js --test` |
| 11 | Firefox: kein `page.js`, kein Kanal zum Helfer, keine automatisierten Tests | E | `ENTWICKLUNG.md`, `README.md` |
| 12 | Keine Android-Abnahme des Entwicklungsstands S4b-x (Kadri und Helfer); der Android-Build des Helfers für S4b-6/8 wurde hier nicht gebaut | E | Berichte S4b-6/8 |
| 13 | Codecs/Container: VP9, Opus, WebM, HE-AAC, AV1 und HEVC werden nicht gespeichert (fail closed, eigene Meldung) | E | `dfpGate`, `DashProfile`, `Fmp4Inspect`; Bericht S3e |
| 14 | `tools/sync-src.sh` würde Kadri-eigene DASH-Module löschen | R | B1 |
| 15 | Netzpolitik nur im Helfer: Die Vorprüfung kann `ok` zeigen, wo der Helfer `blocked_host` antwortet | E | dash-gate/1 b14/b15 |
| 16 | Mehrere BaseURL: CDN-Wechsel während der Folge (`alt-mixed`) wird abgelehnt; Alternativen ohne Treffer auf Set-Ebene verhindern das Angebot; feste Grenzen 8/16/256/64 | E | `S4B-6-BERICHT.md` C2 |
| 17 | Werbung und Hauptinhalt in derselben MediaSource: eine Epoche, also Konkurrenz, bis die Werbung älter als 20 s ist | E | `S4B-4…` §5 |
| 18 | Byte-Bereichs-Adressierung (SegmentBase/indexRange) nicht unterstützt (E2 „Zuordnung hier nicht möglich“) | E | S4a |
| 19 | Ohne Resource-Timing-Anfragebeginn keine Bindung (seit S4b-6). Sicher, kann aber Angebote verhindern | E | `S4B-6-BERICHT.md` A |
| 20 | `DashProfile` lässt HE-AAC (`mp4a.40.5/29`) zu, `Fmp4Inspect` lehnt ab. Gleiches Ergebnis, aber doppelte Logik | E (Aufräumpunkt) | Bericht S3f |
| 21 | Altbefunde: `P4B-A10-SIZE` (Helfer API 29, MediaStore rows=0); Kadri `ci.yml` Job `helper-channel` (S3d rot) | E / R | Helfer-Doku, Bericht S3d |
| 22 | Eine neue Berechtigung `webRequest` für S4b-7b: Installationswarnung und Verhalten beim Update (Deaktivierung bis zur Zustimmung?) in Chrome/Vivaldi ungeprüft | H | Studie §12 |
| 23 | MAIN-Welt-Instrumentierung (`appendBuffer`-Hook) könnte die Wiedergabe stören (Kopie je Anhang, Timing, Fehlerpfade); nur mit 3 Playern auf Desktop gemessen | H | Studie |
| 24 | `frameKey` ohne `ancestorOrigins` (ältere Firefox): kein Schlüssel, Player im Fenster eingeschränkt | E | `ENTWICKLUNG.md` |
| 25 | Normtexte ISO/IEC 23009-1 (Annex I, EssentialProperty-Semantik) lagen nie vor | E | S4b-8, S4b-7a |

---

## 4. Audit-Auftrag an Codex (zuerst nur auditieren, nicht implementieren)

**Ziel:** Codex soll unabhängig prüfen, ob die Gesamtarchitektur sicher, konsistent und wartbar ist und ob die
behaupteten Belege tragen. Frühere Aussagen (auch dieses Dokuments) gelten **nicht** als Tatsachen.

Zu beantworten:

1. Ist die Gesamtarchitektur (Kadri, Kanal, Helfer) sicher, konsistent und wartbar? Dazu gehören:
   - die doppelte DASH-Logik in JS und Java;
   - `sync-src.sh`;
   - Größe und Kopplung von `src/040`, `src/105` usw.
2. Sind die positiven DASH-Bindungsentscheidungen (`dashBindDecision`, `dashBindingFor`, Epochen, BaseSelection, Annex I) ausreichend belegt? Gibt es Wege zu einer falschen Bindung, etwa:
   - Resource-Timing-Einträge anderer Fenster;
   - gleiche Adressen über Epochen;
   - Cache;
   - Weiterleitungen;
   - Query-Varianten?
3. Können R1 oder R2 in einer Produktumsetzung falsch zuordnen, etwa durch:
   - Videos im selben Dokument;
   - about:blank-Erbe;
   - Service Worker;
   - Vorladen;
   - identische Inhalte;
   - Worker-Neustart?
4. **R2-Beweisquelle:** Wie sollen im Produkt die an ein Video angehängten Bytes mit den tatsächlichen Netzsegmenten verglichen werden, wenn `webRequest` keine Bodies liefert? Optionen bewerten, u. a.:
   - Neuladen der Stücke (Kosten, Cookies, Datenschutz);
   - der Helfer lädt die ersten Stücke bei `dashplan` und liefert Hashes;
   - Mitlesen von `fetch`/XHR-Antworten im Hauptthread (nicht für Worker).

   Fehlt eine Beweisquelle grundsätzlich?
5. Ist Hashing über `SourceBuffer.appendBuffer` mit dash.js, Shaka, hls.js und eigenen Playern sicher und zuverlässig möglich, ohne die Wiedergabe zu stören? Zu prüfen sind:
   - Kopie bzw. Speicher;
   - Ausnahmen;
   - `appendBufferAsync`;
   - `changeType`;
   - verschlüsselte Stücke;
   - unsichere Kontexte.
6. Welche Risiken entstehen aus:
   - MAIN-Welt-Instrumentierung;
   - fremden Seiten (Manipulation von Prototypen, gefälschte Ereignisse);
   - Rahmen und Workern;
   - zusätzlichen Berechtigungen (`webRequest`, `match_origin_as_fallback`)?
7. Ist der Umgang mit EssentialProperty (und SupplementalProperty, Preselection, Viewpoint …) ausreichend streng? Ist der Vorschlag `mpd-essential` richtig, zu streng oder zu schwach?
8. Gibt es Abweichungen oder Sicherheitslücken zwischen Kadri und Helfer? Zu prüfen:
   - Parser-Grenzen;
   - Adressauflösung;
   - Query;
   - BaseSelection;
   - Fingerabdruck;
   - Netzregeln;
   - Kanal-Feldprüfung.
9. Welche Tests sind echte Ende-zu-Ende-Beweise (echte Erweiterung, echter Helfer, echter Download), welche synthetisch oder nur teilweise? Insbesondere:
   - Player-Matrix;
   - dash-gate/1;
   - die Studie;
   - Emulatortests;
   - die fehlenden Gerätetests.
10. Welche Änderungen sind tatsächlich notwendig, und welche würden das Projekt unnötig verkomplizieren?

**Form der Ergebnisse:**
- Befunde nach **P0** (Sicherheit, falsche Bindung, Datenverlust), **P1**, **P2**, **P3**.
- Jeder Befund mit Codeverweis (`Datei:Zeile` am geprüften Commit), reproduzierbarem Beleg (Test, Befehl, Gegenprobe) und konkreter Empfehlung.
- Klar trennen: geprüft, vermutet, nicht prüfbar.
- **Keine Produktänderung ohne Freigabe des Eigentümers.**

---

## 5. Roadmap nach dem Audit [VORSCHLAG, nicht ausführen]

Codex darf die Reihenfolge nach dem Audit kritisch neu bewerten.

1. **EssentialProperty-Fix** (`mpd-essential`, gemeinsame Vektoren e01–e11 in dash-gate/1). Klein, sicherheitsrelevant.
2. **S4b-7b: sichere Worker- und Rahmen-Erkennung.** Vorschlag der Studie:
   - erst Rahmenabdeckung ohne neue Berechtigung (`match_about_blank`/`match_origin_as_fallback`, Brücke robust gegen `document.open`);
   - dann Inhaltsbeweis, erst nach Klärung der Beweisquelle (Frage 4);
   - `webRequest` nur beobachtend als eigener, freigabepflichtiger Schritt;
   - MPD-Neulesen ohne Cookies.
3. **Vivaldi-Android-Gerätetests** mit Messsonde und später dem Produkt. Jede Installation nur nach Freigabe. Testplan: `S4B-7A-BERICHT.md` §9.
4. **`test_detect` klären:** Umgebung gegen Produkt; Test robust machen, ohne ihn abzuschwächen.
5. **S4c: Codecs und Container**, insbesondere VP9/Opus in WebM (Analyse: `DASH-S3E-WEBM-BEFUND.md`), ggf. HE-AAC.
6. **Weitere allgemeine DASH-/HLS-Kompatibilität:** Byte-Bereiche, Mehrperioden, Shadow-DOM-`loadstart`, Werbung in derselben MediaSource.
7. **Abschluss:** Sicherheits-, Regressions- und Android-Tests (Emulator + Samsung).
8. **Beta nur nach ausdrücklicher Freigabe** des Eigentümers. Lieferpins und Liefersperren beachten.

---

## 6. Archivierte Berichte (`docs/handoffs/berichte/`)

Unverändert aus dem flüchtigen Arbeitsordner übernommen; die darin genannten Log-Pfade existieren nicht mehr.

| Datei | Phase |
|---|---|
| `DASH-S3D-BERICHT.md`, `DASH-S3D-TEIL2-BERICHT.md`, `DASH-S3D-TEIL2B-BERICHT.md` | S3d CI, Emulator, Samsung-Pakete |
| `DASH-S3E-WEBM-BEFUND.md` | S3e Bindung und VP9/Opus |
| `S3D-DASH-TESTSEITE-BERICHT.md` | S3f Testseite |
| `S3G-DASH-DIAGNOSE-BERICHT.md` | S3g Diagnose, 1.12.18 |
| `S3H-DASH-BINDUNG-UMLEITUNG-BERICHT.md` | S3h Weiterleitung |
| `S4A-DASH-ALLGEMEIN-BERICHT.md` | S4a Analyse und Matrix |
| `S4B-1-2-DASH-EBENEN-BERICHT.md`, `S4B-3-IFRAME-RELAY-BERICHT.md` | S4b-1/2/3 |
| `S4B-4-MEDIEN-EPOCHEN-BERICHT.md`, `S4B-4-FIX-BERICHT.md` | S4b-4 |
| `S4B-5-VORPRUEFUNG-BERICHT.md` | S4b-5 |
| `S4B-6-BERICHT.md` | S4b-6 |
| `S4B-8-ANALYSE.md`, `S4B-8-BERICHT.md` | S4b-8 |
| `S4B-7A-BERICHT.md` | S4b-7a (siehe Vorbehalt zu R2 in Abschnitt E) |

**Ältere Übergaben im Repository-Wurzelverzeichnis** (Kontext zu Kanal, C3, P4): `CLAUDE-HANDOFF.md`, `CLAUDE-C3-HANDOFF.md`, `P4C3-HANDOFF.md`, `SECURITY-*.md`. Sie beschreiben ältere Stände; maßgeblich für DASH ist dieses Dokument.

## 7. Unbekannt bzw. nicht geprüft

- Aktueller Status der Kadri-`ci.yml`-Jobs auf `test/s4b-dash` (dort nicht ausgelöst).
- Android-Build und Gerätetests des Helfers `6e553fc` bzw. von Kadri `33c8e6a`.
- Verhalten unter Vivaldi Android für alle S4b-Änderungen.
- Inhalt der ISO-Normtexte.
- Ob `test_detect` einen Produktaspekt verdeckt.
