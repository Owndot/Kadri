# Unabhängiges technisches und sicherheitsbezogenes Audit von Kadri und Video-Assistent-Helper

24. November 2026 · Stand S4b-7a · Entscheidungsgrundlage für die gemeinsame Prüfung

**Geprüft. Kadri hat in einem lokalen Chromium-Test das Manifest eines vorgeladenen Videos B dem laufenden MP4-Video A zugeordnet.** Die drei DASH-Segmente von B wurden vollständig empfangen und verworfen. Kein Byte davon gelangte in A. Trotzdem ergaben die Produktfunktionen `bound`, ein positives Gate und ein Angebot. Nach Ablauf des Zeitfensters meldete dieselbe Entscheidung `nicht-aktiv`, während die Nachprüfung vor dem Start das Angebot weiterhin akzeptierte. Der Versuch reicht bis zur Angebots- und Startbedingung. Einen falschen Download auf Android haben wir damit nicht beobachtet.

**Entscheidungsempfehlung.** Zuerst die positiven DASH-Entscheidungen absichern. Dokumentweite Netzbeobachtung darf Kandidaten liefern. Ein Downloadangebot braucht eine belastbare Zuordnung zum ausgewählten Element. Für R2 fehlt im heutigen Chromium-Produkt die unabhängige Quelle für die Bytes der ursprünglichen Segmentantwort. Eine neue Berechtigung, größere Zeitfenster oder mehr beobachtete Player lösen diesen Mangel nicht.

## Prüfgrundlage

**Geprüft.** `git ls-remote` für beide Repositories und der lokale Checkout ergaben folgende Stände. Alle Codeverweise in diesem Bericht beziehen sich auf diese Test-SHAs. `K/` bezeichnet die Wurzel von Kadri, `H/` die des Helfers. `J/` steht für `H/app/src/main/java/de/evp/helfer/`.

| Repository | Testbranch | Geprüfter Commit | `main` laut Remote |
|---|---|---|---|
| Owndot/Kadri | `test/s4b-dash` | `14891f1751522486db04f6bc3c055a800e711793` | `cd00ded7d68b3d2e8af9d2724cee03e7d351f091` |
| Owndot/video-assistent-helper | `test/s4b5-dash` | `6e553fcb82b437ce0be487233dd35f41958bade6` | `bb8a42d83eac108c098600e50a20208446134e65` |

