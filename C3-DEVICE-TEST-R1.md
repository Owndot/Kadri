# Samsung-Gerätetest R1 (nach dem ersten Samsung-Test)

**Testpaket nur für die Test-Identität. Produktion bleibt UNAPPROVED. P4 (HLS-Download) bleibt gestoppt.**

| | |
|---|---|
| Kadri-Quelle | `08d4d521fcf425c24eda141179050caa9a08626c` (Branch `feature/c3-helper-mp4`) |
| Helper | unverändert `ca605408924644eeba6c29b4037dd90a324bb078` – vorhandene Test-APK `de.evp.helfer.channeltest` weiter benutzen |
| Paket | Actions-Artefakt `kadri-c3-08d4d52-vivaldi-test` des Workflows „C3 isolated extension test package“ |
| Test-Erweiterungs-ID | `fhjmppadldgkhdgkdplpalmoooocoinn` (unverändert) |

Vorbereitung wie in `C3-DEVICE-TEST-P2.md` (Produktions-App stoppen, Testordner ersetzen, „Neu laden“, nicht neu koppeln).

## Nachtest 2 (R2-Fixture, R3-Eingrenzung)

- R2: Alle MP4-Testdateien waren 12-s-Ausschnitte (ffprobe), der HLS-Stream der Seite läuft 60 s; der 180p-Datei fehlte
  die Tonspur. Die Testseite nennt jetzt zwei vollständige 60-s-Dateien (360p und 180p, H.264 Main + AAC, Bild + Ton
  wie HLS). CI prüft Dauer, Spuren und Bildinhalt gegen das HLS-Material (`tests/media_fixture_check.js`,
  `tests/media_fixture_match.py`).
- Download-Menü: Einträge, die nur die Seite dem Video zuordnet (`<source>`, Seitendaten), heißen jetzt
  „laut Seite, Länge/Inhalt ungeprüft“; nur die Datei, die der Browser im Kadri-Player tatsächlich geladen hat, heißt
  „diese Wiedergabe“. Kein zusätzlicher Abruf.
- R3: Die Zeile „Helfer-Download“ nennt zusätzlich „Identität“, die Herkunft der Höhe (observed = aus dem dekodierten
  Bild), den Zustand der eigenen Wiedergabe beim Start (Bildgröße, Bereitschaft, gepufferte/gespielte Sekunden) und
  20 s nach dem Fehler, ob der Browser dieselbe Datei ohne Fehler weiter lädt (nur Hinweis, kein zusätzlicher Abruf).

## Nachtest nach R1–R5 (Paket `08d4d52`)

- R2: Die Test-MP4s waren VP9 Profil 1 (RGB 4:4:4) – auf Android nicht abspielbar. Jetzt 360p H.264/AAC und 180p VP9
  Profil 0. Die Testseite unter dem neuen Commit öffnen (Link im Bericht).
- R3: Die Diagnose „Helfer-Download“ bleibt seitenweit erhalten (auch nach Schließen des Players). Neue Taste
  **„Anonymisiert kopieren“** im Diagnosefenster: nur technische Zustände, keine Adressen, Titel oder Kennungen.

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
| R2 | Öffentliche Testseite (Link im Bericht), Video im Kadri-Player öffnen, ⬇ | HLS läuft weiter; zwei Einträge „Mit der Helfer-App speichern · 360p / 180p · laut Seite …“; 360p → 1 176 524 Byte, 180p → 753 098 Byte, je 60 s mit Ton, abspielbar |
| R3 | site-a: Video öffnen, im Kadri-Player abspielen lassen, ⬇ → Download starten | Ergebnis; nach dem Fehler Diagnose öffnen und **nur die Zeile „Helfer-Download: …“** abschreiben |
| R4 | site-b: Video öffnen | angeboten ja/nein; Diagnose: Zeilen „Stream-Nachweis“ und „Helfer-Download“ (ohne Adressen) |
| R5 | Bitmovin-Demo wie zuvor | Erwartet: kein Eintrag (MP4 steht dort nur in der Player-Konfiguration, siehe Bericht) |
