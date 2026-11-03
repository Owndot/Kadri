# MASTER-PROMPT für Claude Code: Kadri C3

Du übernimmst die Entwicklung von Kadri und Android Helper. Implementiere die folgenden Arbeitspakete in kleinen, überprüfbaren Schritten. Lies zuerst `CLAUDE-C3-HANDOFF.md` im Kadri-Repository; sie enthält die verifizierte Bestandsaufnahme vom 03.11.2026, Quellstellen, reproduzierbare Fehlerprobe, Testmatrix und Befehle. Verwende sie als Ausgangspunkt, prüfe nur zwischenzeitliche Änderungen und die für das jeweilige Paket nötigen Details erneut. Keine weitere allgemeine Analyse- oder Website-Hotfixrunde.

## Auftrag, Branches und unverrückbare Grenzen

- Kadri: https://github.com/Owndot/Kadri, bestehender Branch `feature/c3-helper-mp4`, Draft-PR #11. Letzter verifizierter Anwendungskopf: `f992f32a80620f86e73acfbf66288a9badaaa548`; die Übergabedokumente kommen als nachfolgender reiner Dokumentationscommit hinzu.
- Helper: https://github.com/Owndot/video-assistent-helper, bestehender Branch `feature/c3-browser-downloads`, Draft-PR #27, Kopf `12022d2ee08720f855a4e7c0fd250f68fed2dd31`.
- Beide PRs waren offen, Draft und ungemergt. Prüfe aktuelle Remote-Köpfe und Arbeitsbäume. Erhalte zwischenzeitliche Änderungen, kein Reset oder Force-Push. Keine neuen Branches oder PRs.
- Du darfst auf diesen Branches Code ändern, Tests ergänzen, committen und pushen. Keine Merges, Releases, Produktions-APKs oder Produktionssignierung. Produktionsstatus bleibt **UNAPPROVED**. Eine erfolgreiche CI ist keine Produktionsfreigabe.
- Erhalte Noise-KK, strenge Nachrichtenschemata, Kopplungsbindung, SSRF-/DNS-/Peer-/Redirect-/TLS-Schutz, Dateibesitzprüfung, Idempotenz und dauerhaften Abbruchwunsch. Keine Cookies, Authorization oder Referer zum Helper; keine frei übertragbaren Header. Keine Klartext-, Browserproxy- oder automatischen Download-Fallbacks, keine allgemeinen Netzwerk-Retries. Keine neuen Berechtigungen ohne konkret nachgewiesene Notwendigkeit.
- Downloads nur nach ausdrücklicher Nutzeraktion. Webseitenereignisse sind untrusted. Keine geheimen URLs/Token/Headers in Logs oder Browserjournal. Keine bestehenden Apps deinstallieren, Kopplungen/Daten löschen oder fremde Downloads bereinigen.

## Ausgangsbefunde: bestätigt gegenüber noch offen

Kadri `7621884bec349cb4501dbfa58c418a6676e372a5` → `f992f32…` ändert nur den Test-ZIP-Workflow; Helper `ca605408924644eeba6c29b4037dd90a324bb078` → `12022d2…` nur den privaten Paketworkflow. PR-Beschreibungen sind teilweise veraltet.

Kadri-CI `41547258703` war vollständig grün: MP4-Browsertests 63/63, Download-Unit 85/85, Downloadintegration 38/38, Kanalintegration 74/74; Quellenmutationen 6 und Popupmutationen 9 erkannt. Aktuelle Kopf-CI `41547332622` hat dagegen vier fehlgeschlagene Assertions eines Login-Szenarios im Job `125626004974`; vier andere Jobs bestanden. Paketlauf `41547325899` verpackt ausdrücklich `7621884`. Helper-CI `41284921118` bestand einschließlich API 26 und 34. Diese vorhandenen Ergebnisse nicht als eigene neue Testläufe ausgeben.

Login-Log: keine Toasts, zwei Browseranfragen mit Fixture-Cookie, **null Helperanfragen**. Das belegt keinen Credential-Leak. `tests/test_mp4.py:245–252` prüft weder erfolgreiches `wait_item` noch `pick` zuverlässig; `tests/common.py:open_player` fängt das Warten auf das Brückenende ab. Die tatsächliche CI-Ursache ist noch nicht vollständig belegt.

