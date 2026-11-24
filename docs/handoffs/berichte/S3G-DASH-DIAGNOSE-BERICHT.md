# S3g – DASH-Diagnose korrigiert (G1/G2), G3 untersucht, Kadri-Test-ZIP 1.12.18, Paketbericht helper-p4test-4

Stand 22.11.2026. **Interner Test – keine Beta, kein Release, kein Merge, keine Installation, nichts am Samsung.**

| Bereich | Stand |
|---|---|
| Repository | Kadri, nur Testbranch `test/s3g-dash-diag` (`a1b3f63`, Testcode-Nachtrag `9d6f870`) |
| `main` | unverändert (`cd00ded`) |
| Helfer-Repository | nichts geändert |
| P4-Lieferpins | unverändert |
| Bindung, Codec-Prüfung, Angebot | unverändert |

## 1. Ergebnis

| Punkt | Ergebnis |
|---|---|
| **G1** – Diagnose zeigt die tatsächliche Fähigkeit und den Ablehnungsgrund | korrigiert (`8b38bbb`) |
| **G2** – DASH-Aufträge als „Typ dash“ | korrigiert (`8b38bbb`) |
| Status, Abbruch, Journal | geprüft: keine Verhaltensänderung |
| **G3** – fehlende DASH-Auswahl im geöffneten Kadri-Player | **reproduziert: reine Anzeigelücke, kein Funktionsfehler** – das Menü bietet DASH an. Anzeige ergänzt in einem eigenen Commit `8ad03f9` (bei Bedarf einzeln verwerfbar) |
| Regressionen DASH/HLS/MP4/UI | lokal grün, bis auf 2 Altbefunde, die nur in dieser Umgebung auftreten (Abschnitt 5); CI `dash-e2e` grün, CI `ci.yml` siehe Abschnitt 5 |
| Kadri-Test-ZIP **1.12.18** | `kadri-p4test-1.12.18.zip`, reproduzierbar (zwei unabhängige Builds bit-gleich) |
| `helper-p4test-4.apk` | bereits signiert (temporärer Signierer), unabhängig neu geprüft, Bericht in Abschnitt 7 |

## 2. G1 – tatsächlicher Unterstützungsstatus und Ablehnungsgrund

**Ursache:** Die Diagnose nahm die Helfer-Fähigkeiten an (`{ supported, hls }`, nie DASH; `src/280:118`). Deshalb meldete sie „DASH-Stream erkannt – derzeit nicht unterstützt“, auch wenn das Menü DASH anbot. Den Grund der S3-Vorprüfung gab sie nicht aus.

**Korrektur:**
- **Fähigkeiten merken:** `helperDl` (`src/080`) merkt sich die zuletzt gemeldeten Fähigkeiten: nur Wahrheitswerte, fester Fehlercode und Zeit. Die Antwort an den Aufrufer bleibt dasselbe Objekt, keine Entscheidung hängt davon ab.
- **Neue Diagnosezeilen** (`src/280`):
  - `Helfer-Fähigkeiten: MP4 ja · HLS ja · DASH ja|nein · abgefragt vor N s` bzw. `noch nicht abgefragt (⬇ antippen fragt ab)` bzw. `nicht erreichbar (unpaired)`.
  - `Auswahl DASH: Manifest gebunden|nur vermutet (nicht gebunden)|keines gebunden · Kadri-Vorprüfung bestanden|abgelehnt (Code) · Angebot ja|nein|nein (helper-no-dash)|abhängig von der Helfer-Fähigkeit`.
  - `DASH-Stückprüfung … · Vorprüfung bestanden|<Code>`: der Grund der S3-Vorprüfung **jedes gelesenen MPD**, auch eines nicht gebundenen. Bei Test 2 (`bbb_30fps`) erscheint dort `dash-audio-codec`.
- **Hinweis im Menü:** `Hinweis im Menü: …` entspricht jetzt dem Menü, einschließlich der Unterzeile, z. B. „… – Tonformat nicht unterstützt (nur AAC-LC)“. Bei einem Angebot erscheint kein Hinweis.
- **Codes:** `dashOfferFor` (`src/105`) liefert zusätzlich einen festen Code je Grund (`helper-no-dash`, `source-changed`, `manifest-gone`, `manifest-unchecked`, `protected`, `dash-…`). Die Entscheidung selbst ist unverändert.

