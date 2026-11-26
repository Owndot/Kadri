# P0-A-Abschlussreview zur nativen HLS-Wiedergabe

**NO-GO für den Beginn von P0-B.** Die vier Korrekturen schließen die Fälle, für die sie entwickelt wurden. Der vorgeschriebene Produktstand lädt jedoch weiterhin eine bereits als DASH-MPD erkannte Variante, wenn der HLS-Master eine endungslose Adresse hat. Außerdem setzt „In App öffnen“ die Position eines Originals, dessen HLS-Master als unvollständig gilt. Für diesen zweiten Befund genügten 513 *zulässige* Varianten. Beide Effekte wurden am geprüften Produktstand gemessen.

## A. Produktstand und unabhängige Prüfung

Die GitHub-Branchköpfe wurden frisch gelesen. Die folgenden Zeilen bilden die lineare Elternkette. Jeder Eintrag nach der Basis hat genau den unmittelbar vorausgehenden Commit als Parent.

| Schritt | Vollständiger Commit | Änderung |
|---|---|---|
| Basis | `97ae9b3a7902b341a747fca029fd16fd3eaacfe2` | Produktstand für den Rotvergleich |
| Ausstehende Masteranalyse | `12dfcd4f78f82016cb0433f3ee6d82bca06c7d2d` | src/125, 170, 260 und Vollständigkeitsprüfer |
| Umfang und Limit | `a21e37de918e3978c9b85a5b17eafbba76df696b` | src/125 und 170 |
| Erneute Analyse | `b9fd80b02b775b224a5549a1555c9e8b1cdc0df3` | src/125 und Reparse-Prüfer |
| Sofortiger Positionsabgleich | `8fde14033c35aca6f2619283afa1cc7ca1197742` | src/260 und Seek-Prüfer |
| Geprüfter Produkt- und Testbaum | `93bd99a021bc8617940e9846d7a7490ec94bc6f2` | Nur zusätzliche Audio-/Untertitel-Testfälle |
| Kopf von fix/p0a-native-hls-completeness | `82f568aa00a05fbe32981707b22f26e3d355495c` | Nur docs/handoffs/P0A-NATIVE-HLS-COMPLETENESS.md |

Zwischen Basis und Produktstand liegen drei geänderte Produktmodule und drei neue Testdateien. Der vollständige Diff enthält keine Änderungen an `chrome/`, `firefox/`, `channel/`, `vendor/` einschließlich hls.js, `tools/`, `.github/`, Berechtigungen, Signierung, P4-/WASM-/Harness-Pins oder Lieferkonfiguration. Der Kadri-main-Kopf ist weiterhin `cd00ded7d68b3d2e8af9d2724cee03e7d351f091`. Der lokale saubere Helper-Checkout stimmt mit dem Remote-Referenzbranch bei `6e553fcb82b437ce0be487233dd35f41958bade6` überein.

Herangezogen wurden die Übergaben an `b38cd046b0c088a77e488c12b85abd466b38d176` und `82f568a`, der Vorreview an `9a85e65278445dcf4bee0a915ba234819a86c399` sowie die bereits veröffentlichte unabhängige Prüfung an `ca4d99049d246c7f6832233dd58a6d6b703b5689`. Der neue Auftrag benennt denselben Produktbaum wie die letztgenannte Prüfung. Dieser Bericht basiert direkt auf `93bd99a`. Alle folgenden Produktzeilen beziehen sich darauf. Die Browserläufe unten wurden für diesen Auftrag erneut ausgeführt, soweit ausdrücklich angegeben.

## B. Die ursprünglichen P0-Gegenproben

**Schließen vor der Masterantwort.** Zwei Ziele des lokalen HLS-Masters wurden über den MPD-Parser klassifiziert. Weitere Manifestanalysen verdrängten die Zusammenfassungen. Das Seitenvideo war pausiert mit `preload=none`. Der erste hls.js-Abruf blieb offen. Der Zähler beginnt unmittelbar vor dem tatsächlichen Schließen. Die Klassifikationsabrufe sind ausgeschlossen. Der instrumentierte Play-/Seek-Zähler am Original ruft die Browserimplementierung auf.

