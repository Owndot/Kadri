# S4b-6 – P1-Sicherheitskorrektur (unbekannter Anfragebeginn) und mehrere BaseURL (CDN-Alternativen)

Stand 24.11.2026.

## 0. Rahmen und Stände

| | Basis | Teil A (P1) | Teil B (mehrere BaseURL) |
|---|---|---|---|
| Kadri `test/s4b-dash` | `f237546` | `2022767` | `72d5a46` |
| Helfer `test/s4b5-dash` | `f38c689` | – (nur Kadri betroffen) | `be157b2` (Produkt + Tests), `1ef214b` (nur Tests, siehe B10) |

- Teil A und Teil B sind getrennte Commits, Teil A zuerst.
- Unverändert:
  - `main` in beiden Repositories (Kadri `cd00ded`, Helfer `bb8a42d`);
  - die P4-Lieferpins (`7978a41`, `546af14`, `bd5ab29`);
  - der WASM-Pin `vendor/kadri-pairing-poc/SOURCE`.
- Nicht erstellt: keine APK, keine ZIP, keine Installation, keine Beta, keine Veröffentlichung, kein Merge.
- Keine neuen Berechtigungen.
- Keine Weitergabe von Cookie oder Authorization.
- Keine websitespezifischen Regeln. Der Vertraulichkeits-Check besteht: 1226 Dateien.
- DRM/ContentProtection unverändert.

---

# Teil A – P1: Ein unbekannter Anfragebeginn belegt die Medien-Epoche nie

## A1. Befund (bestätigt an `f237546`)

Bisher war der Anfragebeginn `s` eines Abrufs nur dann echt, wenn Resource Timing ihn lieferte. Sonst wurde er still durch die Ankunft `t` ersetzt:
- in `dashSee` und `dashHit` (`s = t`);
- in `resAt(x)` (Rückfall auf `x.t`);
- in `dashBindDecision` (`h.s || h.t`).

Wurde ein Stück **vor** dem Epochenbeginn angefragt, kam es aber **danach** an, galt es deshalb als Beleg der neuen Epoche. Das führte zu einer falschen Bindung und zu „gespielt“ in `dashOfferOf`.

Betroffene Wege:
- Beobachter ohne `startTime`;
- Einträge mit `startTime` 0;
- rückgefüllte Einträge ohne `s`.

## A2. Fix (`2022767`, 5 Produktdateien, +39/−22; mit Tests 9 Dateien, +169/−32)

**Ausdrücklicher Zustand „Anfragebeginn unbekannt“ = `null`.** Er ist klar unterschieden von einem echten Zeitpunkt.
- **`src/040`:**
  - `resAt(x)` liefert den Anfragebeginn nur, wenn er endlich und > 0 ist, sonst `null`. Es gibt keinen Rückfall auf die Ankunft mehr.
  - `dashSee`/`dashHit` speichern `s: null`, wenn der Beginn fehlt oder unplausibel ist (nach der Ankunft).
  - Das Rückfüllen übergibt `x.s` unverändert.
  - `dashOfferOf` zählt eine Darstellung nur bei `s !== null && s >= Epoche` als gespielt.
  - Die fetch-/XHR-Mitleser rufen `seeUrl(u, 0, '', Date.now())` auf. Der Zeitpunkt des Absendens ist ein **echter** Anfragebeginn, deshalb binden diese Wege weiter.
- **`src/038` `dashBindDecision`:**
  - Es zählen nur Treffer mit bekanntem `s ≥ Epoche`.
  - Treffer mit unbekanntem Beginn und Ankunft ab der Epoche werden als `unknownStart` gezählt.
  - Gibt es keine gültigen Treffer, aber unbekannte, lautet der Grund `start-unknown`.
  - Die positiven Kriterien sind unverändert: ≥ 3 zusammenhängende Stücke, Eindeutigkeit, Epoche.
- **`src/046`:** E2/`start-unknown` mit dem Text „Ladebeginn der Stücke nicht feststellbar – kein sicherer Nachweis möglich“. Der Abgleich nutzt denselben Filter.
- **`src/280`:** Zähler „Anfragebeginn unbekannt n (start-unknown, nicht gezählt)“ in der Stückprüfung, im Abgleich und in der Beobachter-Zeile.
- **`src/020`:** englischer Text.

## A3. Gegenprobe und Nachweis