Unabhängig reproduziert wurde eine Race in `src/180-player-bedienung.js:hdlProbe`: `st.hdl.probed=u` wird vor der asynchronen Capability-Antwort gesetzt. Wenn `hdlUrl()` beim Eintreffen vorübergehend leer/anders ist, wird die Antwort verworfen, aber dieselbe später wieder gültige URL nicht erneut geprüft. Das ist ein belegter Fehler, **noch kein Beweis** für die konkrete Login-CI oder den Samsung-HTTP-404.

Popup-Korrektur ist bereits implementiert: alte Erfolge unsichtbar, aktive Aufträge sichtbar, beobachteter Erfolg vier Sekunden, Fehler einzeln schließbar. UI-Schlüssel `kadri-download-dismissed-v1` ist vom Journal getrennt. Erhalte dies. `http_404`/`http_410` werden als „Datei nicht gefunden“ dargestellt und stammen von HTTP-Antworten, nicht von einer Prüfung lokal verschwundener Dateien. Der alte Screenshot ist nicht verfügbar; seine Einträge nicht nachträglich sicher diagnostizieren.

Der Nutzer bestätigt zwei erfolgreiche Mozilla-MP4-Downloads auf Samsung. Kinogo/cinemar-Diagnosen zeigen HLS, keine bestätigte direkte MP4. Pornhub zeigt HLS plus MP4-Kandidaten, aber einen echten HTTP-404 beim Helper; Ursache nicht bewiesen. Eporner-MP4-Einträge können Metadaten, Segmente oder Init-Ressourcen sein. Dateiendung allein beweist kein Vollvideo. Reproduzierbare Fixtures sind die Abnahmebasis, öffentliche Seiten zusätzliche Gerätetests.

## P0 – Testbasis stabilisieren, bevor die Architektur migriert wird

P0a: In `tests/test_mp4.py` und `tests/common.py` fehlenden Download-Menüeintrag und erfolglosen Klick sofort als Startvoraussetzungsfehler melden. Beim Scheitern redigiert erfassen: readyState, paused/ended, Fehlercode, srcObject vorhanden, Quellenübereinstimmung als Boolean, Brückenstatus, Menülabels und Capability-Generation. Keine vollständigen URLs oder Cookies. Login-Fixture, Cookie-Grenze und genaue Anzahl der Helperanfragen erhalten. Keine Assertions entfernen, Schutz lockern oder Sleeps pauschal erhöhen.

P0b: In `tests/download_source_check.js` einen Deferred-Promise-Regressionstest ergänzen, der bei temporärer Untauglichkeit während der Capability-Antwort anschließende Wiederprüfung fordert und am alten Code scheitert. `hdlProbe` minimal korrigieren: ausstehende Anfrage, erfolgreich geprüfter Zustand und Generation getrennt behandeln. A→B→A, ersetzten Player, verspätete Antwort, Ablehnung und vorübergehend ungeeignete Quelle testen. Keine Probe-Schleife und kein automatischer Medienabruf.

Akzeptanz: belegte Race behoben, Login-Szenario nachvollziehbar stabilisiert, passende Mutationen erkannt, vollständige relevante CI grün. Falls die Login-Ursache dadurch nicht erklärt ist, separat weiter eingrenzen; ein grüner Rerun genügt nicht. Erst dann P1.

## P1 – Gemeinsame Quellenpipeline ohne Wiedergaberegression

Heutiger Wiedergabeweg: `chrome/page.js` beobachtet MAIN-world-Netzwerk; `src/040-quellen-netzwerk.js` hält sources/plInfo/assetHits und Manifest-/Segmentbelege; `050` liest Seitendaten; `060:resolve` liefert best/alt/list/qualities; `070:phMp4/phCache` liefert vorhandene MP4-Alternativen. `120:playerSources` projiziert auf URLs plus Höhen, `130:openBrowserPlayer` hält st.sources/srcRes/cur, `170:tryNext` lädt, `190` wählt Wiedergabequalität.

Heutiger Downloadweg: `180:directUrl/hdlUrl` prüft ausschließlich st.cur, own-Modus, kein HLS, readyState/currentSrc; `hdlStart` → `080:helperDl` → `chrome/prelude.js:KADRI_DOWNLOAD` → `channel-service` → `channel-downloads.start` → Noise-KK dlstart → Helper DirectDownloads. Alternativen können noch in st.sources existieren, werden aber nicht berücksichtigt. Nicht nur den bisherigen Filter lockern.

P1a: Gemeinsames JavaScript-Modell mit strikten Validatoren und Registry, beispielsweise `src/045-media-source.js` und `065-media-registry.js`. Kein neues TypeScript-Buildsystem. Mindestens:

- Kontext: echte tabId/frameId/documentKey, lokaler playerId, mediaEpoch.
- sourceId, revision, privater flüchtiger exakter URL-Verweis.
- Typ: mp4/hls/dash/unsupported/unknown; Rolle: standalone/master/media-playlist/segment/init/track/unknown.
- Qualität, Audio, Video, Dauer und MIME jeweils mit `unknown` oder `claimed/observed/verified`, Wert und Belegkennungen. Unbekannt nicht als vorhanden, klar oder verifiziert behandeln.
- Herkunft/Frame/Seite/Zeitpunkt/Manifest-Elternbeziehung; Zuordnung unbound/ambiguous/bound mit Belegen; Schutzstatus unknown/clear/encrypted/drm; getrennte Browser-/Helper-Verifikation.
- Downloadstatus unavailable/candidate/attemptable/active und konkreter Ablehnungsgrund. „Attemptable“ bedeutet sicher auswählbarer Versuch, keine Erfolgs- oder Trackgarantie.

Schnittstellen: `observe(context, observation)`, `snapshot(context)`, `invalidate(context,cause)`, `subscribe(context,callback)`, `selectPlayback(snapshot,legacyOrdering)`, `selectDownloads(snapshot,caps)`, `resolveSelection(context,sourceId,revision)`.

Adapter für Elemente, Netzwerk, Metadaten, bestehende Siteadapter und Manifestbeziehungen. Keine neue Site-Sonderlogik. Seitennähe, Dauer oder CDN allein reichen nicht zur Bindung. Segmente/Init niemals als vollständige MP4 anbieten. Exact-URL/Query erhalten, nicht Tokens entfernen oder Parameter sortieren. Keine URL-basierte Verschmelzung verschiedener Player/Frames. Initial 64 Quellen/Player, 256/Dokument sowie begrenzte Frameanzahl; keine unbeschränkten Listen oder persistierten URL-Kataloge.

P1b: Kompatible Playback-Projektion in `120/130`, zunächst unveränderte Auswahl-/Fallbackreihenfolge und Höhenzuordnung. `170` nicht nebenbei neu schreiben. Lifecycle für Navigation, SPA, Quellenwechsel, iframe reload/remove, Playerersatz und verspätete Antworten definieren. `tools/build.js`, Chrome/Firefox/Userscript und Initialisierungsreihenfolge beachten.

Frames bestehen bereits über all_frames page.js/sub.js, `sub.want`, `background.js`-Injektion in echten sender.frameId sowie `030`-UI-Koordination. Diese sicheren Mechanismen nutzen, keine Cross-Origin-DOM-Umgehung. Blockierte/opaque Frames nicht durch zusätzliche pauschale Berechtigungen umgehen.

Akzeptanz: Quellenmodell/Negativtests/Mutationen, Kontexttrennung und begrenzter Speicher; bisherige Wiedergabe einschließlich HLS-Qualität, Audio, Seek, PiP, Brücke und Capture unverändert. Bei Wiedergaberegression stoppen.

## P2 – MP4-Alternativen unabhängig von laufendem HLS

P2a: `180` zeigt kompakte Downloadauswahl über selectDownloads. HLS darf weiterlaufen, während eine ausdrücklich demselben Asset und aktiven Player zugeordnete vollständige MP4 gewählt wird. `190` bleibt Wiedergabeauswahl. Nicht erforderliche Helperänderungen vermeiden: vorhandenes `downloads.start(url,name)` und dlstart genügen zunächst. Kein obligatorischer neuer Preflight-Befehl, der eine APK erzwingt.

Falls Hintergrundregistrierung benötigt: enges Schema wie `kadri-media/publish` und `kadri-download/startSource` mit sourceId/revision/playerId/mediaEpoch/name. Tab-/Frame-/Dokumentidentität aus Runtime-sender, nicht aus Seitenangaben. Isoliertes Inhaltsskript besitzt Registry; begrenzter Hintergrundspiegel löst nur aktuelle gebundene Quellen auf. Nach Workerrestart neu registrieren; bei fehlender/staler Bindung nicht starten. Keine zweite unkontrollierte alte Start-Route. Laufende journalisierte Aufträge bleiben vom Tab-Lifecycle unabhängig.