| Erkennbarer .m3u8-Master | Basis | Produktstand |
|---|---|---|
| Schließen vor Antwort, Wiederaufnahme an | 1 Play, 0 Seek, 1 neuer Master und 1 MPD-Variante | **0 Play, 0 Seek, 0 Master, 0 Varianten** |
| Antwort unmittelbar vor Schließen | 1 Play und 1 MPD-Variante | 0 Play, 0 Seek und 0 Varianten |
| Freigabe der gehaltenen Antwort nach Schließen | Insgesamt 2 Plays und 1 Seek | 0 Plays und 0 Seeks, Player bleibt geschlossen |
| Wiederaufnahme aus | 0 Play, 0 Seek und 0 Varianten | Gleiches Ergebnis |
| HTTP 500 / Ladezeitüberschreitung | Je 1 Play und 1 MPD-Variante | Je 0 Plays, 0 Seeks und 0 MPD-Varianten |
| Player ersetzt / dreimal geöffnet und geschlossen | 3 bzw. 1 Play | Je 0 Plays, 0 Seeks und 0 Varianten |
| Original bereits in Wiedergabe | 1 zusätzlicher Play | 0 zusätzliche Plays, Original läuft weiter |

Die letzten Fehler- und Wiederholungsfenster enthalten auch vom Prüfer ausgelöste hls.js-Masterrequests. Daher ist dort ausschließlich der neue native Start bzw. Zielrequest aussagekräftig. Ein eigener Zusatzversuch mit HTTP-Erfolg und ungültigem Text schloss den Player kontrolliert, ohne Original-Play, Seek oder nativen Masterrequest. Bei einem abgebrochenen STREAM-INF-Eintrag ohne Folge-URI war nach 2,6 Sekunden noch eine HLS-Instanz aktiv. Bis dahin blieben alle drei Zähler null. Dieser Zeitpunkt beweist keine abschließende Fehlerbehandlung dieser Syntaxvariante.

**Variantenlimit.** Bei 510, 511 und 512 eindeutigen URLs blieb die zuletzt, erst nach der Dekodierung als MPD erkannte Variante auf beiden Ständen gesperrt. Bei **513 und 514** maß ich auf der Basis jeweils **1 Play / 1 nativen Master / 1 Zielrequest**, auf dem Fix jeweils **0 / 0 / 0**. Zulässige 512 Varianten ergaben weiterhin 1 Play und 1 nativen Master. Ein zulässiger Master mit 513 Varianten dekodierte im überwachten Player, die native Rückgabe blieb gesperrt. 700 Einträge mit nur 300 eindeutigen Adressen dekodierten und erhielten einen nativen Start.

## C. HLS-Rolle und endungslose Quellen

Der relevante Unterschied liegt **vor** dem Ladeaufruf. `src/040-quellen-netzwerk.js:34` und `src/170-player-laden.js:133,187–188` verzweigen anhand der Adressschreibweise zum überwachten Loader oder zu direktem `vid.src` und `vid.play()`. Bei der Rückgabe erlaubt `src/125-player-hls.js:149` einen fehlenden Datensatz, sofern der Pfadtest mit leerem MIME kein HLS erkennt. Die Registry kennt weitere Informationen: `mediaRoleHint` erkennt Kinder eines gelesenen Masters, während `playbackAllowed` einen HLS-Master nicht grundsätzlich sperrt. Eine Zusatzprobe mit dem tatsächlich gelesenen endungslosen Master ergab **Rollenhinweis master, Registry-Rolle master, playbackAllowed wahr, hlsNativeStartAllowed ohne Record wahr**. Die Rollenprobe allein begründet das Urteil nicht. Der folgende Transportnachweis tut es.

Im separaten lokalen HTTP-Versuch blieben HLS-MIME, Antwortinhalt und beide bereits erkannten MPD-Zielidentitäten identisch. Am Server traf vor dem Öffnen kein unmarkierter Medien-GET ein. Der erste Masterrequest blieb offen. Unmittelbar vor dem Schließen war das Original pausiert und sein Play-Zähler null.

