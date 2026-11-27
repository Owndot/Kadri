# Unabhängiges P0-A-Sicherheitsreview · Quellentyp, Typprobe und Ausgabekorrekturen

**Prüfgegenstand:** Produktbaum `a7ac09d1e1d6ad0e788533af6971aa0e18900271` (Branch `fix/p0a-source-type-and-external-seek`).
**Art:** reine adversarielle Prüfung in frischem Checkout, ohne Zugriff auf den Entwicklungschat, ohne Produktänderung.
**Prüfer:** Claude (gleicher Modellanbieter wie der Entwickler). Jede Aussage unten ist entweder durch eine eigene,
in diesem Bericht beschriebene Messung belegt oder ausdrücklich als *unbestätigt*, *hypothetisch* oder *nicht prüfbar* markiert.
Aussagen aus Commit-Nachrichten und der Entwicklerübergabe wurden nicht als Beleg übernommen.

## Urteil

**NO-GO.**

Die Korrekturen schließen die CORS-lesbaren, endungslosen und `.m3u`-Fälle des Vorreviews nachweisbar. Es bleiben aber drei
**gemessene** Umgehungen der Sicherheitsinvariante, bei denen Kadri selbst Requests an eine **bereits als MPD erkannte**
Adresse auslöst – auch in der echten Erweiterung mit Service-Worker und ISOLATED-Content-Script:

1. **P0-1** `.mp4`-benanntes HLS ohne lesbare Probe (fremde Site ohne CORS): `claimed-file` → `vid.src` nativ und von Kadri
   veranlasster Originalstart → **2 Requests an die bekannte MPD-Variante** (Erweiterung, Fix = Basis).
2. **P0-2** Verdrängung des Typbelegs (1024 Einträge): ein zuvor **lesbar** als HLS bzw. DASH erkanntes `.mp4` wird wieder
   `claimed-file`; der Probecache schreibt den Beleg nicht neu → **2 MPD-Variantenrequests** bzw. **1 nativer GET auf das MPD**.
3. **P0-3** Vorschau-Alternative: `previewSrc` wählt `claimed-file`-Kandidaten **ohne jede Probe** → `pv.src` nativ →
   **1 MPD-Variantenrequest**, auch bei gleicher Herkunft und bei CORS.

Nach der Entscheidungsschwelle des Auftrags („bei tatsächlichem unkontrolliertem Variantenrequest NO-GO“) ist P0-A nicht
abgeschlossen. Isolierte P0-B-Entwicklung, vollständige E2E-Abnahme, automatische DASH-Downloads, Beta/Release und
Gerätefreigabe bleiben gesperrt (Abschnitt 11).

## 1. Referenzen, Elternkette, geänderte Dateien

Frischer Klon von `https://github.com/Owndot/Kadri`, alle SHAs als `commit` aufgelöst:

| Rolle | SHA | Parent (verifiziert) |
|---|---|---|
| Basis | `93bd99a021bc8617940e9846d7a7490ec94bc6f2` | `8fde14033c35aca6f2619283afa1cc7ca1197742` |
| P0 Ladeweg/Originalstart | `dc374ef69f32aab45717ef71297db3d370059256` | `93bd99a` |
| P1 „In App öffnen“ | `b99506d37dbd65f57b5ae1a4b640d821d0226c3b` | `dc374ef` |
| P1 Medienplaylist | `9bcb05914cf46e100dc58731c5d76350020f26a6` | `b99506d` |
| P2 Reparse-Test | `b38741934efa61b010ceb05536f88819c84cab5d` | `9bcb059` |
| P2 Längenbudget | `3d0a5dce4086bcc08e084b57d577ef9007cb7445` | `b387419` |
| Test Redirect-Ziel (geprüfter Baum) | `a7ac09d1e1d6ad0e788533af6971aa0e18900271` | `3d0a5dc` |
| Übergabebericht | `39e002b242a33bfae79995c2d7c901846dbe2ef3` | `a7ac09d` (= Branchspitze) |
| Vorreview | `193129f216188e607fca555c529364e625fb8623` | `93bd99a` |
| Vorherige Übergabe | `82f568aa00a05fbe32981707b22f26e3d355495c` | `93bd99a` |

Kette linear. `dc374ef` ist **nicht** in `origin/main` (`cd00ded…`). Helper geklont und auf
`6e553fcb82b437ce0be487233dd35f41958bade6` ausgecheckt (unverändert, nur Testbau).

`git diff --stat 93bd99a a7ac09d`: Produkt nur `src/040-quellen-netzwerk.js` (+70 −2), `src/125-player-hls.js` (+19 −7),
`src/170-player-laden.js` (+13 −1), `src/180-player-bedienung.js` (+2 −2), `src/230-player-vorschau.js` (+3 −1); Tests: 6 Prüferdateien und
`tests/web/hls2/b/long4097.m3u8`. `39e002b` ändert ausschließlich `docs/handoffs/P0A-SOURCE-TYPE-EXTERNAL-SEEK.md`.
**Unverändert (Diff leer):** `chrome/` (inkl. `background.js`, Manifest), `firefox/`, `channel/`, `vendor/` (inkl. `hls.min.js`),
`tools/`, `.github/`, `package.json`. `src/045`, `src/065`, `src/260` sind unverändert, ihr Verhalten ändert sich aber über die
neuen Aufrufe (`hlsNativeStartAllowed` → `mediaTypeOf`).

## 2. Eigenständige Ursachenanalyse der Typentscheidung

