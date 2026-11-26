# Kadri · Unabhängiges Abschlussreview der drei P0-A-Korrekturen

**NO-GO. P0-A ist noch nicht abgeschlossen.** Die drei Gegenproben des Vorreviews sind auf ihren jeweiligen Vorgängern rot und auf den Korrekturständen grün. Bei der Rückgabe an das pausierte Original bleiben jedoch zwei Wege offen: Schließen vor Eintreffen der Masterantwort und Schließen nach unvollständiger Erfassung eines großen Masters. In beiden Fällen hat Chromium nach dem von Kadri ausgelösten Originalstart eine bereits als MPD bekannte Variantenadresse neu angefordert. Die Frame-Linkkorrektur und die erneute Prüfung des Stallwächters haben ihre ursprünglichen Fehlerfenster geschlossen.

## A. Prüfgrundlage und Liefergrenzen

Die vollständigen Berichte CODEX-REVIEW-HLS-VARIANTEN-UND-LINKS.md und P0A-FALLBACK-FRAME-LIFECYCLE.md wurden an ihren angegebenen Commits geprüft. Jede Zeile der folgenden Produktverweise gilt auf 97ae9b3 und unverändert auf dem Dokumentationskopf b38cd04.

| Stand | Vollständiger Commit | Verifizierte Beziehung |
|---|---|---|
| Produktbasis | 0cfe56c4571415c0008d6c49c931a94d00523873 | Gemeinsamer Ausgangspunkt |
| Vorreview | a981778a09d6b15bbe0094e44e5cca347c16c7d6 | Separater Dokumentationsnachfolger der Basis |
| Capture | b4162f2a9823fbd95b8c02cf4da3e83c2af72fb3 | Einziger Parent ist die Basis |
| Frame | 2bbdc2196b7c42cd1165744e1705a54dc0f77d03 | Einziger Parent ist der Capture-Commit |
| Stallwächter | 97ae9b3a7902b341a747fca029fd16fd3eaacfe2 | Einziger Parent ist der Frame-Commit |
| Branchkopf fix/p0a-fallback-frame-lifecycle | b38cd046b0c088a77e488c12b85abd466b38d176 | Einziger Parent ist der Stallwächter-Commit; nur Claudes Bericht |
| Helper test/s4b5-dash | 6e553fcb82b437ce0be487233dd35f41958bade6 | Lokal und remote identisch, sauberer Arbeitsbaum |

Der erste Einzeldiff ändert src/125, 170, 260 und einen neuen Prüfer. Der zweite betrifft src/020, 035, 045, 105, einen neuen und zwei angepasste Prüfer. Der dritte betrifft src/260 und den Stallwächterprüfer. Der kombinierte Diff ist leer für chrome/, firefox/, channel/, vendor/, tools/, .github/ und package.json. Berechtigungen, Signierung, Releasekonfiguration sowie P4-, WASM- und Harness-Pins wurden durch die geprüften Commits nicht geändert. Remote-main entspricht weiterhin dem Vorreview: Kadri cd00ded7d68b3d2e8af9d2724cee03e7d351f091, Helper bb8a42d83eac108c098600e50a20208446134e65.

## B. Capture, Variantenwissen und native Rückgabe

**Originalbefund.** Im echten Zwei-Varianten-Prüfer wurden die lokalen Varianten über HTTP gelesen, als MPD klassifiziert und mit 44 weiteren Analysen aus dem Summary-Cache verdrängt. Nach Beginn der eigentlichen Aktion zählte die Probe Requests getrennt vom Klassifikationsabruf. Am ursprünglichen Original-play blieb der native Aufruf wirksam. Bei beiden gesperrten Varianten ergaben sich folgende Zähler, jeweils mit aktivierter und deaktivierter Wiedergabefortsetzung nach Schließen:

| Stand | Original-play | Masterrequests | niedrige / hohe Variante | Ergebnis |
|---|---:|---:|---|---|
| Produktbasis | 1 | 2 | 1 / 0 | Capture aktiv |
| Fix | 0 | 1 | 0 / 0 | Player beendet, Original pausiert |

