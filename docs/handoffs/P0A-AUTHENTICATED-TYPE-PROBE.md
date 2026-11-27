# P0-A · Eng begrenzte angemeldete Typprobe für MP4 derselben Site

**Stand zur unabhängigen Prüfung – keine Selbstfreigabe.** Umgesetzt ist Option 1 in der vom Nutzer freigegebenen, eng begrenzten Form. Nach einem Nutzer-Tipp prüft Kadri die vom Original-Element tatsächlich geladene Quelle einmalig mit der Sitzung der Seite über die bestehende `kadri-xhr`-Brücke, wenn die normale Probe keinen Typ geliefert hat. Das geschieht nur bei derselben Site und demselben Schema, ohne Weiterleitung und mit höchstens 4096 gelesenen Bytes. Geliefert wird nur der Typ.

Ergebnis: Die **unveränderte** `tests/test_mp4.py` besteht wieder mit **143/143** (vorher Abbruch nach 53 Prüfungen). Die drei P0-Gegenproben bleiben grün. Es gibt keine Cookies an andere Sites oder an den Helper und keine neue Berechtigung.

## 1. Commit-Kette

Branch `fix/p0a-authenticated-type-probe`, frisch von `6011d747dda9d9d027ce09120ece28c6894c45ef` abgezweigt; nicht von Bericht- oder Review-Commits, kein Merge.

| # | Inhalt | SHA | Parent |
|---|---|---|---|
| Basis | Produkt-/Teststand | `6011d747dda9d9d027ce09120ece28c6894c45ef` | `00f74f6` |
| 1 | Sicherheitsgrenze: zweckgebundene Typprobe im Hintergrund | `057a99f94dde0f4335bc5ec376696958b823178f` | `6011d74` |
| 2 | Höchstens ein angemeldeter Versuch je Adresse in 10 Minuten | `addee1f03f02e30af2c55b5f22c4774ebdec9062` | `057a99f` |
| 3 | Inhaltsskript: Auslösung, Bewertung, Prüfer | `85aac7bfa4616a9945b7e9f507c2db2fbd0bea6c` | `addee1f` |
| 4 | Dieser Bericht | Kopf des Branches | `85aac7b` |

Grundlagen: Übergabe `P0A-TYPE-EVIDENCE-NATIVE-PLAYBACK.md` (`d692957`), Befund `P0A-AUTHENTICATED-MP4-REGRESSION.md` (`37549bd`, nicht gemergt), Review `3ecee72`. Helper `6e553fcb82b437ce0be487233dd35f41958bade6`.

## 2. Ursache

Im Fall „Seite verlangt Anmeldung“ liegt die Seite auf `127.0.0.1:8790` und die MP4 auf `127.0.0.1:8791` – andere Herkunft, gleiche Site.
- Das Original lädt mit dem Sitzungs-Cookie (206).
- Kadris normale Probe (`credentials: 'same-origin'`) sendet zu einer anderen Herkunft kein Cookie und erhält 403, also keinen Dateibeleg.
- Seit P0-1 gibt `claimed-file` nichts frei.

Folge: Der eigene Player startet nicht, und `test_mp4.py` bricht ab.

## 3. Autorisierungs- und Herkunftslogik

**Auslösung (Inhaltsskript, `src/170` `tryNext`, `src/040` `mediaAuthProbe`).**
- Sie folgt nur auf eine **leere** eigene Probe (unlesbar, CORS, 401/403). Ein vorhandener `file`-Beleg braucht keinen zweiten Abruf. Ein restriktiver HLS-/DASH-Beleg oder eine MPD-Identität schließt die Probe aus.
- Nur für die Adresse, die **das Original-Element selbst lädt** (`srcOf(orig)`), im eigenen Player nach dem Nutzer-Tipp (`openBrowserPlayer` gibt es nur über `onPlayerTap`). Nie für weitere Kandidaten der Liste, für die Vorschau, die Rückgabe (`handBack`) oder einen Helper-Download.
- Nur in der Erweiterung: `IS_KADRI`, und der Hook stammt aus dem isolierten `prelude.js`. Seitenseitig gesetzte `window.KADRI_HOOKS`/`__KADRI__` wirken nicht (E14). Firefox und Userscript haben keinen Hook und bleiben unverändert.
- Gebunden an Player, `sourceRevision`, Quelle und eigenen Modus. Schließen, Quellenwechsel und Navigation verwerfen das Ergebnis. Der Ladetimer ruht weiter, die Zeitgrenze liegt bei 13 s.
- Je Dokument höchstens ein Versuch je Adresse (Cache 256). Im Hintergrund höchstens ein Versuch je Adresse in 10 Minuten, über Neuladen und Tabs hinweg. Das gilt auch nach 401/403, Fehler und Zeitüberschreitung.

