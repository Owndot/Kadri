# Unabhängiges P0-A-Sicherheitsreview · Authentifizierte MP4-Typprobe (`media-type-probe`)

**Prüfgegenstand:** Produktbaum `85aac7bfa4616a9945b7e9f507c2db2fbd0bea6c` (Branch `fix/p0a-authenticated-type-probe`), Basis `6011d747dda9d9d027ce09120ece28c6894c45ef`.
**Art:** reine adversarielle Prüfung in frischem Checkout und eigenem Testaufbau, ohne Zugriff auf den Entwicklungschat, ohne Produktänderung.
**Prüfer:** Claude (gleiches Modellökosystem wie der Entwickler). Jede Aussage ist durch eine hier beschriebene eigene Messung belegt
oder ausdrücklich als *Hypothese* bzw. *nicht prüfbar* markiert. Entwicklerzahlen wurden nur als Hypothesen übernommen und nachgemessen.

## Urteil (Kurzfassung)

**Gate 1 (isolierte interne P0-B-Entwicklung): NO-GO.**

Die engen Grenzen der Probe halten in meinen Messungen: fester Vertrag, keine Weiterleitungs-Folgeabrufe (301/302/303/307/308,
HTTPS→HTTP, privat: je 0), keine Cookies an fremde Sites, korrekte Serialisierung und Rücksetzung der DNR-Ausnahme (auch bei parallelen
Anfragen und Port-Abbruch), Präfix-Klassifikation identisch mit der bisherigen Probe, unverändertes `test_mp4.py` **143/143** (Basis: Abbruch
nach 53), Entwicklerprüfer 33/33, 21/21, 37/37, alle drei früheren P0-Gegenproben grün.

Dennoch ist der neue authentifizierte Pfad an einer Stelle **messbar umgehbar**:

1. **B-1 (P0, bestätigt, neu):** Das globale 10-Minuten-Gedächtnis des Service Workers gibt einen früher *angemeldet* gewonnenen
   `file`-Typ an ein **anderes Dokument nach Sitzungswechsel** zurück, ohne erneut zu prüfen. Liefert dieselbe Adresse inzwischen einen
   HLS-Master, lädt Kadri ihn **nativ**: gemessen **5 native Masterabrufe und 2 native Abrufe an eine als MPD bekannte Variante** nach dem
   Tipp; Kontrolle mit leerem Gedächtnis: **0/0**. Das ist genau die Invariante, die dieses P0-A-Paket schließen soll.
2. **B-2 (P1, bestätigt; Klasse vorbestehend, durch den Fix erweitert):** In einem iframe unter einer **fremden** Hauptseite sendet die Probe
   `SameSite=Lax`- und `SameSite=Strict`-Cookies, die der Browser demselben Dokument verweigert (natives Video: keine bzw. nur `None`).
3. **B-3 (P2, Komponente bestätigt):** Die Bindung „nur die Adresse des Originals“ ist seitengesteuert: bei Rotation von `orig.src` 83
   angemeldete Probeaufrufe in einem Tipp.
4. **B-4 (P2, bestätigt):** „Höchstens ein Versuch je Adresse in 10 Minuten“ gilt nur bis zum nächsten SW-Neustart (gemessen 1 → 0 → 1).

Nach der Vorgabe des Auftrags („Bei tatsächlicher Schutzumgehung im neuen Cookie-Pfad ist (1) NO-GO“) ist Gate 1 daher **NO-GO**.
Die Korrektur von B-1 ist klein (Abschnitt „Befundliste“); nach ihr und einer Regression für B-1/B-2 wäre eine erneute, kurze Prüfung sinnvoll.

Gates 2–4 bleiben gesperrt (Abschnitt K).

---

## A. Verifizierte Git-Kette und geschützte Bereiche

Frischer `git fetch` von `https://github.com/Owndot/Kadri`; alle SHAs als `commit` aufgelöst, Eltern mit `git log --format='%H %P'` geprüft:

| Rolle | SHA | Parent (verifiziert) |
|---|---|---|
| Basis | `6011d747dda9d9d027ce09120ece28c6894c45ef` | `00f74f63702bcabd8074829632dd5ae6691ab9a3` |
| Sicherheitszweck im Hintergrund | `057a99f94dde0f4335bc5ec376696958b823178f` | `6011d74` |
| Versuchsgedächtnis (10 min) | `addee1f03f02e30af2c55b5f22c4774ebdec9062` | `057a99f` |
| Inhaltsskript, Auswahlbindung, Tests (**geprüfter Produktbaum**) | `85aac7bfa4616a9945b7e9f507c2db2fbd0bea6c` | `addee1f` |
| Bericht (Platzhalter) | `fa6856f41351a6c3b082de0bfc7e9b945aa99cf3` | `85aac7b` |
| Korrigierter Bericht (Branchkopf) | `b75e0675c90c8607ba0439cde66a70bbca9d0fbe` | `fa6856f` |

- `git ls-remote` (frisch): `refs/heads/fix/p0a-authenticated-type-probe` = `b75e067…`, `refs/heads/main` = `cd00ded7d68b3d2e8af9d2724cee03e7d351f091` (letzter Commit 28.10.2026, unverändert). `6011d74` ist **nicht** in `main`.
- `git diff --name-status 85aac7b b75e067`: ausschließlich `A docs/handoffs/P0A-AUTHENTICATED-TYPE-PROBE.md` (`fa6856f` legt an, `b75e067` ändert nur diese Datei). **Reine Dokumentation bestätigt.**
- `git diff --stat 6011d74 85aac7b`: Produkt `chrome/background.js` (+78 −4), `chrome/prelude.js` (+15 −1), `src/040-quellen-netzwerk.js` (+38), `src/170-player-laden.js` (+9 −2); Tests `tests/auth_probe_servers.py`, `tests/test_p0a_auth_type_probe.py`, `tests/test_p0a_auth_type_probe_ext.py`, `tests/type_probe_bridge_check.js`, `tests/nocors_servers.py` (nur additive Option `delay2`, keine bestehende Prüfung geändert).
- **Leer** (`git diff 6011d74 85aac7b`) für `chrome/manifest.json`, `chrome/rules.json`, `firefox/`, `channel/`, `vendor/` (inkl. `hls.min.js`, `psl.js`, WASM), `tools/`, `.github/`, `package.json`, `docs/`. Berechtigungen unverändert (`storage`, `declarativeNetRequestWithHostAccess`, `scripting`, `<all_urls>`); keine neue DNR-Regel.
- `tests/test_mp4.py`: Diff `6011d74..85aac7b` leer (unverändert).
- Helper: eigener Worktree auf `6e553fcb82b437ce0be487233dd35f41958bade6`, nur als Desktop-Harness gebaut (`tests/java/channel/build.sh`, unverändert). Maven Central lieferte HTTP 429; die drei gepinnten JARs wurden vom Google-Spiegel von Maven Central geladen und gegen die im Skript fest verdrahteten SHA-256 geprüft (alle drei identisch), danach lief das unveränderte Skript durch.
- Vollständig gelesen: `P0A-AUTHENTICATED-TYPE-PROBE.md` (`b75e067`), `P0A-AUTHENTICATED-MP4-REGRESSION.md` (`37549bd`), `P0A-TYPE-EVIDENCE-NATIVE-PLAYBACK.md` (`d692957`), `CLAUDE-INDEPENDENT-REVIEW-SOURCE-TYPE.md` (`3ecee72`). Nichts gemergt.

