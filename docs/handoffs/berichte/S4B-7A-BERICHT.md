# S4b-7a – Machbarkeitsstudie: DASH außerhalb des Hauptthreads erkennen und sicher einem Video zuordnen

Stand 24.11.2026. Nur Studie: keine Produktintegration, keine neue Berechtigung in der normalen Erweiterung, kein APK/ZIP, kein Merge.

**Ausgangsstand:**
- Kadri `5dd720a` (`test/s4b-dash`).
- Helfer `6e553fc` (`test/s4b5-dash`); am Helfer wurde nichts geändert.
- `main`, P4-Lieferpins und veröffentlichte Versionen bleiben unverändert.

## 0. Kurzfassung

1. **Sichtbarkeit.** Passive Beobachtung mit `webRequest` (nur lesend) sieht in Desktop-Chromium MPD und alle Stücke in allen untersuchten Architekturen:
   - Worker-`fetch` mit MSE im Hauptthread (b1);
   - MediaSource im Worker (b2, MediaSourceHandle);
   - srcdoc-Rahmen (c2, c2w);
   - verschachtelt: Seite → fremder Rahmen → srcdoc → Worker.

   Jede Anfrage trägt `tabId`, `frameId` und `documentId` **des Dokuments, das den Worker erzeugt hat**.
2. **Netzadresse und Dokument reichen nicht für eine sichere Bindung.** Regel R1 (Dokument + Medien-Epoche + strenge Stückfolge) bindet nur, wenn im Dokument genau ein Video und genau ein MPD mit passender Folge existiert. Sonst bindet R1 nicht. Das ist sicher, deckt aber zwei Videos, Vorladen und Werbung + zweites Video nicht ab.
3. **Der eigentliche Bindungsbeweis ist der Inhalt.** Regel R2 hasht die tatsächlich an *dieses* Videoelement angehängten Bytes (`SourceBuffer.appendBuffer`, SHA-256-Präfix) und vergleicht sie mit den beobachteten Stücken:
   - Sie trennt zwei Videos, Vorladen, verstecktes Zweitvideo und Werbung → Hauptfilm.
   - Bei byte-gleichen Stücken aus zwei MPDs verweigert sie die Bindung.
   - **Grenze:** MediaSource im Worker (b2) ist im Hauptthread unsichtbar. Dort bleibt nur R1.
4. **In 84 von 84 Prüfungen hat keine Regel je falsch gebunden.** Es gab nur „richtig“ oder „keine Bindung“.
5. **Neue Befunde:**
   - **about:blank-Rahmen:** Alle Abrufe (fetch, XHR, auch aus dem eigenen Skript des Rahmens) laufen unter der `documentId` der **Eltern-Seite**, nicht des Rahmens. srcdoc-Rahmen haben dagegen eine eigene.
   - **document.open/write in about:blank:** Danach sieht die Sonde im Rahmen kein Medienereignis mehr.
   - **Unsichere Kontexte (http-Rahmen):** Dort gibt es kein `crypto.subtle`.
6. **Manifest-Inhalt.** `webRequest` liefert keinen MPD-Text. Ein flüchtiges Neulesen ohne Cookies (`credentials: 'omit'`) aus genau dem zugeordneten Dokument ergab in allen Szenarien byte-gleiche MPDs, auch über den fremden Host (CORS) und nach Weiterleitung (endgültige Adresse mit Query). Ein Cookie-pflichtiges MPD wird mit 403 abgewiesen. Das ist sicher: kein Abdruck, kein Angebot. Der Helfer liest unverändert ebenfalls ohne Cookies.
7. **EssentialProperty-Audit.** Kadri und der Helfer übergehen ein **unbekanntes EssentialProperty auf MPD- oder Period-Ebene** und an schemafremden Stellen. Beide entscheiden identisch (22/22) und bieten das MPD an. Ich schlage eine kontrollierte Ablehnung `mpd-essential` vor und habe gemeinsame Regressionen e01–e11 angelegt. Gegenprobe: keine der 278 vorhandenen MPD-Fixtures wäre betroffen. Verhalten unverändert.
8. **Vivaldi Android.** Laut Chromium-Feature-Dateien gibt es `webRequest` ohne Plattformbeschränkung, also auch auf `desktop_android`. Am Gerät ist das **nicht geprüft**: Dafür müsste die Messsonde installiert werden → **STOP, gesonderte Freigabe nötig** (Testplan in Abschnitt 9).
9. **Empfehlung S4b-7b.** Kombination „webRequest-Beobachtung + MSE-Inhaltsbeweis (R2) + Neulesen ohne Cookies“, mit R1 nur als eng begrenzter Rückfall (Abschnitt 13).

## 1. Prüfstand