| Änderung im Versuch | Original-Play nach Schließen | Neue Master-GETs | GETs an die bekannte MPD-Variante |
|---|---:|---:|---:|
| Endungsloser Master, Wiederaufnahme an | **1** | **2** | **1** |
| Endungsloser Master, Wiederaufnahme aus | 0 | 0 | 0 |
| Identischer Master unter .m3u8, Wiederaufnahme an | 0 | 0 | 0 |

Auch beim **Öffnen** gab es im isolierten Browserlauf mit zurückgehaltenen Variantenantworten für die endungslose URL sowie für `.m3u` und irreführendes `.mp4` jeweils einen Variantenrequest bei null Original-Plays. Die eigene Kopie lief ohne hls.js. Die `.m3u8`-Kontrolle erzeugte eine hls.js-Instanz und null Variantenrequests. Ein vom Benutzer oder von der Seite schon gestartetes Original erklärt diese Messungen nicht. Der Pfad steht unabhängig vom Download-Dispatcher offen.

Blob, MSE und srcObject brauchen eine eigene Betrachtung. `src/060-quellen-zuordnung.js:11–16` liefert für Nicht-HTTP(S) keine Originaladresse. `src/260-player-schliessen.js:99–100` lässt die leere Adresse durch. `src/045-media-source.js:48–58` bindet die Übergabe an das erfasste Objekt, Element und die Epoche. Daraus lässt sich für beliebige Blob-Inhalte kein positiver Typnachweis ableiten. Passives Spiegeln ist getestet. Ein neuer Request an eine bekannte MPD-Variante allein durch Blob/MSE oder srcObject wurde hier **nicht nachgewiesen**.

## D. Mastertext, Loader, Redirect und Transportgrenze

Das ausgeführte Bundle meldet hls.js **1.7.3**. Sowohl der Default-Einstieg `load` als auch `retry` rufen in dieser Fassung `loadInternal` auf. Kadri prüft dort Playlist und aktuelle Spur vor der Transportdelegation. Nur für den Manifestkontext umhüllt Kadri den Erfolgscallback. Der Rohtext wird anhand von `response.url || context.url` ausgewertet, bevor hls.js seine Erfolgsbehandlung und anschließend MANIFEST_PARSED ausführt. Die Instanzprüfung und der Laufmarker verhindern, dass ein alter Callback einen neueren Lauf abschließt. Siehe `src/125-player-hls.js:12–42,106–139` und `src/170-player-laden.js:144–179`.

Eigener **HTTP-302-Positivversuch** mit Ursprungs- und Endadresse in verschiedenen Verzeichnissen: ein GET am Einstieg, ein GET am umgeleiteten Master, ein GET an die erlaubte Variante im Verzeichnis der Endadresse. Die Wiedergabe dekodierte. Der Record war vollständig und enthielt beide relativ zur Endadresse aufgelösten Kindpfade. Damit ist für diesen realen Transport die Verwendung der richtigen Basis belegt. Der HLS-Guard-Test bestätigte außerdem den erneut geprüften Master-Retry. Ersetzt eine Bibliotheksversion die interne Methode, müssen diese Tests mit dem neuen Bundle laufen.

URI-Folgezeilen sowie zitierte URI-Attribute für Varianten, Session-Daten, Schlüssel, I-Frame, Audio und Untertitel werden mit den von hls.js exponierten Adressen vereinigt. Querys blieben verschieden, Fragmente derselben Referenz belegten einen gemeinsamen Schlüssel. Multivarianten-Master mit DEFINE oder Content Steering sperrten die native Übergabe. Variablen ohne auflösbare Adresse und Nicht-HTTP-Referenzen werden im Masterpfad konservativ behandelt. Der Scan ist kein vollständiger HLS-Parser.