## B. Neuer Netzwerk- und Cookie-Datenfluss (Code-Nachweis)

```
Tipp „Im Videoplayer öffnen“ (src/260:281 onPlayerTap → openBrowserPlayer)
 └ src/170:122 tryNext → mediaTypeOf(u) ∉ {hls,file,dash} → src/170:162 mediaProbe(u)        [Inhaltsskript, ISOLATED, credentials same-origin]
     └ leer ('') → src/170:158 viaSession: nur wenn current() && srcOf(orig) == u (dashUrlKey)
         └ src/040:504 mediaAuthProbe: IS_KADRI-Hook, authProbeSameSite (Schema + PSL zu location), kein restriktiver Beleg, kein MPD
             └ chrome/prelude.js:153 typeProbe: Port 'kadri-xhr', {t:'req', purpose:'media-type-probe', url}, 12 s Grenze
                 └ chrome/background.js:285 onConnect: :297 typeProbeRequest (fester Vertrag) → :299 guard + typeProbeRefusal
                     → :302 typeProbeKnown (Gedächtnis 256/10 min, Schlüssel = URL ohne Fragment) → :303 'unknown' merken
                     → :324 headerGate (serialisiert Kopfphase) → :328 netGuard → :332 credSites/Regel 80 nimmt Site aus
                     → :334 fetch(credentials include, redirect 'error', no-store, no-referrer, Range 0-4095)
                     → :339 resetHeaders (Regel 80 zurück) → :342 typeProbeRead (≤ 4096 B, cancel + abort) → {t:'type', type}
```

- **Herkunft:** `from = port.sender.url || port.sender.tab.url` (`background.js:298`) – das ist die URL des **Frame-Dokuments**, das den Port öffnete, nicht die der Hauptseite. `content.js` läuft im Hauptfenster (Manifest `all_frames:false`) **und** wird über `kadri-sub` per `scripting.executeScript` in Unterframes nachgeladen (`background.js:475`). Für ein iframe gilt also die Site des iframes.
- **Seite/MAIN-Welt:** erreicht weder `KADRI_HOOKS` (Closure der isolierten Welt) noch `runtime.connect` (kein `externally_connectable`). Gefälschte `window.KADRI_HOOKS`/`__KADRI__` wirken nicht (Entwickler-E14 von mir erneut gemessen, Abschnitt H). `GM_xmlhttpRequest` reicht nur `kadriPurpose: 'player-resolve'` durch (`prelude.js:122`), nie `media-type-probe`; der Zweck entsteht ausschließlich in `typeProbe`.
  Nur die **Testfassung** öffnet eine Seite→`GM_xmlhttpRequest`-Brücke (`tools/build.js:58–63`); ich nutze sie in T4 ausschließlich, um
  gleichzeitige Kadri-Anfragen zu erzeugen. In der Produktfassung existiert sie nicht.
- **Antwort an das Inhaltsskript:** nur `{t:'type'}` (`background.js:300/302/342`); im Fehlerfall `{t:'error'}` ohne Adresse – bestätigt durch `type_probe_bridge_check.js` 37/37.
- **Helper:** unverändert ohne Cookie, Authorization, Referer (gemessen, Abschnitt H).
- **Gemessene Kopfzeilen der Probe** (HTTPS, Server): `Sec-Fetch-Site: none`, `Sec-Fetch-Dest: empty`, **kein `Origin`**, kein `Referer`, Cookies der Ziel-Site einschließlich `SameSite=Strict`. (Über HTTP sendet Chromium keine `Sec-Fetch-*`.)

## C. Frame-, Site-, Dokument- und Nutzeraktionsgrenzen

**Wer kann `media-type-probe` auslösen?** Nur Code der Erweiterung in einem Tab: `sender.id === runtime.id && sender.tab` (`background.js:247`),
und der Zweck entsteht nur in `prelude.js:153`. Die Seite (MAIN-Welt) erreicht weder Hook noch Port. Die **Auswahl** dagegen stammt aus
Seitendaten: geprobt wird die URL, die `srcOf(orig)` im Moment der Entscheidung liefert (`src/170:158–160`) – und `orig.src` setzt die Seite.

**Herkunftsprüfung:** `from` = `sender.url` des Frame-Dokuments (`background.js:298`); Inhaltsskript zusätzlich `location` des Frames
(`src/040:498–503`). `about:blank`/`srcdoc` → Schema `about:` ≠ Ziel → abgelehnt (Code; `guard` setzt dort ohnehin `anonymous`). IP nur sich
selbst (`pslBase`), Port wird ignoriert (`127.0.0.1:8790` → `:8791` gleiche Site, E1), PSL-Private-Suffixe (`github.io`, `eu.org`)
getrennt (Brückenprüfung „github.io: andere Unterseite“ grün), Schema muss gleich sein (E9, Brückenprüfung „https-Seite, http-Quelle“),
Zugangsdaten in der URL abgelehnt. `m.site` stammt aus `guard` (Browser-`sender.url`), nicht aus der Nachricht: `typeProbeRequest` verwirft
`site`, `anonymous`, Methode, Köpfe, Körper, `timeout`, `responseType` (Brückenprüfung „feste Anfrage“ grün).

**Gemessen (echte Erweiterung):**

| Fall | Ergebnis |
|---|---|
| E5 andere Site, E8 privates Ziel, E9 http→https, E14 gefälschte `KADRI_HOOKS`/`__KADRI__` (Entwicklerprüfer, neu gemessen) | 0 Probeabrufe, 0 Cookies an `kadri-b.test` |
| **T3 Drittkontext**: Hauptseite `www.kadri-b.test`, darin iframe `www.kadri-a.test` mit öffentlicher MP4 auf `cdn.kadri-a.test` (ohne CORS) | **Natives Video im iframe: keine Cookies (HTTP) bzw. nur `SameSite=None` (HTTPS). Angemeldete Probe: `lax` + `strict` (+ `nonesec`), `Sec-Fetch-Site: none`, kein `Origin`.** Zweimal reproduziert. |
| T3P gleicher Drittkontext, MP4 *mit* CORS (Probe lesbar, kein Typproben-Hintergrundabruf) | Der **bestehende** `player-resolve`-Abruf `bytes=0-1` sendet ebenfalls `lax` + `strict` – die Klasse ist **vorbestehend** im Brückendesign („gleiche Site wie das *Fenster*“) |
| X1 statisch (Komponente): 120 Kandidaten, `orig.src` unverändert | **1** angemeldete Probe |
| **X1 Rotation** (Komponente, Produktquelltext, Test-Hook): Seite setzt `orig.src` jeweils auf die gerade geprüfte Adresse | **83 angemeldete Probeaufrufe in einem Tipp** (83 verschiedene Adressen) |