Auswahl allein startet nichts; ausdrücklicher Start genau einen Auftrag. Keine Medien-Probe beim Menüöffnen. Helper prüft den echten GET weiterhin unabhängig: Netzgrenzen, Redirect, TLS, Status, positive Content-Length, MIME/Signatur, Speicher. Die bestehende MP4-Signatur ist keine vollständige Track-/Containerprüfung; keine falschen Verifikationslabels. Quellen ohne ausreichende Zuordnung/Rolle bleiben gesperrt.

401/403/404/410, no_length, type, not_mp4 und Netzwerkfehler klar anzeigen. Keine automatische andere Qualität, keine Cookieübernahme. Abgelaufene Quellen nur durch erneute gültige Erkennung und bewusste Auswahl ersetzen. Journal, Idempotenz, gespeicherte Abbruchabsicht und kompakte Popup-Anzeige unverändert zuverlässig halten.

P2b: Deterministische Fixtures für direkte MP4; HLS mit zwei expliziten MP4-Alternativen; Cross-Origin-iframe ohne Hauptframevideo; Werbeiframe; zwei Videos im selben Frame; falsche Zuordnung; Init/Segmente; SPA/stale Antworten; Query-Erhalt/Tokenablauf; Login/HTTP-Fehler; Redirect/DNS/TLS; fehlende/falsche Länge; Dreifachtipp; Cancel offline und nach Browserrestart; Helperrestart; parallele Downloads; starke/schwache/geänderte ETags; Dateiintegrität; Popup. Vollständige Matrix M01–M16 der Übergabe abarbeiten.

Stop: keine Auslieferung bei roten Sicherheits-/Regressionsprüfungen. Keine Behauptung, konkrete externe Seiten seien repariert, bevor sie getestet wurden.

## P3 – Isolierte Samsung-Test-ZIP und Geräteabnahme

Gerät: Samsung Android 17 / One UI 9.0, Vivaldi Stable 8.2.4147.201, Erweiterung aus entpacktem Ordner. Test-ID **fhjmppadldgkhdgkdplpalmoooocoinn**, Produktions-ID **ladlndddhohknfpnfibchcadhgbpdlhm**. Bestehenden öffentlichen Test-Manifestschlüssel und separate Paketierung beibehalten; Produktions-Manifestprüfung nicht schwächen. ZIP nach Entpacken auf ID, Dateiliste, Berechtigungen und exakten Quellstand prüfen. Quell-SHA, Helper-Pin und SHA-256 mitliefern.

Test-App **de.evp.helfer.channeltest**, Produktion **de.evp.helfer**. Beide nutzen Port **47899**: Samsung Einstellungen → Apps → anderen Helper → „Stopp erzwingen“, dann gewünschten Helper öffnen. Keine Deinstallation/Datenlöschung und kein ADB ohne konkreten technischen Bedarf. Download/Video-Assistent ist gemeinsam; eindeutige Testnamen, exklusive Reservierung, nie fremde Dateien löschen.

Wenn Helper unverändert, **nur ZIP** liefern und vorhandene APK weiter nutzen. Der Geräte-Testschlüssel ist ein Blocker für spätere APK-Updates: `tools/build-channel-apk.sh:16–26` erzeugt pro Lauf einen RSA-3072-Schlüssel mit dreitägigem Zertifikat in mktemp und löscht ihn per EXIT-Trap. Es ist keine externe Sicherung belegt. Vor neuer APK vorhandenen Fingerabdruck und autorisierten passenden Schlüsselzugang prüfen. Fehlt der alte Schlüssel, kein gleichnamiges Update mit neuem Schlüssel vortäuschen. Stoppen, Blocker konkret melden; keine stillschweigende Deinstallation oder Paketänderung. Dauerhafter separater Testsignierweg ist vor künftigen Gerätepaketen zu klären; Produktionsschlüssel tabu. Emulator-Wegwerf-APKs bleiben intern zulässig.

Keine öffentliche Release-/APK-Artefaktablage. Keine Abhängigkeit von verlorenen privaten Schlüsseln früherer Cloud-Sitzungen. Alte Paketworkflows mit alten Pins/Empfängerschlüsseln nicht blind starten. Sichere autorisierte Bereitstellung nutzen; fehlt sie, Bereitstellung statt Sicherheitsregeln aussetzen.

Samsung-Protokoll: Produktionsinstallation/Einstellungen unverändert; Testkopplung erhalten; lokale Fixture-Fälle und reale HLS-Wiedergabe mit separat gewählter MP4 prüfen; Hash/Abspielbarkeit, Abbruch, Browserrestart, Fehlerausblenden und keine alte Erfolgshistorie. **Nach ZIP-Bereitstellung auf tatsächliches Geräteergebnis warten. P4 erst nach MP4-Abnahme beginnen.**

