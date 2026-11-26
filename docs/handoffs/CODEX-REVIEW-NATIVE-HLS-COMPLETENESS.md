# Unabhängiges P0-A-Abschlussreview · Native HLS-Wiedergabe und Originalrückgabe

**Urteil: NO-GO für den Beginn von P0-B.** Die vier Befunde des Vorreviews sind in ihren ursprünglichen Fixtures korrigiert. Bei einem pausierten Original mit endungsloser HLS-Adresse löst Kadri jedoch weiterhin einen neuen Request an eine bereits als MPD erkannte Variante aus. Das wurde beim Öffnen und bei der Rückgabe getrennt beobachtet. Ein zweiter Prüfer hat den Abruf beim Schließen direkt am lokalen HTTP-Server bestätigt. Die Sperre für neue DASH-Downloadaufträge bleibt wirksam.

## A. Geprüfte Git-Stände und Liefergrenzen

Die Tabelle folgt der verifizierten linearen Elternkette. Ab Zeile zwei ist jeweils der unmittelbar vorausgehende Eintrag der einzige Parent. Die Dateiverweise dieses Berichts gelten für den Produkt- und Testbaum bei `93bd99a`. Der folgende Dokumentationscommit enthält denselben Produktbaum.

| Stand | Vollständige SHA | Einzeldiff |
|---|---|---|
| Vorheriger Produktstand | `97ae9b3a7902b341a747fca029fd16fd3eaacfe2` | Basis der Vergleichsläufe |
| Ausstehende Masteranalyse | `12dfcd4f78f82016cb0433f3ee6d82bca06c7d2d` | src/125, 170, 260 und neuer Chromium-Prüfer zur Vollständigkeit |
| Vollständigkeit und Überlauf | `a21e37de918e3978c9b85a5b17eafbba76df696b` | src/125 und 170 |
| Erneuter Parse | `b9fd80b02b775b224a5549a1555c9e8b1cdc0df3` | src/125 und neuer Reparse-Prüfer |
| Prüfung vor sofortigem Seek | `8fde14033c35aca6f2619283afa1cc7ca1197742` | src/260 und neuer Seek-Prüfer |
| Audio-/Untertitel-Grenzfälle | `93bd99a021bc8617940e9846d7a7490ec94bc6f2` | Nur tests/test_p0a_native_hls_completeness.py |
| Entwicklungsbericht und Branchkopf | `82f568aa00a05fbe32981707b22f26e3d355495c` | Nur docs/handoffs/P0A-NATIVE-HLS-COMPLETENESS.md |

Der separat abgerufene Vorreview auf `audit/p0a-fallback-frame-review` ist `9a85e65278445dcf4bee0a915ba234819a86c399`. Sein Parent ist der frühere Dokumentationskopf `b38cd046b0c088a77e488c12b85abd466b38d176`. Grundlage waren der vollständige damalige Review und der vollständige neue Entwicklungsbericht. Der frische GitHub-Referenzvergleich ergab für `fix/p0a-native-hls-completeness` den oben genannten Dokumentationskopf, für Kadri-`main` den Stand `cd00ded7d68b3d2e8af9d2724cee03e7d351f091` und für Helper-`test/s4b5-dash` den lokal sauber ausgecheckten Stand `6e553fcb82b437ce0be487233dd35f41958bade6`.

Der vollständige kombinierte Diff hat sieben Pfade: drei Produktmodule, drei neue Tests und die Übergabe. Damit umfasst er keine Änderung an `chrome/`, `firefox/`, `channel/`, `vendor/`, Berechtigungen, Signierung, P4-/WASM-/Harness-Pins, Build- oder Releasekonfiguration und `.github/`. Der Audit-Branch beginnt am Dokumentationskopf. Vergleichsläufe und Mutationen fanden in separaten Prüf-Worktrees statt.

## B. Schließen vor oder während der Masterantwort

Die lokale Zwei-Varianten-Fixture hat beide Zieladressen durch den Produktparser als MPD klassifiziert. Je Klassifikation verdrängten 44 weitere Analysen den Summary-Eintrag. Das Original war pausiert und hatte `preload=none`. Die erste angeforderte Masterantwort blieb offen. Die Messung beginnt unmittelbar vor `closePlayer()`. Der Wrapper um das originale `play()` ruft die Browserimplementierung weiterhin auf. Die markierten Vorbereitungsabrufe sind von den Zählern ausgeschlossen.

