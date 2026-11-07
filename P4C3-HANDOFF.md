# P4c-3 – Übergabe (Kadri + Android-Helfer)

Zentrale Einstiegsstelle für jeden Coding-Agenten (Claude Code, OpenAI Codex, …). Verständlich ohne den früheren Chat.
**Maßgeblich ist der GitHub-Stand, nicht ein Chatverlauf.** Zustände: `TODO / IN_PROGRESS / DONE / BLOCKED / NEEDS_TEST`.
Begriffe in diesem Dokument: *nachgewiesen* (reproduziert oder durch Code eindeutig belegt), *vermutet* (Hypothese,
nicht belegt), *geplant*, *implementiert* (im Code, ggf. ungetestet), *getestet* (mit Testlauf belegt).

Produktion bleibt **UNAPPROVED**. Grüne Tests sind keine Sicherheitsfreigabe.

Stand dieses Dokuments: 2026-11-07. Aktueller Einstieg und Abschluss stehen vor den historischen Abschnitten.

## Neuer Samsung-Befund – Planungs-Timeout und site-a HTTP 412/404 (maßgeblich)

- **DONE – Gerätedaten ausgewertet, ausschließlich abstrahiert dokumentiert:** Der Eigentümer bestätigt
  einen erfolgreichen **Download mit der unmittelbar vorher installierten P4-Version** bei media-regression-b;
  genaue Commit-Zuordnung der Installation noch nicht belegt. Aktueller Versuch: HLS, `hlsplan`,
  `timeout` nach 5 s, Quelle im eigenen Player geladen, Registry-Auswahl aktuell, Beobachtungsalter 4 s.
  Das ist kein nachgewiesener HTTP 404. Private Namen, Domains, Pfade, IDs und Rohdiagnosen werden nicht übernommen.
- **DONE – site-a eingegrenzt:** MP4 720p und 1080p aus dem Seitenadapter, im Player nicht geladen,
  vom Adapter behauptete Qualität/Zuordnung; `failed/http_404`, Phase `mp4-get`, nach 2 s.
  Einmaliger anonymer Browser-GET mit Range 0-0 liefert ebenfalls HTTP 404.
  Die gleichzeitig abgespielte Quelle ist HLS. Alter 3 bzw. 8 s = Registry-Beobachtung, kein Nachweis der URL-Gültigkeit.
- **DONE – ausdrücklicher HLS-Nachtest auf site-a:** anonymisierte Diagnose meldet
  `hlsplan`, `rejected/http_412` nach 1 s, Quelle `hls/master`, `network/segments-loaded`,
  `bound:segments-loaded`, Auswahl aktuell, Beobachtungsalter 10 s. Noch kein Downloadauftrag/Segmentabruf belegt.
  **BLOCKED – Ursache/Fehlerressource:** Haupt- oder nachgelagerte Medienliste unbekannt;
  HTTP 412 belegt eine abgelehnte Vorbedingung, nicht deren konkrete Bedeutung. Keine Behauptung über
  Cookies, Referer, Tokens, DRM oder grundsätzliche Unmöglichkeit aller unabhängigen Abrufe.
- **DONE – gezielter Versionsvergleich:** `ef9a5ed` und `bde39eb` sind für Transport, Adapter und
  Quellenzuordnung/-Registry identisch. Die neue Diagnose hat die 5-s-Grenze nicht eingeführt.
  Das widerlegt nicht den berichteten Erfolg der Vorversion, erklärt aber noch keine Versionsregression.
- **DONE – Timeout reproduziert:** echter verschlüsselter Kanal + unveränderter Helper + drei synthetische
  HTTP-Playlists, jeweils 2,1 s Verzögerung. Produktionstransport scheitert vor der Korrektur nach 5 s;
  Regression 93/94 (nur neue Zeitgrenzenprüfung rot). Kein Zugriff auf reale Medienseiten erforderlich.
- **DONE – enge Kadri-Korrektur, noch nicht ausgeliefert:** ausschließlich validiertes `hlsplan` bekommt
  ein festes Transportprofil mit 25-s-Grenze; Handshake, Start, Status, Abbruch und andere Befehle bleiben bei 5 s.
  Seiten können keine Frist übergeben. Keine neuen Retries, keine Änderungen der Kanalverschlüsselung,
  Quellenprüfung, Request-Header oder Helper-App. Der ursprüngliche langsame Plan gelingt ohne Doppelabruf.
- **DONE – lokale Prüfungen:** Build, Kanal-Unit 45/45 (inkl. Timeout vor Headern/im Antwortkörper und
  Ablehnung fremder Fristfelder), Diagnose 19/19, Download-Unit 116/116, HLS-Unit 69/69,
  Kanal-Integration 74/74, HLS-Integration 98/98. Letztere enthält zusätzlich HTTP 412 bei Haupt- und Medienliste:
  derselbe Planfehler, genau ein fehlgeschlagener GET, keine Credentials, Segmente, Retries oder Veröffentlichung.
- **TODO – bestehende Helper-Grenze:** `PLAN_DEADLINE_MS=20_000` wird vor Listenabrufen/Slot-Warten geprüft;
  ein begonnener Abruf erhält jedoch weiterhin `HlsFetch.MANIFEST_TIMEOUT_MS=30_000`. Somit keine harte
  20-s-Gesamtfrist. Die begrenzte Kadri-Korrektur verspricht keinen Erfolg für Pläne über 25 s und behebt
  keinen Serverstatus 404/412. Keine pauschale Fristerhöhung oder neue APK ohne weiteren Nachweis.
- **NEEDS_TEST – CI/Lieferung/Samsung:** vollständige CI des neuen Quellstands und bestehendes isoliertes
  P4-Paket abwarten; danach nur Erweiterung aktualisieren und media-regression-b erneut herunterladen.
  Keine Deinstallation, APK oder neue Kopplung. Anschließend anonymisierte Diagnose bei weiterem Fehler.
- **Nächster Schritt:** CI abschließen und verifizierte P4-Erweiterung liefern; site-a bleibt für die
  konkrete serverseitige Vorbedingung/fehlende MP4-Ressource **BLOCKED**, ohne Umgehungsversuche.
  Die früheren Paketlinks unten gehören zum Diagnosebuild `bde39eb`, nicht zur neuen Timeoutkorrektur.
  Helper unverändert `862c1d19ea80eefad7b9b341b93a70cde338fa7d` / App `8b906c5`.
  Samsung F1/F2/R1/R2/C1 bleiben bestätigte PASS der Basis; Produktion **UNAPPROVED**, P4B-A10-SIZE rot.

## Aktueller Einstieg – 2026-11-07 (maßgeblich vor den historischen Abschnitten)

- **DONE – Übernahme:** GitHub-PRs und lokale Klone bestätigen Kadri
  `bc36ba9e5be4e772d4c8da2609a79a6b32beb135` auf `feature/c3-helper-mp4` und Helfer
  `862c1d19ea80eefad7b9b341b93a70cde338fa7d` auf `feature/c3-browser-downloads`.
  Anwendungscode des Helfers: `8b906c5`. PR #11/#27 bleiben Draft; Produktion **UNAPPROVED**.
- **DONE – Samsung-Nachtest (Eigentümer bestätigt):** Android 17 / One UI 9, Vivaldi;
  Helfer `8b906c5`, P4 versionCode 6, Kadri P4 TEST `ef9a5ed`.
  **F1 PASS, F2 PASS, R1 HLS-Prozessneustart PASS, R2 MP4-Prozessneustart PASS,
  C1 dauerhafter Nutzerabbruch PASS.** Die älteren offenen F1/F2-/Samsung-Vermerke unten sind historisch.
  TS/fMP4, getrennte/integrale Tonspuren, Qualitätsauswahl, direkter Webseitenknopf,
  Unabhängigkeit vom Player, Netzunterbrechung, Bildschirm aus, Parallelität und Ablehnungen bestätigt.
- **IN_PROGRESS – site-a HTTP 404 (OFFEN):** Wiedergabe im Browser funktioniert, Quelle wird erkannt,
  Auswahl erscheint, danach scheitert der Download mit HTTP 404 (Eigentümer-Bericht).
  Ressource, Downloadtyp und genaue Fehlerphase sind noch **nicht nachgewiesen**.
  Frühere Aussagen im PR-Text über Sitzungsdaten sind **kein Ursachenbeleg für diesen Befund**.
- **DONE – gezielter Diagnosecheck des Ausgangsstands (inzwischen korrigiert):** `105-download-knopf.js` registrierte keine
  `hdlDiagNew`-Diagnose. `080-helper-app.js` übernimmt `reason` nur für `failed`, während HLS
  HTTP 404 als `interrupted` meldet; die Diagnose beendet dort auch ihre Beobachtung.
  `HlsEngine.plan()` prüft neben der Hauptliste nur die **erste** Option (Video-/ggf. Audioliste),
  keine Segmente. `attempt()` lädt Hauptliste und gewählte Medienlisten erneut.
  Qualitätsauswahl belegt daher weder Erreichbarkeit aller Optionen noch der Segmente.