**Bewertung T3 (Befund B-2):** Die Probe folgt der Site des *Frames*, nicht der Cookie-Politik des Browsers für diesen Kontext. In einem fremden
Hauptfenster verweigert Chromium dem eingebetteten Dokument `Lax`/`Strict` (und bei blockierten Drittanbieter-Cookies alle); die Probe sendet sie
trotzdem. Die Ziel-URL wählt das eingebettete Dokument (nicht die fremde Hauptseite), ein Tipp ist nötig, die Antwort verlässt den SW nicht.
Ein reproduzierbarer Ausnutzungspfad (CSRF/XS-Leak) wurde **nicht** gefunden → **Hypothese** für Ausnutzung, **bestätigt** für die
Grenzverletzung. Gleiche Eigenschaft hat der bestehende `player-resolve`-Abruf (T3P) – *früher vorhanden*, durch diesen Fix aber zusätzlich
**vor** der Typentscheidung und auch für unlesbare (CORS-lose) Quellen erreichbar.

**Bewertung X1 (Befund B-3):** „Nie für weitere Kandidaten der Liste“ ist nur gegen eine *passive* Seite wahr. Die Bindung ist ein Vergleich mit
`srcOf(orig)`, das die Seite kontrolliert. Für ein normales `<video src>` liefert `resolve()` genau **einen** Kandidaten (`src/060:452–453`);
mehrere Kandidaten entstehen nur über Seitendaten (META-Sites, `localNear`-Qualitäten bei Blob/MSE-Videos, Qualitätsmenü). Eine E2E-Messung
in der Erweiterung habe ich **nicht** durchgeführt → für die Erweiterung **Hypothese**, in der Komponente **bestätigt**. Ein Seitenskript
derselben Site könnte dieselben angemeldeten GETs auch selbst senden; zusätzlich sind nur `Sec-Fetch-Site: none`/kein `Origin` (umgeht
Fetch-Metadata-Schutz) und der Drittkontext (B-2).

**Dokumentwechsel/Navigation:** Port-Disconnect bricht den Abruf ab (T4b), spätes Ergebnis wird wegen `current()` verworfen (E13, K5 grün).

## D. DNR-/Session-Regeln, Abbruch, Crash, parallele Anfragen

Reihenfolge im Code (`background.js:321–381`): Tor `headerGate` (eine Kopfphase gleichzeitig) → `netGuard` (Sollregeln stehen und sind geprüft) →
ggf. `allowExact` (nur wenn `guard` den privaten Host als *die Seite selbst* zuließ) → `credSites.set(site)` + `stripUpdate` (Regel 80
`excludedRequestDomains:[site]`) → `fetch(redirect:'error')` → `resetHeaders()` **vor** dem Lesen des Körpers → Körper parallel; `finally` setzt
ein zweites Mal zurück. Fehler in `resetHeaders` → `netReady = null`, Abbruch, nächster Abruf baut die Regeln neu auf.

Eigene Messungen in der echten Erweiterung (T4, Regeln per `chrome.declarativeNetRequest.getSessionRules()` aus der Einstellungsseite gelesen,
nicht `credSites.size`):

| Fall | Regel 80 während | danach | Server |
|---|---|---|---|
| T4a Probe hält Köpfe 7 s zurück; parallel Kadri-Brückenabruf aus einem Tab von `kadri-b.test` an `cdn.kadri-a.test` | `excluded = ['kadri-a.test']`, keine temporären Regeln | `excluded` leer | Parallelabruf **erst 7,01 s nach Probebeginn** (nach dem Kopf der Probe), **ohne Cookies** |
| T4b Tab während der Kopfphase geschlossen (Port-Disconnect) | `['kadri-a.test']` | **binnen 1 s** leer | – |
| T4c **harter SW-Stopp** (`ServiceWorker.stopAllWorkers` per CDP; Zustand `running→stopping→stopped` bestätigt) während der Kopfphase | `['kadri-a.test']` | **bleibt ≥ 10 s stehen**, solange der SW gestoppt ist | Probeverbindung serverseitig abgebrochen |
| T4c Neustart durch einen Kadri-Abruf | – | `netGuard` stellt vor dem ersten Abruf die Sollregeln her: `excluded` leer, keine temporären Regeln | Abruf ohne Cookies |
| E15 (Entwicklerprüfer, von mir neu gemessen) nach allen Fällen | – | IDs 40, 51–58, 70, 80; keine 1000–900000; Regel 80 ohne Ausnahme | – |

Bewertung:
- **Parallelität:** Das Tor serialisiert die gesamte Phase, in der eine Ausnahme steht; Körper laufen danach ohne Ausnahme. Kein gemessener Fall, in dem eine andere Kadri-Anfrage die Ausnahme nutzt. Der Kanal zum Helfer (`channel-transport.js:41`) sendet ohnehin `credentials:'omit'`, `redirect:'error'` und wartet auf `netGuard`.
- **Harter Abbruch:** Nach einem SW-Ende bleibt eine Regel-80-Ausnahme für die Site in den Sitzungsregeln stehen, bis der SW neu startet (gemessen). Ein Verbraucher dieser Lücke ist nicht vorhanden: OWN-Regeln betreffen nur Anfragen der Erweiterung ohne Tab; fetch-Aufrufe gibt es nur im SW (`grep fetch( chrome/ channel/`), und jeder wartet nach dem Neustart auf `netGuard`, das zuerst aufräumt (gemessen). Das ist eine **vorbestehende** Eigenschaft aller angemeldeten Brückenabrufe, keine neue. Nicht reproduzierbar war ein Browserabsturz mitten in der Phase (Sitzungsregeln überleben keinen Browserneustart – nicht gemessen) → **nicht prüfbar**, kein PASS.
- **Weiterleitungen:** siehe Abschnitt C/T1: `redirect:'error'` erzeugt bei 301/302/303/307/308 **keinen** Folgeabruf; Regel 80 wird gar nicht erst beansprucht.
- **`allowExact`:** wird nur gesetzt, wenn `guard` den privaten Host zuließ (Seite liegt selbst dort, `background.js:201`), nur für die exakte URL ohne Fragment und in `resetHeaders` wieder entfernt; Brückenprüfung „Seite selbst im eigenen Netz … danach zurückgesetzt“ grün; T1 „http→privat 302“: 0 Folgeabrufe; Entwickler-E8 (privates Ziel von öffentlicher Seite): 0 Probeabrufe (neu gemessen).
- **Bestehender Vertrag (`kadri-xhr`/`player-resolve`):** Brückenprüfung „normaler GM-Abruf unverändert: folgt Weiterleitungen, liefert head/done mit Text“ grün; Downloads/Referrer: `test_mp4.py` 143/143, Helper ohne Cookie/Authorization/Referer.

## E. Typpräfix-Klassifikation und MPD-/HLS-Re-Entry

