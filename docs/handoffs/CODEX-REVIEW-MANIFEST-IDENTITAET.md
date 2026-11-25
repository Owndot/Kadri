# Kadri · Unabhängige Nachprüfung der dauerhaften MPD-Identität

**NO-GO für P0-B.** Der ursprünglich gemessene Verlust der MPD-Klassifikation vor der ersten Auswahl ist korrigiert. Der integrierte Player bietet jedoch eine bereits klassifizierte Adresse als HLS-Qualitätsstufe an. Beim Auswählen löste der Hauptplayer einen Level-Ladevorgang und Chromium eine neue Anfrage an diese Adresse aus. Der Hauptstream war eine unabhängige, dekodierbare HLS-Quelle. Der Befund betrifft den im Auftrag ausdrücklich eingeschlossenen Qualitätswechsel. Es wurde kein DASH-Helperauftrag ausgelöst.

## A. Stände, Diff und Umgebung

| Gegenstand | Verifizierter Stand |
|---|---|
| Kadri, fix/p0a-manifest-identity | bc830c8958b87c6b07011aaaaa35b75d9d182151 |
| Direkter Parent B.2 | 7fe954f2484f1e5790c84bc6079aedff19945def |
| Separater NO-GO-Bericht auf demselben Parent | 9455514e74bba58befe617b254db2b85d7f19d9c |
| B.1 → A2 als unmittelbarer Vorgänger von B.1 | cbeac18dcef5cbc2676b30211b46abbb1b6adfbc auf 4c05499de3a54bc0ee977ac7fa0e3a17e978af0f |
| A1 auf Sanierungsplan | cc0c2414a3731935d6e7867584985bf6631feb5c auf 8157f170effd345a36d80d8bc5919ff0e0e0f5ac |
| Helper, test/s4b5-dash, lokal und remote | 6e553fcb82b437ce0be487233dd35f41958bade6 |
| Remote main, Kadri / Helper | cd00ded7d68b3d2e8af9d2724cee03e7d351f091 / bb8a42d83eac108c098600e50a20208446134e65 |

Beide Hauptbranches entsprechen dem letzten Review. Der Helper-Arbeitsbaum ist sauber. Gelesen wurden der vollständige letzte Nachreview an seinem eigenen Commit sowie P0A-MANIFEST-IDENTITAET.md am Fix. Git zeigt gegenüber B.2 sieben Produktmodule (035, 040, 045, 060, 065, 105, 120), zwei Prüfskripte und Sols Bericht. Der Diff enthält keine Änderungen an Browserberechtigungen, Kanal, Signierung, P4-, WASM- oder Harness-Pins, Builds oder Releases. Alle folgenden Zeilen beziehen sich auf den Fix. Separater Dokumentationsworktree und zwei temporäre Prüfworktrees, Debian Chromium 156.0.8078.79, Playwright, lokale HTTP-Fixtures und Node. Messungen am Android-Gerät waren nicht Teil dieser Prüfung.

## B. Identität und Verwendung

Nach akzeptiertem XML-Parsing speichert notePlaylist die beiden unterschiedlichen Schlüssel der Anfrage und der gemeldeten Endadresse, bevor Zusammenfassung, Fingerabdruck und Index berechnet werden (src/040-quellen-netzwerk.js:399–437). dashUrlKey verwendet HTTP(S)-Origin, Pfad und Query ohne Fragment (src/038-dash-manifest.js:215). Eine andere Query bleibt ein anderer Schlüssel. Eine nur hypothetische Redirectadresse erhält kein Veto. Für MPD-Pfade genügt die Suffixprüfung im Zulassungspfad, auch wenn der Analysedatensatz fehlt.

