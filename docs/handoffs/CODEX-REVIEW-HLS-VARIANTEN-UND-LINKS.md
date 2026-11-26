# Kadri · Unabhängiges Review der HLS- und Linkkorrekturen

**NO-GO für den Beginn von P0-B.** Der neue Playlist-Loader verhindert den im Vorreview gemessenen Variantenabruf. Wenn jedoch sämtliche Varianten gesperrt sind, kann Kadri das pausierte Originalvideo starten. Im lokalen Chromium ging dadurch ein neuer Netzwerkrequest an eine bekannte und weiterhin als MPD ausgelieferte Variante. Zwei weitere Lebensdauerfehler betreffen das Teilen aus einem iframe und die verzögerte Wiederaufnahme nach dem Schließen. Die DASH-Dispatchersperre hielt in den Regressionen.

## A. Stände und Einzeldiffs

| Geprüfter Gegenstand | SHA |
|---|---|
| Produktbasis | bc830c8958b87c6b07011aaaaa35b75d9d182151 |
| Letzter unabhängiger Bericht, separater direkter Nachfolger dieser Basis | 0ce2149c5c3067e38105bae2fb8efaf30c16edc1 |
| HLS-Korrektur, einziger Parent ist die Produktbasis | c247843ddad3e781666521dd7c3c8ae192d29cbf |
| Linkkorrektur, einziger Parent ist die HLS-Korrektur, Remote fix/p0a-hls-variant-guard | 0cfe56c4571415c0008d6c49c931a94d00523873 |
| Helper, lokaler und veröffentlichter Referenzstand | 6e553fcb82b437ce0be487233dd35f41958bade6 |
| Kadri main / Helper main auf GitHub | cd00ded7d68b3d2e8af9d2724cee03e7d351f091 / bb8a42d83eac108c098600e50a20208446134e65 |

Beide Hauptbranches stimmen mit dem Vorreview überein. Beide Übergabedokumente wurden an ihren jeweiligen Commits vollständig gelesen. Der HLS-Diff betrifft fünf Player-Module und einen neuen Prüfer. Der Link-Diff betrifft sieben src-Module, die Ergebnisvalidierung im Chromium-Hintergrund, zwei vorhandene Node-Prüfer, einen neuen Browserprüfer und Sols Bericht. Der kombinierte Diff ist für Browsermanifeste, Helper-Kanal, Lieferworkflows, Signierung, P4-/WASM-/Harness-Pins, Vendor und Buildwerkzeuge leer. Der Helper-Arbeitsbaum war sauber. Alle folgenden Codeverweise gelten am Linkcommit. Ausgeführt wurde mit Debian Chromium 156.0.8078.79, Playwright, Node und lokalen synthetischen Fixtures in getrennten Arbeitsbäumen.

## B. Loader-Architektur und Bibliothekskompatibilität

vendor/hls.min.js:1 enthält hls.js 1.7.3, SHA-256 a12e7ee1cd64a69dcdb314157e45dafcba705bfb0b1440b7935cb265d374423e. Im gebündelten PlaylistLoader wählt createInternalLoader den Konstruktor aus pLoader oder loader. Die Handler für Manifest, Level, Audio- und Untertiteltrack reichen URL und gegebenenfalls levelOrTrack an diesen Weg. Der gebündelte XHR-Loader ruft beim ersten load seine virtuelle Methode loadInternal auf, sein Retry-Timer ruft sie erneut auf. Der zulässige Zweig der Kadri-Unterklasse delegiert erst nach beiden Prüfungen an die transportöffnende Basismethode (src/125-player-hls.js:12–31).

pLoader ist der vorgesehene Erweiterungspunkt für Playlists. Das Überschreiben von loadInternal, das Lesen von context, callbacks, stats und levelOrTrack sowie die Annahmen zum Levelmodell sind versionsabhängig. Die Prüfung auf das Vorhandensein der Methode (src/170-player-laden.js:142) beweist nicht, dass eine spätere Bibliothek sie vor jedem Transport aufruft. Bei Bibliothekswechsel den tatsächlichen Master-Erstabruf und Retry, Level, Audio und Untertitel für Hauptplayer und Vorschau mit positiven Transportkontrollen und negativen Requestzählern erneut abnehmen.

