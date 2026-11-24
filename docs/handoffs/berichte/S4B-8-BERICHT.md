# S4b-8 – Standardisierte DASH-Adressparameter (Annex I, UrlQueryInfo)

Stand 24.11.2026.

## 0. Stände und Rahmen

| | Ausgangsstand | neu |
|---|---|---|
| Kadri `test/s4b-dash` | `72d5a46` | **`5dd720a`** |
| Helfer `test/s4b5-dash` | Produkt `be157b2`, Tests `1ef214b` | **`6e553fc`** (Produkt + Tests) |

Unverändert:
- `main` (Kadri `cd00ded`, Helfer `bb8a42d`);
- die P4-Lieferpins;
- der WASM-Pin.

Der Harness-Pin `vendor/dash-harness/SOURCE` steht jetzt auf `6e553fc`.

Nicht gemacht: keine APK, keine ZIP, keine Installation, keine Beta, keine Veröffentlichung, kein Merge.

Weitere Grenzen:
- Keine neue Berechtigung.
- Keine Weitergabe von Cookie oder Authorization.
- Keine websitespezifische Regel (Vertraulichkeits-Check: 1265 Dateien).
- DRM/ContentProtection unverändert.

Die Analyse **vor** der Implementierung steht in `S4B-8-ANALYSE.md` (mitgeliefert). Das Wichtigste daraus folgt in 1.

## 1. Standard und heutige Implementierung

**Quellen:**
- MPEG-Schema `DASH-MPD-UP.xsd` und `DASH-MPD.xsd` (5th Ed., MPEGGroup/DASHSchema);
- dash.js als DASH-IF-Referenzplayer: Quelltext und das ausgelieferte Paket 5.2.1.

Der Normtext ISO/IEC 23009-1 Annex I lag nicht vor: Er ist kostenpflichtig, und dashif.org ist aus dieser Umgebung nicht auflösbar. Umgesetzt ist daher nur, was Schema und Referenz übereinstimmend und eindeutig festlegen.

| Punkt | Befund |
|---|---|
| Descriptor | `EssentialProperty`/`SupplementalProperty` mit `schemeIdUri="urn:mpeg:dash:urlparam:2014"`, Kind `UrlQueryInfo` im Namensraum `urn:mpeg:dash:schema:urlparam:2014`. 2016 = `ExtUrlQueryInfo`/`ExtHttpHeaderInfo`; dash.js kennt zusätzlich 2025 und `urn:mpeg:dash:state:`. |
| Ebenen | MPD, AdaptationSet, Representation: Essential und Supplemental. **Period: nur Supplemental** (Schema). |
| Attribute | `queryTemplate`; `useMPDUrlQuery` (Vorgabe false); `queryString`; `xlink:href`; beliebige Kinder und fremde Attribute (`xs:any`). Ext zusätzlich: `includeInRequests` (Vorgabe `segment`), `headerParamSource`, `sameOriginOnly`. |
| Vererbung (dash.js) | Die Anfangs-Query wird über die Ebenen aneinandergehängt; mehrere Descriptoren in einer Kette hängen die MPD-Query **mehrfach** an. `queryTemplate`: nur `$querypart$` umgesetzt, jeder andere oder fehlende Wert ergibt eine leere Query. Wirkt auf Init- und Mediensegmente. |
| Anfrage- vs. endgültige MPD-Adresse | dash.js nimmt `manifest.url` = XHR `responseURL`, also die **endgültige Adresse nach Weiterleitungen** (Kommentar im Code: „as per RFC3986 Section 5.1.3“). Kadri und Helfer lösen schon bisher alle relativen Adressen gegen diese auf. Entscheidung: **endgültige Adresse.** |
| Kodierung (dash.js) | Zerlegt und kodiert neu (URLSearchParams, dann `encodeURIComponent`): `sig=a/b` → `sig=a%2Fb`, `+` → `%20`, `flag` → `flag=`. Artefakt der Implementierung, nicht übernommen. |
| Kadri/Helfer vorher | Elemente im urlparam-Namensraum wurden verworfen. MPD-Ebene-EssentialProperty wurde gar nicht gelesen, also wurden **auch unverstandene Descriptoren angeboten** (Gegenprobe, siehe 6). Set-/Rep-Ebene ergab pauschal `set-essential`. |