`tests/test_dash_start_unknown.py` (neu, echtes Chromium, echte Quelltexte `src/038/039/040/046/060`):

| Fall | `f237546` | `2022767` |
|---|---|---|
| Anfragebeginn 0 / `undefined` / `null` / Beobachter ganz ohne Zeiten → keine Bindung, Grund `start-unknown`, gespielt `[]` | **FAIL: `bound` (stueckfolge, 3 Treffer, gespielt [1])** ×4 | OK ×4 |
| Ebene E2/`start-unknown` mit Meldung | FAIL (`E2/none`) | OK |
| danach 3 Stücke mit bekanntem Beginn → bound, gespielt nur [0] | FAIL (6 Treffer, gespielt [0, 1]) | OK |
| Mitleser (fetch/XHR, beim Absenden erfasst) → bound | OK | OK |
| bekannter Beginn vor / nach der Epoche → keine-treffer / bound | OK | OK |
| Diagnose-Zähler mit festem Code `start-unknown` | FAIL | OK |
| Quelltext: kein Rückfall auf die Ankunft | FAIL | OK |
| **gesamt** | **10/18** | **18/18** |

Logs: `gegenprobe-f237546-test_dash_start_unknown.log`, `neu-test_dash_start_unknown.log`.

## A4. Bewusst geänderte frühere Testerwartungen (Teil A)

Der S4b-4-Fix hatte ausdrücklich „Rückfall auf `t`, wo der Anfragebeginn unbekannt ist“ festgeschrieben. Genau dieser Rückfall ist die P1-Lücke. Deshalb:
- **`tests/test_dash_backfill.py`:** Die vier Rückfallprüfungen erwarten jetzt „unbekannt (`null`)“ statt `t`. 23/23.
- **`tests/dash_bind_check.js`:** Die Treffer tragen `s`. Die Fälle ohne `s` bzw. mit `s` = `null` oder 0, gemischt und konkurrierend, erwarten jetzt `start-unknown`. 32/32.
- **`tests/test_dash_mpd.py`:** Synthetische Treffer bekommen einen echten Anfragebeginn. Vorher hingen sie still vom Rückfall ab. 61/61.

Keine positive Prüfung wurde gelockert; es wurde nur die gezielte Verschärfung nachgezogen.

## A5. Regression Teil A (`2022767`)

| Prüfung | Ergebnis |
|---|---|
| Node-Checks (27) | FAILS=0 |
| Player-Matrix voll | 271/271 |
| Browser-Suiten (alle `tests/test_*.py`) | alle grün außer `test_detect` (vorbestehend, siehe C1) |
| S3h / S3d | 20/20 / alle bestanden |

Logs: `teilA/`.

---

# Teil B – S4b-6: mehrere BaseURL (CDN-Alternativen)

## B1. Analyse: Vererbung und Ebenen

Nach ISO/IEC 23009-1 5.6 sind mehrere `BaseURL` **auf derselben Ebene** gleichwertige Alternativen. Ebenen sind MPD, Period, AdaptationSet und Representation. Jede Ebene löst ihre BaseURL relativ zur gewählten Basis der äußeren Ebene auf.

Daraus folgt:
- Die Menge der möglichen Basen einer Darstellung ist das Produkt über die Kette. Deshalb gibt es eine harte Grenze **vor** dem Zusammenfassen.
- Eine absolute BaseURL auf einer inneren Ebene macht die äußeren Alternativen für diese Darstellung bedeutungslos. Die Kombinationen fallen dann auf eine kanonische Basis zusammen.
- Gleiche Texte oder gleiche Auflösungen sind Duplikate und werden kanonisch zusammengefasst.

## B2. Architektur

**Gemeinsame Auswahl „BaseSelection“** (Helfer `de.evp.helfer.dash.BaseSelection`, Kadri `dfpSelection` in `src/039`):
- Format: `m:1;p0:0;s3:1;r7:0`.
- Je **Element mit mehreren BaseURL** ein Eintrag: Schlüssel = Ebene und globale Nummer in Dokumentreihenfolge (m, p, s, r), Wert = Index der gewählten BaseURL.
- Streng geprüft:
  - Muster `(m|[psr](0|[1-9][0-9]{0,3})):(0|[1-9])`;
  - aufsteigend sortiert, jeder Schlüssel einmal;
  - höchstens 64 Einträge und 512 Zeichen.