| Teil | Datei (Kadri `test/s4b-dash`) | Zweck |
|---|---|---|
| Messsonde (eigene Test-Erweiterung, **nicht Kadri**) | `tests/s4b7/probe/` (`manifest.json`, `sw.js`, `cs.js`, `main.js`) | `webRequest` nur beobachtend; zwei Testhosts; kein Blocking, keine Header (`extraInfoSpec` leer), keine Bodies, keine Änderung an Anfragen |
| Studie | `tests/s4b7_webrequest_study.py` | Testserver, 27 Szenarien, Auswertung, harte Prüfungen |
| Testplayer | `tests/web/s4a/own.js` | neue Option `restartAt` (Worker-Neustart); bestehende Modi unverändert |
| EssentialProperty-Audit | `tests/s4b7_essential_audit.py`, `tests/s4b7/essential/` | Fixtures e01–e11, Vorschlagstabelle, Helfer-Läufer (nur lesend) |

**Berechtigungen der Sonde:**
- `"permissions": ["webRequest"]`;
- `host_permissions` nur `http://127.0.0.1/*` und `http://cdn.example.org/*`;
- Inhaltsskripte nur auf diesen Hosts, mit `match_about_blank` und `match_origin_as_fallback`.

Die reguläre Kadri-Erweiterung (`chrome/manifest.json`) ist **unverändert**: `storage`, `declarativeNetRequestWithHostAccess`, `scripting`.

**Datenschutz der Sonde:**
- Die Sonde speichert nie eine Adresse oder einen Query-Wert, nur Klassen: Host-Klasse, Szenario, Dateiart, Darstellung/Nummer und „hat Query“.
- Der Ringpuffer liegt im Speicher (höchstens 6000 Einträge), kein `storage`.
- Für das Neulesen geht die Adresse nur als flüchtige Nachricht an das zugeordnete Dokument, nie in den Puffer.
- Harte Prüfung „Sonde speichert keine Adresse/keinen Query-Wert“: bestanden. Kein `://`, `tok=` oder `sig=` in den Rohdaten.

## 2. Sichtbarkeit (Desktop-Chromium, Lauf 4)

| Szenario | Architektur | MPD / Stücke sichtbar | Typ | Zuordnung (`documentId`) |
|---|---|---|---|---|
| m1 | MSE im Hauptthread (Referenz) | ja / 12 | xmlhttprequest | Seite |
| **b1** | Worker-fetch, MSE im Hauptthread | **ja / 12** | xmlhttprequest | **Seite (erzeugendes Dokument)**, 12/12 |
| **b2** | MediaSource im Worker (MediaSourceHandle) | **ja / 12** | xmlhttprequest | **Seite**, 12/12 |
| c2 / c2w | Player im srcdoc-Rahmen (Hauptthread / Worker) | ja / 12 | xmlhttprequest | **srcdoc-Dokument** (`sub_frame`), 12/12 |
| **c2b** | Player im about:blank-Rahmen (per DOM befüllt) | ja / 12 | xmlhttprequest | **Eltern-Seite** (`outermost_frame`) – Befund |
| c2bw | about:blank mit `document.open/write` | ja / 12 | xmlhttprequest | Eltern-Seite |
| nest | Seite → fremder Rahmen (cdn) → srcdoc → Worker | ja / 12 | xmlhttprequest | srcdoc-Dokument; initiator `cdn` |
| xo | MPD und Stücke auf fremdem Host (CORS) | ja / 12 | xmlhttprequest | Seite |
| redir | MPD 302 → Adresse mit Query; Stücke 302 → anderer Host | ja / 12 (+12 Weiterleitungen) | xmlhttprequest | Seite; `onBeforeRedirect` mit Ziel-Host-Klasse |
| sw | Seiten-Service-Worker holt die Stücke | ja / 3 | xmlhttprequest | **tabId −1, keine documentId**; die Seitenanfrage selbst erscheint nicht |
| cache | Wiederholung aus dem HTTP-Cache | ja / 12 | xmlhttprequest | Seite; `fromCache` = true bei 6 |
| rep | dasselbe Stück dreimal geladen | ja / 3 | xmlhttprequest | je Abruf eigene `requestId` |

**Was bei Worker-Anfragen fehlt oder mehrdeutig ist:**
- **Kein Bezug zum Worker selbst und keiner zum Videoelement.** `documentId` ist die des erzeugenden Dokuments. Mehrere Worker oder Player eines Dokuments sind nicht unterscheidbar.
- **`type` ist immer `xmlhttprequest`.** Für fetch und XHR aus Worker und Seite gibt es kein „worker“-Merkmal.
- **`initiator`** ist der Ursprung des Dokuments (bzw. des Rahmens in nest), nicht der Worker.
- **Service-Worker-Abrufe** haben `tabId −1` und keine `documentId`. Sie sind keinem Dokument zuzuordnen, also keine Bindung.
- **about:blank-Rahmen** teilen die `documentId` der Eltern-Seite (Abschnitt 7).

