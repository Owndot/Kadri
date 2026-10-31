# Phase C3 – direkte MP4-Downloads aus Kadri über die Helfer-App

Stand: 31.10.2026 · Branch `feature/c3-helper-mp4` (Basis `feature/helper-channel-control`) · Gegenstück im
Helper-Repository: `feature/c3-browser-downloads` (Basis `feature/c2-mp4-downloads`, gepinnt in
`vendor/kadri-pairing-poc/SOURCE`). **Produktionsstatus bleibt `UNAPPROVED`.** Keine Releases, keine produktiven
APKs, keine Merges. Keine Sicherheitsfreigabe durch mich – das ist eine Beschreibung zur Prüfung.

Umfang: nur direkte MP4-Dateien, die Kadris Player selbst abspielt. Kein HLS/DASH, kein Browser-Push, keine Änderung
an Signierung, Kopplung (SPAKE2 → Noise KK), Kryptografie, Wiedergabe oder Gesten.

## 1. Ablauf

```
Player: ⬇ antippen ──► Auswahl „Mit der Helfer-App speichern“ ──► Tipp (einziger Auslöser)
  src/180  hdlStart() ── helperDl('start', {url, name}) ──┐
  src/080  helperDl()  → KADRI_DOWNLOAD (chrome/prelude.js, nur url/name/id als Text)
           runtime.sendMessage({t:'kadri-download', op, …})
  channel/channel-service.js   Absender- und Feldprüfung (nur Kadris Inhaltsskript; Menü nur status/cancel/list/caps)
  channel/channel-downloads.js Auftrag (storage.local, OHNE URL) · doppelte Starts · Wiederholung nur mit derselben Kennung
  channel/channel-session.js   downloadMessage(): exakt {op,id,url[,name]} bzw. {op,id} → request() → Noise-KK-Record
  ─── 127.0.0.1:47899 /p1/ch/rec (verschlüsselt, authentisiert, gepinnter Helfer) ───
  Helper: ChannelServer → ControlCommands → DirectDownloads (C2) → SafeHttpClient (C1) → Download/Video-Assistent
```

Wiederverwendet statt neu gebaut: das Muster von `KADRI_HELPER` (Brücke Inhaltsskript → Hintergrund), die
Kanal-Sitzung (`request`/`serial`, Fehlerarten, Wiederaufbau nach „Sitzung unbekannt“) und die C2-Befehle
`dlstart`/`dlstatus`/`dlcancel` des Helfers. Es gibt keinen zweiten Download- oder Kommunikationsweg.

Entfernt: der tote Altweg `helperDownload` im Player (sendete `/download?u=…&ref=…&ua=…&c=<Cookies>` und bot
„Über den Browser laden“ an). Er war seit Phase 2 unerreichbar (`KADRI_HELPER` lässt `/download` nicht durch,
`st.sys.dl` ist immer `false`); jetzt ist er auch aus dem Quelltext weg (`tests/helper_route_check.js` prüft das).
Die Laden-über-den-Browser-Bausteine in `src/080` (gmGet/proxyLoop mit eigenen Regressionstests) bleiben unberührt
und unerreichbar.

## 2. Bedienung

- Eintrag „Mit der Helfer-App speichern“ (Untertitel „direkt aufs Handy · ohne Anmeldung der Seite“) erscheint nur,
  wenn (a) Kadri für Chrome/Vivaldi, (b) gekoppelt, (c) der Helfer `dlstatus` versteht (Fähigkeitsprobe, 60 s
  zwischengespeichert) und (d) der Player eine direkte Datei abspielt (`directUrl()`, kein Stream, kein `blob:`,
  keine WebM/OGG/MKV-Endung).
- Ein Tipp auf ⬇ öffnet dann nur die Auswahl; nichts startet von selbst. Ohne Helfer-Eintrag ist ⬇ unverändert.
- Während des Downloads: ⬇ markiert (`on`), im Menü „Helfer-App: Lädt … · 42 % · 1,2 / 3,0 MB“ (live, solange das
  Menü offen ist) und „Download abbrechen“. Hinweise bei Start, Ende, Fehler, Abbruch. Im Kadri-Menü (Puzzle-Symbol)
  die Liste „Downloads über die Helfer-App“ mit Stand und „Abbrechen“. Auf dem Handy zusätzlich die Benachrichtigung
  der Helfer-App (C2).
- Texte sind fest (Zustand bzw. Grundcode → Satz, `describeDownload`/`downloadReasonText`/`downloadErrorText`), nie
  Server-Text, nie URL. Beispiele: `http_401/403/407` → „Server verlangt Anmeldung – direkter Download nicht
  möglich“, `storage_permission` → „Helfer-App: Speicherzugriff fehlt – in der App erlauben“, `blocked_address` →
  „Adresse nicht erlaubt (eigenes oder privates Netz)“, `unpaired` → „Helfer-App nicht gekoppelt – in den
  Einstellungen koppeln“.