Die positiven und negativen Mengen leben im Inhaltsskript pro Dokument. MPD-Einträge werden bei SPA-, Element- und Epochenwechsel nicht gelöscht. Ein neues Dokument erhält eigene Mengen. Die Liste der letzten Netzwerkquellen, der Elementbestand und Adapterdaten können eine URL weiter enthalten. Der allgemeine Resolver, playerSources sowie die Registry prüfen sie erneut (src/060-quellen-zuordnung.js:465, src/120-player-stil.js:300–305, src/065-media-registry.js:142–177). Auch alte Revisionskennungen und Menüauswahlen durchlaufen weitere Kontext- und Zulassungsprüfungen. Eine bekannte Ablehnung geht beim Neubilden der Top-Level-Liste nicht verloren. Eine zweite Liste, die HLS-Level des bereits laufenden Players, fällt außerhalb dieser Abdeckung (F).

## C. Wiederholung des NO-GO-Falls

Identischer Prüfer tests/test_p0a_manifest_identity.py auf B.2 und Fix, jeweils mit frischem Dokument. Die lokale MPD-Antwort wurde unter HLS-Endung per Fetch gelesen und geparst. Erst nach positivem Summary-Lookup und 44 weiteren MPDs folgten negativer Summary-Lookup, positiver Nachweis im alternativen Bestand, playerSources und openBrowserPlayer. Die echten Resolver und Originalimplementierungen von Hls.loadSource und Video-Setter liefen. Der Prüfer rief auch prevWarm auf. Die folgende Tabelle gibt an, ob die konkrete Adresse den Messpunkt erreichte.

| Adresse | Noch auffindbar alt / neu | Kandidat alt / neu | HLS-Lader alt / neu | Video-Setter alt / neu | Vorschau-Setter alt / neu |
|---|---|---|---|---|---|
| HLS-Endung | ja / ja | ja / nein | ja / nein | nein / nein | nein / nein |
| MP4-Endung | ja / ja | ja / nein | nein / nein | ja / nein | ja / nein |
| endungslos, im Element | ja / ja | ja / nein | nein / nein | ja / nein | ja / nein |

Das MPD blieb nach dem Fix auch aus den gemessenen externen Ausgaben ausgeschlossen (G). Eine unabhängige MP4 erreichte ihren Setter und dekodierte. Allein ein unveränderter Menütext hätte diese Ergebnisse nicht geliefert.

## D. Budget, Lebensdauer und Verhältnismäßigkeit

Eigene Chromium-Grenzprobe mit unterschiedlichen, gleichlautenden Anfrage- und Endschlüsseln je Beobachtung. Die Messung umfasste Tabellenstand, Überlaufbit und Zulassung der jeweiligen Adresse.

| Unterschiedlicher MPD-Schlüssel | 511 | 512 | 513 | 514 |
|---|---:|---:|---:|---:|
| gespeicherte Vetos | 511 | 512 | 512 | 512 |
| Überlauf | nein | nein | ja | ja |
| Adresse zulässig | nein | nein | nein | nein |

Es zählen Schlüssel, nicht Dokumentabrufe. Zwei unterschiedliche Aliase können zwei Plätze verbrauchen. Doppelte Schlüssel und erkennbare MPD-Pfade verbrauchen keine weiteren Vetoplätze. rememberMpdIdentity entfernt **zuerst** eine frühere positive Zulassung. Nach Überlauf nimmt admitMediaIdentity keine neuen Schlüssel mehr auf. Wiederholte Netzbeobachtung lässt deshalb auch ein nicht mehr einzeln speicherbares MPD nach Summary-Verdrängung nicht wieder zu. Mehr als 4096 Zeichen im Schlüssel führen zur Ablehnung, auch unter normalem Budget. Die Schranke von 40 Netzwerkquellen gilt getrennt von 256 positiven Zulassungen. Die neuen Sets sind mengenbegrenzt (maximal 3.145.728 UTF-16-Codeeinheiten Schlüsselmaterial ohne Objektverwaltung); für die gesamte Analyse, WeakRef-Hüllen und Menüs ist das keine Heap-Obergrenze.

