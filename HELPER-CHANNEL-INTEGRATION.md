# Helfer-Kanal – Integrationsstufe 1 (isoliert, nur Dummy-Daten)

**Status: Test-Build, keine Sicherheitsfreigabe.** Diese Stufe bindet den auf dem Samsung Galaxy S26 Ultra geprüften Kanal (SPAKE2-Kopplung + Noise_KK, Helper-Commit `bf84258`) in Kadri ein, aber **nur** im isolierten Test-Build `dist/channel-poc` und **nur** für Kopplung, `ping` und begrenzte Dummy-Daten. Die normalen Builds (`dist/chrome`, `dist/firefox`, beide Zips) sind bytegleich mit `main` und enthalten nichts davon. `release/production-policy.json` im Helper-Repository bleibt `UNAPPROVED`; Helper-Issue #3 (kompromittierte APK-Signatur) bleibt Release-Blocker, Issue #4 bleibt offen, bis diese Integration unabhängig geprüft ist. Kein Merge, keine Veröffentlichung.

## 1. Architektur

| Schicht | Ort | Aufgabe | Darf nicht |
| --- | --- | --- | --- |
| Oberfläche | `channel/channel.html`, `channel/channel-page.js` | Testseite: Code eingeben, Ping, Dummy, Kopplung vergessen | – |
| Hintergrund-Einbindung | `channel/channel-service.js`, `channel/channel-background.js` | lädt WASM, nimmt Befehle **nur** von der Testseite an, eine schmale Netzwerkfreigabe | Befehle von Content-Scripts oder Webseiten annehmen |
| Kopplungsverwaltung | `channel/channel-store.js` | Identität (X25519) und ein Pin in der IndexedDB des Erweiterungs-Ursprungs | still eine Identität erzeugen, Defektes stillschweigend löschen, Schreibfehler verschlucken |
| Kryptografischer Transport | WASM-Kern `vendor/kadri-pairing-poc/` (aus dem Helper-Repository, unverändert) + Zustandsführung in `channel/channel-session.js` | SPAKE2 (RFC 9382), Noise_KK, Records | eigene Kryptografie in JavaScript |
| Helfer-Transport | `channel/channel-transport.js` | POST an vier feste Pfade auf `127.0.0.1:47899`, begrenzte Antworten, Zeitgrenze | Weiterleitungen, Cookies, Ausweichadressen, Klartext-Fallback, `X-EVP-Key` |
| Anwendungsbefehle | `channel/channel-session.js` (`ping`, `dummy`) | einzige Befehle dieser Stufe | Medien-URLs, Cookies, Header, echte Medien |
| Spätere Medienverarbeitung | – (nicht Teil dieser Stufe) | künftig ausschließlich als Records **in** diesem Kanal | über den alten Weg (`47811`, `X-EVP-Key`) laufen |

Warum so: Der geprüfte Kern bleibt die einzige Kryptografie (die `.wasm` ist bitgleich mit der im Gerätetest geladenen Datei, siehe `vendor/kadri-pairing-poc/PROVENANCE.md`). Alles in JavaScript ist austauschbar und testbar: Speicher und Transport werden injiziert, darum laufen dieselben Module in Node gegen den echten Helper-Server und im Browser gegen denselben Server. Kadris Service Worker ist ein klassisches Skript (`importScripts`); deshalb wird der Kern mit wasm-bindgen `--target no-modules` gebaut, und der Test-Build lädt über `channel-background.js` zuerst Kadris unveränderten `background.js` und danach den Kanal.

Sicherheitsregeln und wo sie durchgesetzt werden:

- **Pin erst nach Bestätigung** (Review R4): `pair()` speichert den neuen Pin erst nach einem erfolgreichen authentisierten Ping und nur, wenn das Speichern gelingt; sonst bleibt die vorherige Kopplung.
- **Keine automatische Annahme neuer Helfer-Identitäten:** Ein Handshake, der nicht vom gepinnten Schlüssel stammt, endet in `identity-mismatch`; eine vom Helfer nicht mehr anerkannte Kopplung (Widerruf, zurückgesetzter Helfer) in `rejected`. Beides ändert den Pin nicht. Nur eine bewusste neue Kopplung per Code ersetzt ihn; ändert sich dabei der Helfer-Schlüssel, meldet die Seite das (`helperChanged`).
- **Jeder Kanalfehler beendet die Sitzung.** Einzige automatische Wiederholung: ein neuer authentisierter Handshake, wenn der Helfer die Sitzung nicht kennt (HTTP 404, z. B. nach seinem Neustart) – der Record wurde dann nachweislich nicht verarbeitet.
- **Reihenfolge und Grenzen:** höchstens ein offener Record, Warteschlange ≤ 32, Dummy ≤ 8 MiB in Records ≤ 60 KiB, Antworten ≤ 65 556 B mit Content-Length, 5 s je Anfrage, Kopplungsfristen auf `performance.now()` (R3).
- **Netzwerk:** Kadris Schutzregeln (DNR-Regeln 50–70, 80) bleiben unverändert und sperren `127.0.0.0/8` für Anfragen der Erweiterung. Der Test-Build ergänzt nur Regel 40: `allow`, `POST`, `^http://127\.0\.0\.1:47899/p1/(pair/m[02]|ch/(hs|rec))$`, `tabIds: [-1]`. Kadris allgemeiner Anfrage-Weg (`kadri-xhr`) erlaubt weiterhin kein POST an diese Adresse.
- **Berechtigungen:** keine neuen. Das Manifest des Test-Builds ergänzt nur die CSP `script-src 'self' 'wasm-unsafe-eval'; object-src 'self';` (WASM, kein `unsafe-eval`).
- **Speicher:** IndexedDB `kadri-helper-channel` im Erweiterungs-Ursprung, nicht `storage.local` (das Kadris Content-Scripts lesen können). Gespeichert werden nur Identität und Pin; Sitzungsschlüssel nie.

## 2. Bisherige Kommunikationswege (Bestandsaufnahme) und was mit ihnen geschieht

