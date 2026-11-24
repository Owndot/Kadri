# S3d – Kontrollierte DASH-Testseite für das Samsung: Bericht und Anleitung

Stand 22.11.2026.

- Keine neue APK, keine Beta, kein Merge, keine Produktänderung.
- Die Segmentbindung ist unverändert, es gibt keine neue Codec-Freigabe.
- Einziger Push: der isolierte Testbranch `test/s3d-dash-page` in Kadri (`bf9bc06`), nur Testdateien. `main` ist unverändert (`cd00ded`).

## 1. Sind die beiden Ablehnungen erwartet? – Ja, beide sind fail-closed korrekt

| Test | Ablehnungsgrund | Beleg im Code |
|---|---|---|
| 1 – echter Player, VP9/Opus in WebM | **zweifach:** keine Stückbindung (siehe S3e-Bericht) **und** außerhalb des S3-Profils | Kadri-Gate `src/039-dash-fingerprint.js:568` (nur `video/mp4` + avc1/avc3, `audio/mp4` + `mp4a.40.2`); Helfer `DashProfile.java:95` (`container`) |
| 2 – DASH-IF-Referenzplayer, `bbb_30fps.mpd` | **Ton HE-AAC (`mp4a.40.5`)**: S3 speichert nur AAC-LC | Kadri-Gate `src/039:568` → Grund `dash-audio-codec`, Text „Tonformat nicht unterstützt (nur AAC-LC)“ (`src/105:54`); Helfer `Fmp4Inspect.java:182/237` (`codec_mismatch` bei audioObjectType ≠ 2 oder SBR/PS-Signalisierung). CI-Regression: `tests/test_dash_dl.py`, Fall `heaac` |

**Zu Test 2, ergänzend:**

- **Zwei Ebenen.** Die HE-AAC-Ablehnung allein verhindert das Angebot schon. Dass dort außerdem **keine** `dash-segments`-Bindung zustande kam, ist ein **eigener, offener Punkt**. Die Codec-Frage erklärt ihn nicht.
- **Am Menütext erkennbar:**
  - Bei gebundenem MPD zeigt Kadri „DASH-Stream erkannt – derzeit nicht unterstützt“ mit dem Grund in der Unterzeile.
  - Ohne Bindung zeigt es „Vermutlich DASH-Stream – nicht sicher zugeordnet …“.
- **„Länge passt“ ist kein Bindungsbeleg.** Die Angabe sortiert nur Kandidaten (`src/060:457`). Bindungsbeleg ist allein die Stückfolge.
- **Noch nicht untersucht.** Das MPD konnte ich hier nicht laden, der Host ist in dieser Umgebung gesperrt. Wie gewünscht kommt der Punkt erst nach dem unterstützten Ende-zu-Ende-Test.
- **Kleine Unstimmigkeit, ohne Auswirkung:** Das Helfer-Profil `DashProfile` lässt `mp4a.40.5/29` zu, `Fmp4Inspect` lehnt sie danach ab. Das Ergebnis ist einheitlich „nicht speicherbar“. Notiert als Aufräumpunkt, keine Änderung jetzt.

**Wichtig für jeden DASH-Gerätetest: die Helfer-Version.**

- Die installierte `helper-p4test-3` stammt laut Owner-Test-Workflow aus **`e748180`** und enthält **keine DASH-Engine** (kein `dashdl`).
- Die DASH-fähige Testversion ist `helper-p4test-4` (aus `ee54864`, schon geliefert: SHA `945d7ce4…`). Wegen des Signaturkonflikts lässt sie sich nur nach der **noch nicht freigegebenen** Deinstallation der alten App installieren.
- **Mit p4test-3** prüfbar: Bindung „bound“ und der Hinweis im Menü.
- **Erst mit p4test-4** prüfbar: Angebot, `dashplan`, `dashstart` und die MP4.

## 2. Die Testseite

**Adresse (HTTPS, an den Commit festgeschrieben, unveränderlich; gleicher Auslieferungsweg wie die P4-Seite `p4-hls.html`):**

`https://rawcdn.githack.com/Owndot/Kadri/bf9bc06dbe4838801585d8626bb49f38b200f4b9/tests/web/public/s3d-dash.html`

