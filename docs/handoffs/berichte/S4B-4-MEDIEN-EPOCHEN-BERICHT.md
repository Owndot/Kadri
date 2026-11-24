# S4b-4 – Medien-Epochen und sichere DASH-Quellenzuordnung

Stand 23.11.2026.

**Rahmen:**
- Testbranch `test/s4b-dash`, Commit `7030444` (auf `008e971`). `main` (`cd00ded`) und die P4-Lieferpins sind unverändert.
- Keine neue Berechtigung, keine MSE-Manipulation, keine Cookie-/Authorization-/DRM-Änderung, keine websitespezifische Regel.
- Keine APK, keine ZIP, keine Installation.

## 0. Vorab: Diagnosefenster anonym
- **`showDiagBox()`:**
  - Beim Öffnen steht jetzt die **anonymisierte** Diagnose im Feld.
  - Die vollständige Fassung (mit Adressen) entsteht erst durch den ausdrücklich benannten Knopf „Vollständige Diagnose kopieren (mit Adressen)“. Vorher steht sie weder im Feld noch sonst im Dokument.
  - Auch der Notbehelf (`prompt`/`alert`, falls das Fenster nicht angezeigt werden kann) zeigt nur die anonyme Fassung.
- **Regressionen:**
  - `test_basic.py` (neu 3 Prüfungen) prüft: beim Öffnen anonym, ohne Adresse; erst nach dem Knopf vollständig.
  - Langdruck auf ▶: Matrix a1/c2 („anonymisiert, ohne Adresse/Token“).
- **Gegenprobe alter Stand:** `test_basic` 5/7 – das Feld zeigte sofort „Kadri 1.12.18 (Basis …)“ mit Adressen.

## 1. Ist-Zustand und Ursache

**Bisher:**
- Ein Abruf zählte für die Bindung, wenn er `t ≥ max(Seitenwechsel, startAt − 3 s)` erfüllte.
- `t` war die **Ankunft** (responseEnd).
- `startAt` war das erste `loadstart`, sonst das erste `play`, sonst der Seitenstart.
- Die Registry (`src/065`) führt dagegen schon eine eigene Medien-Epoche je Element (neu bei `emptied`/`loadstart`). Das Zählfenster der DASH-Stücke (`dashFromOf`) war davon unabhängig.

**Messung** (Testseiten ohne Erweiterung, nur Test-Instrumentierung; `messung.json`):

| Player | `sourceopen` nach `loadstart` | Anfragebeginn jedes Init-/Medienstücks nach dem `loadstart` seines Mediums | Stücke vor dem `loadstart` |
|---|---|---|---|
| eigener Player (fetch) | 8 ms | ≥ 9 ms | 0 |
| dash.js 4.7.4 (XHR) | 8 ms | ≥ 18 ms | 0 |
| Shaka 4.11.7 (fetch) | 5 ms | ≥ 78 ms | 0 |
| dash.js im iframe (c1/c3) | 0–2 ms | ≥ 22 ms | 0 |
| f1/f1b/f2 (zwei MediaSources bzw. zwei Videos) | 0 ms | ≥ 0 ms | 0 |

**Folgerungen:**
- **Das „− 3 s“ braucht keiner der gemessenen Player.** Es stammt aus S2 (Rückgriff auf `play`, wenn `loadstart` verpasst wurde).
- **Genau dieses Fenster verursacht f1b:** Die drei Vorspann-Stücke kamen rund 2,5 s vor dem `loadstart` des Hauptvideos an. Beide MPDs galten deshalb als „aktuell“ (`konkurrenz`), und es gab kein Angebot.
- **Gleicher Mechanismus bei f1c und r1:** Ein vor dem Wechsel angefragter, aber erst danach eintreffender Vorspann-Abruf und ein schneller Wechsel nach 1,2 s scheiterten ebenso.
- **Bisherige Lücke:** Ohne gesehenes `loadstart` (Shadow-DOM, späte Injektion) zählte alles seit dem **Seitenstart**. Die Epoche war damit unbekannt, trotzdem war eine positive Zuordnung möglich.

## 2. Architekturentscheidung