Die Prüfung schließt die effektive Transport-URL samt Query und, falls vorhanden, die Ausgangsadresse des Tracks bzw. sämtliche Adressen des Levels ein. Relative Varianten liegen hls.js bei der Auswahl aufgelöst vor. Unterschiedliche Querys bleiben separat. Mehrere Adressen im selben Level werden konservativ gemeinsam verworfen, wenn eine gesperrt ist. Ein separater Level bleibt nutzbar. Ein eigener lokaler Alternativhost-Versuch ergab null Requests auf die klassifizierte Variante und dekodierende Wiedergabe mit genau einem verbleibenden Level. Dynamisches Content Steering mit tatsächlicher Pfadumschaltung wurde nicht durchgespielt. Segment-, Schlüssel- und Steuerdatenabrufe sind eigene Bibliothekswege. Ein bereits begonnener Transport sowie interne HTTP-Weiterleitungen lassen sich an diesem Eintrittspunkt nicht vor jedem Hop neu entscheiden.

## C. Wiederholung des ursprünglichen P0

Die unveränderte zusätzliche Chromium-Probe des Vorreviews wurde auf Basis, HLS-Commit und kombiniertem Stand ausgeführt. Nach Dekodierung des lokalen Zwei-Level-Masters wurde die andere Variante über HTTP als MPD gelesen. Nach 44 weiteren Analysen war der Summary-Lookup negativ und die exakte MPD-Identität positiv. Erst danach wurden Klick und neuer Request gezählt. Das LEVEL_LOADING-Ereignis wurde separat am Hauptplayer beobachtet.

| Stand | Qualitätsoption für das MPD | Neues Level-Ereignis beim Menüversuch | Neue Requests an das MPD |
|---|---|---:|---:|
| Basis | vorhanden, manueller Level 0 | 1 | 1 |
| HLS-Korrektur | fehlt | 0 | 0 |
| Kombinierter Produktstand | fehlt | 0 | 0 |

Der Bibliothekspfad wurde zusätzlich unter Umgehung der Menüanzeige durch normale Levelsteuerung geprüft (D). Der neue P0 in F tritt erst beim anschließenden Wechsel aus hls.js heraus auf.

## D. Manuelle, automatische und verzögerte Wahl

src/190-player-menues.js:52–71 filtert Level beim Aufbau. Der Klick prüft Playerinstanz, Master und das gehaltene Levelobjekt erneut und ermittelt seinen aktuellen Index. Ein vor Klassifikation geöffneter Eintrag sendete keinen neuen Request. Automatische sowie zeitversetzte Wahl erzeugten auf dem Fix jeweils **ein LEVEL_LOADING, null Requests**. Auf der Basis erreichte jeweils ein Request das Ziel. Die Startwahl, erneutes Öffnen und eine neue Medien-Epoche nach zwischenzeitlicher MP4 hielten das Veto aufrecht. Dieselbe Pfadstruktur mit einer anderen, erlaubten Query ließ sich manuell laden und dekodieren. Zurück im Automatikmodus wurde die andere zulässige Stufe erreicht. Der Test setzt die Levelwahl deterministisch; eine ABR-Anpassung allein durch wechselnde Netzbandbreite wurde nicht gemessen.

## E. Fehlerbehandlung, Recovery und Position

Vor dem ersten Start entfernt pruneHlsLevels unzulässige Level in absteigender Indexreihenfolge. Ein einziges erlaubtes Level genügt. Zur Laufzeit stoppt recoverHlsLevel die Instanz, entfernt den betroffenen und weitere unzulässige Level und setzt Start-/Ladelevel und Wiedergabeposition neu (src/125-player-hls.js:5–10,34–46). Bei null Sekunden wird die Startautomatik mit -1 verwendet. Bei fehlender Alternative fällt die Startprüfung an tryNext; bei späterer Ablehnung geht der Fehler an hls.js. Im Vier-Modi-Versuch lief die Medienzeit nach der Auswahl jeweils um mehr als 0,1 Sekunden weiter. Exakte Kontinuität von Audio und Position unter konkurrierenden Fehlern ist damit nicht bewiesen.