- **TODO – Ursachenprüfung:** Quellwechsel/Alter, Ablauf zwischen Plan und Start, einzelne fehlende
  Medien-/Init-/Segmentressourcen, Redirectziel und MP4-GET/Range sind Hypothesen, keine Diagnose.
  `HlsFetch` nutzt GET ohne Range für neue HLS-Ressourcen; Wiederverwendung prüft Range 0-0 mit
  starkem If-Range. Relative HLS-Adressen werden gegen die finale Antwortadresse aufgelöst;
  Querywerte werden nicht pauschal vererbt. Sicherheitsgrenzen bleiben unverändert.
- **NEEDS_TEST – Samsung-Daten:** vorhandenen Fehler einmal reproduzieren, auf derselben Seite
  Kadri-Erweiterungsmenü → „Diagnose anzeigen“ → **„Anonymisiert kopieren“**.
  Gewählte Qualitätsbezeichnung, Ort der Fehlermeldung und weiterlaufende Wiedergabe ergänzen.
  Keine normale Diagnose, URLs oder Sitzungsdaten weitergeben.
- **Nächster Schritt:** geprüfte P4-Test-Erweiterung aus dem Abschnitt „Aktueller Code-/Paketstand“
  installieren und anonymisierte Samsung-Diagnose auswerten. Die Diagnose-Lücken am direkten Knopf
  und bei `interrupted` sind geschlossen; finale CI ist grün. Synthetische HTTP-Fälle belegen
  allein keine site-a-Ursache. Keine Downloadkorrektur ohne Ursachenbeleg. Keine neue APK.
- **TODO – danach:** MP4-SourceVault instrumentiert prüfen (Samsung R2 ist bereits PASS),
  bytegenaues MP4-Fortsetzen über Prozessende evaluieren, Keystore-/Vault-Lebenszyklus prüfen.
  MP4 startet nach Prozessende weiterhin bei Byte 0 mit ETag-/Längenvergleich.
- **BLOCKED – unveränderte Releasegrenzen:** P4B-A10-SIZE bleibt rot; keine unabhängige
  Sicherheitsfreigabe, keine Merges/Tags/Releases/Produktionssignierung.

### Diagnose-Teilpaket (2026-11-07)

Die folgenden Teilpaket-/Protokoll-/CI-Nachlaufabschnitte protokollieren frühere Zwischenstände.
Für Lieferung, abgeschlossene Tests und den nächsten Schritt gilt „Aktueller Code-/Paketstand“.

- **DONE – Dokumentationscheckpoint:** `6128193` auf den bestehenden Kadri-Branch gepusht.
- **IN_PROGRESS – Kadri-Diagnosekorrektur:** gemeinsames `hdlSourceInfo` für Player und direkten Knopf;
  `hdlDiagNew` auch am direkten Knopf; Ablehnungen vor Auftragsanlage (`hlsplan`/Start), Typ,
  HTTP-Code, Aufruf, Zustand, Quellenbeobachtungsalter und Aktualität der Registry-Auswahl.
  `interrupted` behält den Fehlergrund und wird weiter abgefragt (15-min-Grenze/Seitenlebenszeit).
  MP4-GET und Range werden unterschieden. Vorhandener anonymer MP4-Vergleich bleibt begrenzt;
  HLS macht **keinen** irreführenden Hauptlistenabruf als Ersatz für die unbekannte Fehlerressource.
  Ressourcenanzahl des alten Helfers enthält Init-Dateien, deshalb ausdrücklich nicht als reine
  Segmentzahl bezeichnet. Genaue HLS-Fehlerressource, Redirectkette und Token-Ablauf bleiben unbekannt.
  Keine Änderung an Helper, Auswahl-/Downloadlogik, Retry, Vault, Netzwerkregeln oder Signierung.
- **DONE – lokal geprüft:** Build; `download_diag_check.js` 15/15; derselbe Test gegen `bc36ba9`
  scheitert an „direct MP4 creates a diagnostic without opening the player“ (Regression belegt).
  Download-Unit 116/116, HLS-Unit 69/69, HLS-Integration 25/25 gegen den echten unveränderten
  Helper; Quellen-/Probe-Mutationen 15/15, bestehender Download-Regressionscheck und Helper-Route grün.
- **NEEDS_TEST – neue Browser-Protokollfälle:** MP4 GET/Redirect 404; HLS Medienliste beim Plan,
  Haupt-/Medienliste erst beim Start, Init, erstes/späteres Segment, Redirect auf 404.
  Server erfasst echte Status/Range/fehlende Credentials; Diagnose über „Anonymisiert kopieren“;
  keine Veröffentlichung, Browserwiedergabe bleibt verfügbar. Das sind synthetische Diagnosefälle,
  keine nachgewiesenen site-a-Ursachen.
- **BLOCKED – lokale Browserausführung:** verwaltete Chromium-Policy
  `ExtensionInstallBlocklist: ["*"]` verhindert das Laden der Test-Erweiterung;
  `chrome://extensions` meldet `ERR_BLOCKED_BY_ADMINISTRATOR`. Mit vorinstalliertem Chromium 156
  und projektkonformem Playwright 1.56/Chromium 141 geprüft. Policy wird nicht verändert.
  Ein überlappender lokaler Testversuch traf zusätzlich auf den belegten Fixture-Port 8790;
  diese Startfehler sind **keine** bestandenen oder fehlgeschlagenen Produktprüfungen.
  Vollständige Browserprüfung über bestehende GitHub-CI steht aus.
- **NEEDS_TEST – Samsung:** vorhandene anonymisierte Diagnose angefragt, noch nicht erhalten.
  Danach entscheidet der tatsächliche Downloadtyp, ob die alte APK ausreicht oder zusätzliche
  ressourcengenaue Helper-Diagnose notwendig ist. Eine site-a-Korrektur ist noch nicht behauptet.

### Protokollnachweis ohne Änderung der APK

- **DONE – Kadri `b8eed88`:** Diagnosekorrektur und Browser-Regressionsfälle gepusht;
  CI https://github.com/Owndot/Kadri/actions/runs/42390438197 gestartet, noch kein Endergebnis.
- **DONE – lokale HLS-Integration erweitert, 91/91:** elf gezielte 404-Fälle durch echten
  `ChannelServer`/`SafeHttpClient`/`HlsEngine`: Haupt-/Video-/Audioliste beim Plan; Haupt-/Video-/Audioliste
  erst beim Start; nur zweite Qualität nicht erreichbar; erstes/späteres Video- sowie erstes Audiosegment;
  Segment-Redirect 302 → 404. Tatsächliche GET-Anfragen ohne Range oder Credentials, keine automatischen
  404-Retries, keine Veröffentlichung; nach spätem Fehler bleiben bestätigte Ressourcen gezählt.
  Plan prüft zweite Qualität tatsächlich noch nicht. Fehlerantwort beim Start ist jeweils
  `interrupted/http_404`, `phase` leer: Die fehlende Ressourcenzuordnung ist jetzt auch am Protokoll belegt.
- **DONE – Diagnose-Zeitmessung:** Beginn vor dem Aufruf festhalten, sodass ein langsamer
  Planfehler nicht pauschal als „nach 0 s“ erscheint; Regressionstest mit 8-s-Antwortzeit. Diagnose-Unit 16/16.
- **DONE – weitere Diagnoseprüfung:** ein während `hlsplan` wiedergefundener laufender Auftrag
  darf später nicht als Planfehler beschriftet werden; Test ergänzt, Diagnose-Unit jetzt 17/17.
  Bestehende MP4-Integration lokal 38/38. Protokolltests/Zeitmessung in `4ed2b1b` gepusht,
  CI https://github.com/Owndot/Kadri/actions/runs/42390704798 läuft.
- **BLOCKED – reale 404-Ursache:** ohne Samsung-Diagnose weder tatsächlicher Downloadtyp noch
  betroffene Quelle/Fehlerphase belegbar. Nächster Schritt bleibt die angefragte anonymisierte Diagnose,
  parallel CI-Abschluss und isoliertes Kadri-P4-Testpaket (unveränderte APK, keine neue Kopplung).

### Nachgelagerte Vault-Prüfung (nur lesend, während Gerätedaten fehlen)

- **IN_PROGRESS – Lebenszyklus/Sicherheit:** Code `SourceVault`, `KeystoreSealer`, Einbindung in beide
  Engines gelesen; keine Helper-Änderung, keine Sicherheitsfreigabe. Separate app-private
  `noBackupFilesDir/source-vault/{hls,mp4}`, AAD bindet Kennung/Art/Zeitfenster, Keystore ohne
  Software-Fallback; bestehende Abbruch-/Identitätsprüfungen bleiben unverändert.