**Klassifikation** (`background.js:255–262` gegen `src/040:439–447`), eigener Node-Prüfer `x_classify.js` mit dem echten Hintergrundcode und der
wörtlich herausgelösten Inhaltsskript-Funktion: **15/15 identische Ergebnisse** in beiden Welten.

| Präfix | Ergebnis |
|---|---|
| `#EXTM3U`; BOM + Leerraum + `#EXTM3U` | `hls` |
| `<?xml…><MPD …>`, `<dash:MPD>`, **MPD nach 8-Byte-`free`-Box** (innerhalb 600 Zeichen) | `dash` |
| **MPD nach 1000-Byte-`free`-Box**, **`#EXTM3U` nach 8-Byte-`free`-Box**, `ftyp`, 8-Byte-`mdat`, EBML | `file` |
| HTML, leer, 3 Bytes, UTF-16-`#EXTM3U`, `<mpd>` | `unknown` (keine Freigabe) |

Ableitbar ist nur: *die Probeantwort* begann mit einem plausiblen Containerkopf. **Nicht** ableitbar: dass der spätere native Abruf (anderer
Range, anderes `Sec-Fetch-Dest`, andere Sitzung, späterer Zeitpunkt) dieselben Bytes erhält. Box-Länge, Content-Range, 206 vs. 200 und
Content-Type werden nicht geprüft; die Präfixe außerhalb des 600-Zeichen-Fensters ergeben `file`. Das ist dieselbe Schwäche wie bei der
unangemeldeten Probe (vorbestehend, Review `3ecee72` §5 H-2) – in Chromium führt ein so erzeugter `file`-Beleg nur dann zu einem
Variantenabruf, wenn der *native* Abruf HLS liefert (*Hypothese* für einen absichtlich diskriminierenden Server, nicht gemessen).

**Restriktive Belege:** `noteMediaType('file')` kehrt bei vorhandenem `restrictiveTypeOf(key)` zurück (`src/040:394`); `mediaAuthProbe` startet bei
restriktivem Beleg oder MPD-Identität gar nicht (`src/040:506`); Probe-`dash` ruft `rememberMpdIdentity` (`src/040:401`). Gemessen:
Entwickler-E3 (getarntes HLS mit Sitzung → `hls`, 0 native Masterabrufe), E4 (Probe-MPD → kein eigenes `src`, 0 native Abrufe, dreimal
Wiederöffnen ohne Probe), Komponente K2/K3 (MPD-Kinder 0, auch nach Verdrängung) – alle von mir neu gemessen grün.

**Bindung:** `current()` (`src/170:154`: Player, `sourceRevision`, Quelle, Modus) vor dem Start der angemeldeten Probe und erneut vor
`tryNext`; Entwickler-E13/K5 (Schließen, zweiter Tipp, Navigation während der Probe) neu gemessen grün. **Aber:** Die Bindung gilt nur
*innerhalb* eines Dokuments. Der Hintergrund gibt einen gespeicherten Typ **ohne** Bindung an Dokument, Sitzung oder Epoche zurück
(`background.js:302`) – daraus entsteht der Re-Entry in Abschnitt F (T2b/T2D).

**Dekodierte Positivkontrollen:** `decoded()` verlangt `videoWidth > 0` **und** `currentTime > 0,3` am eigenen Element (tatsächlich
fortschreitende Wiedergabe, nicht nur `loadedmetadata`). Selbst gemessen: E1 Login (Port) dekodiert, Helper-Abruf ohne
Cookie/Authorization/Referer → 403 → „Server verlangt Anmeldung“, eigene Wiedergabe läuft weiter (`currentTime` +0,5 s nach dem Fehler);
E1 Wiederöffnen, E2, E6, E9-HTTPS, E13 zweiter Tipp, T2a, T3 (beide), T5 dekodiert.

## F. Cache bei verschiedenen Sitzungen, Limits und SW-Neustart

`typeProbeSeen` (`background.js:232–242`): Map, Schlüssel = `noHash(url)`, Wert `{type, at}`, 256 Einträge (älteste zuerst verdrängt),
TTL 600 000 ms (`> TTL` ⇒ abgelaufen; 10:00 gilt noch). Lookup **nach** `guard`/`typeProbeRefusal` (`:299–302`), also nur für dieselbe Site
wie das anfragende Dokument – aber **ohne** Bindung an Cookie-Zustand, Tab, Dokument, Epoche oder Profil-Sitzung. Der positive Typ `file`
wird über diese Grenzen hinweg wiederverwendet, und das Inhaltsskript behandelt ihn wie einen frischen eigenen Dateibeleg
(`src/040:514–517` → `noteMediaType(u,'file')` → `src/170:220–222` `vid.src = u`).

**Prüfhypothese des Auftrags: bestätigt (Befund B-1, P0).** Prüfstand: `/sw2/<n>.mp4` liefert *mit* Sitzungs-Cookie eine echte MP4, *ohne*
Cookie einen HLS-Master (`Content-Type: video/mp4`, kein CORS) – der Server ist dabei **nicht** diskriminierend zwischen Probe und Player,
er antwortet zu jedem Zeitpunkt allen Anfragen derselben Sitzung gleich. Die Variante `/v2/<n>.m3u8` liest die Seite per CORS-`fetch` und
erhält MPD-Text (→ `page.js` → harte MPD-Identität im Inhaltsskript, Methodik wie Review `3ecee72` E2E-1); native Abrufe erhalten eine echte
Medienplaylist.

| Lauf | angemeldete Probe | eigenes `src` | native Masterabrufe nach Tipp | **native Abrufe der als MPD bekannten Variante** |
|---|---:|---|---:|---:|
| T2a/T2D angemeldet (Tab 1) | 1 (Cookie, 206, `file`) | ja (dekodiert, legitim) | – | – |
| T2b abgemeldet, **neuer Tab**, Gedächtnis gefüllt (2 Läufe) | **0** (Gedächtnis) | **ja** | **5** | 2 (Variante ohne MPD-Kenntnis) |
| **T2D** abgemeldet, neuer Tab, Variante als MPD bekannt | **0** | **ja** | **5** | **2** |
| T2c/T2D-Kontrolle: gleiche Schritte **nach SW-Stopp** (Gedächtnis leer) | 1 (ohne Cookie → `#EXTM3U` → `hls`) | nein | **0** | **0** |

Damit verletzt der neue Pfad genau die Abnahmeinvariante dieses P0-A-Pakets („null Kadri-verursachte native Requests auf als MPD bekannte
Varianten“, „HLS nur über den bewachten hls.js-Loader“). Ursache ist **neu** (Commit `addee1f`): Vor dem Fix gab es keinen
dokumentübergreifenden positiven Beleg; der Probecache im Inhaltsskript lebt nur je Dokument.
Voraussetzungen: dieselbe Adresse liefert innerhalb von 10 min und innerhalb eines SW-Lebens nach einem Sitzungswechsel (Abmelden,
Anmelden, anderes Konto; auch ein *inkognito*-Tab, falls die Erweiterung dort im Standardmodus „spanning“ läuft – *Hypothese*, nicht gemessen)
einen anderen Typ. Für einen absichtlich böswilligen Server ist das kein neuer Hebel (er kann Probe und Player ohnehin unterschiedlich
bedienen, vorbestehende Hypothese H-2); neu ist, dass ein **ehrlicher** Server mit sitzungsabhängigem Inhalt genügt.