Der Guard legt die Ablehnung als Microtask an. Sie prüft Kontext, Callbackobjekt und Token. abort entwertet das Token. Zerstörte Loader verlieren im Vendorcode Kontext und Callbacks. Entweder übernimmt die aktive Recovery oder der Loader meldet lokal 403. Ein Bibliotheksfehler einer zulässigen Adresse läuft weiterhin über den Originalloader. Beim echten 503 des bereits laufenden Masterabrufs und zwischenzeitlicher MPD-Klassifikation gab es auf der Basis einen weiteren Request und auf dem Fix keinen. Im geprüften Einzel- und Wiederöffnungsfall zeigte sich keine Retry-Schleife. Ein Langzeitnachweis für parallele Audio-/Level-Fehler oder für genau einen Callback bei jeder möglichen Zerstörungsreihenfolge liegt nicht vor. Inaktive Instanzen unterdrücken eine überholte Recovery.

## F. Vorschau, Spuren, nativer Rückfall und Rückgabe

Hauptplayer und Vorschau konfigurieren getrennte Instanzen mit autoStartLoad false und eigenem pLoader (src/170-player-laden.js:143–168, src/230-player-vorschau.js:86–101). Die Vorschau dekodierte unter Ausschluss der gesperrten Stufe. Je null neue Abrufe für bekannte MPD-Adressen im Audio- und Untertitelpfad. In einer separaten Positivkontrolle der hls3-Fixture wurden beide zulässigen Trackplaylists, ein Audiofragment und die Untertiteldatei angefordert, während das Bild dekodierte. Das misst keine hörbare Audioqualität oder korrekte Textdarstellung.

**Bestätigter P0 am Übergang zu Capture.** Für den isolierten Komponentenversuch diente dieselbe lokale Zwei-Varianten-Fixture wie in C. Beide Varianten wurden im wirklichen Klassifikationspfad als MPD registriert, ihre Summary-Einträge verdrängt und bei der späteren Netzabfrage MPD-Bytes ausgeliefert. Das originale Video war mit dem erlaubten Master als Quelle pausiert, preload war none. Vor Öffnen des Players lagen die beiden Requestzähler bei null. Der gesicherte hls.js-Weg verwarf sämtliche Level. Kadri ging in Capture und rief **play am pausierten Original** auf, während beide MPD-Identitäten bekannt waren. Chromium meldete für natives HLS „maybe“.

| Kontrollierter Lauf | Neue Variantenrequests (niedrig / hoch) | Beobachtung |
|---|---:|---|
| Beide Varianten weiterhin MPD, regulärer Play-Aufruf | **1 / 0** | Capture aktiv, MPD nicht dekodiert |
| Gleiche Fixture und Auswahlen, nur Original-play am Messpunkt ohne Wirkung | **0 / 0** | Gleicher Play-Versuch, kein Variantenrequest |
| Separater Lauf mit derselben negativen Identität, danach reguläre HLS-Antwortbytes | 1 / 1 | Original dekodierte, Zeit über 1 s |

Die Kontrollantwort mit HLS belegt die grundsätzliche Funktionsfähigkeit der Wiedergabe. Schon der erste Lauf erfüllt den P0-Beweis mit tatsächlicher MPD-Antwort. src/170-player-laden.js:159 gibt bei leerer Auswahl an tryNext zurück. Das Merkmal noNativeHlsStart wird bei :172 nur für den anderen Fall ohne verwendbaren hls.js-Loader gesetzt. Bei :229 und :252 genügt daher die erlaubte Masteradresse für einen neuen Originalstart. Die Entscheidung, direktes natives HLS im eigenen Player auszuschließen, ist angemessen. Sie schützt diesen von Kadri selbst ausgelösten Originalstart nicht. Das passive Spiegeln eines bereits laufenden Videos ist ein getrennter Fall.