- **TODO – Lebensdauer nach Ablauf:** mit dem unveränderten `SourceVault` und synthetischem Sealer/
  kontrollierter Uhr lokal belegt: `put(id, kind, gleicheUrl, binding)` bewahrt vor Ablauf die Frist;
  derselbe Aufruf bei `now = ursprüngliches expiresMs + 1` löscht intern den abgelaufenen Eintrag
  und erzeugt ein **neues 6-h-Fenster für dieselbe Kennung/URL**. Ablauf wird nicht über Joblebenszeit
  verankert. Noch kein Engine-/Samsung-Nachweis einer solchen Verlängerung; gezielt HLS-Retry mit
  bereits lange im Speicher gehaltener Quelle prüfen, bevor eine Korrektur geplant wird.
  Reproduktion: ID `00112233445566778899aabbccddeeff`, URL nur `https://example.invalid/synthetic.m3u8`,
  Uhr zunächst `1000000`, Sealer gibt für diese reine Lebensdauerprobe Eingabebytes zurück;
  `put → get.expiresMs → Uhr expiresMs+1 → put → get.expiresMs == now+MAX_AGE_MS` ist wahr.
- **NEEDS_TEST – konkurrierende Keystore-Erstanlage:** HLS und MP4 besitzen getrennte Sealer-Instanzen,
  aber denselben Alias. `key()` führt Lesen/Generieren ohne gemeinsamen Lock aus. Möglicher
  Schlüsselwechsel bei gleichzeitigem ersten Download ist eine **Hypothese**, noch kein Android-Befund;
  mit echter Keystore-Instrumentierung und Startbarriere prüfen.
- **TODO – Haltbarkeit/Aufräumen:** Vault schreibt atomar, aber ohne Datei-/Verzeichnis-fsync;
  Verlust beim harten Systemabbruch wäre fail-closed, kann Wiederaufnahme verhindern. Ablauf wird
  bei Zugriff/Sweep geprüft, kein zeitgesteuertes Löschen bei beendetem Prozess. Das ist von der
  Nutzbarkeit nach Ablauf zu unterscheiden. Keine Aufweichung des 6-h-Ziels ableiten.
- **TODO – MP4 bytegenau über Prozessende:** weiterhin Byte 0 mit ETag/Längenvergleich;
  geeignete Instrumentierung muss insbesondere genau einen MediaStore-Eintrag, unveränderte
  Quelle und dauerhaften Abbruch vor einer Implementierung absichern. Samsung R2 bleibt PASS.

### CI-Nachlauf (2026-11-07)

- **DONE – erster CI-Befund eingegrenzt:** Lauf `42390438197` auf `b8eed88`: allgemeine Browser-Suite,
  DNR/Firefox, Helper-Route, Datenschutz, Speicherprüfungen grün; Kanal-Mutationen 53/53;
  `test_helper.py` 18/18, Menü 7/7, MP4 134/134, HLS 24/24.
  Der erweiterte `test_direct_dl.py` besteht MP4-GET/Redirect, HLS-Plan-Medienliste und
  HLS-Start-Hauptliste einschließlich anonymer Diagnose. Danach bricht **der neue Testaufbau** ab:
  `runtime.sendMessage(cancel)` aus dem Service Worker erreicht nicht seinen eigenen Empfänger.
  Kein Produktfehler, kein ignorierter Testfehler: Bereinigung jetzt vom erlaubten Popup-Absender,
  wie die echte Downloadliste, mit geprüfter Antwort. Senderprüfungen unverändert.
- **DONE – Diagnose-Unit 18/18:** feste Kanalcodes mit Bindestrich (z. B. `helper-busy`) bleiben erhalten;
  keine Freitext-Fehlermeldungen oder Adressen. Noch keine vollständige grüne CI des finalen Stands.
- **Nächster Schritt:** Testkorrektur pushen, vollständige CI abwarten; erst nach Erfolg P4-Test-Erweiterung
  über bestehenden Workflow aus exakt diesem Commit liefern. Helper bleibt `862c1d1`/App `8b906c5`.

### Aktueller Code-/Paketstand

- Kadri-Anwendungscode **`bde39ebbf6716d1714259d2428807382f81befd3`**, bestehender Branch/PR unverändert.
  Die folgenden Paket-/Dokumentationscommits ändern diesen Anwendungscode nicht.
- Helper-HEAD **`862c1d19ea80eefad7b9b341b93a70cde338fa7d`**, App/CI-Pin
  **`8b906c504f0612ff4af69a397a2745b717f156b3`**, Arbeitsbaum unverändert.
- **DONE – finale CI (alle fünf Jobs grün):** https://github.com/Owndot/Kadri/actions/runs/42414984129.
- **DONE – isolierte P4-Test-Erweiterung:** bestehender `p4-test-extension.yml` auf
  `bde39eb` gesetzt, Artefaktname `kadri-p4test-bde39eb-vivaldi-test`. Der bestehende Upload-Guard
  verlangt erfolgreiche vollständige CI exakt dieses Quell-Commits; bei rot gibt es keine Lieferung.
  Feste P4-ID unverändert, **keine APK, keine Deinstallation, keine erneute Kopplung**.
  Paketlauf **grün**: https://github.com/Owndot/Kadri/actions/runs/42415088410 (Workflow-Commit `b64710e`).
  Lieferung: https://github.com/Owndot/Kadri/actions/runs/42415088410/artifacts/13590654579
  (verfügbar bis **2026-11-09 21:29 UTC**). Enthält Ordner `kadri-p4-test`,
  `kadri-p4-test-extension.zip`, `SHA256SUMS`, `p4test-extension-evidence.json`.
  P4-ZIP-SHA-256 **`4da18f26264cac4250327a08f92b11236aa0e4c6cb74b1587bc096fe9f52ad67`**.
  Tatsächliches CI-Artefakt heruntergeladen: Archiv-Digest und **alle** SHA256SUMS geprüft,
  enthaltenes Erweiterungs-ZIP bytegleich zum unabhängigen lokalen Build;
  Quellcommit/Helper-Pin/P4-ID/UNAPPROVED in Evidence geprüft.
- **NEEDS_TEST – Samsung nach Lieferung:** nur bestehende Kadri-P4-Test-Erweiterung aktualisieren
  (gleiche ID, Daten/Kopplung behalten), site-a neu laden, Video kurz spielen, direkten ⬇-Download
  mit derselben Qualitätsbezeichnung versuchen. Nach Fehlermeldung etwa 25 Sekunden auf derselben
  Seite bleiben, dann Erweiterungsmenü → „Diagnose anzeigen“ → **„Anonymisiert kopieren“**.
  Nur diesen Text plus Qualitätsbezeichnung/Ort der Fehlermeldung/weiterlaufende Wiedergabe senden.
  Quellenalter bezeichnet die erste Registry-Beobachtung, nicht die Laufzeit eines Server-Tokens.
  Bei HLS „genaue Fehlerressource unbekannt“ ehrlich stehen lassen; dann gezielte Helper-Diagnose
  planen, keine Cookies/Referer/Authorization und keinen Browserproxy als Ausweichweg einführen.
  Weiterer Codebeleg für diesen Folgeschritt: `HlsEngine.resumeFrom()` fasst `HlsException` beim
  ersten Quellenabruf aus dem Vault als `interrupted/network` zusammen. Dort kann auch ein
  HTTP-Code verloren gehen. Das ist kein Nachweis, dass site-a nach einem Neustart scheitert.

### Abschluss dieses Diagnose-Teilpakets – 2026-11-07

- **DONE – Code, Tests, Lieferung:** Kadri-Code `bde39eb`, Paketworkflow `b64710e`, abschließender
  Dokumentationscommit = dieser Commit (Branch-HEAD mit `git log -1` prüfen).
  Helper unverändert auf `862c1d19ea80eefad7b9b341b93a70cde338fa7d`; App-Code `8b906c5`.
- **DONE – finale CI-Ergebnisse auf `bde39eb`:** Diagnose-Unit **18/18**, Kanal-Unit **36/36**,
  Download-Unit **116/116**, HLS-Unit **69/69**, Kanal-Integration **74/74**, MP4-Integration **38/38**,
  HLS-Integration einschließlich elf HTTP-Fällen **91/91**, Kanal-Browser **34/34**, fail-closed **4/4**,
  Kanal-Mutationen **53/53**. Browser: Helper **18/18**, Menü **7/7**, MP4 **134/134**,
  HLS **24/24**, direkter Downloadknopf einschließlich neun HTTP-Fällen **81/81**.
  Auch die volle allgemeine Browsersuite, DNR/Firefox, Datenschutz- und Speicherjobs sind grün.
