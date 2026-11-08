# Browsergestütztes Speichern – geprüfter Ausgangspunkt, noch kein freigegebener Modus

Stand: 2026-11-08. **DONE – erster isolierter Machbarkeitsversuch; neuer Modus BLOCKED**, keine Produktimplementierung und keine Sicherheitsfreigabe.
Produktion bleibt **UNAPPROVED**. Bestehende Direktdownloads, Noise KK, SafeHttpClient und Abbruchvorrang bleiben erhalten.

## Verbindliches Produktziel nach Präzisierung des Eigentümers

**DONE – Entscheidung:** ausschließlich vollständiger Download unabhängig von der Wiedergabe.
Passives Mitspeichern ist **keine gewünschte Produktlösung**; keine Aufnahme-UI implementieren.
Die folgenden Capture-/Ablageprototypen bleiben isolierte technische Nachweise, keine Produktzusage.
Aktuelle Teststände: Kadri `0fa3bcbd8cad843d8cda9ea43aa78e2b5b989f4e`, Helper
`95aa0f563cdedb29a7f42cdd90b74497970bfb2f`; letzter lokaler zusammengesetzter Lauf 51 + 26 Prüfungen.

**IN_PROGRESS – nächster Abrufnachweis:** explizites `targetAddressSpace: "public"` bei Chromium prüfen,
mit getrennten TCP-/HTTP-Zählern, direktem Fetch versus Request-Objekt und kontrollierter Herkunft.
[WICG-Diskussion der Implementierung](https://github.com/WICG/local-network-access/issues/60) nennt
Unterschiede zwischen Spezifikation, Implementierung und Verbindungs-/Anfragephase; keine Freigabe daraus ableiten.
[Chrome-Dokumentation](https://developer.chrome.com/docs/modern-web-guidance/guides/security/local-network-access)
beschreibt Zieladressräume und Tests mit simuliertem öffentlichem Ursprung. Testoptionen verändern
nur frische synthetische Browserprofile; keine Produkt-/Browserrichtlinienänderung.

## Zweiter Versuch – vorhandener Kadri-Player mit H.264/AAC

**DONE – isolierter Prototyp**, ausschließlich `tests/experiments/passive_capture.js` und
`tests/passive_player_capture.py`, nicht Bestandteil eines Erweiterungsbuilds.
Der vorhandene System-Chromium 156 unterstützt H.264/AAC; die frühere Decodergrenze betrifft den
separaten Playwright-Chromium 141, nicht sämtliche lokal verfügbaren Browser.

- Der Test lädt die tatsächlichen `src/*.js` und öffnet deren eigenen Player. Testinstrumentierung
  legt die Quellenauswahl fest und macht den Playerzustand erreichbar. **Kein Nachweis der Registry-
  Autorisierung oder Erweiterungsisolation**; keine verwaltete Browserrichtlinie verändert.
- H.264/AAC, integrierte Tonspur, unverschlüsseltes fMP4-VOD, 20 Sekunden: Init und fünf Segmente
  byteidentisch erfasst. Dieselben Medienanfragen wie beim Player ohne Beobachter, kein vergrößerter
  Puffer und kein veränderter Startpunkt. FFprobe bestätigt Tracks/Dauer; FFmpeg decodiert die
  vollständige Datei einschließlich Ton ohne Fehler. Das ist ein überprüfter **Dateikandidat**, keine
  automatische Veröffentlichung und kein Sicherheitsnachweis für beliebige fremde Container.
- Fehlendes Segment, Einstieg bei Sekunde 12, widersprüchliches Duplikat, Nutzerabbruch (auch nach
  Empfang des letzten Segments), Speicherlimit, tatsächliches Player-Schließen und Ersatzplayer:
  kein Dateikandidat, eigene Bytes/Quellenzuordnung verworfen. Identische Duplikate werden nicht
  doppelt angehängt. Wiedergabe bleibt bei den Beobachterfehlern funktionsfähig.
- Quellen-/Qualitätswechsel werden mit gezielten Benachrichtigungen an den Beobachter geprüft;
  **keine vollständigen End-to-End-Wechseltests** mit mehreren realen Varianten. Quellenwahl bleibt
  im Test festgelegt. Vorschauplayer wird ausdrücklich nicht mit dem Hauptplayer vermischt.
- **DONE – konkrete Lücke im ersten Prototyp reproduziert und behoben:** `closePlayer()` setzt `vp`
  sofort auf null, zerstört HLS aber verzögert (normalerweise nächstes Bild, spätestens nach 250 ms;
  eingebettete Fenster können auf die Größenänderung warten). Nur `DESTROYING` zu beobachten lässt
  dazwischen einen Dateikandidaten zu. Der Prototyp prüft nun zusätzlich die aktuelle Playerinstanz
  vor Datenannahme und vor `finish()`. Die Gegenprobe mit absichtlich ausgeschalteter Bindung
  reproduziert die Lücke im selben JavaScript-Task. **Kein behaupteter Fehler bestehender Downloads**,
  keine Änderung an deren Abbruchlogik. Verspätete Metadaten reaktivieren einen Abbruch nicht.
- **DONE – lokaler Lauf 51 Prüfungen**, System-Chromium `156.0.8078.79`.
  **IN_PROGRESS – CI** in der bestehenden Pipeline, dort installierter Chrome mit H.264/AAC.
  Kein neues Paket, keine APK und keine Änderung des Helpers oder der Produktdateien.

Reproduktion: `KADRI_CAPTURE_CHROMIUM=/usr/bin/chromium python3 tests/passive_player_capture.py`
(Playwright, FFmpeg/FFprobe, vorhandener Browser mit H.264/AAC). Der Test setzt keine echte Sitzung
voraus und verwendet ausschließlich lokale bekannte Testmedien. Ausgabe enthält nur feste Gründe,
Zähler und Testnamen. Prototypgrenzen: 4 MiB insgesamt, 1 MiB je Ressource, 2048 Segmente;
keine Disk-Ablage, keine Übertragung, kein automatisches Wiederanlaufen und keine Produktionstauglichkeit.

## Dritter Versuch – Browserdaten durch vorhandenen Helper-Remuxer

**DONE – lokaler zusammengesetzter Nachweis:** `tests/passive_player_capture.py --export-fixture DIR`
exportiert erst nach sämtlichen 51 Prüfungen die bekannte lokale Fixture als nummerierte Mediendateien,
Längen/SHA-256 und 20-s-Dauer. Keine URL-, Header- oder Sitzungsfelder. Dieses lokale Testformat ist
kein Netzwerkprotokoll. Der isolierte Helper-Prototyp nimmt die Daten in 16-KiB-Blöcken auf, prüft
Reihenfolge, Offset, Ressourcenlängen und Hashes, schreibt private temporäre Dateien und prüft die
Hashes vor dem Remux erneut. Anschließend läuft der **unveränderte** `Media3HlsRemuxer` samt seiner
Spur-/Sample-/Zeit-/Dauerprüfung; FFmpeg decodiert die tatsächliche Ausgabe vollständig.

Helper-Testcommit **`2746b8f2154a98ce70701c084a25246aef91fd9a`** auf dem bestehenden Branch;
[Details und Reproduktion](https://github.com/Owndot/video-assistent-helper/blob/2746b8f2154a98ce70701c084a25246aef91fd9a/P4-PASSIVE-MEDIA-PROBE.md).
**24/24** lokale Ablageprüfungen mit Fixture-Dateien, **25/25** mit dem tatsächlichen Browserexport.
Abbruch vor Remux und unmittelbar nach erfolgreicher Verifikation verhindert den Zustand `verified`;
Fehler/Abbruch bereinigen private Medien. HTML wird trotz gültigem Hash durch den Remuxer abgelehnt.
Ein lokaler Abbruchmarker bleibt beim Wiederöffnen gesperrt; unterbrochene Aufnahmen starten nicht neu.

**IN_PROGRESS – Helper-CI:** [HLS-Prüfungen](https://github.com/Owndot/video-assistent-helper/actions/runs/42513744679).
Weitere bestehende Helper-Workflows laufen ebenfalls. Nur Testdateien und Dokumentation geändert;
App-Code `8b906c5`, Kadri-Pin, Noise-Kern, Validatoren und Netzwerk-Endpunkte unverändert.

**BLOCKED – Produktverbindung:** Testablage hat keine Kanal-/Auftragsautorisierung, globale Quote,
Android-Dauerhaftigkeitsprüfung oder Veröffentlichungsfunktion. Markerdatei lokal synchronisiert,
Elternverzeichnis nicht; kein Android-Prozess-/Stromverlustnachweis. Kein Resume implementiert.
Browserexport und Java-Eingang sind durch lokale Testdateien verbunden, **nicht über Noise/HTTP**.
Der vorhandene Rust-Kern kennt zwar typisierte Media-/End-Records, aber der Kadri-WASM-Sender bietet
nur `seal_control` an und der App-`ChannelServer` lehnt andere Recordarten ausdrücklich ab.
Diese Grenzen wurden nicht geöffnet. Kein Abspielen-zu-Download-Versprechen für reale Seiten.

## Einordnung für einen tatsächlich nutzbaren Download

**BLOCKED – als fertiger Downloadmodus:** Die bisherige Übernahme sammelt nur das, was während der
Wiedergabe tatsächlich ankommt. Sie kann weder fehlende Anfangssegmente noch übersprungene Teile
ersetzen und verspricht kein schnelles vollständiges Herunterladen eines langen Films. Ein Menüpunkt
„Herunterladen“ wäre dafür derzeit irreführend. Kein ungeprüftes Nachladen als Ausweg ergänzen.

**TODO – nächster Schritt:** typisierten authentisierten Medientransfer mit Auftrag-/Absenderbindung
auf Grundlage der vorhandenen Noise-Records isoliert prüfen. Adressfreie Testablage und vorhandene
Helper-Containerprüfung sind oben lokal verbunden, noch keine App-Integration. Vor einem Produktpfad müssen
Quell-/Frame-Autorisierung, vollständige Medienvalidierung, Speichergrenzen und Abbruch bis zur
endgültigen Veröffentlichung zusammen nachgewiesen sein. Aufnahme aus dem laufenden Browser bleibt
abhängig von dessen Lebenszyklus; die unabhängigen Samsung-PASS gelten dafür nicht. Eine neue
Sicherheitsgrenze oder Produktionsfreigabe wird aus dem Prototyp nicht abgeleitet.

## Erste experimentelle Ergebnisse

**DONE – lokale Browserprüfung, 25 Nachweise einschließlich passiver Übernahme:** `tests/browser_download_feasibility.py`,
Desktop Chromium 141 / Playwright 1.56, frisches Profil, ausschließlich temporärer lokaler HTTPS-Server,
synthetisches HttpOnly-Cookie und vorhandene H.264/AAC-Testmedien. Keine echte Sitzung, kein Helper-Upload.

- Dieselbe MP4: anonymer Fetch HTTP 412; normaler Same-Origin-Fetch HTTP 200, bytegenaues SHA-256-Match.
  HttpOnly-Cookie ist für Seiten-JavaScript unsichtbar, kein Auslesen/Export erforderlich.
- HLS: anonyme Hauptliste HTTP 412; mit Browser-Sitzung Haupt-/Medienliste, Init und sämtliche fünf
  Segmente byteidentisch. Noch kein HLS-Remux oder Beweis zum Verhalten auf realen Seiten.
- Nativer MP4-Download über einen normalen Download-Link: byteidentische Datei ohne Helper oder neue
  Erweiterungsberechtigung. Das ist **kein** Nachweis der Chrome-Downloads-API auf Vivaldi Android.
- `redirect:error` verhindert die Zielanfrage bei fremdem Host und privater IP. Normales Folgen einer
  fremden Weiterleitung erreicht dagegen das Ziel trotz anschließender CORS-Verweigerung. Keine
  Weitergabe des Cookies der Ursprungsseite an den anderen Host beobachtet.
- Öffentlich aussehender Testhostname, kontrolliert auf Loopback aufgelöst: Anfrage erreicht den
  Server vor CORS-Verweigerung. **BLOCKED – CORS/Hostname-Allowlist reicht nicht als IP-/Peer-Grenze.**
  Statische DNS-Zuordnung, **kein** dynamischer Rebinding-Test und keine öffentliche Ausgangs-IP.
- Logout verhindert den folgenden Medienabruf. Gleicher MIME-Typ macht Init nicht zur vollständigen
  MP4: ffprobe zählt dort keine Medienpakete, in der MP4 dagegen schon.

**DONE – bestehender Kadri-Pfad:** vollständige CI zu `2025bb244d7fafed5f378e5a873f0972763210e5`,
[42471919334](https://github.com/Owndot/Kadri/actions/runs/42471919334), alle fünf Jobs grün.
27/27 Nachweise vor Ergänzung der passiven Übernahme. Über den echten `kadri-xhr`-Port mit echtem
Tab-Absender sind direkte private IP und der private Redirect blockiert, der auf Loopback aufgelöste
Testhostname erreicht dagegen den Server (HTTP 200). Unveränderte Hintergrund-/DNR-Regeln geprüft.
Lokal verhindert die verwaltete Erweiterungsrichtlinie das Laden; sie wird nicht verändert.
Grüne Experimenttests bedeuten nur belastbare Beobachtungen, ausdrücklich **SAFETY_GATE BLOCKED**.
Frame-/Quellautorisierung, dynamisches Rebinding, Medienupload und Android-Lebenszyklus bleiben ungeprüft.

**DONE – engerer lokaler Versuch: passives Kopieren der tatsächlichen Player-Ladeantworten.**
Ein eigener Testplayer mit dem vorhandenen hls.js lädt eine vorhandene 60-s-VP9/Opus-Fixture.
Ein Beobachter kopiert Init und zwölf Segmente vor der Übergabe des Puffers an den Player-Worker;
keine eigenen Medienabrufe, kein Auslesen von Cookies. Alle 13 Ressourcen byteidentisch, jede Liste/
Medienressource genau einmal abgerufen. Lokales Zusammenfügen ergibt laut ffprobe zwei erwartete
Tracks und die volle Fixture-Dauer; Zusammenfügen und Prüfen erzeugen keine weiteren HTTP-Anfragen.

Grenzen: Der Test konfiguriert ausdrücklich 120 s Player-Puffer für die kurze Fixture, maximal 4 MiB
Kopien und 1 MiB je Ressource. Das ist kein Beweis für passive Vollaufnahme eines beliebigen bestehenden
Players oder großer Videos. H.264/AAC-Wiedergabe wird vom lokalen Test-Chromium nicht unterstützt;
VP9/Opus belegt die Byteübernahme, gehört aber **nicht** zum unterstützten HLS-Eingang des Helpers.
Kein Produktpatch, Remux-/Integritätsnachweis für beliebige Medien, Helper-Upload oder Samsung-Test.
Ein später `FRAG_LOADED`-Beobachter war im Versuch unzuverlässig, weil hls.js den ArrayBuffer bereits
an seinen Worker übertragen hatte. Kopieren direkt vor dem unveränderten ursprünglichen
Loader-Callback funktionierte. Nicht als Ursache der realen Downloadfehler interpretieren.
**DONE – CI einschließlich der vier zusätzlichen Capture-Prüfungen: 31/31 Nachweise, alle fünf Jobs grün.**
Lokales Ergebnis ohne Erweiterung 25/25. Bestehende Kanal-/MP4-/HLS-/Browserregressionen ebenfalls grün;
keine Sicherheitsfreigabe und kein Samsung-Nachtest daraus ableiten.
Testcommit `1c494aa48894b63becfc263ea8c30375e8a47c38`,
[Lauf 42480391885](https://github.com/Owndot/Kadri/actions/runs/42480391885).

**DONE – konkrete Integrationsgrenze aus dem Code:** `src/170-player-laden.js:140` startet hls.js
an `st.startTime` und deaktiviert dessen Worker. Der im Test beobachtete Worker-Puffertransfer ist daher
kein nachgewiesener Fehler dieses Produktpfads. Eine passive Aufnahme ab aktuellem Wiedergabezeitpunkt
enthält nicht automatisch den Videoanfang. `tryNext()` zerstört außerdem die alte Playerinstanz bei
Quellwechseln. Eine spätere Implementierung muss diese Lücken/Wechsel erkennen; nichts stillschweigend
nachladen, Aufnahmen unterschiedlicher Quellen nicht vermischen und keine Vollständigkeit behaupten.

Reproduktion ohne Erweiterung: `python3 tests/browser_download_feasibility.py` (Playwright 1.56,
Chromium, openssl, ffprobe). Mit bestehendem Test-Build: `node tools/build.js --test`, dann
`python3 tests/browser_download_feasibility.py --extension dist/test`.
Temporäres Fixture-Zertifikat und DNS-Mapping gelten nur für den Testbrowser, nie für ein Lieferpaket.

## Nachweis aus der alten Version

Kadri `e24a0ba43c39f9c3f7a6618393d5aca5ec341412` (vor der Kanalumstellung),
`src/180-player-bedienung.js:158–170`: `helperDownload()` las bei passender Seitendomäne
`document.cookie` und übergab gegebenenfalls Cookies sowie Referer und Browserkennung im alten Downloadaufruf.
Das waren nur JavaScript-lesbare Cookies, nicht sämtliche Cookies einschließlich HttpOnly.
Außerdem bot der Browserpfad `proxyLoop()` an: Helper fordert Ressourcen an, Browser lädt mit zulässiger
Sitzung und schiebt Antwortdaten zurück. Helper `Fetcher.Http`/`Downloads.start` unterstützen diese alten Wege.

**DONE – Unterschied nachgewiesen:** Der heutige P4-Pfad lässt den Helper selbst ohne Browser-Sitzung laden.
Die Verschlüsselung zwischen Erweiterung und Helper verhindert nicht die grundsätzliche Übertragung von
Mediendaten; die heutige Befehlsmenge/Netzwerkarchitektur bietet diesen Transfer jedoch nicht an.
Cookies einfach verschlüsselt zu übertragen löst das Vertrauensproblem nicht: der Empfänger hätte sie weiterhin.

**BLOCKED – Ursachenbeweis auf realen Seiten:** Der Eigentümer meldet weiterhin ausbleibenden Erfolg.
Aus früherem Erfolg folgt nicht, dass Cookies allein die heutigen MP4-404/HLS-412 verursachen.
Wiedergabequelle, Datei-/Playlistrolle, HTTP-Anfrageart, Redirects und Browser-Kontext können sich unterscheiden.
Kein Test mit realen URLs oder Sitzungsdaten durchgeführt; keine privaten Namen/Adressen hier dokumentiert.

## Empfohlener Kandidat: Browser lädt, Helper verarbeitet ausschließlich Medien

1. Nutzer wählt genau ein aktuell gebundenes Video und ausdrücklich diesen Modus; kein automatischer
   Wechsel nach 404/412. Vorhandene Prüfung auf vollständige MP4 statt Init-Datei/Segment bleibt bestehen.
2. Sitzung bleibt beim Browser. Keine Cookie-Exportfunktion, kein `document.cookie`-Export, kein Übertragen
   von Authorization, Referer oder Browserprofilen. Normale Browserregeln entscheiden über eigene Requests;
   keine nachgebauten Header oder künstlich erweiterte Cookie-/Domainfreigabe.
3. Browser verwaltet die erlaubten Medienressourcen für diesen Auftrag. Webseiten-/Content-Script-Angaben
   allein sind kein Vertrauensbeweis. Der Helper kann **keine URLs anfordern** und keine Browserzugriffe steuern.
4. Zum Helper gehen ausschließlich geprüfte Mediendaten und eine minimale adressfreie Zuordnung
   (Auftrag, Ressource, Reihenfolge, Länge/Integrität). Keine HTTP-Antwortheader und keine originalen Playlists
   mit signierten URLs. Eigener typisierter Medientransfer über den authentisierten Kanal erforderlich;
   aktuelle Kontrollnachrichten nicht zu beliebigen JSON-/URL-Proxys erweitern, kein alter Klartextport.
5. Empfang strikt an Auftrag, Quelle und Sitzung binden; begrenzte Blöcke und Rückstau, keine ganzen Filme im RAM.
   Dauerhafter Abbruch sperrt auch verspätete Blöcke und Neustarts. Keine Veröffentlichung vor vollständiger
   Container-/Track-/Längen-/Integritätsprüfung; nur notwendige, sicher gespeicherte Wiederaufnahmedaten.

Das ist ein **Entwurf**, kein bereits sicherer oder funktionierender Ersatz. Besonders offene Nachweise:

- **NEEDS_TEST – Browser-Kontext:** Erweiterungsfetch ist nicht automatisch derselbe Kontext wie die
  laufende Wiedergabe. SameSite, partitionierte Cookies, Frames und CORS müssen auf Vivaldi geprüft werden.
  Keine pauschale Änderung von `anonymous` oder `credentials` im vorhandenen Hintergrundclient.
- **BLOCKED – gleichwertige Netzwerkgrenzen:** Eine URL-Allowlist oder Prüfung nach der Antwort reicht nicht
  gegen Redirects ins private Netz/DNS-Rebinding. SafeHttpClient prüft vor Verbindungen DNS und Peer;
  der Browserpfad muss gleichwertige Grenzen nachweislich einhalten, bevor er als Ersatz eingesetzt wird.
  Falls das nicht gelingt, keine Absenkung der Schutzarchitektur. Bereits rechtmäßig empfangene Medien lokal
  verarbeiten ist gesondert zu prüfen; eine Vollaufnahme darf nicht aus wenigen Playback-Segmenten behauptet werden.
- **NEEDS_TEST – Android-Lebenszyklus:** Browser geschlossen oder beendet kann den Datenzufluss stoppen.
  Bildschirm aus, Hintergrundbetrieb und Wiederaufnahme sind in diesem Modus nicht durch die PASS-Ergebnisse
  des unabhängigen Helpers abgedeckt. Diesen Unterschied im Produkt offen benennen.
- **TODO – Protokoll:** heutiger Kadri-Client sendet Kontrollrecords, keine Medienuploads. Neuer begrenzter
  Datenpfad benötigt beide Repositories, Protokoll-/Missbrauchstests und erst danach isolierte P4-Gerätetests.
  Keine neue Kryptografie entwerfen und keine existierenden Kontrollvalidatoren aufweichen.
- DRM, Zugangsverweigerung und sonstige serverseitige Beschränkungen werden nicht umgangen.

## Weitere Entwicklung

Der H.264/AAC-Player-/Vollständigkeitsversuch ist oben abgeschlossen. Maßgeblicher nächster Schritt
und verbleibende Produktgrenzen stehen unter „Einordnung für einen tatsächlich nutzbaren Download“.
Der native MP4-Link ist separat auf Vivaldi Android **NEEDS_TEST**. Reale HTTP-404/412-Ursachen bleiben offen.

Weitere verbleibende Prüfungen, kein allgemeiner Browserproxy:

- **DONE – kontrollierte MP4/HLS-Fixtures:** normale Sitzung liefert Medien, anonymer Abruf bewusst 412;
  der getestete Browser-Kontext macht Medien ohne Credential-Export zugänglich.
- Negativfälle vor einem Transfer: fremde Quelle/Frame, Quelle gewechselt, fremde Redirects, private Adressen,
  DNS-Rebinding, manipulierte Playlist, Init statt MP4, HTML/JSON statt Medien. Blockierung vor dem unzulässigen
  Request prüfen, nicht nur nachträgliches Verwerfen der Antwort.
- Medientransfer erst danach: fremde Auftragskennung, Replay, Reihenfolge, Speichergrenzen und Abbruch nach
  Neustart testen. Kein Zugangsdatenfeld im Protokoll. Öffentliche Test-Fixtures verwenden.
- Für echte MP4-Dateien zuerst den einfacheren Browserdownload bewerten: Browser speichert selbst;
  der Helper braucht keine Sitzung. Die Chrome-Downloads-API unterstützt Cookies am Zielhost, braucht aber
  eine zusätzliche Berechtigung und einen Nachweis der Unterstützung in Vivaldi Android. Sie baut aus HLS
  nicht automatisch eine MP4. Keine geratenen MP4-Adressen und kein Versprechen universeller Unterstützung.

## Primärquellen (am 2026-11-08 geprüft)

- [Historischer Kadri-Aufrufer](https://github.com/Owndot/Kadri/blob/e24a0ba43c39f9c3f7a6618393d5aca5ec341412/src/180-player-bedienung.js#L158)
- [Chrome: Cross-origin requests, insbesondere keine beliebigen URLs aus Content-Scripts](https://developer.chrome.com/docs/extensions/develop/concepts/network-requests)
- [Chrome: Downloads-API, Berechtigung und Verwendung der Cookies des Zielhosts](https://developer.chrome.com/docs/extensions/reference/api/downloads#method-download)
- [Chrome: Storage/Cookies, Partitionierung und SameSite-Unterschiede](https://developer.chrome.com/docs/extensions/develop/concepts/storage-and-cookies)

Keine neue reale Seitenanalyse, kein neuer Gerätetest, kein APK-/Erweiterungslieferpaket für diesen Entwurf.
Die letzte gelieferte Erweiterung bleibt Quellstand `7811d5a`; Helper bleibt unverändert.