- Keine neuen Einstellungen, keine neuen Bibliotheken, keine neuen Berechtigungen im Manifest.

## 3. Doppelte Starts, Verbindungsabbrüche, Neustarts

| Lage | Verhalten |
|---|---|
| Doppel-/Dreifachtipp | `st.hdl.busy` im Player; im Hintergrund `serial()`; derselbe Schlüssel (gesalzener SHA-256 der normalisierten URL) mit laufendem Auftrag → derselbe Auftrag, kein zweiter `dlstart` |
| Antwort auf `dlstart` verloren (Abbruch nach dem Senden) | Kennung wurde VOR dem Senden gespeichert → „unbestätigt“; nächstes `dlstatus` klärt: läuft → übernommen; unbekannt → `dlstart` mit DERSELBEN Kennung (Helfer startet je Kennung höchstens einmal, auch über seinen Neustart) |
| Start sicher nicht angekommen (`notSent`: kein Handshake, Sitzung beim Helfer unbekannt) | Fehler „nicht erreichbar“ bzw. genau ein neuer Versuch mit neuer Sitzung und derselben Kennung; kein Auftrag ohne Helfer |
| Kanal-Sitzung weg (Helfer-Kanal neu, Gerät schlief) | `dlstatus`/`dlcancel` sind jetzt in `IDEMPOTENT_OPS` (einmal neu nach „Sitzung unbekannt“); `dlstart` NICHT – das entscheidet die Verwaltung |
| Service Worker beendet (MV3) | Aufträge in `storage.local`; die nächste Abfrage weckt ihn, Stand kommt vom Helfer. Ein noch unbestätigter Start ohne URL im Speicher wird NICHT geraten: „Start nicht bestätigt – bitte erneut starten“ |
| Browser beendet und neu geöffnet | Player derselben Datei: `find` liefert den Auftrag, Abfragen gehen weiter; kein neuer Start |
| Helfer-Prozess beendet/abgestürzt | Kadri meldet „nicht erreichbar“ und fragt weiter; nach dem Neustart meldet das Journal des Helfers `interrupted` → „Unterbrochen (Helfer neu gestartet) – erneut starten“. Kein automatischer Neustart |
| Abbruch ohne Verbindung | „Abbruch wird nachgeholt“; sobald der Helfer erreichbar ist und noch lädt, wird `dlcancel` erneut gesendet |
| Helfer lädt schon zwei | `{ok:false,state:"busy"}` → Hinweis, kein Auftrag |
| Alte Helfer-Version ohne Downloads (`{ok:false}`) | kein Eintrag im Menü |

## 4. Lebenszyklen (Chromium/Vivaldi, besonders Android)

- Abgefragt wird nur aus dem Player (alle 1,5 s), solange er offen und die Seite sichtbar ist (`document.hidden`
  → Pause, beim Zurückkommen sofort weiter), und aus dem Kadri-Menü, solange es offen ist. Der Hintergrund hat keinen
  eigenen Zeitgeber und keine Alarme: Android-Browser beenden Service Worker und Hintergrund-Tabs aggressiv; der
  Helfer lädt unabhängig davon weiter und zeigt den Fortschritt in seiner Benachrichtigung.
- Alles, was einen Neustart überdauern muss, liegt in `storage.local` (höchstens 20 Aufträge; laufende werden nie
  verdrängt). Die URL liegt nur im Arbeitsspeicher, solange ein Start unbestätigt ist.
- Vollbild/Gesten: Der Download-Weg öffnet keine andere App und keinen Tab (anders als YTDLnis/Teilen); der Player
  bleibt im Vollbild, die Wiedergabe läuft weiter (geprüft).

## 5. Sicherheitsgrenzen

- Über den Kanal gehen nur `id` (32 hex), `url` (http/https, RFC-3986-Zeichen, ≤ 2048, ohne Zugangsdaten und Fragment)
  und optional `name` (≤ 120, ohne Steuerzeichen, Anführungszeichen, Backslash, einzelne Surrogate). Jede Abweichung
  oder jedes weitere Feld (Cookie, Header, Referer, User-Agent) → nichts wird gesendet. Dieselbe Form prüft der Helfer
  (`ControlCommands`).
- Keine Cookies, kein `Authorization`, kein Referer, keine Sitzung des Browsers – weder im Kanal noch beim Abruf durch
  den Helfer (geprüft am Medienserver: Browser spielte MIT Sitzungs-Cookie, der Helfer bekam KEINEN). Verlangt der
  Server eine Anmeldung, scheitert der Download mit Hinweis; es gibt keinen Wechsel auf einen anderen Weg.
