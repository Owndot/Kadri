# S3d Teil 1 – CI-Integration und Android-Emulator-Abnahme (Bericht)

Stand: 22.11.2026. Nur isolierte Testbranches (`test/s3d-*`) gepusht. Keine Änderung an `main`, kein Merge, kein
Release, keine APK, keine Extension-ZIP. Teil 2 (Samsung-Paketprüfungen) **nicht begonnen** – STOP zur Freigabe.

## 1. Ergebnis in Kürze

| Bereich | Ergebnis |
|---|---|
| `DashDownloadsInstrumentedTest` API 26 | **PASS** (OK 5 Tests, `DASH_DEVICE_STATUS ok`) |
| `DashDownloadsInstrumentedTest` API 29 | **PASS** (OK 5 Tests, `DASH_DEVICE_STATUS ok`) |
| `DashDownloadsInstrumentedTest` API 34 | **PASS** (OK 5 Tests, `DASH_DEVICE_STATUS ok`) |
| Emulatorstart | auf allen drei APIs gestartet – **kein BLOCKED** |
| Helfer dash-core (JVM, Mutationen, Media3-Remux, Ende-zu-Ende) | **PASS** (alle 3 Jobs, 2 Läufe) |
| Kadri `dash-e2e` (eigener Harness-Pin, `test_dash_dl.py`, `dash_integration_check.js`) | **PASS** |
| Bestehende Helfer-Tests (Core, Kanal, Netz, MP4/C2, HLS, Signierpfad macOS) | **PASS**; API 29 rot nur durch Altbefund **P4B-A10-SIZE** |
| Bestehende Kadri-Tests `ci.yml` | 4/5 Jobs **PASS**; Job `helper-channel` **rot durch Altbefunde** (identisch auf der S3c-Basis `b4a8289`, nicht durch S3c/S3d) |

DASH selbst ist auf allen geforderten Ebenen grün. Offen sind nur Altbefunde, die schon vor S3c bestanden (Abschnitt 6).
Ob sie Teil 2 blockieren, ist eure Entscheidung (Abschnitt 8).

## 2. Commits und Branches

**Helfer** (`Owndot/video-assistent-helper`)

| Commit | Inhalt | Branch |
|---|---|---|
| `ee5486442266f2730893353ac71611809dfd21b1` | Produktstand S3b (freigegeben) | – |
| `3887569fbc12e9cce5f47fe821b9a5cec7952249` | Test-Harness „dash on“ (nur `tests/java/channel`) = **DASH-Harness-Pin** | – |
| `b383dff3fd95499d809ce9fb7ee6170ed7a5fbc7` | `dash-core.yml`: Trigger auch für `test/s3d-*` | – |
| `c485bb5a0eb8e387c80cd3303e3eb8192ec37eef` | S3d-CI-Befunde, nur Test-/Workflow-Code (Abschnitt 5) | `test/s3d-dash`, `test/s3d-dash-core` |

`git diff --stat ee54864..c485bb5 -- app/src/main` ist leer: **Produktcode unverändert.**

**Kadri** (`Owndot/Kadri`)

| Commit | Inhalt | Branch |
|---|---|---|
| `09d32fb` | S3c-Fix 1 (freigegeben) | – |
| `ad99e1f69a2111db5f476be0626716703e074f92` | `vendor/dash-harness/SOURCE` (Pin `3887569`) + `.github/workflows/dash-e2e.yml` | – |
| `3486d0dd27cbacdcc4e73d54e59567b9a4462a40` | Playwright-Jobs auf `ubuntu-24.04` (Abschnitt 5) | `test/s3d-dash` |

Der WASM-Pin `vendor/kadri-pairing-poc/SOURCE` (`helper_commit=bd5ab293…`) ist **unverändert**. `dash-e2e` prüft im Lauf,
dass beide Pins verschieden sind und der ausgecheckte Helfer exakt `3887569` ist (Log: „DASH harness pin 3887569… (WASM pin
bd5ab293… unchanged and separate)“, „HEAD is now at 3887569“).

## 3. CI-Läufe (endgültig)

### Helfer @ `c485bb5`