`mediaTypeOf(u)` (`src/040:371–380`) liefert in dieser Reihenfolge: `dash` (MPD-Identität oder `.mpd`/`#kadri.mpd`),
`hls` (Typcache `mediaTypeSeen` oder Pfad `.m3u`/`.m3u8`), `file` (nur eigene Probe), **`claimed-file`** (Pfad `.mp4/.m4v`
oder andere Mediendateiendung), sonst `''`.

Verwendung:

| Stelle | Entscheidung bei `claimed-file` |
|---|---|
| `src/170:137–143` (`tryNext`) | einmal je Player Probe; **danach, wenn die Probe nichts lesen konnte, `vid.src = u` (`:198–199`)** |
| `src/170:253` → `src/260:99` → `src/125:161` (`useCapture`, `handBack`, Stallwächter) | `hlsNativeStartAllowed` → **`true`**, dann `orig.play()` (`src/170:275`, `src/260:146`) |
| `src/230:43–46, 105` (Vorschau) | Alternative zulässig **ohne Probe**, `pv.src = u` |

Belegquellen in Chromium (eigene Prüfung des Codes):
- **Keine Content-Type-Meldung.** `kadri-src` sendet nur `firefox/background.js:239` (`webRequest`); `chrome/background.js`
  hat keine solche Beobachtung, das Manifest kein `webRequest`. In Chrome/Samsung/Vivaldi entfällt dieser Beleg vollständig.
- Der Seiten-`fetch`-Mitleser liest nur Adressen mit `PLAYLIST_RE` (`src/040:725`), also nie ein `.mp4`.
- `content.js` läuft in der ISOLATED-Welt; sein `fetch` unterliegt der CORS-Regel der Seite (in E2E-1/E2E-3 gemessen:
  Probe `Sec-Fetch-Mode: cors`, `Origin: http://127.0.0.1:18881`, Ergebnis unlesbar).

Folge: Für ein HLS unter `.mp4` auf fremder Site ohne CORS gibt es in Chromium-Browsern **keinen** restriktiven Beleg; die
Dateiendung gibt die native Wiedergabe frei. Chromium 158 spielt HLS nativ (`canPlayType('application/vnd.apple.mpegurl') = 'maybe'`,
gemessen), wählt zuerst die niedrigste Bandbreite und schaltet nach oben – jede Variante wird dabei ohne Kadris Guard abgerufen.

Zusätzlich (Abschnitt 4): `mediaTypeSeen` ist ein FIFO mit 1024 Schlüsseln (`src/040:368`); ein Rang-Update verschiebt
den Eintrag nicht nach hinten. `mediaProbes` (`src/040:396`) gibt bei Treffer nur das alte Promise zurück; `noteMediaType`
läuft nur im ersten Lauf (`:411`). Probe-`dash` wird nicht als MPD-Identität registriert (kein `rememberMpdIdentity`).

## 3. Getarntes `.mp4` ohne CORS, endungsloses HLS, Redirects

### Prüfstand (unabhängig)
- Zwei echte HTTP/1.1-Server (Python `ThreadingHTTPServer`), **keine Playwright-Routen**: Seite `http://127.0.0.1:P`,
  Medien `http://localhost:P+1` (andere Site). Jeder Request wird serverseitig mit Methode, Pfad samt Query, `Range`,
  `Sec-Fetch-Dest`, `Sec-Fetch-Mode`, `Origin`, `Cookie`, `Referer` und gesendeten Bytes protokolliert.
- Master: zwei `STREAM-INF`-Kinder `/v/a/index.m3u8?src=gen`, `/v/b/index.m3u8?src=gen` (absolut, Medienhost); beide vorab
  über `notePlaylist` mit echtem MPD-Text klassifiziert und durch 44 weitere Analysen aus dem Summary-Cache verdrängt
  (`!dashSummaryOf(u) && mediaIsDashManifest(u)` geprüft). Kind-Requests werden nur serverseitig gezählt; Klassifikation
  erfolgt ohne Netz, daher ist **jeder** Kind-Request ein Folgeabruf nach Kadris Entscheidung.
- Komponentenmodus: zusammengesetzter `src/` (wie die Repo-Prüfer) im Seitenkontext, `HTMLMediaElement.prototype.play`/`src`
  und `v.currentTime` als delegierende Zähler. Erweiterungsmodus: ungepacktes `dist/test` (`node tools/build.js --test`),
  echter Service-Worker, Knopf „Im Videoplayer öffnen“ im Shadow-DOM.
- Browser: Chrome for Testing **158.0.8127.36** (`/opt/pw-browsers/chromium`), Playwright 1.63.0 (Python), Xvfb für die Erweiterung.

### Ergebnisse Komponentenmodus (Kind-Requests an bekannte MPD während geöffnet; Original-Play während geöffnet; Plays/Seeks nach Schließen)