- **DONE – Sicherheits-/Releasegrenzen erhalten:** keine Helper-Codeänderung, keine neue APK,
  keine Produktionssignierung, kein neuer PR/Merge/Tag/Release, keine Änderung von Noise KK,
  SafeHttpClient, Validatoren, Retry oder persistentem Abbruch. Produktion **UNAPPROVED**,
  **P4B-A10-SIZE bleibt rot**, grüne Kadri-CI ist keine unabhängige Sicherheitsfreigabe.
- **BLOCKED / OFFEN – site-a-Ursache:** noch keine anonymisierte Samsung-Diagnose erhalten.
  Die behobenen Diagnose-Lücken sind nicht mit einer Behebung des realen HTTP 404 gleichzusetzen.
  **Exakt nächster Arbeitsschritt:** geliefertes P4-Update wie oben auf dem Samsung nachtesten,
  anonymisierten Text und gewählte Qualitätsbezeichnung auswerten; zuerst MP4/HLS und Aufrufphase
  festlegen, danach gezielt die fehlende Evidenz beschaffen. Keine Ursache aus Menü oder Browser-
  Wiedergabe ableiten, keine Zugangskontrollen umgehen. Bei HLS kann dafür eine separate,
  ressourcengenaue Helper-Diagnose erforderlich sein; noch keine APK dafür erzeugt.
- **TODO / NEEDS_TEST – nachgelagert:** Vault-Befunde aus dem lesenden Review absichern,
  MP4-Keystore-Instrumentierung und bytegenaues Fortsetzen evaluieren. Samsung F1/F2/R1/R2/C1
  bleiben bestätigte PASS; sie werden nicht durch diese offenen Aufgaben wieder auf TODO gesetzt.

---

## A. Projektstatus

### Ziel
- **Kadri** (Repository `Owndot/Kadri`): Browser-Erweiterung (Chrome/Vivaldi-Fassung mit Helfer-Kanal; Firefox-Fassung und
  Userscript ohne Kanal) mit eigenem Videoplayer für Webseiten-Videos. Phase C3/P4: Videos über die Android-Helfer-App
  direkt aufs Handy speichern (MP4-Dateien, HLS-Streams → MP4).
- **Android-Helfer** (Repository `Owndot/video-assistent-helper`, Paket `de.evp.helfer`): lokale App auf
  `127.0.0.1:47899`, verschlüsselter Kanal (Noise KK, Rust-Kern per JNI), Helligkeit/Lautstärke für den Player, und seit
  C2/C3/P4 die Download-Engines (MP4 direkt, HLS → MP4 mit Media3), Ablage in `Download/Video-Assistent` (MediaStore).
- Zusammenhang: Kadri vendort den WASM-Kern aus dem Helfer-Repository und koppelt jeden Stand an einen festen
  Helfer-Commit (`vendor/kadri-pairing-poc/SOURCE`, Feld `helper_commit`). Kadris CI baut daraus einen Desktop-Helfer
  (echter `ChannelServer` und echte Download-Engines auf dem JVM, `tests/java/channel/build.sh` im Helfer-Repository)
  und testet die Erweiterung Ende-zu-Ende dagegen.

### Branches, Commits, Draft-PRs (nur diese verwenden; keine neuen PRs, Merges, Tags, Releases)
| Repository | Branch | Draft-PR | Stand bei Erstellung dieses Dokuments |
|---|---|---|---|
| `Owndot/video-assistent-helper` | `feature/c3-browser-downloads` | #27 | `f0281927f46126cfbd8f1fad0bae3128fb9e2d7c` (App-Code wie `ad3c597`) |
| `Owndot/Kadri` | `feature/c3-helper-mp4` | #11 | `f5c2191ae363ed89a8dc7ed71a8d1e8207353eef` (Quelle `cb4f5ac`, gekoppelt mit Helfer `ad3c597`) |

Vor Arbeitsbeginn immer prüfen: `git fetch && git log --oneline -5` auf beiden Branches; neuere Commits sind im
Abschnitt „Fortschritt“ einzutragen.

### Zuletzt auf dem Samsung (Android 17, Vivaldi) getestet
- Test-APK `de.evp.helfer.p4test` („P4 TEST Helfer“), Quelle Helfer `ad3c597`, Lauf
  https://github.com/Owndot/video-assistent-helper/actions/runs/42226934354, APK-SHA-256
  `387bdd3ad5a8855705539f12d923718b2136816ccd6857233a01c2dea530ddd1`, Wegwerf-Zertifikat
  `b8756e033bfed1067a44f5c8a483f08ad5588a1448c501bfab8caf41fea5f372`, versionCode 5.
- Testerweiterung „Kadri P4 TEST“ (ID `pcccpjllneffccpenbepmfbkjedllkkf`), Quelle Kadri `cb4f5ac`, Lauf
  https://github.com/Owndot/Kadri/actions/runs/42224796156, ZIP-SHA-256
  `afdf342ee489e3e8e2aacdb02f89909afee10b4d94bc4f57e449c2e2619f65d2`.
- Testseite: `tests/web/public/p4-hls.html` über `https://rawcdn.githack.com/Owndot/Kadri/<commit>/tests/web/public/p4-hls.html`.
- Installationen des Eigentümers, die **nie** berührt werden dürfen: `de.evp.helfer` (Produktion),
  `de.evp.helfer.channeltest` + C3-Testerweiterung (`fhjmppadldgkhdgkdplpalmoooocoinn`). Eine neue Wegwerf-Signatur
  betrifft nur `de.evp.helfer.p4test` (dann deinstallieren und neu koppeln).

### Bereits auf dem Samsung bestanden (Eigentümer-Bericht)
- Erster P4c-Test: T1, T2, T3, T5, T6, T7, T8, T12, T13, T14a, T14b.
- Zweiter Test (Helfer `ad3c597`, Kadri `cb4f5ac`): S1 Download läuft nach sofortigem Schließen des Players weiter;
  S2 automatische Wiederaufnahme nach Flugmodus; S3 T4 (fMP4 mit Ton); S4 Download-Knopf direkt am Video;
  S5 teilweise: Download bei ausgeschaltetem Bildschirm.

### Bekannte Fehler, Befunde, offene Entscheidungen
- **F1 (P0, offen):** Nach Beenden und erneutem Öffnen des P4 TEST Helfers bleiben neue Downloads hängen (siehe B).
- **F2 (P1, offen):** Fortschritt zeigt bis über 300 % bzw. „5 MB von 2 MB“ (siehe B).
- **P4B-A10-SIZE (bekannt, bleibt rot):** Android 10 (API 29): MediaStore-Spalte `SIZE` bleibt 0;
  `Mp4DownloadsInstrumentedTest#publishesThroughMediaStoreAndReadsBack` schlägt auf API 29 fehl (45/46). Vom Eigentümer
  nur für den Android-17-Test hingenommen – **nicht** als bestanden melden, Assertion nicht ändern.
- Issue #3 (Helfer): kompromittierte alte APK-Signatur – Release-Blocker. Issue #4: Helfer-Authentifizierung offen.
- Dauerhafte P4-Testidentität (Mac des Eigentümers) noch nicht erzeugt: `release/p4test-signer.json` steht auf
  `certificate_sha256: null`, `KEY_NOT_YET_CREATED` – nicht ändern. Testartefakte nur mit Wegwerf-Schlüssel (Workflow).
- **Entscheidung P2 getroffen (Eigentümer):** verschlüsselte Downloadquelle für Wiederaufnahme nach Prozessende,
  **HLS und MP4, höchstens 6 Stunden** (Details in P2).

---

## B. Aktuelle Samsung-Fehler

### F1 – Helfer nach Stopp/Neustart: neue Downloads bleiben hängen (P0)
- Beobachtung (Eigentümer): Nach dem Beenden des P4 TEST Helfers und erneutem Öffnen funktionieren weitere Downloads
  nicht; sie bleiben bei „Lädt …“/„Startet …“ stehen.
- **Nachgewiesen:** noch nichts (nicht reproduziert).
- **Vermutet (zu prüfen, nicht belegt):**
  - H1: Nach einem Dienst-Stopp im selben Prozess (`HelferService.onDestroy` → `stopAll()` der Engines) bleiben Zustände
    der Prozess-Singletons hängen (`Mp4Downloads.instance`, `HlsDownloads.instance`, `Mp4Downloads.SLOTS`,
    `DirectDownloads.stopped`, `HlsEngine.stopped`), z. B. belegte Job-/HTTP-Plätze eines Auftrags, der im Stopp
    noch wartete (Retry-Pause, `acquireHttp`, Remux).
  - H2: Ein Auftrag wartet nach dem Neustart unbegrenzt auf einen Platz (`JobSlots`) oder in `acquireHttp`
    (`HTTP_WAIT_MS` = 10 min) und erscheint in Kadri als „Lädt …“.
  - H3: Kadri behandelt einen Start nach dem Helfer-Neustart als „unbestätigt“ und klärt ihn nicht ab (Kanal-Sitzung
    neu, `stale-session`, `notSent`), Anzeige „Startet …“ ohne Ende.
  - H4: Wiederhergestellte Journal-Einträge (`RUNNING` → `INTERRUPTED`) stimmen nicht mit Kadris gespeichertem Zustand
    überein; ein veraltetes „läuft“ blockiert den neuen Start derselben Datei.
  - H5: Port 47899 nach dem Neustart noch belegt bzw. Kanal nicht neu aufgebaut (dann eigentlich klarer Fehler „Port
    belegt“).