Die Zulassungsprüfung verändert vor Überlauf die Reihenfolge der positiven Menge. Im lokalen Komponentenversuch füllten 256 unterschiedliche Aufrufe die Menge, ein zusätzlicher Schlüssel verdrängte den ältesten. 300 weitere Prüfungen dieses einen Schlüssels ließen die Größe bei 256. Wiederholungen allein verdrängen damit keine Serie anderer Einträge, ändern aber, wer bei der nächsten Neuaufnahme der älteste ist. Auch Kandidatenanzeige und Beitragslinks benutzen diese Funktion. Nach Überlauf kann eine früher gültige, mittlerweile verdrängte MP4 deshalb bis zum Dokumentwechsel bei erneuter Auswahl ausfallen. Der vorhandene Prüfer bestätigt diesen Fall. Keine beobachtete automatische Unterbrechung einer bereits dekodierenden MP4 durch das Setzen des Überlaufbits. Die Zeit schritt in der Zusatzprobe weiter. Eine vor Überlauf erfasste HLS wurde in einer zweiten Probe erst danach geöffnet und dekodierte.

Für neue **Medien** ist die konservative Ablehnung bei erschöpftem Budget begründet. Für gewöhnliche Seitenlinks wirkt sie zu breit (G). Ein Dokument mit vielen wechselnden Querys kann den Zustand trotz begrenzter gleichzeitiger Player erreichen. Die Häufigkeit im Alltag, Heap-Spitzen, BFCache und Langzeitlaufzeit wurden nicht vermessen. Eine SPA-Navigation allein erholt den Bestand nicht. Eine echte Dokumentnavigation setzte die Identität im Browserprüfer zurück.

## E. Vertrauensgrenzen und Parsing

src/038-dash-manifest.js:70–79 verwirft unter anderem XML-Fehler, DOCTYPE, falsche Wurzel, Übergröße und mehr als 200.000 Elemente. Die Prüfung auf MPD-Wurzel ist keine vollständige MPD-Schema- oder Profilprüfung. src/040-quellen-netzwerk.js:373,399–420 legt das Identitätsveto vor weiteren Modellgrenzen wie der Periodenzahl an. Eigene kontrollierte Probe mit defektem XML ergab kein Veto, ein wohlgeformtes leeres MPD-Wurzelelement ergab ein Veto. Für ein vorsorgliches Veto kann dies sinnvoll sein. Es belegt weder Medieninhalt noch die Herkunft der Adresse.

Im Erweiterungsmodus übernimmt der DOM-Ereignisempfänger Meldungen aus dem Seitendokument, bis 8 Millionen Zeichen im Umschlag und 4 Millionen Zeichen Manifesttext. Er prüft Datentypen und reicht die gemeldeten Adressen an den Parser weiter (src/040-quellen-netzwerk.js:456–465). Er authentifiziert die Zuordnung der Bytes zu den beiden URLs nicht. Eine gültige negative Klassifikation kann damit auch eine unabhängige Adresse treffen. Mehrere Meldungen können das dokumentweite Budget erschöpfen. Das ist statisch herleitbar; der Grenzwertversuch misst den Produktparser und seine Wirkung, keinen Angriff auf eine Website. Ein positives Downloadrecht entsteht dadurch nicht. Der Schutz vor langen Schlüsseln begrenzt den dauerhaften Identitätsbestand, nicht sämtliche temporären Texte und URL-Kopien im Analysepfad.

## F. Player, Qualitätsmenü und Vorschau

Die Top-Level-Lader prüfen vor dem Laden sowie nach asynchronem Nachladen der HLS-Bibliothek (src/130-player-aufbau.js:35, src/170-player-laden.js:121–162). Native Qualitätsquellen werden beim Wechsel geprüft (src/190-player-menues.js:69–96). Die Vorschau prüft Auswahl und abgeleitete Ladeadresse und prüft erneut beim verzögerten Nachladen (src/230-player-vorschau.js:75–93,255–261). Solche Schutzpunkte können die Initialadresse sichern und dennoch einen vom Player selbst angebotenen HLS-Level übersehen.