| Zeitpunkt oder Kontrolle bei erkennbarem .m3u8-Master | Eigene Messung auf der Basis | Eigene Messung auf dem Fix |
|---|---|---|
| Schließen vor Antwort, Wiederaufnahme an | 1 Original-Play / 1 neuer Master / 1 MPD-Variante | **0 / 0 / 0**, Original pausiert, null lebende HLS-Instanzen |
| Nachträgliche Freigabe der gehaltenen Antwort | Insgesamt 2 Plays und 1 Seek | 0 Plays und 0 Seeks, Player geschlossen |
| Antwort unmittelbar vor Schließen | 1 / 1 / 1 | 0 / 0 / 0 |
| Wiederaufnahme aus | 0 / 0 / 0 | 0 / 0 / 0 |
| Masterfehler 500 / ausstehend bis zum 9-s-Timeout | Je 1 Play und 1 Variantenrequest | Je 0 Plays und 0 Variantenrequests |
| Ersatz des Players / drei Öffnen-Schließen-Zyklen | 3 bzw. 1 Play und jeweils ein Variantenrequest | Je 0 Plays und 0 Variantenrequests |
| Während der Analyse zu erlaubter MP4 gewechselt | 1 Play | 1 Play |
| Original läuft bereits | 1 zusätzlicher Play | 0 zusätzliche Plays, Wiedergabe läuft weiter |

Bei Fehler, Timeout, Ersatz und Wiederholung umfasst das Beobachtungsfenster auch die vom Test veranlassten Masterladeversuche. Auf dem Fix waren dort insgesamt 2, 1, 1 bzw. 3 Masterrequests sichtbar. Diese Zahlen sind kein Beleg für einen nativen Wiederstart. Das bisherige enge Urteil für den erkannten Master trägt. Die weitere Quellenklasse in G ändert das Gesamturteil.

## C. Variantenbudget und Bestand des Masters

`hlsMasterAdd` zählt eindeutige Schlüssel. Ab der 513. Adresse setzt es dauerhaft `incomplete`. Der Bestand bleibt bei 512. Das gilt gemeinsam für URI-Zeilen, URI-Attribute, Level-Aliase und Spuren. Vor Schließen lief die integrierte Wiedergabe der generierten Master mit nachgewiesener Bildbreite und fortgeschrittener Wiedergabezeit. Erst anschließend wurde die betreffende Adresse als MPD klassifiziert.

| Eindeutige Adressen / Kontrolle | Basis: Play / nativer Master / Zielrequest | Fix |
|---|---|---|
| 510, 511, 512, jeweils letzte Adresse später MPD | jeweils 0 / 0 / 0 | jeweils 0 / 0 / 0 |
| 513 und 514, letzte Adresse später MPD | jeweils 1 / 1 / 1 | jeweils **0 / 0 / 0** |
| 512 zulässige Varianten | 1 / 1 / 1 | 1 / 1 / 1 |
| 513 zulässige Varianten | 1 / 1 / 1 | 0 / 0 / 0 wegen Überlauf |
| 700 Einträge mit 300 eindeutigen Adressen | Originalstart möglich | 1 Play, 1 nativer Master |

Audio und Untertitel vor 512 Varianten und jeweils als 513. Adresse, ein Alias hinter der Grenze, eine I-Frame-Playlist außerhalb der hls.js-Level sowie Content Steering ergaben auf dem Fix jeweils null neue native Starts und null Requests an das geprüfte Ziel. Bei den Spuren ist der nachgewiesene Effekt die verweigerte Rückgabe. Daraus folgt kein Nachweis, dass der native Browser sonst zwingend genau diese Spur gewählt hätte. Eine andere Query desselben Pfads blieb zulässig, die exakte als MPD erkannte Query sperrte.

## D. Loader, Rohtext und Bedeutung von „vollständig“

Das ausgeführte Bundle meldet `Hls.version === "1.7.3"`. Im tatsächlichen Default-Loader rufen sowohl `load` als auch `retry` die Instanzmethode `loadInternal` auf. Der Kadri-`pLoader` prüft dort vor Erzeugung des Transportrequests die Quelle und die Playlist. Der öffentliche `load`-Einstieg umhüllt nur bei `context.type === 'manifest'` den Erfolgscallback. Kadri liest zunächst `response.data` mit Basis `response.url || context.url`, dann erhält hls.js die unveränderte Antwort. Der separate Guard in `loadInternal` hängt von der internen Bibliotheksmethode ab. Bei einem Bundlewechsel sind der echte Retry-Request und die Reihenfolge Rohtext vor `MANIFEST_PARSED` als Regressionen zu erhalten. Siehe `src/125-player-hls.js:12`, `:30` und `src/170-player-laden.js:142`, `:157`, `:166`, `:178`.