| Fall | Basis `93bd99a` | Fix `a7ac09d` | Ladeweg Fix |
|---|---|---|---|
| A1 `/x/video.mp4` HLS, fremde Site, **ohne CORS** | **2** · 1 · 2/1 | **2 · 1 · 2/1** | Probe unlesbar → `vid.src` nativ → Capture → `orig.play()` |
| A2 dieselbe Quelle **mit CORS** | **2** · 1 · 2/1 | 0 · 0 · 0/0 | Probe `hls` → hls.js, fail-closed |
| A3 endungslos ohne CORS | **2** · 1 · 2/1 | 0 · 0 · 0/0 | Typ `''` → übersprungen |
| A4 `.m3u` ohne CORS | **1** | 0 | hls.js (XHR scheitert an CORS) |
| A5 `.m3u8` ohne CORS | 0 | 0 | hls.js |
| A6 `.mp4?token=abc123` ohne CORS | **2** · 1 · 2/1 | **2 · 1 · 2/1** | wie A1 |
| A7 echte MP4 `.mp4?q=2` ohne CORS | dekodiert 640 px | dekodiert 640 px, Rückgabe 1 Play/1 Seek | `claimed-file` nativ |
| A8 echte MP4 endungslos ohne CORS | dekodiert | **nicht abgespielt** (Funktionsverlust) | Typ `''` |
| A9 echte MP4 `.mp4` mit CORS | dekodiert | dekodiert, Probe `file` | nativ |
| R1 `.mp4` → 302 → `/y/dir2/master` | **2** | **2** | wie A1 |
| R2 endungslos → 302 → `.mp4`-Master | **2** | 0 | Typ `''` |
| R3 `.mp4` → 302 → Master **mit CORS** | **2** | 0 | Probe folgt, `res.url` notiert |
| R4 `.m3u8` → 302 → `.mp4`-Master | 0 | 0 | hls.js |
| R5 gleiche Herkunft `.mp4` → 302 → fremde Site ohne CORS | **2** | **2** | wie A1 |
| R6 `.mp4?a=1` → 302 → `.mp4?b=2` | **2** | **2** | wie A1 |

Wiederöffnen nach A1 (Fix): 0 neue Probe-GETs (Cache), erneut `vid.src` nativ, **1** weiterer Kind-Request.

**Zeitliche Zuordnung (A1, Fix, eine Messung, ms ab Beginn):** 122 `vv.src=…/x/video.mp4` · 124/130 native Master-GETs ·
**173 GET `/v/b/index.m3u8?src=gen` (Kadris eigener Player)** · 221 `ORIG.play` (`useCapture`) · 223 nativer Master-GET ·
**268 GET `/v/b/…` (von Kadri gestartetes Original)** · 312 Original-`error` · nach Schließen 2 weitere `ORIG.play`
(Resume +200 ms, Stallwächter +3 s). Die Probe (117 ms, `bytes=0-4095`, `cors`) ist vorgelagert und nicht mitgezählt.

### Lebenszyklus (Fix)

| Fall | Ergebnis |
|---|---|
| L1/F2 `.mp4` ohne CORS, alle Antworten 3 s verzögert, Schließen nach 1 s (vor der Masterantwort) | eigener Player noch ohne `src`; nach Schließen **2 Original-Plays, 1 Seek, 1 Kind-Request** (Fenster 9 s) |
| L2 Schließen nach Erkennung (8 s) | 2 Kind-Requests während geöffnet, 0 nach Schließen |
| Capture-Fallback | in A1/A6/R1/R5/R6 jeweils `mode = capture` und 1 `orig.play()` aus `useCapture` (`src/170:275`) |
| Wiederöffnen | siehe A1 |

### Erweiterung (echtes Produkt, `dist/test`, Service-Worker vorhanden)

Seite `127.0.0.1:18881` spielt `<video src=http://localhost:18882/x/video.mp4>` nativ (niedrige Variante echt `hls2/b`,
hohe Variante `/v/hi/index.m3u8?src=gen`). Die Seite liest die hohe Variante per CORS-`fetch` und erhält MPD-Text
(page.js → `notePlaylist`); native `no-cors`-Abrufe dieser Adresse erhalten eine echte Playlist, damit das Original läuft.
Gezählt ab dem Tipp.

| Fall | Basis-Build | Fix-Build |
|---|---|---|
| E2E-1 `.mp4`-HLS ohne CORS | `.vv.src` = Adresse, 320 px, **2 Requests an die MPD-Variante** | Probe 1× (`cors`, unlesbar), `.vv.src` = Adresse, 320 px, **2 Requests an die MPD-Variante** |
| E2E-2 gleiche Quelle mit CORS | nativ, **2** | hls.js (`blob:`), **0**; Original nach Schließen nicht nativ fortgesetzt |
| E2E-3 endungslose echte MP4 ohne CORS | dekodiert 640 px | **kein Player**, Seitenvideo bleibt angehalten (t = 1,87) |
| E2E-4 echte `.mp4` ohne CORS | dekodiert 640 px | dekodiert 640 px |

**Bewertung:** Der in der Übergabe als „Restgrenze ohne Messung“ geführte `.mp4`-Fallback ist eine **bestätigte P0-Umgehung**.
Er betrifft genau die in Chromium-Browsern übliche Konstellation (fremdes CDN ohne CORS); der Fix ändert dort gegenüber der Basis nichts.

## 4. Eviction, Cachegrenzen, spätere Klassifikation

In-page an den Produktfunktionen (Fix):

| Prüfung | 1022 | 1023 | 1024 | 1025 |
|---|---|---|---|---|
| E1 `noteMediaType(U,'hls')`, dann n weitere eindeutige Belege: `mediaTypeOf(U)` | hls | **hls** | **claimed-file** | claimed-file |
| … `hlsNativeStartAllowed({}, U)` | false | false | **true** | true |

- **E1b** Nur-Typcache-DASH-Beleg (`.mp4`), 1024 weitere: `dash` → `claimed-file`, `mediaSourceAllowed` `true`, `knownMpdIdentity` `false`.
- **E1c** Ein **einziger** von der Seite gelesener Master mit 1100 `STREAM-INF`-Zeilen verdrängt den HLS-Beleg (`hls` → `claimed-file`).
  Seitentext kann restriktive Belege also nicht nur setzen, sondern auch **entfernen**.

| Probecache: Ziel, dann n weitere Proben, dann Ziel erneut | 254 | 255 | 256 | 257 |
|---|---|---|---|---|
| E2 GETs auf das Ziel | 1 | **1** | **2** | 2 |