## 2. Implementierung (beide Seiten identisch)

**Unterstützt:**
- Descriptor `urn:mpeg:dash:urlparam:2014` (Essential oder Supplemental; Period nur Supplemental), ohne `@value`.
- Genau ein Kind `UrlQueryInfo`, mit genau `queryTemplate="$querypart$"` und `useMPDUrlQuery="true"` (oder `1`), sonst nichts.
- Wirkung: an **jede Init-, Vorlagen- und SegmentList-Adresse** der Darstellungen unter dem Element wird die Query der **endgültigen MPD-Adresse** **unverändert** angehängt.
  - `?` bzw. `&`, wenn die Adresse schon eine Query hat; die vorhandene Query steht zuerst.
  - Kein Umkodieren, kein Sortieren, keine Duplikatentfernung.
  - Ohne Query an der MPD-Adresse wird nichts angehängt.
- **Ohne Descriptor wird nie eine Query übernommen** (d4 bleibt abgelehnt).

**Kontrolliert abgelehnt** (fatal für das MPD, Grund wörtlich gleich in Kadri und Helfer):

| Grund | Fälle |
|---|---|
| `urlparam-unsupported` | 2016/2025, `urn:mpeg:dash:state:*`, ExtUrlQueryInfo/ExtHttpHeaderInfo, 2016-Schema mit UrlQueryInfo, 2014 mit ExtUrlQueryInfo; `queryString`; `useMPDUrlQuery` fehlt/false; `@value`; fremde Attribute; Kinder; mehrere/fremde Kinder; kein Kind; Period-Essential; andere Stelle (z. B. SubRepresentation) |
| `urlparam-template` | `queryTemplate` fehlt oder ist nicht genau `$querypart$` (`$query:tok$` …) |
| `urlparam-conflict` | zwei Descriptoren an einem Element oder entlang einer Kette MPD → Period → Set → Darstellung |
| `urlparam-limits` | mehr als 16 Descriptoren; MPD-Query über 2048 Zeichen oder mit mehr als 64 Parametern |
| `urlparam-query` | `%` ohne zwei Hex-Ziffern bzw. Zeichen, die RFC 3986 und WHATWG verschieden behandeln |
| `uri-length` | Adresse mit Query über 4096 Zeichen: Darstellung ausgeschlossen, nie unvollständig angeboten |

`xlink:href` bleibt im ganzen MPD fatal (`xlink`), wie bisher.

**Helfer `6e553fc`** (Produkt: 7 Dateien, +208/−12):
- `DashUrlParam` (neu);
- `DashXml`: urlparam-Elemente unter Descriptoren behalten, fremde Kinder markieren;
- `DashManifest` und `DashTemplate.Media.withQuery`: Query in Init, Vorlage und SegmentList, Listen-Cache je Query, Längenprüfung;
- `DashProfile`: ein verstandener Descriptor ist kein `set-`/`rep-essential`;
- `DashLimits`;
- `ControlCommands`: Fähigkeit `dashdl.urlq=1`.

Das Protokoll ist unverändert: `dashplan` v1/v2, `BaseSelection` und Grenzen wie in S4b-6.

**Kadri `5dd720a`** (Produkt: 11 Dateien, +177/−41):
- **`src/039`:** Port von `DashUrlParam`; Abdruck und Vorprüfung mit den Adressen samt Query. Das Ergebnis nennt je Darstellung nur, **ob** sie die Query erhält – nie den Token.
- **`src/038`:** Index mit derselben Query der endgültigen MPD-Adresse. Nennt das MPD einen Annex-I-Descriptor ohne gültige Auswertung, wird **nichts indiziert** (Bindung `urlparam`). Die Marke für die Stücknummer berücksichtigt die Query.
- **`src/040`/`060`:** Reihenfolge Abdruck → Index; `urlq` im Angebot.
- **`src/105`/`180`/`080`, `channel`:** Angebot nur an Helfer mit `dashdl.urlq`, sonst E4 `no-urlq`.
- **`src/046`/`020`/`280`:** E2/E3 `urlparam` mit Meldung „Manifest verlangt Adressparameter (UrlQueryInfo) in einer nicht unterstützten Form“; feste Diagnose-Codes.