**Gezielte Messung `blankf`** (ein Abruf je Weg):

| Abrufweg | `frameId` | Dokument |
|---|---|---|
| Seite `fetch` | 0 | Seite |
| `rahmen.contentWindow.fetch` | 0 | **Seite** |
| `fetch` aus Skript im about:blank-Rahmen | 0 | **Seite** |
| XHR aus Skript im about:blank-Rahmen | 0 | **Seite** |
| `fetch` aus Skript im srcdoc-Rahmen | 7 | srcdoc (`sub_frame`) |

## 3. Herkunftsangaben und Uhrbasis

Gemessen wurde nicht durch blinden Vergleich verschiedener Zeitquellen, sondern über eigene Marker-Abrufe (`/clock?i=…`). Unmittelbar vor dem Absenden wurden `Date.now()` und `performance.timeOrigin + performance.now()` aufgezeichnet, im Hauptthread und im Worker. Gemessen ist jeweils `webRequest.timeStamp − Absendezeit` in ms:

| Thread | n | Median zu `Date.now()` | Min | Max | Median zu `timeOrigin+now` |
|---|---|---|---|---|---|
| Hauptthread | 12 | 2,31 | 1,32 | 3,12 | 1,44 |
| Worker | 12 | 1,86 | 0,84 | 2,93 | 1,26 |

Lauf 3 ergab ähnliche Werte; ein Ausreißer lag im Hauptthread bei 11,5 ms.

**Folgerung:**
- `webRequest.timeStamp` liegt auf der Epochenachse von `Date.now()`, wenige Millisekunden **nach** dem Absenden.
- Die Medien-Epoche (loadstart, `Date.now()` im Dokument) ist damit vergleichbar.
- Als Regel genügt „Stück-Anfrage **nach** loadstart“. Eine Toleranz von ±50 ms deckt die Messung reichlich ab.
- Auf Android ist die Uhr **nicht gemessen**: Die Uhrprüfung gehört in den Gerätetest.

## 4. Bindungsregeln und Ergebnis

- **R1 – Netz + Dokument + Epoche.**
  - Stück-Anfragen unter der `documentId` des Videos, nach dessen letztem loadstart.
  - Je MPD mindestens 3 zusammenhängende Stücke einer Darstellung.
  - Genau ein Video im Dokument und genau ein MPD → Bindung, sonst keine.
- **R2 – MSE-Inhaltsbeweis.**
  - Die an die MediaSource **dieses** Videos angehängten Bytes (SHA-256-Präfix, 12 Byte) werden Stücken (Darstellung, Nummer) zugeordnet.
  - Mindestens 3 zusammenhängende Stücke nach loadstart.
  - Unter den Netzabrufen desselben Dokuments muss **genau ein** MPD genau diese Stücke geliefert haben. Sonst keine Bindung.

| Szenario | Video | Wahr | R1 | R2 |
|---|---|---|---|---|
| m1, b1, c2, c2w, nest, xo, ck, redir | v0 | jeweils eigenes MPD | richtig | richtig |
| b2 (MediaSource im Worker) | v0 | b2 | richtig | keine (nicht sichtbar) |
| c2b (about:blank) | Rahmen/v0 | c2b | keine (Dokumente verschieden) | keine |
| c2bw (document.open) | Rahmen/v0 | c2bw | keine (kein Video gesehen) | keine |
| twom (zwei Videos, Hauptthread) | v0 / v1 | twoma / twomb | keine (mehrdeutig) | **richtig / richtig** |
| two1 (zwei Videos, Worker-fetch) | v0 / v1 | two1a / two1b | keine | **richtig / richtig** |
| two2 (zwei Videos, MSE im Worker) | v0 / v1 | two2a / two2b | keine | keine (nicht sichtbar) |
| **twosame** (zwei MPDs, byte-gleiche Stücke) | v0 / v1 | tsa / tsb | keine | **keine (2 MPDs mit denselben Stücken)** |
| **twoad** (v0: Werbung → Hauptfilm; v1 zugleich, Bytes wie Werbung) | v0 / v1 | ad2m / ad2o | keine | **richtig** / keine (mehrdeutig) |
| ad1 (Werbung → Hauptfilm) | v0 | ad1m | richtig | richtig |
| pre1 (Worker lädt zweites MPD im Hintergrund vor, ohne MSE) | v0 | pre1a | keine (2 MPDs) | **richtig** |
| pre2 (verstecktes zweites Video spielt wirklich) | v0 / v1 | pre2a / pre2b | keine | **richtig / richtig** |
| nav (Navigation nach 7 s) | nav2/v0 | navb | richtig | richtig |
| wrst (Worker-Neustart mitten im Strom) | v0 | wrst | richtig | richtig |
| swch (Quellenwechsel) | v0 | swchb | richtig | richtig |