„Einmal je Adresse und Seite“ gilt also nur, solange weniger als 256 neuere Proben stattfanden.

**E3 (Pflicht-Gegenprobe Typbeleg-Eviction, End-zu-Ende, Fix):** gleiche Herkunft (lesbar), `/e/hls.mp4` = HLS-Master mit zwei
bekannten MPD-Kindern.

| Lauf | Typ | Ladeweg | Probe-GETs | native Master-GETs | MPD-Kind-Requests | Original-Plays |
|---|---|---|---|---|---|---|
| 1. Öffnen | hls | hls.js, fail-closed | 1 | 0 | 0 | 0 |
| 2. Öffnen ohne Flutung | hls | hls.js | 0 | 0 | 0 | 0 |
| 2. Öffnen nach 1024 Typbelegen | **claimed-file** | **`vid.src` nativ**, dann Capture | 0 (Cache) | **3** | **2** | 1 (+1 nach Schließen) |

**E1b End-zu-Ende (DASH):** `/d/manifest.mp4` liefert MPD, gleiche Herkunft. 1. Öffnen: Probe `dash`, kein Start. Nach 1024
Belegen: `claimed-file`, `.vv.src` = MPD-Adresse, **1 nativer `media`-GET auf das erkannte MPD**, 1 Original-Play.

**E4 MPD-Identitäten (511/512/513):** die zuletzt gelesene MPD bleibt in allen Fällen `dash` und gesperrt; eine zuvor zugelassene
Adresse, die danach als MPD gelesen wird, wird gesperrt. Ab 512 Identitäten ist eine **neue, unbekannte** Adresse nicht mehr
zulässig (fail-closed, Funktionsverlust). Die MPD-Identitätssperre selbst überdauert die Summary-Verdrängung (bestätigt).

**Welche Veto-Information überlebt nicht?** Der HLS-Beleg (Seitentext, hls.js-Analyse, Probe) und der Probe-DASH-Beleg leben
nur in `mediaTypeSeen` (1024, FIFO) und gehen nach Verdrängung verloren; nur MPD-Identitäten aus gelesenem MPD-Text haben eine
eigene Sperre. Ein verlorener Beleg fällt bei `.mp4` auf `claimed-file`, also auf Freigabe – nicht auf „unbekannt“.

**Ränge `dash > hls > file`:** im Code bestätigt (`src/040:366`), höherer Rang wird nicht überschrieben; ein späterer `file`-Beleg
kann HLS/DASH nicht ersetzen. Restriktive Belege erzeugen für sich keine Freigabe – die Freigabe entsteht erst durch ihren
**Verlust** (E1/E3). Seiten-Belege können Funktionsverlust erzeugen (Übergabe-Test „Nur gemeldete HLS-Rolle“).

**Verspätete Probe:** Nach Schließen, Quellwechsel oder Navigation prüft der Rückruf `vp === st && st.cur === u && st.mode === 'own'`
(`src/170:140`); F8 (Schließen während 5-s-Probe): 0 Plays, 0 Starts. Der Abruf selbst läuft aber weiter (kein `AbortController`).
**Timeout-Wettlauf (P1-1):** `st.loadTimer` (9 s, `src/170:130`) läuft während der Probe weiter. G5 (alle Antworten 10 s) und
F1 (nur Probe 15 s), jeweils **mit CORS**: nach 9 s `vid.src` nativ, 1–2 native Master-GETs, obwohl die Probe später `hls` liefert.
In beiden Messungen 0 Kind-Requests, weil die spätere Probeantwort `tryNext` auslöste und die native Ladung abbrach (Wettlauf);
der Mechanismus ist bestätigt, ein MPD-Variantenrequest wurde hier **nicht** gemessen.

**Kontextbindung:** Typbeleg und Probe sind je Dokument (Frame) und exakte Adresse samt Query (`mediaIdentityKey`).
Cross-Frame-Nachrichten (`src/030`) übertragen nur Seitenadresse/Titel/UI-Zustand, keine Medienadressen zur Wiedergabe
(Code-Inspektion; keine schwächere Übertragung gefunden). Medien-Epoche ist nicht Teil des Typbelegs (bei gleicher Adresse
gewollt); Redirect-Provenienz: Probe notiert Ursprungs- und Endadresse gleich (R3 positiv).

## 5. Zusätzlicher Range-Abruf: gemessene Effekte

| Messung | Ergebnis |
|---|---|
| Auslöser | nur `tryNext` (Tipp → `openBrowserPlayer`, Fehler-/Timer-/Qualitätswechsel im geöffneten Player); Kandidaten stammen aus Seitenmetadaten |
| F5 gleiche Herkunft, synthetischer Cookie `sid=SYNTHETIC-PAGE` | Probe und Medienabruf senden denselben Cookie und `Referer`; keine `Authorization` |
| F5 fremde Site | Probe ohne Cookie, mit `Origin`; Medienabruf ohne Cookie (SameSite-Standard); **kein OPTIONS-Preflight** |
| Signierte Query | identische Adresse samt Query an den Server (keine Abweichung) |
| F6 Server ignoriert `Range` (200, 341 917 B, CORS) | Server sendet der Probe **341 917 B** vollständig, zusätzlich zum Medienabruf; Typ korrekt `file` |
| G1/G2 200 statt 206 bzw. 206 mit falschem `Content-Range`/`text/html` | Typ korrekt `hls`, hls.js-Pfad |
| G3 3-Byte-Antwort, G4 Status 500 | Probe `''` → `claimed-file` → nativ (G4 0 Kind-Requests, da auch nativ 500) |
| G7 chunked tröpfelnd | Typ korrekt `hls` |
| F7 Einmal-URL ohne CORS | Probe (CORS-blockiert) **verbraucht das Token** (Server sendet 4096 B), nativer Abruf erhält 403 → Wiedergabe scheitert (Basis spielt) |
| F8 Schließen während Probe | Abruf nicht abgebrochen, keine Folgeaktion |
| Transienter 503 | `''` dauerhaft gecacht; nach Erholung kein neuer GET, Typ bleibt `''` (endungslos dauerhaft gesperrt im Dokument) |
| Ziele `localhost`/private Netze | keine neue Zielklasse: dieselbe Adresse lud bisher `vid.src` nativ; neu ist ein `cors`-`fetch` mit `Origin` |