## 3. Sicherheit und Datenschutz

| Anforderung | Umsetzung / Nachweis |
|---|---|
| Query gehört zur Identität | Exakter Abgleich: andere Werte, sortierte, dekodierte, umkodierte (`%2F` statt `/`), ergänzte oder fehlende doppelte Parameter binden nicht (`test_dash_urlparam`). |
| Mehrdeutig/widersprüchlich → keine Bindung | `urlparam-conflict`; nicht gültig ausgewertet → nichts indiziert. Bei u5 (Descriptor, Player hängt nicht an) und d4 (kein Descriptor, Player hängt an) **keine** Bindung. |
| Kein eingeschleuster Host/Query über Kanalparameter | Der Helfer bildet die Query selbst aus dem neu geladenen MPD (endgültige Adresse). Eine Planadresse mit fremdem Token führt zu `manifest_mismatch`, kein Stückabruf. `BaseSelection` unverändert, nur Indizes. |
| CDN-Alternative und Query stimmen beim Neuladen überein | Abdruck über Adressen mit Query und alle Alternativen. Token-Wechsel zwischen Plan und Start ergibt `plan_changed`, nichts geladen. |
| Keine Weitergabe an nicht deklarierte Hosts | Die Query geht nur an im MPD erklärte Adressen (auch die gewählte BaseURL-Alternative). Eine Stück-Weiterleitung auf einen fremden Host folgt der Location unverändert: **dort ohne Token**, nachgewiesen. |
| Netzprüfung jedes Ziels beim Helfer | Unverändert SafeHttpClient (SSRF/Privatnetz/HTTPS) und frühe Prüfung aus S4b-6. |
| Keine Cookies/Authorization | Nachgewiesen (Helfer-E2E, Matrix u1–u4: „ohne Cookie/Authorization“). |
| Keine Tokens in Diagnose, Toasts, Relay-Spuren | Abdruck-Ergebnis ohne Token (Test). Matrix-Prüfung „Diagnose anonym“ und Langdruck schließen `s4a-token`/`://` aus; u1–u6 bestanden. Neue Diagnose-Texte enthalten nur feste Codes. |
| Grenzen | 16 Descriptoren, 2048 Zeichen, 64 Parameter, 4096 Zeichen je Adresse; Template genau `$querypart$`. |
| Keine DRM-Umgehung, keine neue Berechtigung | unverändert |

## 4. Gemeinsame Golden-Vektoren dash-gate/1

- Von 69 auf **109 Vektoren** über **94 MPDs**: 38 neue MPDs u01–u38, 40 neue Zeilen.
- **Byte-gleich** in Kadri `tests/web/dash/gate` und Helfer `tests/java/dash/fixtures/gate`.
- Erwartungen von Hand, mit Grund je Zeile.
- Neue Spalten:
  - `dok`: Query der endgültigen MPD-Adresse;
  - `stuecke`: Init- und erste Stückadresse der ersten Video-Darstellung, wörtlich.
- `gate-v1-fp.tsv` je Datei und Dokumentadresse (95 Schlüssel: Datei bzw. Datei mit Query). Alte Abdrücke sind unverändert.

| Anforderung | Vektoren |
|---|---|
| MPD-Query explizit übernommen | u01 (Essential), u02 (Supplemental), u04 (Period), u06 (nur Video-Set), u07 (eine Darstellung) |
| MPD-Query ohne Descriptor: keine Übernahme (d4) | u03 |
| unterschiedliche Tokens, doppelte Parameter | u09 (`tok=old` in der Vorlage + `tok=new&tok=new2`: alle erhalten); Abgleich-Fälle in `test_dash_urlparam` |
| vorhandene Query in SegmentTemplate/SegmentList | u08 (`?v=1&tok=…`), u10 (SegmentList mit und ohne eigene Query), u36 (geteilte Liste, Descriptor nur an v0) |
| Prozentkodierung, Sonderzeichen, Reihenfolge | u11 (`b=2&a=1&c=%2F%3D~` unverändert), u12 (`%zz` → `urlparam-query`), u29 (leere Query) |
| Init- und Mediensegmente | Spalte `stuecke` aller angebotenen u-Zeilen; u37 (nur Init zu lang) |
| mehrere BaseURL + UrlQueryInfo | u23 (`m:1` → Query an cdn-b; ohne Auswahl wie bisher `baseurl-multiple`) |
| fehlend/unbekannt/widersprüchlich | u05, u13–u21, u24–u28, u31–u34, u38 |
| Grenzen | u21 (17 Descriptoren), u22 (65 Parameter), u35 (2102 Zeichen), u30/u37 (`uri-length`) |