- Jeder Eintrag muss am **neu geladenen** MPD ein Element mit mehreren BaseURL und einen vorhandenen Index treffen, sonst `alt-invalid`.
- Die Auswahl kann also **nur eine im MPD erklärte Alternative wählen, nie einen Host einführen**.

**Grenzen (beide Seiten gleich):**
- höchstens 8 BaseURL je Element;
- höchstens 16 Kombinationen je Darstellung, gezählt **vor** dem Zusammenfassen;
- darüber gilt `baseurl-limits`.
- Kadri-Index zusätzlich: höchstens 256 Einträge und 64 Darstellungen. Darüber ist das MPD **nicht prüfbar** (overflow) – es wird nie unvollständig indiziert und trotzdem angeboten.

**Fingerabdruck `kadri-dash-fp/1` über alle Alternativen:**
- Die Zeilen `<ebene>.baseAlternatives=n` und `<ebene>.baseAlt=<roh>` stehen nur bei Elementen mit mehreren BaseURL.
- Abdrücke von MPDs mit einer BaseURL sind **byte-gleich** zu vorher (`gate-v1-fp.tsv`, alle bisherigen Vektoren unverändert).
- Fällt eine Alternative weg oder kommt eine hinzu, ändert sich der Abdruck: `manifest_mismatch` beim Plan, `plan_changed` beim Start.

**Ablauf:**
1. **Kadri** indiziert je erklärter Alternative einen eigenen Eintrag. Jeder Treffer trägt das Auswahl-Token seiner Alternative.
2. **Kadri** leitet die Auswahl aus der Bindung ab (Regeln in B3).
3. **Kadri** prüft mit `dashGateFor(text, parsed, doc, alt)` vor: erst das ganze MPD (FIRST, für Abdruck und Struktur), dann die gewählte Projektion. Das ist dieselbe Reihenfolge wie beim Helfer.
4. **Kadri** sendet `dashplan` **v2** mit `alt`, nur wenn der Helfer die Fähigkeit `dashdl.alt=1` meldet. Sonst kommt E4 `no-alt` (helper-no-alt), und es gibt kein Angebot.
5. **Helfer `dashplan` v2:**
   1. Das MPD wird ohne Cookie/Authorization neu geladen.
   2. Der Abdruck über alle Alternativen wird verglichen: `manifest_mismatch`.
   3. Erst danach wird die Auswahl angewandt: `alt-invalid` bzw. `baseurl-undetermined`.
   4. Danach folgen die bisherigen Profil- und Planregeln unverändert.
   5. Die frühe statische Netzprüfung jeder geplanten Init- und ersten Stückadresse liefert `blocked_host`.
   6. Die Auswahl wird im Plan gespeichert. `dashstart` und `recheck` wenden genau sie erneut an.
- **`dashplan` v1 ohne Auswahl** bleibt für mehrere BaseURL kontrolliert abgelehnt (`mpd_baseurl_multiple`). Der Weg mit einer BaseURL ist unverändert.
- **Nicht gewählte Ebenen:**
  - MPD/Periode: fatal (`baseurl-undetermined`).
  - AdaptationSet/Darstellung: Die Darstellung wird ausgeschlossen (`baseurl-undetermined`, Kategorie `dash-baseurl-undetermined`). Sie wird dann nie mit einer geratenen Basis geladen.

**Protokoll und Fähigkeiten:**
- `dashplan` v2 = v1-Felder + Pflichtfeld `alt`. `alt` ist nur in v2 und nur bei `dashplan` erlaubt.
- `dashstart` bleibt v1.
- Status: `"dashdl":{"v":1,…,"ctx":1,"alt":1}`.
- Kadri-Kanal:
  - `alt` ist in `chrome/prelude.js` erlaubt;
  - Zeichensatz-Prüfung in `channel-session.js`;
  - `channel-downloads.dashPlan` prüft die Fähigkeit **vor** der seriellen Warteschlange. Vorher war das ein Selbstblockieren: „Keine Antwort“, danach leere Menüs.

## B3. Sicherheitsmodell