**Magic-Bytes-Dateibeleg:** `ftyp…wide`/EBML in den ersten 8 Bytes ist ein schwacher Positivbeleg (der Server bestimmt die Bytes),
aber `file` gibt nur denselben nativen Weg frei, den `claimed-file` ohnehin freigibt; eine *wechselnde* Serverantwort
(Probe ISO-BMFF, nativer Abruf HLS) ist mit jeder Probe möglich – **hypothetisch**, nicht gemessen.

*Hypothetisch, nicht prüfbar hier:* Local-Network-Access-Abfragen, die ein Seiten-`fetch` zu privaten Zielen in neueren
Chrome-Versionen auslösen könnte; Firefox-Verhalten (Content-Type-Beleg, `content.fetch`).

## 6. Externe Übergabe, Medienplaylist, Reparse, Längenbudget

**„In App öffnen“ (`src/180:618–631`):** Der ungeprüfte `orig.currentTime = t` ist entfernt (Diff bestätigt). Repo-Prüfer 7/7
(Fix), 3/7 (Basis). Eigene Zusatzprüfung mit 3 s verzögerter `finalUrl` (gleiche Basisdomain, `needsResolve`):

| Fall | externe Ausgaben | Original-Seeks | Bemerkung |
|---|---|---|---|
| X1 positiv | 1 (Link + Ausweichnavigation desselben Aufrufs) | 2 (`handBack` + Stallwächter +0,05, beide über `may()`) | Stall durch künstliche Latenz |
| X2 Player während `finalUrl` geschlossen | **0** | 1 (normales Schließen) | |
| X3 Originalquelle gewechselt | **0** | 0 | |
| X4 Element ersetzt | **0** | 0 | |

Keine falsche zweite Ausgabe gefunden (widerlegt).

**Medienplaylist (`src/125:110–134`)** an `hlsMasterText` direkt:
statisch → vollständig (1 Adresse); `DEFINE`, `CONTENT-STEERING`, `{$…}` → `incomplete`; `RENDITION-REPORT` relativ (`../b/idx.m3u8?x=1`)
und gegen Redirect-Basis (`/other/dir/r.m3u8?q=2`) korrekt aufgelöst; unbekannter Tag mit `URI` in Medienplaylist ignoriert;
BOM-Master erfasst; Text ohne `#EXTM3U` → nicht vollständig. **Hybrid** (`#EXTINF` + `STREAM-INF`): Scanner wertet als Medienplaylist
und nimmt das `STREAM-INF`-Kind **nicht** auf (vollständig mit 1 Adresse). F4: Chromium 158 ruft dieses Kind nativ **nicht** ab →
in Chromium 158 widerlegt; für Android-/Samsung-Parser **nicht prüfbar**. Repo-Prüfer 6/6 (Fix), 3/6 (Basis). Ein nativer Folgeabruf
an ein Rendition-Ziel wurde auch von mir nicht gemessen.

**Reparse-Monotonie:** `tests/test_p1_hls_reparse.py` vollständig gelesen. Mutationen in je einem Scratch-Worktree von `a7ac09d`
(Einfügung in `hlsMasterBegin` nach `rec.complete = false;`), danach nicht übernommen:

| Mutation | erweiterter Prüfer | alter Prüfer (`9bcb059`) |
|---|---|---|
| keine (Fix) | 9/9 | – |
| `rec.denied = false` | **8/9** | – |
| `rec.incomplete = false` | **8/9** | – |
| beide | **7/9** | **7/7** (Lücke bestätigt) |
| Basis `93bd99a` mit erweitertem Prüfer | 9/9 (Produktlogik schon korrekt) | – |

Entwicklerangaben exakt reproduziert; positive Neuversuche bleiben grün.

**Längenbudget (`hlsUrlOk`, `src/125:79–106`)** an den Produktfunktionen:
Master 4095/4096 → Datensatz, **4097 → keiner**; Kind über Pfad, Query, Fragment je 4095/4096 gespeichert, **4097 nicht gespeichert,
`incomplete`, keine Freigabe**; Zugangsdaten → `incomplete`; Duplikat 4096 → 1 Eintrag; normale Adressen → frei. Prüfung erfolgt vor
`keys.add`/`urls.push` (Code und Zähler). Repo-Prüfer 9/9 (Fix), 5/9 (Basis).
**Neuer Randbefund (P1-2, bestätigt):** In `src/040` wird die Länge **mit** Fragment gegen 4096 geprüft (`:362`, `:376`, `:394`),
die Zulassung (`admitMediaIdentity`) aber am Schlüssel **ohne** Fragment. Gemessen (L2): `.mp4`-Adresse 4066 Zeichen + 61-Zeichen-Fragment
(4127): HLS-Beleg verworfen, `mediaProbe` → `''` **ohne GET**, `mediaSourceAllowed` `true`, `hlsNativeStartAllowed` `true`.
Eine Seite kann so die Probe auch für eine CORS-lesbare Quelle umgehen (Realitätsnähe gering: > 4030 Zeichen Pfad nötig).

