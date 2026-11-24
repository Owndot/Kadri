# Codex-Startprompt – Kadri und Video-Assistent-Helper

Den folgenden Text unverändert als ersten Auftrag an Codex geben.

---

Du übernimmst die technische Leitung von zwei zusammengehörigen Projekten:

- `Owndot/Kadri`: Browser-Erweiterung (Chrome/Vivaldi MV3, Firefox MV2), Videoplayer mit Erkennung und Download von MP4, HLS und DASH;
- `Owndot/video-assistent-helper`: Android-Helfer-App mit Download-Engines und verschlüsseltem Kanal zu Kadri, dazu das Userscript.

Hauptziel ist Vivaldi auf einem Samsung mit Android 17.

## Schritt 1 – Lesen und Stände prüfen

1. Lies vollständig `docs/handoffs/CODEX-HANDOFF-S4B7A.md` im Repository `Owndot/Kadri`, Branch `test/s4b-dash`. Lies die dort verlinkten Berichte in `docs/handoffs/berichte/` nach Bedarf.
2. Prüfe per `git ls-remote` bzw. Checkout:
   - Kadri `test/s4b-dash` enthält `33c8e6a39d471df48bb0e9830455bac8e93e9af3` und darauf genau einen reinen Dokumentationscommit (die Übergabe).
   - Helfer `test/s4b5-dash` steht auf `6e553fcb82b437ce0be487233dd35f41958bade6`.
   - Kadri `main` = `cd00ded7d68b3d2e8af9d2724cee03e7d351f091`, Helfer `main` = `bb8a42d83eac108c098600e50a20208446134e65`.
   - `vendor/dash-harness/SOURCE` (Kadri) nennt `6e553fc…`. Die P4-Pins in `.github/workflows/p4-test-extension.yml` sind `7978a41`/`546af14`/`bd5ab29`.

   Melde jede Abweichung, bevor du weiterarbeitest.
3. Lies den relevanten Code selbst. Ausgangspunkte:
   - Kadri `src/038`, `039`, `040`, `046`, `060`, `065`, `105`, `chrome/manifest.json`, `chrome/page.js`, `channel/`;
   - Helfer `app/src/main/java/de/evp/helfer/{ControlCommands.java,dash/,dashdl/,net/}`.

## Schritt 2 – Nur auditieren

Führe ein unabhängiges Audit von Architektur, Sicherheit, Testabdeckung und offenen Risiken durch. Beantworte mindestens die zehn Fragen aus Abschnitt 4 der Übergabe. Besonders wichtig:
- Kann eine DASH-Quelle einem falschen Video zugeordnet werden?
- Woher soll ein Produkt den Beweis „angehängte MSE-Bytes = beobachtete Netzsegmente“ nehmen, wenn `webRequest` keine Bodies liefert?

Regeln für das Audit:
- Übernimm keine Behauptung aus der Übergabe oder den Berichten ungeprüft. Kennzeichne jede Aussage als
  - **geprüft** (mit Beleg),
  - **vermutet** oder
  - **nicht prüfbar**.
- Jeder Befund braucht:
  - Priorität **P0/P1/P2/P3** (P0 = Sicherheit, falsche Zuordnung oder Datenverlust);
  - Codeverweis `Datei:Zeile` am geprüften Commit;
  - einen reproduzierbaren Beleg: Test, Befehl, Gegenprobe oder präzise Begründung;
  - eine konkrete, möglichst kleine Empfehlung.
- Tests darfst du lokal ausführen, wenn sie für einen Beleg nötig sind. Dabei gilt:
  - Erfinde keine Ergebnisse.
  - Zähle einen fehlgeschlagenen Lauf nicht durch Wiederholung als bestanden.
  - Ändere keine Tests, um Produktfehler zu verdecken.
- Unterscheide, was im Produkt implementiert ist und was nur in Studien, Prüfständen oder Vorschlägen existiert. Ein Beispiel für Letzteres ist die Messsonde `tests/s4b7/probe`; sie ist kein Kadri-Code.

Liefere das Audit als Markdown-Bericht auf Deutsch. Lege ihn auf einem **neuen isolierten Branch** ab, z. B. `audit/codex-s4b7a` vom aktuellen `test/s4b-dash`: nur Dokumentation, kein Produktcode. Fasse ihn außerdem in deiner Antwort zusammen.

## Verbindliche Grenzen

- **Keine Produktänderung** an Kadri oder Helfer ohne meine ausdrückliche Freigabe.
- **Nie auf `main` arbeiten**, nichts nach `main` mergen, keine Pull-Requests mergen.
- **Keine APK, keine Erweiterungs-ZIP, keine Beta, kein Release, keine Veröffentlichung, keine Installation** auf Geräten. Keine Lieferworkflows auslösen.
- Lieferpins, Harness-Pin, WASM-Pin, Signierschlüssel und Liefersperren **unverändert** lassen. Nie Schlüssel oder Geheimnisse in Repository, Logs oder CI.
- Keine websitespezifischen Sonderregeln. Keine vertraulichen Seitennamen in getrackten Dateien; `node tests/confidential_names_check.js` muss bestehen.
- Keine Weitergabe von Cookies, Authorization oder Request-Bodies. Keine DRM-Umgehung. Keine neuen Browser-Berechtigungen ohne Freigabe.
- `tools/sync-src.sh` nicht ausführen: Es würde Kadri-eigene DASH-Module löschen.

## Nach dem Audit

Vor **jeder** späteren Implementierung legst du mir einen konkreten Plan vor und wartest auf meine Freigabe. Der Plan enthält:
- Ziel und Befund-Bezug;
- betroffene Dateien;
- Sicherheitsfolgen;
- Tests, mit einem Test, der den Fehler zuerst nachweist;
- Branchname;
- was ausdrücklich nicht geändert wird.

Die Roadmap in Abschnitt 5 der Übergabe ist nur ein Vorschlag; bewerte die Reihenfolge kritisch.

Antworte auf Deutsch.