**Unabhängige Gegenprobe zum HLS-Qualitätswechsel.** Im Prüfaufbau von tests/test_p0a_manifest_identity.py eine frische Seite mit der lokalen Zwei-Level-Fixture starten und auf dekodiertes Bild warten. Für die konkrete URL der aktuell **anderen** Stufe im kontrollierten Transport die gültige MPD-Fixture liefern. Die empfangenen Bytes mit notePlaylist lesen, 44 Analysen einfügen. Dann das reguläre Qualitätsmenü öffnen und die betroffene Stufe über ihren Höhenwert auswählen. Nach der Klassifikationsanfrage die Chromium-Requests gesondert zählen und am Hauptplayer das HLS-Ereignis LEVEL_LOADING beobachten. Der Hauptstream bleibt dabei eine zulässige Masterliste.

Zwei Durchläufe ergaben jeweils: bekannte MPD-Identität wahr, Zusammenfassung nicht mehr vorhanden, Qualitätsoption vorhanden, manueller Level 0, **ein neuer Request an die exakte MPD-Adresse**. Im zweiten Durchlauf war zusätzlich das Level-Ladeereignis am Hauptplayer für genau diese URL positiv. Damit lässt sich der Abruf von der vorbereitenden Klassifikation und von einer bloßen Vorschau unterscheiden. Der normale Positivtest wechselte bei unabhängigen HLS-Adressen erfolgreich zwischen zwei Stufen.

src/190-player-menues.js:52–65 prüft st.cur, die Masteradresse, und reicht den ausgewählten Index an hls.currentLevel weiter. Der Level hat eine eigene bekannte URL. Die Bibliothek kann sie ohne weiteren Top-Level-Aufruf von Hls.loadSource abrufen. Der nachgewiesene Vorgang ist eine Auswahl und ein Ladeversuch; eine erfolgreiche Dekodierung von MPD-Bytes wurde nicht beobachtet. Weitere interne Abrufe bei automatischem Wechsel oder in der Vorschau sind separat abzusichern, ihr konkreter Ablauf ist hier nicht dynamisch nachgewiesen.

## G. Ausgaben, Redirects, Teilen und Frames

Pfadprüfung über src/045-media-source.js:49–71, src/080-helper-app.js:552–586, src/090-oeffnen-download.js:19–29,67–166, src/105-download-knopf.js:172–211, src/180-player-bedienung.js:562–578,604–655 und src/270-links-teilen.js:233–249. Ursprung, gemeldetes Ziel, Element-/Dokumentkontext und einmal gesetztes Aktionsveto gelten über den asynchronen Vorgang. Ein neues Ziel hebt das Veto des Ursprungs nicht auf. Unbeobachtete Zwischenredirects und spätere eigenständige Abrufe durch Browser oder App bleiben Transportgrenzen.

| Messpunkt nach Verdrängung vor Ausgabe | B.2 | Fix |
|---|---:|---:|
| Auflösung / Intent-Klick / Anhangsprobe | je 1 | je 0 |
| Downloadklicks für Anhang, native Datei und Blob zusammen | 3 | 0 |
| Share / Clipboard | je 1 | je 0 |
| Gewöhnlicher Beitragslink unter normalem Budget erreicht Kopierfallback | ja | ja |

Der Redirectprüfer deckte weiterhin zwei reale lokale Weiterleitungen einer gültigen MP4, nachträgliche Klassifikation eines bekannten Ziels, verspätete Promise-/Blob-Antwort, Elementersatz, altes Menü, Anhang, verzögerte Intent-Navigation und Clipboard ab. Der bekannte Ursprung löste für drei simulierte Zieltypen keinen Auflösungsabruf aus. Für eine neue bereits erkannte Quelle benötigt der Fix kein noch lebendes Auswahlobjekt. In einem tatsächlichen iframe waren im Verdrängungsfall Bestätigung falsch, Intent und Playerladeaufrufe null. Für gültige MP4 erreichte die Frameprobe den Öffnungsaufruf. Frame- und Dokumentzustellung samt Navigation zwischen Bestätigungstipps bleibt ohne Extension-IPC offen.