**Medienplaylist-Ausnahme.** `src/125-player-hls.js:109–119` setzt `run.text` und kehrt bei EXTINF oder TARGETDURATION vor der Prüfung dynamischer Tags zurück. Im Chromium-Vergleich dekodierten alle vier Fixtures. Eine statische direkte Medienplaylist, dieselbe mit DEFINE und dieselbe mit RENDITION-REPORT ergaben jeweils **1 nativen Play und 1 neuen Playlistabruf**. Die Rendition-URI fehlte im Bestand. Ein Multivarianten-Master mit derselben DEFINE-Zeile ergab **0 / 0**. Belegt sind die fälschlich positive Vollständigkeitsentscheidung und der native Start. Ein Folgerequest an das Rendition-Ziel selbst wurde nicht gemessen.

Ein nativer Player kann einen neuen Masterinhalt oder ein anderes Weiterleitungsziel erhalten. Kadri kontrolliert diesen Transport nach der direkten Übergabe nicht. Die Entwicklerübergabe benennt dies zutreffend. Eine umfassende Zusicherung für künftige native Unteranfragen lässt sich aus der vergangenen hls.js-Antwort nicht ableiten. Der bestätigte P0 in C kommt ohne eine solche Serveränderung aus.

## E. Budgets, Reparse und Speicher

`src/125-player-hls.js:76–103,128–152` begrenzt den Bestand auf acht Master mit jeweils 512 eindeutigen Adressen. Der neunte Begin-Aufruf lieferte null, die Map behielt acht Einträge. Für den neunten erkennbaren HLS-Master blieb die Freigabe aus. Für einen endungslosen Schlüssel ohne Record galt die Ausnahme aus C. Die Adressmenge, `denied` und `incomplete` bleiben innerhalb derselben Playerinstanz und Master-Query erhalten. `failed`, `pending` und `complete` gehören zum einzelnen Lauf.

Die Browserfixtures prüften Audio und Untertitel vor und hinter dem Limit, den zusätzlichen Alias, eine I-Frame-Playlist sowie die exakte bzw. abweichende Query. Eine ergänzende Funktionsmatrix verwendete den Produktparser und eine explizite Zulassungsfunktion für genau eine Testreferenz. I-Frame, Session-Daten, Session-Key, Audio und Untertitel ergaben alle dasselbe Ergebnis: Bei 511 Varianten plus Referenz war sie vorne wie hinten im Bestand von 512. Bei 512 Varianten plus Referenz war der Record in beiden Anordnungen unvollständig. Stand die Referenz hinten, fehlte sie im Set, und die native Freigabe blieb falsch. Diese Matrix misst Modellentscheidungen. Die echten nativen Requests an der 512/513-Grenze stehen in B.

Kürzere bzw. veränderte Listen gaben eine früher als MPD erkannte Variante beim erneuten Parsen nicht frei. Ein neuer vollständiger Lauf nach vorangegangenem Fehler oder Pending-Zustand und eine andere Master-Query erlaubten dagegen die Rückgabe. Direkte Zustellung von Text, Fehler und Parse eines alten Laufs ließ den neueren pending, fehlerfrei und ohne alte Schlüssel. Sein eigenes Ergebnis konnte ihn abschließen. Der Browser-Reparse-Prüfer aktiviert die Produktfehlerbehandlung über ein synthetisches Error-Ereignis.

**Speicher.** Im Aufnahmepfad ist die Zahl der Strings begrenzt. Eine Längenprüfung wie in `src/045-media-source.js:23–25` fehlt vor der Speicherung. Direkt gemessen wurden ein **16.033 Zeichen langer Schlüssel** und ein **19.034 Zeichen langer URL-String** einschließlich Fragment. Die gespeicherten Records enthalten Adressen, Schlüssel und Zustand. Der gelesene Gesamttext bleibt dort nicht als Feld erhalten. Die letzte Übergabe kann über `handedLast` noch den Player samt Records festhalten. Heap-Verbrauch in Bytes und Wachstum über viele Playerwechsel wurden nicht vermessen.

## F. Close, Capture, externe Übergabe und verzögerte Aktionen