**Rückgabe nach dem Schließen.** src/260-player-schliessen.js:109–118 prüft den unmittelbaren und den verzögerten Erststart anhand der dann aktuellen Adresse. Der anschließend geplante Stallwächter prüft bei :4–11 nur Fortschritt und DOM-Verbindung. Im separaten Chromium-Lauf wurde eine echte MP4 im Player dekodiert und der Player mit aktivierter Wiederaufnahme geschlossen. Ein Play-Messpunkt am Original simulierte ausbleibenden Fortschritt. Beim ersten Play war die URL zulässig. Nach Klassifikation derselben URL als MPD folgte nach rund 3,0 Sekunden **ein zweiter Play-Aufruf bei bekannter Ablehnung**. Hier wurde der Aufruf gemessen, keine zweite Netzwerkübertragung behauptet. Auch eine neu eröffnete Playerinstanz oder eine neue Epoche wird in diesem Timer nicht abgeglichen. Der reguläre HLS-Prüfer setzt resumeAfterClose ausdrücklich auf false.

## G. P2-Linkfreigabe, Relay und Herkunft

Ein ausdrücklich ausgewählter Beitragslink oder die lokale Dokumentadresse erhält einen festen Linkprüfer (src/270-links-teilen.js:226–252, src/105-download-knopf.js:203–209, src/180-player-bedienung.js:588–619). Er prüft gültiges HTTP(S), bekannte MPDs, Überlauffilter, Typmerkmale sowie vorhandene Medienquellen. Konkrete Medien behalten mediaOutputFor mit ihrer ursprünglichen Identität. Ein untypisiertes Parent-Ergebnis im älteren Playerpfad erhält weiterhin den Medienprüfer. Das Label ist eine Entscheidung der aufrufenden Produktfunktion. Es authentifiziert keinen Inhalt auf dem Server. src/045-media-source.js:59–72 bindet das Ziel unverändert an den Ursprung und hält ein lokal beobachtetes Veto bis zum Fallback.

Mit 514 Beobachtungen wurden neue gewöhnliche Beitrags- und Dokumentlinks wieder teilbar. Beim lokalen Clipboard-Fallback blieb die eigene Klassifikation wirksam. Ein nach Überlauf erkanntes und aus der Analyse verdrängtes MPD mit beitragsähnlichem Pfad erreichte keine Ausgabe. Die Frame-Komponente zeigte einen Aufruf bei Doppeltipp, keine verspätete Ausgabe nach beobachtetem Ersetzen/Navigieren und keine Kopie nach Entfernen des Frames. Ein neuer Seitenaufruf wurde in den Prüfungen mit frischem Kontext bedient. Der explizite Positivnachweis für einen neu registrierten fremdherkunftigen Frame nach Navigation steht aus.

**Bestätigter Verlust des Ursprungswissens bei der Übergabe.** Der Frame sendet bei erfolgreicher Prüfung lediglich Art und URL (src/035-fenster-oberflaeche.js:128–131). chrome/background.js:354–365 lässt share-page als HTTP(S)-Ergebnis bis 8192 Zeichen zu und entfernt Zusatzfelder. Die Zustellung bei :373 ff. adressiert das ausgewählte Frame-/Dokumentpaar. Im Hauptfenster prüft fuiTopOutputContext Verbindung, Dokumentmerkmale und Registrierung; bei :338 wird ein **neuer, im Hauptfenster lebender** Linkprüfer erzeugt. Eine spätere MPD-Klassifikation ausschließlich im weiterhin gültigen Ursprungsdokument erreicht ihn nicht.