Für Master sammelt der Code relative Folgezeilen und in Anführungszeichen stehende URI-Attribute. Hinzu kommen `level.uri`, `level.url[]`, Audio und Untertitel. Eine direkte Probe mit einer abweichenden Antwortbasis, einem prozentcodierten Leerzeichen, Fragmentwechsel und zwei Querywerten lieferte zwei Schlüssel am Pfad der Antwortbasis. Komma im zitierten Session-URI blieb erhalten. Nicht-HTTP-Session-Key und unaufgelöste Variable ergaben `incomplete`; fehlender Text ergab `failed`. Dies war ein Funktionsversuch mit vorgegebener Antwortbasis. Eine komplette Redirectkette am nativen Player wurde dabei nicht vermessen.

**Eine Medienplaylist kann ebenfalls einen weiteren Playlistverweis enthalten.** Sobald irgendwo am Zeilenanfang `EXTINF` oder `EXT-X-TARGETDURATION` erscheint, kehrt `hlsMasterText` bei bereits gesetztem `run.text` zurück. Dadurch werden unter anderem Variablendefinitionen und `EXT-X-RENDITION-REPORT` nicht mehr geprüft. In einer zusätzlichen Chromium-Probe dekodierten alle vier lokalen Antworten. Gemessen wurde anschließend die native Rückgabe:

| Empfangene Antwort | complete / incomplete | Native Plays / neuer Master- oder Playlistabruf |
|---|---|---|
| Normale direkte Medienplaylist | ja / nein | 1 / 1 |
| Dieselbe Medienplaylist mit EXT-X-DEFINE | ja / nein | **1 / 1** |
| Dieselbe Medienplaylist mit EXT-X-RENDITION-REPORT samt URI | ja / nein, Berichtsziel fehlt im Bestand | **1 / 1** |
| Multivarianten-Master mit derselben DEFINE-Zeile | ja / ja | **0 / 0** |

Hier wurde die unvollständige Entscheidung samt nativer Ausgabe belegt. Ein nativer Request an das Ziel des Rendition-Reports ist damit nicht nachgewiesen. Die VOD-Fixture belegt auch kein vollständiges LL-HLS-Verhalten. Die Behandlung in `src/125-player-hls.js:105–125` ist ein Zeilenscan, kein HLS-Attributparser. Eine harmlose Kommentarzeile mit URI-Muster wurde im Funktionsversuch mitgezählt. Eine leere URI wurde über die Basis aufgelöst. Der bloße Erfolg des Scans reicht für unbekannte Konstrukte nicht als Beweis einer vollständigen Referenzliste.

## E. Erneutes Parsen und veraltete Antworten

`hlsMasterBegin` ersetzt den Laufmarker und setzt `pending/complete/failed` für den neuen Lauf. Adressen, `denied` und `incomplete` bleiben am Master derselben Playerinstanz erhalten. Rohtext, Parsergebnis und Fehler müssen zum aktuellen Lauf passen. Die Callback-Seite prüft zusätzlich Player, HLS-Instanz und aktuelle Quelle. Siehe `src/125-player-hls.js:88–95,106–109,128–143` und `src/170-player-laden.js:144–169`.

Der identische Reparse-Prüfer erreichte auf der Basis 3/7 und am Endstand 7/7. Für die verkürzte Liste mit später gesperrter Variante sowie die verkürzte Liste nach früherem Guard-Veto fiel der Befund jeweils von 1 Play / 1 nativem Master / 1 Zielrequest auf **0 / 0 / 0**. Auch eine veränderte Liste und eine kurze Liste nach Überlauf blieben gesperrt. Nach offenem oder gescheitertem Vorgängerlauf und für eine andere Query gab es jeweils 1 erlaubten Play und 1 nativen Master. Der Prüfer stößt den Produkt-Retry durch ein Error-Ereignis an und steuert die Reihenfolge der Serverantworten.

Zusätzlicher Versuch mit den Produktfunktionen: zwei Läufe für denselben Schlüssel begonnen, danach Text, Fehler und Parse des ersten zugestellt. Der zweite Lauf blieb pending, ohne Fehler und ohne alte URLs. Sein eigener Text und Parse schlossen ihn erfolgreich ab. Das prüft die Markerlogik unmittelbar. In einem Browserlauf meldete Playwright nach Abschluss der sieben fachlichen Assertions einen abgebrochenen Route-Callback beim Aufräumen. Die Aussagen über den alten Callback stützen sich zusätzlich auf den direkten Versuch. Ob jeder abgebrochene Transport noch einen Bibliothekscallback zustellt, bleibt offen.

## F. Seek, Resume, Stallwächter und Capture