| Lauf | Job | Ergebnis |
|---|---|---|
| [helper-channel 45038147609](https://github.com/Owndot/video-assistent-helper/actions/runs/45038147609) | Core, JVM-Kanalprüfungen, Mutationen, WASM | PASS – `channel-mutations 34/34`, `safe-http 35/35`, `safe-http-mutations 29/29`, `dl-mutations 60/60`, `device-gate-selftest 148`, C2-Engine 14/14 |
| | API 26 Emulator (Job 137256368122) | PASS – Hauptlauf OK 46, Wiederholungen 22/22, DASH ok |
| | API 29 Emulator (Job 137256368406) | **FAIL (Altbefund P4B-A10-SIZE)** – Hauptlauf 45/46, Wiederholungen 20/22, jeweils nur `publishesThroughMediaStoreAndReadsBack` (MediaStore-`SIZE`=0, MP4-Pfad); DASH ok |
| | API 34 Emulator (Job 137256368276) | PASS – Hauptlauf OK 46, Wiederholungen 22/22, DASH ok |
| | P4-Signierpfad macOS | PASS |
| [dash-core 45038139166](https://github.com/Owndot/video-assistent-helper/actions/runs/45038139166) (`test/s3d-dash-core`) | dash-core-jvm / dash-engine-jvm / dash-remux-jvm | PASS / PASS / PASS |
| [dash-core 45038141605](https://github.com/Owndot/video-assistent-helper/actions/runs/45038141605) (`test/s3d-dash`) | dash-core-jvm / dash-engine-jvm / dash-remux-jvm | PASS / PASS / PASS |

Konkrete Zahlen in dash-core: `dash-mutations 58/58`; Engine `passed=113 failed=0`, `dashdl-mutations 53/53`, Netzschicht-Sperre
PASS; Remux `4/4` (180p und 360p, je 500 Bilder und 939 Tonblöcke, `analyze.py` OK; vertauschtes Init abgelehnt) und Ende-zu-Ende
`18/18` (avc, number, clipped, period10-seg3600 → done mit veröffentlichter MP4 = gemeldeter Größe, `analyze.py` gegen die
Quelle; short-fragments → `media_duration`, short-output → `verify_duration`, jeweils keine Datei). Runner-ffmpeg 8.0.1
(ubuntu-latest = 26.04).

### Kadri @ `3486d0d`

| Lauf | Job | Ergebnis |
|---|---|---|
| [dash-e2e 45037996099](https://github.com/Owndot/Kadri/actions/runs/45037996099) | dash-e2e | **PASS** – `dash-unit 83/83`, `dash-bind 25/25`, `dash-message 39/39`, **`dash-integration 26/26`** (echte DashEngine, verschlüsselter Kanal), `test_dash_fp 29/29`, `test_dash_mpd 61/61`, **`test_dash_dl 30/30`** (beide UI-Wege, Chromium + Erweiterung + echter Helfer), `test_dash_msg 23/23`, `test_dash_bind 28/28` |
| [ci.yml 45038000557](https://github.com/Owndot/Kadri/actions/runs/45038000557) | build-test, dnr-scope, helper-key-regression, proxy-memory-regression | PASS |
| | helper-channel | **FAIL (Altbefund, Abschnitt 6.2)** – WASM-Neubau byte-identisch, Desktop-Helfer gebaut, Build ohne Altclient PASS; danach rot im Regressionsnachweis mit `0cdf202` |

### Frühere Läufe (Befunde, nicht mehr maßgeblich)

[helper-channel 45035767047](https://github.com/Owndot/video-assistent-helper/actions/runs/45035767047) @ `3887569`,
[dash-core 45035793660](https://github.com/Owndot/video-assistent-helper/actions/runs/45035793660) @ `b383dff`,
[dash-e2e 45035872248](https://github.com/Owndot/Kadri/actions/runs/45035872248) und
[ci.yml 45035876427](https://github.com/Owndot/Kadri/actions/runs/45035876427) @ `ad99e1f` – Ursachen und Korrekturen in Abschnitt 5.
DASH auf den Emulatoren war schon dort auf allen drei APIs `ok`.

## 4. Android-Emulator-Abnahme DASH (echtes Media3-Remuxing auf dem Gerät)

`DashDownloadsInstrumentedTest`, 5 Tests, je API auf einem frischen x86_64-Emulator (Phase 2/3), Lauf 45038147609:

| Test | Prüft |
|---|---|
| `dashRemuxPublishAndDecodeOnThisDevice` | Download der fMP4-Stücke, Remux mit dem App-Remuxer (Media3), Veröffentlichung als MP4, Dekodierung jeder Probe auf dem Gerät |
| `encryptedInitFailsBeforeAnySegment` | Fehlerbehandlung: verschlüsseltes Init → Abbruch vor dem ersten Stück |
| `fingerprintMismatchIsRejected` | Fingerabdruck stimmt nicht → abgelehnt |
| `serviceStopNewEngineAndResume` | Dienst gestoppt, neue Engine, Wiederaufnahme → fertig |
| `persistentCancelLeavesNothing` | Abbruch bleibt bestehen, keine Reste |

| API | 180p (Video dekodiert / Ton dekodiert / Bytes) | 360p | Status |
|---|---|---|---|
| 26 | 500/500 · 939/939 · 623 884 | 500/500 · 939/939 · 1 211 339 | ok |
| 29 | 500/500 · 939/939 · 623 884 | 500/500 · 939/939 · 1 211 339 | ok |
| 34 | 500/500 · 939/939 · 623 884 | 500/500 · 939/939 · 1 211 339 | ok |

`DASH_DEVICE_STATUS ok` wird nur bei genau `OK (5 tests)` gesetzt (`tools/run-channel-instrumentation.sh`); sonst wäre der Job rot.

## 5. Gefundene und behobene Probleme (nur Test-/CI-Code, nur Testbranches)

1. **Helfer, Kanal-Mutationsproben veraltet** (Lauf 45035767047: `channel-mutations FAIL 29/34, STALE=5`). S3b (`54398dd`) hatte
   `ControlCommands`/`ChannelServer` um DASH erweitert; fünf Anker in `tests/java/channel/mutation.py` fanden ihren Code nicht mehr.
   Anker angepasst, Semantik der Mutanten unverändert. Lokal und in CI jetzt **34/34 getötet**.
2. **Helfer, `TestDashEngine` abhängig von der ffmpeg-Version** (Lauf 45035793660: 110/112). Der Test änderte fest die Bitrate
   `322838` (ffmpeg 6.1.1); `ubuntu-latest` ist jetzt 26.04 mit ffmpeg 8.0.1 (Bitrate 322832), die Änderung lief ins Leere, das MPD
   blieb gleich, der Auftrag lief korrekt durch (`done`), und die folgende Prüfung kippte mit. **Das Produkt verhielt sich richtig.**
   Jetzt wird die höchste vorhandene Bitrate um 1 erhöht, mit eigener Testvoraussetzung „MPD wirklich geändert“. Reproduziert: alter Test
   auf simulierten 8.0-Bitraten 110/112, neuer Test 113/113 (6.1.1 und simuliert), CI 113/113.
3. **Helfer, `dash-remux-jvm` mit Java 17** (`UnsupportedClassVersionError`, Robolectric android-all 16 = Klassenversion 65).
   Job auf Java 21, wie `hls-download.yml` (Job hlsmux).
4. **Kadri, Runner-Image** (Lauf 45035876427): `ubuntu-latest` ist jetzt 26.04 – „Playwright does not support chromium on
   ubuntu26.04-x64“ (dnr-scope, helper-channel) und `pyyaml==6.0.2` ohne Wheel (build-test). Wie im Helfer seit „Runde 6“ laufen diese drei
   Jobs und `dash-e2e` auf `ubuntu-24.04`. Tests, Pins und Schritte unverändert. `main` ist davon genauso betroffen.
5. **Kadri, `dash-e2e` erster Lauf**: okhttp-Download aus Maven Central 6× HTTP 404 (vorübergehend; derselbe Pfad lief Minuten später
   in anderen Jobs). Im zweiten Lauf ohne Änderung daran erfolgreich.

## 6. Altbefunde (bestanden vor S3c, nicht behoben – Entscheidung nötig)

### 6.1 Helfer API 29: P4B-A10-SIZE
Android 10 setzt die MediaStore-`SIZE`-Spalte eines veröffentlichten MP4 auf 0 (`publishesThroughMediaStoreAndReadsBack`). Seit P4b
dokumentiert, bewusst rot gehalten, „keine Android-10-Freigabe“. MP4-Pfad, kein DASH. Für das Samsung-Gerät (Android 17) nicht relevant.

### 6.2 Kadri `ci.yml`, Job `helper-channel`
Lokal nachgestellt, Kopf `3486d0d` gegen S3c-Basis `b4a8289`, gleiche Gegenstelle:

- **Regressionsnachweis `0cdf202` veraltet seit `9119cbe`** („ein Tap öffnet immer zuerst die Auswahl“). Der alte Stand scheitert jetzt
  früher an „tap must only open the selection“, die erwartete Meldung „re-probe required…“ kommt nicht mehr. Identisch auf `b4a8289`.
  `9119cbe` liegt nach dem letzten grünen Kadri-CI-Lauf (`c757a8e`, 17.11.) und vor S3c. Alle späteren Schritte des Jobs liefen
  deshalb in CI nicht.
- **Gegenstelle aus dem WASM-Pin `bd5ab29` zu alt**: Der Job baut den Desktop-Helfer aus dem WASM-Pin. Dieser kennt noch keinen
  Anfragekontext (`"ctx":false`), und Kadris Referer-/Kontext-Tests von später scheitern dagegen. Ergebnis gegen `bd5ab29`, **Kopf und Basis
  identisch**: `download-integration 41/44`, `hls-integration` Planfehler, `test_hls` 1, `test_direct_dl` 11, `test_frame_ui` 3,
  `test_mp4` 7 FAIL.
- **Dieselben Schritte gegen den DASH-Harness `3887569`** (= Produkt `ee54864`), Kopf `3486d0d`, lokal: channel-unit 45/45,
  download_unit 143/143, Vorgänger-Regression PASS, channel-integration 74/74, **download-integration 44/44**, hls-unit 97/97,
  dash-unit 83/83, P4-Identität PASS, **hls-integration 109/109**, channel-browser 34/34, netguard 4/4, popup-Nachweis PASS,
  test_helper 18/18, test_menu 7/7, **test_hls 24/24**, **test_direct_dl 87/87**, test_dl_sheet 35/35, **test_frame_ui 61/61**,
  test_dash_msg 23/23, test_dash_bind 28/28. Rot bleiben nur zwei bekannte Altbefunde:
  - `channel_mutation_check.js`: veralteter `dlstart`-Anker in `channel-session.js` (seit `c302244`)
  - `test_mp4.py` 7 FAIL: Diagnose-Vergleichsabruf bei HTTP 404/410 (schon auf der Basis rot)

  Diese Zahlen sind ein **lokaler** Nachweis (gleiche Chromium-/Playwright-Fassung, kein CI-Lauf).

## 7. Sicherheitsregeln eingehalten
Kein DRM-Bypass; Abbruch bei verschlüsseltem Init/Stück und bei verschlüsselten Samples (CI- und Gerätetests). Keine Cookies, kein
Authorization-Header, private Ziele gesperrt (`blocked_address`). Produktcode in Helfer und Kadri durch S3d unverändert. Kein vertraulicher
Seitenname in den neuen Dateien (`tests/confidential_names_check.js` im Job helper-key-regression PASS).

## 8. Offene Entscheidungen vor Teil 2
1. **Altbefunde 6.2 im Kadri-Job `helper-channel`:** Soll ich in einer eigenen, kleinen Testcode-Runde (nur Testbranch, eigene Freigabe)
   (a) den `0cdf202`-Nachweis an `9119cbe` anpassen, (b) den Job seine Gegenstelle aus dem DASH-Harness-Pin bauen lassen statt aus dem
   WASM-Pin (der WASM-Neubau bleibt am WASM-Pin), (c) den `dlstart`-Mutationsanker erneuern und (d) die 7 `test_mp4`-Diagnosefälle
   untersuchen? Oder genügt der lokale Nachweis aus 6.2 für die Freigabe?
2. **P4B-A10-SIZE** bleibt wie bisher rot und gilt nur für Android 10 – bitte bestätigen, dass das die Samsung-Testversion (Android 17)
   nicht blockiert.
3. **Freigabe für Teil 2** (Paket-ID, identisches Zertifikat wie `helper-p4test-3.apk`, Extension-ID
   `pcccpjllneffccpenbepmfbkjedllkkf`, keine neuen Berechtigungen, keine Änderung an Kopplungsdaten, zwei reproduzierbare Builds mit
   SHA-256). Bis dahin baue ich nichts.

## 9. Prüfpatches (SHA-256)

| Datei | SHA-256 |
|---|---|
| `helper-s3d-b383dff.patch` | `dddf980eb2943882af94c97bc2ac94f00bc76022915c79279c4bd9e98e6f4e07` |
| `helper-s3d-c485bb5.patch` | `030703cbbae1c4d735232f3a2efed2e6c3a2f0de7bb67dcfe4d41a3c79d1f72c` |
| `kadri-s3d-ad99e1f.patch` | `cae728a3b90797faa438228148161e46754cd48601b4cd117e64006ba04b4479` |
| `kadri-s3d-3486d0d.patch` | `e8a8a5da33c779d8377f8a04ff27e64aa01519ae42457119fe1a08f8e25f1a17` |

**STOP** – keine APK, keine Extension-ZIP, kein Merge. Warte auf eure Entscheidung zu Abschnitt 8.