Eigene Variation der vorhandenen gleichherkunftigen Frame-Fixture mit unveränderten Produktfunktionen, echter Frame-Antwort und kontrollierter IPC-Zustellung. Das gewöhnliche Beitragsziel wurde nur im Ursprungsframe umklassifiziert. Der Summary-Lookup für die exakte zurückgegebene URL war dort positiv. Gezählt wurden die tatsächlichen Aufrufe an die instrumentierten Share-/Clipboard-Schnittstellen im Hauptfenster.

| Zeitpunkt der Klassifikation im Ursprungsframe | Erwartete Share-/Kopieraufrufe | Gemessen |
|---|---:|---:|
| Nach Erzeugung der Antwort, vor ihrer Zustellung | 0 / 0 | **1 / 1** |
| Nach Share-Aufruf, vor dessen Ablehnung und Kopierfallback | 1 / 0 | **1 / 1** |
| Positivkontrolle ohne Klassifikation, identische Share-Ablehnung | 1 / 1 | 1 / 1 |

Frame, Dokument und Benutzeraktion können also weiterhin gültig sein, während das konkrete Ziel seine Zulässigkeit verliert. Das ist ein nachgewiesener Fehler an der Komponenten-Ausgabegrenze. Die Browser-IPC war nachgebildet. Es wurden weder Systemzwischenablage noch externe App verwendet.

## H. Überlauffilter und Lastprofile

src/040-quellen-netzwerk.js:329–348 verwendet nach 512 exakten Einträgen ein dokumentlokales Uint8Array mit 8192 Bytes. Drei nicht überlappende 16-Bit-Ausschnitte des SHA-256-Hexwerts ergeben Positionen von 0 bis 65535 (SHA-Implementierung src/030-eingebettete-fenster.js:40). Dadurch passt auch der letzte Index in das Array. Die drei Positionen können zusammenfallen. Gleichmäßig verteilte Hashbits sind für diesen negativen Filter eine sinnvolle Näherung. Keine separate Unabhängigkeitsgarantie wurde vorausgesetzt. Beide tatsächlich beobachteten Adressschlüssel samt Query gehen in die Identitätsverarbeitung ein. Bereits exakt gehaltene Schlüssel bleiben dort. MPD-Suffix und überlange Schlüssel werden auf anderen Zulassungspfaden abgelehnt. Bits werden im Dokument nicht gelöscht; Verdrängung des Analysecaches ändert sie nicht.

Eigene deterministische Messung mit den unveränderten JS-Funktionen für Hash, Eintrag und Lookup, jeweils frischer Zustand, 512 exakte Einträge und anschließend folgende zusätzliche Schlüssel. Prüfmengen waren pro Lauf 10.000 disjunkte gewöhnliche Linkschlüssel mit anderer Query. Keine Fehlablehnung wurde aus einem mathematischen Modell als Messung übernommen.

| Zusätzliche MPD-Schlüssel im Filter | Übersehene eingefügte Schlüssel | Fehlablehnungen / 10.000 andere Links |
|---:|---:|---:|
| 100 | 0 | 0 |
| 1.000 | 0 | 0 |
| 5.000 | 0 | 86 |
| 10.000 | 0 | 490 |
| 30.000 | 0 | 4.184 |

Die Näherung für die Fehlablehnungswahrscheinlichkeit ist (1 − exp(−3n/65536))³. Ein Treffer erzwingt auf dem Seitenlinkpfad eine konservative Ablehnung. Der Speicher wächst nach Allokation nicht weiter, wohl aber die Ablehnungsrate. Das kann sehr lange laufende Dokumente merklich beeinträchtigen. Häufigkeiten aus realer Nutzung liegen nicht vor. Ein Dokumentwechsel setzt den Bestand zurück, eine reine SPA-Navigation nicht. Die Messung charakterisiert den Filter, die Browserprobe mit 514 Manifesten den vollständigen Linkpfad.

## I. Regressionen und Aussagekraft

