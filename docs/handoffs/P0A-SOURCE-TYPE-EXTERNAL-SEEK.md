# P0-A · Quellenklassifikation, native HLS-Sperre und externe Positionsübergabe

**Stand zur unabhängigen Prüfung.** Die Befunde aus [CODEX-GPT6-REVIEW-NATIVE-HLS.md](https://github.com/Owndot/Kadri/blob/193129f216188e607fca555c529364e625fb8623/docs/handoffs/CODEX-GPT6-REVIEW-NATIVE-HLS.md) sind korrigiert: ein P0, zwei P1 und zwei P2. Jede Korrektur hat einen Chromium-Prüfer, der auf dem Ausgangsstand fachlich rot und am Endstand grün ist; die P2-Testlücke ist mutationsbelegt. P0-B, P0-C und EssentialProperty wurden nicht begonnen. Automatische DASH-Downloads bleiben gesperrt.

## 1. Ausgangsstand und Elternkette

| Schritt | SHA | Parent |
|---|---|---|
| Produkt-/Testbasis | `93bd99a021bc8617940e9846d7a7490ec94bc6f2` | `8fde140` |
| 1 · P0 Typ-/Ladeentscheidung | `dc374ef` | Basis |
| 2 · P1 „In App öffnen“ | `b99506d` | 1 |
| 3 · P1 Medienplaylist-Dynamik | `9bcb059` | 2 |
| 4 · P2 Reparse-Monotonie (Test) | `b387419` | 3 |
| 5 · P2 Längenbegrenzung | `3d0a5dc` | 4 |
| 6 · Test: Umleitungsfall mit echtem Serverziel | `a7ac09d` | 5 |
| Dieser Bericht | Kopf von `fix/p0a-source-type-and-external-seek` | 6 |

Gelesen: der Review an `193129f` (Auditbranch `audit/p0a-native-hls-gpt6-review`, einziger Parent `93bd99a`) und die Übergabe `P0A-NATIVE-HLS-COMPLETENESS.md` an `82f568a`. Die Kette `97ae9b3 → … → 93bd99a` ist linear. Der neue Branch existierte vorher nicht und wurde vom Produktcommit `93bd99a` abgeleitet, nicht vom Dokument- oder Auditcommit; nichts wurde gemergt. Helper unverändert `6e553fcb82b437ce0be487233dd35f41958bade6`.

## 2. Ursachen

1. **P0 · Typ nach Schreibweise.** `tryNext` (`src/170`) verzweigte über `PLAYLIST_RE` (`.m3u8`/`.mpd`) zum bewachten hls.js-Loader, sonst zu `vid.src`. Endungslose, `.m3u`- oder irreführend `.mp4`-benannte HLS-Master liefen damit nativ am Playlist-Guard vorbei. `hlsNativeStartAllowed` (`src/125`) gab ein Original ohne Masterdatensatz frei, wenn `mediaKindOf` kein HLS erkannte. Die vorhandenen Belege waren teils nur pfadbezogen (`urlKey` ohne Query) und flossen in die Lade- und Rückgabeentscheidung nicht ein.
2. **P1 · „In App öffnen“.** `bExt` (`src/180`) rief nach `closePlayer()` zusätzlich `orig.currentTime = t` auf, außerhalb der bewachten `handBack`-Entscheidung.
3. **P1 · Medienplaylist.** `hlsMasterText` kehrte bei `#EXTINF`/`#EXT-X-TARGETDURATION` vor der Prüfung dynamischer Tags zurück.
4. **P2 · Testlücke.** Der Reparse-Prüfer erkannte ein Zurücksetzen von `denied`/`incomplete` nicht, weil gespeicherte MPD-Adressen bzw. ein erneuter Überlauf zusätzlich sperrten.
5. **P2 · Länge.** `hlsMasterRec`/`hlsMasterAdd` nahmen Adressen ohne Längen- und Formprüfung auf.

## 3. Quellenevidenz und Vertrauensgrad

`src/040` führt neu `mediaTypeSeen` (exakte Adresse samt Query via `mediaIdentityKey`; höchstens 1024 Einträge, keine Adressen über 4096 Zeichen). Ränge: `dash` > `hls` > `file`; ein höherer Rang wird nie überschrieben.

| Beleg | Typ | Herkunft | Wirkung |
|---|---|---|---|
| Gelesener `#EXTM3U`-Text (Anfrage-, Endadresse, genannte Unterlisten) | hls | Kadri-Hook bzw. Seitenmitleser (kann von der Seite stammen) | nur einschränkend |
| Content-Type-Meldung des Hintergrunds | hls/dash | Browser (Extension) | nur einschränkend |
| hls.js-Masteranalyse (`hlsMasterText`) | hls | Kadri | nur einschränkend |
| Eigene Probe der ersten 4096 Bytes | hls/dash/file | Kadri (Range-Abruf, ungehaktes `fetch`, Cookies nur gleicher Herkunft) | `file` ist der einzige positive Dateibeleg |
| Dateiendung | `claimed-file` | Adresse (Behauptung) | wie bisher, nur ohne Gegenbeleg |

Behauptungen der Seite können Kadri nur vorsichtiger machen. Eine direkte native Wiedergabe stützt sich nie auf eine von der Seite gemeldete Rolle oder einen MIME-Wert. Die MPD-Identität bleibt eine eigene harte Sperre (`mediaIsDashManifest`).

## 4. Typ- und Ladeentscheidung

`mediaTypeOf(u)` liefert `dash`, `hls`, `file`, `claimed-file` oder `''` (unbekannt).

- **Eigener Player (`tryNext`):** `dash` → überspringen. `hls` oder `PLAYLIST_RE` → bewachter hls.js-Loader. Ohne `hls`/`file`-Beleg erst die Probe (einmal je Adresse und Player), dann neu entscheiden. Direktes `vid.src` nur bei `file` oder `claimed-file`. Eine unbekannte Quelle (endungslos, Probe nicht lesbar) wird nicht nativ geladen – fail-closed, nächste Quelle bzw. Capture/Abbruch.
- **Vorschau-Alternative:** nur `file`/`claimed-file`.
- **Originalstart und Seek (`hlsNativeStartAllowed` über `origSourceAllowed`):** `dash` nie; `hls` oder vorhandener Masterdatensatz nur mit vollständiger positiver Masterentscheidung; `file`/`claimed-file` ja; unbekannt nein. Leere Adresse (Blob/MSE/`srcObject`) unverändert: nur Kontextbindung.
- **„In App öffnen“:** keine eigene Positionsänderung mehr; den Abgleich übernimmt `handBack` nach `may()`.

## 5. Rot-/Grünnachweise

Identische Prüfdateien auf `93bd99a` (sauberer Worktree) und den Korrekturständen. Aufruf: `KADRI_CHROMIUM=/opt/pw-browsers/chromium python3 tests/<Prüfer>.py`.

| Prüfer | Basis `93bd99a` | Unmittelbarer Vorgänger | Korrektur / Endstand |
|---|---:|---:|---:|
| `test_p0a_source_type.py` | **9/26** (Fassung vor Commit 6: 8/26) | – | 26/26 |
| `test_p1_external_seek.py` | **3/7** | `dc374ef` 3/7 | `b99506d` 7/7 |
| `test_p1_media_playlist.py` | **3/6** | `b99506d` 3/6 | `9bcb059` 6/6 |
| `test_p1_hls_reparse.py` (erweitert) | – | Produkt korrekt, siehe Abschnitt 8 | 9/9 |
| `test_p2_hls_url_length.py` | **5/9** | `b387419` 6/9 (Fassung vor dem echten Umleitungsfall) | `3d0a5dc` 9/9 |

Prüfstandsfehler, die während der Entwicklung erkannt und behoben wurden:
- Playwright-Routen greifen nicht für umgeleitete Abrufe. Umleitungsfälle verwenden deshalb echte Serverdateien (Commit 6 und die Fixture in Commit 5).
- Zählung von Link-Klick und Ausweichnavigation desselben `openExternal` getrennt.
- Ein Mischkandidatenfall, der auf beiden Ständen keine gemischte Liste erzeugte.
- `preload=auto` verfälschte einen Medienzähler.

## 6. Netzwerk-, Play- und Seek-Zähler (P0)

Kinder des Masters sind vorab als MPD bekannt, Zusammenfassungen verdrängt, Original pausiert mit `preload=none`. Requests werden über Chromium mit Ressourcentyp gezählt (`media` = nativ, `xhr` = hls.js, `fetch` = Kadris Probe). Klassifikationsabrufe sind ausgeschlossen. Zählung jeweils ab dem Schließen.

| Fall | Basis: Play / Seek / Master / MPD-Kind | Fix |
|---|---|---|
| Endungsloser Master, Rolle beobachtet, Schließen vor Antwort | **2 / 1 / 2 / 1** | 0 / 0 / 0 / 0 |
| Endungslos ohne Vorwissen | **2 / 1 / 2 / 1** | 0 / 0 / 0 / 0 |
| Gleicher Master als `.m3u8` | 0 / 0 / 0 / 0 | 0 / 0 / 0 / 0 |
| Endungslos, Wiederaufnahme aus | 0 / 0 / 0 / 0 | 0 / 0 / 0 / 0 |
| Öffnen endungslos (beobachtet / ohne Vorwissen) | 1 Play, 4 native Master, **2 MPD-Kinder** | 0, hls.js-Pfad |
| Öffnen `.m3u` | 2 native Master, **1 MPD-Kind** | 0 |
| Öffnen irreführend `.mp4` mit HLS-Inhalt | 1 Play, 4 native Master, **2 MPD-Kinder** | 0, hls.js-Pfad |
| Sofort geschlossen (alte Rückmeldungen) | 2 Play, 1 Seek, 1 MPD-Kind | 0, keine lebende hls.js-Instanz |
| Gemischte Kandidaten (Master, MPD, MP4) | 1 Play, **2 MPD-Kinder** | MP4 dekodiert, 0 Play, 0 MPD-Kinder |
| Nur gemeldete HLS-Rolle für eine echte MP4 | 1 Play, 2 native Ladevorgänge | 0 (einschränkend, fail-closed) |

Unterschied zu Debian Chromium 156: Astra zählte beim endungslosen Fall 1 Original-Play. In Chrome for Testing 158 kam innerhalb von 3 s ein zweiter Play-Aufruf durch den Stallwächter hinzu. Die übrigen Werte stimmen überein (2 Master-GETs, 1 MPD-Kind).

## 7. Endungslose MP4/HLS, `.m3u`, irreführendes `.mp4`, Querys, Umleitung

- Echte MP4 (`.mp4` und endungslos per Probe): dekodiert, Rückgabe mit 1 Play, kein hls.js.
- Erlaubter endungsloser Master (mit und ohne Vorwissen): über hls.js dekodiert, manueller und automatischer Qualitätswechsel erreichen ihre Level, Rückgabe 1 Play.
- Gleicher Pfad, andere Query: Der HLS-Beleg von `?x=1` macht die MP4 unter `?x=2` nicht zu HLS; sie dekodiert und wird zurückgegeben.
- Umleitung einer endungslosen Einstiegsadresse auf `/hls2/master.m3u8` mit bekannten MPD-Kindern: hls.js-Pfad, 0 Kind-Requests, 0 Play (Kontrolle, auch auf der Basis grün).
- Neue Medien-Epoche (MP4) während ausstehender HLS-Analyse: zulässiger Start.
- Bereits laufendes Original: passives Capture ohne zusätzlichen Kadri-Play (`test_p0a_capture_fallback.py`).

## 8. Medienplaylist-Dynamik und Reparse-Mutationen

Medienplaylist (direkt als Original), Zähler Play / nativer Playlistabruf nach Schließen:

| Fall | Basis | Fix |
|---|---|---|
| Statisch | 1 / 1 | 1 / 1 |
| `DEFINE` | **1 / 1** | 0 / 0 |
| Variable `{$seg}` in einer Adresse | **1 / 1** | 0 / 0 |
| `RENDITION-REPORT` auf bekannte MPD | **1 / 1** | 0 / 0 |
| `RENDITION-REPORT` auf zulässige Playlist | 1 / 1 | 1 / 1 (erfasst) |
| Multivarianten-Master mit `DEFINE` | 0 / 0 | 0 / 0 |

Ein nativer Folgeabruf an das Rendition-Ziel wurde nicht gemessen und wird nicht behauptet.

Reparse-Erweiterung um zwei Fälle ohne verdeckende Effekte:
- Kleiner zulässiger Master; die Ablehnung wird über den Produkteinstieg `noteHlsDenial` registriert (derselbe Aufruf wie beim Playlist-Guard).
- Statischer Master mit `DEFINE`, ohne Überlauf.

Beide Fälle erzeugen einen zweiten statischen Lauf derselben Hauptliste in derselben Playerinstanz. Mutationen im temporären Worktree auf `9bcb059`, danach verworfen:

| Mutation bei jedem neuen Lauf | Erweiterter Prüfer | Alter Prüfer |
|---|---:|---:|
| `denied` und `incomplete` zurückgesetzt | **7/9** | 7/7 (Lücke bestätigt) |
| nur `denied` zurückgesetzt | **8/9** | – |
| nur `incomplete` zurückgesetzt | **8/9** | – |

Produkt korrekt: 9/9; keine neue Produktlücke.

## 9. Längenbudget 4095 / 4096 / 4097

`hlsUrlOk`: vollständige Eingabe samt Fragment ≤ `MEDIA_LIMITS.urlLen` (4096) und `mediaUrlOk` (http(s), keine Zugangsdaten) – geprüft vor jeder Aufnahme in Map, Set oder Array.

| Fall | Basis: gespeicherte Länge / Play | Fix |
|---|---|---|
| Kind 4095 / 4096 Zeichen | 4095 / 4096, Play 1 | unverändert |
| Kind 4097 Zeichen | **4097 gespeichert**, Play 0 | nicht gespeichert, unvollständig, Play 0 |
| Lange Query (16.033) | **16.033 gespeichert** | nicht gespeichert, Play 0 |
| Langes Fragment (Eingabe 19.034) | **19.034 gespeichert**, Play 1 | nicht gespeichert, Play 0 |
| Duplikate 4096 | 1 Eintrag, Play 1 | unverändert |
| Umleitung, Kind relativ zum Ziel 4097 | gespeichert | dekodiert, nicht gespeichert, Play 0 |
| Masteradresse 4097 | – | kein Datensatz, Play 0 |
| Gewöhnliche Adressen | Play 1 | Play 1 |

Budget unverändert: 8 Hauptlisten × 512 eindeutige Adressen je Player, also höchstens 4096 Adressen zu je höchstens 4096 Zeichen. Querys bleiben unterschieden. Neu kommen die Typbelege hinzu: höchstens 1024 Schlüssel und 256 zwischengespeicherte Probe-Ergebnisse je Dokument.

## 10. Regressionen

**Chromium-Komponenten am Endstand `a7ac09d`: 23 Prüfer, 511/511** (bisher 461/461; neu 26 + 7 + 6 + 9 sowie 2 zusätzliche Reparse-Fälle).

| Prüfer | Ergebnis |
|---|---|
| Neu: Typ / externe Übergabe / Medienplaylist / Länge | 26/26, 7/7, 6/6, 9/9 |
| Reparse / native Vollständigkeit / sofortiger Seek | 9/9, 30/30, 9/9 |
| Capture / Frame-Share / Stallwächter / HLS-Guard (inkl. Vorschau, manueller und automatischer Wechsel) | 14/14, 20/20, 7/7, 13/13 |
| Linkbudget / Manifestidentität / Playerklassifikation / Redirect-Provenienz | 12/12, 13/13, 8/8, 20/20 |
| DASH: Fehlzuordnung, MPD, Gate, Fingerabdruck, Backfill, Alternativen, URL-Parameter, unbekannter Start | 10, 61, 122, 30, 23, 12, 32, 18 |

`test_p0a_player_classification.py`: Zwei Fälle warten jetzt auf den asynchronen MP4-Ladeaufruf (Folge der Typprobe). Die Assertions sind unverändert, und der angepasste Prüfer ergibt auch auf `93bd99a` 8/8. Negative MPD-Fälle bleiben synchron aussagekräftig, weil `playbackAllowed` sie vor der Probe abweist.

**Node: 31/31 Programme** (26 `tests/*_check.js` mit Pfadargumenten für `guard_check.js`/`ff_net_check.js`, fünf Kanalprogramme). DASH-Dispatcher 104/104, Vertraulichkeit PASS (1317 Dateien), Syntaxprüfung des zusammengesetzten Quelltexts und der Buildroutine bestanden.

## 11. Erweiterungs-/Helper-Prüfstand

Ungepackte Testfassung vom Endstand über `write(dir,'chrome',true)` (kein ZIP, kein `dist/`). Desktop-Harness in dieser Sitzung mit dem unveränderten `tests/java/channel/build.sh` aus einem separaten Klon von `6e553fc` gebaut (Rust 1.97.0, OpenJDK 21). Browser: Chrome for Testing 158.0.8127.36 unter Xvfb. Ein Service-Worker war vorhanden.

| Prüfer | Ergebnis |
|---|---|
| basic / MP4 / HLS / frame_ui / direct_dl / dash_bind / helper | 7/7, 143/143, 24/24, 61/61, 87/87, 28/28, 18/18 |
| `test_dash_msg.py` | **20/23** – offener Befund, identisch auf `97ae9b3` (zeitnahe Diagnosetexte) |
| `test_dash_dl.py` | **Abbruch vor den Assertions** (SyntaxError im erzeugten JavaScript des Prüfers; laut Review `tests/test_dash_dl.py:159`) – offener Befund, identisch auf der Basis |

Beide letzteren Befunde sind nicht Teil dieses Fixes und gelten nicht als bestandene DASH-E2E. Die Ergebnisse sind prüfstandabhängig; in Debian Chromium 156 startete der Service-Worker beim Reviewer nicht.

## 12. Verbleibende Risiken

1. **Irreführendes `.mp4` ohne lesbaren Inhalt.** Liefert ein fremder Server natives HLS unter `.mp4` ohne CORS und ohne sonstigen Beleg, bleibt die Probe unlesbar, und die Endung wird wie bisher als Datei gewertet. Endungslose Quellen sind in diesem Fall fail-closed.
2. **Zusätzlicher Abruf.** Die Typprobe ist ein Range-Abruf vor einer unbelegten Direktwiedergabe (auch `.mp4`), einmal je Adresse und Dokument (Cache 256).
3. **Funktionsverlust.** Endungslose Medien ohne CORS spielt der eigene Player nicht mehr direkt ab und gibt sie nicht nativ zurück; Kadri fällt auf andere Quellen bzw. Capture zurück.
4. **Seitenbelege** wirken nur einschränkend; eine Seite kann ihre eigene Wiedergabe in Kadri dadurch verhindern, aber nichts freischalten.
5. **Blob/MSE/`srcObject`:** keine Typentscheidung möglich, nur Kontextbindung (kein Netzwerk-P0 nachgewiesen).
6. Unverändert: nativer Player kann einen anderen Masterinhalt erhalten; Segmente, Schlüssel und Weiterleitungen innerhalb eines Transports; Firefox-DOM nicht geprüft; P2-Kleinframe und P3-`handedLast` aus früheren Reviews.

## 13. Nicht ausgeführte E2E-Prüfungen

Android-App-/Intent-Annahme, Samsung/Vivaldi, Browser-Downloadmanager und Systemzwischenablage, gesondert nachgewiesene fremdherkunftige oder verschachtelte Relay-IPC, DASH-E2E (`test_dash_dl.py` bricht ab, `test_dash_msg.py` 20/23). Kein Test in Debian Chromium 156 in dieser Umgebung.

## 14. Unveränderte Grenzen

`git diff 93bd99a..a7ac09d` ist leer für `chrome/` (einschließlich `background.js` und Manifest), `firefox/`, `channel/`, `vendor/` (einschließlich `hls.min.js`), `tools/`, `.github/`, `package.json`. Berechtigungen, Signierung, Releaseworkflows, P4-/WASM-/Harness-Pins und Produktionskonfiguration unverändert; `dashplan`/`dashstart` bleiben gesperrt. Kein Merge, keine APK, kein ZIP, keine Beta, kein Release, keine Installation; `tools/sync-src.sh` nicht ausgeführt. Keine Requests an fremde Websites, keine neuen Formate, keine globalen fetch-/XHR-Patches (die Probe nutzt das bestehende ungehakte `rawFetch`).

**Bewertung:** Die gemessenen Effekte aus dem Review treten am Endstand nicht mehr auf. Risiko 1 ist eine benannte Restgrenze ohne Messung. Ob sie für die Abnahme tragbar ist, ist eine Entscheidung der unabhängigen Prüfung; bei strenger Auslegung ist sie ein Grund für ein fortgesetztes NO-GO. **Stopp.** P0-B bleibt gesperrt.