**Grenze im Hintergrund (`chrome/background.js`, Zweck `media-type-probe`).**
- **Fester Vertrag:** genau ein GET mit `Range: bytes=0-4095`, ohne Körper und ohne Referer, `cache: 'no-store'`, 10 s. Methode, Köpfe, Daten, `anonymous`, `site`, `responseType` und `timeout` des Absenders werden verworfen.
- **Absender:** nur ein Tab dieser Erweiterung (`sender.id`, `sender.tab`, `sender.url` setzt der Browser).
- **Site und Schema:** gleiches Schema und dieselbe Site wie das Dokument. Maßgeblich ist die bestehende `guard`-PSL-Logik (`pslBase`, IP nur sie selbst); andernfalls findet **keine** Anfrage statt, auch keine anonyme. Zugangsdaten in der Adresse werden abgelehnt. Private Ziele gelten nur wie bisher, wenn die Seite selbst dort liegt (bestehende exakte Freigabe).
- **`redirect: 'error'`:** Kein Folgeschritt wird angefragt. Weiterleitungen werden nicht verfolgt, weil Regel 80 zwar Cookies an fremde Sites entfernt, eine Herabstufung HTTPS → HTTP innerhalb derselben Site aber nicht verhindern könnte.
- **Lesegrenze:** höchstens 4096 Bytes über den Leser, danach `reader.cancel()` und `AbortController.abort()`. Es gibt keinen Vollpuffer, und keine Bytes verlassen den Service Worker.
- **Antwort:** nur `{t:'type', type:'file'|'hls'|'dash'|'unknown'}`; Fehler ohne Adresse.
- **Bewertung:** wie bei der eigenen Probe. `#EXTM3U` ergibt `hls`, eine MPD-Wurzel `dash` (dokumentweite MPD-Identität). Nur ein ISO-BMFF-/EBML-Kopf ergibt `file`. Weder MIME, Endung, 206, Länge noch native Wiedergabe genügen. Ein Dateibeleg hebt keinen restriktiven Beleg auf (`noteMediaType`).

## 4. Messungen (Server, nur Klassen; Cookie-Namen, nie Werte)

Gemessen mit `tests/test_p0a_auth_type_probe_ext.py`: echte Erweiterung, Service Worker, Kanal-Helfer, HTTP 8791 und HTTPS 8443 (selbstsigniert), Hosts über `--host-resolver-rules` auf 127.0.0.1, `--no-proxy-server`. Die Probe des Service Workers trägt mit Hostberechtigung keinen `Origin`-Kopf; erkannt wird sie am festen Vertrag (`Range: bytes=0-4095` ohne `Origin`).

| Fall | Abrufe nach dem Tipp | Ergebnis |
|---|---|---|
| E1 Anmeldung (Port) | Seitenprobe ohne Cookie 403 · **Typprobe mit `sess` 206, 4096 Bytes** · bestehender `bytes=0-1`-Abruf (In App öffnen) mit `sess` | eigener Player dekodiert |
| E1 Helper | 1 Abruf ohne Cookie/Authorization/Referer, 403 | „Server verlangt Anmeldung“, Wiedergabe läuft weiter |
| E1 Wiederöffnen | keine weitere Typprobe | dekodiert |
| E2 öffentlich ohne CORS, gleiche Site | 1 Typprobe | dekodiert |
| E3 getarntes HLS (`.mp4`) mit Sitzung | 1 Typprobe (200, `#EXTM3U`) | hls.js-Weg, ohne Cookie 403 → fail-closed; kein eigenes `src`, 0 native Masterabrufe, 0 Seeks |
| E4 DASH (Server liefert der Probe ein MPD) | 1 Typprobe | MPD-Identität, kein eigenes `src`, 0 native Abrufe, dreimal Wiederöffnen ohne weitere Probe |
| E5 andere Site | **0** Typproben, 0 Cookies an `kadri-b.test` | kein Start (Funktionsverlust) |
| E6 Subdomain derselben Site | 1 Typprobe mit Lax-Cookie | dekodiert |
| E7 302/307/mehrstufig auf andere Site, Rückkehr zur Site, Weiterleitung innerhalb der Site | Typprobe nur Schritt 1 (`/r/…`, mit Cookie der eigenen Site); **0** Typprobe-Abrufe und 0 Cookies an `kadri-b.test` | kein Start |
| E8 privates Ziel von öffentlicher Seite | 0 Typproben | kein Start |
| E9 http-Seite → https-Quelle | 0 Typproben | kein Start |
| E9 https-Seite → https-Quelle derselben Site | 1 Typprobe mit Cookie | dekodiert |
| E10 Range ignoriert (200, 32 MiB) | 1 Typprobe, vom Empfänger abgebrochen; **gesendet 6,3–6,8 MB** in zwei Läufen (lokale Socketpuffer) | Hintergrund liest 4096 Bytes |
| E11 401 / 500 / Verbindungsabbruch / 12,5 s | je 1 Versuch (Abbruch: 2 Serverabrufe, Chromium wiederholt den GET selbst) | kein Start, nach Neuladen kein weiterer Versuch |
| E12 Einmaladresse (nur der erste Abruf gelingt) | Original verbraucht sie, Typprobe 403 | kein Start, kein weiterer Versuch |
| E13 Schließen / zweiter Tipp / Navigation während der Probe | genau 1 Typprobe | kein später Start; zweiter Tipp startet mit dem Beleg |
| E15 Sitzungsregeln danach | keine temporären Regeln, Regel 80 ohne Ausnahme-Domain | – |