| Eigener Lauf | Ergebnis |
|---|---|
| Identischer HLS-Prüfer auf Basis / HLS-Commit / Endstand | 3/13 → 13/13 → 13/13 |
| Identischer Linkprüfer auf unmittelbarem Vorgänger / Endstand | 3/11 → 11/11 |
| Dauerhafte Identität / Player-Klassifikation / Redirect-Provenienz / ursprüngliche Gegenproben | 13/13, 8/8, 20/20, 10/10 |
| Chromium DASH: MPD, Gate, Fingerabdruck, Backfill, Alternativen, URL-Parameter, unbekannter Beginn | 61, 122, 30, 23, 12, 32, 18 jeweils vollständig bestanden |
| Node DASH-Dispatcher / Kanal / MP4 / HLS | 104/104, 45/45, 143/143, 97/97 |

Am Endstand ergeben die 13 angegebenen Chromium-Prüfer **373/373**. Die 26 Node-Prüfer tests/*_check.js sowie fünf aus tests/channel (channel_unit, dash_unit, download_unit, download_regression, hls_unit) bestanden. Die Node-Netzschutzprüfer erhielten die erforderlichen Pfadargumente chrome/background.js und firefox/background.js. Die ersten Aufrufe ohne diesen Pflichtparameter brachen vor den Assertions ab. Es wurden 31 eigenständige Node-Programme erfolgreich ausgeführt. Die Chromium-Läufe verwendeten KADRI_CHROMIUM=/usr/bin/chromium und python3 tests/test_<name>.py. Für die Rotläufe wurde nur der spätere Prüfcode in den jeweiligen temporären Vorgängercheckout kopiert.

Der HLS-Prüfer separiert den Fixtureabruf per Header und zählt Chromium-Requests ab dem jeweiligen Messbeginn. Seine positiven Fälle verlangen echte Bilddekodierung, Levelwechsel und Fortschritt; eine Totalsperre besteht sie nicht. Audio-/Untertitelkontrollen zählen die konkrete Playlist. Beim Master-Retry wird die bereits gestartete Antwort tatsächlich mit 503 abgeschlossen. Die beschränkten Wartefenster schließen keine späteren Aktionen außerhalb der Tests aus. Der Frameprüfer verwendet echte gleichherkunftige Dokumente, simulierte Nachrichtenübermittlung und gezählte Browser-API-Aufrufe. Das Entfernen eines Frames in der vorhandenen Fallbackprobe ersetzt nicht die Klassifikation im unveränderten Frame. Die beiden angepassten Node-Bestandstests erweitern Testkontext und Antworttypen, die Prüfungen gegen unzulässige URL-Schemata bleiben bestehen. Die differenzierende Kontrollintervention am Original-play (F) erfolgte nur im Browser-Prüfkontext.

Die vier ursprünglichen Gegenproben blieben an der Produktgrenze gesperrt. Fremde Netzstücke und alte Bindungen erzeugten Diagnosekandidaten. Beide Menüs blieben ohne neues DASH-Angebot, auch bei positiver Vorprüfung. Der separate Dispatcherprüfer verwarf neue Plan-/Startbefehle, erhielt Status und Abbruch und bestätigte das Ausbleiben eines automatischen DASH-Neustarts bei Antwortverlust. MP4/HLS-Verwaltung und die Provenienz in den bestehenden direkten Ausgabeprüfungen hielten. Das frameübergreifende Ergebnis in G begrenzt jede allgemeine Aussage zur asynchronen Ausgabe.

## J. Offene E2E-Nachweise

Die Browserprüfungen laden die Produktmodule mit lokalen Fixtures ohne aktiven Extension-Service-Worker. Zu einer späteren Abnahme gehören ein nachgewiesen laufender Worker, echte Browser-IPC zum gepinnten Desktop-Rust-Harness, die Helper-Verbindung einschließlich Altauftragsverwaltung sowie echte verschachtelte und fremdherkunftige Framezustellung. Zu prüfen sind darin Framewechsel und Umklassifikation während offener Antworten. Android-App-Annahme, tatsächliche Browserdatei und Systemzwischenablage sowie Samsung/Vivaldi mit nativem HLS sind offen. Die lokalen Chromium-Nativrequests sind ein positiver Nachweis für diesen Desktopprüfstand. Eine Geräteabnahme lässt sich daraus nicht ableiten. Es wurden keine Lieferpakete erstellt.

## K. Priorisierte Befunde und Abnahmekriterien

| Priorität und Status | Produktstelle und Wirkung | Minimale Empfehlung |
|---|---|---|
| **P0 · bestätigt** | src/170-player-laden.js:159,172,229,252. Bei vollständig abgewiesenem Variantensatz startet Kadri das pausierte Original. Ein nativer Request an ein bekanntes MPD ist in F gemessen. | Die negative Variantenentscheidung bis Capture und Rückgabe mitführen. Nach dieser Ablehnung nur bereits laufende Wiedergabe spiegeln oder eine unabhängige zulässige Quelle wählen. Für ein pausiertes Original null neue Play-Aufrufe und null Variantenrequests verlangen. Die Positivkontrolle mit einem erlaubten Level muss weiter dekodieren. |
| **P0 · bestätigt an der Ausgabegrenze** | src/035-fenster-oberflaeche.js:131,267–295,338 und src/270-links-teilen.js:243–252. Das Hauptfenster teilt bzw. kopiert eine inzwischen im Ursprungsframe als MPD erkannte Adresse. | Die Aktion bis zum Seiteneffekt beim dokumentgebundenen Prüfer belassen, etwa durch lokale Bestätigung und lokalen Fallback im Ursprungsframe. Andernfalls den ungeprüften Übergabepfad geschlossen halten. Beide Zeitfenster aus G mit echter positiver Linkkontrolle getrennt abnehmen. |
| **P1 · bestätigt für den Play-Aufruf** | src/260-player-schliessen.js:4–11,109–118. Stallwächter startet nach gültiger Erstentscheidung erneut, obwohl die Adresse inzwischen gesperrt ist. | Dieselbe aktuelle Zulassungs-, Element-, Epochen- und Übergabeprüfung unmittelbar vor Seek und Play anwenden. Den Wächter bei überholter Übergabe beenden. Stockende erlaubte MP4 als Positivkontrolle behalten. |
| **P0 · widerlegt für den früheren hls.js-Levelabruf** | src/125-player-hls.js:19–29, src/190-player-menues.js:56–70. Originalprobe sowie alter Menüeintrag, Bibliotheksumschaltung und Retry führten am geprüften Loader zu null neuen verbotenen Requests. | Transportzähler, getrennte HLS-Ereignisse und dekodierende Alternativen als Abnahmekriterien erhalten. |
| **P2 · widerlegt für gewöhnliche lokale Links nach erstem Budgetüberlauf** | src/270-links-teilen.js:234–250. Die unter normaler Filterbelegung freigabefähigen Beitrags- und Dokumentlinks erreichen Share/Clipboard wieder. **P2 · bestätigt als Lastgrenze** bei src/040-quellen-netzwerk.js:341–347; 4.184 Fehlablehnungen unter 10.000 synthetischen Links im höchsten Profil. | Den Lastfall dokumentieren und bei späterer Bewertung lang laufender Dokumente messen; keine positive Medienfreigabe aus einem negativen Filtertreffer ableiten. |
| **P2 · bestätigte Wartungsabhängigkeit** | src/125-player-hls.js:14–24 und vendor/hls.min.js:1. Transport- und Retryprüfung hängen vom internen virtuellen Aufruf der gebündelten Bibliothek ab. | Bei Änderungen des Vendors die Transportprüfungen aus B auf dem tatsächlichen Bundle verpflichtend wiederholen. |

**Entwicklungsentscheidung:** P0-B bleibt bis zur gemeinsamen Prüfung der Restbefunde zurückgestellt. Für die Integration der vollständigen Erweiterungs-/Helper-Kette fehlt die E2E-Abnahme. Die Sperre für automatische DASH-Downloads bleibt aktiv. Beta, Release und Geräteinstallation sind nicht freigegeben.