Bei nur einer vorab gesperrten hohen Variante dekodierte die niedrige Variante im eigenen Player. Beim anschließenden Schließen ging der Originalstart von eins auf null zurück, ebenso der Request an die gesperrte hohe Variante. Passives Spiegeln eines bereits laufenden Blob-MP4 blieb mit fortschreitender Zeit und null Originalstarts möglich.

**Was gespeichert wird.** src/125-player-hls.js:52–73 sammelt Level-URI, sämtliche Zeichenketten in den URL-Arrays der Level und die einzelnen Track-URLs aus den übergebenen Audio-/Untertitellisten. Der Master-Schlüssel enthält Herkunft, Pfad und Query ohne Fragment. src/170-player-laden.js:144–162 prüft die aktuelle Player- und HLS-Instanz vor der Aufzeichnung oder Ablehnung. Dadurch verändern überholte Instanzcallbacks den aktuellen Datensatz auf diesem Weg nicht. Der Zustand hängt am jeweiligen Player. Die Prüfung vor einem Capture-Start und vor Wiederaufnahme bei Rückgabe benutzt denselben Variantenprüfer (src/170-player-laden.js:233, src/260-player-schliessen.js:104–105). Eine später eigenständig ausgewählte MP4 wird neu bewertet.

**Zusatzprobe 1 – ausstehende Masterantwort.** Dieselbe lokale Zwei-Level-Fixture, beide Varianten zuvor als MPD erkannt und aus dem Summary-Cache verdrängt, Original pausiert mit preload=none. Der Prüfstand hielt ausschließlich den ersten hls.js-Masterrequest offen. Der Player wurde im geöffneten Zustand über seine normale Schließfunktion geschlossen. Der Zähler für die folgende Tabelle begann unmittelbar vor dem Schließen. Spätere Antworten auf die Variantenadresse enthielten MPD-Bytes.

| Zeitpunkt / Einstellung | Original-play | Neue Masterrequests | Neue Requests niedrig / hoch |
|---|---:|---:|---|
| Vor Masterantwort geschlossen, Wiederaufnahme an | **1** | **1** | **1 / 0** |
| Identischer ausstehender Abruf, Wiederaufnahme aus | 0 | 0 | 0 / 0 |
| Masterantwort vor Schließen zugelassen; beide Varianten gesperrt, Player schließt kontrolliert | 0 | 0 | 0 / 0 |

Die Beobachtung wurde wiederholt. Vor MANIFEST_PARSED fehlt der Eintrag. hlsOrigStartBlocked liefert bei fehlendem Eintrag false, obwohl die beiden MPD-Identitäten im Dokument bereits existieren. Der zweite Masterrequest ist der neue native Abruf nach Rückgabe, kein später gezählter Teil der vorbereitenden Anfrage. Dieser Ablauf braucht weder eine große Liste noch einen Masterwechsel.

**Zusatzprobe 2 – Grenze von 512 Adressen.** Zwei lokal generierte gültige HLS-Master mit 512 bzw. 513 unterscheidbaren Varianten verwendeten dasselbe abspielbare HLS-Material mit verschiedenen Queries und Bandbreiten. Beide Male dekodierte der integrierte Player. Erst danach wurde die letzte Variante über den Klassifikationspfad als MPD gelesen und ihre Zusammenfassung verdrängt. Ab Schließen wurden Original-play, neuer Masterrequest und der Request mit der **exakten Query** der letzten Variante gezählt.

| Level laut hls.js | Gespeicherte Adressen | Letzte Variante als MPD bekannt | Original-play / Master / letzte Variante |
|---:|---:|---|---|
| 512 | 512 | ja | 0 / 0 / 0 |
| 513 | 512 | ja | **1 / 1 / 1** |

Der Fehler liegt vor der nativen Ausgabe. Der integrierte Playlist-Loader blieb aktiv geschützt. Der abgeschnittene Eintrag ist für den nativen Start nicht unterscheidbar von einem Master, dessen vollständige Liste zulässig ist. Dieselbe gemeinsame Grenze gilt für Video, Audio und Untertitel. Ein separater Funktionsversuch mit Level-Aliasen, Audio-URLs und einer Untertitel-URL an Position 513 ergab ebenfalls „Identität bekannt, Originalstart nicht gesperrt“.