**Harte Prüfung „bindet nie falsch“:** 56/56 bestanden (28 Videos × 2 Regeln).

**Beobachtungen:**
- Vorgeladene Ströme (pre1) werden durch R2 nie als spielend gewertet: Ihre Bytes werden nie angehängt.
- Das versteckte, aber wirklich spielende Zweitvideo (pre2) wird korrekt **seinem** Element zugeordnet.
- Ob ein verstecktes Video angeboten werden soll, ist eine Oberflächenfrage, keine Bindungsfrage.

**Kosten von R2 (Desktop):**
- 327 Anhänge gehasht;
- Median 0,20 ms, Maximum 2,6 ms;
- größter Anhang 169 884 Byte.

Die Sonde kopiert jeden Anhang (`slice`), das verdoppelt kurzzeitig den Speicher. Im Produkt reicht Hashen bis zum Bindungsbeweis: die ersten 3–5 Stücke nach loadstart, danach aus.

**Grenzen von R2:**
- **MediaSourceHandle (b2, two2):** Im Hauptthread gibt es keine `SourceBuffer`. Dedizierte Worker (auch Blob-Worker) bekommen keine Inhaltsskripte. Ohne Eingriff in fremden Worker-Code ist das nicht beobachtbar.
- **Byte-gleiche Inhalte (twosame, twoad/v1):** R2 bindet nicht. Das ist sicher, deckt aber dieselbe Werbung in zwei Playern nicht ab.
- **Unsichere Kontexte:** `crypto.subtle` fehlt, z. B. im http-Rahmen von nest. Die Sonde fällt dort auf FNV-1a (32 Bit) + Länge zurück. Für das Produkt ist das **kein** Bindungsbeweis (zu schwach); nur `crypto.subtle` (HTTPS) zählt.
- **Verschlüsselte Stücke (CENC):** Der Hash belegt die Zuordnung, ändert aber nichts an der DRM-Ablehnung (dash-protected bleibt).

## 5. Manifest-Inhalt (webRequest liefert keinen Text)

**Messung:** Die Sonde lässt das beobachtete MPD **einmal** neu lesen, und zwar vom Inhaltsskript genau des Dokuments, dem `webRequest` den Abruf zuordnet (`tabs.sendMessage` mit `documentId`):
- mit `fetch(url, { credentials: 'omit', cache: 'no-store' })`;
- ohne Cookies, ohne Authorization, ohne Request-Body.

| Szenario | Ergebnis |
|---|---|
| m1, b1, b2, c2, c2w, c2b, c2bw, nest, xo, twom, two1, two2, … | 200, **byte-gleich** (SHA-256) |
| xo (MPD auf fremdem Host) | 200, byte-gleich: gleiche CORS-Lage wie der Worker, der vom selben Ursprung abruft |
| redir | gelesen wird die **endgültige** Adresse aus `onCompleted` (mit Query, keine erneute Weiterleitung), byte-gleich |
| **ck** (MPD nur mit Sitzungs-Cookie; der Worker sendet es) | Worker 200 · Neulesen ohne Cookies **403** → kein Text, kein Abdruck, kein Angebot (fail closed) |

**Sicherer Pfad für S4b-7b:**
- Kadri liest das MPD so einmal neu und berechnet daraus wie bisher Fingerabdruck, Vorprüfung, Index und `urlq`, gegen die **endgültige** Adresse (`webRequest` `onCompleted.url` bzw. `response.url`).
- Der Helfer liest es unverändert über `dashplan` selbst, ohne Cookies, mit Host-Prüfung, BaseSelection und Annex-I-Query.
- Liefert der Server beiden nicht dasselbe, z. B. bei rotierenden Tokens: `manifest_mismatch`/`plan_changed`, sicher.

**Kosten und Bedingungen:**
- Ein zusätzlicher MPD-Abruf je beobachtetem MPD und Dokument. Für den Server sichtbar und als zweiter MPD-Abruf auch in `webRequest`; der Prüfstand zählt deshalb MPD = 2.
- **Verworfen:** Kadri lässt das MPD vom Helfer lesen und übernimmt dessen Abdruck. Dann gäbe es keine unabhängige Kopie mehr, und die Gegenprüfung des Fingerabdrucks entfiele.
- **Verworfen:** Neulesen im Hintergrund-Service-Worker. Andere Herkunft (Erweiterungs-Ursprung, `<all_urls>` hebelt CORS aus) ist kein Abbild dessen, was die Seite darf.

## 6. srcdoc / about:blank / Rahmen-Injektion