## 7. Rot/Grün, Mutation, positive Dekodierung

Kommando je Prüfer: `cd tests && KADRI_CHROMIUM=/opt/pw-browsers/chromium python3 -u <prüfer>.py` (Chrome for Testing 158.0.8127.36).

| Prüfer | Basis (Prüferdatei aus `a7ac09d`) | Fix `a7ac09d` |
|---|---:|---:|
| `test_p0a_source_type.py` | **9/26** | 26/26 |
| `test_p1_external_seek.py` | **3/7** | 7/7 |
| `test_p1_media_playlist.py` | **3/6** | 6/6 |
| `test_p2_hls_url_length.py` | **5/9** | 9/9 |
| `test_p1_hls_reparse.py` | 9/9 | 9/9 (mutationssensitiv, s. o.) |
| `test_p0a_player_classification.py` (angepasst) | 8/8 | 8/8 |

**Alle 23 Chromium-Komponentenprüfer am Fix: 511/511**, je Prüfer: dash_wrong_video 10, capture_fallback 14,
frame_share_lifecycle 20, hls_variant_guard 13, manifest_identity 13, native_hls_completeness 30, page_link_budget 12,
player_classification 8, redirect_provenance 20, source_type 26, external_seek 7, handback_seek 9, hls_reparse 9,
media_playlist 6, stall_watch 7, hls_url_length 9, dash_alt 12, dash_backfill 23, dash_fp 30, dash_gate 122, dash_mpd 61,
dash_start_unknown 18, dash_urlparam 32. Kein FAIL, alle Exitcodes 0.

**Node:** 26/26 `tests/*_check.js` mit Exitcode 0 (u. a. `guard_check.js chrome/background.js`, `ff_net_check.js firefox/background.js`,
`media_registry_check` 140 Prüfungen, `confidential_names_check` 1317 Dateien PASS). Kanal: `dash_unit_check` **104/104**,
`channel_unit_check` 45/45, `hls_unit_check` 97/97, `download_unit_check` 143/143, `download_regression_check` PASS,
`p4_identity_check` PASS (alle Exitcode 0, korrekt erfasst). Helper-abhängige Kanalprogramme siehe Abschnitt 8.
(Prüfstandshinweis: Ein erster eigener Node-Lauf hatte `$?` erst nach einer Befehlsersetzung ausgewertet; diese Zahlen habe ich
verworfen und alle Programme mit unmittelbar erfasstem Exitcode wiederholt.)

**Positive Dekodierung (eigene Messung):** echte MP4 `.mp4` ohne/mit CORS 640 px (A7, A9, E2E-4); erlaubter HLS-Master über hls.js
mit 320 px nach Entfernen der MPD-Variante (E2E-2). Redirect-Fixture des Repo-Prüfers: `/redir?to=/hls2/master.m3u8` läuft über
den echten Server-302 (`tests/common.py`, Route nicht gefälscht); meine Redirect-Fälle R1–R6 verwenden ausschließlich echte 302.

**Grenze der Testsuite:** Kein Repo-Prüfer enthält eine fremde Herkunft ohne CORS, eine Typcache-Verdrängung oder eine
Vorschau-Alternative mit HLS-Inhalt. `test_p0a_source_type.py` „irreführend .mp4“ ist gleichherkunftig (Probe immer lesbar).
511/511 sagt über P0-1 bis P0-3 daher nichts aus.

## 8. Erweiterungs-/Helper-Prüfstand und offene DASH-Prüfstandsbefunde

Ungepackte Testfassung `dist/test` aus `node tools/build.js --test` im Fix-Worktree (kein ZIP verwendet, nichts veröffentlicht).
Helper: eigener Klon bei `6e553fc`, unverändertes `tests/java/channel/build.sh` (Rust/cargo `--locked`, OpenJDK, Maven-Abhängigkeiten
mit festen SHA-256), Ausgabe nur lokal (`HELPER_HOST_DIR`). Chrome for Testing 158.0.8127.36 unter `xvfb-run`; Service-Worker
startete in allen Läufen. Kommando: `cd tests && KADRI_CHROMIUM=… HELPER_HOST_DIR=… xvfb-run -a python3 -u <prüfer>.py`.

| Prüfer (Fix-Build) | Ergebnis |
|---|---|
| `test_basic.py` | 7/7 |
| `test_mp4.py` | 143/143 |
| `test_hls.py` | 24/24 |
| `test_frame_ui.py` | 61/61 |
| `test_direct_dl.py` | 87/87 |
| `test_dash_bind.py` | 28/28 |
| `test_helper.py` | 18/18 |
| `test_dash_msg.py` | **20/23** – FAIL: „Diagnose (zeitnah): Eintrag dash:manifest mit Bindung ambiguous(start-timing)“, „… Manifest eingeordnet …“, „… Netzwerk: 1 gelesenes DASH-Manifest; Registry verweist auf die DASH-Ebenen …“ |
| `test_dash_dl.py` | **Abbruch vor fachlichen Assertions**: `Page.evaluate: SyntaxError: missing ) after argument list` in `player_menu` (`tests/test_dash_dl.py:159`, aufgerufen aus `:185`) |
| Kanal mit Helper: `channel_browser_check` / `channel_integration_check` / `channel_netguard_failure_check` / `hls_integration_check` / `download_integration_check` | 34/34 · 74/74 · 4/4 · 109/109 · 44/44 |
| `channel_mutation_check` | PASS, 53 Mutanten |
| `dash_integration_check` | 26/26 (mit Helper; ohne `HELPER_HOST_DIR` Absturz beim Helperstart, als Umgebungsfehler gewertet) |

