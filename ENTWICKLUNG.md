# Kadri – Entwicklung

## Aufbau

```
src/            das Skript – dieselben Teile wie im Userscript (Owndot/video-assistent-helper, Ordner src/)
ext/prelude.js  Ersatz für den Userscript-Manager: GM_xmlhttpRequest, GM_getValue/SetValue, GM_registerMenuCommand
ext/epilogue.js lädt die gespeicherten Werte, dann startet das Skript
ext/background.js  Anfragen an andere Server (ohne CORS-Sperre, Referer per Sitzungsregel), Kadri-Symbol → Diagnose
ext/page.js     (nur Chrome/Vivaldi, „MAIN world“) liest Stream-Listen und Facebook/Instagram-API-Antworten mit;
                „Schild“: verbirgt „verdeckt“ vor der Seite, solange Kadri spiegelt (Bild-in-Bild/Hintergrund)
ext/popup.*     Menü hinter dem Puzzle-Symbol (Seite an/aus, Helfer-Zustand, Diagnose, Einstellungen)
ext/rules.json  Regel: Bild-in-Bild erlauben, auch wo die Seite es per Permissions-Policy verbietet
ext/options.*   Einstellungsseite (alle Einstellungen + Seitenlisten), ext/common-ui.js, ext/ui.css
defaults.js     (beim Bau erzeugt) Standardwerte aus src/020-einstellungen-sprache.js
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

**Schild (Bild-in-Bild beim Spiegeln):** Kadri schaltet es nur ein, solange es ein Video der Seite spiegelt (Ereignis
`kadri-ctl`). page.js gibt der Seite dann auf „verdeckt?“ immer „sichtbar“ zurück und hält die Meldung
`visibilitychange` an, bevor die Seite sie bekommt. Kadri selbst erhält sie als `kadri-vis`. Nach dem Schließen
gilt wieder alles wie gewohnt. In Firefox fehlt page.js, dort gibt es beim Spiegeln kein Bild-in-Bild.

**Streams erkennen (Hintergrund):** `webRequest.onHeadersReceived` (nur xmlhttprequest/media/other) meldet jede
Antwort mit dem Content-Type einer HLS- oder DASH-Liste an Kadri im selben Tab/Fenster. Das erfasst auch Anfragen
aus Workern und Adressen ohne Endung. Ohne Endung bekommt die Adresse ein Kennzeichen hinter `#`, zum Beispiel
`#kadri.m3u8`. Dieser Teil geht nicht an den Server.

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
| `test_facebook.py` | Spiegeln (mit Bild-in-Bild), Teilen des laufenden Reels, Reel-Ende, Countdown „Next reel“ abbrechen |
| `test_fbown.py` | Facebook-Feed nachgebaut (4 Reels vorgeladen): sicher erkannt → eigener Player mit Bild-in-Bild; falsche Länge oder unklar → spiegeln |
| `test_fbpip.py` | Schild: beim Spiegeln bekommt die Seite „verdeckt“ nicht mit (ihr Video läuft weiter), Kadri schon; nach dem Schließen wieder normal |
| `test_detect.py` | Stream ohne .m3u8 im Namen (nur Content-Type) → vom Hintergrund gemeldet → eigener Player (ohne: nur Spiegeln) |
| `test_pipall.py` | Seite verbietet Bild-in-Bild (Permissions-Policy wie Facebook) → mit Kadri erlaubt, Knopf öffnet das kleine Fenster; andere Verbote bleiben |
| `test_menu.py` | Menü: Seite aus/an (nach Neuladen), Helfer-Zustand; Einstellungsseite: Werte gelten im Player, Seitenliste gespeichert |

## Versionen

| Version | Skript | Was |
|---|---|---|
| 1.5.0 | 19.4 | Spulen auf der Leiste neu (dick, von der aktuellen Stelle, fein, Abbrechen nach oben), Vorschaubild wieder Standard |
| 1.4.0 | 19.3 | Spulen im Bild (wie Samsung Internet) auch beim Spiegeln, Einstellung „Spul-Vorschau“; Facebook: eigener Player nur bei mindestens gleicher Schärfe, sonst spiegeln (Facebook-Qualität) |
| 1.3.1 | 19.2 | Vollbild von selbst nur mit frischer Berührung (keine Konsolenfehler) |
| 1.3.0 | 19.1 | Bild-in-Bild auf allen Seiten: Regel `ext/rules.json` hängt an jede Seite „Permissions-Policy: picture-in-picture=*“ an (Facebook verbietet es sonst für die ganze Seite – kein Knopf, kein automatisches kleines Fenster); andere Verbote der Seite bleiben. Test `test_pipall.py` |
| 1.2.0 | 19.1 | Ohne Helfer auch keine Lautstärke-Geste; Bild-in-Bild-Knopf immer da (ohne Browser-Bild-in-Bild: Hinweis); Diagnose zeigt Bild-in-Bild- und Vorschau-Zustand |
| 1.1.0 | 19.0 | Facebook eigener Player (wenn sicher), Bild-in-Bild auch beim Spiegeln (Schild) und auf Facebook/Instagram, Streams am Content-Type erkennen (auch aus Workern), Menü im Puzzle-Symbol, Einstellungsseite mit Seitenlisten |
| 1.0.0 | 18.8 | Erste Fassung: alle Funktionen des Skripts. Ohne Helfer ist ausgeblendet, was nur mit Helfer geht. Stream-Listen werden in der Seite mitgelesen (`page.js`). Diagnose über das Kadri-Symbol |