### F2 – Fortschritt über 100 % / „5 MB von 2 MB“ (P1)
- **Nachgewiesen (Code):** `HlsEngine.progress(job)` meldet `listener.progress(id, title, job.bytes, job.estimate)`;
  `job.estimate` = `HlsPlan.Plan.estimatedBytes` (Bitrate × Dauer, nur eine Schätzung).
  `Mp4Downloads.progress(...)` berechnet daraus `pct = 100 * bytes / total` und zeigt
  „`pct` % · `bytes` MB von `total` MB“ – bei unterschätzter Bitrate über 100 % bzw. „5 MB von 2 MB“.
  Kadri zeigt für HLS keinen Prozentwert (`describeDownload`: „Teil x / y · n MB“), übernimmt aber `total` = Schätzung.
- **Vermutet:** weitere Inkonsistenz zwischen geladenen Bytes und Größe der veröffentlichten Datei (Remux-Ausgabe
  ≠ Summe der Segmente) in Status/Kadri-Anzeige nach dem Abschluss.

---

## C. Technische Architektur (Pfade)

### Kadri (`Owndot/Kadri`)
- Inhaltsskript aus Teilen `src/*.js` (zusammengefügt von `tools/build.js` zu `dist/chrome|firefox|test/content.js`):
  - `src/065-media-registry.js` – Quellen-Registry je Dokument/Video (Bindung mit Beleg; keine geratenen URLs).
  - `src/045-media-source.js` – `selectDownloads`, `selectStreams`, `mediaDownloadState`, `mediaStreamState`.
  - `src/060-quellen-zuordnung.js` – `resolve(v)` (u. a. „Stream (läuft gerade, geprüft)“ = Stücke dieses Streams geladen).
  - `src/080-helper-app.js` – `helperDl(op,args)` → `KADRI_DOWNLOAD` (Brücke in `chrome/prelude.js`).
  - `src/100-knopf-oberflaeche.js` – schwebende Leiste `[ ▶ ] [ ⬇ ]`; `src/105-download-knopf.js` – Download-Knopf
    (`onPageDownload`, `pageDlOptions`, Menü `.dlm`).
  - `src/180-player-bedienung.js` – Download-Menü im Player (`hdlStart`, `hlsPlanMenu`, `hlsGo`, `hdlProbe`).
- Hintergrund (Service Worker): `chrome/background.js`, `channel/channel-service.js` (Nachrichten `kadri-download`:
  start/find/status/cancel/caps/list/hlsplan/hlsstart/hlsresume), `channel/channel-downloads.js` (zentrale
  Download-Verwaltung: Aufträge in `storage.local` **ohne URL**, nur gesalzener SHA-256; Doppelstart-Erkennung,
  unbestätigte Starts mit derselben Kennung, `stillActive`/`refresh` gegen veraltete Zustände, `describe`/Texte),
  `channel/channel-session.js` (Noise-KK-Sitzung, `download()`), `channel/channel-store.js`, `channel/channel-transport.js`.
- Kopplung: Einstellungsseite „Helfer koppeln“ (8-stelliger Code aus der App), PAKE → feste Schlüssel; Webseiten können
  der Erweiterung keine Nachrichten schicken; DNR-Regel 40 gibt nur POST an die vier Kanalpfade auf `127.0.0.1:47899` frei.
- Test-Identität P4: `tools/p4test/identity.json`, `tools/p4test/pack-extension.py`, `tools/p4test/isolation.cjs`.

### Helfer (`Owndot/video-assistent-helper`, `app/src/main/java/de/evp/helfer/`)
- `HelferService.java` – Vordergrunddienst (`specialUse`): `onCreate` startet `Downloads.serviceStarted`,
  `Mp4Downloads.get(...).engine.serviceStarted()`, `HlsDownloads.get(...).engine.serviceStarted()`, `startChannel()`
  (Port 47899); `onStartCommand` (Abbrechen/„Fortsetzen“ aus Benachrichtigungen); `onDestroy` → `stopChannel`,
  `stopAll()` aller Engines.
- `ChannelServer.java`, `ControlCommands.java` – Kanal und Befehle (`dlstart/dlstatus/dlcancel/hlsplan/hlsstart`).
- `Mp4Downloads.java` – Android-Ablage (MediaStore pending / API 26–28 Teil-Datei), Journal `mp4-jobs-v1`,
  Benachrichtigungen (`progress`, `waiting`, `finished`), CPU-Sperre (`keepAwake`), `SLOTS` (gemeinsame `JobSlots`:
  2 Aufträge, 4 HTTP-Anfragen), statisches `instance`.
- `HlsDownloads.java` – `HlsEngine` mit Media3-Remuxer, Ordner `noBackupFilesDir/hls-jobs-v1`, statisches `instance`.
- `NetWatch.java` – Verbindungsüberwachung (ConnectivityManager) für `dl/Retry`.
- `dl/DirectDownloads.java` (MP4-Engine, Journal, Fortsetzen nur mit starkem ETag/If-Range), `dl/JobSlots.java`,
  `dl/Retry.java` (begrenzte automatische Wiederaufnahme), `dl/DownloadStore.java`.
- `hls/HlsEngine.java` (Pläne, Aufträge, Lauf mit Wiederholungsschleife `run`/`attempt`, `resumeLocal`,
  `canResumeLocal`, Journal-Wiederherstellung `recover`, `progress`), `hls/HlsJournal.java` (ohne Adressen),
  `hls/HlsFetch.java`, `hls/HlsPlan.java` (`estimatedBytes`), `hls/HlsPlaylist.java`, `hls/HlsUri.java`, `hlsmux/*`.
- `net/SafeHttpClient.java` u. a. – einziger Netzwerkweg (Adressprüfung, keine privaten Ziele, Weiterleitungsregeln).

### Download-Lebenszyklus
1. Kadri: Nutzer tippt (Player-Menü oder ⬇) → `selectDownloads/selectStreams` → `resolveSelection/resolveStream`
   → `helperDl('start'|'hlsplan'|'hlsstart')` → Hintergrund `channel-downloads.js`: Auftrag mit zufälliger Kennung
   **vor** dem Senden gespeichert (ohne URL) → `dlstart`/`hlsstart` über Noise KK.
2. Helfer: Journal-Eintrag **vor** dem Start (höchstens ein Start je Kennung, auch über Neustarts) → eigener Thread
   (MP4: `DirectDownloads.run`; HLS: `HlsEngine.run` → `attempt`) → Prüfungen → Ablage → Veröffentlichung.
3. Status: Kadri fragt `dlstatus` (Player, ⬇, Liste, Nachprüfungen); Android-Benachrichtigung zeigt Fortschritt.
4. Abbruch: Kadri speichert die Absicht vor `dlcancel`; Helfer vermerkt `cancelRequested` dauerhaft zuerst – Abbruch hat
   immer Vorrang (auch vor Wiederaufnahme nach Neustart).
5. Unterbrechung: `dl/Retry` (P4c-2): Pausen 2 s … 10 min, max. 8 Versuche ohne Fortschritt, ohne Netz warten
   (max. 2 h, keine Anfragen); nur bei IO/Timeout/408/429/5xx; nie bei Abbruch/Dienstende/401/403/404/410/geänderter
   Quelle/Sicherheitsprüfung/fehlendem starkem ETag (MP4). HLS: jeder Versuch = volle Wiederaufnahme (Listen neu laden,
   vergleichen, verifizierte Segmente nur mit Länge + SHA-256 + starkem ETag übernehmen).
6. Nach Prozessende: **heute** keine gespeicherte Quelle (Journal ohne URL) → Fortsetzen nur über Kadri (⬇/Player:
   neuer Plan, dieselbe Kennung). P2 ändert das (verschlüsselt, ≤ 6 h).

### Sicherheitsgrenzen (niemals verletzen)
- Noise KK und die Kopplungsidentität unverändert; kein Klartext-Fallback, kein alter Port 47811, keine statischen Tokens.
- Nur `SafeHttpClient`; keine Lockerung von Adress-/Weiterleitungs-/Größenprüfungen.
- Keine Cookies, Authorization, Referer oder Browser-Sitzungsdaten an den Helfer; kein Browser-Proxy.
- Keine Klartext-URLs/Tokens in Journalen, Logs, Benachrichtigungen, Kanal-Antworten, `storage.local` oder GitHub.
- Abbruch hat absoluten Vorrang; sichere Job-IDs; Schutz vor Doppelstarts; verifizierte Segmente und unveränderliche
  Medienidentität beim Fortsetzen; Größen-, Speicher-, Parallelitäts- und Laufzeitgrenzen.
