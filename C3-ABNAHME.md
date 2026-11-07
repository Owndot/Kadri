# C3 – Stand der Abnahme, bekannte Einschränkungen, Blocker, Plan P4

**Produktion bleibt UNAPPROVED. P4 ist nicht freigegeben und nicht implementiert.** Neutrale Kennungen: site-a, site-b.
Dieses Dokument ist keine Sicherheitsfreigabe.

## 1. Samsung-Abnahme (Testpaket `49949a7`, Helper-Test-APK `de.evp.helfer.channeltest`, Helper-Quelle `ca60540`)

| Punkt | Ergebnis | Stand |
|---|---|---|
| R1 Spul-Vorschau (öffentliche MP4) | BESTANDEN (Paket `08d4d52`) | abgeschlossen, keine Änderung ohne neuen Fehlernachweis |
| R2 HLS-Seite mit zwei MP4-Alternativen (öffentliche Testseite, Commit `a7423ce`) | **BESTANDEN** | abgeschlossen, keine Änderung ohne neuen Fehlernachweis |
| R3 site-a, MP4 im Kadri-Player | HTTP 404 beim Helfer | **bekannte Einschränkung** (Abschnitt 2) |
| R4 site-b | kein Angebot – nur HLS (Master, 2 Medienlisten, 2 Init-Dateien) | erwartet unter C3; Download erst mit P4 |
| R5 Player-Demo mit MP4 nur in der Player-Konfiguration | kein Angebot | erwartet, keine Priorität |

R2 im Detail (Samsung, Paket `49949a7`): HLS-Wiedergabe funktioniert; 360p und 180p werden angeboten (als
„laut Seite, Länge/Inhalt ungeprüft“); beide Downloads funktionieren; beide Dateien vollständig 60 s mit Ton; beide
Dateigrößen exakt (1 176 524 / 753 098 Byte); HLS läuft während der Downloads weiter. Damit ist die gemeinsame
Quellenpipeline mit unabhängigem MP4-Download für diese Fixture auf Samsung abgenommen. CI sichert die Fixture
(`tests/media_fixture_check.js`, `tests/media_fixture_match.py`) und den Ablauf gegen den echten Helfer (`tests/test_mp4.py`).

## 2. Bekannte Einschränkung R3: MP4, die nur in der Browsersitzung abrufbar ist

**Belegt** (zwei Samsung-Versuche, redigierte Diagnose):
- Die Datei wurde im Kadri-Player tatsächlich geladen und dekodiert (Bereitschaft 4, 1080p aus dem dekodierten Bild,
  19 s bzw. 26 s gepuffert) – keine bloße Quellenauswahl, kein HLS, kein separater Kandidat.
- Helfer: HTTP 404 nach 2 s; Quelle beim Start 2 s bzw. 22 s alt.
- Vergleichsabruf aus dem Browser ohne Cookies und ohne Referer (gleiches Gerät, gleicher Browser): ebenfalls HTTP 404.
- Versuch 1: die Pufferung des Browsers wuchs nach dem Fehler um 9 s, ohne Medienfehler. Das ist **kein** Beweis für
  einen erfolgreichen neuen HTTP-Abruf (der Browser kann Vorgeladenes nachreichen).

**Folgerung:** Server bzw. CDN behandeln die Anfragen des Browser-Players anders als Anfragen ohne dessen
Anfragekontext. Eine reine IP- oder User-Agent-Bindung erklärt das nicht allein (der Vergleichsabruf kam vom selben
Gerät und Browser). Ein gewöhnlicher Zeitablauf ist bei 2 s Alter unwahrscheinlich, aber nicht ausgeschlossen.

**Nicht nachweisbar** innerhalb der Sicherheitsgrenzen: ob Cookies, Referer/Origin/`Sec-Fetch-*` oder eine Einmal- bzw.
Sehr-kurz-Signatur entscheidet. Vorhandene redigierte Metadaten reichen dafür nicht: Der Helfer meldet bei einem Fehler
nur den Statuscode (`http_404`), der Vergleichsabruf ebenfalls; weitere Antwortmerkmale werden nicht erhoben. Eine
Unterscheidung bräuchte Anfragen mit Sitzungsdaten – das ist ausgeschlossen.

**Verhalten bleibt:** Kein Weitergeben von Cookies, Authorization, Referer oder Sitzungsdaten an den Helfer, kein
Browser-Proxy, kein automatischer Ausweichweg. Der Nutzer sieht „Datei nicht gefunden“; die Diagnose zeigt die Fakten.
Kein Fix ohne Nachweis.

## 3. Offene Sicherheits- und Abnahmeblocker (Stand 2026-11-04)

Release-/Sicherheitsblocker:
1. Helper-Issue #3 – kompromittierte APK-Signatur: Release-Blocker, offen.
2. Helper-Issue #4 – Helper-Authentifizierung: als SPAKE2 + Noise-KK umgesetzt (Draft-PRs Helper #22, Kadri #10),
   **unabhängige Prüfung fehlt** – bleibt offen.