`origStartGuard` erfasst Übergabe, Element, Dokument, Quelle und Epochenkontext. Eine einmal verlorene Gültigkeit bleibt für dieselbe Übergabe verloren. `handBack` prüft vor Overlay und sofortigem Positionsabgleich, `resume` vor Play und der Stallwächter vor dem verzögerten Seek sowie nochmals vor dem anschließenden Play. Die gemeinsame Quellenentscheidung liegt in `src/260-player-schliessen.js:99–113`, die Effekte in `:139–152` und `:2–19`. Der Capture-Rückfall eines pausierten Originals benutzt dieselbe Entscheidung in `src/170-player-laden.js:239–245,263`.

| Original und Zeitpunkt | Eigene Beobachtung am Fix |
|---|---|
| MP4 kurz vor Rückgabe als MPD erkannt | **0 Setter / 0 Plays**. Basis: 1 Setter / 0 Plays |
| Gesperrte HLS-Variante / 513er-Master / Ersatz bei gesperrter Quelle | Je 0 Setter / 0 Plays |
| Zeitdifferenz bei zulässiger MP4 bzw. vollständiger zulässiger HLS | Je 1 Setter / 1 Play, Wiedergabezeit läuft weiter |
| Zulässiges Videoende | 1 Seek kurz vor das Ende, 0 Plays, pausiert |
| Gesperrtes Videoende | 0 Setter / 0 Plays |

Der sofortige Seek-Prüfer stieg von 4/9 auf 9/9. Der separate Stallprüfer erreichte 7/7 einschließlich gültiger stockender MP4, neuer Übergabe und Dokumentwechsel. Der Capture-Prüfer erreichte 14/14 einschließlich passivem Spiegeln. Tonrückgabe und `atEnd/closePaused` wurden im Code verfolgt. Visuelle Overlayfehler auf allen Browsern und jeder einzelne Seek bei gleichzeitigem Timeout waren keine eigenen Messpunkte. Die Freigabeentscheidung für endungslose Originale bleibt der gemeinsame Fehler in diesen sonst wirksamen Schutzbedingungen.

## G. Endungslose HLS-Quellen und die Grenze der nativen Wiedergabe

**Bestätigter P0.** Derselbe lokale Master, dieselbe korrekte HLS-MIME und dieselben zwei schon als MPD erkannten Varianten führten je nach URL-Schreibweise zu unterschiedlichen Transportentscheidungen. Die Serverantwort enthielt bei jedem Abruf dieselbe Variantenliste. Die beobachtete Schutzlücke setzt weder wechselnden Inhalt noch einen zuvor laufenden Seitenplayer voraus.

1. Frisches Dokument mit pausiertem, stummem Original und `preload=none` wie in `tests/test_p0a_native_hls_completeness.py:93` aufsetzen. Als Originaladresse den lokalen Pfad `/media` verwenden. Echten Zwei-Varianten-Master und beide Varianten lokal bedienen.
2. Beide Varianten getrennt über den Fixture-Fetch und `notePlaylist` als MPD klassifizieren. Nach je 44 weiteren Analysen für beide Adressen gleichzeitig fehlende Summary und weiterhin positive MPD-Identität prüfen. Die späteren Variantenabrufe erhalten MPD-Bytes.
3. Beim Öffnen `openBrowserPlayer(v)` aufrufen und nur die Variantenantworten offen halten. Bis zum Messpunkt bleibt das Original pausiert und sein Play-Zähler null. Die integrierte eigene Kopie im Modus `own` löst bei endungsloser Adresse bereits **2 Masterrequests und 1 Request an die gesperrte niedrige Variante** aus. Keine hls.js-Instanz war angehängt.
4. In einem neuen Dokument für den Schließversuch den **ersten Masterabruf** offen halten. Vor Schließen stehen die Zähler bei null Original-Plays und null Variantenrequests. Den Requestzähler an dieser Stelle schneiden, über `closePlayer()` schließen und die nachfolgenden Requests separat zählen. Eigenen zweiten Messlauf mit lokalem HTTP-Server und echten GET-Zählern ohne Playwright-Routing durchführen. Die folgende Tabelle gibt dessen Zähler wieder.

| Nach Schließen, erster Master vor Schließen weiterhin offen | Original-Play | Neue Master-GETs | GETs an bekannte MPD-Varianten |
|---|---:|---:|---:|
| Endungslos, Wiederaufnahme an | **1** | **2** | **1 niedrig, 0 hoch** |
| Endungslos, Wiederaufnahme aus | 0 | 0 | 0 |
| Gleicher Master unter .m3u8, Wiederaufnahme an | 0 | 0 | 0 |

