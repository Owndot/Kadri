# S3d – CI-Korrekturrunde und Samsung-Paketprüfung (Bericht)

Stand: 22.11.2026. Nur isolierte Testbranches gepusht (Kadri `test/s3d-dash`, Helfer `test/s3d-p4-unsigned`).
Kein Merge, kein Release, nichts installiert. **Keine APK und keine ZIP ausgeliefert**: Die Signaturprüfung ist nicht bestanden
(Abschnitt B1). Produktcode in Helfer und Kadri ist unverändert.

---

## Teil A – CI-Korrekturbericht (Entscheidung 1)

### A1. Änderungen (nur Test-/CI-Code, Kadri `test/s3d-dash`)

| Commit | Inhalt |
|---|---|
| `89caf0378799afe4ae439c55715ec5907d35a3b7` | die vier Korrekturen unten |
| `32d0d17` | reiner Diagnoseschritt: nur nach einem Fehlschlag das Ende der fehlgeschlagenen Python-Testlogs ausgeben |

1. **Regressionsnachweis `0cdf202`** – Schutzwirkung unverändert.
   - Problem: Seit `9119cbe` verlangt die Quellprüfung „Tipp öffnet zuerst die Auswahl“, und zwar vor dem Probe-Rennen. Der alte Stand scheiterte deshalb schon vorher.
   - Lösung: Der Vorgänger ist jetzt `0cdf202` plus **genau der eine** `src/180`-Hunk von `9119cbe`. `patch` läuft ohne Fuzz; vorher wird geprüft, dass der Diff genau einen Hunk hat und `9119cbe^ = c302244` ist.
   - Ergebnis: Der Vorgänger scheitert weiter **genau** an „re-probe required after temporary unsuitability during caps“, der aktuelle Stand besteht.
2. **Gegenstelle der Desktop-Kanaltests** wird aus dem DASH-Harness-Pin `3887569` gebaut. CI prüft, dass der ausgecheckte Stand genau dieser Pin ist und dass er sich vom WASM-Pin unterscheidet. Der **WASM-Neubau bleibt bei `bd5ab29`** und ist weiter byte-identisch.
3. **`channel_mutation_check.js`**: vier Anker an den aktuellen Code angepasst, Mutanten-Semantik unverändert.
   - `dlstart`: Schlüsselliste mit `ref`/`ua` (seit `c302244`)
   - `hlsplan`: Schlüsselliste mit `ref`/`ua`
   - `IDEMPOTENT_OPS` mit `dashplan` (S3c)
   - Wiederholungsaufruf `send(j, p.url, p.ctx)`
4. **`test_mp4.py`, die 7 Fehler auf der Basis – Klassifizierung:** Alle 7 sind veraltete Erwartungen seit `b40e3f5`.
   - Was sich geändert hat: Der Browser-Vergleich ist bewusst von einem Range-Abruf („Browser ohne Cookies/Referer: HTTP 206“) auf drei GET-Varianten A/B/C umgestellt. `download_diag_check.js` wurde damals angepasst, `test_mp4.py` nicht.
   - Neue Prüfungen, strenger als vorher:
     - Diagnose enthält „A … HTTP 200 · B … HTTP 200 · C … nicht ausgeführt (nicht bestätigt)“;
     - genau zwei Vergleichsabrufe;
     - nie Cookie, Authorization oder Range;
     - A ohne Referer;
     - ein Referer höchstens die Seite.
   - Der Testserver liefert bei `anon404` für Vergleichsabrufe ohne Sitzung entsprechend 404.

### A2. Echte Altfehler (fester Befund, mit Gegenprobe; nicht behoben, Produktcode)

**S3D-REF-PRIV** (Kadri, seit `b40e3f5`/`c302244`):
- Bei **privaten Zielen** (LAN, 127.0.0.1) setzt Kadris Hintergrund eine DNR-Freigaberegel (`allow`, Priorität 20). Sie verdrängt die Referer-Regel (`modifyHeaders`, Priorität 1).
- Folge: Vergleichsvariante B kommt ohne Referer an, obwohl die Diagnose „B mit Referer“ meldet.
- Beleg: Der Server hat beide Abrufe ohne Referer protokolliert.
- Öffentliche Ziele sind nicht betroffen, weil es dort keine Freigaberegel gibt.
- Im Test als eigene Prüfung festgehalten: „Befund S3D-REF-PRIV festgehalten“. Sie wird rot, sobald sich das Verhalten ändert.