`origStartGuard` bindet die Entscheidung an Übergabe, Element, Dokument, Medienepoche und aktuelle Originalquelle. `handBack` prüft vor dem ursprünglichen Setter und vor Resume. `watchStall` prüft beim Timerdurchlauf und erneut zwischen Seek und anschließendem Play. Bei als MPD umklassifizierter MP4 maß ich auf der Basis **1 Seek / 0 Plays**, auf dem Fix **0 / 0**. Bei zulässiger MP4 und vollständig geprüftem HLS maß ich jeweils **1 / 1** mit fortschreitender Wiedergabe. Bei erlaubtem Videoende blieb es bei einem Seek und null Plays. Die Kontrollen zu Playerersatz, altem Timer und Dokumentwechsel liefen erfolgreich. Siehe `src/260-player-schliessen.js:2–19,99–113,139–152`.

**Zusätzlicher bestätigter Seek nach dem Schließen.** Der Produktpfad „In App öffnen“ gelangt über das Menü zum Button, prüft die externe Zieladresse und ruft dann `closePlayer()` auf. Unmittelbar *danach* schreibt er selbst `orig.currentTime = t`. Die Erlaubnis für die externe Zieladresse beantwortet nicht, ob die Position des Originals geändert werden darf. Siehe `src/190-player-menues.js:135` und `src/180-player-bedienung.js:618–628`.

Für den Vergleich lief dieselbe lokale, gültige HLS-Fixture bis über eine Sekunde dekodierter Wiedergabe. Gezählt wurde am echten Original-Setter. Nur die abschließende externe Ausgabe wurde durch einen Zähler ersetzt. Die ersten beiden Zeilen verwenden exakt denselben unvollständigen Master.

| Aktion | Master | Original-Seeks | Original-Plays | Aufrufe des externen Ausgabe-Einstiegs |
|---|---|---:|---:|---:|
| Normales Schließen | 513 erlaubte Varianten, incomplete | 0 | 0 | 0 |
| „In App öffnen“ | 513 erlaubte Varianten, incomplete | **1** | **0** | 1 |
| „In App öffnen“ | 2 erlaubte Varianten, vollständig | 2 | 1 | 1 |

In allen drei Fällen schloss der Player. Damit ist die zweite Schreibstelle praktisch erreichbar und unabhängig vom nativen Wiederstart. Ein unzulässiger Netzwerkrequest durch diesen Setter, ein Dateidownload oder eine reale App-Annahme wurden nicht nachgewiesen. Die kleinste Maßnahme ist, den redundanten Positionsabgleich dem bereits geschützten Übergabepfad zu überlassen. Die externe Ausgabe soll weiterhin ihren eigenen Herkunftskontext prüfen.

Im Capture-Modus liefert `M()` das Original (`src/130-player-aufbau.js:145`). Mediensteuerung und Nutzer-Seeks über diese Abstraktion sind von einer automatischen Wiederaufnahme zu unterscheiden, etwa `src/200-player-mediasession.js:23–30`. Eine Garantie für jede OS-Medienaktion, für jedes Prompt-Timing oder für Firefox lässt sich aus den lokalen Chromium-Tests nicht ableiten.

## G. Positive Funktionen und bestehende DASH-Sperre

Getestet wurden dekodierte MP4 und HLS, Qualitätswechsel manuell und automatisch, erlaubte Vorschau, Rückgabe mit fortschreitender Zeit, passives Spiegeln und die weiter erlaubte unabhängige MP4 bei Epochenwechsel. Der HLS-Guard stoppte in seinen geprüften automatischen und verzögerten Fällen den Transport an die bekannte Variante, selbst wenn hls.js bereits ein Ladeereignis ausgelöst hatte. Reguläre Seiten- und Beitragslinks blieben im Komponentenprüfer teilbar. Die Frame-Bestätigung und die erneute Prüfung vor dem Clipboard-Fallback hielten bei später Klassifikation. OS-Annahme und reale geräteübergreifende Ausgaben sind davon getrennt.

Die vier ursprünglichen DASH-Gegenproben blieben an der Downloadgrenze ohne positive Aktion. Ein positives Manifest-Gate genügte nicht. `src/065-media-registry.js:244` registriert dokumentweite DASH-Stücke als mehrdeutige Beobachtung. Die Befehlsliste in `channel/channel-service.js:78–82` stellt weder dashplan noch dashstart bereit. Die Verwaltung klärt nach Antwortverlust den Status, ohne erneut zu starten (`channel/channel-downloads.js:259`). Der bestätigte P0 ist eine Medienanforderung beim Abspielen. Ein neuer DASH-Helperauftrag wurde nicht nachgewiesen.