**Ersetzen und Leeren.** Ein isolierter Aufruf der drei unveränderten Produktfunktionen ergab nach noteHlsDenial eine Sperre für genau den ersten Master samt Query, keine Sperre für die andere Query, danach wieder eine Freigabe nach noteHlsMaster mit reduzierter Liste für denselben Schlüssel. Das neue Objekt setzt denied auf false und ersetzt den alten Bestand. Dieser beobachtete Zustandsverlust ist von den beiden bestätigten Netzwerkpfaden zu unterscheiden. Ein natürlicher erneuter Parse desselben Masters innerhalb desselben Players mit anschließendem gesperrtem Request wurde in dieser Teilprobe nicht ausgeführt. Ein neuer Player besitzt ohnehin seinen eigenen Bestand. Für später hinzugekommene Content-Steering-Adressen belegt der beim ersten Parsen erfasste Satz keine Vollständigkeit.

## C. iframe-Linkfreigabe bis Share und Clipboard

Der Share-Knopf bildet den Prüfer im Ursprungsframe und öffnet dort ein lokales Bestätigungsblatt. Ein Menü-Pick verbraucht zuerst die aktuelle Auswahl und verlangt die passende Sequenz; bei einem URL-Eintrag erfolgt die Bestätigung ebenfalls im Frame (src/035-fenster-oberflaeche.js:129–155). Das Blatt akzeptiert jeweils nur eine Aktion und nur sein noch aktives DOM-Objekt (src/105-download-knopf.js:539–551). Der Share-/Kopierpfad hält denselben Prüfer über die Ablehnung einer Share-Promise hinweg. Für konkrete Medien bleibt die Medienzulassung erforderlich. Ein ausdrücklich ausgewählter gewöhnlicher Link verwendet die eingeschränkte Seitenlinkprüfung. Der Intent-Eintrag übernimmt die Prüfung seiner eigenen Auswahl.

| Gegenprobe mit Instrumentierung in beiden Dokumenten | Basisverhalten | Gemessen am Endstand |
|---|---|---|
| A: Klassifikation im Ursprungsframe nach Erzeugen der Antwort und vor Zustellung, danach Bestätigung | Hauptfenster gab den Link aus | Null Share-, Clipboard- und Intent-Ausgaben; gilt auch für die Menüfälle Teilen/YTDLnis |
| B: Share bereits begonnen, dann MPD-Erkennung und Ablehnung der offenen Share-Promise | Ein Share und eine unzulässige Kopie oben | Genau ein bereits begonnener Share im Frame, null Kopien dort und oben |
| Positive Beitrag-/Dokumentauswahl | Unterschiedliche Zuständigkeit | Genau ein Share nach echtem Playwright-Klick im Frame, Benutzeraktivierung am API-Aufruf wahr |
| Gültiger Share-Fehler / gültiger YTDLnis-Eintrag | – | Eine Kopie bzw. ein Intentaufruf im Ursprungsframe |
| Doppeltipp / 514 Manifestbeobachtungen | – | Ein Relay und ein Share im Doppeltippfall; gewöhnlicher Link bei Überlauf teilbar |

Untersucht wurden auch Entfernen, Ersetzen und Navigation eines Frames mit offenem Blatt sowie Entfernung während eines ausstehenden Share. Die lokale Kontextprüfung verbindet Dokument, Element, Quellenmerkmale und Registry-Epoche. Ein explizit abgelöstes Dokument wird in src/045-media-source.js:48–71 verworfen. isConnected allein reicht nicht, weil ein Element im alten Dokument noch verbunden sein kann. Die Chromium-Tests stützen die Kombination. Eine browserübergreifende Garantie für defaultView allein ist nicht belegt.

**Hintergrund und Empfänger.** chrome/background.js:354–365 behält die bisherigen URL-Ergebnisarten in der Sanitisierung. Die Zustellung bei :373 ff. ist weiterhin an Frame-ID und Dokument-ID gebunden. Beide Ausgabeaufrufer im Hauptfenster (act und pick) führen Ergebnisse an fuiTopResult; der einzige Verbraucher von r.ext ist fuiTopExt (src/035-fenster-oberflaeche.js:317–325). Er übernimmt nur den Text des Diagnose-Kopierwegs. Für open, share, share-page und ytdlnis erscheint ein Hinweis. Keiner der untersuchten Empfänger öffnet oder teilt die zurückgegebene URL. Die reine Formatzulassung im Hintergrund ergibt damit keinen nachgewiesenen Ausgabepfad.