`git show -s --format=%P 14891f1` ergibt genau `33c8e6a39d471df48bb0e9830455bac8e93e9af3`. `git diff --name-only 14891f1^ 14891f1` ergibt 20 Markdown-Dateien unter `docs/handoffs/`. Harness-Pin `6e553fc`, P4-Pins `7978a41 / 546af14 / bd5ab29` und beide SHA-256-Summen der vendorten JS-/WASM-Dateien stimmen mit ihren Quellen überein. Belege sind `K/vendor/dash-harness/SOURCE:9`, `K/.github/workflows/p4-test-extension.yml:37` und `K/vendor/kadri-pairing-poc/SOURCE:3`. [Kadri-Basis](https://github.com/Owndot/Kadri/commit/14891f1751522486db04f6bc3c055a800e711793) · [Helfer-Basis](https://github.com/Owndot/video-assistent-helper/commit/6e553fcb82b437ce0be487233dd35f41958bade6)

**Leseschlüssel.** *Geprüft* kennzeichnet einen eigenen Lauf, eine direkt nachvollzogene Codeeigenschaft oder abgerufene CI-Metadaten. *Vermutet* kennzeichnet das erwartete Verhalten außerhalb des geprüften Falls. *Nicht prüfbar* kennzeichnet hier fehlende Laufzeit-, Geräte- oder Normnachweise. Empfehlungen sind Vorschläge für eine spätere Freigabe.

## P0 – falsche Zuordnung oder Datenverlust

### 1. Das laufende Video kann das Manifest einer unabhängigen Vorladung erhalten

**Geprüft · Produkt · Fragen 2 und 3.** Der `PerformanceObserver` liefert dem Fenster URL, Initiator und Zeiten. `dashSee` gleicht die URL mit den bekannten Manifesten ab. Der Treffer enthält Darstellung, Index, Zeiten und gegebenenfalls BaseURL-Auswahl. Ein Element oder ein `SourceBuffer` kommt darin nicht vor. `dashBindingFor` ergänzt die Dauer des ausgewählten Videos und einen booleschen Konkurrenzindikator. Dieser erfasst nur ein weiteres gerade spielendes, nicht beendetes Video mit `blob:`-Quelle. Ein pausiertes Zweitvideo, eine Vorladung ohne Element oder ein im Worker unsichtbarer Hauptfilm sind damit als Verursacher nicht ausgeschlossen. Drei passende Nummern können auch ausschließlich zur Audiospur gehören. `dashObserveFor` trägt das Ergebnis in die Registry des ausgewählten Elements ein. `K/src/040-quellen-netzwerk.js:429`, `:436`, `:544` · `K/src/038-dash-manifest.js:445`, `:487` · `K/src/060-quellen-zuordnung.js:329` · `K/src/065-media-registry.js:227`.

**Gegenprobe A.** Ein echtes Videoelement spielt eine 20-Sekunden-MP4. Dasselbe Dokument liest das öffentliche Test-MPD und lädt drei seiner Videosegmente unabhängig per `fetch`. Ergebnis mit echtem Resource Timing, Registry und Angebotslogik: `clip-a.mp4`, `playing=true`, `duration=20`, fremdes `manifest.mpd`, `liveDecision=bound` und `gate=true`. Die Abspieldauer wurde am Element gemessen. Anhang A enthält den ausgeführten Versuch. Der verwendete Komponentenprüfstand stellt die Helfer-Fähigkeit bereit und ersetzt die Videosuche durch eine leere Liste weiterer Videos. Das entspricht diesem Ein-Video-Fall. Die Übergabe des gelesenen MPD-Texts erfolgt direkt an `notePlaylist`.

**Empfehlung.** Die drei Netztreffer als Kandidat führen. Bei explizit anderer Quelle wie in A das DASH-Angebot sofort sperren. Für Blob-/MSE-Fälle ist zusätzlich positive Evidenz am Element erforderlich. Fehlt sie, die Zuordnung offenlassen. Die Prüfung muss Vorladung ohne zweites Element, eine allein passende Audiospur und zwei Videos mit gleicher Dauer abdecken.

### 2. Die Startprüfung akzeptiert eine inzwischen verlorene Bindung

**Geprüft · Produkt · Fragen 1 und 2.** Die Registry erhöht den Rang einer Zuordnung, ein später mehrdeutiger Befund entwertet den Eintrag nicht. `dashOfferStill` prüft Quelle, Revision, Epoche, URL, Fingerabdruck und Alternative. Bei der frischen Bindungsentscheidung sucht die Funktion jedoch nur nach einem **anderen** gebundenen oder konkurrierenden MPD. Für das gewählte MPD fehlt die Anforderung `state === 'bound'`. Bei einer einzelnen BaseURL gibt `dashOfferOf` das gespeicherte Gate zurück. Vor dem ersten `dashplan` wird sogar nur die Registry-Auswahl aufgelöst. `K/src/065-media-registry.js:84`, `:173`, `:232` · `K/src/040-quellen-netzwerk.js:505` · `K/src/105-download-knopf.js:105`, `:118`, `:347`, `:359`, `:371`.

**Gegenprobe A, zweiter Messpunkt.** Der Clip läuft weiter. Nach Ablauf von `DASH_RECENT`, ohne weitere DASH-Segmente, lautet die frische Entscheidung `nicht-aktiv`. Unmittelbar danach ergibt `dashOfferStill(offer, offer.sel.bind) === true`. Damit ist die widersprüchliche Startbedingung im Produktcode ausgeführt. E2 kann ebenfalls auf den gespeicherten Status zurückgreifen. `K/src/046-dash-ebenen.js:226`.

**Empfehlung.** Für genau das gewählte MPD und Element einen aktuellen positiven Entscheid vor `dashplan`, nach dessen Rückkehr und vor `dashstart` verlangen. Menü und Diagnose sollen denselben Entscheid verwenden. Regression mit offenem Menü, abgelaufener Folge und neu hinzugekommenem zweiten Player. Eine reine Frischeprüfung behebt Befund 1 nicht.

### 3. Die Netzepoche beginnt bis zu 500 ms vor dem beobachteten Medienstart

**Geprüft · Produkt · Frage 2.** Die Registry-Generation und der zeitliche Schnitt für Treffer sind zwei verschiedene Zustände. `dashEpochOf` subtrahiert bei eigenem oder von der Seite gemeldetem `loadstart` 500 ms, begrenzt durch `navAt`. Der Test verlangt dieses Verhalten ausdrücklich. `dashBindDecision` berücksichtigt jede Anfrage mit bekanntem Start ab diesem zurückgesetzten Zeitpunkt. `K/src/060-quellen-zuordnung.js:300`, `:321` · `K/src/038-dash-manifest.js:457` · `K/tests/dash_epoch_check.js:34`.

**Gegenprobe.** Bei `loadstart=10000`, früherer Navigation, Anfragestarts `9600/9700/9800`, Ankünften jeweils 50 ms später, Indizes `0/1/2` und `now=10100` ergibt der echte `dashBindDecision` mit `from=9500` den Zustand `bound/stueckfolge`. Mit `from=10000` ergibt er `ambiguous/keine-treffer`. Alle drei Antworten waren schon vor dem Medienstart vollständig. Die Annahme der Übergabe „Anfragebeginn ≥ Epochenbeginn“ schützt also nicht die tatsächliche Startgrenze.

**Empfehlung.** Vor dem beobachteten Start liegende Abrufe für positive Entscheidungen ausschließen. Ein fehlender oder verspätet beobachteter Start kostet dann gegebenenfalls ein Angebot. Test mit zwei schnellen Medienwechseln, identischen Adressen und sämtlichen Abrufen im Vorfenster ergänzen.

### 4. Die Nummernprüfung akzeptiert Stücke hinter dem Ende des VOD-Plans

**Geprüft · Produkt · Fragen 2 und 8.** Für `$Number$` prüft `dashMatchOne` die Schreibweise und `n >= 0`. Das Planende fehlt. Beim Zeitmodell mit konstanter Dauer genügt ebenfalls ein ganzzahliges Vielfaches. Zudem übernimmt der Matcher bei mehreren Treffern derselben Alternative den ersten Fund. Bei 64 indizierten Darstellungen endet der Aufbau weiterer Darstellungen ohne Kennzeichnung dieser Kürzung als `overflow`. Das beschränkt die Aussagekraft der behaupteten Eindeutigkeit. `K/src/038-dash-manifest.js:169`, `:270`, `:373`, `:397` · `K/src/039-dash-fingerprint.js:880`.

**Gegenprobe B.** `g02-number-duration.mpd` enthält für `v0` fünf Stücke in 20 Sekunden. Das echte Gate liefert `count=5`. Für die synthetischen URL-Schlüssel `00006.m4s` bis `00008.m4s` liefert der echte Matcher die Indizes `[5,6,7]`, der Entscheider anschließend `bound`. Es gab keinen Netzabruf. Dieser Versuch belegt den Nummernfehler. Fehlentscheidungen durch abgeschnittene Darstellungen sind **vermutet**. `K/tests/web/dash/gate/g02-number-duration.mpd:5`.

**Empfehlung.** Nur Mitglieder des tatsächlich expandierten Plans einer eindeutig identifizierten Darstellung zählen. Bei abgeschnittenem Index oder kollidierender Adresse keine positive Evidenz ableiten. Die Beispiele hinter dem Planende als Negativvektoren übernehmen.

### 5. R2 hat keine unabhängige Referenz für die ursprünglichen Netzbytes

**Geprüft · Studie und Produktgrenze · Fragen 3 und 4.** Die Sonde hasht Anhänge. Das Python-Programm hat die Referenzseite vorab aus lokalen Fixture-Dateien aufgebaut. `HASH` ordnet jedem Hash genau einen symbolischen Stücknamen zu. Gleiche Schlüssel überschreiben frühere Einträge. `webRequest` liefert URL, Anfrage-ID, Dokumentbezug und Status, aber keinen Response-Body. Die Option `requestBody` betrifft den ausgehenden Request und hilft hier nicht. Kadris Chrome-Manifest fordert `webRequest` ohnehin nicht an. Der Helfer vergleicht einen Strukturfingerabdruck des MPD. Dieser enthält keine Segmentinhalte. `K/tests/s4b7_webrequest_study.py:19`, `:183` · `K/tests/s4b7/probe/sw.js:25` · `K/chrome/manifest.json:31` · `K/src/039-dash-fingerprint.js:603` · `J/dashdl/DashEngine.java:298`. [Chromium-API, onCompleted](https://developer.chrome.com/docs/extensions/reference/api/webRequest#event-onCompleted)

**Geprüft · zusätzlicher Fehler im Studienverfahren.** `rule_mse` verlangt drei zusammenhängende Klassifikationen auf der Append-Seite. Für einen bestimmten MPD-Kandidaten genügt anschließend **ein einziger** passender Stückname. Ein vollständiger Lauf im Netz, eine erfolgreiche Antwort und ein MPD-Abruf des Kandidaten sind keine Bedingungen. `rule_net` gruppiert seinerseits bereits klassifizierte URL-Pfade nach Szenarionamen. Beide Regeln verwenden Request-Beginn-Ereignisse. Die harten „nie falsch“-Assertions akzeptieren auch jede Enthaltung. `K/tests/s4b7_webrequest_study.py:165`, `:220`, `:235`, `:254`, `:319` · `K/tests/s4b7/probe/sw.js:12`.

**Gegenprobe C.** Drei vorklassifizierte Anhänge `seg:0:1/2/3` derselben MediaSource und nur **ein** Netzereignis für `seg:0:1` des Kandidaten B ergeben `R2 = B`. Ergänzt man dessen zwei weitere Requests, ergibt `R1 = B`, auch wenn kein MPD-Ereignis und kein erfolgreicher Abschluss in den Eingaben stehen. Das sind isolierte Aufrufe der unveränderten Studienfunktionen. Die archivierten 56 Regelprüfungen belegen somit kein allgemeines Verfahren.

| Mögliche Referenz | Aussage und Kosten | Bewertung |
|---|---|---|
| Im Browser die Segmente neu laden | Man erhält Bytes einer zweiten Anfrage. Cache, Cookies, CORS, signierte URLs, Redirects oder dynamische Antworten können das Ergebnis ändern. Zusätzliche Datenmenge und ein sichtbarer Abruf je Kandidat. Schon der MPD-Versuch liest den Body vollständig in den Speicher. `K/tests/s4b7/probe/cs.js:10` | Für den Ursprungsabruf unzureichend. Kein automatisches Nachladen als Bindungskriterium. |
| Helfer hasht erste Stücke bei `dashplan` | Der Kanal könnte einen Digest einer separat geladenen Darstellung authentisch transportieren. Der Helfer verwendet seine eigene Netz- und Zugangspolitik. Ein gleicher Ausschnitt kann zu mehreren MPDs gehören, ein anderer Ausschnitt führt zur Ablehnung. Mehr Daten, Latenz und Empfänger der signierten URL. Heute lädt dieser Planungspfad das MPD. `J/dashdl/DashEngine.java:298`, `J/dashdl/DashFetch.java:33` | Allenfalls begrenzte zusätzliche Inhaltskontrolle nach einer Auswahl. Kein Beleg dafür, welcher ursprüngliche Request das Element speiste. |
| Tatsächliche `fetch`-/XHR-Antwort des Hauptthreads lokal mitlesen | Bei lesbarer, vollständiger Antwort und unveränderter 1:1-Übergabe an MSE sind beide Bytefolgen zugänglich. Endgültige URL, Darstellung, Segmentnummer, Element, Epoche und erfolgreicher Append müssen bis zum Entscheid zusammenbleiben. Bei Teilen, Zusammenfügen oder Transmux entfällt die einfache Gleichheit. Der vorhandene Hook liest ausgewählte **Texte**. `K/chrome/page.js:65`, `:82`, `:103` | Als eng begrenzte Machbarkeitsfrage für kooperative Seiten denkbar. MAIN-Meldungen sind durch die Seite beeinflussbar. Kein unabhängiger Nachweis gegenüber einer fremden Seite und keine allgemeine Worker-Abdeckung. |

**Empfehlung.** Ohne vertrauenswürdige Beobachtung beider Seiten derselben Wiedergabekette bei „ungebunden“ bleiben. R1 allenfalls zur Kandidatensuche verwenden. Ein Vergleich müsste die vollständige Sequenz je Kandidat, erfolgreiche Appends, Zeitordnung, Mehrdeutigkeit und konkurrierende MPDs prüfen. Ein längerer Hash ersetzt die fehlende Herkunft nicht.

### 6. Die Quellensynchronisation kann lokale Arbeit löschen

**Geprüft · Entwicklungswerkzeug · Frage 1.** `K/tools/sync-src.sh:8` prüft lediglich das Quellverzeichnis. Zeile 10 entfernt alle lokalen `src/*.js`, bevor kopiert wird. `comm -23 <(ls src) <(ls ../video-assistent-helper/src)` zeigt am Prüfstand sieben ausschließlich in Kadri vorhandene Module mit den Präfixen `035/038/039/045/046/065/105`. Geänderte gemeinsame Dateien würden ebenso überschrieben. Für versionierte Stände gibt es Git, für ungesicherte lokale Arbeit droht Datenverlust. Der Beleg ist ein lesender Dateivergleich.

**Empfehlung.** Den Standardaufruf vor jeder Löschung abbrechen lassen. Als kleinsten späteren Ersatz eine lesende Differenz oder eine explizite Übernahmeliste vorsehen. Eine Zusammenlegung der Repositories ist dafür nicht nötig.

## P1 – Vertrauensgrenzen, Manifestsemantik und Abnahme

### 7. MAIN-Hooks liefern unter fremder Seitenkontrolle keine authentische Wiedergabebestätigung

**Geprüft · Produkt und separate Sonde · Fragen 3, 5 und 6.** Produktiv meldet `page.js` Manifesttext per DOM-Ereignis. Der Empfänger prüft Typ, Länge und JSON-Form. Der Sender des ursprünglichen `loadstart` wird auf `isTrusted` geprüft, die weitergereichte DOM-Nachricht besitzt keine beglaubigte Herkunft. Eine korrekte `sender.documentId` im Hintergrund bezeichnet das Dokument der Brücke. Sie beglaubigt nicht die Behauptung der Seite über ein Element. Auch der bereits bestehende Rahmenmechanismus mit `ancestorOrigins` und `rid/seq` ordnet eine Menüinteraktion zu, keine Medienbytes. `K/chrome/page.js:32`, `:45` · `K/src/040-quellen-netzwerk.js:402` · `K/src/060-quellen-zuordnung.js:304` · `K/src/030-eingebettete-fenster.js:33` · `K/src/035-fenster-oberflaeche.js:96` · `K/tests/s4b7/probe/cs.js:20`, `sw.js:44`.

**Geprüft.** Die Sonde merkt sich Blob-URLs und MediaSource-IDs. Sie kopiert bei sicherem Kontext den gesamten Append, startet den asynchronen Digest und ruft **danach** die native Methode auf. Eine synchrone Ausnahme des Originals kann also auf einen bereits begonnenen Hash folgen. Auch asynchrone Fehler oder `abort` entwerten die Meldung nicht. Die Probe erfasst weder `appendBufferAsync` noch `changeType`, hat keine Obergrenze für ausstehende Hashjobs und räumt `blobMs` beim Widerruf einer URL nicht auf. FNV-1a im unsicheren Kontext läuft synchron und ist kein kryptografischer Digest. Der gemeldete Wert `hashMs` umfasst die asynchrone Latenz. Er misst weder Bildaussetzer noch Spitzenbelegung. `K/tests/s4b7/probe/main.js:9`, `:18`, `:26`, `:37`. Die archivierte WebRequest-Studie verwendet den eigenen Player, die separate S4a-Matrix auch dash.js und Shaka. Aus beiden folgt keine Kompatibilitätsmessung dieses Hooks mit dash.js, Shaka und hls.js.

**Vermutet.** Große oder parallele Appends erhöhen Speicher- und CPU-Last. Teilsegmente, von hls.js transmuxte Daten, Typwechsel und unterschiedlich gruppierte Appends können Bytegleichheit verhindern. Bereits gebundene native Methoden und von der Seite veränderte Prototypen machen den Hook unvollständig. **Nicht prüfbar** sind Kosten auf Samsung, Vollständigkeit in allen vier Playerfamilien und eine allgemeine Aussage „ohne Wiedergabestörung“.

**Empfehlung.** MAIN-Daten als untrusted behandeln. Für einen separat freizugebenden Versuch wären ein Vergleich mit deaktivierter Sonde, Byte-/Zeitbudgets, Backpressure, flüchtige Daten und unveränderte Rückgabe-/Ausnahmesemantik nötig. Ein Hash dürfte erst nach bestätigtem Append ohne Fehler zählen. Bei Verschlüsselung, unsicherem Kontext, unbekanntem Aufrufweg, Typ- oder Epochenwechsel sowie `MediaSourceHandle` ohne sichtbaren Buffer die Bindung offenlassen. Die Produktprüfung von `ContentProtection` und verschlüsselten Fragmenten beibehalten. `K/src/039-dash-fingerprint.js:584` · `J/dash/DashManifest.java:159` · `J/dashdl/Fmp4Inspect.java:47`, `:164`.

### 8. Dokument-, Rahmen- und Worker-Bezüge lösen das Eigentümerproblem nicht

**Geprüft · Architektur und Testaufbau · Fragen 2, 3 und 6.** Der Produktbeobachter ist an die Resource-Timing-Zeitleiste seines Fensters gebunden. Eine normale Kindfenster-Zeitleiste wird hier nicht zusammengeführt. Allerdings sammelt `allVideos()` ausdrücklich auch Elemente aus lesbaren Blank-/srcdoc-Rahmen. `dashBindingFor` kontrolliert `ownerDocument` nicht. Damit kann eine Bewertung im Elternkontext ein Kind-Element und die Netzliste der Eltern zusammenbringen. Dieser zusätzliche Fehlpfad ist **vermutet**, die Sammlung ist **geprüft** (`K/src/060-quellen-zuordnung.js:385`, `:411`, `:329`). Auch bei einem Element des eigenen Dokuments können andere Akteure Abrufe auf derselben Zeitleiste erzeugen. Ein Cachetreffer liefert dieselbe URL, aber keinen Empfänger. Der Index prüft Pfad, Herkunft und Query, verwendet die finale MPD-Adresse als Basis und unterscheidet umcodierte Queries. Bei Segment-Redirects steht dem Matcher nur der jeweils beobachtete Name zur Verfügung. Die Anwendung kann damit eine Folge übersehen oder eine URL vor der Weiterleitung zählen, ohne den Inhalt der Zielantwort zu kennen. `K/src/040-quellen-netzwerk.js:326`, `:379`, `:544` · `K/src/038-dash-manifest.js:312`, `:373` · `K/tests/test_dash_urlparam.py:75`.

**Geprüft am Studiencode.** Bei `about:blank` erwartet der Test Medienereignisse aus dem Kind und Netzereignisse beim Eltern-Dokument. Für `srcdoc` erwartet er unter den erweiterten Match-Flags ein eigenes Dokument. Nach `document.open/write` prüft er den Verlust der Listener. Service-Worker-Requests ohne nutzbares Dokument, mehrere Videos, identische Segmente und ein Worker-Neustart sind unterschiedliche Fälle. Die Sonde klassifiziert anhand von Fixture-Namen, erfasst nur passend benannte Videoelemente und führt ihre Ringe im RAM. Ein neu gestarteter Player-Worker kann dieselbe Dokument-ID behalten. Ein Neustart des Erweiterungs-Service-Workers kann die flüchtige Vorgeschichte verlieren. `K/tests/s4b7_webrequest_study.py:101`, `:172`, `:286`, `:308`, `:315` · `K/tests/s4b7/probe/sw.js:5`. **Nicht prüfbar** ist die Übertragbarkeit der archivierten Dokument-IDs, Cache-Sichtbarkeit und Uhren auf Vivaldi Android 17. Für Desktop wurden die Entscheidungsregeln isoliert ausgeführt, die vollständige Sonde erreichte hier den eigenen Service Worker nicht.

**Empfehlung.** Fehlende Dokumentidentität, Navigation, Worker-Neustart oder unvollständige Vorgeschichte müssen zur Enthaltung führen. Eltern-Traffic nicht auf ein Kind übertragen. Identische Inhalte oder gemeinsame Werbesegmente können mehreren MPDs gehören, selbst wenn der Hash stimmt. Den Beobachtungsbereich mit `match_origin_as_fallback`, `match_about_blank` oder `webRequest` erst nach einem belegten Nutzen und eigener Freigabe erweitern. Die beiden Manifest-Flags vergrößern den Injektionsbereich, `webRequest` ist eine zusätzliche API-Berechtigung. Update-Warnungen und Verhalten auf dem Zielgerät sind offen. `K/chrome/manifest.json:31` · `K/tests/s4b7/probe/manifest.json:6`.

### 9. Beide Gates lassen unbekannte wesentliche Deskriptoren durch

**Geprüft · Produkt · Fragen 7 und 8.** Das Komponenten-Audit gegen Chromium und Java erfüllt 22/22 Erwartungen für das heutige Verhalten. In sechs der elf Fixtures (`e01/e03/e05/e06/e07/e10`) geben beide Seiten `ok`, wo der Vorschlag die Ablehnung fordert. Der Kern prüft unbekannte EssentialProperty heute vor allem an AdaptationSet und Representation. Die unterstützte UrlQueryInfo-Familie hat einen eigenen Validator. `K/src/039-dash-fingerprint.js:318`, `:555`, `:838` · `J/dash/DashProfile.java:88` · `K/tests/s4b7/essential/vorschlag.tsv:5` · `K/tests/s4b7_essential_audit.py:17`.

**Geprüft am veröffentlichten DASH-IF-Prüfschema.** Das Schema erlaubt EssentialProperty und SupplementalProperty beim MPD. Bei Period führt es SupplementalProperty und Preselection auf. Preselection erbt von RepresentationBaseType und kann daher selbst wesentliche Deskriptoren tragen. Viewpoint kommt als eigener Descriptor vor. Das Schema belegt Positionen. Die normative Verarbeitung sämtlicher Descriptor-Semantiken gemäß ISO/IEC 23009-1 wurde **nicht geprüft**. [DASH-IF-Schema, MPD](https://github.com/Dash-Industry-Forum/DASH-IF-Conformance/blob/59d220bc660767cedf9825036546d2643bc86e2e/to_be_ported/DASH_mpdvalidator/schemas/DASH-MPD.xsd#L118) · [Period](https://github.com/Dash-Industry-Forum/DASH-IF-Conformance/blob/59d220bc660767cedf9825036546d2643bc86e2e/to_be_ported/DASH_mpdvalidator/schemas/DASH-MPD.xsd#L165) · [Preselection](https://github.com/Dash-Industry-Forum/DASH-IF-Conformance/blob/59d220bc660767cedf9825036546d2643bc86e2e/to_be_ported/DASH_mpdvalidator/schemas/DASH-MPD.xsd#L724)

**Empfehlung.** `mpd-essential` für unbekannte globale Anforderungen und konservativ für fehlplatzierte wesentliche Anforderungen im unterstützten DASH-Vokabular verwenden. Ein unbekannter Descriptor an einer einzelnen Representation darf weiterhin nur diese Wahl ausschließen, sofern ein vollständiges, unabhängig verständliches Angebot bleibt. Nicht allein nach lokalem XML-Namen beliebige Erweiterungsnamensräume sperren. Unbekanntes SupplementalProperty grundsätzlich tolerieren, die bewusst unterstützte URL-Parameter-Familie weiterhin in beiden Descriptorarten vollständig validieren. Für Preselection mit gruppierten Komponenten und mehrere Viewpoints eigene Fälle hinzufügen. Wo eine Auswahl von nicht verstandener Gruppierung abhängt, diese Kombination ausschließen. Ein pauschales Verbot aller Viewpoints oder SupplementalProperty wäre durch die Belege nicht begründet.

### 10. Tests decken unterschiedliche Endpunkte ab. Die gemeinsame Geräteabnahme ist offen

| Status | Prüfpfad und tatsächlicher Endpunkt | Konsequenz |
|---|---|---|
| **Geprüft** | `dash-gate/1` enthält 109 Vektoren und 94 MPDs. `diff -qr` der vollständigen Fixture-Verzeichnisse war leer. Chromium lädt die echten JS-Module in ein DOM ohne Erweiterung. Der JVM-Lauf verwendet den Java-Kern. `K/tests/test_dash_gate.py:12`, `:75` · `H/tests/java/dash/run.sh:16` | Der Gleichlauf ist für die Vektoren belegt. Eine identische Fehlentscheidung auf beiden Seiten besteht diesen Test ebenfalls. |
| **Geprüft am Code** | Die Player-Matrix koppelt die ungepackte Desktop-Testfassung mit dem echten ChannelServer und der DashEngine. Nur Fälle mit `do_start` starten einen Auftrag. Der lokale Server erfasst Abrufe, die Prüfung kontrolliert Dateiname/-größe und ausgewählte Hosts. Der Desktop-Helfer setzt `ConcatRemux` und einen lokalen Testspeicher ein. `K/tests/s4a_dash_player_matrix.py:330`, `:482` · `H/tests/java/channel/de/evp/helfer/HarnessDownloads.java:64` · `K/tests/channel/dash_integration_check.js:117` | Echte Integration bis zu den gewählten Downloads und zur Harness-Datei. Die Matrix belegt weder einen auf Android dekodierbaren MP4-Remux noch MediaStore. Die archivierten 339/339 wurden hier nicht erneut ausgeführt. |
| **Geprüft am CI-Dienst** | Helfer am exakten Test-SHA hat drei erfolgreiche Jobs für DASH-Kern, Engine und JVM-Media3-Remux. Für Kadri liefern die Abfragen mit `head_sha=14891f1…` bzw. `33c8e6a…` jeweils null Läufe. Der erfolgreiche manuelle DASH-E2E-Lauf gehört zu `5dd720a`. `K/.github/workflows/dash-e2e.yml:6` · `H/.github/workflows/dash-core.yml:5` | Die grünen Ergebnisse mit ihrem tatsächlichen SHA angeben. [Helfer-Jobs](https://github.com/Owndot/video-assistent-helper/actions/runs/45356922521) · [Kadri-E2E](https://github.com/Owndot/Kadri/actions/runs/45356996007) |
| **Geprüft am Code und CI-Dienst** | Der Android-Instrumentationstest prüft auf dem Gerät u. a. Remux, Veröffentlichung und Dekodierung, ferner verschlüsseltes Init, Neustart und Resume. Im historischen Lauf waren die Emulatorjobs API 26/34 grün, API 29 rot. Im früheren Kadri-CI-Lauf war `helper-channel` rot. `H/app/src/androidTestChanneltest/java/de/evp/helfer/DashDownloadsInstrumentedTest.java:162`, `:217` · `H/DOWNLOADS-P4B.md:169` · `K/.github/workflows/ci.yml:220` | Der frühere Bericht ordnet den API-29-Fehler dem MP4-MediaStore-Pfad zu. Diese konkrete Ursache und einzelne DASH-Teilresultate wurden hier nicht erneut am Emulator reproduziert. [Emulatorjobs](https://github.com/Owndot/video-assistent-helper/actions/runs/45038147609) · [Kadri-Jobs](https://github.com/Owndot/Kadri/actions/runs/45038000557) |
| **Geprüft am Code / nicht prüfbar auf dem Zielgerät** | `tests/s4b7/probe` ist eine eigene Erweiterung mit anderen Rechten und Instrumentierung. `dist/test` öffnet den Shadow DOM. Firefox hat entgegen der pauschalen Übergabe einen echten Selenium-Test für die Netzschutzregeln und einen CI-Job. Eine kombinierte DASH-Helfer-Abnahme auf Firefox oder dem Samsung liegt hier nicht vor. `K/tests/s4b7/probe/manifest.json:3` · `K/tests/common.py:8` · `K/tests/firefox_dnr_scope.py:2` · `K/.github/workflows/ci.yml:204` · `K/tools/build.js:94` | Browser, Variante, getesteten Endpunkt und Geräte-SHA an jedem Nachweis ausweisen. |

**Empfehlung · Frage 9.** Nach der Korrektur der Zuordnung zuerst Negativfälle im Desktop-Produktpfad wiederholen. Eine spätere, separat freizugebende Samsung-Abnahme sollte zwei tatsächlich unterscheidbare Filme, eine nicht angehängte Vorladung, einen Quellenwechsel bei offenem Menü sowie einen echten Remux mit Rücklesen und Dekodieren umfassen. Die historische MediaStore-Störung separat am betroffenen API-Level prüfen.

## P2 – Grenzen der Vorprüfung und Wartbarkeit

### 11. Die unabhängige Helferprüfung ist sinnvoll. Gate-Gleichheit hat einen begrenzten Geltungsbereich

**Geprüft · Produkt · Fragen 1 und 8.** Kadri baut aus dem bereits dekodierten Text ein DOM. Es prüft Zeichenlänge und vorab ein DOCTYPE/ENTITY-Muster. Java prüft empfangene Bytes, striktes UTF-8 und XML-Struktur. Eine Vier-Millionen-Grenze in JS-Zeichen ist keine Vier-Millionen-Byte-Grenze. Der Streamingpfad des Browser-Hooks begrenzt bereits Bytes, der XHR-Textpfad arbeitet mit dekodiertem Text. Kadri hat zudem ein eigenes Budget für kanonische Zeilen. Ein harmloser XML-Kommentar mit dem Literal `<!DOCTYPE` zeigt die unterschiedliche Vorprüfung: JS-Zeile 73 verwirft das Literal auch im Kommentar, Java überspringt Kommentare beim Prescan. `K/src/038-dash-manifest.js:70` · `K/src/039-dash-fingerprint.js:20`, `:959` · `K/chrome/page.js:65`, `:103` · `J/dash/DashXml.java:109`, `:129` · `J/dashdl/DashFetch.java:35`. **Nicht prüfbar aus diesen Tests** ist eine vollständige Parser-Äquivalenz für beliebige MPDs.

**Geprüft.** Der Fingerabdruck entsteht aus kanonisierten Modellfeldern. Der Helfer parst an der finalen MPD-URL, prüft bei mehreren BaseURLs zunächst den Abdruck über alle Alternativen, danach die Auswahl. `BaseSelection` akzeptiert nur begrenzte, geordnete Indizes und kontrolliert Verwendung und Bereich. Die JS-Kanalprüfung lässt bei `alt` zunächst die syntaktische Form zu. Die strengere Semantik bleibt beim Helfer. Bei `dashstart` werden Peer, Bindung und Plan geprüft, bei jedem neuen Versuch das MPD wieder gelesen. Identische Struktur bei ausgetauschten Segmentbytes hat weiterhin denselben MPD-Abdruck. `K/src/039-dash-fingerprint.js:380`, `:603` · `K/channel/channel-session.js:130` · `J/dash/BaseSelection.java:41`, `:67` · `J/ControlCommands.java:294` · `J/dashdl/DashEngine.java:298`, `:376`, `:766`.

**Geprüft.** Annex I wird nur für eine eng validierte Form ausgewertet. Die Query der finalen MPD-Adresse bleibt bei der Adressbildung erhalten, einschließlich Reihenfolge und doppelter Parameter. Das kann bei deklarierten anderen CDN-Zielen auch signierte Querywerte dorthin tragen. Das Fehlen von Cookies macht URLs nicht öffentlich. Bei URL-/Querywechsel kann die Bindung entfallen oder der Abdruck wechseln. `K/src/039-dash-fingerprint.js:308` · `J/dash/DashUrl.java:53` · `J/dash/DashUrlParam.java:143` · `K/tests/test_dash_urlparam.py:75`. Das Netz-Gate bleibt absichtlich strenger als die JS-Vorprüfung für syntaktisch zulässige, lokal gesperrte Ziele. Gegenprobe mit `b14-private-target` und `b15-local-name` in den gemeinsamen Vektoren.

**Empfehlung.** Java als letzte Autorität für Netzwerk, Speicher und Remux beibehalten. Ein gemeinsamer Entscheidungsvertrag mit Grenzfällen für Bytes/Zeichen, gültige XML-Kommentare, endliche Stückfolgen, Query und Auswahl bringt mehr als die Vereinheitlichung beider Laufzeiten. Die Herkunft einer Zuordnung als eigenständige Voraussetzung behandeln.

### 12. Der Kanal schützt den Auftragstransport. Seine Sicherheitsgrenze endet vor dem Videoelement

**Geprüft · Architektur · Fragen 1, 6 und 8.** Der Kanal verwendet feste Loopback-Pfade, begrenzte Records, versiegelte Befehle und geprüfte Antworten. `dashplan` erlaubt eine begrenzte Feldliste und einen optionalen Referer-/UA-Kontext. Der Helfer prüft Version und Felder erneut und verknüpft den Plan mit dem authentisierten Peer. Der Rust-Kern spezifiziert SPAKE2 und Noise KK. Der lokale Kanal-Unit-Test verwendet einen Scheinkern. Eine formale Kryptoprüfung oder erneute Prüfung des nativen Android-Binaries war **nicht prüfbar**. `K/channel/channel-service.js:27` · `K/channel/channel-transport.js:13`, `:38` · `K/channel/channel-session.js:138`, `:240` · `J/ChannelServer.java:138` · `J/ControlCommands.java:294` · `H/poc/pake-channel/core/src/lib.rs:32`.

**Geprüft am Produktcode.** Der Helfer holt das MPD mit `SafeHttpClient`. Cookies und Authenticator sind deaktiviert, Proxy und automatische Redirects ausgeschlossen. DNS-Antworten, Socketziel, verbundener Peer und Redirectziele werden geprüft. IP-/Port- und NAT64-Regeln stehen im Helfer. Ein optionaler Referer ist auf ein begrenztes Format beschränkt. Der DASH-Befehl enthält weder Cookies noch Authorization noch Browser-Request-Bodies. Die DNR-Regel für eigene Extension-Anfragen entfernt Zugangsdaten außerhalb der dafür vorgesehenen Site-Ausnahmen. Für Diagnosen existieren getrennte anonyme und explizit vollständige Ansichten. `J/DashDownloads.java:37` · `J/net/SafeHttpClient.java:88`, `:147`, `:159`, `:283` · `J/net/AddressPolicy.java:94` · `J/net/GuardedSocketFactory.java:71` · `J/net/RequestContext.java:20` · `K/chrome/background.js:145`, `:194` · `K/src/280-diagnose.js:267`. Der MP4-Pfad hat eigene Resume-/MediaStore-Bedingungen, HLS bindet seine Engine an denselben Netzwerkclient und Speicheradapter. `J/dl/DirectDownloads.java:37` · `J/Mp4Downloads.java:220` · `J/HlsDownloads.java:31`.

**Empfehlung.** Netzwerk- und Feldprüfung am Empfänger erhalten. Wegen R2 weder Header/Payloads weiterreichen noch Signaturen oder vollständige URLs protokollieren. Eine gültige Kanalsitzung und `bind={player,gen,rev}` authentisieren Kadris Aussage, nicht deren sachliche Richtigkeit.

### 13. Gemeinsame Zustände erschweren die Prüfung einer einfachen Bedingung

**Geprüft · Produkt · Fragen 1 und 10.** `wc -l` ergibt 1.004 Zeilen für `039`, 634 für `040` und 573 für `105`. Entscheidend ist der konkrete Fehlerpfad: dieselbe Frage nach der Bindung wird aus Netzliste, Registry-Snapshot und einer späteren Teilprüfung beantwortet. `K/src/040-quellen-netzwerk.js:494` · `K/src/046-dash-ebenen.js:193` · `K/src/065-media-registry.js:227` · `K/src/105-download-knopf.js:105`. Schon bestehende hostspezifische Altlogik steht in `K/src/040-quellen-netzwerk.js:50`. Der DASH-Entscheid braucht ihre Erweiterung nicht.

**Empfehlung.** Einen aktuellen Entscheid für Element, Epoche und Kandidat an Registrierung, Menü und Start weiterreichen. Den dokumentierten Zustand „Kandidat“ von der Freigabe eines Downloads unterscheiden. Eine Generalüberholung des Players, ein neuer Kanal oder zusätzliche Codec-Unterstützung haben keine belegte Priorität vor diesem Fehler.

## Lokales Prüfprotokoll

**Geprüft.** Node 24.22.3, Python 3.12.14, Playwright 1.62.0, Chromium 156.0.8078.79, OpenJDK 21.0.13. Die JVM enthält das Compilermodul, aber keinen `javac`-Launcher. Ein temporäres `javac` rief `java -m jdk.compiler/com.sun.tools.javac.Main "$@"` auf. Die Browser-Komponententests nutzten `KADRI_CHROMIUM=/usr/bin/chromium` und den lokalen Testserver. Der verwendete Python-Testtreiber druckt seine Bilanz, deshalb wurden die Ergebniszeilen geprüft.

| Aufruf bzw. Testgruppe | Eigener Befund |
|---|---|
| `node tests/dash_bind_check.js`, `dash_epoch_check.js`, `dash_manifest_model_check.js`, `dash_message_check.js` | 32/32, 13/13, 33/33, 60/60 |
| `node tests/dash_diag_check.js`, `dash_download_diag_check.js`, `media_registry_check.js`, `frame_ui_rid_check.js` | 31, 19/19, 140 und 36/36 Prüfungen bestanden |
| `node tests/channel/dash_unit_check.js` und `node tests/channel/channel_unit_check.js` | 100/100 und 45/45, mit Testgegenstellen |
| `node tests/guard_check.js chrome/background.js` | Schutzregeltests bestanden. Ein vorheriger Aufruf ohne den Pflichtpfad brach vor den Tests mit `ERR_INVALID_ARG_TYPE` ab. |
| `python3 tests/test_dash_gate.py`, `test_dash_fp.py`, `test_dash_urlparam.py` | 122/122, 30/30, 32/32. Der erste Gate-Aufruf scheiterte vorher am gesperrten Loopback-Socket. |
| `HELPER_DIR=../video-assistent-helper python3 tests/s4b7_essential_audit.py` | 22/22 für den Iststand. Der erste Aufruf scheiterte vor den Assertions am gesperrten Socket. |
| `bash tests/java/dash/run.sh` im Helfer | Kern 293/293, Gate 113/113 |
| `python3 tests/test_detect.py` | **Nicht prüfbar.** Die temporäre ungepackte Desktop-Testfassung erreichte den Extension-Service-Worker vor Timeout nicht. Die zwei archivierten HLS-Fehler sind hier weder reproduziert noch widerlegt. Der Test verlangt ausdrücklich `blob:` und hls.js. `K/tests/test_detect.py:12`. |
| `python3 tests/s4b7_webrequest_study.py` | Erster Start scheiterte vor der Messung am belegten gemeinsamen Port 8790. Nach Freigabe des Ports Timeout beim Warten auf den Service Worker der Sonde. Keine aktuelle Vollstudienzahl. Der verwaltete Browser führt eine Extension-Installationsblockliste. |
| Gegenproben A, B und C | Ergebnisse und ausführbare Eingaben im Anhang. A und B nutzen Browser-Produktfunktionen, C prüft ausschließlich den Studienalgorithmus. |
| `node tests/confidential_names_check.js` | **PASS** bei 1.295 getrackten Dateien einschließlich Bericht. Das Skript wendet seine Größen- und Binärfilter an. |

Für `test_detect` wurde ausschließlich die Funktion `write(dir,'chrome',true)` aus `K/tools/build.js:80` für ein temporäres Testverzeichnis benutzt. Beim Vorbereiten scheiterten ein erster Hilfsaufruf am Shebang und eine Syntaxprüfung am gesperrten Unterprozesskanal. Die Testfassung wurde anschließend mit funktionierender Syntaxprüfung erzeugt. Das sind Einrichtungsfehler. Die Timeout-Läufe bleiben offen. Weder der reguläre ZIP-Bau noch ein Lieferworkflow wurde gestartet.

## Reihenfolge für die gemeinsame Entscheidung

1. Die P0-Gegenproben A und B als Entscheidungskriterien akzeptieren. Bis ein belastbarer Elementbezug vorliegt, dokumentweite Evidenz nicht zur Downloadfreigabe heranziehen. Unmittelbare Korrekturkandidaten sind die frische Eigenprüfung, die wirkliche Epochengrenze und die Mitgliedschaft im endlichen Plan.
2. Die Löschgefahr des Synchronisationsskripts unabhängig vom DASH-Pfad beseitigen. Die Deskriptorregeln gezielt mit gemeinsamen Vektoren präzisieren.
3. R1 auf Kandidatensuche begrenzen. Vor einer Entscheidung über R2 zuerst festlegen, welche Beobachtung der ursprünglichen Antwort und des konkreten erfolgreichen Appends unter dem vorgesehenen Vertrauensmodell verfügbar wäre. Bleibt diese Frage offen, bleiben Worker-/Rahmenfreigabe und zusätzliche Berechtigungen offen.
4. Danach gezielte Desktop-Regression und separat freigegebene Vivaldi-/Samsung-Abnahme. Codec-, Container- und Live-Erweiterungen liefern für die hier belegte Verwechslung keinen Nutzen.

Der Prüfauftrag endet mit diesem Bericht. Eine spätere Implementierung braucht einen gesonderten Plan und die Freigabe des Eigentümers.

## Anhang – ausgeführte Gegenproben

Jeden Block vom Kadri-Checkout am geprüften SHA mit `python3` ausführen. A und B benötigen Playwright und `/usr/bin/chromium`, A außerdem ffmpeg und einen freien lokalen Port 8790. C benötigt nur die Python-Standardbibliothek.

### A · Wiedergabe, Vorladen und spätere Startprüfung

```python
from pathlib import Path
import sys, tempfile, subprocess
sys.path.insert(0, 'tests')
from common import B, sync_playwright, shutdown
ns = {}
# Vorhandener isolierter Komponentenprüfstand, ohne seine Testfälle zu starten.
s = Path('tests/test_dash_urlparam.py').read_text()
exec(s[:s.index('class H(')], ns)
def mod(n): return next(Path('src').glob(n + '-*.js')).read_text()
units = (ns['cut'](mod('040'), '  function dashSummaryOf(', '  try {\n    new PerformanceObserver(')
         + mod('045') + mod('065')
         + ns['cut'](mod('105'), '  function dashOfferFor(', '  const DASH_GATE_CODES')
         + ns['cut'](mod('105'), '  function dashOfferStill(', '  // played-Hinweis'))
src = ns['SRC'].replace(ns['EXPORT'], units + ns['EXPORT'] +
    'Object.assign(window.__k,{mediaRegistry,dashObserveFor,selectDashStreams,dashOfferFor,dashOfferStill});')
with tempfile.TemporaryDirectory() as d, sync_playwright() as pw:
    clip = Path(d) / 'clip.mp4'
    subprocess.run(['ffmpeg','-loglevel','error','-stream_loop','-1','-i','tests/web/clip.mp4',
                    '-t','20','-c','copy','-movflags','+faststart',str(clip)], check=True)
    br = pw.chromium.launch(executable_path='/usr/bin/chromium')
    pg = br.new_page()
    pg.goto(B)
    pg.set_content('<video id="v" muted loop></video>')
    pg.route('**/clip-a.mp4', lambda r: r.fulfill(path=str(clip), content_type='video/mp4'))
    pg.add_script_tag(content=src)
    pg.evaluate("async () => { v.src='/clip-a.mp4'; await v.play() }")
    pg.evaluate("""async () => {
        const dir = '/public/s3d-dash/', r = await fetch(dir+'manifest.mpd');
        __k.notePlaylist(r.url,r.url,await r.text());
        for (const n of ['00001','00002','00003'])
            await (await fetch(dir+'chunk-0-'+n+'.m4s')).arrayBuffer();
    }""")
    pg.wait_for_function("Object.values(__k.dashBindingFor(v).res).some(r=>r.state==='bound')")
    print(pg.evaluate("""() => {
        const k=__k, ctx=k.mediaRegistry.contextFor(v);
        k.dashObserveFor(v,ctx);
        const opts=k.selectDashStreams(k.mediaRegistry.snapshot(ctx),{dash:true}).map(x=>({...x,ctx}));
        window.offer=k.dashOfferFor(opts,k.dashFromOf(v),{dash:true}); offer.v=v;
        return {clip:v.currentSrc.split('/').pop(), playing:!v.paused, duration:v.duration,
          manifest:offer.offer.url.split('/').pop(), gate:offer.offer.gate.ok,
          liveDecision:Object.values(k.dashBindingFor(v).res)[0].state};
    }"""))
    pg.wait_for_function("Object.values(__k.dashBindingFor(v).res)[0].reason==='nicht-aktiv'",timeout=30000)
    print(pg.evaluate("""() => ({fresh:Object.values(__k.dashBindingFor(v).res)[0].reason,
          still:__k.dashOfferStill(offer,offer.sel.bind)})"""))
    br.close()
shutdown()
```

### B · Stücknummern hinter dem Planende

```python
from pathlib import Path
from playwright.sync_api import sync_playwright
with sync_playwright() as pw:
    br=pw.chromium.launch(executable_path='/usr/bin/chromium')
    pg=br.new_page()
    for n in ('038','039'):
        pg.add_script_tag(content=next(Path('src').glob(n+'-*.js')).read_text())
    print(pg.evaluate("""t => {
      const url='https://media.example/m.mpd', p=dashParse(t), idx=dashSegmentIndex(p,url);
      const hits=[6,7,8].map((n,i)=>({...dashMatchSegment(idx,'https://media.example/v/v0/'+String(n).padStart(5,'0')+'.m4s'),s:100+i,t:101+i}));
      const g=dashGateFor(t,p,url,null);
      return {count:g.reps[0].count,indices:hits.map(h=>h.idx),state:dashBindDecision({manifests:[{key:'x',hits,checkable:true,duration:20}],now:110,from:50,video:{duration:20}}).x.state};
    }""",Path('tests/web/dash/gate/g02-number-duration.mpd').read_text()))
    br.close()
```

### C · Regeln der Studie ohne Fixture-Server

```python
import ast
from pathlib import Path
p = Path('tests/s4b7_webrequest_study.py')
tree = ast.parse(p.read_text())
tree.body = [n for n in tree.body if isinstance(n, ast.FunctionDef)
             and n.name in {'runs', 'rule_net', 'rule_mse'}]
reqs = [{'doc':'D', 'rid':'1', 'kind':'seg:0:1', 'ts':2, 'scen':'B'}]
scope = dict(REQ=lambda _: reqs, media=lambda _: {('D','v1'):{'t':1,'src':'ms:7'}},
             frames=lambda _: {'D':{'page':'P'}},
             appends=lambda _: {('D',7):[(2,'seg:0:1'),(3,'seg:0:2'),(4,'seg:0:3')]})
exec(compile(tree, str(p), 'exec'), scope)
print('R2',scope['rule_mse'](0))
reqs += [dict(reqs[0],rid=str(i),kind='seg:0:'+str(i)) for i in (2,3)]
print('R1',scope['rule_net'](0))
```
