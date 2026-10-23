# Kadri – Entwicklung

## Aufbau

Je Browser eine eigene, vollständige Erweiterung – doppelte Dateien sind gewollt (jeder Browser für sich, robuster):

```
src/              das Skript – dieselben Teile wie im Userscript (Owndot/video-assistent-helper, Ordner src/)
chrome/           Chrome/Vivaldi/Edge (Manifest V3)
  manifest.json   Rechte: storage, declarativeNetRequestWithHostAccess, scripting (kein webRequest)
  prelude.js      Ersatz für den Userscript-Manager: GM_xmlhttpRequest, GM_getValue/SetValue, GM_registerMenuCommand,
                  hls.js bei Bedarf (KADRI_HOOKS.loadHls)
  epilogue.js     lädt die gespeicherten Werte, dann startet das Skript
  background.js   Anfragen an andere Server (Schutzregeln, Referer per Sitzungsregel), Nachladen (hls.js, Kadri in
                  eingebetteten Fenstern), Kadri-Symbol → Diagnose
  page.js         („MAIN world“) liest Stream-Listen (auch am Content-Type) und Facebook/Instagram-API-Antworten mit;
                  „Schild“: verbirgt „verdeckt“ vor der Seite, solange Kadri spiegelt; antwortet auf `kadri-ping`
                  mit `kadri-pong` (so weiß Kadri, dass page.js läuft – ohne sichtbares Merkmal an der Seite)
  sub.js          winziger Wächter in eingebetteten Fenstern: Kadri erst laden, wenn dort ein Video auftaucht
  popup.*, options.*, common-ui.js, ui.css, rules.json, icons/
firefox/          Firefox (Manifest V2): wie chrome/, aber ohne page.js/sub.js; hls.js gleich mit dabei, Streams am
                  Content-Type erkennt der Hintergrund (webRequest)
defaults.js       (beim Bau erzeugt) Standardwerte aus src/020-einstellungen-sprache.js
vendor/           hls.js 1.7.3
tools/build.js    baut dist/chrome, dist/firefox und die ZIPs; --test zusätzlich dist/test (aus chrome/)
tools/sync-src.sh übernimmt src/ aus dem Userscript-Repository
tests/            Chromium mit geladener Erweiterung (Playwright), Testseiten in tests/web, nachgebaute Helfer-App
```

**Sparsam (Chrome/Vivaldi):** Auf jeder Seite laufen nur page.js (klein) und Kadri im Hauptfenster. hls.js (620 KB) lädt
der Hintergrund erst, wenn ein Stream abgespielt wird (`scripting.executeScript` in genau dieses Fenster). In
eingebetteten Fenstern (Werbung, Zähler …) wartet nur sub.js; erst wenn dort ein Video auftaucht (auch im Shadow DOM,
nach einem Tipp oder beim Abspielen), lädt der Hintergrund Kadri dorthin. page.js hebt seine letzten 40 Meldungen auf
und schickt sie noch einmal, wenn Kadri später startet (`kadri-hello`). Streams ohne Endung erkennt page.js am
Content-Type der Antwort – der Hintergrund wird dafür nicht bei jeder Anfrage aller Seiten geweckt.

**Schutzregeln für Anfragen (`guard` in background.js, beide Browser):** nur http(s); nichts im eigenen Netz (Router,
NAS, localhost – auch versteckt als `0x7f.1`, `2130706433`, `[::ffff:…]`), außer der Helfer-App auf 127.0.0.1:47811
oder wenn die Seite selbst dort liegt; Weiterleitungen ins eigene Netz → Antwort wird nicht herausgegeben; nur GET/HEAD
(POST nur an die Helfer-App); Anmeldung (Cookies) nur an dieselbe Domain wie das Fenster, aus dem die Anfrage kommt.
Test `test_guard.py`. Nachrichten eingebetteter Fenster an die Hauptseite tragen einen Schlüssel (`frameKey`, siehe
Skript 19.14), den Webseiten nicht lesen können. Angriffstest `test_attack.py`.

**Woran gearbeitet wird:** Am Skript wird im Userscript-Repository gearbeitet, danach übernimmt
`tools/sync-src.sh` den neuen Stand nach `src/`. Hier gibt es nur, was die Erweiterung anders macht (in `chrome/` und
`firefox/` jeweils für sich):

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