- Nie `de.evp.helfer` bauen/signieren, keine Produktionssignierung, kein Wiederverwenden des kompromittierten Signierers
  (`ec17fab1…`), `release/production-policy.json` bleibt `UNAPPROVED`.
- Keine vertraulichen Seitennamen/Domains (nur neutrale IDs wie site-a, site-b) in GitHub-Inhalten.

---

## D. Verifizierte Testbasis

### Helfer (Repository-Wurzel `video-assistent-helper`)
| Modul | Befehl | Voraussetzung |
|---|---|---|
| MP4-Engine, Retry | `bash tests/java/dl/run.sh CACHE` · Mutationen `python3 tests/java/dl/mutation.py CACHE` | JDK 17; Maven Central (OkHttp/Okio/Kotlin per SHA-256) oder Cache |
| HLS-Kern/Engine | `bash poc/p4a-hls/tools/make-fixtures.sh FX` → `bash tests/java/hls/run.sh FX CACHE` · `python3 -I tests/java/hls/mutation.py FX CACHE` | ffmpeg |
| Remuxer (Media3) | `bash tests/java/hlsmux/run.sh FX CACHE` · `python3 -I tests/java/hlsmux/mutation.py FX CACHE` | |
| Netzwerkschicht | `bash tests/java/net/run.sh CACHE` | |
| Kanal (JVM) | `bash tests/java/channel/run.sh [OUT]`; Desktop-Helfer für Kadri: `bash tests/java/channel/build.sh OUT` | Rust (rust-toolchain.toml) |
| Lebenszyklus | `bash tests/java/run_download_lifecycle.sh --transport` · `bash tests/java/prove_download_lifecycle_baseline.sh` · `bash tests/java/check_lifecycle_android_api.sh` (braucht `ANDROID_HOME`) | |
| Emulator | Workflow `.github/workflows/helper-channel.yml` (API 26, 29, 34; `tools/build-channel-native.sh`, `tools/build-channel-apk.sh`, `tools/run-channel-instrumentation.sh OUT`) | KVM, NDK r27c |
| Test-APK | Workflow `.github/workflows/p4-test-package.yml` (läuft nur bei Änderung der eigenen Datei; `SOURCE_SHA`/`KADRI_PAIR_SHA` setzen; prüft CI des Quell-Commits) | |

### Kadri (Repository-Wurzel `Kadri`)
| Modul | Befehl |
|---|---|
| Bau | `node tools/build.js --test` |
| Unit | `node tests/channel/download_unit_check.js` · `hls_unit_check.js` · `channel_unit_check.js` · `node tests/channel/download_regression_check.js` |
| Integration (Desktop-Helfer) | `HELPER_HOST_DIR=OUT node tests/channel/channel_integration_check.js` · `download_integration_check.js` · `hls_integration_check.js` · `channel_browser_check.js` · Mutationen `channel_mutation_check.js` |
| Browser Ende-zu-Ende | `cd tests && HELPER_HOST_DIR=OUT TESTS="test_helper.py test_menu.py test_mp4.py test_hls.py test_direct_dl.py" ./run_all.sh` (xvfb, Playwright 1.56/Chromium; lokal ggf. `KADRI_CHROMIUM=<chromium>`) |
| Quelltext-Proben | `node tests/download_source_check.js [--mutations]` · `node tests/helper_route_check.js` · `python3 tests/p4_device_page_check.py` |
| Testerweiterung | Workflow `.github/workflows/p4-test-extension.yml` (`SOURCE_SHA`, `HELPER_SHA`) |

### Aktuelle CI (vor P4c-3)
- Helfer `ad3c597`: HLS https://github.com/Owndot/video-assistent-helper/actions/runs/42224703396 grün; Safe validation
  42224547807 grün; Browser 42224547815 grün (nach 1 Wiederholung, Firefox `test_seamless` Timing); Kanal/Emulatoren
  42224548143: alles grün außer API 29 (P4B-A10-SIZE, 45/46). Test-APK 42226934354 grün.
- Kadri `cb4f5ac` https://github.com/Owndot/Kadri/actions/runs/42224774411 grün; `f5c2191` grün; Testerweiterung 42224796156.

### Bekannte instabile Tests (nie „wegtesten“, nur einmal wiederholen und kommentieren)
- Firefox `test_seamless.py` / `test_framekey.py` (Zeitmessung) – unveränderter Code, grün nach einer Wiederholung.
- `ReferrerDownloadTest#downloadManagerNeverReplaysPageReferrer` (Android-DownloadManager, Workflow build.yml) –
  gelegentlich „did not finish“.
- Lokal (nicht CI): `tests/test_detect.py` 2 Prüfungen und `tests/test_dnr_scope.py` (Startpfad) scheitern in dieser
  Sandbox auch auf älteren Ständen – in CI grün.

### Welche Tests bei Änderungen erneut laufen müssen
- `dl/*`, `Mp4Downloads`, `NetWatch` → dl-JVM + Mutationen, Lebenszyklus (+ Stubs `tests/java/lifecycle/…`), Emulator.
- `hls/*`, `HlsDownloads` → HLS-JVM + Mutationen, Emulator; Kadri-Integration nach Pin-Wechsel.
- `HelferService`, `ChannelServer`, `ControlCommands` → Kanal-JVM, Lebenszyklus (`check_lifecycle_android_api.sh`
  übersetzt eine feste Dateiliste – neue Klassen dort eintragen), Emulator.
- Kadri `channel/*` → Unit + Regression + Integration + Mutationen; `src/*` → volle Browser-Suite.
- Neuer Helfer-Commit für Kadris Tests: `vendor/kadri-pairing-poc/SOURCE` → `helper_commit` anpassen.

---

## E. Implementierungsplan P4c-3

### P0 – Helfer nach Neustart wieder vollständig funktionsfähig — Zustand: TODO
1. Problem: F1 (beobachtet, nicht reproduziert); Ursache vermutet (H1–H5).
2. Betroffen: `HelferService` (`onCreate/onDestroy/onStartCommand`), `Mp4Downloads.get`/`instance`/`SLOTS`,
   `HlsDownloads.get`, `DirectDownloads` (`stopAll/serviceStarted/loadJournal`), `HlsEngine`
   (`stopAll/serviceStarted/recover/start`), `JobSlots`, `ChannelServer` (Bind/Neustart), Kadri `channel-downloads.js`
   (unbestätigte Starts, `refresh`) und `channel-session.js` (Sitzungsneuaufbau).
3. Geplant: (a) Reproduktion als **echter** Prozess-Neustart in der Instrumentierung: Phase A startet Dienst, koppelt
   (TestInitiator), startet MP4 + HLS über den echten Kanal; Skript beendet (Dienst-Stopp, `am force-stop`,
   `kill -9`); Phase B öffnet die App neu und prüft neue MP4- und HLS-Downloads sowie den Zustand der alten Aufträge.
   Zusätzlich JVM-Test: Dienst-Stopp/-Start im selben Prozess mit wartendem/laufendem Auftrag (Plätze frei?).
   (b) Ursache beheben; (c) jeder hängende Zustand bekommt ein Zeitlimit mit festem, anonymem Grund (z. B.
   `stopped`, `restarted`, `not_started`, `busy`) statt endlosem „Lädt …/Startet …“.
4. Risiken/Grenzen: keine Doppelstarts, Abbruchvorrang, keine Klartext-URLs; Journale fail-closed lassen.
5. Akzeptanz: nach erneutem manuellen Öffnen funktionieren neue MP4- und HLS-Downloads zuverlässig, auch wenn zuvor ein
   Download lief; jeder Fehler zeigt einen konkreten Grund.
6. Tests: neue Instrumentierung (echter Neustart) auf API 26/29/34; JVM; Kadri-Unit für Statusabgleich.
7. Abhängigkeiten: keine (P2 baut darauf auf).

### P1 – Fortschrittsanzeige — Zustand: TODO
1. Problem: F2 nachgewiesen (Code, siehe B).
2. Betroffen: `HlsEngine.progress`/`json` (`total` = Schätzung), `Mp4Downloads.progress`/`waiting`/`finished`,
   Kadri `channel-downloads.js` (`apply`, `describe`), Player-/Knopf-Menüs.