| Anforderung | Umsetzung | Nachweis |
|---|---|---|
| beobachtete Stücke müssen **exakt** zu einer erklärten Alternative passen | Je Alternative ein eigener Indexeintrag mit voller Adresse. Ein Treffer ist nur ein exakter Abgleich. Kein Host-Gleichsetzen über ähnliche Pfade, DNS oder Zeit. | `test_dash_alt`: gleicher Pfad auf nicht erklärtem Host → `keine-treffer`; gleiche Pfade auf A bzw. B → je eigene Auswahl `m:0`/`m:1` |
| ≥ 3 zusammenhängende Stücke in der aktuellen Epoche | Unverändert, mit Teil A (nur bekannter Anfragebeginn) | `test_dash_alt` „nur 2 Stücke“ → `zu-wenig-folge` |
| eindeutige Alternative; konkurrierende → keine Bindung | Eine Adresse, die zu Einträgen **verschiedener** Alternativen mit verschiedenen Darstellungen/Stücken passt, ist kein Beleg. Widersprüchliche Auswahl über Darstellungen (Video von A, Ton von B bei MPD-Ebene) → `alt-competing`. | `test_dash_alt`, `dash_bind_check` |
| nur eine Alternative je zusammenhängender Folge; CDN-Wechsel nie still | Mehr als eine Alternative in den Treffern einer Darstellung → `alt-mixed` (E2) | `test_dash_alt` (Stücke 1–2 von A, 3–4 von B); Player-Matrix **d8** (echter Player, Wechsel bei Stück 2) → E2/`alt-mixed`, kein Angebot |
| Helfer prüft Kadris Vorschlag am neu geladenen MPD; kein beliebiger Host | `BaseSelection` nennt nur Indizes. Jeder Eintrag muss ein Mehrfach-Element treffen, und der Index muss existieren. | Helfer: `m:5`, `m:1;p0:1`, `m:1;s0:0`, `m:1;m:1`, `m:1;r2:0`, `r0:0;r1:1;r2:0`, `r1:1;r2:0;r9:0` → `alt_invalid`/`mpd_alt_invalid`; Kanal: 6 ungültige `alt` (Zeichen, Host, v1, doppelt …) abgelehnt |
| Fingerabdruck- und Manifest-Änderungsschutz | Abdruck über alle Alternativen, verglichen **vor** der Projektion | Alternative nach dem Plan entfernt → `plan_changed`, nichts geladen; anderes MPD → `manifest_mismatch` |
| keine Cookie-/Authorization-Weitergabe | unverändert (SafeHttpClient) | Helfer: „keine Cookies/Authorization/Origin“; Matrix d5: MPD genau einmal ohne Cookie/Authorization |
| Weiterleitungen und Endziele mit SSRF-/Privatnetz-/HTTPS-Regeln | Jeder Abruf über SafeHttpClient (unverändert), zusätzlich früh `blockedStatically` (dieselben Regeln) beim Plan | 10.0.0.1, localhost, 169.254.169.254, `intranet` → `blocked_host` vor jedem Abruf; 302 auf erlaubtes Ziel → done; Stück leitet auf 10.0.0.1 → blockiert, nichts veröffentlicht |
| kein ungeprüftes Vertrauen in externe Hosts, nur weil sie als BaseURL stehen | Eine Alternative wird nur gewählt, wenn die beobachteten Stücke **dieser** Alternative zur Bindung führen. Jedes Ziel durchläuft die Netzregeln. | Vektoren b14/b15 (Spalte `netz`) |
| keine neuen Berechtigungen; DRM unverändert | Manifest-Berechtigungen unverändert; ContentProtection-Regeln unverändert | Vektoren `p*` unverändert |

**Bewusste Grenze:** Ob ein Host erlaubt ist (DNS, Ports, Testmodus), entscheidet allein der Helfer. Kadri kann das nicht vorhersagen. Daher hat dash-gate/1 die Spalte `netz`: Kadris Vorprüfung sagt für b14/b15 `ok`, der echte `dashplan` sagt `blocked_host`, und Kadri zeigt die Ablehnung des Helfers an. Alle anderen Codes sind auf beiden Seiten wörtlich gleich.

## B4. Diff

**Kadri `72d5a46`** (40 Dateien, +906/−148):
- Produkt: `src/038`, `039`, `040`, `046`, `060`, `080`, `105`, `180`, `280`, `020`; `channel/channel-downloads.js`, `channel-service.js`, `channel-session.js`; `chrome/prelude.js`.
- Tests: `test_dash_alt.py` (neu), `test_dash_gate.py`, `test_dash_fp.py`, `channel/dash_unit_check.js`, `s4a_dash_player_matrix.py`, `web/s4a/own.js`, 15 MPDs, Vektoren, Abdrucktabelle.
- `dash-e2e.yml` (Testliste), `vendor/dash-harness/SOURCE` (Harness-Pin `be157b2`).