Basis-Gegenlauf (Basis-Build `93bd99a`, gleicher Helper, gleicher Browser): `test_dash_msg.py` **20/23** mit denselben drei FAIL-Texten; `test_dash_dl.py` gleicher Abbruch (`SyntaxError`, `tests/test_dash_dl.py:159` aus `:185`). Beide Befunde sind also vom Fix unabhängig.

**Bewertung:** Beide DASH-Prüfstandsbefunde sind Prüfstandsschulden außerhalb dieses Fixes; es gibt **keinen DASH-E2E-PASS**. Ich habe
sie nicht repariert und keine DASH-Funktion freigeschaltet. Der Debian-Chromium-156-Service-Worker-Timeout wurde hier nicht geprüft
(kein Chromium 156 vorhanden) – **nicht prüfbar**. Android-/Samsung-/Vivaldi-Abnahme, echte fremdherkunftige/verschachtelte IPC,
System-Share/Clipboard, Downloadmanager und APK-Ausgabe: **BLOCKED** (kein Gerät, kein Android-Emulator in dieser Umgebung).

### Schutzgarantien (Auftrag Abschnitt 10)

| Garantie | Befund |
|---|---|
| A1 Dispatcher `dashplan`/`dashstart`, kein automatischer Neustart | `channel/` byte-identisch zur Basis; `dash_unit_check` 104/104 (u. a. „Route abgelehnt“ für ungültige Aufrufe, `dashstart` nicht idempotent) – unverändert, nicht neu bewertet |
| A2 Netz-/Segmentbeobachtung nur Diagnose | Diff in `src/040` fügt nur `noteMediaType`-Aufrufe hinzu; keine neue DASH-Aktion im Diff |
| B1–B4 falsche Videozuordnung | `test_dash_wrong_video.py` 10/10 |
| MPD-Identität überdauert Summary-Verdrängung | bestätigt (eigene Markierung je Fall, E4) |
| hls.js-Playlist-Guard inkl. Vorschau | `test_p0a_hls_variant_guard.py` 13/13; E2E-2 (MPD-Variante entfernt, 0 Requests) |
| Native Originalstart nur mit vollständiger Masterentscheidung | **gilt nur für als HLS erkannte Adressen**; für `claimed-file` verletzt (P0-1, P0-2) |
| iframe-Linkausgabe an Ursprungsdokument gebunden | `test_p0a_frame_share_lifecycle.py` 20/20 |
| Gültige MP4/HLS, Originalrückgabe, Capture, Linkausgabe | MP4/HLS positiv dekodiert; Funktionsverlust endungslos ohne CORS (P2-2) |
| Keine neuen Rechte, Pins, Helper-Änderungen | bestätigt (Diff leer für Manifest, `chrome/`, `firefox/`, `vendor/`, `tools/`, `.github/`; Helper unverändert) |

## 9. Befunde (priorisiert)

| ID | Schwere | Status | Stelle | Kurzbeschreibung | Messung |
|---|---|---|---|---|---|
| P0-1 | P0 | **bestätigt** | `src/040:379`, `src/170:137–143, 198–199, 275`, `src/125:161`, `src/260:99–100, 146` | `claimed-file` ohne lesbare Probe gibt eigene native Wiedergabe, Capture-`orig.play()` und `handBack` frei | A1, A6, R1, R5, R6 je 2; F2 1 nach Schließen; E2E-1 2 (Fix = Basis) |
| P0-2 | P0 | **bestätigt** | `src/040:368` (FIFO 1024), `:396` (Cache ohne Neubeleg), `:411` (Probe-`dash` ohne MPD-Identität) | Verlust restriktiver Belege führt zu Freigabe; Seitentext kann Belege verdrängen | E1 1023/1024, E1c, E3 2, E1b-E2E 1 |
| P0-3 | P0 | **bestätigt** | `src/230:43–46, 105` | Vorschau wählt `claimed-file`-Alternative ohne Probe, auch lesbar | V1 1, F3 1 |
| P1-1 | P1 | Mechanismus bestätigt, Variantenrequest nicht gemessen | `src/170:130, 137–143` | `loadTimer` läuft während der Probe; langsame Probe → nativer Start trotz CORS | G5, F1 |
| P1-2 | P1 | bestätigt (geringe Realitätsnähe) | `src/040:362, 376, 394` | Länge inkl. Fragment für Beleg/Probe, ohne Fragment für Zulassung | L2 |
| P2-1 | P2 | bestätigt | `src/040:400–416` | Probe: Einmal-URL verbraucht, volle Datei bei ignoriertem `Range`, kein Abbruch, `''` dauerhaft gecacht | F6, F7, F8, transient |
| P2-2 | P2 | bestätigt (Funktionsverlust) | `src/170:198`, `src/170:253` | endungslose Medien ohne CORS nicht abspielbar, Seitenvideo bleibt angehalten | A8, E2E-3 |
| H-1 | – | in Chromium 158 widerlegt, Android nicht prüfbar | `src/125:118, 123` | hybride Playlist: `STREAM-INF` im Medienplaylist-Modus nicht erfasst | F4 |
| H-2 | – | hypothetisch | `src/040:400` | LNA-Abfrage, wechselnde Serverantworten Probe ↔ nativ | – |
| W-1…W-6 | – | widerlegt | – | zusätzliche Credentials (F5), Preflight, falsche zweite externe Ausgabe (X1–X4), Längenbudget (L1), Reparse (Mutationen), Cross-Frame-Übertragung | s. o. |