Die Browser-Requestmessung lieferte beim Schließen dieselben Ergebnisse. Eine zusätzliche Öffnungsprobe mit bis zum Messpunkt gehaltenen Variantenantworten ergab auch bei `.m3u` und bei einer irreführenden `.mp4`-Adresse je 1 Variantenrequest, 0 Original-Plays und 0 angehängte HLS-Instanzen. Die `.m3u8`-Kontrolle erzeugte 1 hls.js-Instanz und 0 Variantenrequests. Damit ist auch der native Ladeweg der eigenen Kopie eigenständig betroffen. Bei sofortiger Auslieferung am HTTP-Server konnte die endungslose Fixture nach dem Fehler bis in den Capture-Fallback gelangen. Für die isolierte Wirkung der Rückgabe ist der gehaltene Master die aussagekräftigere Kontrolle.

**Ursache.** `src/040-quellen-netzwerk.js:34` und `src/170-player-laden.js:133,187–188` wählen zwischen überwachtem HLS und direkter nativer Zuweisung anhand der URL. Der unbekannte Master ist selbst kein bekanntes MPD. Die positive Prüfung seiner Adresse erkennt deshalb die bekannten MPD-Identitäten *seiner Varianten* nicht. Bei der Rückgabe akzeptiert `src/125-player-hls.js:149` einen fehlenden Masterdatensatz, wenn `mediaKindOf(url, '')` kein HLS liefert. Der tatsächliche Inhaltstyp geht dort nicht ein. `.m3u` erkennt `mediaKindOf` zwar als HLS, der integrierte Ladezweig behandelt es dennoch direkt. Eine Änderung ausschließlich am Rückgabeguard oder ausschließlich an der Dateiendungsregel schließt die belegten Pfade nicht.

**Architekturgrenze.** Selbst nach einer gültigen Analyse kann ein Server bei einem späteren nativen Abruf einen anderen Master liefern. Der native Browser transportiert seine eigenen Unteranfragen ohne Kadri-`pLoader`. Nur bereits beobachtete Quellen lassen sich mit der aktuellen Architektur sicher neu bewerten. Dieser Vorbehalt und nicht beobachtete Redirect-Zwischenziele sind von der oben gemessenen unveränderten lokalen Antwort zu trennen. Bereits laufende, eigenständig von Seite oder Nutzer gestartete Wiedergabe ist ebenfalls ein anderer Fall.

## H. Speicher, Lebensdauer und nutzbare Quellen

Der Datensatz ist pro Playerinstanz und normalisiertem Master-Schlüssel organisiert. Der Schlüssel in `src/038-dash-manifest.js:215` umfasst Origin, Pfad und Query. Ein Fragmentwechsel erzeugt keinen neuen Eintrag. Bei ausgeschöpften acht Mastern liefert `hlsMasterBegin` für Nummer neun `null`. In der direkten Kontrolle blieben acht Records erhalten. Nummer neun mit `.m3u8` war nativ gesperrt. Eine unbekannte endungslose Adresse war bei demselben Zustand erlaubt. Damit ist die fehlende Freigabe bei Platzmangel nur für als HLS behandelte Adressen gewährleistet.

**Die Anzahl ist begrenzt, die gespeicherte Zeichenlänge hat dort keine entsprechende Grenze.** Pro Master werden bis zu 512 URL-Strings und ihre Schlüssel gehalten. `hlsMasterAdd` benutzt `dashUrlKey` direkt. Ein tatsächlicher Aufruf mit einer langen synthetischen Query und einem Fragment speicherte einen Schlüssel von 16.033 und einen URL-String von 19.034 Zeichen. Der Rohtextpfad speicherte in einer gesonderten Probe ebenfalls über 19.000 Zeichen für eine Einzelreferenz. `mediaUrlOk` prüft an anderer Stelle die 4096-Zeichen-Grenze. Bei der Aufnahme in den Masterbestand wird diese Funktion nicht aufgerufen. Der Record hält den Mastertext selbst nicht dauerhaft. Der Zeilenscan benötigt temporären Raum für Text und Zerlegung. Alte Adressen werden beim erneuten Parsen für dieselbe Instanz weiter gehalten. `handedLast` in `src/260-player-schliessen.js:95,122` kann den zuletzt übergebenen Player samt Records weiter festhalten. Ein Heap-Leck über beliebig viele Schließvorgänge oder ein Browserabsturz wurde nicht nachgewiesen.

Ein Master mit 513 zulässigen Varianten war im integrierten Player dekodierbar und erhielt 0 native Starts. Bei 512 zulässigen Varianten und bei 700 Einträgen mit nur 300 verschiedenen Adressen gab es jeweils eine zulässige Rückgabe. Auch Content Steering und DEFINE im Multivarianten-Master kosteten in den Fixtures die native Rückgabe. Die Tests bestätigen daneben unabhängige dekodierte MP4 und HLS, erlaubte manuelle und automatische Qualitätswechsel, Vorschau sowie Wiedergabe nach Wechsel auf eine neue MP4-Epoche. Es gibt aus diesen Fällen keinen Anhaltspunkt für eine generelle MP4-/HLS-Sperre.