**Helfer `be157b2`** (31 Dateien, +879/−93):
- `BaseSelection` (neu), `DashManifest`, `DashFingerprint`, `DashLimits`, `DashProfile`, `DashEngine`, `ControlCommands`, `SafeHttpClient.blockedStatically`;
- Tests, Fixtures, Mutanten.

**Helfer-Nachtrag `1ef214b`** (nur Tests, 5 Dateien, `app/` unverändert): siehe B10.

Patches: `kadri-s4b6-teilA.patch`, `kadri-s4b6-teilB.patch`, `helper-s4b6.patch`, `helper-s4b6-nachtrag.patch`.

## B5. Golden-Vektoren dash-gate/1 (erweitert)

- 69 Zeilen über 56 MPDs: 41 aus S4b-5, 15 neu (b01–b15).
- **Byte-gleich** in Kadri `tests/web/dash/gate` und Helfer `tests/java/dash/fixtures/gate` (`cmp`).
- Erwartungen von Hand mit Rechenweg in der Zeile.
- Neue Spalten:
  - `auswahl` (`-` = v1);
  - `basen` (verschiedene Basen je Darstellung);
  - `netz` (nur Helfer).
- `gate-v1-fp.tsv`: Abdruck je MPD (vom Helfer berechnet, Kadri gleicht ab).

| Anforderung | Vektoren |
|---|---|
| mehrere BaseURL auf jeder Ebene | b01 MPD, b02 Periode, b03 Set, b04 Darstellung, b05 verschachtelt (MPD 2 × Periode 2) |
| eine erlaubte und eine verbotene Alternative | b14 (`m:0` öffentlich → ok; `m:1` Privatnetz → `blocked_host`), b15 (lokaler Name → `blocked_host`) |
| zwei gleichzeitig plausible Alternativen | b07 (Duplikat → kanonisch eine Basis); konkurrierende Beobachtung: `test_dash_alt` `alt-competing` |
| Alternative verschwindet nach der MPD-Prüfung | Helfer-E2E „Alternative nach der Planung entfernt → plan_changed“ |
| unterschiedliche Segmentpfade / gleiche Pfade auf anderen Hosts | b12 (ganz anderer Pfad), b01/b13 (gleicher Pfad, anderer Host) |
| 301/302 | Helfer-E2E 302 erlaubt → done; 302 auf Privatnetz → blockiert |
| relative und absolute BaseURL | b02 (relativ), b06 (absolute Darstellungs-Basis überschreibt), b13 (relativ + absolut) |
| ungültig / doppelt / zu viele / verschachtelt | b10 (`^` → `uri_ambiguous`), b11 (leer), b07 (doppelt), b08 (9 > 8), b09 (4 × 5 = 20 > 16), b05 |
| ungültige Auswahl | b01 `m:2`, b04 `r0:0;r1:1;r2:0` (Element ohne Alternativen), b04 `r1:1;r2:0;r9:0` (nicht vorhanden) → `mpd_alt_invalid` |
| unbestimmte Ebene | b01 `s0:0`, b05 `m:1` → `mpd_baseurl_undetermined`; b03 `s1:0`/`s0:1`, b04 `r2:0` → Darstellung ausgeschlossen (`dash_baseurl_undetermined` bzw. ok ohne die ausgeschlossene) |
| v1 ohne Auswahl | b01, b02 → `mpd_baseurl_multiple` (wie bisher) |
| bestehendes d5 | Player-Matrix d5 (siehe B7) |

**Ergebnisse:**

| | Kadri | Helfer |
|---|---|---|
| Lesen/Profil/Plan/Abdeckung/Basen/Adressierung je Vektor | `test_dash_gate.py` **82/82** | `TestDashGate` **73/73** |
| echter `dashplan` je Vektor (Grund wörtlich, inkl. `netz`) | – | `TestDashEngine.gateVectors` 69/69 |
| Abdrucktabelle | Abgleich in `test_dash_gate.py` | `gate-v1-fp.tsv` (`--write-gate-fp` nur bewusst) |

## B6. Gegenproben (alter Stand zuerst)

