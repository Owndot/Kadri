# S4b-1/2 – DASH-Ebenen E1–E5, verständliche Meldungen, anonymer Langdruck, S4b-3-Randfälle

Stand 23.11.2026.

**Rahmen:**
- Testbranch `test/s4b-dash`, Commit ``008e971`` (auf `6a1e184`). `main` (`cd00ded`) und die P4-Lieferpins sind unverändert.
- Keine APK, keine ZIP, keine Installation, keine Beta.
- Keine Lockerung von Bindung, Codec-Prüfung oder Helfer-Sicherheit. Keine websitespezifischen Regeln.

## 1. Ergebnis

| Auftrag | Umsetzung | Nachweis |
|---|---|---|
| 1. Fünf getrennte Ebenen | neues `src/046-dash-ebenen.js`: reine Entscheidung `dashLevels` + Sammler `dashLevelsFor` | Node: dash-message 60/60; Matrix: Ebenen-Code je Szenario hart geprüft |
| 2. Feste Codes, erste blockierende Ebene = Hauptmeldung | Codes je Ebene (§2); Diagnose-Zeile `DASH-Ebenen: E1 … · E5 … · erste blockierende Ebene …`; weitere Hindernisse bleiben in der Zeile sichtbar | z. B. „E2/query“ mit gleichzeitig E3 `format` (Unit-Test) |
| 3. Irreführende Meldungen korrigiert | „derzeit nicht unterstützt“ entfällt ganz. Siehe Tabelle unten. | Matrix: kein Menü mit „derzeit nicht unterstützt“ (alle Szenarien) |
| 4. Eine Entscheidungsfunktion | Webseiten-Knopf (`src/105`), Player-Menü (`src/180`) und Diagnose (`src/280`) rufen `dashLevelsFor` | Matrix: „Hinweis im Menü“ der Diagnose = Menütext (hart); test_dash_msg prüft Menü und eigenen Player mit denselben Texten |
| 5. Langdruck auf ▶ | kopiert immer die anonymisierte Diagnose; vollständig nur über den ausdrücklich benannten Knopf „Vollständige Diagnose kopieren (mit Adressen)“ | Matrix a1/c2: Langdruck anonym, ohne Adresse/Token |
| 6. Schließen während der Planung | **Warteblatt** (siehe unten) | c1w (iframe), a2w (Hauptfenster), Unit-Tests |
| 7. Veraltete Hinweise | Relay-Hinweise tragen die Ablauf-Kennung. Oben gilt nur ein Hinweis des **letzten**, nicht abgebrochenen Tipps; ein Ergebnis-Hinweis schließt dessen Warteblatt. | c1t: später Fehler-Hinweis des älteren Tipps abgelehnt |
| 8. Planung über 45 s, echte Zeit | c1x: Helfer-Abruf des MPD 50 s verzögert | Siehe unten |

Korrigierte Meldungen (Auftrag 3):

| Fall | neue Meldung |
|---|---|
| fehlende Bindung | „DASH-Stream erkannt – Zuordnung zum Video nicht nachgewiesen“ + konkreter Grund |
| VP9/Opus/WebM | „Format wird noch nicht gespeichert“ · „Video VP9 · Ton Opus · WebM – gespeichert wird bisher nur H.264 mit AAC-LC (MP4)“ |
| HE-AAC | eigene Meldung |
| Worker/srcdoc | E1 „Manifest nicht lesbar – Seite lädt den Stream verdeckt“ (kein Codecfehler) |
| Byte-Bereiche | „Zuordnung hier nicht möglich“, ohne Rat zum erneuten Abspielen |
| DRM, Live, Mehrperioden | getrennte Codes und Texte |

Warteblatt (Auftrag 6):
- Nach einem Eintrag mit Folge-Auswahl bleibt das Blatt mit „Helfer-App prüft …“ offen.
- Bewusst schließen (Schließen, Hintergrund, Escape, Zurück) bricht den Ablauf ab: Die Kennung wird ungültig, die späte Antwort wird oben und im Fenster verworfen.
- Es folgt keine neue Helfer-Anfrage und kein Start.

Planung über 45 s (Auftrag 8, c1x):
- Der Kanal bricht nach 25 s kontrolliert ab („Helfer-App antwortet nicht“).
- Das Warteblatt schließt sich.
- Es erscheint keine Auswahl, weder oben noch im Fenster, und kein Download startet.
- Kommt eine Antwort erst nach 45 s, gilt sie als veraltet (`zu-spaet`) statt als lokales Blatt im Fenster (Unit-Test).
- Das Warteblatt hat zusätzlich eine eigene 45-s-Frist.

## 2. Ebenen und Codes (`src/046`)

