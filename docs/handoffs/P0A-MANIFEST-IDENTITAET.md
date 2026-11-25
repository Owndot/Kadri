# P0-A · MPD-Identität vor der Medienauswahl

Produktbasis ist B.2 `7fe954f2484f1e5790c84bc6079aedff19945def` auf B.1 `cbeac18dcef5cbc2676b30211b46abbb1b6adfbc`. Der isolierte Produktbranch ist `fix/p0a-manifest-identity`. Der Nachreview-Commit `9455514e74bba58befe617b254db2b85d7f19d9c` diente als Prüfgrundlage. [Nachreview](https://github.com/Owndot/Kadri/blob/9455514e74bba58befe617b254db2b85d7f19d9c/docs/handoffs/CODEX-NACHREVIEW-P0-A.md)

## Ursache und Lebensdauer

`addSource` hält bis zu 40 Netzwerkadressen. `recent()` liefert die Einträge seit der letzten SPA-Navigation oder greift bei einer leeren Auswahl auf den Bestand zurück. Daneben bezieht `resolve` Kandidaten aus dem Videoelement, aus dem Netzabgleich sowie aus Seiten- und Adapterdaten. Eine unveränderte Adresse kann daher auch nach einem Wechsel der Netzliste erneut erscheinen. Die Elementregistry hält bis zu 16 Player, 64 Quellen je Player und 256 je Kontextdokument. Ihre Einträge können beim Medienwechsel, Elementersatz, Registry-Überlauf oder SPA-Wechsel entfallen.

`dashInfo` hält Analysedaten für bis zu 40 URL-Schlüssel. Die pfadbasierte Playlist-Tabelle mit bis zu 80 Einträgen und die Tabelle für Stück- und Unterlistenrollen erfassen HLS-Heuristiken. Insbesondere liefert ein Treffer im selben Pfad keine exakte DASH-Klassifikation für eine andere Query. Auf B.2 fiel das Veto für eine irreführend benannte URL mit der Manifestzusammenfassung weg, wenn noch keine aktive Auswahl oder passende Elementbeobachtung vorlag.

## Korrektur

Nach erfolgreichem MPD-Parsing speichert `notePlaylist` das Veto für Anfrageadresse und tatsächlich beobachtete MPD-Endadresse. Der gemeinsame Schlüssel `dashUrlKey` verwendet normalisierte Herkunft, Pfad und Query ohne Fragment. Die Query wird nicht sortiert oder dekodiert. Eine spätere Auflösung setzt keine Klassifikation auf ihr hypothetisches Ziel. Das Ziel erhält ein Veto, wenn Kadri es selbst als MPD beobachtet hat.

Die Identität bleibt im Inhaltsskript des tatsächlichen HTML-Dokuments erhalten. SPA-Navigation und neue Registry-Epochen setzen weiterhin Bindungen und Auswahlen zurück. Bei neuem Dokument oder unabhängigem iframe beginnt ein eigener Bestand. Aktive Player und B.2-Ausgaben behalten ihre eigenen Lebensdauerprüfungen. Der bestehende WeakRef-Bestand verweist nur schwach auf Auswahlen. Tote Hüllen werden bei der nächsten Registrierung oder MPD-Beobachtung entfernt. Die neue Identitätsverwaltung speichert keine Elemente, Auswahlen, Manifesttexte oder permanenten Adressen.

| Datei | Relevante Änderung |
|---|---|
| `src/040-quellen-netzwerk.js` | `rememberMpdIdentity`, `knownMpdIdentity`, `admitMediaIdentity` und `mediaIdentityKey` trennen Identität und Analyse. `notePlaylist` hält das Veto ab Parsing fest. `addSource` und `mediaRoleHint` verwenden dieselbe Identität. |
| `src/045-media-source.js` | `mediaIsDashManifest` verwendet die bestätigte Identität. `mediaSourceAllowed` liefert die gemeinsame Freigabebedingung. `mediaOutputFor` prüft sie auch für Ausgaben ohne Videokontext. |
| `src/060-quellen-zuordnung.js`, `src/120-player-stil.js` | `resolve` filtert die allgemeine Kandidatenliste vor der Auswahlgrenze. `playerSources` prüft alle Eingänge einschließlich Element- und Adapterquellen. |
| `src/065-media-registry.js` | `playbackAllowed`, `resolveSelection` und `resolveStream` verwenden die gemeinsame Ausgabebedingung. B.1-Lader, Qualitätswechsel, Vorschau und B.2-Ausgaben greifen darüber auf dasselbe Veto zu. |
| `src/035-fenster-oberflaeche.js`, `src/105-download-knopf.js` | `fuiFrameAct`, `fuiFramePick` und `pageDlDirect` prüfen die gemeinsame Bedingung vor der Übergabe aus dem Ursprungsfenster beziehungsweise beim Erstellen einer Browserdatei-Aktion. |

## Budgets und Restgrenzen

Die Verwaltung speichert höchstens 512 bestätigte MPD-Schlüssel mit irreführender oder fehlender Endung und bis zu 256 zuletzt zugelassene Schlüssel, jeweils bis zu 4096 Zeichen. Die zweite Menge behauptet keinen Inhaltstyp. Die Obergrenze beträgt 3.145.728 UTF-16-Codeeinheiten für die Schlüssel ohne Verwaltungsaufwand. Ein üblicher `.mpd`-Pfad braucht kein dauerhaftes Veto im Bestand, da ihn die bestehende Endungsprüfung bereits sperrt.

Kann Kadri ein weiteres bestätigtes MPD wegen eines vollen Identitätsbudgets nicht festhalten, verweigert es neue oder inzwischen aus der Zulassungsmenge entfernte Schlüssel bis zum nächsten Dokument. Bereits erfasste unabhängige Quellen können weiterlaufen. Jede weitere exakte MPD-Beobachtung entfernt ihren Schlüssel aus der Zulassungsmenge. Überlange Schlüssel bleiben ebenfalls unzulässig. Das verhindert, dass vergessene MPDs wieder aufgenommen werden. Bei außergewöhnlich vielen bestätigten MPDs können dadurch auch bislang unbekannte gültige Adressen im selben Dokument vorübergehend ausfallen.

Der Test hat 524 MPD-Beobachtungen, 280 Kandidatenwechsel und acht Öffnungs-/Schließrunden ausgeführt. Er prüft Identitäts-, Netzwerk- und Registry-Grenzen anhand von Zählern und Entscheidungen. Ein Heap-Dauertest und ein Laufzeitprofil wurden nicht erhoben. Die bestehenden Grenzen für vom Transport nicht gemeldete Zwischenziele und spätere eigenständige Abrufe durch Browser oder externe Apps gelten weiter.

## Rot und Grün

`KADRI_CHROMIUM=/usr/bin/chromium python3 tests/test_p0a_manifest_identity.py` mit identischer Testdatei und Chromium 156 ergab **3/13 auf B.2** und **13/13 nach der Korrektur**.

- Auf B.2 blieb die klassifizierte URL nach der Vorverdrängung in der echten Netzwerk- bzw. Elementquelle und erreichte `Hls.loadSource` oder `video.src`, einschließlich des Vorschaupfads. Nach der Korrektur zählen Kandidatenaufnahme, HLS-Lader, Video-Setter und Vorschau für diese URLs jeweils null.
- Bei externer Ausgabe nach Vorverdrängung zählte B.2 je einen Auflösungs-, Intent-, Attachment-, Share- und Kopieraufruf sowie drei Download-Klicks für Probe, nativen Download und Blob. Nach der Korrektur zählen alle diese Ausgabeaufrufe null. Der gewöhnliche Beitragslink erreichte weiterhin die Ausgabe.
- Die echte MP4 und eine HLS-Playlist mit anderer Query zum selben Pfad dekodierten. HLS wechselte über das echte Qualitätsmenü auf ein anderes Level und spielte weiter. Der bestehende B.2-Test bestätigte erneut den echten Zwei-Hop-Redirect für unabhängige MP4 und gültige Seitenlinks.
- Der neue Prüfer kontrolliert außerdem Neueröffnung, Elementersatz, andere Medien-Epoche, SPA, Dokumentwechsel, iframe und die Adress- und Mengenbudgets. B.1 und B.2 prüfen weiter die Ausgaben während einer bereits gehaltenen Auswahl.

## Ausgeführte Regressionen

| Gruppe | Ergebnis |
|---|---|
| Chromium | Manifestidentität 13/13, B.1 8/8, B.2 20/20, Produktgrenze B1–B4 10/10 |
| Chromium-DASH | Parser/Modell 61/61, Gate 122/122, Fingerabdruck 30/30, Backfill 23/23, Alternativen 12/12, URL-Parameter 32/32, unbekannter Start 18/18 |
| Node-Quellen | Registry 140/140, Manifestmodell 35/35, Bindung 32/32, Epoche 13/13, DASH-Diagnose 31/31, DASH-Downloaddiagnose 19/19, Download-Diagnose 102/102, DASH-Nachrichten 64/64, Downloadblatt 20/20 |
| Node-Relay | Frame-Relay 28/28, Frame-Ergebnis 35/35, Frame-RID 36/36 |
| Kanal | DASH 104/104, Kanal 45/45, MP4/Download 143/143, HLS 97/97. Download-Vorgängerregression bestanden. |
| Weitere Node-Prüfer | Vertraulichkeitswächter, Chrome-/Firefox-Netzschutz, Header-Kontext, Download-Quellen, Helper-Route, Medienfixtures, Player-Priorität, Popup, Proxy und Referer-Regeln bestanden. |
| Build | Ungepackte Manifest-V3-Testfassung mit der vorhandenen Buildroutine und deren Syntaxprüfung erzeugt. |

Die vier ursprünglichen Gegenproben ergaben keine neue DASH-Planung und keinen Start an der Produktgrenze. Der Dispatcher-Test bestätigt weiterhin die A1-Ablehnung beider Befehle. Das Quellenmodell behält die A2-Kandidatenregel bei. Browserberechtigungen, Kanal, Helper, Lieferworkflows und Pins sind unverändert.

Chromium-Komponenten messen lokale Aufrufe. Extension-Service-Worker, Desktop-Rust-Harness, vollständiges Browser-IPC sowie Samsung/Vivaldi, Annahme durch eine Android-App und reale Dateiausgabe stehen weiter aus.