Mit `?q=180` am Ende startet sie mit 180p.

**Inhalt:** genau die in S3c/S3d geprüfte Fixture.
- Erzeugt mit `tests/make_dash_source.sh`, bitexact. Sie ist bit-gleich mit der Helfer-Fixture `tests/java/dashdl/make-dash-fixtures.sh` → `avc/`; hier zweimal neu erzeugt, alle 20 Dateien gleich.
- Statisches VOD, **eine Periode**, 20 s.
- **H.264** Main 320×180 (`avc1.4d400c`) und 640×360 (`avc1.4d401e`) sowie **AAC-LC** (`mp4a.40.2`, 48 kHz stereo), je fMP4.
- SegmentTemplate mit SegmentTimeline und `$Number%05d$`: 5 Video- und 6 Tonstücke à 4 s.
- **Ohne DRM**, ohne BaseURL, ohne Cookies.
- Bildinhalt: Testbild, weißer Blitz und 1-kHz-Piepton alle 2 s.

**Kleiner Player, kein Fremdcode:**
- Er lädt das MPD und die Stücke im **Hauptthread** per `fetch` (ohne Cache), unter **genau den Adressen aus dem MPD**, höchstens 8 s voraus.
- Unter dem Video zeigt er an:
  - je Spur Init und Stücke „in Folge“;
  - die Zeit seit dem letzten Stück;
  - ob MSE H.264 und AAC-LC unterstützt;
  - das **Bindungs-Zeitfenster** (grün „Stückfolge aktuell – jetzt ⬇ antippen (noch N s)“, danach gelb „abgelaufen – Neu starten“).
- Die Knöpfe „Neu starten · 360p/180p“ laden die Stücke neu: neues Medium, neue Stückfolge.

**Lokal geprüft (Desktop-Chromium 153, echte Erweiterung `dist/test` aus 1.12.17, echter Kanal-Helfer aus `3887569` = `ee54864` + nur Testcode, Seite unverändert unter einem githack-artigen Pfad): 12 von 12 bestanden** (`e2e.log`).

| Prüfung | Ergebnis |
|---|---|
| Seite: ≥ 3 Stücke in Folge, MSE H.264/AAC-LC, Wiedergabe, Dauer 20 s | OK |
| Diagnose: `Bindung bound(start-timing,dash-segments)`, `DASH-Stückprüfung … Ergebnis bound (stueckfolge)`, „Stücke exakt 12 · Init exakt 4“ | OK |
| Angebot „DASH-Stream mit Helper herunterladen …“ (Unterzeile „als MP4 · Qualität und Ton wählen · Stücke dieses Streams gerade geladen“) | OK |
| `dashplan`: „360p · Ton: Sprache nicht angegeben“ (läuft gerade · 0:20 · 371 kbit/s · H.264 + AAC) und „180p …“ (136 kbit/s) | OK |
| Der Helfer lud das MPD einmal selbst, ohne Cookie/Authorization | OK |
| `dashstart` → Datei veröffentlicht (824 580 B = Init + 5 Video- + 6 Tonstücke) | OK |
| Nur 360p und Ton geladen, nie 180p, nie Cookie/Authorization | OK |
| Diagnose anonym (keine Adresse, kein Pfad, kein Host) | OK |
| Zeitfenster läuft nach dem letzten Stück sichtbar ab | OK |

Grenze dieser Prüfung: Im Desktop-Harness wird nur verkettet, nicht remuxt. Das echte MP4-Remuxing (Media3) ist in der Helfer-CI auf den Emulatoren API 26/29/34 belegt, bei DASH jeweils `ok`. Auf dem Samsung ist die MP4 daher kleiner/anders als 824 580 B; maßgeblich sind Länge, Auflösung und Wiedergabe.

**Repository-Prüfungen:**
- `tests/s3d_dash_page_check.py` mit Neuerzeugung PASS;
- `tests/p4_device_page_check.py` PASS (P4-Seite unverändert);
- `tests/confidential_names_check.js` PASS.

## 3. Prüfung auf dem Samsung – Schritt für Schritt

