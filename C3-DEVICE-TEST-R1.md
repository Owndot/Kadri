# Samsung-Gerätetest R1 (nach dem ersten Samsung-Test)

**Testpaket nur für die Test-Identität. Produktion bleibt UNAPPROVED. P4 (HLS-Download) bleibt gestoppt.**

| | |
|---|---|
| Kadri-Quelle | `afe6d67cfb80e860683b5f6993c0e5266636fa2d` (Branch `feature/c3-helper-mp4`) |
| Helper | unverändert `ca605408924644eeba6c29b4037dd90a324bb078` – vorhandene Test-APK `de.evp.helfer.channeltest` weiter benutzen |
| Paket | Actions-Artefakt `kadri-c3-afe6d67-vivaldi-test` des Workflows „C3 isolated extension test package“ |
| Test-Erweiterungs-ID | `fhjmppadldgkhdgkdplpalmoooocoinn` (unverändert) |

Vorbereitung wie in `C3-DEVICE-TEST-P2.md` (Produktions-App stoppen, Testordner ersetzen, „Neu laden“, nicht neu koppeln).

## Was sich gegenüber `6e9747c` ändert

- **Diagnose bei Helfer-Fehlern mit HTTP-Status** (Kadri-Diagnose, Zeile „Helfer-Download“): Herkunft und Bindung der
  gestarteten Quelle, Alter beim Start, Zeit bis zum Fehler und ein einmaliger Vergleichsabruf aus dem Browser **ohne
  Cookies und ohne Referer** (1 Byte). Keine Adresse, kein Download, kein Ausweichweg.
- **Diagnosezeile „Vorschau (kleines Bild | im Bild)“** zeigt den eingestellten Vorschaumodus.
- Neutrale Kennungen statt Seitennamen in Code und Doku (Funktion der Erkennung unverändert).

## Prüfpunkte (je Punkt OK/FEHLER + kurze Beobachtung, keine URLs/Token)

| # | Ablauf | Erwartung / bitte melden |
|---|---|---|
| R1 | Mozilla-MP4 im Kadri-Player, auf der Zeitleiste ziehen | Vorschau ja/nein; danach Kadri-Menü → „Diagnose anzeigen“: Zeile **„Vorschau (…)“** abschreiben. In **Kadri-Einstellungen → Spul-Vorschau** den Wert in Test- *und* Produktionserweiterung nennen. Dasselbe Video einmal in der Produktionserweiterung prüfen. |
| R2 | Öffentliche Testseite (Link im Bericht), Video im Kadri-Player öffnen, ⬇ | HLS läuft weiter; zwei Einträge „Mit der Helfer-App speichern · 360p / 180p“; Tipp auf 360p → eine Datei (ca. 309 KB), abspielbar |
| R3 | site-a: Video öffnen, im Kadri-Player abspielen lassen, ⬇ → Download starten | Ergebnis; nach dem Fehler Diagnose öffnen und **nur die Zeile „Helfer-Download: …“** abschreiben |
| R4 | site-b: Video öffnen | angeboten ja/nein; Diagnose: Zeilen „Stream-Nachweis“ und „Helfer-Download“ (ohne Adressen) |
| R5 | Bitmovin-Demo wie zuvor | Erwartet: kein Eintrag (MP4 steht dort nur in der Player-Konfiguration, siehe Bericht) |