**Medien-Epoche je Videoelement** (`src/060 dashEpochOf`). Ein Stück zählt nur, wenn es **nach dem Beginn der aktuellen Epoche angefragt** wurde. Maßgeblich ist der Anfragebeginn aus der Resource-Timing-`startTime`, nicht das Antwortende.

| Quelle des Beginns | wann | Beginn |
|---|---|---|
| `loadstart` selbst gesehen | Hauptfenster, früh injiziertes Fenster | Zeitpunkt − 500 ms (Ereignis-Aufgabe vs. synchron gestarteter Abruf; gemessen 0–78 ms) |
| `seite-loadstart` | eingebettete Fenster, in denen Kadri erst später startet: `chrome/page.js` (läuft ab Dokumentbeginn) meldet echte Browser-Ereignisse (`isTrusted`) und wiederholt sie, wenn Kadri startet | Zeitpunkt − 500 ms; nur wenn Kadri das `loadstart` nicht selbst sah; Zeit muss plausibel sein (nicht in der Zukunft, nicht vor dem Seitenwechsel) |
| `beobachtet` | `loadstart` nicht sichtbar (Shadow-DOM, Firefox ohne page.js) | Zeitpunkt, ab dem Kadri das Element mit dieser Quelle beobachtet – **ohne Toleranz und ohne Rückgriff auf den Seitenstart** |
| `quellwechsel` | `currentSrc` (neue MediaSource/Blob) ändert sich ohne gesehenes `loadstart` | neuer Beginn |

**Eigenschaften:**
- **Nur strenger:**
  - Die Regel entfernt Treffer, nie fügt sie welche hinzu.
  - Alle anderen Regeln sind unverändert: exakte Adresse, ≥ 3 Stücke in Folge, ≤ 45 s Spanne, ≤ 20 s alt, genau ein Kandidat, „mehrere Videos“, Dauerprüfung, Schutz.
  - Keine Bindung aus Dauer, Zeitnähe, Pfad oder Host.
- **Medienwechsel:**
  - Ein neuer MediaSource-Kontext im Element (`loadstart` bzw. Quellwechsel) macht alle älteren Treffer ungültig.
  - Seeking und normales Nachladen ändern die Epoche nicht; dabei feuert kein `loadstart` und die Quelle bleibt gleich.
- **Android/Chromium:**
  - `loadstart`, `currentSrc` (Blob) und Resource Timing `startTime` sind Standard-Web-APIs und auch dort verfügbar.
  - Kein Hook in `MediaSource`/`SourceBuffer`.
  - `page.js` fügt nur einen passiven Ereignis-Mithörer hinzu.
- **Neue Diagnosezeile:** `DASH-Epoche: <Quelle> vor N s`. Meldung E2/`epoch-late` („Kadri sieht dieses Video erst seit kurzem – einige Sekunden weiterlaufen lassen und erneut tippen“), wenn nur ab Beobachtung gezählt wird und zu wenig zu sehen war.

## 3. Szenarien (Matrix, harte Assertions)

| Szenario | alter Stand `008e971` | neuer Stand |
|---|---|---|
| f1 normaler Vorspann | gebunden an Haupt-MPD (360p + 180p) | **unverändert** gebunden an Haupt-MPD |
| f1b Haupt-MPD 2,5 s nach vorgeladenem Vorspann | `konkurrenz`, kein Angebot | **gebunden an Haupt-MPD** (Optionen 360p + 180p; das Vorspann-MPD hat nur 180p) |
| f1c Vorspann-Antworten 3 s verspätet (vor dem Wechsel angefragt) | `konkurrenz` | **gebunden an Haupt-MPD** |
| r1 schneller Wechsel nach 1,2 s, alter Lader hört auf | `konkurrenz` | **gebunden an Haupt-MPD** |
| r2 schneller Wechsel, alter Lader lädt **weiter** (schlecht aufgeräumt) | `konkurrenz` | **`konkurrenz`** – beide in der aktuellen Epoche angefragt; nie das alte MPD |
| p1 Init + 2 Stücke vor der MediaSource geladen (Vorladen) | gebunden | gebunden (die vorgeladenen Stücke zählen nicht, die folgenden genügen) |
| f2 zwei Videos gleichzeitig | `mehrere-videos` | **unverändert** `mehrere-videos` |
| b2 MSE im Worker | nicht lesbar (E1) | **unverändert** nicht lesbar |
| s1 dash.js in Shadow-DOM | gebunden (nur über den Seitenstart-Rückgriff) | **nicht gebunden** – E2/`epoch-late` (siehe §5) |
| c1/c3 iframe (fremd, verschachtelt) | gebunden | gebunden, Epoche `loadstart`, inkl. vollständigem Download |