## H. Testqualität, Rot-/Grünvergleich und Mutationen

Debian Chromium **156.0.8078.79**, Playwright, lokale Medienfixtures und das gebündelte hls.js. Basis und Fix liefen mit bytegleichen finalen Prüfdateien und separaten Fixture-Ports. Die drei neuen Prüfer enthalten keine skip-/xfail-Markierungen. Im Produktdiff wurden keine älteren Testassertions abgeschwächt. Für einige Programme musste der lokale Chromium-Pfad ausdrücklich gesetzt werden. Frühe Startfehler ohne Browser zählen nicht. Nach einer Unterbrechung der Terminalverbindung wurden die abgeschlossenen Läufe anhand der einzelnen Ergebniszeilen verifiziert.

| Eigener neuer Lauf | Basis | Produktstand |
|---|---:|---:|
| test_p0a_native_hls_completeness | 12/30 | 30/30 |
| test_p1_hls_reparse | 3/7 | 7/7 |
| test_p1_handback_seek | 4/9 | 9/9 |

**Eigene Summe auf dem Produktstand: 19 Chromium-Prüfer, 461/461 Prüfpunkte.** Neben den neuen Prüfern liefen Capture 14/14, HLS-Varianten 13/13, Frame-Share 20/20, Stallwächter 7/7, Manifestidentität 13/13, Redirect-Provenienz 20/20, Seitenlinkbudget 12/12 und Playerklassifikation 8/8. Die DASH-Prüfer ergaben Fehlzuordnung 10/10, MPD 61/61, Gate 122/122, Fingerabdruck 30/30, Backfill 23/23, Alternativen 12/12, URL-Parameter 32/32 und unbekannter Requestbeginn 18/18. **31/31 Node-Programme** beendeten ihren Lauf erfolgreich, darunter **104/104 DASH-Dispatcherprüfungen**, Registry, Frame-Relay, MP4-/HLS-Verwaltung und Vertraulichkeitsprüfung. Die zusätzlichen Messungen aus B–F zählen nicht zu den 461.

Die Dekodierkontrollen und zulässigen Rückgaben würden bei einer pauschalen Totalsperre scheitern. `tests/test_p0a_native_hls_completeness.py:93–134,265–289` instrumentiert die Browseroperationen. Sein flacher Schließ-Check prüft bei negativen Fällen Play, native Masterrequests, Zielrequests und Pause. Den Seek-Zähler gibt er aus, ohne ihn in jeder Assertion zu verlangen. Der Budget-Positivzweig verlangt vorab Dekodierung und später den Play-Zähler. Der dort ausgegebene native Zielzähler ist kein eigenes Bestehenskriterium. Die gesonderte HTTP-Zählung in C vermeidet diesen blinden Fleck. Die drei neuen Prüfer erfassen außerdem nicht den zusätzlichen Setter bei der externen Übergabe.

| Mutierter Testgegenstand | Herkunft und Ergebnis |
|---|---|
| Verlust der Prüfung auf fertig/laufend/fehlgeschlagen, fehlender Record weiterhin separat behandelt | Früherer eigener Mutationslauf am identischen Baum: 22/30. Alter Capture-Prüfer weiterhin 14/14. |
| Keine dynamische Neubewertung gespeicherter Ziele | Früherer eigener Lauf: 25/30. Alter Capture-Prüfer 14/14. |
| Volles Set behält 512 Schlüssel, markiert die nächste Adresse aber nicht als Überlauf | **Neu**, nur im für den Test geladenen Quelltext verändert: **12/17** Budgetfälle. Unter anderem 513 und 514 fachlich rot, je 1 nativer Play und 1 betroffenes Ziel. |
| Adressmenge bei jedem Reparse zurückgesetzt | Früherer eigener Lauf: 5/7. |
| Nur denied und incomplete bei jedem Begin zurückgesetzt, Adressmenge bleibt erhalten | **Neu: 7/7 trotz Mutation.** Der bestehende Reparse-Prüfer unterscheidet diese fehlerhafte Änderung nicht. |
| Sofortiger Seek ohne may-Prüfung | Früherer eigener Lauf: 4/9. |

