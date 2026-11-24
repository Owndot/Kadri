# S4b-4-Fix – Anfragebeginn beim Rückfüllen (P1) und in der Beobachter-Diagnose (P2)

Stand 23.11.2026.

**Rahmen:**
- Testbranch `test/s4b-dash`, Commit `1494e56` (auf `7030444`). `main` (`cd00ded`) und die P4-Lieferpins sind unverändert.
- Keine Änderung an Codec-Profilen, MSE-Hooks, Berechtigungen oder Bindungsregeln.
- Keine Shadow-DOM-Hooks.
- Keine APK, keine ZIP, keine Installation, kein Merge.

## 1. Befund

**P1 (bestätigt):**
- `src/040 notePlaylist` füllt beim späten Lesen eines MPD die schon beobachteten Abrufe nach: `recentRes.forEach((x) => dashHit(info, x.k, x.t))`.
- Der Anfragebeginn `x.s` fehlte. `dashHit` setzt dann `s = t`, also die Ankunft.
- Folge: Wurden Stücke **vor** der neuen Medien-Epoche angefragt, kamen aber **danach** an, und wurde das MPD erst danach gelesen, dann zählten sie zur neuen Epoche.
- Das führte zu einer falschen Bindung, und `dashOfferOf` meldete ihre Darstellung als gespielt.
- **Realistischer Fall:** eingebettete Fenster, in denen Kadri erst nach den ersten Abrufen startet und das MPD über die Wiederholung von page.js bekommt.

**P2 (bestätigt):**
- `obsNote` speicherte nur `t` (Ankunft).
- Die Diagnose filterte mit `x.s || x.t` und nutzte damit für die Beobachter-Zählung immer die Ankunft; die Bindung nutzte den Anfragebeginn.
- `dashOfferOf`, `src/046` und `src/280` verwendeten je eigene Ausdrücke. Die Hinweise „ältere verworfen / nicht mehr gespeichert“ lasen weiter `t`.

## 2. Gegenprobe am Stand `7030444`

Neuer Test `tests/test_dash_backfill.py`:
- echtes Chromium mit `DOMParser`, Resource Timing und `PerformanceObserver`, ohne Erweiterung;
- **echte Quelltexte:** `src/038`, `039`, `046` ganz; aus `040` `seeUrl`, den Block `urlKey…dashOfferOf` (darin `notePlaylist`, `recentRes`, `dashHit`, `dashSee`, `obsNote`) und den echten Beobachter; aus `060` den Epochenteil und `dashBindingFor`.

**Weg A (echtes Netz):**
1. Lokaler Server; drei zusammenhängende Stücke (Darstellung 1) werden angefragt.
2. 1 s später ein neues Medium (`loadstart`).
3. Die Server-Antworten kommen nach 2,6 s, also nach dem Epochenwechsel.
4. Erst dann wird das MPD gelesen (`notePlaylist`).
5. Danach folgen drei nach Epochenbeginn angefragte Stücke (Darstellung 0).
6. Der echte Beobachter aus `src/040` meldet alle Abrufe.

**Weg B:** dieselbe Abfolge deterministisch über `seeUrl(u, Ankunft, Initiator, Anfragebeginn)`, so wie der Beobachter `seeUrl` aufruft. Dazu kommen die Rückfallfälle für P2.

| Prüfung | `7030444` | neu |
|---|---|---|
| alte Stücke tragen nach dem Rückfüllen ihren Anfragebeginn (vor der Epoche) | FAIL: `s = t` = Ankunft | OK |
| … zählen nicht: keine Bindung, 0 Treffer | **FAIL: `bound` (stueckfolge, 3 Treffer)** | OK (`keine-treffer`) |
| … nicht als gespielte Darstellung (`dashOfferOf`) | **FAIL: `played [1]`** | OK (`[]`) |
| 3 nach Epochenbeginn angefragte Stücke binden | FAIL: 6 Treffer (alte mitgezählt) | OK (bound, 3, Folge 3) |
| gespielte Darstellungen nur der neuen Epoche | **FAIL: `[0, 1]`** | OK (`[0]`) |
| `obsNote` speichert den Anfragebeginn (Weg A) | FAIL: 0 von 8 Einträgen | OK: 8 von 8, alle `s ≤ t` |
| … identisch mit dem Zeitpunkt der Bindung | FAIL | OK |
| Rückfall auf `t`, wo der Anfragebeginn unbekannt ist bzw. unplausibel (nach der Ankunft) liegt; bekannter Beginn gleich in Diagnose und Bindung (4 Prüfungen) | FAIL (gemeinsame Zeitfunktion fehlt; das Verhalten von `seeUrl` ohne Beginn war schon richtig) | OK |
| Quelltext: Rückfüllen mit `x.s`; nirgends mehr `x.s \|\| x.t` | FAIL | OK |
| **gesamt** | **5/23** (`gegenprobe-7030444-test_dash_backfill.log`) | **23/23** (`neu-test_dash_backfill.log`) |

## 3. Fix (3 Produktdateien, +18/−12; mit Test 4 Dateien, +156/−12)