**Gegenproben** (`gegenprobe-alter-stand-008e971.log`, `gegenprobe-alter-stand-s1-p1.log`, `gegenprobe-test_basic-alt.log`):
- f1b, f1c, r1 scheitern am alten Stand an den neuen Funktions-Erwartungen (Bindung, Angebot, Plan).
- r2, f2, b2 und c1 verhalten sich gleich.

## 4. Testergebnisse (Endstand)

| Prüfung | Ergebnis |
|---|---|
| Player-Matrix (31 + 5 neue Szenarien: f1c, p1, r1, r2, s1), harte Assertions | **269/269** (`endstand/matrix-voll.log`; S4b-1/2: 245) |
| Node-Checks (27, u. a. dash_epoch 13, dash_bind 29, dash_diag 31, dash_message 60, frame_ui_rid 36, Vertraulichkeits-Check) | **alle grün**, FAILS=0 (`endstand/node-checks.txt`) |
| Browser-Suiten, **alle 29** `tests/test_*.py` (MP4, HLS, DASH, Fenster, Kanal/Helfer, Sicherheit/Angriff/LAN/DNR, Diagnose) | 28/29 grün (`endstand/suites-alle.log`, Nachlauf `endstand/suites-nachlauf.log`): test_mp4 143/143, test_dnr_scope 15/15, test_basic 7/7, test_direct_dl 87/87, test_frame_ui 61/61, test_dash_dl 37/37, test_dash_bind 28/28 … |
| test_detect.py | **2 Fehler, am alten Stand 008e971 identisch** (`gegenprobe-alter-stand-detect-dnr.log`): Das hier installierte Chromium spielt den endungslosen HLS-Stream selbst (`src http:` statt hls.js) – vorbestehend, Umgebung/Browser-Version, nicht S4b-4; nicht angepasst |
| S3h Weiterleitungs-E2E (echter Helfer) | 20/20 |
| S3d DASH-E2E (echter Helfer, Download) | alle bestanden |

**Testanpassungen, die nur die gewollte Produktänderung nachziehen** (kein Fehler wird verdeckt):
- test_mp4, test_streams und test_detect lasen die volle Diagnose direkt nach dem Öffnen. Jetzt öffnen sie die volle Fassung über den ausdrücklichen Knopf.
- test_mp4 prüft zusätzlich, dass das Fenster beim Öffnen anonym ist.
- **Erster Lauf:** test_mp4 und test_streams scheiterten an dieser Annahme; test_detect fehlte im Lauf. Daraufhin wurde die vollständige Liste aller 29 Suiten nachgeholt.
- **test_dnr_scope:**
  - startet ein zweites Chromium ohne Pfadangabe und fand die erwartete Playwright-Browserversion nicht.
  - Im Container wurde nur ein Verweis auf den installierten Browser angelegt; der Test selbst ist unverändert.

**Diff:** 17 Dateien, +289/−32.

## 5. Grenzen (ausdrücklich, statt die Bindung aufzuweichen)

### Shadow-DOM-Player (s1) und Firefox
- **Ursache:**
  - `loadstart` ist nicht `composed`; Kadri sieht es für Videos in Shadow-DOM nicht.
  - In Firefox fehlt `page.js`, damit fehlt dort die Meldung „seite-loadstart“.
- **Neues Verhalten:**
  - Es zählen nur Stücke, die nach dem Beobachtungsbeginn angefragt werden.
  - Bei kurzen oder vollständig vorgepufferten Videos bleibt die Zuordnung aus; die Meldung sagt dann „erst seit kurzem“.
  - Bei längeren Videos, die beim Abspielen nachladen, genügen drei folgende Stücke.