3. Geplant: HLS meldet getrennt `done/of` (Teile), `bytes` (geladen, ohne Doppelzählung bei Wiederaufnahme/erneutem
   Abruf) und **keine** exakte Gesamtgröße (Schätzung nur als `estimate`, nie als `total`); Benachrichtigung HLS:
   „12/25 Teile · 5 MB geladen“, Phasen „Wird zusammengesetzt/geprüft/gespeichert“; Prozent nur bei verlässlichem
   Nenner (MP4: Content-Length bleibt); nach Abschluss Größe der veröffentlichten Datei. Kein Abschneiden bei 100 % als
   Ersatz für die Korrektur.
4. Risiken: Protokollverträglichkeit mit älterem Kadri (Felder nur ergänzen, Bedeutung von `total` für HLS = −1).
5. Akzeptanz: nie > 100 %, nie „x MB von y MB“ mit x > y, HLS ohne Prozent bei unbekannter Größe, Endgröße exakt.
6. Tests: JVM (massiv unterschätzte Bitrate, getrennte Tonspur, Wiederaufnahme, unterschiedliche Segmentgrößen,
   Remux-Ausgabe ≠ Summe), Kadri-Unit für `describe`, Emulator-Benachrichtigungstext.
7. Abhängigkeiten: keine.

### P2 – Verschlüsselte Downloadquelle (≤ 6 h) für Wiederaufnahme nach Prozessende — Zustand: TODO (freigegeben)
1. Problem: nach Prozessende keine Quelle → keine selbstständige Wiederaufnahme (nachgewiesen, Design).
2. Betroffen: neu z. B. `dl/SourceVault` (Schnittstelle) + Android-Implementierung (Keystore), `DirectDownloads`,
   `HlsEngine` (`recover`, Start nach Neustart), `HelferService` (beim Öffnen fortsetzen), Benachrichtigungen.
3. Geplant: AES-256-GCM, nicht exportierbarer Android-Keystore-Schlüssel; nur Hauptadresse des ausdrücklich gestarteten
   Downloads; AAD = Format-Version + Auftragskennung + Art (mp4/hls) + Plan-/Identitätsdaten; Datei app-privat in
   `noBackupFilesDir`, ohne Backup; Ablauf 6 h; sofort löschen bei Erfolg, Abbruch (Abbruchwunsch zuerst), endgültigem
   Fehler, Ablauf; beschädigt/ungültiger Schlüssel/Entschlüsselung fehlgeschlagen ⇒ Datensatz löschen, Auftrag bleibt
   unterbrochen mit Grund. Nach gewöhnlichem Prozessneustart automatisch fortsetzen (gleiche Prüfungen: Listen-Hash,
   Fingerabdruck, ETag, SafeHttpClient); nach „Stopp erzwingen“ kein Hintergrundstart – beim manuellen Öffnen der App
   fortsetzen. Kein Boot-Start ohne separate Freigabe; nie nach Nutzerabbruch.
4. Risiken: Token in der Adresse liegt bis 6 h verschlüsselt auf dem Gerät; nur Plattform-Krypto.
5. Akzeptanz: Wiederaufnahme nach Prozess-Kill und nach manuellem Öffnen ohne Webseite; nie nach Abbruch; Datensatz
   nach Ende/Ablauf weg; keine Klartext-URL irgendwo.
6. Tests: JVM mit Test-Vault (Ablauf, Beschädigung, falscher Schlüssel, AAD-Vertauschung, Löschung), Instrumentierung mit
   echtem Keystore und echtem Prozess-Neustart.
7. Abhängigkeiten: P0 (Neustartpfad muss zuerst stimmen).

### P3 – Regression, Samsung-Nachtest, Testartefakte — Zustand: TODO
- Regression aller bestandenen P4-Funktionen (direkter Download, Player sofort schließen, Flugmodus, Bildschirm aus,
  parallel, Abbruchvorrang, Wiederaufnahme nach Prozessende, Benachrichtigungen/Fortschritt); echte Prozess-Neustarts in
  der Instrumentierung. API-29-Befund bleibt sichtbar.
- Danach neue Test-APK (`p4-test-package.yml`: `SOURCE_SHA` = getesteter Helfer-Commit, `KADRI_PAIR_SHA`) und ggf.
  Testerweiterung (`p4-test-extension.yml`), Prüfsummen und Artefakt-Links in diesem Dokument und in PR #27/#11.

---

## Fortschritt (fortlaufend aktualisieren)

| Datum | Paket | Zustand | Commits | Tests | Nächster Schritt |
|---|---|---|---|---|---|
| 2026-11-06 | Übergabe | DONE | dieses Dokument | – | P0 Reproduktion |
| 2026-11-06 | P0 Reproduktion Desktop | DONE (nicht reproduziert) | – | Desktop-Helfer: Prozess während HLS-Download beendet, mit gleichem Zustand neu gestartet → neuer MP4 per Knopf fertig, alter HLS-Download setzt fort (`done`). F1 ist auf dem JVM **nicht nachgewiesen** → vermutlich Android-spezifisch (Dienst, statische Objekte, Store) oder Kadri-Anzeige bei unerreichbarem Helfer | echte Prozess-Neustarttests auf dem Emulator |
| 2026-11-06 | P0 Neustarttest Android | DONE (getestet) | Helfer `52ae07b`, `7d41ba3` | Lauf https://github.com/Owndot/video-assistent-helper/actions/runs/42266397716: API 26/29/34 je zwei echte Prozessenden (force-stop; Prozess ersetzt) → `RESTART_B oldInterrupted=true newHls=done newMp4=done resumed=done channel=ok serviceRestart=ok`. **F1 auf Helferseite nicht reproduzierbar** (Port 47899, Noise-KK-Neuaufbau, Slots, Journale, Dienst-Stopp/Start alle in Ordnung) | Samsung-Nachtest mit neuer Diagnose |
| 2026-11-06 | Befund (neu) | NEEDS_TEST | Helfer `52ae07b` (nur Diagnose) | API 34, Lauf 42240436344: `Mp4DownloadsInstrumentedTest#interruptionFailsCleanOrResumesExactly` endete einmal `failed:storage` statt `done` (auf `ad3c597`/`fcbc23c` grün). Assertion unverändert, Meldung enthält jetzt die Ursache | Ursache aus nächstem Lauf lesen |
| 2026-11-06 | P0 Kadri (nachgewiesen + implementiert) | DONE (getestet lokal) | Kadri `a494942` | **Nachgewiesen (Code + Unit-Test):** scheitert die Abfrage beim Helfer (neu gestartet, nicht erreichbar, Sitzung weg), zeigte Kadri endlos „Lädt …“, „Startet …“ oder „Stand wird geprüft“ – ohne Endzustand und ohne Grund. **Behoben:** `refresh()` vermerkt den festen Fehlercode (`check`), die Anzeige nennt ihn („Helfer-App nicht erreichbar – letzter bekannter Stand“, „Start nicht bestätigt – … (wird beim nächsten Öffnen geprüft)“); nächste Antwort löscht ihn. Doppelstartschutz/Abbruchvorrang unverändert. Tests: download_unit 112/112, Integration 38/38 + 25/25, Kanal 36/36 + 74/74, Mutation 53, Browser 29/29, 134/134, 24/24, 18/18 (gegen Desktop-Helfer aus `c977b13`) | Kadri-CI, danach Pin auf neuen Helfer |
| 2026-11-06 | P0 Befund `failed:storage` | NEEDS_TEST | – | Auf `7d41ba3` grün (API 26/34); API 29: dieselbe Ursache `failed:storage` nur in der **erwarteten** Mutationsprobe „publication regression“. Ursache des einmaligen API-34-Falls noch offen (Diagnose-Meldung aktiv) | bei Wiederauftreten Ursache aus Meldung lesen |
| 2026-11-06 | CI-Ausreißer (nicht P4c-3) | DONE | – | `ReferrerDownloadTest` (alter DownloadManager-Pfad, unberührt) einmal „did not finish“ auf frischem Emulator; einmalige Wiederholung grün (Lauf 42266397832, Versuch 2) | – |
| 2026-11-06 | P1 Fortschritt | DONE (getestet lokal), CI läuft | Helfer `c977b13`, Kadri `a494942` | **Ursache nachgewiesen:** `HlsEngine` gab die Plan-Schätzung (BANDWIDTH × Dauer × 1,25) als `total` an die Benachrichtigung (`100*bytes/total`, „x von y MB“) und in `dlstatus`. **Behoben:** `dl/Progress` (MP4 % nur bei 0 ≤ bytes ≤ exakter Länge, sonst „n MB geladen“, nie abgeschnitten; HLS „12/25 Teile · 5,5 MB geladen“; Phasen), `total=-1` bis done, dann bytes = total = exakte Dateigröße (auch nach Neustart), Teilezahl 0 bis die Form feststeht (war 1), Drossel je Auftrag, Phasenwechsel immer gemeldet, Endgröße in „Gespeichert“. Tests: TestProgress 14/14, HLS-JVM 212/212 (BANDWIDTH=1000, getrennter Ton, Ausgabe > geladene Bytes, Fortsetzen, Neustart), MP4-JVM 43/43, 10 neue Mutationsproben (alle getötet) | CI auf `c977b13` |