3. Keine unabhängige Sicherheitsprüfung der Kette C1–C3 (Helper #25 Netzwerk, #26 MP4-Engine, #27 C3-Harness;
   Kadri #11). Eigene Freigaben gibt es nicht.
4. `release/production-policy.json` = UNAPPROVED; keine produktive Signatur, keine Migration echter Identitäten.

Abnahme-/Integrationsblocker:
5. Gestapelte Draft-PRs, nichts gemergt: Helper #22 ← #23 ← #24 ← #25 ← #26 ← #27; Kadri #10 ← #11. Vor einer
   Produktionsentscheidung: Reihenfolge festlegen, jede Stufe auf ihrer Basis neu testen. PR #20/#21 unangetastet.
6. Gerätebasis: ein Samsung-Gerät mit Vivaldi und Test-Identitäten (Test-Erweiterung, `channeltest`-APK). Firefox und
   Userscript haben bewusst keinen Helfer-Download-Weg.
7. Offene Helper-Issues mit Bezug: #5 (Browser-Proxy/große HLS-DASH-Antworten, relevant für P4), #6 (Abbruch und
   Wiederaufnahme – für direkte MP4 in C2/C3 abgedeckt, Issue vom Eigentümer zu bewerten), #7 (PiP/Hintergrund),
   #8 (Referrer-Datenschutz des alten DownloadManager-Wegs; C3 sendet keinen Referer). Kadri-Issue #2 (DNS-Rebinding).
8. Bekannte Einschränkung R3 (Abschnitt 2).
9. Testpakete sind öffentliche Actions-Artefakte (1 Tag); nur mit ausdrücklicher Zustimmung erzeugen.

Keine offenen Review-Threads an Kadri #11 und Helper #27; CI auf beiden Köpfen grün.

## 4. Plan P4 (HLS-Download über den Helfer) – nur Plan, nicht implementiert

Ziel: HLS-VOD, das Kadri nachweislich diesem Player zuordnet, über den Helfer als eine MP4 speichern – mit denselben
Grenzen wie C3 (Noise-KK, keine Cookies/Header/Referer, Netzschutz für jede Liste und jedes Stück, kein Ausweichweg).

**Vor dem Start zu entscheiden (Freigabe):**
- Umfang: nur HLS-VOD (fMP4 und MPEG-TS); kein Live, kein DRM. AES-128 zunächst abweisen? DASH als späteres P4b?
- Ausgabe: Remux ohne Neukodierung (Android `MediaExtractor` → `MediaMuxer`, MP4). Zu prüfen: Opus-Ton in MP4 per
  `MediaMuxer` je Android-Version (vermutlich erst ab Android 10) – darunter abweisen oder Ton weglassen?
- Grenzen: max. Stücke, max. Gesamtgröße, Speicherplatzprüfung vorab.
- Helper-APK-Änderung nötig → neue Test-APK `channeltest` mit der bestehenden Testsignatur (Update-Fähigkeit vorher
  prüfen, keine Deinstallation, keine Datenlöschung).

**Schritte:**
1. *Protokoll:* `dlstart` um genau ein Feld `kind: 'hls'` erweitern (sonst unverändert `{op,id,url[,name]}`), Fähigkeit
   `dl-hls` im Capability-Check; Kanal weist alles andere ab.
2. *Helfer:* strenger Playlist-Parser (Größen-/Zeilengrenzen, VOD-Pflicht `#EXT-X-ENDLIST`, Verschlüsselung → Abbruch
   mit Grund), Stücke nacheinander über SafeHttpClient in App-Speicher (begrenzter RAM, Fortsetzen je Stück, Abbruch,
   Journal ohne URL), Remux, Prüfung des Ergebnisses (Dauer ≈ Summe EXTINF, Spuren), Ablage in Download/Video-Assistent.
3. *Kadri:* Medienliste nur anbieten, wenn sie gebunden ist (Stücke dieses Players geladen, eigenes Element oder eigene
   Wiedergabe) – gleiche Identitätsregel wie R2 („diese Wiedergabe“ vs. „laut Seite“); Varianten aus der Masterliste
   (Höhe/Bandbreite); Gründe für Nicht-Angebot (verschlüsselt, live, DRM) in Menü und Diagnose.
4. *Tests:* eigene Fixtures (vorhandenes fMP4-HLS, zusätzlich TS, mehrere Varianten, verschlüsselt, live, Byte-Range,
   Diskontinuität, Stücke auf fremdem Host/Weiterleitung ins lokale Netz); Ergebnis gegen die Quelle wie
   `media_fixture_match.py`; JVM- und Mutationstests für Parser und Grenzen; Emulator API 26/29/34 für den Remux;
   Browser-Ende-zu-Ende gegen den echten Helfer.
5. *Gerät:* öffentliche HLS-Testseite auf dem Samsung, danach site-b erneut.

**Risiken:** Token in Stück-Adressen können während des Downloads ablaufen (gleiche Klasse wie R3, dann sauber
abbrechen); Speicher/Platz bei langen Videos (Helper-Issue #5); Hosts der Stücke unterscheiden sich von der Liste.
