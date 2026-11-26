# P0-A · Vollständige HLS-Masterentscheidung vor nativem Originalstart

**Stand zur unabhängigen Prüfung.** Die vier Befunde aus [CODEX-REVIEW-FALLBACK-FRAME-LIFECYCLE.md](https://github.com/Owndot/Kadri/blob/9a85e65278445dcf4bee0a915ba234819a86c399/docs/handoffs/CODEX-REVIEW-FALLBACK-FRAME-LIFECYCLE.md) (zwei P0, zwei P1) sind mit je einem Produktcommit korrigiert. Neue Invariante: Kadri startet ein pausiertes natives HLS-Original oder verstellt dessen Position nur mit einer **vollständigen, aktuellen, positiven** Masterentscheidung. Unbekannt, ausstehend, gescheitert, unvollständig oder abgelehnt bedeutet „nicht erlaubt“. P0-B, P0-C und EssentialProperty wurden nicht berührt. Automatische DASH-Downloads bleiben gesperrt.

## 1. Commit-Kette

| Commit | SHA | Parent |
|---|---|---|
| Produktbasis (Stallwächter, `fix/p0a-fallback-frame-lifecycle`) | `97ae9b3a7902b341a747fca029fd16fd3eaacfe2` | `2bbdc21` |
| 1 · P0 ausstehende/gescheiterte Masteranalyse | `12dfcd4` | Basis |
| 2 · P0 Überlauf und unvollständige Erfassung | `a21e37d` | 1 |
| 3 · P1 Ablehnung/Unvollständigkeit über erneutes Parsen | `b9fd80b` | 2 |
| 4 · P1 Positionsabgleich vor Original-Seek | `8fde140` | 3 |
| 5 · Test: Audio/Untertitel vor und hinter dem Limit | `93bd99a` | 4 |
| Dieser Bericht | Kopf von `fix/p0a-native-hls-completeness` | 5 |

Reviewgrundlage `9a85e65278445dcf4bee0a915ba234819a86c399` (`audit/p0a-fallback-frame-review`), Vorbericht `b38cd04`. Beide wurden über ihre Commits gelesen, nichts gemergt. Ausgangsbaum sauber; die Basis ist der Produktcommit `97ae9b3`, nicht der Dokumentcommit. Helper unverändert `6e553fcb82b437ce0be487233dd35f41958bade6`. Commit 5 entstand, weil die Mutationsprüfung (Abschnitt 17) zeigte, dass die ursprünglichen Audio-/Untertitelfälle die Spuradresse **vor** den 512 Varianten führten und damit nur die Neubewertung, nicht die Unvollständigkeit an dieser Position prüften.

## 2. Technische Ursachen

1. **Schließen vor der Masterantwort (P0).** Der Variantendatensatz entstand erst bei `MANIFEST_PARSED`. `hlsOrigStartBlocked` wertete einen fehlenden Datensatz als „nicht gesperrt“. Schließen, Masterfehler, Lade-Timeout, Playerersatz oder wiederholtes Öffnen vor dem Parse führten zum nativen Originalstart.
2. **Kappung bei 512 Adressen (P0).** `noteHlsMaster` nahm stillschweigend höchstens 512 Adressen auf, ohne Kennzeichnung. Außerdem erfasste es nur, was hls.js als Level und Spuren offenlegt. hls.js 1.7.3 parst `I-FRAME-STREAM-INF` in `iframeVariants`, außerdem `SESSION-DATA`, `SESSION-KEY`, `DEFINE` und `CONTENT-STEERING`; diese Adressen bzw. dynamischen Pfade fehlten.
3. **Erneutes Parsen (P1).** `noteHlsMaster` ersetzte den Datensatz derselben Hauptliste vollständig, einschließlich `denied`.
4. **Sofortiger Seek (P1).** `handBack` erzeugte die Übergabeentscheidung, setzte aber `o.currentTime = target` vor deren erster Prüfung.

Gemeinsamer Kern: Das Fehlen einer negativen Information wurde als positive Freigabe gelesen.

## 3. Betroffene Dateien und Funktionen

| Datei | Änderung |
|---|---|
| `src/125-player-hls.js` | `guardedHlsLoader(allowed, rejected, onManifest)` mit `load()`-Überschreibung; neu `hlsMasterRec`, `hlsMasterBegin`, `hlsMasterAdd`, `hlsMasterText`, `hlsMasterParsed`, `hlsMasterFailed`, `hlsNativeStartAllowed`; `noteHlsDenial` angepasst. Entfernt: `noteHlsMaster`, `hlsOrigStartBlocked` |
| `src/170-player-laden.js` | `tryNext`: Analyse vor `new Hls`/`loadSource` beginnen, Mastertext weiterreichen, Parse/Fehler je Lauf melden. `useCapture`: `origSourceAllowed` |
| `src/260-player-schliessen.js` | Neu `origSourceAllowed`; `origStartGuard` nutzt sie; `handBack`: Positionsabgleich samt Overlay erst nach `may()` |
| Neue Prüfer | `tests/test_p0a_native_hls_completeness.py` (30), `tests/test_p1_hls_reparse.py` (7), `tests/test_p1_handback_seek.py` (9) |

## 4. Zustandsmodell je Player und exakter Hauptlistenadresse

Schlüssel: `dashUrlKey` (Herkunft, Pfad, Query, ohne Fragment).

| Zustand | Bedeutung | Lebensdauer |
|---|---|---|
| kein Eintrag | Analyse nicht begonnen | – |
| `pending` | Lauf begonnen (vor `loadSource`), Antwort/Parse offen | je Lauf |
| `failed` | Abruf fatal, Text ungültig oder Mastertext nicht erfasst | je Lauf |
| `complete` | Mastertext gelesen und `MANIFEST_PARSED` dieses Laufs | je Lauf |
| `incomplete` | Budget überschritten, `CONTENT-STEERING`, `DEFINE`, `{$…}` oder nicht-http(s)-URI | dauerhaft |
| `denied` | eine Adresse der Hauptliste vom Guard oder beim Parse abgelehnt | dauerhaft |
| „überholt“ | neuer Lauf setzt `run` neu; Rückmeldungen älterer Läufe und inaktiver Instanzen werden ignoriert | – |

**Zentrale Entscheidung** „Darf Kadri dieses Original jetzt starten oder seine Position ändern?“: `origSourceAllowed(st, url, allowed)` = Adresse zulässig (Registry bzw. Playerveto) **und** `hlsNativeStartAllowed(st, url)`. Für eine HLS-Hauptliste (Eintrag vorhanden oder Pfad `.m3u8`/`.m3u`) gilt Freigabe nur bei `complete && !pending && !failed && !denied && !incomplete` und wenn jede erfasste Adresse heute `mediaSourceAllowed` ist. Dokument, Element, Quelle, Medien-Epoche und Übergabe prüft weiterhin `origStartGuard` (über `mediaOutputContext`). Verwendet von `useCapture` (Start des pausierten Originals), `handBack` (Seek), `resume` und `watchStall`.

**Vollständigkeit.** Der Playlist-Loader liest über die dokumentierte Loader-Schnittstelle `load(context, config, callbacks)` den empfangenen Mastertext mit. Erfasst werden jede URI-Zeile und jedes `URI="…"`-Attribut, aufgelöst gegen die Antwortadresse wie bei hls.js, vereinigt mit `level.uri`, `level.url[]` (Aliase), Audio- und Untertitel-URLs. Eine Medienplaylist (`#EXTINF`/`#EXT-X-TARGETDURATION`) verweist auf keine weiteren Playlists; erfasst wird dann nur die Adresse selbst. `complete` setzt den gelesenen Text voraus.

## 5. Regeln bei ausstehender Analyse, Fehler und Überlauf

- Ausstehend, gescheitert, kein Eintrag: kein von Kadri ausgelöster Start, kein Seek. Das pausierte Original bleibt angehalten; der Capture-Rückfall schließt kontrolliert mit Hinweis.
- Späte Antworten nach Schließen oder Ersatz: `activeHls()` ist falsch, der alte Lauf ändert nichts; der Player wird nicht reaktiviert, alte hls.js-Instanzen sind zerstört.
- Überlauf: die 513. eindeutige Adresse wird nicht gespeichert, `incomplete` bleibt. Die eigene hls.js-Wiedergabe läuft weiter (ihre Abrufe schützt der bestehende Playlist-Guard).
- Ein bereits laufendes Original wird nicht durch Kadri gestartet und weiterhin passiv gespiegelt bzw. in Ruhe gelassen.

## 6. Speicherbudget

512 eindeutige Adressen je Hauptliste, 8 Hauptlisten je Playerinstanz. Duplikate verbrauchen nichts. Adressen über 4096 Zeichen sind ohnehin nicht zulässig (`mediaUrlOk`), damit ist der Bestand je Player streng begrenzt (Adresse und Schlüssel, höchstens 4096 Einträge). Übliche Hauptlisten haben weit unter 50 Varianten. Lieber kontrolliert „unvollständig“ als eine unbegrenzte Liste. Keine globale Sperrliste; der Bestand lebt nur an der Playerinstanz.

## 7. Monotonie früherer negativer Entscheidungen

Innerhalb derselben Playerinstanz und Hauptlistenadresse: erfasste Adressen werden nur vereinigt (gemeinsames Budget), `denied` und `incomplete` nie zurückgenommen. `pending`/`failed`/`complete` gelten je Lauf; ein neuer vollständiger Lauf ohne negatives Wissen darf wieder freigeben. Eine andere Query oder ein neuer Player beginnt mit eigenem Eintrag. Die Lösung hängt nicht davon ab, wie oft geparst wird (Prüfer: kürzere, veränderte und überlaufende Listen, Fehler- und Pending-Läufe).

## 8–12. Rot-/Grünnachweise

Identische Prüfdatei auf den Vorgängern (separater sauberer Worktree) und den Korrekturständen; `KADRI_CHROMIUM=/opt/pw-browsers/chromium python3 tests/<Prüfer>.py`.

| Prüfer | Vorgänger | Korrektur | Endstand |
|---|---:|---:|---:|
| Native Vollständigkeit, Teil „pending“ (13) | `97ae9b3` **5/13** | `12dfcd4` 13/13 | 13/13 |
| Native Vollständigkeit, Fassung mit 28 Fällen | `97ae9b3` **12/28**, `12dfcd4` **20/28** | `a21e37d` 28/28 | – |
| Native Vollständigkeit, Endfassung mit 30 Fällen | `97ae9b3` **12/30** | – | `93bd99a` 30/30 |
| Erneutes Parsen | `97ae9b3` **3/7**, `a21e37d` **4/7** | `b9fd80b` 7/7 | 7/7 |
| Sofortiger Seek | `97ae9b3` **4/9**, `b9fd80b` **4/9** | `8fde140` 9/9 | 9/9 |

Alle roten Fälle erreichten die fachlichen Messpunkte. Zwei eigene Prüfstandsfehler wurden während der Entwicklung behoben und vor den hier genannten Läufen korrigiert: eine Schlüsselkollision bei der Variantenbeschriftung (zählte `a/` und `b/` zusammen) und ein Klassifikationshelfer, der für `.mp4` keine MPD-Bytes erhielt.

## 13. Tatsächliche Zähler

**Schließen um die Masterantwort** (Zwei-Varianten-Master, beide Varianten bekannte MPD, Original pausiert, `preload=none`; Zähler ab Schließen):

| Fall | Basis `97ae9b3`: Play / nativer Master / MPD-Variante | Fix |
|---|---|---|
| Vor Masterantwort, Wiederaufnahme an | **1 / 1 / 1** | 0 / 0 / 0, Original pausiert, 0 lebende hls.js-Instanzen |
| … späte Antwort danach | 2 Play, 1 Seek (Stallwächter) | 0, Player bleibt geschlossen |
| Wiederaufnahme aus (Kontrolle) | 0 / 0 / 0 | 0 / 0 / 0 |
| Antwort unmittelbar vor dem Schließen | 1 / 1 / 1 | 0 / 0 / 0 |
| Masterabruf 500 | 1 / 3 / 1, Capture aktiv | 0, kontrolliert geschlossen |
| Lade-Timeout (9 s) | 1 / 2 / 1 | 0 |
| Player während der Analyse ersetzt | 3 Play, 1 Seek | 0 |
| Dreimal Öffnen/Schließen | 1 / 4 / 1 | 0 |
| Bereits laufendes Original | 1 zusätzlicher Play | 0, läuft weiter |

**Budget** (generierte Master mit gleichem abspielbarem Material, unterschiedliche Querys; Zähler ab Schließen: Play / nativer Master / betroffene Adresse):

| Fall | Basis | Fix |
|---|---|---|
| 510, 511, 512 Varianten, letzte als MPD | 0 / 0 / 0 | 0 / 0 / 0 |
| 513 und 514 Varianten, letzte als MPD | **1 / 1 / 1** | 0 / 0 / 0 |
| 513 Varianten ohne MPD | 1 / 1 / 1 | 0 (unvollständig) |
| Audio bzw. Untertitel vor 512 Varianten als MPD | 1 / 1 / 0 | 0 / 0 / 0 |
| Audio bzw. Untertitel als 513. Adresse hinter dem Limit | rot (Start) | 0 / 0 / 0 |
| Alias nach dem Limit als MPD | 1 / 1 / 0 | 0 |
| I-Frame-Playlist als MPD (nicht in hls.js-Leveln) | 1 / 1 / 0 | 0 |
| Content Steering | 1 / 1 / 1 | 0 (nicht vollständig prüfbar) |
| Exakte Query als MPD | 0 | 0 |

**Erneutes Parsen** (Server liefert hls.js die angegebene Liste, dem nativen Player die vollständige):

| Fall | Basis | Commit 2 | Fix |
|---|---|---|---|
| Kürzere Liste, Variante B später MPD | 1 / 1 / 1 | 1 / 1 / 1 | 0 / 0 / 0 |
| Guard-Ablehnung, dann kürzere Liste | 1 / 1 / 1 | 0 | 0 |
| Veränderte Liste | 1 / 1 / 0 | 1 / 1 / 0 | 0 |
| 513 Varianten, dann kurze vollständige Liste | 1 / 1 | 0 | 0 |
| Neuer Lauf nach gescheitertem Lauf (Positiv) | 1 | **0** (zu streng) | 1 |

**Sofortiger Seek** (Seek / Play am Original):

| Fall | Basis | Fix |
|---|---|---|
| MP4 vor dem Schließen als MPD erkannt | **1 / 0** | 0 / 0 |
| Videoende, Adresse MPD | 1 / 0 | 0 / 0 |
| HLS mit gesperrter Variante | 1 / 0 | 0 / 0 |
| HLS-Master unvollständig (513) | 1 / 1 | 0 / 0 |
| Playerersatz bei gesperrter Adresse | 1 / 0 | 0 / 0 |
| Zulässige MP4 / zulässiges HLS | 1 / 1, Position ±0,04 s | 1 / 1, Position ±0,04 s |
| Videoende zulässig | 1 / 0 (kurz vor Ende, angehalten) | unverändert |

## 14. Positive dekodierte Kontrollen

Unabhängige MP4 dekodiert und wird zurückgegeben (1 Start). Ein vollständig geprüfter zulässiger HLS-Master (2 Varianten bzw. 512 Varianten bzw. 700 Einträge mit 300 eindeutigen Adressen) dekodiert und wird nativ zurückgegeben (1 Start, nativer Masterabruf 1). Positionsabgleich für MP4 und HLS korrekt, keine doppelte Wiederaufnahme. Die Rückgabe am Videoende stellt korrekt vor das Ende und lässt angehalten. Ein laufendes Original bleibt laufend; ein Blob-Original wird passiv gespiegelt (`test_p0a_capture_fallback.py`). Neue Medien-Epoche (MP4) während einer ausstehenden Analyse wird neu bewertet und gestartet. Eine andere Query derselben Masterstruktur wird getrennt bewertet. Ein neuer vollständiger Lauf nach ausstehender bzw. gescheiterter Antwort gibt wieder frei. Manueller und automatischer Qualitätswechsel, gesperrte Variante ohne Request und Vorschau: `test_p0a_hls_variant_guard.py` 13/13. Stockende MP4 durch Stallwächter: `test_p1_stall_watch.py` 7/7. Seiten-/Beitragslinks und iframe-Freigabe mit echter Bestätigung: 12/12 und 20/20.

## 15–16. Regressionen und Testumfang

**Chromium-Komponenten am Endstand `93bd99a`: 19 Prüfer, 461/461** (bisher 415/415, neu 30 + 7 + 9).

| Prüfer | Ergebnis |
|---|---|
| Neu: native Vollständigkeit / erneutes Parsen / sofortiger Seek | 30/30, 7/7, 9/9 |
| Capture / iframe-Linkfreigabe / Stallwächter | 14/14, 20/20, 7/7 |
| HLS-Guard / Linkbudget / Manifestidentität / Playerklassifikation / Redirect-Provenienz | 13/13, 12/12, 13/13, 8/8, 20/20 |
| Ursprüngliche DASH-Gegenproben `test_dash_wrong_video.py` | 10/10 |
| DASH Parser, Gate, Fingerabdruck, Backfill, Alternativen, URL-Parameter, unbekannter Start | 61, 122, 30, 23, 12, 32, 18 |

**Node: 31/31 Programme** (26 `tests/*_check.js`, davon `guard_check.js` und `ff_net_check.js` mit ihrem Pfadargument, sowie `channel_unit` 45/45, `dash_unit` 104/104, `download_unit` 143/143, `download_regression`, `hls_unit` 97/97). Darunter Registry 140, Frame-Relay 33/33, Frame-Ergebnis 42/42, Frame-RID 36/36, Download-Diagnose 102/102 und der Vertraulichkeitsprüfer.

**Erweiterungs-Prüfstand mit echtem Service-Worker und echtem Desktop-Harness** (neu gegenüber dem Vorbericht; ungepackte Testfassung über `write(dir,'chrome',true)` ohne ZIP, Harness mit unverändertem `tests/java/channel/build.sh` aus einem separaten Klon von `6e553fc`):

| Prüfer | Endstand | Basis `97ae9b3` |
|---|---|---|
| `test_basic.py` | 7/7 | – |
| `test_mp4.py` | 143/143 | – |
| `test_hls.py` | 24/24 | – |
| `test_frame_ui.py` | 61/61 | – |
| `test_direct_dl.py` | 87/87 | – |
| `test_dash_bind.py` | 28/28 | – |
| `test_helper.py` | 18/18 | – |
| `test_dash_msg.py` | 20/23 | 20/23, dieselben 3 FAIL (zeitnahe Diagnoseanzeige) |
| `test_dash_dl.py` | Abbruch: `SyntaxError` im JavaScript des Prüfers | identischer Abbruch |

Die beiden letzten Ergebnisse sind auf der Basis identisch, also nicht durch diese Änderung verursacht. Sie wurden nicht korrigiert (außerhalb des Auftrags) und sind als offene Prüfstandsbefunde zu behandeln. Der Maven-429-Blocker des Vorberichts trat diesmal nicht auf.

## 17. Mutationstests

Temporärer Worktree, jeweils eine Mutation, danach verworfen; kein Ergebnis zählt in die Summen oben.

| Mutation | Neuer Prüfer | Alter Capture-Prüfer |
|---|---|---|
| M1 · Vollständigkeitsprüfung (`!rec.incomplete`) entfernt | 23/28; mit Endfassung Budgetteil **10/17** (rot: 513, 514, 513 ohne MPD, Audio und Untertitel hinter dem Limit, Alias, Content Steering) | 14/14 |
| M2 · dynamische Neubewertung der erfassten Adressen entfernt | **23/28** (rot: 510, 511, 512, exakte Query, I-Frame) | 14/14 |
| M3 · fehlender/unfertiger Eintrag gilt als erlaubt | **21/28** (rot: alle Pending-, Timeout-, Ersatz- und Wiederholungsfälle) | 14/14 |
| M4 · Adressbestand je Lauf zurückgesetzt (keine Vereinigung) | Reparse **5/7** | – |
| M5 · Seek ohne `may()` | Seek **4/9** | – |

Der alte Capture-Prüfer bemerkt keine der Mutationen M1–M3; die neuen Prüfer schließen diese Lücke.

## 18. Verbleibende Risiken

1. **Dynamischer Master beim nativen Abruf.** Der native Player lädt die Hauptliste selbst erneut. Liefert der Server ihm andere Adressen als hls.js (je Abruf verschieden), sieht Kadri diese nie. Die Vereinigung schützt nur bereits gesehene Adressen. Verhindern ließe sich das nur, indem Kadri natives HLS nie selbst startet.
2. **HLS ohne erkennbare Endung.** Als HLS-Hauptliste gilt eine Adresse mit Eintrag oder mit `.m3u8`/`.m3u`-Pfad. Ein endungsloses natives HLS-Original ohne Kadri-Analyse wird wie bisher nur per Quellenprüfung bewertet. Empfehlung für eine spätere Prüfung: Rolle `master` aus der Registry einbeziehen.
3. **Transportgrenzen.** HTTP-Weiterleitungen innerhalb eines Abrufs, Segmente und Schlüssel einer Medienplaylist sind nicht Teil der Masterentscheidung (wie beim bestehenden Playlist-Guard).
4. **Bewusste Funktionsverluste.** Master mit Content Steering, `DEFINE`, nicht-http-URIs (z. B. `skd://`) oder mehr als 512 eindeutigen Adressen werden nie nativ durch Kadri gestartet. Rückgabe eines nativen HLS-Originals, das Kadri nicht selbst analysiert hat, entfällt.
5. **Bibliotheksabhängigkeit.** Die Texterfassung nutzt die dokumentierte Loader-Schnittstelle `load()`. Bei einem Wechsel von hls.js die Prüfer in Abschnitt 8–12 erneut ausführen.
6. Unverändert aus dem Review: Bedienbarkeit sehr kleiner Frames (P2), Lebensdauer der `handedLast`-Referenz (P3), Firefox-DOM-Lebensdauer nicht geprüft.

## 19. Nicht ausgeführte E2E-Prüfungen

Nicht ausgeführt: Android-App- und Intentannahme; Samsung/Vivaldi; tatsächliche Ausgabe im Browser-Downloadmanager und Systemzwischenablage; gesondert nachgewiesene fremdherkunftige und verschachtelte Relay-Zustellung (der Erweiterungsprüfer `test_frame_ui.py` lief mit seinen lokalen Fixtures); DASH-E2E `test_dash_dl.py` (Prüfer bricht auf Basis und Endstand vor den Assertions ab). Der Erweiterungsprüfstand lief in Chrome for Testing 158.0.8127.36 unter Xvfb, nicht in Debian Chromium 156.

## 20. Unveränderte Sicherheits- und Liefergrenzen

`git diff 97ae9b3..93bd99a` ist leer für `chrome/`, `firefox/`, `channel/`, `vendor/` (einschließlich `vendor/hls.min.js`), `tools/`, `.github/` und `package.json`. Browserberechtigungen, Signierung, Releaseworkflows, P4-, WASM- und Harness-Pins sowie Produktionskonfiguration sind unverändert. `dashplan`/`dashstart` bleiben gesperrt (`dash_unit_check.js` 104/104). Helper unverändert und sauber auf `6e553fc` (Harness nur in einem separaten Scratch-Klon gebaut). Kein Merge, keine APK, kein ZIP, keine Beta, kein Release, keine Installation; `tools/sync-src.sh` nicht ausgeführt.

**Stopp.** P0-B bleibt bis zur unabhängigen Prüfung gesperrt.