## P4 – Danach begrenzte HLS-VOD-Implementierung

P4a: Gepinnter Media3-Machbarkeitstest und Sicherheitsdesign. Tag `androidx/media` 1.11.1 wurde quellenbasiert untersucht, aber nicht in Kadri integriert oder sicherheitsfreigegeben. Vor Verwendung Abhängigkeiten, Lizenz, Sicherheitsmeldungen, API/R8 prüfen. HlsPlaylistParser eignet sich als Parser hinter begrenztem InputStream. Null drmInitData beweist keine Schutzfreiheit: Original-KEY/SESSION-KEY-Tags streng prüfen. HlsDownloader/SegmentDownloader sind Cache-Downloader einschließlich möglicher Schlüsselressourcen, kein fertiger sicherer MP4-Export oder C3-Journalersatz.

TsExtractor, FragmentedMp4Extractor und Mp4Muxer/ggf. FragmentedMp4Muxer im PoC prüfen: Trackausgabe, gemeinsame Zeitbasis, Interleaving, begrenzter Sampleindex/RAM, Abbruch und partielle Ausgabe. Keine Transkodierung und keine unbewiesene Annahme automatischer Speicherbegrenzung.

Erstes Profil: unverschlüsseltes endliches HLS-VOD mit ENDLIST auf allen gewählten Spuren; Master/Media, TS/fMP4, H.264/AAC-LC, Qualität und getrennte Audiospur. DRM, AES128, SAMPLE-AES, unbekannte Schutzmerkmale, Live/LL-HLS, nicht unterstützte Discontinuities/Codecwechsel/Steering/Interstitials ablehnen. Null Schlüssel-/Lizenzabrufe. DASH zunächst nur klassifizieren.

Komponenten: HlsPlanBuilder, SafeMediaDataSource, SegmentJournal, SegmentScheduler, HlsRemuxer, DownloadCoordinator. Alten HlsCore/Downloads.start **nicht aktivieren**: eigener Parser/AES128, alter Credential-/Proxyweg, unpassende Journal-/Abbruchsemantik und Video-only-Muxfallback. Direkte MP4-Engine erhalten.

Jeder Master-/Media-/Audio-/Init-/Segmentabruf und Redirect durch SafeHttpClient. Relative URLs auf tatsächliche finale Antwort-URL beziehen; keine Queryvererbung raten. DNS-/Peer-/NAT64-/TLS-/Privatnetzprüfung auf jeder Kindressource, kein DefaultHttpDataSource-Bypass, keine generellen Retries. Gehärtetes aktuelles withoutConnectionReuse-Verhalten nicht beiläufig rückgängig machen.

Eng versionierte Fähigkeiten/Plan-/Startkommandos auf bestehendem Noise-KK; Pläne im Helper, Auswahl über an Peer und Generation gebundene IDs. Alte Helper weiter MP4-only. Keine vollständigen Playlists im Kanal, strikte Größen-/Schema-/Versionsgrenzen.

Startbudgets: zwei Jobs insgesamt, vier HTTP-Anfragen global, ein Remuxer, 2 MiB Manifest, 64 Varianten, 20.000 ausgewählte Segmente einschließlich Audio, 128 MiB/Segment, 16 GiB Mediendaten/Job plus explizite Arbeits-/Ausgabequote. Kleine Puffer/begrenzte Queues; Samplegröße/-anzahl, Zeit und CPU/RAM messen und begrenzen. Werte bei belegtem Bedarf begründet ändern, nicht abschaffen.

P4b: App-privates versioniertes Journal, Jobgeneration, unveränderliche Auswahl/Planfingerabdruck, Segmentfolge, starke Validatoren, lokale Hashes und Besitzdaten. Geprüfte Segmentdatei fsync/atomar bestätigen, dann Journal. Nach Crash nur bestätigte passende Segmente nutzen. Nach Neustart bewusstes Fortsetzen über erneut erkannte Quelle; keine sensiblen Browser-URL-Journale oder Boot-Autostarts. Identität/Plan/Validatoren müssen sicher passen; sonst bewusster vollständiger Neustart statt Mischen. Teilsegmentresume nur starker ETag/If-Range/exakte206.