- **srcdoc** (c2, c2w, nest):
  - Inhaltsskripte laufen mit `match_about_blank` und `match_origin_as_fallback` im Rahmen.
  - Der Rahmen hat eine eigene `documentId`, und Medienereignisse sowie Abrufe gehören zu ihr.
  - Für R1/R2 reicht der eigene Rahmen. **Der Elternrahmen muss nicht vertraut werden.**
- **about:blank** (c2b):
  - Die Inhaltsskripte laufen im Rahmen; Medienereignisse und Anhänge kommen von der `documentId` des Rahmens.
  - **Die Abrufe stehen aber unter der Eltern-`documentId`.**
  - R1 und R2 binden deshalb nicht. Das ist sicher, aber eine Lücke.
  - Eine Erweiterung „about:blank-Kind erbt die Abrufe des Elterndokuments“ ginge nur mit R2 (Inhaltsbeweis) und nur bei gleicher Herkunft. Dann konkurrieren die Videos des Elterndokuments mit, und die Eindeutigkeitsprüfung bleibt Pflicht.
- **about:blank mit `document.open/write`** (c2bw):
  - Danach sieht die Sonde **kein** Medienereignis mehr. `document.open` entfernt die Listener am Dokument, auch die Brücke Seitenwelt → Inhaltsskript.
  - Ein Produkt müsste nach `document.open` neu anhängen, z. B. über Listener am `window` statt am `document`. In S4b-7b gesondert prüfen.
- **Kadri heute:**
  - `page.js` (MAIN, `all_frames`) und `sub.js` haben **kein** `match_about_blank` und kein `match_origin_as_fallback`, laufen in srcdoc/about:blank also nicht. Das ist die Ursache der bekannten c2-Lücke der Player-Matrix.
  - Die Änderung braucht **keine neue Berechtigung**, ist aber eine Produktänderung (S4b-7b).
  - Die Relay-Identitätsprüfungen (`sender.frameId`/`documentId` aus Chromium, nie aus der Nachricht) bleiben unverändert. Die Sonde nutzt dasselbe Muster.

## 7. Vergleich der Wege

| Weg | erfasste Architektur | sichere Bindbarkeit | Android | Leistung | Datenschutz | Berechtigungen | Grenzen |
|---|---|---|---|---|---|---|---|
| **A: passives webRequest** (R1) | b1, b2, c2, nest, Weiterleitungen, Cache; **nicht** SW (tabId −1); about:blank nur unter Eltern-Dokument | nur 1 Video + 1 MPD je Dokument; sonst keine Bindung | laut Feature-Datei verfügbar, Gerät **ungeprüft** | jedes passende Ereignis weckt den MV3-Service-Worker; Filter eng halten | sieht Adressen aller Abrufe des Tabs (nur flüchtig, nie gespeichert) | **neu: `webRequest`** (Hosts: vorhandenes `<all_urls>`) | zwei Videos, Vorladen, Werbung + Zweitvideo; kein MPD-Text |
| **B: MSE-Anhänge hashen** (R2) | Hauptthread-MSE inkl. Worker-fetch (b1) und srcdoc; **nicht** MediaSourceHandle (b2) | **stark**: Inhalt des konkreten Elements; trennt zwei Videos, Vorladen, verstecktes Zweitvideo, Werbung | wie MAIN-Welt heute (Kadri läuft dort); `crypto.subtle` nur sicherer Kontext | ≈0,2 ms je Anhang (Desktop); nur bis zum Beweis | nur Hash-Präfixe, flüchtig | **keine neue** (`page.js` MAIN existiert) | b2; byte-gleiche Inhalte; braucht Netzseite für MPD-Kandidaten |
| **C: erweiterte Rahmen-Injektion** (`match_about_blank`, `match_origin_as_fallback`) | srcdoc, about:blank, data:/blob:-Rahmen | Voraussetzung für A/B im Rahmen; allein kein Beweis | MV3-Felder, Gerät ungeprüft | gering | unverändert | **keine neue** | `document.open` entfernt Listener; about:blank-Abrufe unter Eltern-Dokument |
| **A+B+C** (empfohlen) | alles außer MediaSourceHandle mit mehreren Videos und Service-Worker-Abrufen | R2 als Beweis, R1 nur Rückfall bei 1 Video/1 MPD | Gerätetest nötig | wie A + B | wie A + B | neu: `webRequest` | b2 mit 2 Videos; SW-Player; dieselbe Werbung in zwei Playern |
| A+C ohne B | wie A | wie A | – | – | – | – | trennt keine konkurrierenden Videos |

## 8. Sicherheits-Audit EssentialProperty (nur Befund und Vorschlag)