| 2026-11-06 | P2 HLS verschlüsselte Quelle | DONE (getestet lokal), CI läuft | Helfer `60a831f`, `a1324ca` | `dl/SourceVault` (AES-256-GCM, AAD = Kennung/Art/Version/Erstell-/Ablaufzeit, ≤ 6 h, `noBackupFilesDir/source-vault/{hls,mp4}`, atomar, Fehler → löschen), `KeystoreSealer` (AndroidKeyStore, nicht exportierbar). `HlsEngine.resumeStored()` nur bei START_STICKY-Neustart oder App-Öffnen (auch nach Stopp erzwingen), nie beim Boot, nie nach Abbruch; Prüfung Liste-Hash, Variante/Ton, Fingerabdruck, dann ETag/Hash je Teil. Tests: 16 Tresor-Prüfungen (TestHlsEngine), 5 Mutationsproben, HLS-JVM 230/230; ProcessRestartInstrumentedTest setzt nach echtem Prozessende aus dem echten Keystore fort | CI auf `8b906c5` |
| 2026-11-06 | P2 MP4 verschlüsselte Quelle | DONE (getestet lokal), CI läuft | Helfer `13b0893` | Nur mit starkem ETag; Bindung ETag + exakte Länge + Name (verschlüsselt). Nach Prozessende derselbe Auftrag **ab Byte 0**, nur bei gleichem ETag und gleicher Länge (sonst `failed:changed`). Byte-genaues Fortsetzen über ein Prozessende (MediaStore-Pending weiterschreiben) bleibt späterer Schritt. Tests: TestDirectDownloads.vault, 3 Mutationsproben, MP4-JVM 44/44 | Instrumentierung MP4-Tresor ergänzen |
| 2026-11-06 | P2 Kadri | DONE (getestet lokal) | Kadri (dieser Commit) | „interrupted“ wird weiter abgefragt (`FINAL` = done/failed/cancelled), damit ein vom Helfer fortgesetzter Auftrag wieder „läuft“ zeigt; kein zweiter Start, solange er läuft; Journal nur bei echter Änderung gespeichert (Browser-Test „Schließen verändert weder Downloadjournal …“ deckte das Neuschreiben auf). Texte für „Unterbrochen“ nennen das Öffnen der Helfer-App. Tests: download_unit 116/116, hls_unit 69/69, Integration 38/38 + 25/25 + 74/74, Mutation 53, Browser 29/29, 134/134, 24/24, 18/18 (gegen Desktop-Helfer `13b0893`) | Kadri-CI; nach grüner Helfer-CI Pin `helper_commit` anheben |
| 2026-11-06 | CI-Befund P1 | DONE | Helfer `8b906c5` | Mutant „Größe schon bei Journal-DONE“ überlebte in der CI (zeitabhängig). Neuer Test-Haken `done-journaled` hält den Lauf genau im Fenster – jetzt deterministisch | – |
| 2026-11-06 | P3 Pakete | DONE (CI grün) | Helfer `862c1d1` (Workflow) / Quelle `8b906c5`; Kadri `492d234` (Workflow) / Quelle `ef9a5ed` | **P4 TEST Helfer** `de.evp.helfer.p4test` versionCode 6: Lauf https://github.com/Owndot/video-assistent-helper/actions/runs/42282630066, Artefakt https://github.com/Owndot/video-assistent-helper/actions/runs/42282630066/artifacts/13536097368 (bis 2026-11-08), APK-SHA-256 `12b76b24d169e1448162c42a5aec020cb068069d8804a6215ce23098504e7776`, neues Wegwerf-Zertifikat `35207debedfca6204f57ecbe747c933a7011af87bca31c6d26d9bc06e91ad5e3` (alte P4-App deinstallieren, neu koppeln). **Kadri P4 TEST** (ID `pcccpjllneffccpenbepmfbkjedllkkf`): Lauf https://github.com/Owndot/Kadri/actions/runs/42281402671, Artefakt https://github.com/Owndot/Kadri/actions/runs/42281402671/artifacts/13535432298 (bis 2026-11-08), ZIP-SHA-256 `54dbe2d143252acd9f0bb2c3fdfaa1810f558d0d21af3a5fa78ef772f1bc8067`. Hinweis: das Feld „changes“ in `p4test-evidence.json` nennt noch den P4c-2-Text (fester Text im Workflow) – Inhalt der APK ist `8b906c5`. P4B-A10-SIZE bleibt rot | Samsung-Nachtest: F1 (Beenden/Stopp erzwingen/Neu öffnen, dann neue MP4- und HLS-Downloads), F2 (Anzeige nie > 100 %, „x/y Teile · n MB geladen“, Endgröße), P2 (während HLS/MP4-Download Helfer beenden → App öffnen → setzt ohne Webseite fort; nach Abbruch nie) |

---

### Stand bei der letzten Übergabe (2026-11-06)
- **P0** F1 (Neustart): Helfer-seitig mit echten Prozessneustarts auf API 26/29/34 **nicht reproduzierbar**; der
  nachgewiesene Kadri-Fehler (endloses „Lädt …/Startet …“ ohne Grund) ist behoben (Kadri `a494942`). Offen:
  Samsung-Nachtest mit dem neuen P4-Testpaar – falls F1 bleibt, Diagnose „Helfer-Download: …“ und den angezeigten Grund
  (`check`) erfragen.
- **P1** F2 (Fortschritt): Ursache nachgewiesen und behoben (Helfer `c977b13`, `8b906c5`; Kadri `a494942`).
- **P2** verschlüsselte Quelle: HLS (`60a831f`) und MP4 (`13b0893`, Neustart ab Byte 0 bei gleichem ETag/Länge),
  Kadri fragt „interrupted“ weiter ab (`a02c6a6`). Offen: Instrumentierung des MP4-Tresors auf dem Gerät;
  byte-genaues MP4-Fortsetzen über ein Prozessende.
- **P3** Pakete: gebaut (siehe „Fortschritt“, Zeile P3). Offen: Samsung-Nachtest durch den Eigentümer.

## CODEX – START HERE

Kopierbarer Master-Prompt für einen neuen Codex-Chat:

```
Du übernimmst die Arbeit an zwei GitHub-Repositories: Owndot/Kadri (Branch feature/c3-helper-mp4, Draft-PR #11) und
Owndot/video-assistent-helper (Branch feature/c3-browser-downloads, Draft-PR #27).

1. Lies zuerst vollständig P4C3-HANDOFF.md im Kadri-Branch (und P4C-VORBEREITUNG.md im Helfer-Branch).
2. Verifiziere die tatsächlichen Branch- und Commit-Stände (git fetch; git log) und vergleiche sie mit dem Abschnitt
   „Fortschritt“. Prüfe nur die Änderungen seit dem letzten dort eingetragenen Commit.
3. Wiederhole keine als DONE markierte Arbeit. Mache bei der ersten Aufgabe mit Zustand TODO/IN_PROGRESS/NEEDS_TEST
   weiter (Reihenfolge P0 → P1 → P2 → P3).
4. Halte alle Sicherheitsgrenzen aus Abschnitt C ein. Entferne keine Tests, schwäche keine Assertions ab, erhöhe keine
   pauschalen Sleeps. Der API-29-Befund P4B-A10-SIZE bleibt rot und wird nicht als bestanden gemeldet.
5. Keine allgemeine Neuarchitektur ohne konkreten, dokumentierten Grund. Keine neuen PRs, Merges, Tags, Releases,
   keine Produktionssignierung; release/production-policy.json bleibt UNAPPROVED; keine vertraulichen Seitennamen,
   Domains, Tokens oder Schlüssel in GitHub-Inhalten.
6. Führe nach jeder Änderung die in Abschnitt D genannten Tests des betroffenen Moduls aus; committe und pushe
   regelmäßig auf die bestehenden Branches.
7. Aktualisiere nach jedem abgeschlossenen Teilpaket P4C3-HANDOFF.md: was geändert wurde, Dateien, Commit-SHAs,
   ausgeführte Tests mit Ergebnis, offene Fehler, nächster konkreter Schritt; Zustände TODO/IN_PROGRESS/DONE/BLOCKED/
   NEEDS_TEST. Unterscheide nachgewiesen/vermutet/geplant/implementiert/getestet. Keine erfundenen Ergebnisse.
8. Grüne Tests sind keine Sicherheitsfreigabe. Testartefakte (P4-Test-APK mit Wegwerf-Schlüssel, Testerweiterung) nur
   über die vorhandenen Workflows p4-test-package.yml / p4-test-extension.yml nach grüner CI.
```