Weitere Gedächtnis-Eigenschaften (gemessen bzw. Code):
- **SW-Neustart:** Gedächtnis leer → erneuter angemeldeter Abruf derselben Adresse (T5: 1 → 0 → 1 in < 1 min) → Befund B-4 (P2). Das
  „höchstens ein Versuch je Adresse in 10 Minuten“ des Berichts gilt nur innerhalb eines SW-Lebens; MV3 beendet untätige SW nach ≈ 30 s
  (hier unter CDP nicht reproduzierbar, siehe G).
- **Negativ-Gedächtnis:** `unknown` (auch nach 401/403/Timeout) sperrt die Adresse 10 min für *alle* Tabs; nach einer Anmeldung bleibt
  der Funktionsverlust bestehen (E11 „kein Wiederholungsversuch beim Wiederöffnen“) → P3 (fail-closed, nur Funktion).
- **Gleichzeitige Anfragen derselben Adresse:** `typeProbeRemember(key,'unknown')` vor dem Abruf (`:303`); die zweite Anfrage erhält sofort
  `unknown` (Brückenprüfung „Gedächtnis … zweiter Versuch ohne Abruf“, Entwickler-E13 „zweiter Tipp: ein einziger Abruf“). Rennen zwischen
  `unknown` und spätem `file`: das spätere Ergebnis überschreibt; ein restriktives Ergebnis im Inhaltsskript wird von `file` nie aufgehoben.
- **HLS/DASH im Gedächtnis, lokal noch unbekannt:** Ein Treffer liefert `hls`/`dash` → `noteMediaType` sofort restriktiv (verschärfend; E3/E4
  Wiederöffnen ohne Probe, dauerhaft gesperrt).
- **Fragment/Query:** Schlüssel ohne Fragment (gleiches Ergebnis für `#a`/`#b`, Brückenprüfung), Query gehört zum Schlüssel (signierte
  Adressen = je Signatur ein Versuch). Grenzen 255/256/257 und TTL 9:59/10:00/10:01 habe ich **nicht** in der Erweiterung gemessen (Code
  eindeutig: Verdrängung bei `size > 256`, Ablauf bei `> 600000 ms`); die Komponentenprüfer decken 255–257 nur für den Inhaltsskript-Cache ab.
  → **nicht gemessen**, keine Aussage über einen PASS.

## G. Reale Stream-, Byte- und Einmal-URL-Effekte

| Messung (Server, eigene Läufe) | Ergebnis |
|---|---|
| E10 Range ignoriert, 200, 32 MiB, Kopf = echte MP4 | 1 Probeabruf, Typ `file`; **Server hat 7 536 640 Bytes gesendet**, bevor der Abbruch ihn erreichte (Entwickler: 6,3–6,8 MB). Ausgewertet werden ≤ 4096 Bytes. Ein **Netzwerklimit von 4096 Bytes besteht nicht.** |
| Lesegrenze im SW (Code + Brückenprüfung) | fester Puffer 4096 B (`background.js:269–276`); nach dem ersten 64-KiB-Stück `reader.cancel()` + `abort()`; bei 5 × 1000 B höchstens 4096 B gelesen. Speicherspitze im SW = Puffer + ein vom Browser geliefertes Stück; **nicht gemessen** (kein Heap-Profil). Abbruchlatenz serverseitig nicht zeitlich gemessen – **offen**. |
| E11 401 / 500 / 12,5 s Verzögerung | je **1** angemeldeter Abruf, kein Start; nach Neuladen kein weiterer (im selben SW-Leben) |
| E11 Verbindungsabbruch | **2** angemeldete Serverabrufe für einen Probeversuch (Chromium wiederholt den GET nach Reset selbst) |
| E12 Einmaladresse (nur erster Abruf gültig) | Original verbraucht sie (206, Cookie), Seitenprobe 403 (ohne Cookie, nicht verbrauchend), angemeldete Probe 403; kein Start |
| T5 gleiche Adresse: Tipp → Neuladen → **SW-Stopp** → Neuladen | **1 → 0 → 1** angemeldete Abrufe in < 1 min. Das 10-Minuten-Versprechen gilt nur innerhalb eines SW-Lebens. |
| T5 Leerlauf (45 s) | SW blieb laufend – unter CDP-Beobachtung hält Chromium den Worker am Leben; die natürliche MV3-Leerlaufbeendigung (≈ 30 s) ist hier **nicht prüfbar** |
| E1 Login-Fall | **zwei** angemeldete Kadri-Abrufe je Öffnen: Probe `0-4095` (206, 4096 B) und der bestehende `prefetchExt`/`player-resolve` `bytes=0-1` (206, 2 B) nach `loadedmetadata`; beim Wiederöffnen keine weitere Probe |
| ETag/If-None-Match, chunked mit Content-Length-Konflikt | **nicht geprüft** (`cache:'no-store'`) |

Signierte/Einmal-Links: Jede *neue* Adresse erhält beim ersten Tipp einen zusätzlichen angemeldeten Abruf; bei Einmal-Links ist sie danach
für das Original verbraucht, wenn die Probe zuerst kommt (hier kam das Original zuerst). Nach jedem SW-Neustart ist ein weiterer Versuch
möglich (T5). Das ist ein **dokumentierter Funktions-/Seiteneffekt** und keine Cookie-Grenzverletzung; die externe Übergabe („In App öffnen“)
habe ich nicht verändert.

## H. Unveränderte MP4- und bisherige P0-A-Regressionen

Alle Läufe mit eigener ungepackter Testfassung (`write(dir,'chrome',true)` über einen Wrapper im Scratchpad, **kein** `dist/`, **kein** ZIP),
Chrome for Testing 158.0.8127.36 unter Xvfb, echter Service Worker, Kanal-Helfer aus `6e553fc`.