**S3D-SHEET-BACK-141** (Kadri, seit `a3b6641`/`0330178`, nicht S3c):
- Beobachtung in `test_dl_sheet.py` unter **Chromium 141.0.7390.37** (Playwright 1.56, CI): Das Öffnen des Download-Blatts legt zwar einen Verlaufseintrag an (3 → 4), der aktuelle Index bleibt aber bei 2.
- Folge:
  - Die Zurück-Taste verlässt die Seite (`other.html`), statt nur das Blatt zu schließen.
  - Danach fehlt der ⬇-Knopf, und der Test bricht ab: `TypeError` in `tap_dl`, Zeile 208.
- Gegenprobe:
  - CI 3× rot mit identischem Ablauf: Lauf 45046554143 (Versuch 1 und 2) und Lauf 45049422554 mit Traceback.
  - Lokal mit Chrome for Testing **153.0.8010.12** auf demselben Commit 5/5 grün (35/35).
- S3c hat den Verlaufscode (`src/105`: `pageDlHist`, `pushState`, `popstate`) nicht berührt.
- `test_dl_sheet.py` lief in CI noch nie, weil der Job seit `9119cbe` vorher abbrach.
- **Für den Samsung-Test relevant**, falls der dortige Browser auf Chromium ≤ 141 basiert. Eine Korrektur braucht eine eigene Freigabe (Produktcode).

### A3. CI-Läufe