**Eigene Überlaufkontrolle.** Nach der 514. unterschiedlichen irreführend benannten MPD-Adresse wurde ein neuer gewöhnlicher lokaler Beitragslink an dieselbe Produktfunktion shareLinkTo übergeben wie in der positiven Kontrolle. Gemessen wurden null Share- und null Kopieraufrufe. Der Defaultcallback verwendet mediaOutputFor und damit das Medienbudget. Auch der Framezweig für den ermittelten Beitragslink wendet mediaSourceAllowed an (src/035-fenster-oberflaeche.js:128–132). Die Regression ist für den Share-Einstieg gemessen, für den Frame hier statisch hergeleitet.

## H. Positive MP4-/HLS-Kontrollen

MP4 dekodiert mit breitem Bild und fortschreitender Zeit; HLS unter demselben Pfad mit anderer Query dekodiert vor und nach dem echten Qualitätswechsel. Eine MP4-Ausgabe mit zwei lokalen Redirects erreichte den Intentaufruf. Eine gültige Downloadprobe ergab genau einen Klick. Neue Dokumente konnten wieder Kandidaten aufnehmen. Öffnen einer legitimen MP4 im iframe sowie Teilen/Kopieren eines gewöhnlichen Links gelangen unter normalem Budget. Nach Überlauf lief die bereits aktive MP4 weiter; eine separat vorher zugelassene HLS dekodierte nach dem Öffnen. Bei Redirect, Datei, Share und Frame beziehen sich die Nachweise auf den jeweiligen Ausgabepunkt. Eine auf Android empfangene Datei oder einen OS-Intent belegen sie nicht.

## I. Testqualität, Mutation und Bestand

| Eigener Lauf | Ergebnis |
|---|---|
| Identischer Manifestidentitätsprüfer, B.2 / Fix | 3/13 → 13/13 |
| Fix mit allein ausgelassenem Aufruf rememberMpdIdentity in notePlaylist, temporärer Prüfcheckout | 4/13 |
| B.1-Player / B.2-Redirect / falsches Video B1–B4 | 8/8, 20/20, 10/10 |
| Chromium MPD / Gate / Fingerabdruck | 61/61, 122/122, 30/30 |
| Node DASH-Dispatcher / Kanal / MP4-Verwaltung / HLS-Verwaltung | 104/104, 45/45, 143/143, 97/97 |
| Registry / Manifestmodell / Bindung / Epoche | 140, 35, 32, 13 Prüfungen bestanden |
| Frame-Relay / Frame-Ergebnis / Frame-RID | 28/28, 35/35, 36/36 |
| Quellen-, Playerprioritäts- und Vertraulichkeitsprüfer | bestanden |

Wiederholung mit KADRI_CHROMIUM=/usr/bin/chromium und python3 tests/test_p0a_manifest_identity.py. Der Altcheckout erhielt ausschließlich denselben neuen Prüfer. Die roten Ergebnisse zeigen fachliche Aufrufe, keine Startfehler. Die Mutation macht neun auf dem Fix grüne Fälle rot. Die Speicherprobe des Prüfers misst Summengrenzen nach 524 Beobachtungen, nicht die erste Umschaltung. Deren Nachbarwerte wurden separat geprüft. Die Player-Instrumentierung delegiert an die Originale; die externen Aufrufe werden für die Zählung abgefangen. Keine pauschale Abschwächung im Diff der Bestandstests: Der Falschvideo-Test behält seine bisherigen Assertions und ergänzt drei Fälle. Der HLS-Positivtest klassifiziert lediglich eine andere Masteradresse. Deshalb kann er mit einer ungeprüften Variantenadresse grün bleiben. Nicht jeder von Sol gelistete Zusatzprüfer wurde wiederholt.

A1/A2 blieben an den geprüften Produktgrenzen wirksam: valide DASH-Befehle abgewiesen, bei Antwortverlust kein neuer Start, Status und Abbruch alter Aufträge im Kanalprüfer erhalten. Die vier Gegenproben erzeugten weder neue Planung noch Start. Bei falscher Epoche bzw. ungültigen Nummern war die unterliegende Stückfolge weiterhin positiv, die Registry blieb beim Diagnosekandidaten. Ein erfolgreicher Gate-/Fingerprint-Befund hat keine Downloadfreigabe erzeugt. Vollständige Browser-/Helper-Verbindung und der tatsächliche externe Empfang waren keine Bestandteile dieser Läufe.

