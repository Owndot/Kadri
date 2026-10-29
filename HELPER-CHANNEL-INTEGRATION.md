# Helfer-Kanal – Integrationsstufe 2 (Steuerbefehle)

**Status: Entwurf, keine Sicherheitsfreigabe.** Kadri (Chrome/Vivaldi) spricht die Android-Helfer-App nur noch über
den geprüften Kanal (SPAKE2-Kopplung + Noise KK, Rust-Kern als WASM) – und nur mit Steuerbefehlen für Helligkeit und
Lautstärke. `release/production-policy.json` im Helper-Repository bleibt `UNAPPROVED`; Helper-Issue #3 bleibt
Release-Blocker, Issue #4 bleibt offen, bis die Integration unabhängig geprüft ist. Kein Release, keine Veröffentlichung.
Gegenstück im Helper-Repository: Branch `feature/helper-channel-control` (`HELPER-CHANNEL.md`).

## Was sich ändert

| Vorher | Jetzt |
| --- | --- |
| `helper()` → Hintergrund → `http://127.0.0.1:47811` mit `X-EVP-Key`, Kopplung über `…:47811/pair#SCHLÜSSEL` | `helper()` → `KADRI_HELPER` (nur Chrome-Prelude) → Nachricht `{t:'kadri-helper', op, v}` → Kanal im Hintergrund |
| DNR-Regel 50 erlaubt Kadris eigene Anfragen an `127.0.0.1:47811` | Regel 50 entfällt (47811 gesperrt wie alles im eigenen Netz). Regel 40: nur `POST` an `^http://127\.0\.0\.1:47899/p1/(pair/m[02]|ch/(hs|rec))$`, nur Kadris eigene Anfragen (`tabIds [-1]` + `initiatorDomains` = eigene ID) |
| Menü fragt `47811/ping` direkt | Menü fragt den Hintergrund (`status`, `check`) |
| Downloads, „Über den Browser laden“, DASH über den Helfer | vorübergehend aus (Status `dl/proxy/dash = false`); Browser-Downloads, YTDLnis, Teilen unverändert |
| Gespeicherter Schlüssel `gm:helperKey` | wird beim Start gelöscht |
| Firefox-Fassung, Userscript | kein Helfer (kein `KADRI_HELPER`), alter Port gesperrt |

Getrennte Test-Builds (`dist/channel-poc`, `dist/channel-only`) und ihr Gerätepaket-Workflow entfallen: Der Kanal ist
Teil von `dist/chrome`. Ein Gerätepaket der integrierten Fassung wird erst nach dem unabhängigen Review und mit
ausdrücklicher Freigabe gebaut.

## Bausteine

| Datei | Aufgabe |
| --- | --- |
| `src/080-helper-app.js` (geteilt mit dem Userscript) | `helper(path)` gibt nur den Pfad an `KADRI_HELPER` weiter; ohne ihn `null` („kein Helfer“). Respektiert die Einstellung „Helper-App“. |
| `chrome/prelude.js` | `KADRI_HELPER`: nur `/ping` (= `status`), `/status`, `/beat`, `/end`, `/bright?v=…`, `/vol?v=…`; alles andere (Downloads, Proxy, URLs, Cookies) bleibt im Inhaltsskript. |
| `channel/channel-service.js` | Hintergrund: Steuerbefehle aus Kadris Inhaltsskript in strenger Form (nur `t`, `op`, `v`); Verwaltung (`status`, `check`) nur aus Einstellungsseite und Menü, `pair`/`forget` nur aus der Einstellungsseite. Netzwerk nur, wenn Kadris Schutzregeln stehen (`netGuard`). |
| `channel/channel-session.js` | Kopplung (R4: Pin erst nach bestätigtem Austausch), eine Steuersitzung, serielle Warteschlange ≤ 32, `controlMessage()` (gleiche Form wie `ControlCommands` im Helfer, Werte auf 4 Nachkommastellen), genau eine Wiederholung nach HTTP 404 nur für die fünf Steuerbefehle (absolute Werte/Abfragen). |
| `channel/channel-store.js`, `channel/channel-transport.js` | unverändert aus Stufe 1: Identität und Pin in IndexedDB `kadri-helper-channel`; POST an vier feste Pfade, keine Weiterleitung, keine Cookies, 5 s, begrenzte Antworten. |
| `chrome/options.js` | „Helfer koppeln“: Code eingeben, Verbindung prüfen, Kopplung entfernen. |
| `chrome/manifest.json` | CSP `script-src 'self' 'wasm-unsafe-eval'; object-src 'self';`. Keine neuen Berechtigungen. |

Sicherheitsregeln (unverändert aus Stufe 1): keine automatische Annahme neuer Helfer-Identitäten (`identity-mismatch`,
`rejected` ändern den Pin nicht), keine automatische Neukopplung, jeder Kanalfehler beendet die Sitzung, kein
Klartext-Fallback, kein statischer Schlüssel.

## Tests

| Test | Gegenstelle | Inhalt |
| --- | --- | --- |
| `tests/channel/channel_unit_check.js` | Schein-Helfer | Befehlsform, falsche/unpassende Antworten, Wiederholungsregel |
| `tests/channel/channel_integration_check.js` | echter `ChannelServer` (Desktop) | Kopplung, Befehle am Gerät, Einzel-/Gesamtwiderruf, Neustarts, fremder Dienst, Manipulation, Replay, Persistenzfehler, Grenzen |
| `tests/channel/channel_browser_check.js` | echter `ChannelServer` | `dist/test` in Chromium: Kopplung über die Einstellungsseite, Menü, Regel 40, Worker-Neustart, Widerruf, fremder Dienst, bösartige Seite und Content-Script, alter Port nie erreicht |
| `tests/channel/channel_netguard_failure_check.js` | echter `ChannelServer` | Schutzregeln nicht setzbar → keine Anfrage, Code unverbraucht |
| `tests/channel/channel_mutation_check.js` | – | Mutanten in Session/Store/Transport/Service/Regeln müssen auffallen |
| `tests/test_helper.py` | echter `ChannelServer` | Player: ohne Kopplung keine Helfer-Gesten; gekoppelt Helligkeit/Lautstärke am Gerät, Lebenszeichen, `end` beim Schließen, keine Helfer-Download-Wege |
| `tests/helper_route_check.js`, `tests/guard_check.js`, `tests/ff_net_check.js`, `tests/header_context_check.js` | – | Weg Player → Hintergrund; alter Port in Chrome und Firefox gesperrt |

`HELPER_HOST_DIR` ist die Ausgabe von `tests/java/channel/build.sh` im Helper-Repository (Commit in
`vendor/kadri-pairing-poc/SOURCE`). CI: Job `helper-channel` in `.github/workflows/ci.yml`.

## Bekannte Grenzen

- Kadris bestehende Ausnahme für Seiten im eigenen Netz (Medienserver zu Hause) erlaubt einer Seite auf `127.0.0.1`
  weiterhin GET-Anfragen über Kadri an denselben Rechner (jeder Port). Ein Kanal-Befehl ist so nicht möglich (nur POST
  über Regel 40, nur aus dem Hintergrund), und der alte Port hat keinen Dienst mehr.
- R1/R2 aus dem PoC (Verfügbarkeit) bestehen weiter.
- Firefox (Desktop/Android) und Userscript ohne Helfer, bis es dort eine geprüfte Lösung gibt.
- Downloads über den Helfer: erst mit einer Lösung, bei der DNS-Auflösung, Zielprüfung und Verbindung nicht auseinanderfallen.