**Ergebnisse:**
- Kadri `test_dash_gate.py`: **122/122**.
- Helfer `TestDashGate`: **113/113**.
- Helfer `TestDashEngine.gateVectors`: alle 109 über den echten `dashplan`.
- **Spalte `netz` bei u12:** Der JDK-Testserver des Helfers lehnt die Anfrage-Adresse mit `%zz` selbst ab (HTTP 400), bevor das MPD geprüft wird. Beim Lesen meldet der Helfer `mpd_urlparam_query`.

## 5. Abnahme mit echtem Chromium, echtem Planungspfad und vollständigem Download

**Player-Matrix (neu u1–u6).** Der Testserver verlangt an jedem Stück den Token, sonst 403.

| Szenario | Ergebnis |
|---|---|
| u1 eigener Player, UrlQueryInfo auf MPD-Ebene | gebunden, Angebot, Plan 360p+180p, **vollständiger Download**; alle Helfer-Abrufe genau mit `?tok=…`; MPD einmal, ohne Cookie/Authorization |
| **u2 dash.js 5.2.1** (Referenzplayer, wendet Annex I selbst an) | ebenso: gebunden, vollständiger Download, Token selbst gebildet |
| **u3 dash.js 5.2.1, MPD 302 `?tok=A` → `?tok=B`** | gebunden; Helfer-Abrufe nur mit `tok=B`, **keiner mit `tok=A`**; Download vollständig |
| u4 zwei BaseURL + UrlQueryInfo, Player nimmt die zweite | Download vollständig über `cdn.example.org`, jeder Abruf mit Token |
| u5 UrlQueryInfo, Player hängt den Token **nicht** an | nicht gebunden, E2/query |
| u6 dash.js 5.2.1 mit ExtUrlQueryInfo (2016) | nicht gebunden, E2/urlparam „Manifest verlangt Adressparameter (UrlQueryInfo) in einer nicht unterstützten Form“ |

dash.js 5.2.1 wurde aus der npm-Registry gezogen (`dashjs-5.2.1.tgz`, SHA-256 `4eacb0cc…d088f`, integrity `sha512-axcJmL…P+Dw==`). Es liegt nur lokal im Player-Ordner der Matrix und ist nicht im Repository.

**Helfer-E2E** (`TestDashEngine.urlParams`, echter dashplan/dashstart):
- ohne Descriptor keine Übernahme (403);
- mit Descriptor vollständiger Download, jeder Abruf genau `?tok=abc123`;
- keine Cookies/Authorization/Origin;
- Planadresse mit fremdem Token → `manifest_mismatch`;
- MPD 302 A → B: nur B;
- rotierender Token → `plan_changed`, nichts geladen;
- Stück-302 auf nicht genannten Host: dort ohne Token;
- Multi-CDN + Token über cdn-b;
- ExtUrlQueryInfo → `mpd_urlparam_unsupported`.

## 6. Gegenproben (alter Stand zuerst)

| Prüfung | alter Stand | neu |
|---|---|---|
| Kadri `test_dash_gate.py` (101 Vektoren) | `72d5a46`: **86/114** – u. a. u13 (`$query:tok$`), u17 (2016), u19 (Konflikt), u21 (17 Descriptoren) **angeboten** | 122/122 (109 Vektoren) |
| Kadri `test_dash_urlparam.py` | `72d5a46`: **10/30**; bindet Stücke **ohne** Token trotz Descriptor | 32/32 |
| Kadri `channel/dash_unit_check.js` | `72d5a46`: 97/100 (Fähigkeit urlq) | 100/100 |
| Player-Matrix u1–u6 (Kadri `72d5a46` + Helfer `be157b2`) | **20/53** – u1–u4 nicht gebunden, kein Download; **u5 gebunden und angeboten**, obwohl der Player den vom MPD verlangten Token weglässt | 79/79 (zusammen mit d4, d5) |
| Helfer `TestDashGate` am Produkt `be157b2` | 28 FAIL (u05, u13 … angeboten; u06 `set-essential`) | 113/113 |
| Helfer `TestDashEngine` am Produkt `be157b2` | 224/246 (Download ohne Token unterbrochen, ExtUrlQueryInfo nicht erkannt) | 254/254 |
| **Fähigkeit:** neues Kadri gegen alten Helfer `be157b2` (u1) | kein Angebot: „Diese Helfer-App-Version kennt keine Adressparameter aus dem Manifest (UrlQueryInfo)“ | – |