**Beispiel aus dem echten Lauf (gebunden, angeboten):**
```
Helfer-Fähigkeiten: MP4 ja · HLS ja · DASH ja · abgefragt vor 0 s
Auswahl MP4: - · Auswahl Stream: -
Auswahl DASH: Manifest gebunden · Kadri-Vorprüfung bestanden · Angebot ja
DASH-Stückprüfung 1/1: Treffer 10 · … · Ergebnis bound (stueckfolge) · Vorprüfung bestanden
```

**HE-AAC (gebunden, abgelehnt):**
```
Auswahl MP4: - · Auswahl Stream: - · Hinweis im Menü: DASH-Stream erkannt – derzeit nicht unterstützt – Tonformat nicht unterstützt (nur AAC-LC)
Auswahl DASH: Manifest gebunden · Kadri-Vorprüfung abgelehnt (dash-audio-codec) · Angebot nein
```

## 3. G2 – Typ „dash“; Status, Abbruch und Journal

**Ursache:** `hdlDiagNew` setzte für alles, was als Stream startet, `type = 'hls'` (`src/080:81`). Der Helfer meldet für DASH-Aufträge `kind: "dash"`.

**Korrektur:**
- `type = 'dash'`, wenn `job.kind === 'dash'` oder der Start über `dashplan`/`dashstart` lief.
- Fortschritt `done/of` wird wie bei HLS übernommen; den HLS-Fehlerort `loc` gibt es bei DASH nicht.
- Anzeige: „Planung erfolgreich (gewählte Option)“, bei abgelehntem `dashplan` „Planung abgelehnt“ samt „Phase dashplan“.

**Auswirkungen geprüft:** `d.type` wird nur in vier Diagnose-Funktionen von `src/080` gelesen.

| Thema | Befund |
|---|---|
| **Status** | Die Statusabfrage der Diagnose (`hdlDiagWatch`) fragt unverändert alle 2 s den Helfer nach genau diesem Auftrag. Die Stand-/Abbrechen-Menüs (`pageDl.job`, `st.hdl.job`) hängen nicht von `d.type` ab. Regression: „Statusabfrage … übernimmt den Stand (4/13)“. |
| **Abbruch** | `cancel` hängt nicht vom Typ ab. „cancelled“ bleibt endgültig, auch bei später Statusantwort; danach keine weitere Abfrage (Regression). |
| **Browser-Vergleichsabruf** | Wie bisher **kein** Abruf bei DASH-Fehlern. Vorher wurde er als „HLS ohne Fehlerort“ ausgelassen, jetzt ausdrücklich „nicht durchgeführt (DASH-Ressource unbekannt)“, weil das MPD nie die fehlerhafte Ressource ist (Regression: 0 Abrufe). |
| **Download-Journal** | Liegt im Helfer (`DashEngine`/`HlsJournal`), nicht geändert. Kadris Popup/Hintergrund lesen keinen Typ der Diagnose. |
| **HLS/MP4** | Unverändert, mit eigenen Regressionen. |

## 4. G3 – Reproduktion und Ursache

- **Reproduziert** mit der S3d-Testseite, echter Erweiterung 1.12.17 und echtem Helfer:
  - Das Download-Menü im geöffneten Player zeigt „DASH-Stream mit Helper herunterladen …“. Die Funktion ist korrekt, das deckt auch die bestehende CI-Prüfung „eigener Player: dasselbe Angebot“ ab.
  - Die Diagnose zeigt im Player-Abschnitt nur `Auswahl MP4: - · Stream: -`.
- **Ursache:** Die Auswahlzeile des Player-Abschnitts (`src/280:204`) kannte `selectDashStreams` nicht. Es ist ein reiner Anzeigefehler, kein Funktionsfehler.
- **Minimal ergänzt**, in einem eigenen Commit `8ad03f9`, nur Anzeige:
  - `… · DASH: attemptable ×1` mit der Fähigkeit dieses Players;
  - `Helfer-Downloads unterstützt (HLS ja, DASH ja)`.