**Befund** (gleiches Ergebnis in Kadri `src/039` und Helfer `DashManifest`/`DashProfile`/`DashPlan`, 22/22 Prüfungen):
- Ausgewertet wird EssentialProperty **nur** an AdaptationSet (`set-essential`) und Representation (`rep-essential`).
- Ein unbekanntes EssentialProperty
  - an **MPD** (e01, e05, e06, e07),
  - an **Period** (e03, im Schema 5th Ed. nicht vorgesehen) oder
  - an einer **schemafremden Stelle** (e10, unter SegmentTemplate)

  wird übergangen. Das MPD wird **angeboten**.
- **Referenz:** dash.js 5.2.1 (`CapabilitiesFilter._filterUnsupportedEssentialProperties`) filtert ebenfalls nur AdaptationSet, Representation und Preselection, also nicht MPD und Period.

**Bewertung:**
- Ein MPD-weites Essential-Merkmal, das weder Kadri noch der Helfer versteht, kann die Bedeutung des ganzen MPD verändern, z. B. ein Schema, das Stückadressen oder Entschlüsselung betrifft.
- Es zu übergehen widerspricht dem Grundsatz „nicht verstanden → nicht deuten“, den S4b-8 für Annex I umgesetzt hat.
- Der Normtext liegt nicht vor (kostenpflichtig). Die Einstufung stützt sich auf Schema und Name („essential“). Daher nur Vorschlag.

**Vorschlag** (gemeinsam für beide Seiten, `tests/s4b7/essential/vorschlag.tsv`):

| Fixture | heute | Vorschlag |
|---|---|---|
| e01 MPD-Essential unbekannt | ok | **`mpd_essential`** |
| e02 MPD-Supplemental unbekannt | ok | ok |
| e03 Period-Essential unbekannt | ok | **`mpd_essential`** |
| e04 Period-Supplemental unbekannt | ok | ok |
| e05 Annex-I-Descriptor + unbekanntes Essential | ok | **`mpd_essential`** |
| e06 Essential ohne `schemeIdUri` | ok | **`mpd_essential`** |
| e07 MPD-Essential cicp TransferCharacteristics | ok | **`mpd_essential`** (kein Freibrief nach Namen) |
| e08 Set-Essential unbekannt (Kontrolle) | dash_unsupported | unverändert |
| e09 Rep-Essential an einer von zwei Darstellungen (Kontrolle) | ok | unverändert |
| e10 Essential an schemafremder Stelle | ok | **`mpd_essential`** (wie ContentProtection überall zählen) |
| e11 Ton-Set-Essential unbekannt (Kontrolle) | dash_unsupported | unverändert |

Neuer fataler Grund `mpd-essential`, Anzeige `dash-unsupported`. Der unterstützte Annex-I-Descriptor (`urn:mpeg:dash:urlparam:2014`) bleibt ausgenommen; u01–u38 bleiben unverändert.

**Gegenprobe:** Alle 289 MPD-Dateien in Kadri- und Helfer-Tests sowie die Vorschlags-Fixtures wurden durchsucht. Betroffen wären **nur** die 6 neuen Fixtures. Keine der 94 dash-gate/1-Fixtures, keine Matrix- oder Fingerabdruck-Fixture ist betroffen.

**Umsetzung erst nach Freigabe.** Dann als dash-gate/1-Erweiterung mit Golden-Vektoren in beiden Repositories.

## 9. Vivaldi Android – technische Prüfung

**Chromium-Feature-Dateien** (Zweig `main`, abgerufen am 24.11.2026 über den GitHub-Spiegel, Kopien in `s4b7-ref/`):
- `extensions/common/api/_permission_features.json`:
  - `"webRequest"`: `channel: stable`, `extension_types: ["extension", …]`, **ohne `platforms`**. Damit gilt es auf allen Plattformen mit Erweiterungen, auch `desktop_android`.
  - `"webRequestBlocking"` gilt nur für MV2 bzw. per Richtlinie. Das ist für uns gleichgültig: nur beobachtend.
- `_api_features.json`: `"webRequest"` mit `contexts: ["privileged_extension"]`, ohne Plattformsperre.
- Zum Vergleich: APIs, die auf Android fehlen, tragen dort ausdrücklich `// "desktop_android" is not supported.`. Bei webRequest, declarativeNetRequest, scripting, tabs und webNavigation fehlt diese Sperre.

**Kadri heute:**
- C3-Gerätetests liefen auf Vivaldi 8.2.4147.201 (Samsung) mit entpackten Testerweiterungen.
- `declarativeNetRequestWithHostAccess` und `scripting` laufen dort bereits.

**Nicht belegt** (nur am Gerät feststellbar):
- ob Vivaldi `webRequest`-Ereignisse samt `documentId`, `frameType` und `documentLifecycle` tatsächlich liefert (Vivaldi kann vom Chromium-Stand abweichen);
- Uhrbasis von `timeStamp` auf Android;
- Weckverhalten und Laufzeit des MV3-Service-Workers unter Android-Energiesparregeln;
- Kosten von SHA-256 je Anhang auf einem Mittelklasse-Telefon;
- ob die Inhaltsskripte mit `match_origin_as_fallback` in srcdoc/about:blank laufen.

