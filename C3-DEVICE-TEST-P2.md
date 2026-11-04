# Samsung-Gerätetest: MP4-Auswahl bei laufendem HLS (P3)

**Testpaket nur für die Test-Identität. Produktion bleibt UNAPPROVED.** Kein ADB, keine Deinstallation, keine Datenlöschung.

| | |
|---|---|
| Kadri-Quelle | `6e9747c62a9fb1ec03ae38227e8fcc0e7305cdd6` (Branch `feature/c3-helper-mp4`) |
| Helper | unverändert `ca605408924644eeba6c29b4037dd90a324bb078` – **vorhandene Test-APK `de.evp.helfer.channeltest` weiter benutzen, keine neue APK** |
| Test-Erweiterungs-ID | `fhjmppadldgkhdgkdplpalmoooocoinn` (Produktion `ladlndddhohknfpnfibchcadhgbpdlhm` bleibt unberührt) |
| Paket | Actions-Artefakt `kadri-c3-6e9747c-vivaldi-test` des Workflows „C3 isolated extension test package“ (1 Tag) |
| Lokal nachgebaute ZIP | 30 Dateien, SHA-256 `4509883fa2956bd540d20c293e32ae715bf94a14f9afee5237069f85ed0debd4` (gleiche Packroutine; maßgeblich ist der im Workflow-Log ausgegebene Wert) |
| Unterschied zum vorigen Testpaket `7621884` | nur `content.js`; `manifest.json`, Hintergrund, Kanal, Popup bytegleich; gleiche Berechtigungen |

## Vorbereitung (Samsung Android 17 / One UI 9.0, Vivaldi 8.2.4147.201)

1. Einstellungen → Apps → **Video-Assistent (Produktion)** → „Stopp erzwingen“. Dann die Test-App
   `de.evp.helfer.channeltest` öffnen (beide nutzen Port 47899; nie beide gleichzeitig).
2. Den bisherigen entpackten Testordner der Erweiterung durch den Inhalt des neuen Artefakts ersetzen (gleicher Ordner
   oder neuer – die ID bleibt `fhjmppadldgkhdgkdplpalmoooocoinn`). In Vivaldi unter Erweiterungen „Neu laden“.
   Kopplung und Einstellungen der Testerweiterung bleiben erhalten; nicht neu koppeln, wenn „Verbunden“ angezeigt wird.
3. Produktions-Erweiterung und -App nicht verändern.

## Prüfpunkte (bitte je Punkt OK/FEHLER + kurze Beobachtung, keine URLs/Token senden)

| # | Ablauf | Erwartung |
|---|---|---|
| D1 | Bekannte Mozilla-MP4 wie zuvor, im Kadri-Player ⬇ antippen | Auswahl mit „Mit der Helfer-App speichern“ (ggf. mit Höhe), Tipp → genau ein Download, Datei in `Download/Video-Assistent` vollständig abspielbar |
| D2 | Seite mit HLS, deren Videoelement zusätzlich MP4-Dateien nennt (falls bekannt) | HLS läuft weiter; je MP4 ein Eintrag; nach Tipp nur diese Datei; Wiedergabe springt nicht |
| D3 | Reine HLS-Seite (z. B. Kinogo/cinemar) | kein MP4-Eintrag; ggf. „Helfer-App: Stream erkannt“; kein Download startet |
| D4 | Laufenden Download abbrechen; Vivaldi beenden und neu starten | „Abgebrochen“ bleibt; kein automatischer Neustart; Popup zeigt keine alte Erfolgshistorie |
| D5 | Fehlschlag (z. B. Seite mit Anmeldung oder abgelaufene Adresse) | verständlicher Fehler (403/404/410 …), kein anderer Weg, Fehler im Popup einzeln schließbar |
| D6 | site-a-/site-b-Seite (optional) | Beobachtung melden: angeboten ja/nein, Ergebnis; **nicht** als repariert vorausgesetzt |
| D7 | Danach Test-App stoppen, Produktions-App öffnen | Produktion unverändert nutzbar |

Bitte zusätzlich: Dateigröße/Abspielbarkeit der gespeicherten Datei(en) und, falls möglich, deren SHA-256.
Erst nach diesem Ergebnis geht es mit HLS (P4) weiter.