- Wenn du G3 lieber unverändert lassen willst, lässt sich dieser Commit ohne Folgen herausnehmen.

## 5. Regressionen

**Node, lokal: alle 17 Prüfungen grün.**
- Bestehende Prüfungen: `download_diag_check` 100/100, `dash_message` 39/39, `dash_manifest_model` 33/33, `dash_bind` 25/25, `dash_diag` 28, `dl_sheet_unit` 20/20, `frame_ui_relay` 28/28, `frame_ui_result` 35/35; außerdem `popup_downloads --mutations`, `download_source --mutations`, `media_registry --mutations`, `helper_route`, `media_fixture`, `referrer`, `header_context`, `confidential_names`.
- **Neu:** `dash_download_diag_check` 19/19. Gegenprobe am alten Stand `bf9bc06`: 10 neue Prüfungen rot. Die Verhaltensprüfungen (Statusabfrage, Abbruch, kein Ersatzabruf, HLS, MP4) sind dort ebenfalls grün, das Verhalten ist also gleich.

**Browser, lokal** (echte Erweiterung 1.12.18, echter Kanal-Helfer `3887569` = `ee54864` + nur Testcode):

| Suite | Ergebnis |
|---|---|
| `test_dash_dl.py` | **37/37**, davon 7 neue S3g-Prüfungen (G1 ok/HE-AAC, G2 dashstart/dashplan abgelehnt, G3 Player) |
| `test_dash_bind` 28, `test_dash_msg` 23, `test_dash_mpd` 61, `test_dash_fp` 29 | ok |
| `test_hls` 24, `test_mp4` 141, `test_direct_dl` 87, `test_helper` 18 | ok |
| `test_dl_sheet` 41, `test_frame_ui` 61, `test_menu` 7, `test_abort` 12, `test_guard` 61, `test_redirect` 25, `test_worker_restart` 8 und alle übrigen | ok |
| `test_detect.py` | 2 Fehler (Stream ohne Endung über hls.js). **Am alten Stand `bf9bc06` identisch**, in der CI (`build-test`) auf altem und neuem Stand grün. Liegt also an dieser Umgebung, nicht an der Änderung. |
| `test_dnr_scope.py` | lokal nicht lauffähig (startet ein eigenes Chromium ohne `KADRI_CHROMIUM`); in der CI (Job `dnr-scope`) grün |