## I. Eigene Testläufe, Mutationen und bisherige Garantien

Debian Chromium **156.0.8078.79**, Playwright mit Python **3.12.14**, Node **24.22.3**, lokaler Fixture-Server. Die Komponentenprüfer luden die nummerierten Produktquellen und das echte vendorte hls.js. Die zusätzlichen Proben machten ausgewählte Produktfunktionen im Prüfdokument zugänglich. Sie änderten den Produktbranch nicht. Die DOM-Aufrufe, Dekodierung, Play-/Seek-Zähler und HTTP-Beobachtungen liefern für die beschriebenen Fälle belastbare Messpunkte. Sie bilden keine installierte Erweiterung oder Android-Ausgabe ab.

Für den Rotvergleich wurden die drei identischen finalen Prüfer gegen den Produktbaum von `97ae9b3` ausgeführt. Die fachlichen Fehler erreichten die jeweiligen Assertions. Die drei neuen Dateien wurden vollständig geprüft. Der kombinierte Diff ändert keine älteren Regressionserwartungen. Reproduktion für die drei Standardsuiten: im jeweiligen Prüf-Worktree die drei Dateien aus `93bd99a` bereitstellen und nacheinander mit `KADRI_CHROMIUM=/usr/bin/chromium python3 tests/<Datei>` starten.

| Prüfer | Basis | Endstand |
|---|---:|---:|
| test_p0a_native_hls_completeness.py | 12/30 | 30/30 |
| test_p1_hls_reparse.py | 3/7 | 7/7 |
| test_p1_handback_seek.py | 4/9 | 9/9 |

**19 Chromium-Komponentenprüfer, 461/461 Assertions.** Außer den drei neuen Prüfern liefen Capture 14/14, Frame-Share-Lebensdauer 20/20, Stall 7/7, HLS-Guard 13/13, Seitenlinkbudget 12/12, Manifestidentität 13/13, Playerklassifikation 8/8 und Redirect-Provenienz 20/20. Die acht DASH-Prüfer ergaben Fehlzuordnung 10/10, MPD 61/61, Gate 122/122, Fingerabdruck 30/30, Backfill 23/23, Alternativen 12/12, URL-Parameter 32/32 und unbekannter Start 18/18. Zusätzlich beendeten **31/31 Node-Prüfprogramme** ihren Lauf erfolgreich, darunter Dispatcher/Kanal-DASH **104/104**, HLS, MP4-/Downloadverwaltung, Registry, Frame-Relay und Vertraulichkeit. Die Zusatzversuche aus D, E, G und H zählen separat.

| Eigene gezielte Mutation, jeweils nur in eigenem temporärem Checkout | Ergebnis des zuständigen Prüfers | Alter Capture-Prüfer |
|---|---:|---:|
| M1: Bei bestehendem Record die Prüfung auf complete/pending/failed entfernen | 22/30, u. a. Play und Variantenrequest vor Antwort | 14/14 |
| M2: incomplete beim nativen Start ignorieren | 23/30, u. a. 513er-Master rot | 14/14 |
| M3: aktuelle Neubewertung der gespeicherten URLs entfernen | 25/30, u. a. nachträgliche MPD-Klassifikation beim 510er-Master rot | 14/14 |
| M4: gesammelte URLs und Schlüssel zu Beginn jedes Laufs leeren | 5/7, verkürzte und geänderte Liste rot | – |
| M5: may vor sofortigem Seek entfernen | 4/9, u. a. Setter am inzwischen gesperrten Original | – |

Die Mutationsnummern in dieser Tabelle beziehen sich auf die hier angegebenen Änderungen. `tests/test_p0a_native_hls_completeness.py:127–134,265–289` trennt die Netzfenster und zählt exakte Zieladressen. Die Positivassertion in `big` verlangt den Play-Zähler nach zuvor nachgewiesener Dekodierung. Die im Log vorhandenen nativen Master-/Zielzähler sind dort kein eigenes Positivkriterium. Der Prüfer kontrolliert bei den großen Mastern das Ergebnis des Aufrufs von `mark` nicht separat per Assertion. Die zusätzliche Gegenprobe G verlangt für beide Varianten ausdrücklich die bestätigte Identität nach Summary-Verdrängung. Ein vollständiges Blockieren würde die positiven Dekodier-, Rückgabe- und Reparse-Fälle verletzen. Die 461 grünen Assertions enthalten keine Prüfung des endungslosen nativen Pfads aus G.