| Prüfer | Basis `6011d74` (eigene Messung) | Produkt `85aac7b` (eigene Messung) |
|---|---:|---:|
| `tests/test_mp4.py` (unverändert) | **Abbruch nach 53** (`test_mp4.py:307`, Anmeldefall, Timeout in `open_player`) | **143/143** |
| `test_p0a_auth_type_probe_ext.py` (neu) | **16/33** | **33/33** |
| `test_p0a_auth_type_probe.py` (neu, Komponente) | **8/21** | **21/21** |
| `type_probe_bridge_check.js` | **7/37** | **37/37** |
| P0-1 `test_p0a_nocors_type.py` | – | 16/16 |
| P0-2 `test_p0a_type_eviction.py` / `test_p0a_type_overflow.py` | – | 13/13 · 7/7 |
| P0-3 `test_p0a_preview_alternative.py` | – | 5/5 |
| `test_p0a_nocors_extension.py` (Erweiterung) | – | 2/2 |
| P1/P2 `test_p1_probe_lifecycle.py` / `test_p2_probe_effects.py` | – | 14/14 · 6/6 |
| Node `tests/*_check.js` (27 Programme, `guard_check` mit `chrome/background.js`, `ff_net_check` mit `firefox/background.js`) | – | 27/27 Exitcode 0; Vertraulichkeit PASS (1330 Dateien) |
| Kanal: `dash_unit_check` / `channel_unit` / `hls_unit` / `download_unit` / `download_regression` / `p4_identity` | – | 104/104 · 45/45 · 97/97 · 143/143 · PASS · PASS |
| Erweiterung/Helper: `test_basic` / `test_hls` / `test_frame_ui` / `test_dash_bind` / `test_helper` / `test_direct_dl` | – | 7/7 · 24/24 · 61/61 · 28/28 · 18/18 · 87/87 |
| `test_dash_msg.py` | – | **20/23 – FAIL** (dieselben drei Diagnosefälle wie zuvor: `ambiguous(start-timing)`, Manifest-Einordnung, Netzwerk/Registry) |
| `test_dash_dl.py` | – | **Abbruch vor fachlichen Assertions**: `Page.evaluate: SyntaxError: missing ) after argument list` (`tests/test_dash_dl.py:159` aus `:185`) – **kein PASS** |

**Die drei früheren P0-Umgehungen** (P0-1 `.mp4`-getarntes HLS ohne CORS, P0-2 Verdrängung restriktiver Belege, P0-3 Vorschau-Alternative)
bleiben in ihren Gegenproben geschlossen (16/16, 13/13 + 7/7, 5/5; dazu Entwickler-E3/E4 mit Cookie/CORS und Komponente K2/K3 mit
MPD-Kindern 0). **Aber:** Über den neuen Pfad entsteht eine **neue** Re-Entry-Route in genau diese Schutzklasse (B-1, T2D: 2 native
Abrufe an eine als MPD bekannte Variante). 143/143 überstimmt diesen gemessenen Pfad nicht.

## I. Unabhängige neue Tests und Mutationen

### Eigene adversarielle Szenarien (nicht in den 33/33 des Entwicklers enthalten)

Prüfstand: `tests/auth_probe_servers.py` des Entwicklers, **im Audit-Skript** (nicht im Repo) um Pfade erweitert: `/top` (iframe-Hauptseite),
`/sw/`, `/sw2/` (sitzungsabhängiger Typ), `/v2/` (Variante: CORS-Leser → MPD-Text, nativ → echte Playlist), `/page2` (Seite liest Variante per
CORS), `extredir=…&code=…` (Weiterleitung **nur** für die Probe, damit das Original spielt). Zusätzlich protokolliert: `Sec-Fetch-Site`.

| Szenario | Ergebnis Produkt | Status |
|---|---|---|
| T1 Weiterleitung nur für die Probe: 301/302/303/307/308 → andere Site, HTTPS→HTTP gleiche Site, HTTPS→HTTPS gleiche Site (308), → privat | je **1** Probeabruf (Status = Code), **0** Folgeabrufe, kein Start – 8/8 | widerlegt (kein Fehler) |
| **T2b/T2D** Gedächtnis über Abmeldung + neuen Tab | eigenes natives `src` auf HLS-Inhalt, 5 native Masterabrufe, **2 native Abrufe der MPD-Variante**; Kontrolle 0 | **bestätigt (B-1)** |
| **T3** Drittkontext-iframe (HTTP, HTTPS) | Probe mit `lax`+`strict`, Browser verweigert sie dem Frame | **bestätigt (B-2)** |
| T3P gleicher Kontext, bestehender `player-resolve` | ebenfalls `lax`+`strict` – **auch am Basisstand `6011d74`** gemessen (`bytes=0-1`, `lax`+`strict`) | Klasse vorbestehend |
| T4a/b/c DNR parallel, Tab-Schließen, harter SW-Stopp | siehe D | widerlegt; SW-Stopp = Restbefund P3 |
| T5 SW-Neustart | 1 → 0 → 1 angemeldete Abrufe | **bestätigt (B-4)** |
| **X1** Kandidatenrotation (Komponente) | statisch 1, Rotation **83** Probeaufrufe je Tipp | **bestätigt Komponente (B-3)**, E2E Hypothese |
| X-Klassifikation (Node) | 15/15 konsistent | widerlegt (kein Fehler), Grenzen in E |

Rot/Grün meiner Szenarien: Am Basisstand gibt es keine angemeldete Probe; T2 ist dort mangels Pfad nicht anwendbar (am Basisstand nicht gemessen; ohne
angemeldete Probe entsteht kein Dateibeleg, also auch kein Gedächtnis), T3 am Basisstand: **keine** Probe, keine Lax/Strict-Cookies, kein eigener Start (Funktionsverlust); T3P am Basisstand: `player-resolve` mit `lax`+`strict`). Die Fehlschläge sind also Eigenschaften der neuen Commits `057a99f`/`addee1f`/`85aac7b` (B-2 als Ausweitung einer vorbestehenden Klasse).

### Mutationen (je eigener Wegwerf-Worktree von `85aac7b`, Testfassung neu gebaut, danach verworfen)

| Mutation | Ort | harter Prüfer | Ergebnis |
|---|---|---|---|
| M1 `claimed-file` wieder freigegeben (nur `tryNext`) | `src/170:220` | `test_p0a_nocors_type.py` (im Mutations-Worktree) | **6/16** – erkannt (Entwickler: 5/16 mit zusätzlicher Freigabe in `hlsNativeStartAllowed`) |
| M2 Same-Site-Grenze aus (Hintergrund + Inhaltsskript) | `background.js:252`, `src/040:501` | Brücke / Erweiterung | **33/37** / **31/33** (E5, E14) – erkannt |
| M3 Bytegrenze entfernt (Körper ganz lesen) | `background.js:271` | Brücke | **35/37** – erkannt |
| M4 Weiterleitungen folgen | `background.js:336` | Brücke / mein T1 | **36/37** / **1/8** – erkannt. Messung: fremdes Ziel ohne Cookies (Regel 80 hält), **HTTPS→HTTP gleiche Site: `lax`+`strict` im Klartext am Ziel** |
| M5 Probe nicht nur für die Adresse des Originals | `src/170:160` | Komponente / mein X1 statisch | **20/21** (K4) / **120** statt 1 Aufrufe – erkannt |
| M6 Gedächtnis entfernt | `background.js:238` | Brücke / Erweiterung | **34/37** / **25/33** (E3, E4 ×3, E11) – erkannt |
| M7 (eigene) nur Inhaltsskript-Site-Prüfung aus | `src/040:501` | Komponente | **20/21** (K4 „andere Site“) – erkannt; in der Erweiterung fängt der Hintergrund es zusätzlich ab |
| M8 (eigene) Hintergrund-Site-Grenze aus **und** `credentials:'include'` erzwungen | `background.js:252/336` | Brücke | **33/37** – erkannt (Regel 80 wäre zweite Linie) |
| M9 (eigene) Ausnahme bis Körperende halten | `background.js:339` | Brücke | **35/37** („Regel 80 ohne Ausnahme“) – erkannt |
| M10 (eigene) Schema-Prüfung aus | `background.js:250`, `src/040:501` | Brücke | **35/37** (Herabstufung, anderes Schema) – erkannt |