## J. Offene Integrationsabnahme

Vor einer späteren Abnahme sind der echte Chromium-Extension-Service-Worker, die Browser-IPC zum gepinnten Rust-Harness und der Helper mit verifizierten Zählern für Planung, Start, Status und Abbruch auszuführen. In der echten Erweiterung zusätzlich Frame-Navigation zwischen den Tipps, konkurrierende Menüs, Clipboard und Downloadmanager mit tatsächlicher Nutzeraktivierung prüfen. Danach separat Samsung/Vivaldi, Android-App-Annahme und endgültige Dateiausgabe abnehmen. Ein neuer Harness-/Gerätelauf und eine Releasepaketierung waren nicht Gegenstand dieser Prüfung. Die Browserkomponenten liefen ohne geladenen Extension-Service-Worker.

## K. Befunde und Abnahmekriterien

| Priorität und Status | Beleg am Fix und Auswirkung | Minimale Empfehlung |
|---|---|---|
| **P0 · bestätigt** | src/190-player-menues.js:52–65, src/170-player-laden.js:144–155. Hauptplayer bietet bekannte MPD-Adresse als HLS-Level an und fordert sie nach Auswahl erneut an. Nachweis F. | Konkrete bekannte Leveladresse bei Erstellung und Nutzung der Option prüfen, ebenso den jeweiligen tatsächlichen Playlist-Ladevorgang bei Alias-, automatischem oder Vorschauwechsel. Den sicheren Master und zulässige Varianten erhalten. Abnahme mit blockierter Variante, null Levelrequests zu ihr und dekodierender unabhängiger Alternative. |
| **P0 · widerlegt für den ursprünglichen Top-Level-Fall** | src/040-quellen-netzwerk.js:329–347,413–437 und src/120-player-stil.js:300–305. Nach Vorverdrängung keine Rückkehr aus Netzliste, Element oder neuer Epoche in die gemessenen Top-Level-Ausgaben. Nachweise C, G, I. | Rot-/Grün-Paar und Mutation als fachliche Regression erhalten. |
| **P2 · bestätigt** | src/270-links-teilen.js:233–245, src/045-media-source.js:59–68, src/035-fenster-oberflaeche.js:130–131. Neuer gewöhnlicher Link nach Überlauf ohne Share oder Kopie. | Für eindeutig als Seiten-/Beitragslink ausgewählte Ziele einen eigenen Prüfkontext verwenden. Direktmedien, uneindeutige Ziele und die verzögerten Ausgaben weiter schützen. Positive Link- und negative Medienkontrolle unter vollem Budget ergänzen. |
| **P2 · bestätigt, Ausmaß im Alltag offen** | src/040-quellen-netzwerk.js:339–347,456–465. Schon Zulassungsabfragen ändern den positiven Bestand. Unbeglaubigte Seitenmeldungen können dokumentweit negative Entscheidungen prägen. Eine leer geparste MPD-Wurzel genügt. | Vor einer Gerätefreigabe echte Langzeitlast und Fehlablehnungen messen. Rein lesende Prüfungen von der Aufnahme erhaltenswerter Medien trennen; dem Nutzer den Budgetgrund kenntlich machen. Ein bestätigtes Veto nie durch positive Dateiendung zurücknehmen. |
| **P3 · nicht vollständig prüfbar** | src/080-helper-app.js:552–586 und src/035-fenster-oberflaeche.js:136–158. Transportzwischenziele, OS-Annahme und echte Dokumentzustellung sind mit Prüfdoubles nicht vollständig beobachtbar. | Die begrenzten Komponentenaussagen beibehalten und die realen Übergänge nach J abnehmen. |

Die interne Weiterarbeit an P0-B bleibt zur gemeinsamen Entscheidung zurückgestellt. Die Sperre für automatische DASH-Downloads bleibt erforderlich. Extension-Integration, Beta, Release und Gerätebetrieb sind nicht freigegeben.