| Prüfung | alter Stand | neu |
|---|---|---|
| `test_dash_gate.py` (Vektoren mit Auswahl) | `2022767`: **55/80** | 82/82 (69 Vektoren) |
| `test_dash_alt.py` | `2022767`: 9 FAIL, dann Abbruch (`dashParse` fehlt); u. a. „Video von A, Ton von B“ **bound** (widersprüchlich) | 12/12 |
| `channel/dash_unit_check.js` | `2022767`: 92/97 (v2/`alt`, Fähigkeit, `alt_unsupported`) | 97/97 |
| Player-Matrix d5 + d8 (neues Testskript gegen das Produkt von `2022767`) | **11/19**: d5 nicht gebunden, „noch nicht unterstützt“ (`baseurl-multiple`), kein Download; d8 abgelehnt, aber nur pauschal (`baseurl-multiple`) statt `alt-mixed` | 19/19 (in der Vollmatrix) |
| Helfer dash-Mutanten (CI `be157b2`) | 63/66 (1 überlebt, 1 unklassifiziert, 1 veraltet) | 65/65 (Nachtrag, B10) |
| Helfer dashdl-Mutanten (CI `be157b2`) | 58/59 (1 veraltet) | 59/59 (Nachtrag, B10) |

Auch am alten Stand gab es keine Gefährdung: Die Vorprüfung lehnte jedes MPD mit mehreren BaseURL pauschal ab, sodass die widersprüchliche Bindung nie zu einem Angebot führte.

## B7. Abnahme: echter Download über die zweite BaseURL

**Player-Matrix d5:**
- Eigener Player; das MPD nennt zwei CDN, der Player lädt von der zweiten Alternative (`cdn.example.org`).
- Bindung `bound`, Angebot, Planoptionen 360p + 180p.
- **Download vollständig, alle Stückabrufe an `cdn.example.org`** (`dl_hosts == [OTHER]`).
- Genau ein Download trotz Doppeltipp; Datei vollständig.
- Ebenen ohne Blockade; Diagnose anonym.

**Helfer-E2E:** vollständiger Download über die zweite BaseURL (alle Init- und Stückabrufe an `cdn-b.test`, keiner an die erste). Keine Cookies/Authorization/Origin.

**d8 (neu):** CDN-Wechsel mitten in der Folge (`switchAt=2`) → nicht gebunden, E2/`alt-mixed`. Menü und Diagnose nennen denselben Hinweis.

## B8. Leistung

| Messung | Ergebnis | Grenze im Test |
|---|---|---|
| Kadri: 4096 Darstellungen × 8 BaseURL (1,7 MB), Abdruck | ca. 0,5 s | < 2 s |
| Kadri: Index | ca. 90 ms, bei 256 Einträgen abgebrochen → nicht prüfbar | begrenzt |
| Kadri: 200 Abgleiche | < 10 ms | < 0,2 s |
| Kadri: Vorprüfung einer Auswahl | ca. 0,4 s (je Auswahl zwischengespeichert, `p.dashGateAlt`) | < 2 s |
| Kadri: 9 BaseURL an einer Darstellung | kontrolliert `baseurl-limits`, nichts indiziert/angeboten | – |
| Helfer: Lesen + Plan der Großfixture | < 5 s im 64-MB-Heap | 64 MB |

Die Arbeit fällt nur beim Lesen eines MPD bzw. einmal je Auswahl an, nicht je Abruf. Es gab keine sichtbare Blockade der Oberfläche in den Browser-Suiten.

## B9. Testergebnisse Teil B (Endstand)

**Kadri `72d5a46`:**

| Prüfung | Ergebnis |
|---|---|
| Node-Checks (27) | FAILS=0 (`teilB/node-checks.txt`) |
| Kanal-Prüfungen | `channel_unit` 45/45, `channel_integration` 74/74, `channel_mutation` 53 Mutanten erkannt, `dash_unit` 97/97, `dash_integration` 26/26, `download_unit` 143/143, `download_integration` 44/44, `download_regression` PASS, `hls_unit` 97/97, `hls_integration` 109/109, `p4_identity` PASS |
| **Player-Matrix voll** (MP4, HLS, DASH, iframe c1/c3, Kanal, d1–d8 …) | **281/281** |
| Browser-Suiten (alle 34 `tests/test_*.py`) | 33/34 grün; `test_detect` vorbestehend NICHT bestanden (C1) |
| S3h Weiterleitungs-E2E | 20/20 |
| S3d DASH-E2E (echter Helfer, Download) | alle bestanden |

