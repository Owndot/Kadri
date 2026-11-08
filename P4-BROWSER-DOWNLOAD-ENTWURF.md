# Browsergestütztes Speichern – geprüfter Ausgangspunkt, noch kein freigegebener Modus

Stand: 2026-11-08. **TODO / NEEDS_TEST**, keine Implementierung und keine Sicherheitsfreigabe.
Produktion bleibt **UNAPPROVED**. Bestehende Direktdownloads, Noise KK, SafeHttpClient und Abbruchvorrang bleiben erhalten.

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

## Kleinstmöglicher nächster Versuch

**TODO – isolierte Machbarkeitsprüfung**, kein allgemeiner Browserproxy:

- Kontrollierte MP4/HLS-Fixtures: normale Sitzung liefert Medien, anonymer Abruf liefert bewusst 412;
  nachweisen, ob derselbe zulässige Browser-Kontext Medien ohne Credential-Export zugänglich macht.
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

Reine Code-/Dokumentationsprüfung. Keine neue reale Seitenanalyse, kein neuer Gerätetest, kein APK-/Erweiterungsbuild
für diesen Entwurf. Die letzte gelieferte Erweiterung bleibt Quellstand `7811d5a`; Helper bleibt unverändert.