**Abbruch- und Rücksetznachweise** (`tests/type_probe_bridge_check.js`, echter Hintergrundcode):
- Bei Range ignoriert wird nach dem ersten 64-KiB-Stück abgebrochen. Bei kleinen Stücken werden höchstens 4096 Bytes gelesen (5 × 1000).
- Regel 80 nimmt während des Abrufs genau die eigene Site aus.
- Nach Erfolg, Ablehnung, Fehler und Zeitüberschreitung (10 s) sind die Regeln zurückgesetzt.
- Normale Aufrufer der Brücke folgen weiter Weiterleitungen und erhalten Köpfe und Text.

## 5. Rot/Grün (identische Prüfdateien)

| Prüfer | `6011d74` | Endstand |
|---|---:|---:|
| `tests/test_mp4.py` (unverändert) | **Abbruch nach 53** | **143/143** |
| `tests/test_p0a_auth_type_probe_ext.py` | **16/33** | 33/33 |
| `tests/test_p0a_auth_type_probe.py` (Test-Hook statt Brücke) | **8/21** | 21/21 |
| `tests/type_probe_bridge_check.js` | **7/37** | 37/37 |

Auf `6011d74` sind die Sperrfälle (andere Site, Weiterleitungen, privat, Schema, gefälschte Hooks, Regeln) bereits grün. Ohne Probe gibt es dort auch keine Freigabe.

**Mutationen** (Wegwerf-Worktree auf `85aac7b`, danach verworfen): Alle sechs werden erkannt.

| Mutation | Ergebnis |
|---|---|
| M1 `claimed-file` wieder freigegeben | `test_p0a_nocors_type.py` 5/16 |
| M2 Same-Site-Grenze aus (Hintergrund und Inhaltsskript) | Node 33/37, Erweiterung 31/33 (E5, E14) |
| M3 Bytegrenze entfernt | Node 35/37 |
| M4 Weiterleitungen verfolgt | Node 36/37, Erweiterung 28/33 (alle E7) |
| M5 Probe nicht nur für die Adresse des Originals | Komponente 20/21 (K4) |
| M6 Gedächtnis im Hintergrund entfernt | Node 34/37, Erweiterung 25/33 (E3/E4/E11) |

## 6. Dekodierte Positivkontrollen

E1 Login (Port, im Player dekodiert, Helper kontrolliert fehlgeschlagen, Wiedergabe läuft), E1 Wiederöffnen, E2 öffentlich ohne CORS (gleiche Site), E6 Subdomain, E9 HTTPS derselben Site, E13 zweiter Tipp. Komponente: K1 nach 9,5 s mit Rückgabe, K5 zweiter Tipp. Weiter positiv: MP4/HLS mit CORS, Vorschau, Qualitätswechsel und passives Capture (Komponentenregression).

## 7. Regressionen am Endstand

Gelaufen am Kopf `85aac7b` mit einer frischen ungepackten Testfassung (`write(dir,'chrome',true)`, kein ZIP, kein `dist/`), dem Desktop-Harness des Helpers aus `6e553fc` und Chrome for Testing 158.0.8127.36 unter Xvfb.

**Chromium-Komponenten: 30 Programme, 593/593.** Das sind die 29 Programme der Vorrunde mit 572/572 und neu `test_p0a_auth_type_probe.py` mit 21/21. Darin enthalten: alle P0-A-Gegenproben (nocors_type 16, type_eviction 13, type_overflow 7, preview_alternative 5, hls_variant_guard 13, manifest_identity 13, source_type 26, native_hls_completeness 30), die P1-/P2-Prüfer und die DASH-Prüfer (10, 61, 122, 30, 23, 12, 32, 18).