Lücke der Entwickler-Suite: **kein** Prüfer erfasst B-1 (sitzungs-/dokumentübergreifender positiver Beleg), B-2 (Drittkontext) oder B-3
(seitengesteuerte Auswahl). Die Suite zählt korrekt Cookie-Namen und Medienwirkung, prüft aber nur Fälle mit *einem* Dokument und
erstem Kontext.

## J. Verbleibende Android- und DASH-E2E-Lücken

- **DASH-E2E:** `test_dash_msg.py` am Produktstand **20/23** (drei vorbestehende Diagnosefälle, unverändert gegenüber den Vorberichten) und `test_dash_dl.py` **Abbruch** mit dem bekannten Prüfer-SyntaxError (`tests/test_dash_dl.py:159`, aus `:185`) – beides **FAIL/BLOCKED**, vom Fix unabhängig laut Vorberichten (Basis hier nicht erneut gemessen). Es gibt damit **keinen DASH-E2E-PASS**; nicht repariert, keine DASH-Funktion freigeschaltet.
- **Android/Samsung/Vivaldi:** kein Gerät, kein Emulator – **BLOCKED**. Insbesondere offen: native HLS-Parser auf Android (B-1-Folge dort
  möglicherweise anders), SW-Lebensdauer unter Android-Chromium (B-4), Drittanbieter-Cookie-Voreinstellungen (B-2), Inkognito.
- **Firefox/Userscript:** kein Hook, Verhalten unverändert laut Code (`authTypeProbeHook` nur mit `IS_KADRI` und Chrome-Prelude); Firefox-DOM
  **nicht geprüft**.
- **Harter Browserabsturz** während der Kopfphase: nicht reproduziert (nur SW-Stopp) – **nicht prüfbar**.
- **Natürliche SW-Leerlaufbeendigung:** unter CDP nicht reproduzierbar (SW blieb 45 s laufend) – **nicht prüfbar** hier.

## K. Entscheidung für alle vier Gates

| Gate | Urteil | Begründung |
|---|---|---|
| **1. Isolierte interne P0-B-Entwicklung** | **NO-GO** | B-1: gemessene Kadri-veranlasste native Abrufe an eine als MPD bekannte Variante über den neuen Cookie-Pfad (Gedächtnis); dazu B-2 (P1). 143/143 und die grünen Altgegenproben überstimmen das nicht. |
| 2. Abnahme vollständiger Extension-/Helper-/DASH-E2E-Tests | **nicht erreicht** | DASH-E2E ohne PASS (Abschnitt J); B-1/B-2 offen |
| 3. Automatische DASH-Downloads | **gesperrt** | keine Freigabe aus diesem Review; `dashplan`/`dashstart` unverändert gesperrt (`channel/` unverändert, `dash_unit_check` 104/104) |
| 4. Beta, Release, Android/Samsung/Vivaldi-Installation | **gesperrt** | nicht geprüft (kein Gerät/Emulator); P0 offen |

**Bedingungen für eine erneute Prüfung von Gate 1** (Empfehlung, keine Selbstfreigabe): B-1 behoben (kein positiver `file`-Beleg aus dem
SW-Gedächtnis an ein anderes Dokument), B-2 behoben oder als Funktionsgrenze auf Erstkontexte beschränkt, je ein harter
Erweiterungsprüfer (T2D-, T3-Muster) rot auf `85aac7b` und grün danach, `test_mp4.py` weiterhin 143/143.

**STOP.** Keine Produktänderung, keine Umsetzung, kein P0-B-Beginn, kein Release durch dieses Review.

## Befundliste

| ID | Schwere | Status | Stelle | Befund | Reproduktion · Zähler | Minimalempfehlung | Regressionsanforderung | Herkunft |
|---|---|---|---|---|---|---|---|---|
| **B-1** | **P0** | **bestätigt** | `chrome/background.js:232–242, 301–303, 342`; Wirkung `src/040:514–517`, `src/170:220–222` | Globales SW-Gedächtnis gibt positiven `file`-Typ dokument- und sitzungsübergreifend zurück, ohne neue Prüfung | T2D: Tab 1 angemeldet → Probe `file`; Abmelden; neuer Tab, Adresse liefert jetzt HLS-Master mit MPD-bekannter Variante → **0 Proben, eigenes `src`, 5 native Master-, 2 native MPD-Variantenabrufe**; Kontrolle nach SW-Stopp: 1 Probe → `hls`, **0/0**. Cookie-Präsenz: Probe Tab 1 mit Sitzungs-Cookie, Tab 2 kein Abruf | Gedächtnis nur als **Versuchssperre**: bei Treffer höchstens `hls`/`dash` (verschärfend) zurückgeben, nie `file` an ein anderes Dokument; alternativ Schlüssel an `sender.documentId` binden. Positive Belege bleiben je Dokument im Inhaltsskript | Neuer Erweiterungsprüfer mit sitzungsabhängigem Server (T2D-Muster): 0 native Abrufe an MPD-Variante, kein eigenes `src`; zusätzlich Mutation „Gedächtnis gibt `file` zurück“ muss rot werden | **neu** (`addee1f`) |
| **B-2** | **P1** | **bestätigt** (Ausnutzung: Hypothese) | `chrome/background.js:298` (`from` = Frame-URL), `:252`; `src/040:498–503` | Angemeldete Probe im Drittkontext (iframe unter fremder Hauptseite) sendet `Lax`+`Strict`, die der Browser dem Frame verweigert; `Sec-Fetch-Site: none`, kein `Origin` | T3 HTTP: nativ `[]`, Probe `[lax, strict]`; HTTPS: nativ `[nonesec]`, Probe `[lax, nonesec, strict]`; je 1 Probe, dekodiert. T3P: bestehender `player-resolve`-Abruf ebenso | Probe nur im **Erstkontext**: Hauptdokument (`sender.tab.url`) gleiches Schema und gleiche Site wie Frame und Ziel; `sender.origin === 'null'` (Sandbox) ablehnen. `player-resolve` als eigener Auftrag | T3/T3P als Erweiterungsprüfer: Probe ohne Cookies, die das native Element nicht erhält | Klasse **früher vorhanden** (`player-resolve`), durch den Fix vor die Typentscheidung und auf CORS-lose Quellen **erweitert** |
| **B-3** | P2 | bestätigt (Komponente), E2E Hypothese | `src/170:158–160` | Zweckbindung vergleicht mit `srcOf(orig)` zum Entscheidungszeitpunkt – von der Seite steuerbar | X1: 120 Kandidaten, statisch **1**, Rotation **83** Hook-Aufrufe je Tipp (= je eine angemeldete GET-Anfrage für neue Adressen). Normales `<video src>` hat nur 1 Kandidaten (`src/060:452`) | Höchstens **eine** angemeldete Probe je Öffnen/Tipp; Original-URL beim Tipp festhalten (Schnappschuss) statt beim Probeergebnis zu vergleichen | X1 Rotation (Komponente) + E2E mit Mehrkandidaten-Seite: ≤ 1 angemeldeter Abruf je Tipp | neu |
| **B-4** | P2 | bestätigt | `chrome/background.js:229–232` (Kommentar), `typeProbeSeen` nur im Speicher | Versuchssperre endet mit dem SW (MV3 beendet untätige SW nach ≈ 30 s); Bericht §3 suggeriert 10 min über Neuladen/Tabs | T5: Tipp 1 → Neuladen 0 → SW-Stopp + Neuladen **1** angemeldete Abrufe in < 1 min | Sperre in `chrome.storage.session` (überlebt SW-Neustart, nicht den Browser), Schlüssel gehasht; oder Text präzisieren | T5 als Erweiterungsprüfer | neu (Aussage) |
| B-5 | P3 | bestätigt, ohne Verbraucher | `chrome/background.js:143–150, 332, 308–320` | Harter SW-Stopp in der Kopfphase hinterlässt Regel-80-Ausnahme bis zum Neustart | T4c: `excluded=['kadri-a.test']` ≥ 10 s nach Stopp; nach Neustart vor dem ersten Abruf zurückgesetzt, Abruf ohne Cookies | keine Pflicht; ggf. Kommentar/Prüfer, dass nur der SW OWN-Anfragen stellt | T4c | früher vorhanden |
| B-6 | P3 | bestätigt | `chrome/background.js:303, 342` | Negativgedächtnis (`unknown` nach 401/403/Timeout) sperrt 10 min für alle Tabs, auch nach Anmeldung | E11: kein Versuch beim Wiederöffnen | bei B-1-Umbau mitbedenken (Versuchssperre je Dokument oder kürzer für Fehler) | – | neu (Funktion) |
| B-7 | P3 | bestätigt | `background.js:264–282` | Range ignoriert: Server sendete 7 536 640 B, ausgewertet 4096 | E10 | dokumentieren; kein Netzlimit behaupten | – | neu (bekannt) |
| B-8 | Info | bestätigt | `src/180:663` + Probe | Login-Fall: zwei angemeldete Abrufe je Öffnen (Probe + `bytes=0-1`) | E1 | keine Umgestaltung ohne Auftrag | – | Probe neu, `bytes=0-1` vorbestehend |
| H-1 | – | Hypothese | `background.js:255–262` | `file` aus 4096-Byte-Präfix ist schwach (MPD/HLS hinter `free`-Box ≥ 600 B, diskriminierender Server) | x_classify 15/15 | – | – | vorbestehend |
| W-1…W-8 | – | widerlegt | – | Weiterleitungs-Folgeabrufe (T1), fremde Site/PSL/Schema/privat (E5/E8/E9, Brücke), gefälschte Hooks (E14), Port-Manipulation/Vertrag (Brücke), parallele Anfragen während der Ausnahme (T4a), Port-Abbruch (T4b), späte Antwort nach Navigation/Schließen (E13), `file` hebt restriktiven Beleg auf (E3/E4/K2/K3) | – | – | – | – |