## 7. Testergebnisse (Endstand)

**Kadri `5dd720a`** (Harness = Helfer `6e553fc`):

| Prüfung | Ergebnis |
|---|---|
| Node-Checks (27) | FAILS=0 |
| Kanal | `channel_unit` 45/45, `channel_integration` 74/74, `dash_unit` 100/100, `dash_integration` 26/26, `download_unit` 143/143, `download_integration` 44/44, `download_regression` PASS, `hls_unit` 97/97, `hls_integration` 109/109, `p4_identity` PASS, **`channel_mutation` 53 Mutanten erkannt** |
| **Player-Matrix voll** (MP4, HLS, DASH, iframe, Kanal, Epochen, Multi-CDN d5/d8, Annex I u1–u6) | **339/339** |
| Browser-Suiten (alle 34 `tests/test_*.py`) | 33/34; `test_detect` vorbestehend **nicht bestanden** (8) |
| S3h Weiterleitungs-E2E | 20/20 |
| S3d DASH-E2E | alle bestanden |

Einzelne Suiten:
- `test_dash_gate` 114/114 in der Vollsuite (vor u31–u38), danach einzeln 122/122;
- `test_dash_urlparam` 32/32 (in der Vollsuite 32/32);
- `test_dash_fp` 30/30, `test_dash_alt` 12/12, `test_dash_mpd` 61/61, `test_dash_dl` 37/37, `test_mp4` 143/143;
- `test_guard` 61/61, `test_attack` 8/8, `test_redirect` 25/25, `test_dnr_scope` 15/15, `test_frame_ui` 61/61.

Zu `channel_mutation_check`: Der erste Lauf scheiterte mit `EADDRINUSE` (fester Port), weil gleichzeitig die Helfer-Mutationsläufe Ports belegten. Ohne parallele Last lief er einmal wiederholt mit 53 erkannten Mutanten. Das ist eine Umgebungs-Kollision, kein Testergebnis; beide Logs liegen bei.

**Helfer `6e553fc`:**

| Prüfung | Ergebnis |
|---|---|
| `TestDash` | 293/293 |
| `TestDashGate` | 113/113 |
| `TestDashEngine` (Koordinator, Kanal, E2E-Downloads, Annex I, Vektoren) | 254/254 |
| Mutanten dash | **88/88 erkannt** |
| Mutanten dashdl | **60/60 erkannt** |
| CI `dash-core` auf `6e553fc` | **grün, alle 3 Jobs** (dash-core-jvm inkl. Mutanten, dash-engine-jvm inkl. Netzschicht-Wächter, dash-remux-jvm): https://github.com/Owndot/video-assistent-helper/actions/runs/45356922521 |

Zum ersten Mutationslauf (`*-lauf1.log`): 81/88, davon 6 überlebende und 1 veralteter Mutant. Das waren echte Lücken **meiner neuen Vektoren**, keine Produktfehler. Sie fehlten für:
- Schema-Prüfung mit passendem Kind;
- zwei, falsche bzw. fremde Kinder;
- Query > 2048;
- geteilte SegmentList;
- nur Init zu lang.

Geschlossen mit u31–u38 auf **beiden** Seiten; der veraltete Mutant zeigt auf die neue Zeile.

**Kadri-CI `dash-e2e`** (reguläre Ausführung per `workflow_dispatch` auf `5dd720a`, Pin `6e553fc`): **grün** – https://github.com/Owndot/Kadri/actions/runs/45356996007