Persistenter Cancel gewinnt vor Resume/Start. Calls, Queue, Parser und Mux abbrechbar; alte Generation darf nicht veröffentlichen. Veröffentlichung nutzt vorhandene Besitz-/MediaStore-Regeln. Vollständig veröffentlichte Datei bleibt Erfolg trotz späterem Aufräumfehler. Kein stiller Video-only- oder TS-Fallback. API26/34, volle Speicherlage, Prozessabbruch an jeder Schreib-/Commitgrenze, paralleles MP4/HLS und Matrix H01–H06 testen. Android-17-Vordergrunddienst/Langzeitverhalten ausdrücklich prüfen.

P4c: Erst nach grünen Tests und geklärter Testsignierung isoliertes Testpaar, dann Samsung-Langzeittest mit Hintergrund, Bildschirm aus, Netzwechsel und Neustarts. Keine Produktionsfreigabe.

## P5 – DASH evaluieren, nicht nebenbei implementieren

MPD nur erkennen/klassifizieren. Erst nach HLS-Abnahme eigenen Bericht über SegmentTemplate/Timeline, Perioden, Trackkombination, DRM/XXE, sichere Ressourcenlimits und Profile erstellen. Keine automatische Umfangserweiterung.

## Tests, Commits und Abschluss jedes Pakets

Setup-Versionen aus aktueller `.github/workflows/ci.yml` übernehmen; Node 22, JDK17, gepinnte Playwright-/Rust-/WASM-Werkzeuge. Im Kadri-Checkout mindestens:

```bash
node tools/build.js --test
node tests/download_source_check.js --mutations
node tests/popup_downloads_check.js --mutations
node tests/channel/channel_unit_check.js
node tests/channel/download_unit_check.js
node tests/channel/download_regression_check.js
node tests/helper_route_check.js
node --expose-gc tests/pip_lifecycle_check.js
node tests/referrer_check.js
node tests/header_context_check.js
bash tests/package_upload_gate_check.sh
```

HELPER_REPO bewusst auf Helper-Checkout, C3_TEST_ROOT auf beschreibbare Testablage setzen; keine Systemvariablen zweckentfremden:

```bash
mkdir -p "$C3_TEST_ROOT"
bash "$HELPER_REPO/tests/java/channel/build.sh" "$C3_TEST_ROOT/helper-host"
export HELPER_HOST_DIR="$C3_TEST_ROOT/helper-host"
node tests/channel/channel_integration_check.js
node tests/channel/download_integration_check.js
node tests/channel/channel_browser_check.js
node tests/channel/channel_netguard_failure_check.js
node tests/channel/channel_mutation_check.js
TESTS="test_helper.py test_menu.py test_mp4.py" bash tests/run_all.sh
```

Gesamte normale CI einschließlich Wiedergabe-/Firefox-/Datenschutzchecks ausführen. Bei Helperänderungen zusätzlich `tools/check-network-layer.sh` samt `--self-test`, Java-Tests und Mutationen unter `tests/java/{channel,net,dl}` sowie native/API26/API34-Prüfungen aus `.github/workflows/helper-channel.yml`; genaue Befehle in der Übergabe. Helper-Pin `vendor/kadri-pairing-poc/SOURCE` und ggf. WASM-Provenienz kontrolliert aktualisieren.

Fixtures nutzen statt nur öffentliche Seiten; Loopback-/Test-TLS-Ausnahmen ausschließlich im Harness. Bestehendes Test-MP4 ist VP9 im MP4-Container, kein Beleg für AVC/AAC; passende HLS-Medien ergänzen. Mutationen müssen gezielt falsche Bindung, Rollenverlust, unknown→verified, Queryverlust, stale Antworten, fehlende Nutzeraktion, verlorenes Cancel, schwachen ETag und ungeprüfte Kindressourcen erkennen.

Nach jedem abgeschlossenen Paket: gezielt stagen, committen, ohne Force auf bestehenden Branch pushen, CI für **genau diesen SHA** prüfen, relevante Mutationen und Sicherheitsgrenzen dokumentieren. Keine grünen Zahlen anderer Commits übernehmen. Bericht: Ursache, Änderungen/Dateien, exakte Hashes, selbst ausgeführte Tests versus vorhandene CI, offene Risiken, nächstes Paket. Routinedetails selbst entscheiden und selbstständig bis zum nächsten echten Stop-Kriterium fortfahren. Keine wiederholten Planungs-/Umgebungsrückfragen. Bei roter Sicherheitsprüfung, ungeklärter Signieridentität, erforderlicher destruktiver Migration oder fehlender Geräteabnahme konkret stoppen. **UNAPPROVED bleibt unverändert.**