**Zusätzliche DOM-Komponentenproben.** Ein lokales Hauptdokument und ein iframe unter einem anderen Loopback-Host sowie ein weiterer Lauf mit verschachteltem iframe wurden mit dem Produkt-Meldungseingang im Ziel und echtem Klick geprüft. Beide Male genau ein Share im Ziel mit aktiver Nutzergeste. Die Zustellung an diesen Eingang wurde für die Probe direkt vorgenommen. Ein 90 × 55 CSS-Pixel großer fremdherkunftiger Frame quittierte das Anzeigen des Blatts, der Eintrag war für den normalen Playwright-Klick innerhalb von 3,5 Sekunden nicht bedienbar. Null Ausgaben in diesem Grenzfall. Gemessen wurden echte DOM-Eingaben und instrumentierte API-Aufrufe. Permissions Policy, OS-Share, Android-Intentannahme und die echte Auswahl eines so kleinen Zielrahmens durch das Extension-Relay sind damit nicht abgenommen.

## D. Stallwächter, Schließen und Seek

src/260-player-schliessen.js:95–108 bildet einen monotonen Prüfer je Übergabe. Er vergleicht Übergabeobjekt, aktuellen Player, Element, Quellenkontext, Registry und HLS-Masterentscheidung. Eine beobachtete Ungültigkeit bleibt für den Vorgang bestehen. src/045-media-source.js:48–58 vergleicht src, srcObject und eine beim Erfassen vorhandene currentSrc; origStartGuard vergleicht zusätzlich die aktuell aufgelöste Originaladresse. Eine ursprünglich leere currentSrc wird im gemeinsamen Prüfer nicht pauschal eingefroren. Ein legitim durch den Erststart ausgelöster Epochenwechsel kann den späteren Anstoß konservativ beenden.

Der Wächter prüft bei jedem Sekundentick, vor dem Seek-Zweig und erneut zwischen Seek und Play (src/260-player-schliessen.js:2–19). Ablauf oder Rücknahme der Übergabe, Elementersatz, Quellwechsel, SPA-Kontextwechsel und ein neu geöffneter Player beenden die alte Berechtigung. Alte Timer können bis zum nächsten Tick existieren, die ältere Übergabe darf dann keinen neuen Effekt auslösen. Im Versuch mit zweimaligem Schließen trat genau der erwartete Anstoß des letzten Wächters auf. Die Prüfungen bilden diskrete Abfragen; ein universeller Nachweis für jede Browserereignis-Reihenfolge folgt daraus nicht.

| Messpunkt am Original | Direkter Vorgänger | Endstand |
|---|---|---|
| Nach gültigem Erststart, dann MPD-Erkennung und ausbleibender Fortschritt | Ein verspäteter Seek und ein Play | Null verspätete Seeks und Plays |
| Weiterhin erlaubte stockende MP4 | Ein Seek und ein Play | Ein Seek und ein Play |
| Wechsel des Mediums / SPA / neu geöffneter Player | Alter Anstoß möglich | Kein alter Anstoß |

**Davon getrennte Restlücke beim sofortigen Schließen.** handBack erzeugt may bei :118, gleicht bei hinreichendem Zeitunterschied jedoch schon bei :131–133 die Position des Originals ab. Erst resume bei :136 prüft may. In einer Browserprobe spielte die eigene MP4 bis über 0,8 Sekunden, dann wurde ihre URL als MPD klassifiziert und der Player geschlossen. Am originalen currentTime-Setter wurde **ein Seek trotz bekannter Ablehnung** und am Original **null Play** gemessen. Der Setter delegierte an die Originalimplementierung. Ein zusätzlicher Netzwerkabruf durch diesen Seek wurde nicht nachgewiesen. Dieses Ergebnis betrifft die sofortige Übergabe, nicht den korrigierten Drei-Sekunden-Wächter.

## E. Gemeinsame Bewertung der Lebensdauer