**CI auf dem Testbranch:**
- [`dash-e2e` 45079638395](https://github.com/Owndot/Kadri/actions/runs/45079638395) auf `a1b3f63`: **grün**.
- [`ci.yml` 45079635274](https://github.com/Owndot/Kadri/actions/runs/45079635274) auf `a1b3f63`: `build-test`, `dnr-scope`, `proxy-memory-regression` und `helper-key-regression` **grün**. In `helper-channel` schlug in beiden Versuchen dieselbe Prüfung fehl: `test_dl_sheet` „HLS: Stream-Eintrag im Blatt – []“ (das Blatt öffnete sich nicht).
  - **Derselbe Fehler trat am unveränderten Vorgänger `520c0bf` auf** (Lauf 45055438062, Versuch 1; Versuch 2 grün).
  - Lokal mit 1.12.18 4 von 4 Läufen grün.
  - Der Diff berührt den HLS-Blattpfad nicht.
- [`ci.yml` 45082752660](https://github.com/Owndot/Kadri/actions/runs/45082752660) auf `9d6f870` (nur Testcode: Diagnoseausgabe für diesen Fehlerfall ergänzt, die ZIP bleibt bit-gleich):
  - **alle Browser-Suiten grün**, darunter `test_dl_sheet` 41/41, `test_mp4` 141/141, `test_hls` 24/24, `test_direct_dl` 87/87, `test_frame_ui` 61/61, `test_dash_bind` 28/28, `test_dash_msg` 23/23;
  - Kanal-Integration (`hls-integration` 109/109, `channel-browser` 34/34, 53/53 Mutanten erkannt);
  - P4-Testerweiterungs-Identität und Isolation **grün**.
- **Einziger roter Schritt:** „P4 delivery pair – pins from the delivery workflow“ meldet „Kadri files differ from the delivery source `7978a41`“. Der Schritt prüft, ob der Stand dem gesperrten P4-Lieferpin entspricht. Er schlägt auf jedem Testbranch absichtlich fehl, am Vorgänger `520c0bf` genauso. Die Pins sind unverändert, und das soll so bleiben.
- **Bewertung `test_dl_sheet` (HLS):** ein wechselhafter CI-Befund, den es schon vorher gab. Auf diesem Stand trat er in 2 von 3 Läufen auf, am Vorgänger in 1 von 2, lokal nie.
  - Die Ursache ist noch nicht belegt. Die neue Diagnosezeile „DIAG HLS-Blatt“ meldet beim nächsten Auftreten den Zustand von Knopf und Video.
  - Vermutung, nicht bewiesen: Der schwebende Knopf ist gerade verborgen, etwa weil nach 2 s noch keine Tonbytes dekodiert sind (`webkitAudioDecodedByteCount`).
  - Kein Wiederholungslauf mehr.

## 6. Kadri-Test-ZIP 1.12.18

| | |
|---|---|
| Datei | `kadri-p4test-1.12.18.zip` |
| SHA-256 | `f0221bcd2804d1d75ceba7a550f0069ba7ef97b5d62fe89aa204aa205fac3038` |
| Inhalt (sha256 über die sortierten Zeilen) | `09f9bfe8f86762457ea5a022c6855f7e66d171846df1a6986d087ad9fc1bcc83`, 30 Dateien |
| Quelle | `a1b3f63` (Branch `test/s3g-dash-diag`), sauberer Arbeitsbaum, `node tools/build.js` + `tools/p4test/pack-extension.py` wie in der bisherigen Lieferung |
| Reproduzierbarkeit | zwei getrennte Worktrees → bit-gleiche ZIP |
| Name / ID | „Kadri P4 TEST“ / **`pcccpjllneffccpenbepmfbkjedllkkf`** (unverändert) |
| Rechte | `storage`, `declarativeNetRequestWithHostAccess`, `scripting`; Host `<all_urls>`; kein `update_url`/`externally_connectable` (unverändert) |
| Gegenüber 1.12.17 | Manifest: nur `version`. Dateien: nur `content.js` und `manifest.json` geändert; `rules.json`, WASM, Hintergrund und Popup unverändert |

Die Versionsnummer ist nachvollziehbar: 1.12.17 + Diagnose-Fix = 1.12.18. Die Commits `8b38bbb`, `8ad03f9`, `a1b3f63` und `9d6f870` (nur Test) liegen als Patch bei.

**Kompatibilität mit `helper-p4test-4`:** Das Kanalprotokoll ist unverändert. `dash-e2e` in CI und `test_dash_dl` lokal liefen mit 1.12.18 gegen die echte Helfer-Gegenstelle aus `ee54864`.

## 7. Paketprüfbericht `helper-p4test-4.apk` (bereits signiert, temporärer Testsignierer)

Dieselbe Datei wie in der internen Testlieferung, aus CI-Lauf [45073119390](https://github.com/Owndot/video-assistent-helper/actions/runs/45073119390). Hier ist sie **unabhängig ohne Android-SDK neu geprüft** (`apkcheck.py`, Ergebnis in `apkcheck.json`): Signaturen kryptografisch verifiziert und den Inhalts-Digest selbst nachgerechnet.

| Prüfung | Ergebnis |
|---|---|
| Datei / Größe | `helper-p4test-4.apk`, 1 816 894 Byte |
| **SHA-256** | **`945d7ce4b8c9e68623159db7ac9b3e227633b435031e48546639a777cc27771d`** |
| **Zertifikat (SHA-256)** | **`c74838c23d5cc043fe7704386eeded86c3ab6cde5136e788c1e4d78e8d807efd`** |
| Zertifikat | `CN=Helper P4 TEST ONLY - throwaway`, selbst ausgestellt, RSA-3072, SHA-256, Seriennr. `51890d7460750d90`, gültig 22.11.2026 21:40 – 24.11.2026 21:40 UTC (Android prüft die Gültigkeit bei Installation/Update nicht) |
| Signaturschema | v2 und v3 vorhanden, je **genau ein Signierer**, gleiches Zertifikat; kein v1 (JAR) |
| Kryptografie | Signatur über die signierten Daten (RSA PKCS#1 v1.5, SHA-256) für v2 und v3 **gültig**; öffentlicher Schlüssel = Zertifikatsschlüssel; **Inhalts-Digest (1-MiB-Stücke) selbst berechnet = signierter Digest** |
| Paket | `de.evp.helfer.p4test` (unverändert), versionCode **4**, versionName **1.0.4-p4test**, Bezeichnung „P4 TEST Helfer“ (CI) |
| SDK | minSdk 26, targetSdk 34 |
| Berechtigungen | genau **12**, keine eigene (`permission`) deklariert: ACCESS_NETWORK_STATE, FOREGROUND_SERVICE, FOREGROUND_SERVICE_SPECIAL_USE, INTERNET, POST_NOTIFICATIONS, READ/WRITE_EXTERNAL_STORAGE (max SDK 28), RECEIVE_BOOT_COMPLETED, REQUEST_IGNORE_BATTERY_OPTIMIZATIONS, SYSTEM_ALERT_WINDOW, WAKE_LOCK, WRITE_SETTINGS |
| Anwendung | nicht `debuggable`, nicht `testOnly`, `allowBackup=false`, `dataExtractionRules` und `fullBackupContent` gesetzt, `extractNativeLibs=false`, `usesCleartextTraffic=true` (wie bisher, für den lokalen Kanal) |
| Komponenten | Activity `MainActivity` (exportiert, Startsymbol), Service `HelferService`, Receiver `BootReceiver` (exportiert, Systemstart); kein Provider |
| Native | genau `lib/arm64-v8a/` und `lib/x86_64/libkadri_pairing_poc.so`; 16-KB-Ausrichtung: CI `PREFLIGHT-NATIVE PASS`, lokal `P4-TERMUX-NATIVE PASS` |
| Quelle | `META-INF/version-control-info.textproto`: `ee5486442266f2730893353ac71611809dfd21b1` |
| Inhalt | alle 30 Einträge **identisch** mit der freigegebenen, viermal reproduzierten unsignierten APK `2667665f…` |
| CI-Prüfungen (apksigner/aapt2) | Lauf 45073119390 grün: Paket/Version/Bezeichnung/ABIs/targetSdk, nicht debugfähig/testOnly, 12 Berechtigungen, allowBackup, v2+v3, genau ein Signierer mit DN „throwaway“, Zertifikat ≤ 3 Tage, Quell-Commit |
| Schlüssel | nur im Runner-Temp-Ordner, Passwort aus `openssl rand`, nach einmaligem `sign.sh` mit `shred` gelöscht. Kein Schlüssel und kein Passwort in Log, Artefakt oder Repository. **Nicht wiederverwendbar.** |
| **Signaturkonflikt** | Neu `c74838c2…` ≠ installiert `helper-p4test-3` `1772361b…`. **Kein Update möglich**; eine Installation verlangt die Deinstallation von p4test-3, und die ist **nicht freigegeben**. |

## 8. Dateien

| Datei | SHA-256 |
|---|---|
| `kadri-p4test-1.12.18.zip` | `f0221bcd2804d1d75ceba7a550f0069ba7ef97b5d62fe89aa204aa205fac3038` |
| `helper-p4test-4.apk` | `945d7ce4b8c9e68623159db7ac9b3e227633b435031e48546639a777cc27771d` |
| `apkcheck.json`, `apkcheck.py` | siehe `SHA256SUMS` |
| `kadri-s3g-8b38bbb-9d6f870.patch` | siehe `SHA256SUMS` (Commits 8b38bbb, 8ad03f9, a1b3f63, 9d6f870) |
| Logs: `dash_dl.log`, `run_all.log`, `dash_download_diag.log` | siehe `SHA256SUMS` |

**STOP vor jeder Änderung am Samsung.** Es gibt keine Installation, keine Deinstallation und keine Beta.