## 10. Empfehlungen (klein) und Abnahmekriterien

1. **`claimed-file` gibt keine Kadri-veranlasste native Ladung mehr frei** (eigener Player, Capture-`orig.play()`, `handBack`/Seek,
   Stallwächter, Vorschau). Positive Direktwiedergabe nur mit eigenem lesbarem `file`-Beleg oder für das bereits *laufende*
   Original (passives Capture ohne Play/Seek). Wenn der Funktionsverlust für fremde MP4 ohne CORS nicht tragbar ist: Typprobe über die
   **bestehende** Host-Berechtigung im Hintergrund (`credentials: 'omit'`, `Range`, Redirects mit Zieladresse), unlesbar → fail-closed.
   Das berührt `chrome/background.js` und braucht einen eigenen Auftrag.
2. **Restriktive Belege dauerhaft:** HLS/DASH-Belege nicht im verdrängbaren FIFO allein halten (Sperrmenge mit Überlauf-Veto wie
   bei MPD-Identitäten); bei Überlauf `.mp4` als unbelegt behandeln. Probecache speichert den Typ und wendet ihn bei jedem Treffer erneut an.
3. Probe-`dash` als MPD-Identität registrieren (`rememberMpdIdentity`).
4. Vorschau nur für `file`-belegte Alternativen oder die aktuell geprüft laufende Quelle.
5. `loadTimer` während der Probe aussetzen; Probe-Timeout = unbekannt (fail-closed), `AbortController` bei Schließen/Quellwechsel.
6. Länge einheitlich am Schlüssel ohne Fragment prüfen (oder überlange Eingaben auch in der Zulassung ablehnen).
7. Fehlschläge der Probe nicht dauerhaft cachen (kurze Gültigkeit), Einmal-URL-Risiko dokumentieren.

**Abnahmekriterien (Erweiterung, echter Service-Worker, fremde Site ohne CORS, bekannte MPD-Variante, Zählung serverseitig):**
0 Variantenrequests nach Tipp, nach Schließen vor/nach Masterantwort, im Capture-Fallback, nach Wiederöffnen; dieselben Nullwerte nach
1024/1025 Typbelegen und nach 256/257 Proben (HLS **und** Probe-DASH); Vorschau-Alternative mit HLS-Inhalt 0; Probe > 9 s keine native
Ladung; Fragment-Überlänge keine Freigabe; Positivkontrollen echte MP4/HLS dekodieren (bzw. dokumentierter Funktionsverlust);
weiterhin 511/511 und die Extension-Suiten aus Abschnitt 8.

## 11. Freigabestufen

| Stufe | Urteil | Begründung |
|---|---|---|
| 1. Isolierte interne P0-B-Entwicklung | **Gesperrt** | P0-A-Schutz durch P0-1 bis P0-3 messbar umgehbar; Voraussetzung nicht erfüllt |
| 2. Vollständige Extension-/Helper-/DASH-E2E-Abnahme | **Nicht erreicht** | DASH-E2E ohne PASS (Abschnitt 8), P0-Befunde offen |
| 3. Automatische DASH-Downloads | **Gesperrt** | unverändert; keine Freigabe aus diesem Review |
| 4. Beta, Release, Samsung-/Vivaldi-Gerät | **Gesperrt** | nicht geprüft; native HLS-Parser auf Android nicht prüfbar; P0 offen |

**Gesamturteil: NO-GO.** Es wurden keine Produktänderungen, kein Merge, keine APK/ZIP-Auslieferung, keine Signierung und keine
Geräteinstallation vorgenommen; Rotproben und Mutationen liefen in getrennten, verworfenen Scratch-Worktrees.

## Anhang · Reproduktion

Eigene Prüfstände (nicht Teil des Commits, Beschreibung genügt zur Wiederholung):
- **Server:** zwei Python-`ThreadingHTTPServer` (HTTP/1.1) auf `127.0.0.1:P` und `127.0.0.1:P+1`, Medien über `localhost:P+1`;
  Routen je Pfad samt Query: `master` (zwei absolute `STREAM-INF`-Kinder), `mpd` (`tests/web/dash/gate/g02-number-duration.mpd`),
  `mp4` (`tests/web/clip.mp4`, Range 206), `redir` (302), Optionen `cors`, `range = normal|ignore|weird|short`, `status`, `delay`,
  `delay_once`, `trickle`, `once`. Protokoll je Request (Methode, Pfad, `Range`, `Sec-Fetch-Dest/Mode`, `Origin`, `Cookie`, `Referer`, Bytes).
- **Komponente:** wie `tests/test_p0a_source_type.py` (`src/[0-9]*.js` zusammengesetzt, Export über `window.k`), Klassifikation per
  `k.notePlaylist(u, u, MPD)` + 44 Füllanalysen; Zähler über delegierende `play`/`src`/`currentTime`-Wrapper.
- **Erweiterung:** `node tools/build.js --test`, `launch_persistent_context` mit `--load-extension=dist/test`, Seite mit
  `<video autoplay src=…>`, Stummschaltung aufgehoben, Tipp auf „Im Videoplayer öffnen“, Zählung ab Tipp; für die MPD-Variante liefert der
  Server je `Sec-Fetch-Mode` (`cors` → MPD-Text, sonst echte Playlist `hls2/a`).
- **Eviction:** `k.noteMediaType(U,'hls')` bzw. ein gelesener Master mit 1100 `STREAM-INF`-Zeilen; Probecache über `k.mediaProbe`
  auf 254–257 weitere Adressen `…/p/x.mp4?i=n`.