- **Bisher:** Kadri band hier über den Seitenstart-Rückgriff, also ohne bekannte Epoche. Genau das ist nach deiner Vorgabe ausgeschlossen.
- **Möglicher Folgeschritt (nicht umgesetzt, braucht deine Entscheidung):**
  - `page.js` hängt sich passiv in neu angelegte Shadow-Roots ein (Wrapper um `attachShadow`, nur `loadstart`-Mithörer).
  - Das ist ein Prototyp-Eingriff in der Seite wie die vorhandenen fetch/XHR-Mithörer, aber kein MSE-Eingriff.

### Andere Grenzen
- **Werbung in derselben MediaSource:** Werbung und Hauptinhalt laufen dann ohne neues `loadstart` in einer MediaSource. Das ist eine Epoche. Solange beide MPDs aktuell laden: `konkurrenz` (sicher). Ist die Werbung über 20 s vorbei, wird das Haupt-MPD gebunden.
- **Alter Lader im neuen Medium:** Lädt ein alter Lader nach einem Wechsel Stücke eines anderen MPD weiter (r2), entsteht `konkurrenz`. Eine Bindung an das alte MPD wäre nur möglich, wenn das neue Medium gar nicht als DASH beobachtbar ist. Das ist der bekannte Restfall; die Dauerprüfung („dauer-abweicht“) wirkt zusätzlich.
- **Gefälschte `kadri-ls`-Meldung:**
  - Eine Seite könnte eine solche Meldung fälschen, um frühere Abrufe einzubeziehen.
  - Das gibt ihr nichts, was sie nicht ohnehin könnte: Sie steuert ihre eigenen Abrufe.
  - Kadri übernimmt die Meldung nur, wenn es das `loadstart` nicht selbst sah, und nur mit plausibler Zeit.
- **Nur Desktop-Chromium geprüft.** Android/Vivaldi ist offen; dort wird dieselbe Web-API genutzt.

## 6. Diff (Überblick)

| Datei | Änderung |
|---|---|
| `src/060-quellen-zuordnung.js` | Medien-Epoche (`dashEpochNote`, `dashEpochOf`, Mithörer `loadstart`/`kadri-ls`); `dashFromOf` = Epochenbeginn (ohne „− 3 s“, ohne Seitenstart-Rückgriff) |
| `src/040-quellen-netzwerk.js` | Anfragebeginn (`startTime`) je beobachtetem Abruf; Treffer tragen `s` |
| `src/038-dash-manifest.js` | `dashBindDecision` filtert nach Anfragebeginn (ohne Angabe: wie bisher Ankunft) |
| `chrome/page.js` | passiver `loadstart`-Mithörer (nur `isTrusted`), Meldung `kadri-ls`, Wiederholung auf `kadri-ls-hello` |
| `src/110-knopf-am-video.js` | Beobachtungsbeginn aller Videos je Tick |
| `src/046-dash-ebenen.js` | E2-Code `epoch-late` |
| `src/020-einstellungen-sprache.js` | Englisch für `epoch-late` |
| `src/280-diagnose.js` | Zeile „DASH-Epoche“; Diagnosefenster anonym (§0) |

**Tests:**
- neu: `tests/dash_epoch_check.js` (13, CI);
- `dash_bind_check.js` (+4: Anfragebeginn);
- `test_basic.py` (+3: Diagnosefenster);
- Matrix:
  - neue Szenarien f1c, p1, r1, r2, s1 und Messmodus (`S4A_MEASURE`);
  - Erwartung f1b = Bindung an das Haupt-MPD;
  - Shadow-DOM-Suche im Prüfstand;
  - Testplayer: Vorladen, parallel, alter Lader.

## 7. Dateien
- `S4B-4-MEDIEN-EPOCHEN-BERICHT.md` – dieser Bericht
- `kadri-s4b4.patch` – der Commit
- `messung.json` – Zeitpunkte je Player
- `gegenprobe-alter-stand-008e971.log`, `gegenprobe-alter-stand-s1-p1.log`, `gegenprobe-test_basic-alt.log`, `gegenprobe-alter-stand-detect-dnr.log`
- `endstand/` – Matrix, Suites, S3h, S3d, Node-Checks
- `SHA256SUMS`

**STOP vor S4b-5.**
