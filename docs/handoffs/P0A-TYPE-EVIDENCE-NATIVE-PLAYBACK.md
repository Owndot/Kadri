# P0-A · Typbelege und Kadri-veranlasste native Wiedergabe

**Stand zur unabhängigen Prüfung – keine Selbstfreigabe.** Bearbeitet sind die drei gemessenen P0-Umgehungen, die beiden P1 und der P2 aus dem Review [CLAUDE-INDEPENDENT-REVIEW-SOURCE-TYPE.md an `3ecee72`](https://github.com/Owndot/Kadri/blob/3ecee721396e30361b95cfa897ad5c0ff4b34fc6/docs/handoffs/CLAUDE-INDEPENDENT-REVIEW-SOURCE-TYPE.md) (Branch `claude/new-session-7fc7c3`, nicht gemergt). Jede Korrektur hat einen Prüfer, der auf dem Ausgangsstand rot und am Endstand grün ist, mit identischen Prüfdateien auf beiden Ständen. Grundsatz: Eine Dateiendung ist nie ein positiver Beleg. Wo ein Beleg fehlt, gilt fail-closed, und der dokumentierte Funktionsverlust wird in Kauf genommen. Eine Hintergrundprobe ist **nicht** eingebaut (Abschnitt 11). P0-B, P0-C und EssentialProperty wurden nicht begonnen.

## 1. Ausgangsstand und Elternkette

Branch `fix/p0a-type-evidence-hardening`, neu angelegt vom Produktstand `a7ac09d1e1d6ad0e788533af6971aa0e18900271`. Das ist der letzte Produkt- und Testcommit der vorigen Runde, nicht der Berichtscommit `39e002b` und nicht der Review-Branch. Die Kette ist linear, nichts wurde gemergt, und nichts wurde neu geschrieben.

| # | Inhalt | SHA | Parent |
|---|---|---|---|
| Basis | Produkt-/Teststand Runde 3 | `a7ac09d1e1d6ad0e788533af6971aa0e18900271` | `3d0a5dc` |
| 1 | P0 Dateiendung gibt nichts frei | `46fdaaeed12592a7b13f79e8f4be3480f309120e` | `a7ac09d` |
| 2 | P0 Restriktive Belege dauerhaft, Probe-DASH als MPD-Identität | `0f578d12b359603390d858d1b6c74ab678668ef7` | `46fdaae` |
| 3 | P0 Vorschau nur mit Dateibeleg | `2b4a37d692b04f6c34d90a3d1c8ba1981d9fc055` | `0f578d1` |
| 4 | P1 Probe zeitbegrenzt und revisionsgebunden, einheitliche Länge | `00f74f63702bcabd8074829632dd5ae6691ab9a3` | `2b4a37d` |
| 5 | Test: Erweiterung ohne CORS, Überlauf, Probe-Wirkungen | `6011d747dda9d9d027ce09120ece28c6894c45ef` | `00f74f6` |
| 6 | Dieser Bericht | Kopf des Branches | 5 |

Helper unverändert `6e553fcb82b437ce0be487233dd35f41958bade6`.

## 2. Ursachen

1. **P0-1 · `claimed-file` als Freigabe.** Bei HLS unter `.mp4` auf einer fremden Site ohne CORS war Kadris Probe unlesbar. `mediaTypeOf` fiel dann auf `claimed-file` (nur die Endung) zurück, und diese Behauptung reichte für Folgendes: `tryNext` lud per `vid.src` nativ, `hlsNativeStartAllowed` gab Originalstart und Seek frei, `useCapture` und `handBack` starteten das Original. Chromiums nativer HLS-Player holte danach die Varianten ungeprüft.
2. **P0-2 · Verdrängbare Gegenbelege.** `mediaTypeSeen` war ein FIFO mit 1024 Einträgen für alle Typen. 1024 weitere Belege verdrängten einen HLS- oder DASH-Beleg. Ein einziger Master mit 1100 Varianten, den die Seite gelesen hatte, genügte dafür. Treffer im Probecache (256) wurden nicht erneut als Beleg angewandt, und ein per Probe erkanntes MPD wurde keine harte MPD-Identität.
3. **P0-3 · Vorschau mit eigener Logik.** `previewSrc` wählte eine kleinere Alternative schon bei `claimed-file`. `prevLoad`, `pvReload` und der Fehlerweg setzten `pv.src`, ohne den Typ zu prüfen.
4. **P1-A · Timer läuft während der Probe.** `tryNext` setzte `st.loadTimer` (9 s) vor der asynchronen Probe. Der Timer wechselte die Quelle, bevor ein Typ feststand. Die Probe selbst hatte keine Zeitgrenze.
5. **P1-B · Zwei Längenregeln.** Belege und Probe prüften die Eingabe samt Fragment, `admitMediaIdentity` den Schlüssel ohne Fragment. Ein HLS-Beleg unter `url#<langes Fragment>` ging verloren, während ein früherer Dateibeleg derselben Adresse bestehen blieb. Eine Weiterleitung auf eine überlange Master-Endadresse blieb im Masterdatensatz unberücksichtigt.
6. **P2 · Wirkungen der Probe** waren nicht dokumentiert oder gemessen.

## 3. Freigabevertrag (gemeinsame Architektur)

| Signal | Wirkung |
|---|---|
| Dateiendung, Seitenmetadaten, behaupteter MIME, gemeldete Rolle | nie positiv; `claimed-file` gibt nichts frei |
| Gelesener `#EXTM3U`-Text (Kadri oder Seitenmitleser), Content-Type, hls.js-Masteranalyse, eigene Probe `hls` | nur einschränkend → `hls` |
| Gelesenes MPD, Probe `dash`, Content-Type DASH | einschränkend und harte MPD-Identität → `dash` |
| Eigene, lesbare Range-Probe mit ISO-BMFF-/EBML-Kopf | einziger positiver Dateibeleg → `file` |
| Unlesbar, Fehler, Zeitüberschreitung, ausstehend, verdrängt, überlang | `''`/`claimed-file` → fail-closed |

Freigaben (alle über `mediaTypeOf` bzw. `hlsNativeStartAllowed`):

- **Eigener Player (`tryNext`):** `dash` wird übersprungen. `hls` läuft nur über den bewachten hls.js-Loader. Ohne Beleg wird einmal geprüft, danach neu entschieden. `vid.src` setzt Kadri nur bei `file`, sonst folgt die nächste Quelle bzw. Capture/Abbruch.
- **Originalstart, Seek, Stallwächter, Wiederaufnahme (`origSourceAllowed` → `hlsNativeStartAllowed`, `origStartGuard`/`may()`):** `dash` nie. Ohne Masterdatensatz nur `file`. HLS nur mit vollständiger Masterentscheidung (complete, nichts ausstehend/gescheitert/abgelehnt/unvollständig, jede Adresse zulässig). Die Quelle wird bei jeder Abfrage neu entschieden. `handBack` holt bei `claimed-file`/`''` die eigene Probe nach und prüft danach erneut, unmittelbar vor `play()`.
- **Capture:** Ein pausiertes Original ohne positive Entscheidung wird nicht gestartet (Abbruch mit Hinweis). Ein laufendes Original hält Kadri erst an, wenn ein eigener Ladeweg feststeht (`holdOrig`/`commitOwnLoad`).
- **Vorschau (`prevDirectOk`):** zulässige Adresse und `file`, geprüft bei der Auswahl und unmittelbar vor jeder `pv.src`-Zuweisung. HLS-Vorschau nur über die bewachte hls.js-Instanz.
- **Qualität/Quellenwechsel:** HLS-Qualität nur innerhalb der bewachten hls.js-Instanz; Quellenwechsel laufen über `tryNext`.
- **Asynchrone Antworten:** Probe-Ergebnisse gelten nur für denselben Player, dieselbe `sourceRevision`, dieselbe Quelle und den eigenen Modus.

## 4. Änderungen je Commit

1. **`46fdaae` (P0-1).** In `src/170`, `src/125`, `src/250` und `src/260` ist `claimed-file` kein Beleg mehr. `commitOwnLoad` pausiert das Original erst, wenn der eigene Ladeweg feststeht. `handBack` holt die Probe nach, bevor es fortsetzt. `origStartGuard` sperrt Kontextverluste endgültig und entscheidet die Quelle bei jedem Aufruf neu.
2. **`0f578d1` (P0-2).** In `src/040` sind die restriktiven Belege (`restrictiveTypes`) bis 2048 Schlüssel exakt und darüber in einem 8-KiB-Bitfilter abgelegt, mit drei SHA-256-Positionen wie bei den MPD-Identitäten. Ein Filtertreffer gilt als `hls`. Positive Dateibelege (`fileTypes`, 1024) liegen getrennt und weichen jedem restriktiven Beleg. `dash` ruft `rememberMpdIdentity`, `noteDashPlayback` und `noteDashOutput` auf. Ein Probecache-Treffer wendet seinen Befund erneut an.
3. **`2b4a37d` (P0-3).** In `src/230` gilt `prevDirectOk` für die Auswahl, `prevLoad`, den Längenabgleich, `pvReload` (auch verzögert) und den Fehlerweg.
4. **`00f74f6` (P1).** In `src/170` ruht der Ladetimer während der Probe, und die Revisionsbindung gilt. In `src/040` bricht die Probe nach 10 s ab (`PROBE_TIMEOUT_MS`, `AbortController` plus Zeitgrenze, spätes Ergebnis ohne Eintrag). `mediaEvidenceKey` und `restrictiveEvidenceKey` setzen die einheitliche Längenregel um. In `src/125` nutzt `hlsUrlOk` dieselbe Regel, und die weitergeleitete Endadresse gehört zum Masterdatensatz.
5. **`6011d747` (Test).** Drei neue Prüfer kamen hinzu: Erweiterung ohne CORS, Überlauf der restriktiven Belege und Wirkungen der Probe. Die P2-Dokumentation der Probewirkungen steht im Code-Kommentar von `mediaProbe`, eingeführt mit Commit 4.

## 5. Prüfstand

Es gibt zwei echte HTTP/1.1-Server (`tests/nocors_servers.py`), keine Playwright-Routen: die Seite unter `127.0.0.1:18891` und die Medien unter `localhost:18892` als andere Site. Jeder Medienabruf wird serverseitig mit Pfad samt Query, `Range`, `Sec-Fetch-Dest`/`-Mode` und `Origin` protokolliert. `video` zählt als nativer Abruf, `empty` als Kadris Probe bzw. hls.js. Bekannte MPD-Kinder werden ohne Netz klassifiziert; jeder spätere Abruf an sie folgt also einer Kadri-Entscheidung. `play()` und Seeks werden am Original gezählt, `src`-Zuweisungen am eigenen Element (`.vv`) und am Vorschauelement (`.vpv`). Browser: Chrome for Testing 158.0.8127.36 unter Xvfb.

## 6. Rot/Grün

| Prüfer | `a7ac09d` | Zwischenstand | Endstand |
|---|---:|---:|---:|
| `test_p0a_nocors_type.py` (P0-1) | **5/16** | – | `46fdaae` 16/16 |
| `test_p0a_type_eviction.py` (P0-2) | **4/13** | `46fdaae` **5/13** | `0f578d1` 13/13 |
| `test_p0a_type_overflow.py` (P0-2, Grenze 2048) | **2/7** | `46fdaae` **3/7** | 7/7 |
| `test_p0a_preview_alternative.py` (P0-3) | **2/5** | `0f578d1` **2/5** | `2b4a37d` 5/5 |
| `test_p1_probe_lifecycle.py` (P1-A/B) | **5/14** | `2b4a37d` **11/14** | `00f74f6` 14/14 |
| `test_p2_probe_effects.py` (P2) | **4/6** | – | 6/6 |
| `test_p0a_nocors_extension.py` (echte Erweiterung) | Bau `a7ac09d` **1/2** | – | Bau Endstand 2/2 |
| `test_mp4.py` (bestehend, Erweiterung) | Bau `a7ac09d` 143/143 | – | **Abbruch im Anmeldefall (Regression, Abschnitt 13)** |

## 7. Gemessene Zähler (Basis → Endstand)

| Fall | `a7ac09d` | Endstand |
|---|---|---|
| A1 `.mp4`-HLS ohne CORS, Tippen/Schließen | 4 MPD-Kinder geöffnet + 2 nach Schließen, 4 native Masterabrufe, 1 Play, 1 Seek | 0 / 0 / 0 / 0 |
| A6 `?token`, R1/R2/R6 302-Ketten, R5 gleiche Herkunft → fremd | je 6 MPD-Kinder, 1 Play, 1 Seek | 0 |
| Wiederöffnen ohne CORS (zweimal) | 10 MPD-Kinder, 2 eigene `src`, 2 Vorschau-`src`, 1 Play, 2 Seeks | 0 |
| F2 Schließen vor der Masterantwort (3 s) | 2 Plays, 1 Seek | 0 |
| MP4 ohne CORS (Funktionsverlust) | 1 nativer Kadri-Abruf, 1 Play, 1 Seek | 0 |
| Erweiterung: laufendes `.mp4`-HLS ohne CORS | 4 native Masterabrufe nach dem Tipp, `.vv`-src = Master, 1 Seek | 0, kein `src`, 0 Seeks |
| E3 Wiederöffnen nach Verdrängung | 6 MPD-Kinder, 6 native Masterabrufe | 0 / 0 |
| Wiederöffnen nach 6000 Belegen | 6 MPD-Kinder, 6 native Master, 1 Play, 1 Seek | 0 |
| Probe-DASH `.mp4`, Wiederöffnen | 2 native GETs auf das MPD | 0, harte MPD-Identität |
| Probe-DASH als Mastervariante | 1 Abruf (auch auf `46fdaae`) | 0, zulässige Variante dekodiert |
| Vorschau-Alternative `.mp4`-HLS (ohne/mit CORS) | 2 MPD-Kinder | 0, Vorschau aus der laufenden Quelle |
| Probe 9,5 s | eigenes natives `src` vor dem Typentscheid | kein `src`, danach hls.js, dekodiert |
| Probe 15 s | Player bleibt offen, eigenes `src` | nach 10 s beendet, 0 native Abrufe |
| Probe HTTP 500 | 2 native Abrufe, 1 Play | 0 |
| Schließen während der Probe | 1 nativer Abruf, 2 Plays, 1 Seek | 0, keine hls.js-Instanz |
| 503, nach 31 s erneut | Freigabe (`start: true`) | keine Freigabe; 1 GET, nach Ablauf 2 |

## 8. Positive Fälle (dekodiert)

Folgende Fälle dekodieren: MP4 mit CORS (`.mp4` und endungslos) per eigenem Dateibeleg mit Rückgabe, 1 Play; der erlaubte endungslose Master mit CORS über hls.js mit manuellem und automatischem Qualitätswechsel und Rückgabe; die belegte kleinere Vorschau-Alternative; die HLS-Vorschau über hls.js; eine unabhängige MP4 nach gesperrter Quelle und nach Überlauf; die langsame gültige Probe (9,5 s) über hls.js; der verzögerte Redirect auf einen lesbaren Master; eine kurze Adresse mit Weiterleitung auf eine überlange Master-Endadresse über hls.js (ohne native Rückgabe); die Längen 4095/4096 sowie Schlüssel 4066 mit Fragment 30 (Eingabe 4096) über Probe und hls.js; MP4 mit CORS in der echten Erweiterung.

## 9. Funktionsverluste (bewusst, fail-closed)

1. MP4 auf fremder Site **ohne CORS** (mit oder ohne Endung) spielt der eigene Player nicht mehr. Kadri startet sie nach dem Schließen auch nicht nativ.
2. Ein laufendes fremdherkunftiges Original ohne CORS lässt sich nicht spiegeln, weil Chromium `captureStream` mit `SecurityError` verweigert. Kadri lässt es unberührt weiterlaufen.
3. In der Capture-Vorschau fehlen ohne Dateibeleg die Bilder; es bleibt die Zeitanzeige.
4. Eine Seite, die sehr viele restriktive Belege erzeugt, kann über Filterkollisionen eigene Dateien vorsichtiger machen (nie freischalten).
5. Eingaben über 4096 Zeichen samt Fragment erhalten keine Probe und keine Freigabe, auch wenn der Schlüssel kürzer ist.
6. **Cookie-geschützte MP4 einer anderen Herkunft** (auch derselben Site, z. B. ein anderer Port oder eine Medien-Subdomain) spielt der eigene Player nicht mehr. Die Probe sendet zu anderen Herkunften keine Cookies; ein credentialed CORS-Abruf scheitert zudem an `Access-Control-Allow-Origin: *`. Gemessen in `test_mp4.py` (Abschnitt 13).

## 10. Überlauf-, Verdrängungs-, Probe-, Timer- und Redirect-Kontrollen

- **Restriktive Belege:** Bis 2048 Schlüssel werden sie exakt geführt, darüber im festen Bitfilter. Sie werden nie verdrängt. Geprüft wurden 1023/1024/1025, 2047/2048/2049 und 6000, jeweils der erste, der letzte und ein späterer Beleg, HLS und DASH, sowie ein Master mit 1100 Varianten.
- **Positive Belege:** 1024, getrennt geführt. Ihr Verlust bedeutet „unbelegt“, nie eine Freigabe. Ein späterer HLS-Beleg sticht einen Dateibeleg, auch nach dem Überlauf.
- **Probecache:** 256 Einträge. Bekannte Befunde wirken bei jedem Treffer erneut (geprüft bei 255/256/257). `''` gilt 30 s; danach wird höchstens erneut geprüft, eine Freigabe folgt nie.
- **Timer:** Er ruht während der Probe, die nach 10 s abgebrochen wird. Ein Ergebnis nach dem Schließen, nach einem Quellenwechsel oder nach Ablauf wird verworfen.
- **Länge:** Positive Belege, Probe, Masteraufnahme und Freigabe prüfen einheitlich die vollständige Eingabe ≤ 4096. Restriktive Belege gelten für den Schlüssel ohne Fragment. Überlange Schlüssel sind nie positiv.
- **Redirect:** Probe-Befunde gelten für Ursprung und Endadresse. Die Endadresse eines Masters wird Teil des Datensatzes; ist sie überlang, ist der Datensatz unvollständig.

## 11. Hintergrundprobe – STOP-Vorschlag, nicht umgesetzt

Für den Funktionsverlust 1 wäre eine Probe aus dem Service Worker denkbar (Hostberechtigung, kein CORS). Minimaler Entwurf: Für eine konkrete Adresse sendet der Service Worker genau einen GET mit `Range: bytes=0-4095`, ohne Cookies und ohne Authorization (`credentials: 'omit'`), mit derselben Zeitgrenze, und gibt nur den Typ an das Inhaltsskript zurück. Netzwerkwirkung: Zusätzlich zur Wiedergabe gibt es einen Abruf mit dem Origin der Erweiterung. Einmaladressen wären verbraucht. Der Server sieht eine Anfrage ohne Sitzung. Das erfordert Hostberechtigungen bzw. Änderungen an `chrome/background.js` und ist damit ausdrücklich gesondert freizugeben. Für den Funktionsverlust 6 genügte auch dieser Entwurf nicht: Eine cookie-geschützte Quelle wäre nur mit einer Probe *mit* Cookies lesbar (`credentials: 'include'` im Hintergrund), also mit Weitergabe der Sitzung an einen zusätzlichen Abruf. Das ist eine eigene, gesondert freizugebende Änderung der Cookie-Politik. **Nicht eingebaut.**

## 12. Mutationsproben

Die Mutationen liefen im temporären Worktree auf `00f74f6` und wurden danach verworfen.

| Mutation | Prüfer | Ergebnis |
|---|---|---:|
| M1 `claimed-file` wieder freigegeben (`hlsNativeStartAllowed` + `tryNext`) | nocors_type | **5/16** (erkannt) |
| M2 FIFO-Verdrängung statt Überlauffilter | type_eviction | 13/13 (**nicht erkannt** – Lücke) |
| M2 dieselbe Mutation | type_overflow (neu, schließt die Lücke) | **3/7** (erkannt) |
| M3 Vorschau ohne Dateibeleg-Prüfung | preview_alternative | **2/5** (erkannt) |
| M4 Ladetimer läuft während der Probe | probe_lifecycle | **13/14** (erkannt) |
| M5 Revisionsprüfung entfernt | probe_lifecycle | 14/14 (äquivalent, siehe unten) |
| M6 Längenprüfung nur am Schlüssel | probe_lifecycle | **12/14** (erkannt) |
| M7 Probegrenze 600 s statt 10 s | probe_lifecycle | **13/14** (erkannt) |

M5: `sourceRevision` ändert sich nur in `tryNext`, und jeder `tryNext`-Lauf ändert `st.cur` oder `st.mode`, mit Ausnahme einer Wiederholung derselben Quelle. Diese überspringt `st.probed` aber ohne neue Probe. Die Revisionsprüfung ist daher eine absichtlich redundante Bindung. Mit den vorhandenen Einstiegen ist kein Pfad bekannt, auf dem sie allein entscheidet, und keiner wurde gemessen.

## 13. Regressionen am Endstand

**Chromium-Komponenten am Endstand `6011d74`: 29 Prüfer, 572/572** (Runde 3: 23 Prüfer, 511/511; neu 16 + 13 + 7 + 5 + 14 + 6 = 61).

| Prüfer | Ergebnis |
|---|---|
| Neu: nocors_type / type_eviction / type_overflow / preview_alternative / probe_lifecycle / probe_effects | 16/16, 13/13, 7/7, 5/5, 14/14, 6/6 |
| Capture / Frame-Share / HLS-Guard / Manifestidentität / native Vollständigkeit | 14/14, 20/20, 13/13, 13/13, 30/30 |
| Linkbudget / Playerklassifikation / Redirect-Provenienz / Quellentyp | 12/12, 8/8, 20/20, 26/26 |
| Externe Übergabe / sofortiger Seek / Reparse / Medienplaylist / Stallwächter / Länge | 7/7, 9/9, 9/9, 6/6, 7/7, 9/9 |
| DASH: Fehlzuordnung, MPD, Gate, Fingerabdruck, Backfill, Alternativen, URL-Parameter, unbekannter Start | 10, 61, 122, 30, 23, 12, 32, 18 |

**Node am Endstand: 31/31 Programme** (26 `tests/*_check.js`, dabei `guard_check.js` mit `chrome/background.js` und `ff_net_check.js` mit `firefox/background.js`; fünf Kanalprogramme). DASH-Dispatcher (`dash_unit_check`) 104/104, `dash_message_check` 64/64, Vertraulichkeit PASS (1326 Dateien).

**Erweiterung und Helper:** Ungepackte Testfassung vom Endstand über `write(dir,'chrome',true)` (kein ZIP, kein `dist/`). Desktop-Harness des Helpers wie in Runde 3, gebaut mit unverändertem `tests/java/channel/build.sh` aus `6e553fc`. Chrome for Testing 158.0.8127.36 unter Xvfb, Service Worker vorhanden.

| Prüfer | Basisbau `a7ac09d` | Endstand |
|---|---:|---:|
| `test_p0a_nocors_extension.py` (neu) | **1/2** | 2/2 |
| basic / HLS / frame_ui / direct_dl / dash_bind / helper | Runde 3: 7, 24, 61, 87, 28, 18 | 7/7, 24/24, 61/61, 87/87, 28/28, 18/18 |
| `test_mp4.py` | **143/143** (in dieser Sitzung gemessen) | **Abbruch im Fall „Seite verlangt Anmeldung“ – REGRESSION**, siehe unten |
| `test_dash_msg.py` | Runde 3: 20/23 | 20/23, dieselben drei Fälle (offener Befund, nicht Teil dieses Fixes) |
| `test_dash_dl.py` | Abbruch (SyntaxError im Prüfer) | Abbruch, identischer SyntaxError (offener Befund) |

**Regression `test_mp4.py`.** Fall: MP4 auf `127.0.0.1:8791` (andere Herkunft als die Seite `127.0.0.1:8790`, gleiche Site), nur mit dem Sitzungs-Cookie der Seite abrufbar (sonst 403), `Access-Control-Allow-Origin: *`. Ein Diagnoselauf mit einer Kopie der Datei, in der nur dieser Abschnitt beobachtet statt geprüft wird (nicht gewertet), zeigte serverseitig: nativer Abruf der Seite *mit* Cookie, Kadris Probe `bytes=0-4095` *ohne* Cookie (`credentials: 'same-origin'`), Antwort 403, also kein Dateibeleg. Seit P0-1 (`46fdaae`) gibt die Endung nichts mehr frei, und der eigene Player startet nicht (`open_player` wartet 25 s vergeblich). Damit fehlen die sechs Prüfungen dieses Abschnitts. Alle übrigen Fälle der Datei bestehen in der Kopie (137/137). Die Testdatei wurde nicht verändert, und keine Assertion wurde abgeschwächt. Das ist der Funktionsverlust 6 (Abschnitt 9) und eine **offene Entscheidung der unabhängigen Prüfung** (Abschnitt 15).

## 14. Unveränderte Grenzen

`git diff a7ac09d..HEAD` ist leer für `chrome/` (einschließlich `background.js` und Manifest), `firefox/`, `channel/`, `vendor/` (einschließlich `hls.min.js`), `tools/`, `.github/` und `package.json`. Geändert sind nur `src/040`, `125`, `170`, `230`, `250` und `260`, dazu Tests und dieser Bericht. Berechtigungen, Signierung, Releaseworkflows, P4-, Java/Rust- und Harness-Pins sowie die Produktionskonfiguration sind unverändert. `dashplan`/`dashstart` bleiben gesperrt, die A2-Diagnosegrenzen gelten weiter. Es gibt keine Hintergrund-Netzwerkprobe, keine globalen fetch-/XHR-Patches (die Probe nutzt das bestehende ungehakte `rawFetch`), keine Weitergabe von Cookies oder Authorization (`credentials: 'same-origin'`) und keine Adressen in Logs. Requests gingen nur an lokale Testserver. Kein Merge, kein Force-Push, keine APK, kein ZIP, keine Beta, kein Release, keine Installation. `tools/sync-src.sh` wurde nicht ausgeführt.

## 15. Risiken und offene Punkte

1. **Probe als zusätzlicher GET:** Jede unbelegte Quelle erhält einmal je Adresse und Dokument einen GET (Cache 256). Dieser kann eine Einmaladresse verbrauchen (gemessen: zweiter Abruf 403). Ignoriert der Server Range, beginnt er die ganze Datei zu senden; das Abbrechen nach 4096 Bytes beendet nur das Lesen und verhindert keine bereits gesendeten Daten. Ein vorübergehender Fehler gilt 30 s, nach einer Verdrängung wird erneut geprüft (gemessen 2 GETs).
2. **Nativer Player nach positiver Masterentscheidung:** Er kann vom Server einen anderen Inhalt erhalten als hls.js (unverändert aus früheren Reviews).
3. **Blob/MSE/`srcObject`:** Hier ist keine Typentscheidung möglich, nur die Kontextbindung.
4. **Firefox-DOM nicht geprüft.** Android-App/Intent, Samsung/Vivaldi, Downloadmanager, Zwischenablage und DASH-E2E (`test_dash_msg.py` 20/23, `test_dash_dl.py` Abbruch vor den Assertions) sind offene Befunde, die auch auf der Basis bestehen, und gelten nicht als bestanden.
5. M5 ist als redundante Bindung nicht durch einen Test erzwungen (Abschnitt 12).
6. **Offene Regression `test_mp4.py` (Fall „Seite verlangt Anmeldung“).** Sie folgt aus der fail-closed-Vorgabe für P0-1. Zu entscheiden ist eine von drei Optionen: (a) Funktionsverlust 6 annehmen und den Prüffall mit ausdrücklicher Freigabe auf eine belegbare Quelle umstellen; (b) eine Probe mit Cookies (Änderung der Cookie-Politik, gesondert freizugeben); (c) die Hintergrundprobe aus Abschnitt 11 mit Cookies. Ohne diese Entscheidung ist die Erweiterungsregression **nicht vollständig grün**.

**Bewertung:** Die drei gemessenen P0-Umgehungen treten am Endstand nicht mehr auf, und die P1-/P2-Punkte sind mit Messungen belegt. Die Erweiterungsregression hat einen offenen, durch P0-1 verursachten Fehlschlag (`test_mp4.py`, Anmeldefall, Risiko 6). Er ist nicht behoben, nicht übersprungen und nicht abgeschwächt. Über GO oder NO-GO entscheidet die unabhängige Prüfung. **Stopp.** P0-B bleibt gesperrt, bis ein ausdrückliches unabhängiges GO vorliegt.