| Stelle | Weg | In dieser Stufe |
| --- | --- | --- |
| `src/080-helper-app.js` | `http://127.0.0.1:47811`, Header `X-EVP-Key` (gekoppelter 128-Bit-Schlüssel, vor dem Koppeln Rückfall auf den festen Wert `evp-1`), Kopplung über die Seite `…:47811/pair#SCHLÜSSEL`; Befehle `/ping`, `/bright`, `/vol`, `/beat`, `/end`, `/download` (Medien-URL, Referer, User-Agent, Cookies **im Klartext** in der Anfrage), `/pull`, `/push`, `/dlstate` | **unverändert**, produktiv; im Test-Build ebenfalls vorhanden, aber vollständig getrennt (kein gemeinsamer Code, kein Rückfall in eine der beiden Richtungen) |
| `chrome/popup.js`, `firefox/popup.js` | `fetch('http://127.0.0.1:47811/ping', { headers: { 'X-EVP-Key': … } })` | unverändert |
| `chrome/background.js`, `firefox/background.js` | `HELPER_ORIGIN = 'http://127.0.0.1:47811'`: Ausnahme in `guard()` (auch POST), DNR-Regel 50 (Allow für `:47811`), keine Weiterleitungen | unverändert; der Kanal nutzt diesen Weg nicht |
| `src/010-kopf.js` (Userscript) | `@connect 127.0.0.1`, `@connect localhost` | unverändert |
| Helper `app/…/HelferService.java` (Port 47811, `MiniServer`) | prüft nur `X-EVP-Key` gegen den eigenen Zufallsschlüssel (`evp-1` wird abgelehnt); authentisiert nur den Client, nicht den Server – ein fremder Dienst auf 47811 erhielte die Klartext-Anfragen (Kern von Issue #4) | **unverändert**; die produktive Helper-App wird in dieser Stufe weder verändert noch ersetzt |

Ersetzt wird in dieser Stufe **nichts** Produktives. Isoliert: Der neue Kanal hat eigenen Port (47899), eigene Pfade, eigene Speicherung und eigene Netzwerkfreigabe und wird nur im Test-Build gebaut. Der Plan für den Ersatz steht in §6.

## 3. Vergleich PoC ↔ Integration

| Teil | Geprüfter PoC (Helper `bf84258`) | Diese Integration |
| --- | --- | --- |
| Kryptografischer Kern | Rust, WASM (`--target web`) | dieselbe `.wasm`-Datei, Glue `--target no-modules` |
| Erweiterung | eigene Wegwerf-Erweiterung `ext-vivaldi` (ES-Modul-SW) | Kadri-Test-Build mit Kadris Hintergrund + Kanal |
| Logik Kopplung/Kanal | `ext-vivaldi/background.js` | aufgeteilt in Store/Transport/Session/Service; gleiche Regeln (R3, R4, keine Hooks R5) plus: Zustände `rejected`/`identity-mismatch`, genau ein Reconnect bei 404, begrenzte Warteschlange, Prüfung gespeicherter Werte, Dummy-Inhalt mit Transfer-Nummer |
| Helfer-Gegenstelle | Android-Test-App `de.evp.pakepoc.test` | dieselbe App (Gerät) bzw. ihr unveränderter `PocServer` auf dem Desktop-JVM (Tests) |
| Produktive Helper-App | unberührt | unberührt |

**Änderungen am kryptografischen Kern: keine.** Der Kern-Quelltext im Helper-Branch `feature/helper-channel-dummy` ist identisch mit `bf84258`.

## 4. Abhängigkeiten der Branches und PRs

- Helper **PR #21** (Draft, `ccr-791d6ed0-rmfzvd`, HEAD `b198519`): ursprünglicher Sicherheits-PoC. Eingefroren, unverändert.
- Helper **PR #20** (Draft, `codex/server-auth-design`): Architekturvergleich (Dokumentation). Unverändert; inhaltlich die Begründung für Kandidat B.
- Helper-Branch `poc/android-vivaldi-capability` (`bf84258`, kein PR): baut auf `b198519` auf; Android-Test-App, Gerätetest S26 Ultra.
- Helper-Branch **`feature/helper-channel-dummy`**: baut auf `bf84258` auf; ergänzt nur Testwerkzeuge (Desktop-Host für den unveränderten `PocServer`, `no-modules`-WASM-Bau). Kadri pinnt einen Commit dieses Branches in `vendor/kadri-pairing-poc/SOURCE`.
- Kadri-Branch **`feature/helper-channel-dummy`**: baut auf Kadri `main` (`d52faae`) auf.
- Reihenfolge für eine spätere Übernahme: unabhängiger Review dieser Stufe → Entscheidung über PR #21/#20 → erst danach produktive Schritte (§6).

## 5. Tests

Gegenstelle in allen automatischen Tests: der **unveränderte** `PocServer` der Android-Test-App (gleiche Java-Klassen wie auf dem Gerät) auf einem Desktop-JVM mit der Linux-Bibliothek desselben Rust-Kerns (`DesktopHelperHost`, nur Testwerkzeug). **Das sind keine Gerätetests.**

| Anforderung | Test | Ergebnis |
| --- | --- | --- |
| erfolgreicher Handshake, Ping, 1 MiB Dummy | Node + Browser | PASS |
| falscher Kopplungscode (abgelehnt, Fenster verbraucht, Formate) | Node | PASS |
| unbekannte Helfer-Identität (fremder Listener: offene Sitzung → `tampered`, neuer Handshake → `identity-mismatch`; zurückgesetzter Helfer → `rejected`; Neukopplung meldet `helperChanged`) | Node + Browser | PASS |
| manipulierte Records (Antwort und Anfrage) | Node | PASS |
| Replay (alte Antwort an Kadri; alter Record an den Helfer) | Node | PASS (der Replay an den Helfer beendet dessen Sitzung: bekanntes Risiko R2) |
| Worker-Neustart (neuer Kanal mit gleichem Speicher; echter SW-Stopp per CDP) | Node + Browser | PASS |
| dauerhafte Speicherung (nur Identität + Pin) | Node + Browser | PASS |
| Widerruf (auch über Helfer-Neustart; Pin bleibt; Neukopplung) | Node + Browser | PASS |
| konkurrierende Anfragen (20 parallel + Dummy; Kopplung parallel zu Anfrage; Warteschlangengrenze) | Node | PASS |
| Zeitgrenze und Ressourcengrenzen (hängender Dienst, zu große Antwort, fehlende Länge, Weiterleitung, Pfade, Anfragegröße, Dummy-Größe) | Node | PASS |
| bösartige Webseite (kein Zugriff auf die Erweiterung, Preflight blockiert, Gate) und bösartiges Content-Script (alle Kanal-Befehle `refused`, keine Kanal-Daten in `storage.local`, kein POST über Kadris Anfrage-Weg) | Browser | PASS |
| fehlgeschlagene Persistenz (Kadri: Identität, neuer Pin, Vergessen; Helfer: Kopplung, Widerruf) | Node | PASS |
| gescheiterte Bestätigung einer neuen Kopplung behält die alte (R4) | Node | PASS |
| Mutationsprobe: 18 gezielt eingebaute Sicherheitsfehler | `tests/channel/channel_mutation_check.js` | siehe Bericht |
| normale Builds unverändert | Vergleich aller Dateien mit `main`; CI prüft, dass `dist/chrome`, `dist/firefox`, `dist/test` und Zips keinen Kanal-Code enthalten | PASS |
| bestehende Kadri-Tests | bestehender CI-Job `build-test` | im Draft-PR |

Ausführen (lokal oder CI-Job `helper-channel`):

```sh
# im Helper-Repository (Commit aus vendor/kadri-pairing-poc/SOURCE):
poc/android-capability/tools/build-desktop-helper.sh /tmp/helper-host
# in Kadri:
node tools/build.js --channel-poc
HELPER_HOST_DIR=/tmp/helper-host node tests/channel/channel_integration_check.js
HELPER_HOST_DIR=/tmp/helper-host node tests/channel/channel_browser_check.js
HELPER_HOST_DIR=/tmp/helper-host node tests/channel/channel_mutation_check.js
```

**NICHT GETESTET:** Kadri-Test-Build auf Vivaldi Android oder einem anderen echten Gerät; Firefox (Desktop und Android – der Test-Build ist nur Chromium/MV3); Zusammenspiel mit echten Medienfunktionen (absichtlich nicht vorhanden); Langzeitbetrieb, Akku, Hintergrundbeschränkungen; Speicherverhalten der IndexedDB bei „Website-Daten löschen“ in Vivaldi Android; Verhalten unter Local-Network-Access-Abfragen echter Browser.

## 6. Plan für spätere Stufen (nicht umgesetzt)

1. Unabhängiger Security-Review dieser Stufe (§8).
2. Helper: Kern und Server als eigener, klar getrennter Teil der Helper-App neben dem alten Server – erst nach Lösung von Issue #3 (Signatur) und mit eigener Freigabe. Der alte Server (47811) bleibt bis zur bewussten Abschaltung unverändert; **kein** Rückfall vom neuen auf den alten Weg.
3. Kadri: Befehle einzeln auf den Kanal umziehen, zuerst risikoarme (`bright`, `vol`, `beat`, `end`), zuletzt Downloads/Proxy mit URLs und Cookies. Jeder Umzug schaltet den alten Weg für diesen Befehl ab.
4. Danach: alten Weg und `X-EVP-Key` entfernen; Firefox-Variante getrennt prüfen.

## 7. Restrisiken

- **R1/R2 (offen, bekannt):** Ein lokaler Angreifer kann mit wiederholtem HS1 frische Handshakes verdrängen und mit bekannter Sitzungs-ID Sitzungen beenden. Nur Verfügbarkeit, keine Vertraulichkeit; im Test sichtbar (Replay beendet die Sitzung, Kadri baut neu auf).
- **Lokaler DoS** durch Belegen von Port 47899 oder Dauerlast; Kadri meldet `unreachable`/`identity-mismatch`, überträgt nichts.
- **Kein unabhängiger Audit** des Protokolls und der Bibliotheken (pakery, snow).
- **Identität im Erweiterungsspeicher im Klartext** (IndexedDB des Erweiterungs-Ursprungs); ein kompromittierter Browser oder kompromittierte Erweiterung kann sie lesen. Kopien im WASM-/JS-Speicher bis zur Speicherbereinigung.
- **Kadris Hintergrund ist geteilt:** Der Kanal läuft im selben Service Worker wie Kadris übrige Logik. Ein Fehler dort (z. B. in `background.js`) teilt sich den Prozess mit der Kopplung.
- **Test-Gegenstelle ≠ produktive App:** Die Tests prüfen den Server der Test-App; die produktive Helper-App hat diesen Kanal noch nicht.
- **Neustart des Helfer-Servers:** Unter dem JDK wird ein Port nach `stop()` asynchron freigegeben; ein sofortiger Neustart scheiterte in Tests gelegentlich mit „port busy“ (Testwerkzeug fängt das ab). Dasselbe Muster steckt in der Android-Test-App; bei der Helper-Integration einplanen.
- **Gelernter Fehler:** Die Node-Tests hatten einen Ladefehler im Service Worker verdeckt (`let wasm_bindgen` ist keine Eigenschaft von `self`); erst der Browser-Test mit dem echten Build zeigte ihn. Darum gehören beide Testebenen in die CI.

## 8. Unabhängiger Review – konkrete Schritte

1. Herkunft prüfen: `vendor/kadri-pairing-poc/*` mit `build-wasm-kadri.sh` aus dem gepinnten Helper-Commit nachbauen (CI-Job tut das) und bestätigen, dass der Kern-Quelltext gleich `bf84258` ist.
2. `channel/channel-session.js`: Zustandsübergänge (R4, `rejected`, `identity-mismatch`, Reconnect nur bei 404), Fehlerklassifizierung, Warteschlange.
3. `channel/channel-service.js`: Absenderprüfung (`sender.url`, `sender.origin`, `sender.id`), Nichtbeantwortung fremder Nachrichtentypen, DNR-Regel 40 im Zusammenspiel mit Kadris `netGuard()` (IDs, Prioritäten, Bereiche 1000–900000).
4. `channel/channel-transport.js`: keine Weiterleitung, keine Credentials, Längenprüfung, Zeitgrenze, Pfad-Whitelist.
5. `channel/channel-store.js`: kein stilles Erzeugen/Löschen, Schreibfehler.
6. `tools/build.js`: dass die normalen Builds unberührt bleiben (Dateivergleich mit `main`).
7. Tests und Mutationsprobe lesen und gegen die Liste in §5 abgleichen; insbesondere, ob ein Mutant fehlt, der eine Regel aus §1 verletzt.
8. Danach entscheiden, ob ein zweiter isolierter Samsung-Gerätetest mit dem Kadri-Test-Build durchgeführt wird.

## 9. Optionaler zweiter Samsung-Gerätetest (nur nach gesonderter Freigabe)

Sinnvoll, weil diese Stufe Neues enthält, das der erste Gerätetest nicht abgedeckt hat: klassischer Service Worker mit `importScripts` und `no-modules`-WASM, Kadris DNR-Schutzregeln zusammen mit Regel 40, Kadris übrige Content-Scripts im selben Browser. Ablauf wie im Helper-Repository (`poc/android-capability/DEVICE-TEST-GUIDE.md`), mit diesen Unterschieden:

1. Kadri-Test-Build lokal bauen: `node tools/build.js --channel-poc` → Ordner `dist/channel-poc` (kein Zip). Die SHA-256 von `dist/channel-poc/channel/kadri_pairing_poc_bg.wasm` muss `18d07767…eac6f` sein.
2. In Vivaldi Android **die bisherige PoC-Testerweiterung entfernen** und `dist/channel-poc` über „Entpackte Erweiterung laden“ laden. Eine eventuell installierte produktive Kadri-Version ist eine getrennte Erweiterung und wird nicht berührt.
3. Gegenstelle bleibt die bereits geprüfte Test-App `de.evp.pakepoc.test` (Port 47899). Die produktive Helper-App wird nicht benötigt und nicht verändert.
4. Testseite: `chrome-extension://<ID>/channel/channel.html` (die ID steht in Vivaldis Erweiterungsverwaltung). Prüfen: Koppeln, Ping, Dummy 1 MiB, Vivaldi schließen/neu öffnen → Ping, Widerruf in der App → Ping (`rejected`), Fremd-Listener EIN → Ping zweimal (`tampered`, dann `identity-mismatch`), AUS → Ping, „Kopplung vergessen“.
5. Normale Webseiten weiter mit Kadri ansehen, um Wechselwirkungen mit dem Player zu bemerken (keine echten Konten oder privaten Medien).
6. Entfernen: Test-Build entfernen, Entwicklermodus aus, Test-App deinstallieren.
