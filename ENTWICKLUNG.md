# Kadri – Entwicklung

## Aufbau

```
src/            das Skript – dieselben Teile wie im Userscript (Owndot/video-assistent-helper, Ordner src/)
ext/prelude.js  Ersatz für den Userscript-Manager: GM_xmlhttpRequest, GM_getValue/SetValue, GM_registerMenuCommand
ext/epilogue.js lädt die gespeicherten Werte, dann startet das Skript
ext/background.js  Anfragen an andere Server (ohne CORS-Sperre, Referer per Sitzungsregel), Kadri-Symbol → Diagnose
ext/page.js     (nur Chrome/Vivaldi, „MAIN world“) liest Stream-Listen und Facebook/Instagram-API-Antworten mit
vendor/         hls.js 1.7.3
tools/build.js  baut dist/chrome (Manifest V3), dist/firefox (Manifest V2) und die ZIPs; --test zusätzlich dist/test
tools/sync-src.sh  übernimmt src/ aus dem Userscript-Repository
tests/          Chromium mit geladener Erweiterung (Playwright), Testseiten in tests/web, nachgebaute Helfer-App
```

**Woran gearbeitet wird:** Am Skript wird im Userscript-Repository gearbeitet, danach übernimmt
`tools/sync-src.sh` den neuen Stand nach `src/`. Hier gibt es nur, was die Erweiterung anders macht:

- **Wenige Stellen, die das Bau-Skript ersetzt:** der Kopf des Userscripts, der Titel und die Version in der Diagnose.
  Jede dieser Stellen muss genau einmal vorkommen, sonst bricht der Bau ab.
- **`__KADRI__`:** Die Erweiterung setzt diesen Wert. Das Skript erkennt daran, dass es in Kadri läuft (`IS_KADRI`).
  Dann blendet es ohne Helfer aus, was nur mit Helfer geht (`HIDE_NO_HELPER`), und nimmt das Ereignis
  `kadri-net` von `page.js` an.

**Getrennte Bereiche:** Das Skript läuft wie im Userscript (`@inject-into content`) im abgetrennten Bereich
der Erweiterung. Die Seite kann es dort nicht stören, es sieht aber auch die Anfragen der Seite nicht. Deshalb gibt
es `page.js`: Es läuft in der Seite selbst, liest nur mit (ändert nichts) und reicht den Text der Stream-Listen und
API-Antworten weiter, als Ereignis `kadri-net` mit JSON-Text. Im Userscript fehlt dieser Weg. Darum stand dort in
der Diagnose „Listen gelesen: 0“.

**Anfragen (`GM_xmlhttpRequest`):** Die Anfragen laufen über eine Verbindung (`runtime.connect`, Name `kadri-xhr`)
zum Hintergrund, der sie mit `fetch` ausführt.
- Binäre Antworten (`arraybuffer`/`blob`) kommen in Base64-Stücken zurück, weil Nachrichten in Chrome nur JSON können.
- Den Referer darf `fetch` nicht setzen. Dafür gibt es eine kurze `declarativeNetRequest`-Sitzungsregel, nur für
  genau diese Adresse und nur für Anfragen ohne Tab.
- `onreadystatechange` (readyState 2 mit `finalUrl`), `onprogress`, `timeout`, `anonymous` und `abort()` verhalten
  sich wie bei Violentmonkey.

**Speicher:** Die Werte liegen in `storage.local` unter `gm:<Schlüssel>`, zum Beispiel `gm:settings` und
`gm:helperKey`. Sie werden vor dem Start einmal geladen, danach liest das Skript sie sofort und ohne Warten.

**Firefox:** Die Firefox-Fassung nutzt Manifest V2, weil die Rechte für alle Seiten dort gleich bei der Installation
gelten. Bei Manifest V3 müsste man sie erst von Hand freigeben. `page.js` fehlt dort, weil Firefox keine „MAIN world“
im Manifest kennt. Zum Installieren muss die Firefox-Fassung von Mozilla signiert sein (AMO, auch „nicht gelistet“
möglich). Die Tests laufen derzeit nur in Chromium.

## Bauen und testen

```
node tools/build.js            # dist/chrome, dist/firefox, dist/kadri-*.zip
node tools/build.js --test     # + dist/test (offenes Shadow-DOM, markiert mit data-kadri-test)
tests/run_all.sh               # alle Tests (ohne Bildschirm automatisch unter xvfb-run)
TESTS=test_helper.py tests/run_all.sh
```

| Test | prüft |
|---|---|
| `test_basic.py` | Datei und Stream im Player, Diagnose über das Kadri-Symbol, Einstellungen bleiben gespeichert |
| `test_helper.py` | ohne Helfer: keine Helligkeit, kein „Helper-App“, keine Helfer-Downloads. Mit Helfer: alles da, Anfragen mit Schlüssel. Koppeln speichert den Schlüssel |
| `test_streams.py` | Stream-Nachweis über `page.js` (vorgeladenes nächstes Video), Videowechsel ohne Neuladen, A → B → A |
| `test_facebook.py` | Spiegeln, kein Bild-in-Bild, Teilen des laufenden Reels, Reel-Ende, Countdown „Next reel“ abbrechen |

## Versionen

| Version | Skript | Was |
|---|---|---|
| 1.0.0 | 18.8 | Erste Fassung: alle Funktionen des Skripts. Ohne Helfer ist ausgeblendet, was nur mit Helfer geht. Stream-Listen werden in der Seite mitgelesen (`page.js`). Diagnose über das Kadri-Symbol |