**STOP vor dem Gerätetest:** Dafür muss die **Messsonde** (eine geänderte, eigene Test-Erweiterung) in Vivaldi installiert werden. Das tue ich nicht ohne gesonderte Freigabe.

**Geräte-Testplan (vorbereitet, nicht ausgeführt):**
1. Die Sonde (`tests/s4b7/probe`) bekommt als Hostberechtigung nur den Testhost. Das wäre ein HTTPS-Testhost wie die S3f-Seite, damit `crypto.subtle` verfügbar ist. Sie wird separat entpackt in Vivaldi geladen, neben Kadri, ohne Kadri zu ändern.
2. Szenarien m1, b1, b2, c2, c2b, two1, twom, pre1, ad1, redir, ck, clock auf dem Testhost.
3. Rohdaten (nur Klassen) über eine noch zu ergänzende Exportseite der Sonde (lokale Datei). Kein Adressinhalt, kein Upload.
4. Erwartungen wie Desktop. Abweichungen werden je Feld protokolliert: `documentId` vorhanden, Uhr-Median, Hash-Dauer, Service-Worker-Neustarts.
5. Danach die Sonde entfernen. Kein Einfluss auf Kadri oder den Helfer.

## 10. Regressionen

Siehe `regress/status.txt`:
- Build;
- Vertraulichkeitsprüfung;
- `test_dash_gate`, `test_dash_urlparam`;
- EssentialProperty-Audit;
- **volle Player-Matrix**.

Die einzige Änderung an bestehendem Testcode ist die Option `restartAt` in `own.js` (wirkt nur, wenn gesetzt). Die Ergebnisse stehen in Abschnitt 14.

## 11. Fehler im Prüfstand (behoben, keine Befunde)

1. **Lauf 1, c2b/c2bw:** Die Seite schrieb den Rahmeninhalt als JSON-Zeichenkette in ein `<script>`. Ein darin enthaltenes `</script>` beendete das Skript, und der Player startete nie. Lösung: `</` wird maskiert (`js()`).
2. **Lauf 1, Worker-Uhr:** Der Blob-Worker löste `/clock` relativ zur `blob:`-Adresse auf. Lösung: absolute Adresse.
3. **Lauf 1, pre1:** Meine „Wahrheit“ war falsch, denn das versteckte Video spielte tatsächlich. Lösung: pre1 als echtes Nur-Vorladen (Worker ohne MSE) und pre2 als verstecktes spielendes Zweitvideo, jeweils mit eigener Wahrheit.
4. **Lauf 1/2, nest R2 „zu wenige Anhänge“:** Im http-Rahmen auf dem fremden Host gibt es kein `crypto.subtle`, das Hashen schlug still fehl. Lösung: Rückfall-Hash der Sonde. Das ist zugleich Befund 5 für das Produkt.
5. **Lauf 3, blankf:** Der Weg über `eval` im Rahmen erzeugte keinen Abruf. Ich habe ihn entfernt; die übrigen drei Wege aus dem Rahmen sind gemessen.

Keine Prüfung wurde durch Wiederholung als bestanden gezählt. Jeder Lauf ist mit Protokoll abgelegt (`lauf1.log` … `lauf4.log`).

## 12. Offene Risiken

- **MediaSourceHandle mit mehreren Videos (two2):** nur R1, das hier nicht bindet. Ein Inhaltsbeweis wäre nur durch Eingriff in fremde Worker möglich, und den schließe ich aus.
- **Service-Worker-Player:** tabId −1, keine Zuordnung, keine Bindung.
- **Dieselbe Werbung in zwei Playern:** R2 verweigert die Bindung, R1 auch.
- **about:blank:** Abrufe stehen unter dem Eltern-Dokument; nach `document.open` sind die Listener weg.
- **Android:** alles in Abschnitt 9 Genannte ist ungeprüft.
- **Neulesen:** Bei Cookie- oder Token-Pflicht kein Angebot. Das ist gewollt, begrenzt aber die Abdeckung. Rotierende MPD-Antworten führen zu `manifest_mismatch`.
- **Neue Berechtigung `webRequest`:** Laut Chromium-Stand gibt es dafür keine eigene Installationswarnung über `<all_urls>` hinaus. Ob ein Update die Erweiterung bis zur Zustimmung deaktiviert, muss vor der Veröffentlichung im Chrome Web Store bzw. in Vivaldi geprüft werden.
- **EssentialProperty:** Bis zur Freigabe werden MPDs mit unbekanntem MPD- oder Period-Essential weiter angeboten.

## 13. Empfehlung für S4b-7b