**Voraussetzungen:**
- Erweiterung „Kadri P4 TEST“ **1.12.17**, ID `pcccpjllneffccpenbepmfbkjedllkkf`.
- Helfer gekoppelt. Für Schritte 5–7 **`helper-p4test-4` (1.0.4-p4test)**; im Kadri-Popup steht die Helfer-Version.
- Nichts anderes spielt im Tab.

**Schritt 1 – Seite öffnen:**
- Adresse oben öffnen.
- Erwartet unter dem Video:
  - „DASH · 360p + AAC-LC · 20 s“;
  - „MSE H.264 ja · AAC-LC ja“;
  - grün „Stückfolge aktuell (3 Stücke in Folge) – jetzt ⬇ antippen (noch … s)“.
- Steht „NEIN“ oder „Fehler“: STOP und den Wortlaut melden.

**Schritt 2 – Ton einschalten:**
- In der Bedienleiste des Videos den Lautsprecher antippen.
- Kadris Knöpfe am Video erscheinen nur bei hörbarem Video („nur mit Ton“). Die Seite startet stumm, weil sonst kein Autoplay möglich ist.

**Schritt 3 – „bound“ prüfen:**
- Solange es **grün** ist: Kadri-Menü → Diagnose → „Anonymisiert kopieren“.
- Erwartet:
  - `1. dash:manifest · Bindung bound(…dash-segments) …`
  - `DASH-Manifest: VOD · Perioden 1 · AdaptationSets 2 · Darstellungen 3 · Video 2 (avc ×2; mp4; bis 360p) · Audio 1 (aac ×1; …) · Adressierung template-timeline · Schutz angegeben: nein …`
  - `DASH-Stückprüfung 1/1: Treffer ≥ 6 · Darstellungen mit Treffern 2 · längste Folge ≥ 3 · Init-Abrufe ≥ 2 · prüfbare Darstellungen 3 · Ergebnis bound (stueckfolge)`
  - `DASH-Abgleich … Stücke exakt ≥ 6 · … · Init exakt ≥ 2 …`
- **Bekannter Diagnosefehler, nicht beachten:** Die Zeile `Auswahl MP4: - · Auswahl Stream: - · Hinweis im Menü: DASH-Stream erkannt – derzeit nicht unterstützt` erscheint auch dann, wenn das Menü DASH anbietet (siehe Abschnitt 4). Maßgeblich ist das Menü in Schritt 4.

**Schritt 4 – Downloadangebot:**
- Noch im grünen Fenster ⬇ („Video speichern“) am Video antippen.
- Erwartet: **„DASH-Stream mit Helper herunterladen …“**, Unterzeile „als MP4 · Qualität und Ton wählen · Stücke dieses Streams gerade geladen“.
- Mit `helper-p4test-3` stattdessen: „DASH-Stream erkannt – derzeit nicht unterstützt“ und „diese Helfer-App-Version speichert kein DASH“. Das **belegt „bound“**, aber der Helfer kann kein DASH; dann sind Schritte 5–7 nicht möglich.
- Gelb abgelaufen: „Neu starten · 360p“, Ton wieder an, im grünen Fenster erneut tippen.

**Schritt 5 – `dashplan`:**
- Das Angebot antippen. Toast „Helfer-App prüft den Stream …“.
- Erwartet: Blatt **„DASH-Stream speichern“** mit zwei Optionen:
  - „360p · Ton: Sprache nicht angegeben“ (läuft gerade · 0:20 · ~371 kbit/s · H.264 + AAC);
  - „180p · Ton: Sprache nicht angegeben“ (0:20 · ~136 kbit/s).
- Bei Fehler zeigt ein Toast den Grund. In der Diagnose unter „Helfer-Downloads“ steht dann ein Eintrag mit `Aufruf dashplan · Grund …`; bitte den Grund melden.

**Schritt 6 – `dashstart`:**
- „360p …“ antippen. Toast „Helfer-App startet den Download …“, dann „Helfer-App lädt …“.
- In der Helfer-App und in ihrer Benachrichtigung läuft der Auftrag bis „Gespeichert …“.
- Diagnose: `Helfer-Downloads 1. … Aufruf dashstart · Zustand running/done · Bindung bound:…dash-segments`. „Typ hls“ dort ist ein bekannter Anzeigefehler (Abschnitt 4); „Quelle dash/manifest“ ist richtig.