**Streams erkennen (nur Firefox, Hintergrund):** `webRequest.onHeadersReceived` (nur xmlhttprequest/media/other) meldet jede
Antwort mit dem Content-Type einer HLS- oder DASH-Liste an Kadri im selben Tab/Fenster. In Chrome/Vivaldi macht das page.js. Das erfasst auch Anfragen
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
| `test_fbown.py` | Facebook-Feed nachgebaut (4 Reels vorgeladen): sicher erkannt → eigener Player mit Bild-in-Bild; falsche Länge oder unklar → spiegeln; beim Spiegeln Vorschaubild aus der passenden MP4, nie aus einer falschen |
| `test_fbpip.py` | Schild: beim Spiegeln bekommt die Seite „verdeckt“ nicht mit (ihr Video läuft weiter), Kadri schon; nach dem Schließen wieder normal |
| `test_detect.py` | Stream ohne .m3u8 im Namen (nur Content-Type) → vom Hintergrund gemeldet → eigener Player (ohne: nur Spiegeln) |
| `test_pipall.py` | Seite verbietet Bild-in-Bild (Permissions-Policy wie Facebook) → mit Kadri erlaubt, Knopf öffnet das kleine Fenster; andere Verbote bleiben |
| `test_lazy.py` | hls.js nicht auf jeder Seite, kein webRequest; eingebettete Fenster: ohne Video kein Kadri, mit Video sofort, später auftauchendes Video → dann; Player im Fenster füllt den Bildschirm |
| `test_guard.py` | Schutzregeln für Anfragen (beide Browser, ohne Browser geprüft) |
| `test_attack.py` | Angriffe einer bösen Seite: Werbung will sich als Player groß machen, Programmcode im Titel, gefälschte Mitlese-Meldungen (30 MB …), falsche Koppel-Seite |
| `test_menu.py` | Menü: Seite aus/an (nach Neuladen), Helfer-Zustand; Einstellungsseite: Werte gelten im Player (auch „Spul-Lupe“), Seitenliste gespeichert |

## Versionen