**DASH-Grenze.** Die Operationstabelle in `channel/channel-service.js:78–82` bietet weder dashplan noch dashstart an. Nach Antwortverlust fragt der Manager den Zustand ab und startet den Auftrag nicht erneut (`channel/channel-downloads.js:259`). Die vier ursprünglichen DASH-Gegenproben blieben an der Produktgrenze ohne Aktion und ohne Sendung. Die Registry hält dokumentweite Segmente als mehrdeutige Beobachtung (`src/065-media-registry.js:244`). Alte positive Einträge, erfolgreiches Manifest-Gate und Fingerabdruck erzeugten im getesteten Pfad keine Freigabe. Die bisherigen Tests für Redirect-Ausgabe, Frame-Bestätigung, späten Clipboard-Fallback und gewöhnliche Links liefen erfolgreich. Der neue P0 betrifft einen nativen **Medienrequest** im Player und bei der Rückgabe. Es wurde kein neuer DASH-Helperauftrag beobachtet.

## J. Extension, Helper und offene Prüfstandsfehler

Die im Entwicklungsbericht genannten Desktopläufe mit Chrome for Testing **158.0.8127.36** sind als Fremdergebnis nachvollziehbar beschrieben. Der Helper-Commit und sein Buildskript waren einsehbar. `tests/java/channel/build.sh:14–23,37–55` baut Rust/JNI, verifiziert Java-Abhängigkeiten und erstellt die Harness-Klassen. Kadri startet bei gesetztem `HELPER_HOST_DIR` die JVM mit diesen Artefakten und koppelt über die Optionsseite (`tests/common.py:118–129,150–155`). Die Skripte verwenden für die dort vorgesehenen Prüfungen also einen realen Kanal. Der Quellstand allein attestiert nicht, aus welchem Checkout ein früher gestartetes Binary stammte.

| Prüfebene | Nachweis in diesem Audit |
|---|---|
| Ungepackte Testfassung / Service-Worker | Testfassung lokal ohne Paket auf Basis des geprüften Baums erzeugt. Eigener test_basic mit Debian Chromium 156 und frischem Profil erreicht beim Warten auf den Worker zweimal die 15-s-Grenze in tests/common.py:165–173. Vor der ersten fachlichen Assertion abgebrochen. |
| Chrome 158, realer Helperkanal | Entwicklungsbericht meldet basic 7/7, MP4 143/143, HLS 24/24, Frame-UI 61/61, direct_dl 87/87, dash_bind 28/28 und helper 18/18. Lokal fehlten dieser Browser, ausführbarer Rust-Buildpfad und ein gebauter ChannelHarness. Diese E2E-Zähler und der Ursprung des damals benutzten Binaries konnten hier nicht unabhängig bestätigt werden. |
| Dateiausgabe | Das Desktop-Harness kann seine lokale Ablage prüfen, etwa tests/test_direct_dl.py:374–381. Browser-Downloadmanager, Android-App-Annahme und System-Share/-Clipboard sind eigenständige Nachweise. Hier alle offen. |
| Plattformen | Kein eigener Firefox-, Samsung-/Vivaldi- oder Android-Lauf. Fremdherkunftige und verschachtelte echte Erweiterungs-IPC mit Helper bleiben offen. |

**test_dash_msg:** Das Skript ist zwischen Basis und Fix bytegleich. Die zeitnahen Diagnosetextprüfungen stehen in `tests/test_dash_msg.py:144–163`. 20/23 auf beiden Ständen ist Claudes Laufangabe. Ohne die reale Kopplung konnte ich weder diese Zahl noch das identische Fehlerbild unabhängig wiederholen. Der unveränderte Prüfer und die erfolgreichen Komponentengrenzen liefern keinen Beleg für eine neue Downloadfreigabe. Der offene Diagnosevergleich bleibt Teil der Integrationsabnahme.

**test_dash_dl:** Auf Basis und Fix wurde der von Python erzeugte JavaScript-Ausdruck aus `tests/test_dash_dl.py:159` isoliert mit dem JavaScript-Parser geprüft. Beide Male entstand derselbe `SyntaxError: missing ) after argument list`. Die ähnlich aufgebaute Kontrolle in Zeile 151 war auf beiden Ständen syntaktisch gültig. Der Fehler im Prüfer ist damit unabhängig lokalisiert. Ein vollständiger Extension-Lauf bis zu dieser Stelle und alle nachfolgenden fachlichen Assertions bleiben offen. Die beiden Prüfstandsschulden allein rechtfertigen keine Sperre interner P0-B-Arbeit. Der bestätigte Medienpfad in G tut das.

## K. Priorisierte Befunde und kleinste Abnahmebedingung