1. **Rahmenabdeckung ohne neue Berechtigung zuerst (C).**
   - `match_about_blank` und `match_origin_as_fallback` für `page.js` und `sub.js`.
   - Brücke Seitenwelt ↔ Inhaltsskript robust gegen `document.open`, z. B. mit Listenern am `window`.
   - Relay-Identität unverändert.
2. **Inhaltsbeweis R2 im Produkt (B).**
   - SHA-256 der ersten 3–5 Anhänge je MediaSource nach loadstart, nur in sicheren Kontexten; danach aus.
   - Die Zuordnung Videoelement → MediaSource → Anhänge kommt aus der bestehenden MSE-Beobachtung.
3. **`webRequest` nur beobachtend (A), als gesonderter, freigabepflichtiger Schritt.**
   - Filter: `types: ['xmlhttprequest', 'other']`, kein `extraInfoSpec`.
   - Nur die Klassen MPD/Stück, flüchtig, je Dokument begrenzt.
   - Liefert die Netzseite für Worker (b1/b2) und Kandidaten-MPDs für R2.
4. **Bindung.**
   - R2 ist der Beweis: genau ein MPD im Dokument, dessen Stücke byte-gleich mit den Anhängen *dieses* Elements sind, plus Medien-Epoche und strenge Stückfolge wie bisher.
   - R1 nur als Rückfall, wenn kein MSE sichtbar ist (MediaSourceHandle): genau ein Video und genau ein MPD im Dokument.
   - Sonst keine Bindung.
5. **Manifest.**
   - Einmaliges flüchtiges Neulesen ohne Cookies vom zugeordneten Dokument (`credentials: 'omit'`), gegen die endgültige Adresse.
   - Fingerabdruck, Vorprüfung, BaseSelection und `urlq` wie bisher; der Helfer liest unverändert selbst.
6. **EssentialProperty** nach Freigabe als `mpd-essential`, mit e01–e11 als gemeinsame Golden-Vektoren.
7. **Vor jeder Integration:** Gerätetest der Sonde auf Vivaldi Android (Abschnitt 9) – **nur mit Freigabe**.

## 14. Ergebnisse und Dateien

**Commit:** Kadri `33c8e6a` auf `test/s4b-dash`, gepusht (`5dd720a..33c8e6a`). Nur Testdateien:
- `tests/s4b7/**`;
- `tests/s4b7_webrequest_study.py`;
- `tests/s4b7_essential_audit.py`;
- `tests/web/s4a/own.js`: 1 Option.

Keine Datei unter `src/`, `chrome/`, `firefox/`, `channel/`. Die Sonde ist nicht im Build: In `dist/` gibt es keinen Treffer für `s4b7` oder „Messsonde“. Helfer unverändert (`6e553fc`). `main` und die P4-Pins sind nicht berührt.

**CI:** Auf `test/s4b-dash` läuft dash-e2e nur per manuellem Start. Der Push hat keinen Lauf ausgelöst. Der letzte Lauf (`5dd720a`, Run 45356996007) war erfolgreich; der neue Commit ändert keinen von der CI geprüften Produktcode.

| Prüfung | Ergebnis |
|---|---|
| Studie Lauf 4 (Abschluss) `xvfb-run -a python3 tests/s4b7_webrequest_study.py OUT` | **84/84** |
| Studie Lauf 1 / 2 / 3 (mit Prüfstandsfehlern, Abschnitt 11) | 54/57 · 60/61 · 74/75 |
| EssentialProperty-Audit (Kadri + Helfer `6e553fc`) | **22/22** (Befund: 6 Abweichungen vom Vorschlag) |
| Build (Test- und Normalbau) | ok |
| Vertraulichkeitsprüfung (1274 getrackte Dateien, nach dem Commit) | PASS |
| `test_dash_gate.py` | 122/122 |
| `test_dash_urlparam.py` | 32/32 |
| **Player-Matrix voll** | **339/339** (wie S4b-8) |

**Dateien in diesem Ordner:**

| Datei | Inhalt |
|---|---|
| `S4B-7A-BERICHT.md` | dieser Bericht |
| `kadri-s4b7a.patch` | Commit `33c8e6a` |
| `lauf1.log` … `lauf4.log`, `lauf*/s4b7-studie.json`, `lauf*/s4b7-rohdaten-klassen.json` | Studienläufe; Rohdaten nur als Klassen |
| `s4b7-essential-audit.json` | IST/Vorschlag je Fixture |
| `regress/` | status.txt, Logs, Matrix-JSON |
| `../s4b7-ref/` | Chromium-Feature-Dateien (Stand `main`, 24.11.2026) |

**STOP.** Die Machbarkeitsstudie ist abgeschlossen. Keine Produktintegration, kein Gerätetest. Für den Gerätetest auf Vivaldi Android und für S4b-7b ist eine gesonderte Freigabe nötig.