- Die Abhängigkeit (OkHttp-JAR von Maven Central, SHA-256 unverändert gepinnt) wurde diesmal geladen. Es gab keine Ersatzquelle und keine abgeschwächte Prüfung.
- Ergebnisse im Lauf:
  - `dash_unit` 100/100, `dash_bind` 32/32, `dash_message` 60/60;
  - `test_dash_fp` 30/30, `test_dash_mpd` 61/61, **`test_dash_gate` 122/122**, `test_dash_alt` 12/12, `test_dash_start_unknown` 18/18, **`test_dash_urlparam` 32/32**;
  - **`dash-integration` 26/26** gegen den echten Helfer (meldet `dashUrlq:true`);
  - `test_dash_dl` 37/37, `test_dash_msg` 23/23, `test_dash_bind` 28/28.
- Damit ist auch der in S4b-6 offene CI-Nachweis erbracht.

## 8. Vorbestehender Fehler – NICHT bestanden

`test_detect.py` hat 2 Fehler, identisch zu S4b-4 bis S4b-6:
- Das installierte Chromium spielt den HLS-Stream ohne Dateiendung selbst (`src http:` statt hls.js).
- Dadurch fehlt die erwartete Listenzeile in der Diagnose.

Der Fehler ist weder angepasst noch ausgenommen.

## 9. Offene Risiken

1. **Normtext nicht geprüft.** Grundlage sind Schema und Referenzplayer. Sollte Annex I für `queryTemplate`-Vorgaben, Mehrfach-Descriptoren oder die Quelle der MPD-Query (Anfrage- statt endgültige Adresse) etwas anderes festlegen, müssten Fälle nachgezogen werden. Nach heutiger Wahl bindet bei Abweichung nichts, nichts wird falsch geladen.
2. **Umkodierung durch Player.** dash.js kodiert Werte mit `/`, `:`, `+`, `,`, `@`, `$`, `;`, `=` und Parameter ohne `=` um. Dann passen die beobachteten Adressen nicht, und es gibt keine Bindung (sicher, aber kein Angebot). Typische Tokens (Buchstaben, Ziffern, `-._~`, `%XX`) sind betroffen nicht.
3. **Rotierende Tokens** an der endgültigen MPD-Adresse (neue Weiterleitung je Abruf) ergeben `manifest_mismatch` bzw. `plan_changed`: kein Download.
4. **Nicht umgesetzt (abgelehnt):** `$query:<param>$`, `queryString`, ExtUrlQueryInfo/ExtHttpHeaderInfo (`includeInRequests`, Header, `sameOriginOnly`), 2025/`state`, xlink.
5. **Andere unbekannte EssentialProperty auf MPD- oder Period-Ebene** (nicht urlparam) werden wie bisher nicht gelesen. Bekannte Lücke aus der Zeit vor S4b-8, gesondert zu prüfen.
6. Der Android-Build des Helfers ist hier nicht gebaut und nicht auf Geräten geprüft (nur JVM und Desktop-Harness).

## 10. Dateien

Alle Dateien liegen in `/tmp/claude-0/-home-user/3cb664b3-a3c3-5e3b-940a-4ca03b6fb437/scratchpad/s4b8-out/`:
- Berichte und Patches: `S4B-8-BERICHT.md`, `S4B-8-ANALYSE.md`, `kadri-s4b8.patch`, `helper-s4b8.patch`
- Golden-Vektoren: `gate-v1-vectors.tsv` (109 Zeilen), `gate-v1-fp.tsv` (95 Abdrücke) – Kopien der Repository-Dateien
- Gegenproben: `gegenprobe-72d5a46-test_dash_gate.log`, `gegenprobe-72d5a46-test_dash_urlparam.log`, `gegenprobe-72d5a46-dash_unit_check.log`, `gegenprobe-72d5a46-matrix-u.log`, `gegenprobe-be157b2-helper-dash.log`, `gegenprobe-be157b2-helper-dashdl.log`, `faehigkeit-neuKadri-altHelfer-u1.log`
- Kadri: `voll/` (Node, Kanal, Matrix, Suiten, S3h, S3d), `matrix-u.log`, `neu-test_dash_gate.log`, `k-urlparam-2.log`
- Helfer: `h-dash-2.log`, `h-dashdl-2.log`, `h-dash-mutation.log`, `h-dashdl-mutation.log` (+ `*-lauf1.log`)
- `SHA256SUMS`

**STOP – vor S4b-7 (Worker-Netzwerkbeobachtung).**