| Lauf | Ergebnis |
|---|---|
| [Kadri ci.yml 45049422554](https://github.com/Owndot/Kadri/actions/runs/45049422554) @ `32d0d17` (maßgeblich) | build-test, dnr-scope, helper-key-regression, proxy-memory-regression **PASS**; helper-channel: alle Kanalschritte **PASS**, Python-Browserschritt 8/9 (Abschnitt A2); P4-Schritte danach übersprungen |
| [Kadri ci.yml 45046554143](https://github.com/Owndot/Kadri/actions/runs/45046554143) @ `89caf03`, Versuch 1 und 2 | gleiches Ergebnis (Wiederholung bestätigt: kein Wackler) |
| [Kadri dash-e2e 45049419308](https://github.com/Owndot/Kadri/actions/runs/45049419308) / [45046550659](https://github.com/Owndot/Kadri/actions/runs/45046550659) | **PASS** |

**helper-channel in CI im Detail:**
- WASM-Neubau aus `bd5ab29` byte-identisch: PASS.
- Gegenstelle aus `3887569`: PASS.
- Nachweise `7f6d037`, `0cdf202` und `fb66e91` (Popup): PASS.
- Unit- und Kanalprüfungen:

  | Prüfung | Ergebnis |
  |---|---|
  | `download_diag` | 100/100 |
  | `dl-sheet-unit` | 20/20 |
  | `frame-ui-relay` | 28/28 |
  | `frame-ui-result` | 35/35 |
  | `dash-message` | 39/39 |
  | `dash-manifest-model` | 33/33 |
  | `dash-bind` | 25/25 |
  | `channel-unit` | 45/45 |
  | `download_unit` | 143/143 |
  | `download-predecessor` | PASS |
  | `channel-integration` | 74/74 |
  | **`download-integration`** | **44/44** |
  | `hls-unit` | 97/97 |
  | `dash-unit` | 83/83 |
  | P4-Identität | PASS |
  | **`hls-integration`** | **109/109** |
  | `channel-browser` | 34/34 |
  | `netguard` | 4/4 |
  | **Kanal-Mutationen** | **53/53** |

- Python-Browsertests:

  | Test | Ergebnis |
  |---|---|
  | `test_helper` | 18/18 |
  | `test_menu` | 7/7 |
  | **`test_mp4`** | **143/143** |
  | `test_hls` | 24/24 |
  | `test_direct_dl` | 87/87 |
  | `test_frame_ui` | 61/61 |
  | `test_dash_msg` | 23/23 |
  | `test_dash_bind` | 28/28 |
  | `test_dl_sheet` | **Absturz (S3D-SHEET-BACK-141)** |

Nicht in CI erreicht, weil sie nach dem roten Python-Schritt kommen: die P4-Erweiterungsidentität mit zwei Bauwegen und das P4-Lieferpaar. Die Identität ist lokal und in Teil B belegt.

---

## Teil B – APK-/ZIP-Prüfbericht (Entscheidung 3)

### B1. Signaturzertifikat – **NICHT BESTANDEN → STOP**

- `helper-p4test-3.apk` stammt aus dem Owner-Test-Lauf Nr. 3, [44748191232](https://github.com/Owndot/video-assistent-helper/actions/runs/44748191232), mit den Quellen Helfer `e7481808…` und Kadri `c302244d…`.
- Belegt im Lauf-Log:
  - `versionCode=3`;
  - Zertifikat **SHA-256 `1772361b7962daab660c8abfa0e8977b99f2d1f0984bcc056979994f46ca0465`**;
  - `apk_sha256=5f14976b3204271478ca9e767d6cc7bc33785d19063722df53054fe4417a98ed`.
- Dieser Workflow erzeugt den Schlüssel als **Wegwerfschlüssel** (RSA-3072, 2 Tage gültig), signiert genau einmal und **löscht ihn** (`shred`). Der Schritt „throwaway key created, used once via sign.sh, deleted“ war erfolgreich, und er bricht bei übrig gebliebenem Schlüsselmaterial ab.
- Der Workflow selbst vermerkt: „next build = new signer = reinstall“.
- **Ein Update mit identischem Zertifikat ist damit unmöglich.** Auch eine Schlüsselrotation über APK Signature Scheme v3 bräuchte den alten Schlüssel.
- Nach eurer Regel: kein neuer Schlüssel, nicht raten, STOP. Ich habe nichts signiert.

### B2. Bestandene Prüfungen (ohne Schlüssel)

**Helfer-APK, unsigniert und nicht installierbar** – Lauf [45046773401](https://github.com/Owndot/video-assistent-helper/actions/runs/45046773401) (Versuch 2; Versuch 1 scheiterte vor dem Build an Maven Central):

| Prüfung | Ergebnis |
|---|---|
| Reproduzierbarkeit | 2 unabhängige Runner, `ee54864`, versionCode 4: **bitgleich**, unsigniert `09c9fd8dcb9b975ec73eb6ead76587d24604a84dbfd97e4c0242c0ba69f56534` |
| CI-Testcommit `c485bb5` | in allen 24 Einträgen außerhalb `META-INF` identisch mit `ee54864` (dort steht nur der Quell-Commit) |
| Paketkennung | `de.evp.helfer.p4test`, gleich der Referenz `e748180` (versionCode 3); neu versionCode 4, `versionName 1.0.1-p4test` |
| Berechtigungen | **identisch** mit der Referenz, 12 Stück, keine neue, keine eigene: `ACCESS_NETWORK_STATE`, `FOREGROUND_SERVICE`, `FOREGROUND_SERVICE_SPECIAL_USE`, `INTERNET`, `POST_NOTIFICATIONS`, `READ_EXTERNAL_STORAGE` (max 28), `RECEIVE_BOOT_COMPLETED`, `REQUEST_IGNORE_BATTERY_OPTIMIZATIONS`, `SYSTEM_ALERT_WINDOW`, `WAKE_LOCK`, `WRITE_EXTERNAL_STORAGE` (max 28), `WRITE_SETTINGS` |
| Manifest-Diff | leer bis auf `versionCode`/`versionName`; Label `P4 TEST Helfer`, targetSdk 34, minSdk 26, ABIs `arm64-v8a`/`x86_64` gleich |
| Quell-Diff `e748180..ee54864` | Manifest, Gradle, Abhängigkeiten, ProGuard, `release/`, `tools/p4test`, Ressourcen und Rust-Kern unverändert; nur DASH-Java-Klassen und Tests neu |
| Kopplung/Daten | `ChannelServer`/`HelferService` nur um DASH erweitert; Kopplung, Schlüssel und Persistenz unberührt; DASH legt einen eigenen Auftragsordner an |

**Kadri-ZIP „Kadri P4 TEST“:**

| Prüfung | Ergebnis |
|---|---|
| Referenzweg | Mein Build der installierten Quelle `c302244` ergibt genau die Inhalts-Prüfsumme `b6e00416…acb70` aus Lauf Nr. 3 |
| Reproduzierbarkeit | `09d32fb` (S3c-Fix 1) und CI-Commit `89caf03`, getrennte Arbeitsbäume: **bitgleich**, ZIP `83070e47f148d739fb8135d179e784e068e21f052bdf59272a9a3d24f746f9ef`, Inhalt `499e49a1…eeedd1`, 30 Dateien |
| Erweiterungs-ID | **`pcccpjllneffccpenbepmfbkjedllkkf`** (`pack-extension.py` PASS) |
| Manifest | `manifest.json` **byteidentisch** zur installierten Fassung; Rechte `storage`, `declarativeNetRequestWithHostAccess`, `scripting`, `<all_urls>`; `rules.json` und WASM-Kern byteidentisch |
| Geänderte Dateien | nur 6 Skripte (DASH): `background.js`, `content.js`, `sub.js`, `channel/channel-{downloads,service,session}.js`; Kopplungs- und Speicherschlüssel unverändert |

Hinweis: Die Version bleibt `1.12.16`, identisch zur installierten Fassung. Ob euer Browser eine gleich nummerierte ZIP als Update annimmt, hängt vom Installationsweg ab. Eine Versionserhöhung wäre eine Manifeständerung und braucht Freigabe.

### B3. Nicht ausgeliefert
Keine APK, weil die Signaturprüfung fehlgeschlagen ist. Auch keine ZIP, weil ihr beide Pakete nur bei bestandenen Identitäts- und Signaturprüfungen haben wollt und die ZIP allein ohne passenden Helfer nicht sinnvoll testbar ist. Beide lassen sich jederzeit aus den genannten Commits reproduzieren.

---

## Entscheidungen für euch

1. **Signierweg** (Pflicht vor jedem Gerätetest). Ohne den gelöschten Schlüssel gibt es kein Update ohne einmaliges Deinstallieren.
   - **(Empfehlung) A – dauerhafter Eigentümerschlüssel, lokal auf eurem Rechner** nach `ANLEITUNG-LOKAL-P4.md`: Der Schlüssel bleibt bei euch und kommt nie in CI oder Git.
     - Folge: `de.evp.helfer.p4test` wird **einmal** deinstalliert. Kopplung und App-Daten des Helfers gehen verloren, fertige Downloads in `Download/Video-Assistent` bleiben. Danach einmal neu koppeln.
     - Danach sind alle weiteren Updates ohne Datenverlust möglich.
     - Ich liefere dazu den unsignierten Build (`ee54864`, versionCode 4) bzw. die exakten Befehle, ihr signiert.
   - B – erneut ein Wegwerf-Signierer im Owner-Test-Workflow: Derselbe Datenverlust entsteht jetzt **und bei jedem späteren Update**. Nicht empfohlen.
   - C – parallele Installation unter anderer Paketkennung: verletzt Nachweis 1. Nicht empfohlen.
   - Da Variante A eine Deinstallation erfordert, braucht sie eure ausdrückliche Ausnahme von „keine Deinstallation“.
2. **S3D-SHEET-BACK-141**: vor dem Gerätetest beheben (eigene Freigabe, Produktcode Kadri `src/105`), oder als bekanntes Risiko akzeptieren, wenn der Samsung-Browser neuer als Chromium 141 ist. Die Chromium-Version des Geräte-Browsers wäre hilfreich.
3. **S3D-REF-PRIV**: nur Diagnose bei privaten Zielen. Als bekannt akzeptieren oder später eigene Korrektur?
4. **Kadri-Version `1.12.16`** unverändert lassen oder für das Update erhöhen (Manifeständerung)?

## Prüfpatches (SHA-256)

| Datei | SHA-256 |
|---|---|
| `kadri-s3d-89caf03.patch` | `58945825ffeded3da9edf22798ec9bd3cb24490313275bca59e95de365f86f17` |
| `kadri-s3d-32d0d17.patch` | `7474dbdc3f7cccbfb062425d9a7cc3b1fd6359dd7908c6d66fa197766956c20e` |
| `helper-s3d-8e9cfce.patch` | `d840428e0dcc75f960e9fd3f684379fdf6f3b12ca4d5cd5cdd70130ba7dad4d6` |

**STOP** – keine Installation, keine Auslieferung, kein Merge. Warte auf eure Entscheidung zu Punkt 1 (Signierweg) und 2.