- Nicht gekoppelt, Helfer nicht erreichbar, fremde Identität: Fehler, kein Klartext-Rückfall, kein alter Port
  (47811 wird nie angesprochen), keine automatische Annahme neuer Identitäten (unverändert aus Phase 2).
- Nachrichten `kadri-download`: `start`/`find` nur aus Kadris Inhaltsskript in einem http(s)-Tab, `status`/`cancel`/
  `caps` zusätzlich aus dem Menü, `list` nur aus dem Menü; feste Felder je Befehl, Kennung geprüft. Webseiten können
  der Erweiterung keine Nachrichten schicken (kein `externally_connectable`) und erreichen die Knöpfe im
  geschlossenen Shadow-DOM nicht.
- Gespeichert wird je Auftrag: Kennung, gesalzener SHA-256 der URL (Salz 32 Byte zufällig, lokal), Name, Zustand,
  Bytes, Grundcode. Keine URL, kein Host, keine Abfrage (geprüft am ganzen `storage.local`). Der Helfer speichert in
  seinem Journal ebenfalls keine URL (C2).
- Private und lokale Ziele sperrt der Helfer (C1: Adressregeln, DNS, Socket, Weiterleitungen) – auch eine Seite,
  die Kadri eine URL ins eigene Netz unterschiebt, erreicht dort nichts.

## 6. Tests und Umgebung

**Kein echtes Android-Gerät** wurde benutzt (Vorgabe: keine Installation auf dem Smartphone). **Kein
Android-Emulator für den Browser-Teil:** Chromium/Vivaldi mit Erweiterungen auf einem Android-Emulator lässt sich in
der CI nicht automatisieren. Der Browser-Teil lief in Desktop-Chromium (Playwright, Mobil-Emulation 400×800, Touch)
gegen den echten ChannelServer und die echte Download-Engine des Helfers auf der Desktop-JVM (nur die Android-Ablage ist
ein Ordner). Die Android-Ablage selbst (Android 8–9 öffentlicher Ordner mit Berechtigung, Android 10+ MediaStore,
Absturz-Wiederherstellung) ist in C2 auf Emulatoren API 26 und 34 geprüft und in C3 nicht verändert.

| Szenario | Test | Umgebung |
|---|---|---|
| Öffentliche MP4 (Start nur nach Tipp, Datei vollständig, Name = Seitentitel) | `test_mp4.py`, `download_integration_check.js` | Desktop-Chromium + Desktop-Helfer; Node + Desktop-Helfer |
| Fortschritt (Player-Menü, Kadri-Menü, Prozent/MB) | `test_mp4.py`, `download_integration_check.js` | dto. |
| Abbruch (Teil-Datei weg, keine Datei) | `test_mp4.py`, `download_integration_check.js`, `download_unit_check.js` | dto. + Node |
| Doppelklick / gleichzeitige Starts | `test_mp4.py` (Dreifachtipp), `download_integration_check.js`, `download_unit_check.js` | dto. |
| Verbindungsabbruch und Wiederaufnahme | `test_mp4.py` (Kanal-Neustart), `download_unit_check.js` (verlorene Antwort, Zeitüberschreitung, abgelaufene Sitzung) | dto. |
| Neustart des Service Workers (MV3) | `test_mp4.py` (CDP `ServiceWorker.stopWorker`) | Desktop-Chromium |
| Browser-Neustart während eines Downloads | `test_mp4.py` (neuer Browser, gleiches Profil) | Desktop-Chromium |
| Helfer-Neustart (Prozess hart beendet) | `test_mp4.py`, `download_integration_check.js` | Desktop-Helfer |
| Fehlende Kopplung | `test_mp4.py`, `download_integration_check.js`, `download_unit_check.js` | dto. |
| Fehlende Speicherberechtigung Android 8–9 | `test_mp4.py`, `download_integration_check.js` (Schalter der Desktop-Ablage); echte Berechtigung: C2-Gerätetests auf Emulator API 26 | Desktop / Emulator (C2) |
| Ungültige URL (Zugangsdaten, Schema, Zeichen, Länge) | `download_unit_check.js`, `download_integration_check.js` | Node |
| Private URL (10.0.0.0/8, Helfer-Port selbst) | `download_integration_check.js` (Browser kann sie nicht abspielen, also nur über die Verwaltung) | Node + Desktop-Helfer |
| Seite verlangt Anmeldung (Cookie) | `test_mp4.py`, `download_integration_check.js` | dto. |
| Keine URL-Teile in Speicher, Hinweisen, Menü, Ereignissen | `test_mp4.py`, `download_integration_check.js`, `download_unit_check.js` | dto. |
| Nur Kadris Inhaltsskript darf starten; feste Felder | `test_mp4.py`, `helper_route_check.js` | Desktop-Chromium, Node |
| Wiedergabe/Gesten/Kopplung unverändert | `test_helper.py`, `test_menu.py`, übrige `test_*.py`, `channel_*_check.js` | Desktop-Chromium |
| Mutationsproben (14 neue für Downloads, 21 bestehende) | `channel_mutation_check.js` | Node + Desktop-Helfer |