Die Browser-Suiten umfassen unter anderem:
- `test_mp4` 143/143, `test_direct_dl` 87/87, `test_frame_ui` 61/61, `test_guard` 61/61, `test_dnr_scope` 15/15, `test_attack` 8/8, `test_redirect` 25/25;
- `test_dash_dl` 37/37, `test_dash_mpd` 61/61, `test_dash_bind` 28/28, `test_dash_backfill` 23/23, `test_dash_start_unknown` 18/18, `test_dash_alt` 12/12, `test_dash_fp` 30/30, `test_hls` 24/24.

Zwei Hinweise zur Zählung:
- `test_dash_gate.py` lief in der Vollsuite noch vor dem Nachtrag der zwei Vektoren mit 80/80 und danach einzeln mit 82/82 (`neu-test_dash_gate.log`).
- Das Matrix-Skript meldet Fehler über die Zeile `ERGEBNIS a von b`, nicht über den Exit-Code. Das ist bestehende Konvention in `tests/common.py`; ausgewertet wurde die Zeile.

**Helfer `be157b2` + Nachtrag:**

| Prüfung | Ergebnis |
|---|---|
| `TestDash` | 293/293 |
| `TestDashGate` | 73/73 |
| `TestDashEngine` (Koordinator, Kanal, E2E-Downloads, Vektoren) | 204/204 |
| Mutanten dash | 65/65 erkannt |
| Mutanten dashdl | 59/59 erkannt |
| CI `dash-core` | `be157b2` rot (Mutantenlücken, B10: https://github.com/Owndot/video-assistent-helper/actions/runs/45293894073); `1ef214b` **grün, alle 3 Jobs** (dash-core-jvm, dash-engine-jvm inkl. Netzschicht-Wächter, dash-remux-jvm): https://github.com/Owndot/video-assistent-helper/actions/runs/45298517649 |

**Kadri-CI:** `dash-e2e` wurde per `workflow_dispatch` auf `test/s4b-dash` gestartet (`72d5a46`, Harness-Pin `be157b2`). Run: https://github.com/Owndot/Kadri/actions/runs/45297865408

- **Ergebnis: nicht bestanden – Infrastruktur, kein Test lief.**
- Beide Versuche brachen beim Laden der gepinnten OkHttp-JAR von Maven Central mit **HTTP 429** (Rate-Limit) ab. Das geschah vor dem ersten Test, nach Rust-Bau und Checkout.
- Den einen erlaubten Neustart habe ich genutzt; weiter wiederholt wird nicht.
- Die Tests dieses Workflows liefen lokal gegen denselben Harness-Pin grün: `dash_integration_check` 26/26, `test_dash_dl` 37/37, `test_dash_alt` 12/12, `test_dash_start_unknown` 18/18, S3d.
- Ein CI-Beleg für Kadri fehlt damit. Er braucht einen neuen Lauf, sobald Maven Central wieder antwortet.

## B10. Nachtrag Helfer (nur Tests) – Ursache und Korrektur

CI `dash-core` auf `be157b2` war rot (https://github.com/Owndot/video-assistent-helper/actions/runs/45293894073). Lokal war es identisch reproduziert: `helper-dash-mutation-lauf1.log`, `helper-dashdl-mutation-lauf1.log`.

1. **Überlebender Mutant `checkAllUsed`:** Kein Vektor enthielt einen Auswahl-Eintrag für ein Element ohne mehrere BaseURL bzw. für ein nicht vorhandenes Element. Das ist eine echte Testlücke.
   - Zwei Vektoren kamen auf **beiden** Seiten hinzu (b04 `r0:0;r1:1;r2:0`, `r1:1;r2:0;r9:0` → `mpd_alt_invalid`).
   - Kadri prüft dasselbe (`src/039`) und besteht beide.
2. **Unklassifizierter Mutant `i >= count`:** Ohne die Prüfung entstand ein Laufzeitfehler statt eines Prüfungsfehlschlags. `TestDashGate` meldet einen Laufzeitfehler beim Lesen jetzt als FAIL. Das ist strenger, nicht lockerer.
3. **Zwei veraltete Mutanten:** Ihre Fragmente hatte meine eigene Änderung ersetzt (`b.size() > 1`, `dash field` ohne `alt`). Der erste ist entfernt; er ist durch den bestehenden Mutanten `sel == null` abgedeckt. Der zweite ist auf die neue Zeile gesetzt.
4. Zählungen 67 → 69 Vektoren.

Kein Produktcode ist geändert. Der Harness-Pin bleibt `be157b2`, denn der Produktstand ist identisch.

---

## C1. Vorbestehender Fehler – NICHT bestanden

`test_detect.py` hat 2 Fehler, identisch zu S4b-4/S4b-5 und am Teil-A-Stand:
- Das installierte Chromium spielt den HLS-Stream ohne Dateiendung selbst (`src http:` statt hls.js).
- Dadurch fehlt die erwartete Listenzeile in der Diagnose.

Der Fehler betrifft HLS-Erkennung und Browserversion, nicht DASH. Er ist weder angepasst noch ausgenommen und läuft in CI wie bisher mit.

## C2. Offene Risiken

1. **Netzpolitik nur im Helfer.** Kadri kann DNS, Ports und Testmodus nicht vorhersagen. Die Vorprüfung kann `ok` zeigen, wo der Helfer `blocked_host` antwortet (b14/b15). Sicher, aber erst beim Plan sichtbar.
2. **Alternativen auf Set-/Darstellungsebene ohne beobachtete Treffer** werden ausgeschlossen, nicht geraten. Ein Ton-Set mit zwei CDN, dessen Stücke noch nicht geladen wurden, verhindert das Angebot (E3 `baseurl-undetermined`). Abhilfe: weiterspielen lassen.
3. **CDN-Wechsel wird abgelehnt, nicht unterstützt** (`alt-mixed`). Ein Player, der während der Wiedergabe dauerhaft das CDN wechselt, bekommt kein Angebot, solange in der Epoche keine reine Folge von einer Alternative vorliegt.
4. **Duplikate mit identischen Adressen über Alternativen:** Es zählt die erste Alternative in Dokumentreihenfolge. Die Adressen sind identisch, der Download also gleich. Die Auswahl im Protokoll nennt dann die erste.
5. **Grenzen** (8/16/256/64) sind fest. Größere legitime MPDs werden kontrolliert abgelehnt (nicht prüfbar bzw. `baseurl-limits`), nie unvollständig angeboten.
6. **Android-Build** des Helfers wurde hier nicht gebaut und nicht auf Geräten geprüft. Es gab nur die JVM-Tests und den Desktop-Harness; das Emulator-CI läuft nur auf seinen Branches.
7. **Pin-Hinweis:** `vendor/dash-harness/SOURCE` zeigt jetzt auf `be157b2`. `s3d-test-delivery.yml` prüft diesen Pin nur auf `test/s3d-*`; die P4-/S3d-Lieferpins sind unberührt.
8. **Kadri-CI `dash-e2e` ohne Ergebnis** (Maven Central 429, B9). Der Nachweis für Kadri ist derzeit nur lokal.
9. **Aus Teil A:** Ohne Resource Timing (Worker, fremde Fenster, Browser ohne `startTime`) bindet Kadri jetzt gar nicht mehr statt unsicher. Das ist gewollt, kann aber dort Angebote verhindern. Die fetch-/XHR-Mitleser bleiben unberührt.

## C3. Dateien

Alle Dateien liegen in `/tmp/claude-0/-home-user/3cb664b3-a3c3-5e3b-940a-4ca03b6fb437/scratchpad/s4b6-out/`:
- `S4B-6-BERICHT.md` – dieser Bericht
- Patches: `kadri-s4b6-teilA.patch`, `kadri-s4b6-teilB.patch`, `helper-s4b6.patch`, `helper-s4b6-nachtrag.patch`
- Gegenproben: `gegenprobe-f237546-test_dash_start_unknown.log`, `gegenprobe-2022767-test_dash_gate.log`, `gegenprobe-2022767-test_dash_alt.log`, `gegenprobe-2022767-dash_unit_check.log`, `gegenprobe-2022767-matrix-d5-d8.log`
- Neu: `neu-test_dash_start_unknown.log`, `neu-test_dash_gate.log`, `neu-test_dash_alt.log`
- Teil A: `teilA/` (Node, Matrix, Suiten + Nachlauf, S3h, S3d)
- Teil B: `teilB/` (Node, Kanal, Matrix, Suiten, S3h, S3d)
- Helfer: `helper-dash-run.log`, `helper-dashdl-4.log`, `helper-dash-mutation.log`, `helper-dashdl-mutation.log` (+ `*-lauf1.log` = Stand `be157b2`)
- `SHA256SUMS`

**STOP – vor „UrlQueryInfo“ bzw. S4b-7.**