**Gezielte Kontrolle für die überlebende Mutation.** In `tests/test_p1_hls_reparse.py:113–143` kann die alte Adresse weiter sperren oder eine neue eindeutige Adresse das volle Set erneut zum Überlauf bringen. Im ergänzenden Funktionsversuch verwendete ich deshalb denselben kleinen Master und dieselbe zulässige Kindadresse zweimal. Beim ersten Lauf wurde entweder DEFINE oder eine registrierte Ablehnung gesetzt. Der zweite reguläre Parse war kurz und fehlerfrei. Der unveränderte Produktcode blieb in beiden Fällen gesperrt. Die Mutation gab in beiden Fällen frei. Damit ist **die Testlücke bestätigt**, während sich das aktuelle Produkt in diesen zwei Fällen korrekt verhält. Als bleibende Regression genügen diese zwei gezielt unterscheidbaren Übergänge.

## I. Erweiterungs-/Helper-Integration und offene Fehler

Für die Basis **und** den Fix wurde mit der Test-Schreibfunktion aus dem jeweiligen `tools/build.js` eine ungepackte Erweiterung erzeugt. In beiden eigenen `test_basic`-Anläufen erreichte Debian Chromium beim Warten auf den Extension-Service-Worker das Timeout vor der ersten fachlichen Assertion (`tests/common.py:159–174`). Der Vergleich ergibt keinen Hinweis auf eine durch den Produktdiff neu verursachte Startstörung. Er liefert auch keinen bestandenen Extension-Test.

Im Entwicklungsbericht steht ein anderer Prüfstand, Chrome for Testing **158.0.8127.36** mit Desktop-Harness. Gemeldet werden basic 7/7, MP4 143/143, HLS 24/24, frame_ui 61/61, direct_dl 87/87, dash_bind 28/28 und helper 18/18. Der Helper-Quellstand sowie der reale JVM-/Kopplungspfad sind nachvollziehbar (`tests/common.py:118–155`, im Helper `tests/java/channel/build.sh:14–23,37–55`). In dieser Umgebung fehlten ein gebauter ChannelHarness, Rust-Werkzeugkette und der 158er-Browser. **Die genannten 158er-Läufe und die Provenienz ihres gebauten Harness sind hier nicht unabhängig verifiziert.** Browser-IPC, Desktop-Dateiausgabe, Browserdownloadmanager, Android-Intent, System-Share/-Clipboard, Samsung/Vivaldi und echte verschachtelte oder fremdherkunftige Frame-IPC bleiben eigenständige offene Abnahmen.

- **test_dash_msg:** 20/23 auf beiden Ständen sind Herstellerangaben. Die Datei ist zwischen den Ständen identisch. Die zeitabhängigen Diagnosetextprüfungen in `tests/test_dash_msg.py:144–163` wurden hier nicht mit echtem Kanal ausgeführt. Das konkrete Fehlerbild bleibt offen.
- **test_dash_dl:** Den von Python erzeugten JavaScript-Ausdruck an `tests/test_dash_dl.py:159` habe ich auf beiden Ständen unabhängig parsen lassen. Beide ergaben denselben SyntaxError. Die Vergleichsstelle in Zeile 151 war zweimal gültig. Damit ist der vorhandene Fehler im Prüfer bestätigt. Ein vollständiger Browserlauf bis zu dieser Stelle und seine nachfolgenden fachlichen Assertions sind nicht abgenommen.

Für sich genommen wären diese beiden Prüfstandsschulden kein ausreichender Grund, die isolierte interne Entwicklung zu sperren. Der reproduzierte native Variantenrequest in C ist ein solcher Grund.

## J. Priorisierte Befunde und vier Freigabestufen

