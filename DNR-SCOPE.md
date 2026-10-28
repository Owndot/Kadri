# Kadris Schutzregeln (DNR) nur für Kadris eigene Anfragen

## Befund (Kadri `main` `d52faae`, 1.12.15)

Alle Sitzungsregeln (Chromium) hatten nur die Bedingung `tabIds: [-1]` („kein Tab“). Das trifft Kadris eigene Anfragen, aber auch **jede Anfrage eines Service Workers einer fremden Webseite** (auch die haben keinen Tab). Nachgewiesen mit echtem Chromium und echten Listenern:

- Regel 80 entfernte Cookie und Authorization aus den Anfragen fremder Service Worker (mit Kadri kam `-` statt `sess=abc` an).
- Regeln 51–58 und 70 sperrten fremde Service Worker für `127.0.0.0/8`, private Netze und `localhost`; auch Weiterleitungen dorthin.
- Kadris kurzlebige Referer-Regel (genau eine Adresse) setzte ihren Referer auch auf die gleichzeitige Anfrage eines fremden Service Workers an dieselbe Adresse.

## Korrektur

Jede Sitzungsregel bekommt zusätzlich `initiatorDomains: [<Erweiterungs-ID>]`: Sie gilt nur für Anfragen **ohne Tab UND von dieser Erweiterung** (Hintergrund, Popup, Optionen). Der Initiator bleibt über alle Weiterleitungsschritte derselbe; die Regeln greifen also weiter bei jedem Schritt. Die Prüfung `netGuard()` vergleicht die gesetzten Regeln vollständig mit den erwarteten (inklusive Initiator) und sperrt bei Abweichung alle Anfragen außer an die Helfer-App (unverändert).

| Regel | Sicherheitsfunktion | Wirkung der Initiator-Einschränkung | Erhalten? Nachweis |
| --- | --- | --- | --- |
| 50 `allow` `127.0.0.1:47811` (Prio 10) | Kadris Anfragen an die Helfer-App trotz Sperre 51 | Fremde Service Worker sind ohnehin nicht mehr gesperrt; die Ausnahme betrifft nur Kadri | ja – `test_redirect.py`, `test_helper.py` (Helfer erreichbar), `guard_check.js` |
| 51–58 `block` private Adressbereiche (Prio 5) | Kadris eigene Anfragen erreichen nie das Heimnetz, auch nicht per Weiterleitung (öffentliche Adresse → Router) | gilt weiter für jeden Schritt einer Kadri-Anfrage; fremde Service Worker werden nicht mehr gesperrt | ja – `test_dnr_scope.py` O1, `test_redirect.py`; fremd: F2, F4 |
| 70 `block` `localhost`, `.local`, `.internal`, `.lan` | wie 51–58 für Namen | wie oben | ja – O2; fremd: F3 |
| 80 `modifyHeaders` Cookie/Authorization/Proxy-Authorization entfernen, außer laufende angemeldete Seite (Prio 30) | Kadris Anfragen nehmen Anmeldedaten nur zur Seite des Fensters mit, nie zu einem fremden Weiterleitungsziel | gilt weiter für jeden Schritt einer Kadri-Anfrage; fremde Service Worker behalten ihre Cookies | ja – `test_redirect.py` (inkl. Gegenprobe ohne Regel); fremd: F1 |
| 1000–900000 `modifyHeaders` Referer setzen, genau eine Adresse (Prio 1) | Referer für genau Kadris Anfrage (fetch darf ihn nicht setzen) | gleichzeitige fremde Anfrage an dieselbe Adresse bekommt ihn nicht mehr | ja – F5 (beide Anfragen gleichzeitig, Server hält beide an) |
| 1000–900000 `allow` genau eine Adresse (Prio 20) | Medienserver zu Hause: genau Kadris Anfrage an genau diese Adresse | unverändert für Kadri; fremde Anfragen waren nie das Ziel | ja – `test_redirect.py` (Medienserver), `guard_check.js` |
| statisch `rules.json` Regel 1 (`permissions-policy: picture-in-picture=*` für Seiten) | gewollte Funktion für **Seiten** (Bild-in-Bild) | nicht geändert – sie soll Seiten betreffen | – |

Anfragen aus Tabs (auch Content-Script-`fetch`) betrafen die Regeln nie und betreffen sie weiterhin nicht.

## Firefox

Firefox schützt Kadris Anfragen mit `webRequest`; die Prüfung `own()` verlangt bereits „kein Tab“ **und** Herkunft `moz-extension://<diese Erweiterung>` – fremde Service Worker waren dort nicht betroffen. Einzige DNR-Regel ist die kurzlebige Referer-Regel; sie bekommt dieselbe Einschränkung (`initiatorDomains: [<moz-extension-Host>]`). Nachweis mit echtem Firefox im CI-Job `dnr-scope` (`tests/firefox_dnr_scope.py`): fremder Service Worker (Cookies, `localhost`, Weiterleitung) wie ohne Kadri; Referer nur auf Kadris Anfrage; Kadris eigene Weiterleitung zu einer anderen lokalen Adresse bleibt gesperrt; Gegenprobe ohne Einschränkung muss auffallen.

## Tests

- `tests/test_dnr_scope.py` (Chromium, echte Listener, fremder Service Worker `tests/web/sw_foreign.*`): F1–F5, Gegenprobe ohne Kadri, O1–O3.
- `tests/dnr_scope_mutation.py`: 7 Mutanten (alter Stand, je Regel ohne Initiator, falscher Initiator, ohne Tab-Bedingung) – alle müssen auffallen.
- `tests/firefox_dnr_scope.py` (echter Firefox im CI).
- Unverändert und weiter grün: `test_redirect.py`, `test_guard.py`, `test_worker_restart.py`, `test_abort.py`, `test_helper.py` u. a.