**Node: 32/32 Programme mit Exitcode 0.** Das sind 27 `tests/*_check.js`, darunter neu `type_probe_bridge_check.js` mit 37/37 sowie `guard_check.js` und `ff_net_check.js` mit Pfadargument, dazu fünf Kanalprogramme. DASH-Dispatcher 104/104, Vertraulichkeit PASS (1330 Dateien).

**Erweiterung/Helper:**

| Prüfer | Ergebnis |
|---|---|
| `test_mp4.py` (unverändert) | **143/143** |
| `test_p0a_auth_type_probe_ext.py` (neu) | 33/33 |
| `test_p0a_nocors_extension.py` | 2/2 |
| basic / HLS / frame_ui / direct_dl / dash_bind / helper | 7/7, 24/24, 61/61, 87/87, 28/28, 18/18 |
| `test_dash_msg.py` | **20/23** – dieselben drei Fälle wie zuvor (offener Altbefund, kein PASS) |
| `test_dash_dl.py` | **Abbruch** mit demselben SyntaxError im Prüfer vor den Assertions (offener Altbefund, kein PASS) |

## 8. Verbleibende Grenzen und Risiken

1. **Einmal-/signierte Adressen:** Die Typprobe ist ein zusätzlicher Abruf mit Sitzung. Eine Einmaladresse kann dadurch verbraucht werden, im Messfall verbrauchte sie bereits das Original. Mehr als ein angemeldeter Versuch je Adresse in 10 Minuten findet nicht statt. Nach einem Neustart des Service Workers ist das Gedächtnis leer.
2. **Angemeldete Abrufe im Login-Ablauf:** Es sind jetzt zwei – die Typprobe (4096 Bytes) und der bestehende `prefetchExt`-Abruf (2 Bytes, „In App öffnen“). Auf `a7ac09d` war es einer. Die Zusammenlegung ist nicht umgesetzt; sie würde die bestehende externe Übergabe ändern.
3. **Range ignoriert:** Der Server kann bis zum Abbruch deutlich mehr senden als 4096 Bytes, lokal 6,3–6,8 MB. Eine Netzgrenze wird nicht behauptet.
4. **Weiterleitungen:** Angemeldete Quellen, die weiterleiten (auch innerhalb der Site, z. B. `/get_file` → CDN), bekommen keinen Beleg (Funktionsverlust, fail-closed).
5. **Andere Sites:** Andere Sites, Firefox und das Userscript bleiben beim Funktionsverlust.
6. **Getarntes HLS mit Sitzung:** hls.js lädt ohne Cookies (403) und scheitert kontrolliert. `commitOwnLoad` hat das Original dabei angehalten, und Kadri setzt es nicht fort, weil das ein nativer HLS-Start ohne vollständige Masterentscheidung wäre.
7. **Unterschiedliche Antworten:** Der Server kann der Probe andere Bytes liefern als dem nativen Player. Das gilt wie bisher; die Probe liefert dann nur einen Typbeleg für diese Antwort.
8. **SameSite=None, HTTPS-Herabstufung mit Weiterleitung:** E2E nicht geprüft, wegen `redirect: 'error'` ohne Folgeschritt. Android/Samsung/Vivaldi, Firefox-DOM und DASH-E2E (`test_dash_msg.py` 20/23, `test_dash_dl.py` SyntaxError) sind offen und nicht als bestanden gewertet.

## 9. Unveränderte Grenzen

`git diff 6011d74..HEAD` ist leer für `chrome/manifest.json`, `chrome/rules.json`, `firefox/`, `channel/`, `vendor/` (einschließlich `hls.min.js`), `tools/`, `.github/` und `package.json`. Geändert sind `chrome/background.js`, `chrome/prelude.js`, `src/040` und `src/170`, dazu Tests und dieser Bericht.

Unverändert sind außerdem: Berechtigungen, DNR-Regeln (keine neue Ausnahme; die bestehende exakte Freigabe und Regel 80 wirken wie bisher), die Helper-Kopplung und dessen anonyme Downloads, Signierung, Pins, `dashplan`/`dashstart` sowie die Releaseworkflows. Kein Merge, kein Force-Push, keine APK, kein ZIP, keine Beta, kein Release, keine Installation; `tools/sync-src.sh` nicht ausgeführt. P0-B, P0-C, automatische DASH-Downloads und EssentialProperty bleiben gesperrt.

**STOP.** Über GO oder NO-GO entscheidet ein unabhängiger Auditor.
