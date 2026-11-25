# P0-A · Quellenherkunft bei externer Ausgabe

- Produktbasis A2 `4c05499de3a54bc0ee977ac7fa0e3a17e978af0f`
- B.1 und direkter Parent von B.2 `cbeac18dcef5cbc2676b30211b46abbb1b6adfbc`
- B.2-Branch `fix/p0a-redirect-provenance`
- Reviewgrundlage `465f46c762b7716466185dfd2da45651bcbb54b0`

## Rot auf B.1

`KADRI_CHROMIUM=/usr/bin/chromium python3 tests/test_p0a_redirect_provenance.py` ergab **6/20** auf B.1. Ein erkanntes MPD verursachte je einen Auflösungs- und Intent-Aufruf nach zwei HTTP-Weiterleitungen zur endungslosen Adresse, zur MP4 und zur HLS-Playlist. Eine spätere Klassifikation mit Cacheverdrängung und ein Medienwechsel während der Auflösung ließen jeweils einen Intent passieren. Das vorbereitete Playerziel wurde auch nach Klassifikation von Ursprung oder Ziel weitergegeben.

Das veraltete Seitenmenü erreichte den Browserdownload, einen neuen Tab und die Teilen-API. Die asynchrone Anhangsprobe und der verspätete Blob lösten je einen Download-Klick aus. Nach neuer Klassifikation wurden der Kopier-Fallback und die verzögerte Intent-Navigation dennoch erreicht. Im iframe erreichte der externe Knopf den Intent, und die Auswahl gab eine veraltete Medienadresse an das Hauptfenster zurück.

## Grün nach B.2

Dieselbe Testdatei ergab **20/20** in Chromium 156. Bereits bekannte MPD-Ursprünge verursachten weder eine Auflösung noch einen Intent. Nach einer begonnenen Auflösung prüft Kadri Ziel, ursprüngliche Auswahl und Medien-Epoche erneut. Alte Menüs und vorbereitete Ziele konnten die beobachtete Ablehnung nicht verlieren.

`mediaOutputFor` und `mediaOutputContext` binden die Prüfung an die Auswahl. `noteDashOutput` übermittelt positive MPD-Beobachtungen an noch gehaltene Auswahlen. `onPillMain` und der externe Player-Knopf übernehmen denselben Prüfzustand über `finalUrl` bis `openExternal`. Der Player bindet vorbereitete Ziele zusätzlich an die Revision seiner Wiedergabequelle. Ein Redirect speichert keine MPD-Klassifikation an einer anderen Zieladresse.

## Positive Kontrollen

Der lokale Chromium-Prüfstand beobachtete den Intent für eine eigenständige MP4 nach zwei Weiterleitungen, obwohl eine abgelehnte MPD-Auswahl im selben Dokument dieselbe Datei zum Ziel hätte. Die echte HLS-Adresse erreichte den Intent. Eine im Player dekodierte MP4 erreichte den Intent auch über ein zuvor aufgelöstes Ziel. Eine eigenständige MP4 im iframe erreichte den Aufruf zum Öffnen, und ein Beitragslink erreichte die Teilen-API. Die gültige Anhangsprobe erreichte den Browser-Download-Klick.

## B.1 und A1/A2

Der unveränderte B.1-Prüfer erreichte **8/8**. Er bestätigte die eigentlichen Ladeaufrufe und die Dekodierung echter MP4- und HLS-Medien. Die neue Quellenrevision dient allein der Frischeprüfung externer Playeraktionen.

`test_dash_wrong_video.py` erreichte **7/7** und `tests/channel/dash_unit_check.js` **104/104**. Die Tests bestätigen die A2-Sperre am Quellenmodell und die A1-Ablehnung von Browserbefehlen für neue DASH-Pläne und -Starts einschließlich ihrer Positivkontrollen.

## B.3 und Grenzen

- Browserdownload prüft nach der Anhangsprobe die ursprüngliche und die zurückgemeldete Zieladresse vor `nativeDownload`. Die Blob-Ausgabe prüft nach dem Empfang der Antwort und erneut vor `saveBlob`. Teilen und Kopieren prüfen auch vor verzögertem Clipboard-Fallback. Die direkte Intent-Navigation prüft beim Timer erneut.
- Aus einem im Hauptfenster dargestellten iframe-Menü führt der Bestätigungstipp für das Öffnen oder Teilen einer Medienadresse im Ursprungsfenster zur Ausgabe. Browserdownload bleibt dort. Seiten- und Beitragslinks können weiterhin über das Hauptfenster ausgegeben werden.
- Die Komponentenprüfung fängt Intent-, Download-, Öffnen-, Teilen- und Kopieraufrufe ab. Sie weist die Ausgabeentscheidung nach. Annahme durch eine Android-App, tatsächliches Schreiben durch den Browser und Browserverhalten bei erneut veränderten Redirects nach der Übergabe sind offen.
- Die Lebensdauerprüfung umfasst den Ursprung und bereits in der Aktion bekannte Ziele. Zwischenziele, die der Transport nicht meldet, und Manifestbeobachtungen, die vor Auswahl der betreffenden Adresse bereits aus dem Cache verdrängt wurden, liegen außerhalb dieser Prüfung. Die Klassifikation wird nur an aktiven Auswahlen gehalten.
- Die vollständige Extension-E2E-Abnahme, der Desktop-Rust-Harness und der Samsung-/Vivaldi-Gerätetest bleiben offen.

## Weitere ausgeführte Regressionen

| Gruppe | Ergebnis |
|---|---|
| Chromium | DASH-Modell/Parser 61/61, Gate 122/122, Fingerabdruck 30/30, Backfill 23/23, Alternativen 12/12, URL-Parameter 32/32, unbekannter Start 18/18 |
| Node | Registry 140/140, Download-Diagnose 102/102, Manifestmodell 35/35, Bindung 32/32, Epoche 13/13, Frame-Relay 28/28, Frame-Ergebnis 35/35, Frame-RID 36/36 |
| Quellen und Weiterleitungen | Download-Quellenprüfung, Player-Priorität und Referer-Regeln bestanden, Header-Kontext 16/16 |
| Kanal | DASH 104/104, Kanal-Unit 45/45, MP4/Download 143/143, HLS 97/97, Download-Vorgängerregression bestanden |