## Anhang · Prüfumgebung und Reproduktion

**Umgebung:** Ubuntu 24.04.5 LTS (Linux 6.18, x86_64), Chrome for Testing **158.0.8127.36** (`/opt/pw-browsers/chromium`), Playwright 1.63.0
(Python 3.13), Node 22.23.5, OpenSSL 3.0.13, Xvfb (`xvfb-run -a`), Fenster headful mit `--load-extension`, `--disable-extensions-except`,
`--autoplay-policy=no-user-gesture-required`; für die Typprobe-Szenarien zusätzlich `--host-resolver-rules=MAP *.kadri-a.test 127.0.0.1, MAP *.kadri-b.test 127.0.0.1`,
`--ignore-certificate-errors` (selbstsigniertes Zertifikat, SAN `*.kadri-a.test`, `*.kadri-b.test`, `127.0.0.1`), `--no-proxy-server`.
Server: HTTP 8790 (`tests/common.py`), 8791 und HTTPS 8443 (`tests/auth_probe_servers.py` + Audit-Erweiterung), 18891/18892
(`tests/nocors_servers.py`, Komponente), Helfer-Kanal 127.0.0.1:47899 (Harness). Helper `6e553fc`, Desktop-Harness (kein APK).
SW-Stopp: CDP `ServiceWorker.stopAllWorkers` aus der Einstellungsseite, Zustand per `ServiceWorker.workerVersionUpdated` und
`Target.getTargets` bestätigt.

**Übertragbarkeit:** Selbstsignierte Zertifikate mit `--ignore-certificate-errors` und Host-Umleitung auf 127.0.0.1 ändern weder
Cookie-SameSite-Logik noch DNR; `127.0.0.1` als „Seite selbst“ nutzt aber die private Ausnahme (`allowExact`) – auf Android/Vivaldi mit
echten Hosts nicht dieselbe Bedingung. Drittanbieter-Cookie-Voreinstellungen, Inkognito-Modus („spanning“), SW-Leerlauf-Beendigung und
native HLS-Parser auf Android/Samsung sind **nicht geprüft**.

**Eigene Prüfprogramme** (nur im Scratchpad, nicht committet): `x_ext.py` (T1–T5, T2D, T3P; Erweiterung), `x1_rotation.py` (Komponente),
`x_classify.js` (Node), `mutate.py` (M1–M10), `buildtest.js` (Testfassung ohne ZIP/`dist/`). Aufruf je Erweiterungslauf:
`cd <worktree>/tests && KADRI_EXT=<testfassung> KADRI_CHROMIUM=/opt/pw-browsers/chromium HELPER_HOST_DIR=<harness> xvfb-run -a python3 -u <prüfer>.py`.
Die Beschreibung in den Abschnitten C–I genügt zur Wiederholung; Protokolle enthalten nur Cookie-**Namen**, Pfade lokaler Testserver und Zähler.

**Hinweis zur Reproduktion:** Ein erster M1-Lauf war ungültig, weil der Komponentenprüfer im unmutierten Worktree gestartet wurde
(liest `src/` relativ zur Prüferdatei); er wurde verworfen und im Mutations-Worktree wiederholt (Abschnitt I).

**Branch dieses Berichts:** `audit/p0a-auth-type-probe-review`, Parent `85aac7bfa4616a9945b7e9f507c2db2fbd0bea6c`, einzige Änderung
`docs/handoffs/INDEPENDENT-REVIEW-P0A-AUTH-TYPE-PROBE.md`. Der für diese Sitzung vorgesehene Branch `ccr-71bf2e8d-37kj5e` steht auf GitHub
bereits auf `main` (`cd00ded`); ein Bericht mit Parent `85aac7b` wäre dort nur per Force-Push oder Merge möglich gewesen – beides ist
ausgeschlossen bzw. würde Parent und „einzige Änderung“ verletzen. Daher der im Auftrag genannte Reviewbranch.