Die Framekorrektur hält die Entscheidung bei dem Dokument, das ihre Gültigkeit aktualisieren kann. Die Stallkorrektur nimmt eine frühere Entscheidung erneut vor dem Effekt auf. Der fehlende Baustein im HLS-Pfad ist die Unterscheidung zwischen „vollständig geprüft“ und „keine Ablehnung im vorhandenen Ausschnitt“. Der dokumentweite MPD-Bestand bleibt bei beiden neuen Gegenproben korrekt. Der native Start hängt aber vom kleineren, nur an dieser Playerinstanz geführten Masterbestand ab. Ein positives DASH-Gate, ein neuer Helperauftrag oder eine fehlgeschlagene Identitätserkennung waren für die Restfehler nicht erforderlich.

handedLast hält außerdem das gesamte letzte Playerobjekt bis zur nächsten Übergabe oder zum Dokumentende stark referenziert (src/260-player-schliessen.js:95,116). Das ist eine einzelne Referenz, kein Nachweis für unbegrenztes Wachstum. Ein Heap-Dauerlauf wurde nicht durchgeführt.

## F. Testqualität und Rot-/Grünvergleiche

Identische neue Prüfdateien wurden jeweils auf dem unmittelbaren Produktvorgänger ausgeführt. Die roten Fälle erreichten fachliche Assertions. Chromium zählte für Capture und Rückgabe reale Requests und Original-play-Aufrufe; für den Stalltest simulierte nur der Original-play-Messpunkt ausbleibenden Fortschritt. Der Frameprüfer verwendet die echte Antwortsanitisierung und Produktfunktionen in beiden Dokumenten, öffnet den Test-Shadow-DOM und instrumentiert Share, Clipboard und Intent. Die IPC ist dort nachgebildet.

| Prüfer | Unmittelbarer Vorgänger | Korrekturstand / unveränderter Endstand |
|---|---:|---:|
| test_p0a_capture_fallback.py | 7/14 | 14/14 |
| test_p0a_frame_share_lifecycle.py | 5/20 | 20/20 |
| test_p1_stall_watch.py | 3/7 | 7/7 |

Die angepassten Bestandsprüfer verlangen jetzt die Ausgabe im richtigen Dokument. Der Frame-Ergebnistest weist vier URL-Ergebnisarten sowohl bei act als auch pick ab. Beim Linkbudgetprüfer verlangt ein neuer Fall eine begonnene zulässige Freigabe im später abgelösten Frame und null folgende Kopien. Positive Kontrollen verhindern, dass eine vollständige Wiedergabe- oder Ausgabesperre genügt. Der Capture-Prüfer klassifiziert in seinen ursprünglichen Negativfällen allerdings vor dem Öffnen, wartet die Analyse ab und verwendet nur zwei Varianten.

| Eigene isolierte Mutation | Messergebnis | Bedeutung |
|---|---|---|
| In hlsOrigStartBlocked nur das gespeicherte denied-Bit ausgewertet, die spätere Prüfung aller aufgezeichneten URLs ausgelassen | Capture **weiterhin 14/14** | Der Prüfer erkennt den Verlust der dynamischen Neubewertung nicht. Der 512er Kontrollfall in B muss als Positivnachweis für die spätere Sperrentscheidung hinzukommen. |
| Beide neuen defaultView-Prüfungen aus dem Ausgabe-/Elementkontext entfernt | Linkbudget **11/12** | Die Kontrolle für den abgelösten Frame unterscheidet den Schutz. |
| Dem Stallwächter einen stets positiven Prüfcallback übergeben | Stall **3/7** | Die Zeit-, Kontext- und Quellenkontrollen unterscheiden den Guard von der ungeprüften Wiederholung. |