- **`src/040`:**
  - `resAt(x)` = Anfragebeginn, wenn bekannt, sonst **ausdrücklich** die Ankunft `t`. Gilt für Bindung, Angebot und Diagnose.
  - Rückfüllen: `dashHit(info, x.k, x.t, x.s)`.
  - `obsNote(u, it, t, s)` speichert `s` nur, wenn Resource Timing ihn liefert und `s ≤ t`.
  - Der Beobachter berechnet den Anfragebeginn einmal und gibt ihn an `obsNote` und `seeUrl`.
  - `dashOfferOf` zählt gespielte Darstellungen nach `resAt`.
- **`src/046`:** Abgleich nach `resAt`.
- **`src/280`:** DASH-Abgleich, Beobachter-Zählung und die Hinweise „ältere verworfen / nicht mehr gespeichert“ nach `resAt`.
- **Unverändert:**
  - `dashBindDecision` (`src/038`) nutzt weiter `h.s` (von `dashHit` immer gesetzt), sonst `h.t`. Das ist derselbe Zeitpunkt.
  - Die Mitleser für fetch/XHR rufen `seeUrl` **beim Absenden** auf; dort ist `t` bereits der Anfragebeginn.

**Test:** `tests/test_dash_backfill.py` (neu, 23 Prüfungen). CI nimmt ihn über das Muster `tests/test_*.py` in `ci.yml` automatisch auf.

## 4. Regressionen

| Prüfung | Ergebnis |
|---|---|
| neue Regression `test_dash_backfill.py` (P1 + P2) | **23/23** (am Stand `7030444`: 5/23) |
| Node-Checks (27, u. a. dash_epoch 13, dash_bind 29, dash_diag 31, dash_message 60, frame_ui_rid 36, download_diag 102, Vertraulichkeits-Check) | alle grün, FAILS=0 (`endstand/node-checks.txt`) |
| Player-Matrix (alle Szenarien inkl. f1, f1b, f1c, p1, r1, r2, s1, f2, b2, c1/c3 iframe) | **269/269** (`endstand/matrix-voll.log`) |
| Browser-Suiten, alle 30 `tests/test_*.py` (MP4, HLS, DASH, Fenster/iframe, Kanal/Helfer, Sicherheit/Angriff/LAN/DNR, Diagnose) | 29/30 grün (`endstand/suites-alle.log`), u. a. test_mp4 143/143, test_direct_dl 87/87, test_frame_ui 61/61, test_dash_dl 37/37, test_dash_bind 28/28, test_dash_mpd 61/61, test_guard 61/61, test_dnr_scope 15/15, test_attack 8/8 |
| S3h Weiterleitungs-E2E (echter Helfer) | 20/20 |
| S3d DASH-E2E (echter Helfer, Download) | alle bestanden |

**Vorbestehender Fehler, gesondert ausgewiesen – NICHT bestanden:**
- `test_detect.py`: 2 Fehler, identisch an `008e971`, an `7030444` (`gegenprobe-7030444-test_detect.log`) und am neuen Stand.
- Das hier installierte Chromium spielt den HLS-Stream ohne Dateiendung selbst (`src http:` statt hls.js im eigenen Player). Dadurch fehlt auch die erwartete Listenzeile in der Diagnose.
- Das betrifft HLS-Erkennung und Browserversion, nicht DASH oder diesen Fix. Er ist weder angepasst noch ausgenommen. In CI läuft er wie bisher mit.

**Umgebung:** test_dnr_scope braucht wie im S4b-4-Lauf den Verweis auf den installierten Browser (nur im Container, Test unverändert).

## 5. Verbleibende Risiken

- **Antwortzeit statt Anfragebeginn:** Ohne Resource Timing gilt die Ankunft. Das betrifft:
  - Abrufe aus Workern und anderen Fenstern; diese sieht Kadri ohnehin nicht;
  - Browser, die `startTime` nicht liefern.
  
  Dort ist die Regel weniger streng: Ein vor der Epoche angefragtes, danach angekommenes Stück kann mitzählen. Das ist nicht neu, steht jetzt aber ausdrücklich im Code (`resAt`).
- **Puffergrenze:** `recentRes` hält die letzten 800 Abrufe. Was älter ist, kann nicht nachgefüllt werden; das ist sicher (keine Bindung) und wird in der Diagnose genannt.
- **Weiter offen aus S4b-4 (unverändert):**
  - Shadow-DOM/Firefox nur ab Beobachtung;
  - Werbung und Hauptinhalt in derselben MediaSource;
  - alter Lader lädt weiter (Konkurrenz);
  - Android ungeprüft.

## 6. Dateien

- `S4B-4-FIX-BERICHT.md` – dieser Bericht
- `kadri-s4b4-fix.patch` – der Commit
- `gegenprobe-7030444-test_dash_backfill.log`, `neu-test_dash_backfill.log`, `gegenprobe-7030444-test_detect.log`
- `endstand/` – Node-Checks, Matrix, alle Suiten, S3h, S3d
- `SHA256SUMS`

**STOP vor S4b-5.**