| Priorität und Status | Fundstelle und praktischer Nachweis | Minimaler Korrektur- bzw. Abnahmeschritt |
|---|---|---|
| **P0 · bewiesen**: native HLS-Unteranfrage an bekannte MPD-Adresse | src/170-player-laden.js:133,187–188 und src/125-player-hls.js:146–152, aufgerufen über src/260-player-schliessen.js:99–111,144–152. G trennt Öffnen und Schließen sowie Seitenoriginal und eigene Kopie. Echte Server-GETs trotz unverändertem Master und bekannter MPD-Identität. | Die Wahl des kontrollierten Ladepfads und die Erlaubnis für direkten nativen Start an dieselbe verlässliche Quellenklassifikation binden. Auch aus Endung, fehlendem Record oder fehlendem MIME allein darf keine positive Direktfreigabe für eine unbestimmte Quelle folgen. Für HLS den überwachten Pfad verwenden. Eine ungeklärte Quelle mit potenziell unkontrollierten Unterrequests darf Kadri nicht aktiv starten. Die bereits laufende Seite darf passiv weiterlaufen. Beide Gegenproben aus G mit getrennter Zählung dauerhaft aufnehmen, einschließlich .m3u, irreführendem .mp4 und dekodierter echter MP4/HLS als Positivfällen. |
| **P1 · bewiesen für die Vollständigkeitsentscheidung und den nativen Start** | src/125-player-hls.js:109–119,128–135. D zeigt Freigabe einer Medienplaylist mit DEFINE und einer mit unbeachteter Rendition-URI. Ein unzulässiger Request an die Rendition-URI selbst ist nicht bewiesen. | Vor der Medienplaylist-Abkürzung dynamische oder extern verweisende Playlistkonstrukte auswerten. Wenn Vollständigkeit nicht belegbar ist, native Übernahme verweigern. Normale statische Medienplaylist als positive Kontrolle behalten. |
| **P2 · bewiesen für fehlende Speichergrenze je String** | src/125-player-hls.js:77–85,97–103,122–124 und src/038-dash-manifest.js:215. H misst tatsächlich gespeicherte überlange Werte. Die im Entwicklungsbericht herangezogene URL-Längengrenze deckt diese Speicherung nicht. | Vor Aufnahme von Master und Referenz die vorgesehenen URL-Grenzen prüfen. Überlange Referenz als unvollständig behandeln und nicht speichern. Nach Möglichkeit nur die für die Entscheidung benötigte normalisierte Identität halten. Mit 4096/4097 Zeichen und langen Fragmenten prüfen. |
| **P3 · bewiesen für Prüfstandssyntax, Diagnoseverhalten nicht unabhängig prüfbar** | tests/test_dash_dl.py:159 und tests/test_dash_msg.py:144–163. Einzelbelege und Reichweite in J. Fehlende DASH-E2E-Aussagen können durch Aggregatzähler verdeckt werden. | Syntax separat im Prüfer korrigieren und auf beiden Ständen den konkreten Diagnosezustand im funktionierenden Desktop-Prüfstand vergleichen. |
| **P3 · bestätigte Referenzlebensdauer, Folgelast offen** | src/260-player-schliessen.js:95,122. Am letzten übergebenen Player hängt jetzt auch der Masterbestand. Die Anzahl retained Player pro Dokument wurde nicht per Heap-Profil gemessen. | Bei der Speicherabnahme den letzten übergebenen Player nach wiederholtem Öffnen und Schließen mitzählen. |

Die damaligen zwei P0-Befunde für einen erkennbaren, ausstehenden bzw. übergelaufenen Master sowie die P1-Befunde zur Monotonie und zum sofortigen Seek sind **in ihren ursprünglichen Fällen widerlegt**. Die positiven und negativen Nachweise samt Fundstellen stehen in B–F. Für die Prüfung verwandter Pfade ist entscheidend, ob der Loader überhaupt gewählt wird, bevor der erste native Request möglich wird.

## L. Abschlussentscheidung

**NO-GO.** Für P0-A fehlt die Schutzentscheidung vor dem ersten nativen Request an eine bereits gesperrte HLS-Variante. Der Fehler tritt auf einem unterstützten lokalen Chromium-Prüfpfad ohne dynamischen Masterwechsel auf.

| Freigabestufe | Entscheidung |
|---|---|
| 1. Beginn der isolierten internen P0-B-Entwicklung | Zurückgestellt. Erneute Prüfung der Korrektur für Öffnen und Originalrückgabe anhand von G und K erforderlich. |
| 2. Vollständige Extension-/Helper-/DASH-E2E-Abnahme | Offen. Eigene Komponentenläufe erfolgreich, Worker und Harness in diesem Prüfstand nicht gemeinsam abgenommen. |
| 3. Automatische DASH-Downloads | Bleiben gesperrt. |
| 4. Beta, Release, Samsung-/Vivaldi-Geräte | Keine Freigabe. |