| Priorität / Status | Fundstelle, Beleg und Wirkung | Kleinste empfohlene Maßnahme |
|---|---|---|
| **P0 · bestätigt** | `src/040-quellen-netzwerk.js:34`, `src/170-player-laden.js:133,187–188`, `src/125-player-hls.js:149`, `src/260-player-schliessen.js:99–111`. C weist bekannte MPD-Ziele im nativen Transport beim Öffnen und nach Schließen nach. | Eine gemeinsame abgesicherte Typentscheidung für eigene Kopie und Originalrückgabe verwenden. Eine verlässlich erkannte HLS-Quelle über den kontrollierten Ladepfad führen. Unklare Quellen ohne positive Direktfreigabe nicht aktiv nativ starten. Pausierte und bereits laufende Originale gesondert prüfen. Tests aus C und echte MP4-/HLS-Kontrollen erhalten. |
| **P1 · bestätigt, zusätzlicher Original-Seek** | `src/180-player-bedienung.js:622–628`. F misst am unvollständigen Master beim externen Übergang 1 Setter nach Schließen, bei normaler Rückgabe 0. Ein unzulässiger Netzabruf allein durch den Setter ist nicht belegt. | Zweiten ungeprüften Setter entfernen bzw. den geschützten Positionsabgleich an einer Stelle durchführen. Bei 513 zulässigen Varianten für beide Schließwege 0 Original-Seeks verlangen. |
| **P1 · bestätigt für fehlerhafte Vollständigkeit und Start** | `src/125-player-hls.js:109–119,128–135`. Medienplaylist mit DEFINE bzw. RENDITION-REPORT erhielt eine positive native Entscheidung. D enthält die Gegenkontrollen. | Dynamische Konstrukte und weitere Playlistverweise vor der Medienplaylist-Abkürzung auswerten. Bei fehlendem Nachweis native Übernahme sperren. Einfache statische Playlist als Positivfall beibehalten. |
| **P2 · bestätigt, Testlücke** | `tests/test_p1_hls_reparse.py:113–143`. Das Zurücksetzen beider negativen Flags besteht 7/7 und versagt im gezielten Kontrollversuch H. | Zwei monotone Zustandsübergänge prüfen, in denen weder eine gespeicherte negative URL noch ein erneuter Überlauf den Verlust verdeckt. |
| **P2 · bestätigt, überlange gespeicherte Schlüssel** | `src/125-player-hls.js:77–85,97–103`, `src/038-dash-manifest.js:215`. E weist einen gespeicherten String mit über 19.000 Zeichen nach. | Länge vor Aufnahme in Map/Set/Array begrenzen, überlange Referenz als unvollständig markieren. 4096/4097 und lange Fragmente testen. |
| **P3 · bestätigt für Prüfstandssyntax, Diagnose nicht prüfbar** | `tests/test_dash_dl.py:159`, `tests/test_dash_msg.py:144–163`. I trennt den isolierten Syntaxnachweis vom nicht wiederholten E2E-Ergebnis. | Im Integrationsprüfstand die Syntax separat berichtigen und die Diagnosewerte auf beiden Ständen unter denselben Startbedingungen vergleichen. |
| **P0/P1 · widerlegt für die vier ursprünglichen Fixtures** | `src/125-player-hls.js:88–103,128–152`, `src/260-player-schliessen.js:139–146`. B, E und F bestätigen die Wirkung bei erkennbarem ausstehendem Master, Überlauf, Reparse und normalem Rückgabe-Seek. | Rot-/Grünfälle und positive Dekodierung als Regression beibehalten. |

**Abschlussentscheidung: NO-GO.**

| Freigabe | Ergebnis |
|---|---|
| 1. Isolierte interne Entwicklung von P0-B | Zurückgestellt. Vor erneuter Prüfung die nativen Lade- und Rückgabeentscheidungen aus C und den zusätzlichen Positionsabgleich aus F schließen. |
| 2. Vollständige Extension-/Helper-/DASH-E2E-Abnahme | Offen. Die grünen Komponentenläufe decken den realen Kanal nicht vollständig ab. |
| 3. Automatische DASH-Downloads | Bleiben gesperrt. |
| 4. Beta, Release, Android-/Samsung-/Vivaldi-Geräte | Keine Freigabe. |