| Ebene | ok | blockierende Codes |
|---|---|---|
| E1 Manifest | `read` | `unread`, `unread-invisible` (MSE läuft, aber kein Medienabruf sichtbar: Worker/srcdoc), `invalid`, `gone` |
| E2 Bindung | `bound` | `host`, `query`, `number`, `invisible`, `none`, `few`, `stale`, `multi-video`, `competing`, `duration`, `uncheckable`, `changed` |
| E3 Format | `ok` | `format`, `audio-codec`, `audio-he-aac`, `live`, `protected`, `multiperiod`, `duration-unknown`, `duration-limit`, `no-audio`, `no-video`, `addressing`, `unsupported`, `unchecked` |
| E4 Helfer | `ok` (`unknown` = noch nicht abgefragt, kein Hindernis) | `unpaired`, `rejected`, `unreachable`, `no-downloads`, `no-dash` |
| E5 Plan/Download | `none`, `planned`, `running`, `done` | `plan-rejected/<grund>`, `failed/<grund>` (nur Diagnose) |

**Formatnamen:**
- Herkunft: Sie stammen aus den Codec-Kürzeln des gelesenen MPD.
- Erlaubte Namen: nur feste Namen (H.264, HEVC, VP9, AV1, AAC-LC, HE-AAC, HE-AAC v2, Opus, AC-3 …). Container ist MP4 oder WebM.
- Kein Seitentext.

**Sicherheit:**
- `src/046` entscheidet nichts. Bindung, Registry, Angebot (`dashOfferFor`) und Abrufe sind unverändert.
- Die unscharfe Diagnose-Stufe dient nur der Wahl des Meldungstextes.
- Beides prüft `dash_diag_check.js` statisch (31/31).

## 3. Gegenprobe am alten Stand (`6a1e184`, neuer Prüfstand)

`gegenprobe-alter-stand-6a1e184.log`: **62 von 95** – jeder Fehlschlag ist ein jetzt behobener Mangel:

| Szenario | alter Stand | neuer Stand |
|---|---|---|
| b1 (Worker) | „Vermutlich DASH-Stream – nicht sicher zugeordnet und **derzeit nicht unterstützt**“ | „DASH vermutet – Manifest nicht lesbar“ · „Die Seite lädt den Stream verdeckt …“ (E1/unread-invisible) |
| d4 (Query-Token) | dasselbe „derzeit nicht unterstützt“ | „… Zuordnung zum Video nicht nachgewiesen“ · „Stück-Adressen tragen Zusatzparameter …“ (E2/query) |
| e1 (Byte-Bereiche) | „Quelle nicht sicher … – **Video kurz abspielen** und erneut tippen“ | „DASH-Stream erkannt – Zuordnung hier nicht möglich“ · „Stream-Form (Byte-Bereiche einer Datei) erlaubt keinen sicheren Nachweis“ |
| h1 (VP9/Opus/WebM) | Menü „derzeit nicht unterstützt · Format nicht unterstützt (nur H.264 mit AAC)“, **Diagnose dagegen „… speichert kein DASH“** (zwei Wahrheiten) | Menü und Diagnose: „Format wird noch nicht gespeichert“ · „Video VP9 · Ton Opus · WebM – …“ (E3/format) |
| h3 (HE-AAC) | „derzeit nicht unterstützt · Tonformat nicht unterstützt (nur AAC-LC)“, Diagnose abweichend | „Tonformat HE-AAC wird noch nicht gespeichert“ (E3/audio-he-aac), Diagnose gleich |
| c2 (srcdoc) | Menü ohne Text, Diagnose „… derzeit nicht unterstützt“ | E1/unread-invisible, gleiche Meldung in Menü und Diagnose |
| a1, c2 Langdruck | **vollständige Diagnose mit Adressen** | anonymisierte Diagnose |
| c1w, a2w Schließen während der Planung | Blatt ging sofort zu; die späte Planantwort **öffnete die Qualitätsauswahl erneut** | Warteblatt; nach bewusstem Schließen bleibt alles zu, Antwort verworfen |
| c1t später Fehler | veralteter Hinweis „Datei nicht gefunden“ **überdeckte die neuere Auswahl** | oben abgelehnt (`top:toast-abgelehnt(veraltet)`), nie sichtbar |
| c1x > 45 s | ebenfalls kontrolliert (nur die Ebenen-Zeile fehlte) | kontrolliert + Ebenen-Zeile |

## 4. Testergebnisse (Endstand)

| Prüfung | Ergebnis |
|---|---|
| Matrix, 31 Szenarien, mit Ebenen-, Meldungs-, Funktions- und Sicherheitsassertions (`endstand/matrix-voll.log`) | **245/245** |
| … darin c1w/a2w (Schließen), c1t (veralteter Hinweis), c1x (über 45 s), Langdruck a1/c2, Menü = Diagnose | alle bestanden |
| … c1, c3, a5, d3, e2 weiterhin mit vollständigem Download, genau ein Auftrag trotz Doppeltipp | bestanden |
| 20 Suites MP4, HLS, DASH, Kanal/Helfer, Frame-UI, Download-Blatt, Sicherheit (`endstand/suites.log`) | alle bestanden (test_mp4 141/141, test_direct_dl 87/87, test_dl_sheet 41/41, test_frame_ui 61/61, test_dash_dl 37/37, test_dash_bind 28/28, test_dash_msg 23/23, test_guard 61/61, test_attack 8/8 …) |
| S3h-Umleitung / S3d-Seite Ende zu Ende | 20/20 / alle bestanden |
| 26 Node-Checks aus `ci.yml` (`endstand/node-checks.txt`) | 0 Fehler (u. a. dash-message 60/60, frame-ui-rid 36/36, dash_diag 31/31, download_diag 102/102) |
| Gegenprobe alter Stand `6a1e184` | 62/95 – alle 33 Fehlschläge sind die behobenen Mängel (§3) |