Am unveränderten Endstand liefen **16 Chromium-Komponentenprüfer mit 415/415**. Darin enthalten: 13/13 HLS-Playlist-Guard, 12/12 Linkbudget, 13/13 dauerhafte Identität, 8/8 Playerklassifikation, 20/20 Redirect-Provenienz, 10/10 ursprüngliche DASH-Gegenproben. Parser, Gate, Fingerabdruck, Backfill, Alternativen, URL-Parameter und unbekannter Start bestanden mit 61, 122, 30, 23, 12, 32 und 18 Prüfpunkten. Ausgeführt wurden außerdem alle 26 Node-Programme tests/*_check.js und die fünf Kanalprogramme channel_unit, dash_unit, download_unit, download_regression und hls_unit. **31/31 Programme bestanden**, darunter DASH-Dispatcher 104/104, MP4-Verwaltung 143/143 und HLS-Verwaltung 97/97. Aufruf der Browserprüfer mit KADRI_CHROMIUM=/usr/bin/chromium und python3 tests/test_<name>.py. Kein Ergebnis der temporären Mutationen zählt in die 415.

## G. Positive Funktionen und Bestandsschutz

Gültige MP4 und HLS dekodierten. Ein erlaubter Qualitätswechsel erreichte den anderen Level und die Zeit lief weiter. Bei einer verbotenen Variante blieb die andere im integrierten Player abspielbar. Ein legitimer Medienwechsel im selben Element zur MP4 erlaubte einen Originalstart. Erlaubte Rückgabe, passives Capture und der Fallback für einen gültigen Beitragslink blieben funktionsfähig. Unabhängige gewöhnliche Links konnten nach Medienbudgetüberlauf geteilt werden. Nachträglich klassifizierte MPDs erreichten die untersuchten lokalen Frame-Ausgaben nicht.

A1 verweigert neue dashplan-/dashstart-Befehle; Antwortverlust erzeugte im Kanalprüfer keinen automatischen DASH-Neustart. Status und Abbruch vorhandener Aufträge blieben abgedeckt. An der Produktgrenze ergaben alte positive Bindungen und die vier ursprünglichen Gegenproben keine Downloadfreigabe. MPD-Identitäten überlebten die Cacheverdrängung; hls.js hielt den Variantenschutz ein. Die beiden neuen Requestnachweise begrenzen die Zusicherung ausdrücklich für den von Kadri veranlassten **nativen Originalstart**.

## H. Browserkompatibilität

Eigenständig geprüft wurde Debian Chromium 156.0.8078.79 mit nativer HLS-Angabe „maybe“. Chrome for Testing 158 und Firefox standen hier nicht als ausführbare Prüfbrowser bereit. Claudes 158-Lauf ist im Entwicklungsbericht dokumentiert. Die Firefox-Node-Netzschutzprobe testet keine Firefox-DOM-Lebensdauer. Fremdherkunftige und verschachtelte DOM-Ausgaben mit gezählten API-Aufrufen ersetzen weder Permissions-Policy-Prüfungen der Systemfunktionen noch einen Android-Test. Beim kleinen Frame ist eine Bedienbarkeitsprüfung am Gerät weiter offen.

## I. Extension- und Helper-E2E

Für diesen Stand wurde eine ungepackte temporäre Chrome-Testfassung mit der vorhandenen write-Routine samt Syntaxprüfung erstellt. test_basic.py wurde mit dem hiesigen Chromium 156 im Headless-Modus versucht. Der Prüfer brach beim Warten auf das serviceworker-Ereignis vor seinen Assertions ab. Daher kein eigener Nachweis der gemeldeten **7/7 in Chrome for Testing 158**. Der 158-Bericht ist ein Fortschritt für diesen spezifischen Prüfstand.

Den von Claude gemeldeten HTTP-429-Fehler beim Abruf der gepinnten OkHttp-Abhängigkeiten habe ich nicht erneut erzeugt. Der vollständige Rust-/Java-Harness, Extension-IPC zur gepinnten Gegenstelle, MP4-/HLS-Extension-E2E, reale verschachtelte bzw. fremdherkunftige Relay-Zustellung, Android-App-Annahme, tatsächliche Browserdatei und Systemzwischenablage sowie Samsung/Vivaldi bleiben offen. Der fehlende Harness-Nachweis allein müsste eine isolierte Algorithmusentwicklung nicht ausschließen. Hier entscheiden die bestätigten Produktbefunde in B.

## J. Priorisierte Befunde und minimale Empfehlungen

| Priorität, Status | Datei und Zeile, technischer Beleg und Auswirkung | Empfehlung und Abnahmekriterium |
|---|---|---|
| **P0 · bestätigt** | src/125-player-hls.js:69–73, src/170-player-laden.js:158–162, src/260-player-schliessen.js:104–105,136–139. Ohne eingetroffene Masterantwort wird bei Rückgabe trotz bekannter MPD-Variante ein nativer Request ausgelöst. Zähler und Kontrollläufe in B. | Für den von Kadri gestarteten nativen HLS-Originalpfad eine vollständige gültige Masterentscheidung voraussetzen. Bei ausstehender, fehlgeschlagener oder unbekannter Analyse pausiertes Original angehalten lassen. Test mit offenem Master und null Original-play sowie null neuen Master-/Variantenrequests beim Schließen. |
| **P0 · bestätigt** | src/125-player-hls.js:53–59,72–73. Der 513. Schlüssel fehlt ohne Überlaufkennzeichen. Bei späterer MPD-Erkennung der ausgelassenen Variante gab es einen echten nativen Request. Gegenkontrolle mit 512 Schlüsseln in B. | Erfassungsgrenze beibehalten, Unvollständigkeit ausdrücklich speichern und native Übernahme in diesem Zustand verweigern. Dieselbe Vollständigkeitsentscheidung auf Aliase, Audio und Untertitel anwenden. Integrierte erlaubte HLS-Wiedergabe und unabhängige MP4 als Positivkontrollen beibehalten. |
| **P1 · Zustandsverlust bestätigt, Netzwerkfolge beim erneuten Parsen nicht nachgewiesen** | src/125-player-hls.js:57–65. Erneute Aufzeichnung unter identischem Master-Schlüssel ersetzt auch ein früheres Veto. Funktionsfolge und Query-Kontrolle in B. | Ablehnung und Unvollständigkeit für dasselbe Original über die erforderliche Lebensdauer erhalten. Doppeltes Parsen mit verkleinertem Satz und getrennte Query kontrollieren; Neustart über alte bzw. unvollständige Daten ausschließen. |
| **P1 · bestätigt für Seek** | src/260-player-schliessen.js:118,131–137. Der sofortige Positionsabgleich läuft vor der Prüfung. Gemessen: bekannter MPD-Schlüssel, ein originaler Setteraufruf, null Play. | may unmittelbar vor dem Positionsabgleich anwenden. Beim gesperrten Original null Setter- und Play-Aufrufe, bei gültiger zeitversetzter MP4 weiterhin korrekte Rückgabeposition verlangen. |
| **P0 · widerlegt für die beiden ursprünglichen iframe-Zeitfenster** | src/035-fenster-oberflaeche.js:141–155,317–325, src/045-media-source.js:48–71. In beiden Dokumenten null unzulässige Folgeausgaben; nach laufendem Share keine Kopie. | Lokalen Bestätigungstipp und denselben Prüfcallback bis zur letzten Ausgabe erhalten. Gegenproben C als reale Relay-E2E-Abnahme wiederholen. |
| **P1 · widerlegt für den ursprünglichen Stalltimer** | src/260-player-schliessen.js:8–15,96–107. Null späte Seeks/Plays nach Verlust der Freigabe, je eins bei gültiger stockender MP4. | Diese Positiv-/Negativkontrollen und den Test mit neu geöffnetem Player erhalten. |
| **P2 · im lokalen Kleinframe bestätigt** | src/035-fenster-oberflaeche.js:141–145, src/105-download-knopf.js:528–551. 90 × 55 CSS-Pixel: Blatt bestätigt, normaler Klick nicht erreichbar; kein unzulässiger Seiteneffekt. | Kleine tatsächlich unterstützte Framegrößen mit Touch und Skalierung prüfen. Falls eine Freigabe dort nicht bedienbar ist, sicheren, verständlichen Abbruch anbieten. |
| **P3 · Referenzlebensdauer bestätigt, Speicherlast nicht vermessen** | src/260-player-schliessen.js:95,116. Das zuletzt übergebene Playerobjekt bleibt am Dokument erreichbar. | Bei einer späteren Speicherprüfung untersuchen, ob eine kleine Übergabekennung anstelle des vollständigen Zustands genügt. |

## K. Abschlussentscheidung

**NO-GO.** Die weitere isolierte P0-B-Entwicklung bleibt bis zur gemeinsamen Entscheidung nach Behebung der nachgewiesenen nativen Rückgabefehler zurückgestellt. Die vollständige Extension-/Helper-Integration ist nicht abgenommen. Automatische DASH-Downloads bleiben gesperrt. Für Beta, Release und Samsung-Geräte liegt keine Freigabe vor.