**Schritt 7 – fertige MP4:**
- Ort: `Download/Video-Assistent`, Name nach Seitentitel (z. B. „Kadri_S3d__DASH_speichern_(Testseite).mp4“).
- Erwartet:
  - Länge 0:20, 640×360;
  - Blitz und Piepton **gleichzeitig** alle 2 s, Ton stereo;
  - spulbar;
  - spielt in Galerie bzw. Videoplayer.
- Optional dasselbe mit „180p“: 320×180.
- **Melden:** PASS/FAIL je Schritt, Dateigröße, Länge und Auflösung laut Dateidetails, und die anonymisierte Diagnose aus Schritt 3 und nach Schritt 6.

## 4. Erfasst die anonyme Diagnose die Bindung vollständig? – Ja; drei Anzeigelücken

**Vollständig enthalten**, laut lokaler Diagnose (`diag-local.txt`) und Code (`src/280`):
- Quelle mit Bindungsbeleg (`bound(…dash-segments)`);
- MPD-Zusammenfassung;
- Stückprüfung (Treffer, Darstellungen, längste Folge, Init, Ergebnis mit Grund);
- stufenweiser Abgleich (exakt, Query, Host, Nummer, kein Treffer);
- Beobachter- und Zeitleisten-Zählung (Initiator und Endung);
- Fenster-Ebene.

Im eingebetteten Fenster gilt dasselbe je Fenster: Die Diagnose läuft dort mit („Kadri hier nachgeladen“, Abruf mit langem Druck auf ▶).

**Lücken**, nur Anzeige, keine Auswirkung auf Bindung oder Angebot; nicht jetzt geändert:

- **G1:** Die Auswahlzeile der Diagnose nimmt die DASH-Fähigkeit des Helfers nicht an (`src/280:118`, `caps = { supported, hls }` ohne `dash`). Sie zeigt deshalb „DASH-Stream erkannt – derzeit nicht unterstützt“, auch wenn das Menü DASH anbietet. Außerdem fehlt eine Zeile „Auswahl DASH“ mit Angebotsstatus und **Grund der S3-Vorprüfung** (z. B. `dash-audio-codec` bei Test 2). Diesen Grund sieht man heute nur in der Menü-Unterzeile.
- **G2:** Einträge unter „Helfer-Downloads“ für DASH zeigen „Typ hls“ und HLS-Felder („Planung …, Ressourcen 0/0“), weil `hdlDiagText` DASH nicht kennt (`src/080:284`). Richtig sind dort „Aufruf dashplan/dashstart“, „Quelle dash/manifest“ und „Bindung …“.
- **G3:** Im geöffneten Kadri-Player führt der Abschnitt „Quellen Originalvideo/eigener Player“ nur MP4- und HLS-Auswahl, keine DASH-Auswahl (`src/280:204`).

**Vorschlag:** ein kleiner Diagnose-Fix (G1–G3), nur Anzeige, mit Regression in `test_dash_bind.py`/`test_dash_dl.py`. Gehört erst in die nächste Test-ZIP nach Freigabe.

## 5. Dateien

| Datei | Inhalt |
|---|---|
| `S3D-DASH-TESTSEITE-BERICHT.md` | dieser Bericht |
| `e2e.log` | lokaler Ende-zu-Ende-Lauf, 12 von 12 OK |
| `diag-local.txt` | anonymisierte Diagnose aus dem lokalen Lauf (Referenz für Schritt 3) |
| `kadri-s3d-dash-page-bf9bc06.patch` | der Commit auf `test/s3d-dash-page` |
| `SHA256SUMS` | Prüfsummen dieser Dateien und der Fixture |

## 6. Nächste Entscheidungen

1. **Helfer:** Für Schritte 5–7 muss `helper-p4test-4` installiert sein. Erst dann ist eine Deinstallation von p4test-3 nötig, und die ist bisher **nicht** freigegeben. Ohne Freigabe sind auf dem Gerät nur Schritte 1–4 prüfbar (Bindung „bound“).
2. **Diagnose-Fix G1–G3** für eine spätere Test-ZIP: ja oder nein?
3. Danach mit den realen Seiten weitermachen: zuerst die fehlende Bindung bei Test 2 untersuchen, sobald dafür ein Weg zum MPD freigegeben ist.