| Version | Skript | Was |
|---|---|---|
| 1.12.6 | 19.20 | Nahtloser Start auf allen Seiten (laufendes Bild der Seite, bis die eigene Kopie aufgeholt hat), Zeitmessung „Öffnen (zuletzt)“ in der Diagnose, Design „Schlicht“ (Milchglas) als Standard |
| 1.12.5 | 19.19 | Nur Versionsnummer: Firefox-Paket mit `data_collection_permissions` eindeutig benennen (1.12.4 gab es mit und ohne) |
| 1.12.4 | 19.19 | Untertitel der Seite nur für das laufende Video (Video-ID, Länge), Spul-Vorschau „Im Bild“ ohne Kasten, nach Download an YTDLnis bleibt der Player offen (Vollbild per Antippen zurück). Firefox: `data_collection_permissions: none` im Manifest (Pflicht für neue Erweiterungen beim Signieren über AMO) |
| 1.12.3 | 19.18 | Facebook-Startseite: Vorschaubild beim Spiegeln aus der MP4 des Beitrags, wenn dort genau ein Video steckt und die Länge passt |
| 1.12.2 | 19.17 | Ruhiger Start: „Beim Öffnen: Nur Bild / Mit Bedienung“ (Player-Menü und Einstellungsseite), Bedienung blendet weicher ein |
| 1.12.1 | 19.16 | Vorschau robuster (nach einem Ladefehler einmal neu, kein Vorholen des ganzen Rasters mehr – nur 8 Bilder im WLAN), Diagnose: „erstes Bild nach … s“ |
| 1.12.0 | 19.15 | Wischen übers Video wie Samsung (Pause, Bild springt mit, Zahlen stimmen, kleine Leiste); schneller öffnen (Sofortbild, große Seiten viel schneller) und schließen; Vorschau-Raster im WLAN gleich; Shadow-DOM-Suche sparsamer; kein sichtbares Merkmal mehr an der Seite (`kadri-ping`/`kadri-pong`); hls.js 1.7.3 ist aktuell |
| 1.11.0 | 19.14 | Eigene Ordner `chrome/` und `firefox/`. Sparsamer: hls.js erst bei Bedarf, Kadri in eingebetteten Fenstern erst mit Video (sub.js), Streams am Content-Type über page.js statt webRequest (Chrome), Facebook-Prüfung seltener. Sicherer: Schutzregeln für Anfragen (kein eigenes Netz, Cookies nur an die Seite selbst, nur GET), Fenster-Nachrichten mit Schlüssel (Werbung kann sich nicht mehr als Player ins Vollbild legen). Tests `test_lazy.py`, `test_guard.py`, `test_attack.py` |
| 1.10.2 | 19.13 | Nur noch eine Lupen-Stufe (kein „Fein“), Lupe auch bei Live; nicht bei kurzen Videos |
| 1.10.1 | 19.12 | Lupe/Fein bei Live aus; Vorschau kann nicht mehr „hängen“ (nur Zeit), Ladefehler → laufende Quelle; Diagnose zeigt Grund für Vorschau und Lupe |
| 1.10.0 | 19.11 | Spulen ohne Einrasten (Abbrechen nur nach oben); robuster (Finger verloren, App-Wechsel, anderes Video → sauber abbrechen; flüssiger; Lade-Kreis nach dem Sprung); Vorschau abgedunkelt, solange sie lädt; Live-Streams mit Zurückspulen („LIVE“/„−5:30“); Einstellungen „Spul-Lupe“ und „Vibration“ (auch auf der Einstellungsseite) |
| 1.9.2 | 19.10 | Abbrechen an der laufenden Stelle: sie wandert mit dem Video mit, eingerastet läuft sie unter dem Finger mit, dort keine kleine Vorschau; loslassen = Video läuft einfach weiter |
| 1.9.1 | 19.9 | Großer Punkt nur beim Ziehen (stand sonst links über der Zeit); kein Punkt mehr für die alte Stelle – zurück dorthin: Vibrieren und „Loslassen = abbrechen“ wie bei YouTube |
| 1.9.0 | 19.8 | Spulen: großer Punkt unter dem Finger (Glas/Milchglas), alte Stelle als kleiner Punkt; Lupe in Stufen wie beim iPhone – Finger unter die Leiste = „Lupe“, tiefer = „Fein“, wieder hoch = zurück |
| 1.8.0 | 19.7 | Spulen mit Lupe (wie YouTubes „präzises Spulen“): beim Ziehen kurz stillhalten oder Leiste gedrückt halten → Leiste zeigt einen Ausschnitt von 20–60 s, Grenzen links/rechts, am Ende der Leiste wandert er mit; Zeit über der Vorschau im Glas bzw. Milchglas des Designs |
| 1.7.0 | 19.6 | Spulen: Punkt genau unter dem Finger (Anfang/Ende an den Enden der Leiste – der Finger läuft nie aus dem Bild); fein nur beim bewussten Kriechen, danach gleitet die Stelle wieder unter den Finger |
| 1.6.0 | 19.5 | Feines Spulen nach dem Finger-Tempo (langsam = fein, schnell = grob), Abstand zur alten Stelle („+18 s“), alte Stelle rastet ein (Vibrieren, „± 0“); Facebook beim Spiegeln: Vorschaubild aus der MP4 desselben Videos (auch wenn sie unschärfer ist), falsche Länge → nur die Zeit |
| 1.5.0 | 19.4 | Spulen auf der Leiste neu (dick, von der aktuellen Stelle, fein, Abbrechen nach oben), Vorschaubild wieder Standard |
| 1.4.0 | 19.3 | Spulen im Bild (wie Samsung Internet) auch beim Spiegeln, Einstellung „Spul-Vorschau“; Facebook: eigener Player nur bei mindestens gleicher Schärfe, sonst spiegeln (Facebook-Qualität) |
| 1.3.1 | 19.2 | Vollbild von selbst nur mit frischer Berührung (keine Konsolenfehler) |
| 1.3.0 | 19.1 | Bild-in-Bild auf allen Seiten: Regel `ext/rules.json` hängt an jede Seite „Permissions-Policy: picture-in-picture=*“ an (Facebook verbietet es sonst für die ganze Seite – kein Knopf, kein automatisches kleines Fenster); andere Verbote der Seite bleiben. Test `test_pipall.py` |
| 1.2.0 | 19.1 | Ohne Helfer auch keine Lautstärke-Geste; Bild-in-Bild-Knopf immer da (ohne Browser-Bild-in-Bild: Hinweis); Diagnose zeigt Bild-in-Bild- und Vorschau-Zustand |
| 1.1.0 | 19.0 | Facebook eigener Player (wenn sicher), Bild-in-Bild auch beim Spiegeln (Schild) und auf Facebook/Instagram, Streams am Content-Type erkennen (auch aus Workern), Menü im Puzzle-Symbol, Einstellungsseite mit Seitenlisten |
| 1.0.0 | 18.8 | Erste Fassung: alle Funktionen des Skripts. Ohne Helfer ist ausgeblendet, was nur mit Helfer geht. Stream-Listen werden in der Seite mitgelesen (`page.js`). Diagnose über das Kadri-Symbol |