## 5. Diff (Überblick)

| Datei | Änderung |
|---|---|
| `src/046-dash-ebenen.js` (neu) | `dashCodecName`, `dashRawFormats`, `dashLevels` (rein), `dashLevelsFor` (Sammler), `dashCapsOf`, `dashLevelsLine` |
| `src/040-quellen-netzwerk.js` | `info.dashFmt` (Formatnamen) beim Lesen des MPD |
| `src/105-download-knopf.js` | Siehe Liste unten. |
| `src/180-player-bedienung.js` | Player-Menü: DASH-Hinweis aus `dashLevelsFor` statt der alten Texte |
| `src/280-diagnose.js` | Zeile „DASH-Ebenen“; Registry-Zeile „Download siehe DASH-Ebenen“ statt `stream-not-supported`; Knöpfe: anonymisiert zuerst, vollständig ausdrücklich benannt |
| `src/100-knopf-oberflaeche.js` | Langdruck anonym; Toast mit Ablauf-Kennung und Fortschritts-Kennzeichen; Stil des Warteblatts |
| `src/035-fenster-oberflaeche.js` | Siehe Liste unten. |
| `chrome/background.js` | Relay: `wait` je Eintrag und `prog` je Hinweis (nur Booleans) |
| `src/020-einstellungen-sprache.js` | 57 englische Texte |

Änderungen in `src/105-download-knopf.js`:
- Ablauf-Kennung je Tipp und Warteblatt (Abbruch beim bewussten Schließen, 45-s-Frist).
- Hinweise und Folge-Auswahl nur für den gültigen Ablauf.
- `pageDlReason`/`pageDlReasonSub` aus den Ebenen.

Änderungen in `src/035-fenster-oberflaeche.js`:
- `fuiTopCancel`;
- `fuiTopPick` gibt die Kennung zurück;
- Auswahl nach Abbruch oder Frist gilt als veraltet (kein Blatt im Fenster);
- Hinweise kennungsgebunden;
- Einträge mit `wait`.

**Tests:**
- angepasst:
  - `dash_message_check.js` (neu gefasst, 60);
  - `frame_ui_rid_check.js` (+7: Abbruch, Hinweise, Frist → veraltet);
  - `frame_ui_relay_check.js` (Feld `wait`);
  - `dash_diag_check.js` (Invarianten für `src/046`);
  - `test_dash_msg.py`, `test_dash_bind.py`, `test_dash_dl.py`: erwartete Texte jetzt die konkreten Ebenen-Meldungen; dort zusätzlich „kein ‚derzeit nicht unterstützt‘“ bzw. Ebenen-Code.
- Matrix:
  - neue Szenarien c1w, a2w, c1t, c1x;
  - Ebenen- und Meldungsassertions je Szenario;
  - Gleichheit von Menü und Diagnose;
  - Langdruck.

## 6. Offene Risiken
- **Fenster-Spur bei c1w:** Die Diagnose des iframes ist im Prüfstand nach dem 9-s-Warten nicht zuverlässig abrufbar. Geprüft sind dort: Ablehnung oben (`abgebrochen`), kein Blatt oben und im Fenster, ein MPD-Abruf, kein Download. Das Verwerfen im Fenster selbst belegen c1n und die Unit-Tests.
- **„Verdeckt geladen“ ist ein Indiz.** Der Code `invisible` steht für: MSE läuft, aber seit dem Medienstart kein xhr/fetch/Medien-Abruf im Hauptthread sichtbar. Er ändert nur den Text, nie die Bindung.
- **Warteblatt nur im Seiten-Menü.** Das Player-Menü des eigenen Players (src/180/190) hat seine eigene Menülogik und kein Warteblatt. Die Meldungstexte sind dort gleich (test_dash_msg).
- **45-s-Frist nicht real ausgelöst.** Die eigene 45-s-Frist des Warteblatts wurde in echter Zeit nicht erreicht, weil der Kanal schon nach 25 s abbricht. Die Frist der Antwort-Annahme ist per Unit-Test geprüft.
- **Englisch nur als Tabelle geprüft.** Die englischen Texte sind vorhanden und im Unit-Test geprüft. Eine Oberfläche auf Englisch wurde im Browser nicht durchgeklickt.
- **Kein Android-Test.** Weiterhin nur Desktop-Chromium. Vivaldi/Chromium auf Android ist offen.

## 7. Dateien
- `S4B-1-2-DASH-EBENEN-BERICHT.md` – dieser Bericht
- `kadri-s4b12.patch` – der Commit
- `gegenprobe-alter-stand-6a1e184.log`
- `endstand/` – Matrix, Suites, S3h, S3d, Node-Checks
- `SHA256SUMS`

**STOP vor S4b-4.**