Das Testvideo `tests/web/clip.mp4` ist eigenes Material (aus `tests/web/clip.webm` neu kodiert: VP9 in MP4, 12 s,
ohne Ton, `ffmpeg -c:v libvpx-vp9 -b:v 300k -an -movflags +faststart -t 12`), weil Playwright-Chromium kein H.264
abspielt. Keine echten Medien-URLs, Cookies oder Zugangsdaten.

## 7. Im Helfer gefunden und behoben (C3-Branch, nicht am C2-PR)

Die C3-Browsertests deckten auf, dass nach einem fertigen Download der nächste an denselben Server mit `network`
scheiterte: OkHttp nahm die ruhende Pool-Verbindung, die der Server inzwischen geschlossen hatte (Keep-Alive-Zeitgrenze,
HTTP/1.0), und die gehärtete Netzschicht wiederholt bewusst nie automatisch. Behoben mit
`SafeHttpClient.closeIdleConnections()` vor jedem Auftrag (neuer JVM-Test und Mutationsprobe im Helper-Repository,
siehe dort `DOWNLOADS-C3.md`). Das betrifft auch echte Server und hätte auf dem Handy denselben Fehler gezeigt.

## 8. Restrisiken und Grenzen

- Nicht auf echtem Android geprüft (Browser-Teil); Verhalten von Chromium-basierten Android-Browsern mit Erweiterungen
  (Service-Worker-Lebensdauer, Hintergrund-Tabs) ist nur nachgestellt (Worker-Stopp, Browser-Neustart, Sichtbarkeit).
- Der Helfer bekommt die URL (er muss sie abrufen) – verschlüsselt über den Kanal, nicht gespeichert. Signierte,
  kurzlebige URLs können bis zum Tipp abgelaufen sein (→ 403/410 mit Hinweis).
- Seiten, die Cookies, Referer oder eine Sitzung verlangen, gehen bewusst nicht (kein unsicherer Ausweg).
- Der gesalzene Hash erkennt dieselbe Datei nur in diesem Browserprofil; wer Zugriff auf das Profil hat, kann eine
  bekannte URL gegen den Hash prüfen (nicht umkehren).
- Die Fähigkeitsprobe kostet je Player-Öffnung höchstens eine Kanal-Anfrage pro Minute.
- Firefox und das Userscript haben keinen Kanal und damit auch diesen Weg nicht (unverändert).

## Unabhängige C3-Korrektur: dauerhafte Abbruchabsicht

Ein Abbruch setzt jeden nichtterminalen Auftrag vor dem Kanalaufruf dauerhaft auf cancelling. Kanalfehler,
Worker-/Browser-Neustart und erneute Tipps löschen diese Absicht nicht. Nach Wiederverbindung wird zuerst
dlstatus abgefragt, bei running anschließend dlcancel gesendet. Nur ein bestätigter Terminalzustand beendet
den Vorgang. unknown ist keine Abbruchbestätigung: ein früherer Start könnte noch eintreffen. Die Absicht
bleibt daher erhalten; ein automatisches dlstart ist für diesen Auftrag gesperrt, auch wenn start() die URL
erneut liefert. Ein dauerhaft unbekannter Auftrag bleibt konservativ cancelling (kein erfundener Erfolg).

Abgleich erfolgt weiterhin nur bei aktiven Player-/Popup-Abfragen, nicht im geschlossenen Browser.
Neue Unit- und echte Helper-Integrationstests prüfen die Unterbrechung bei laufendem Medienabruf, Neustart,
erneuten Tipp, verlorene Abbruchantwort, verspäteten Start und konkurrierende terminale Zustände. Die CI prüft,
dass der exakt untersuchte Vorgänger e044aca an den neuen Regressionen scheitert; Mutationsproben schützen
das Speichern vor dem Netzwerkaufruf und den Umgang mit unknown.

Kein Kanal-/Kryptografie-/Header-/SSRF-Fallback geändert. Keine Gerätepakete oder Veröffentlichungen freigegeben;
Produktionsstatus bleibt UNAPPROVED.
