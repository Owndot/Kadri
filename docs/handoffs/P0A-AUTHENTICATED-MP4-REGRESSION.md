# P0-A · Authentifizierte MP4 anderer Herkunft – Regressionsbefund und Sicherheitsentscheidung

**Ergebnis: STOP. Kein Produktfix.** Unter den geltenden Grenzen gibt es keinen positiven MP4-Beleg für eine authentifizierte Quelle anderer Herkunft, der ohne zusätzlichen angemeldeten Abruf auskommt. Technisch möglich ist er nur mit einem zusätzlichen angemeldeten Abruf derselben Site über die bestehende Anfragebrücke. Das ändert den Credential-Mechanismus und wird hier **zur Freigabe vorgelegt, nicht umgesetzt** (Abschnitt 7). `tests/test_mp4.py` bleibt unverändert und damit am Korrekturstand rot. Weder Test noch Assertions sind abgeschwächt. Es gibt keine Selbstfreigabe von P0-A.

## 1. Stand, Branch, Vergleich

| | SHA |
|---|---|
| Produkt-/Teststand (unverändert) | `6011d747dda9d9d027ce09120ece28c6894c45ef` |
| Übergabe der Vorrunde | `d692957253b40c4230e118857a7a7150abbdca90` (`fix/p0a-type-evidence-hardening`) |
| Vergleichsbasis | `a7ac09d1e1d6ad0e788533af6971aa0e18900271` |
| Frühere unabhängige Prüfung | `3ecee721396e30361b95cfa897ad5c0ff4b34fc6` (`CLAUDE-INDEPENDENT-REVIEW-SOURCE-TYPE.md`) |
| Dieser Branch | `docs/p0a-authenticated-mp4-regression`, Parent `6011d74`, nur Dokumentation und ein Befundprüfer |

Helper `6e553fcb82b437ce0be487233dd35f41958bade6`. Produktcode und alle bestehenden Tests sind unverändert. Neu sind nur `tests/test_p0a_auth_mp4_evidence.py` (Diagnose, misst nur) und dieser Bericht.

Bauten: die ungepackte Testfassung (`write(dir,'chrome',true)`) von `a7ac09d` und von `6011d74`, dazu der echte Kanal-Helfer (Desktop-Harness aus `6e553fc`), Chrome for Testing 158.0.8127.36 unter Xvfb und ein echter Service Worker.

## 2. Ursache des Login-Falls

`tests/test_mp4.py`, Abschnitt „Seite verlangt Anmeldung (Cookie der Seite): kontrollierter Fehler, kein anderer Weg“: Seite `127.0.0.1:8790/mp4.html?login=1` setzt `sess` per `document.cookie`, ohne SameSite-Angabe, also Lax. Die MP4 liegt auf `127.0.0.1:8791`, einer **anderen Herkunft derselben Site**. Ohne `sess` antwortet der Server mit 403, sonst mit 206/200 und `Access-Control-Allow-Origin: *`.

Der Test verlangt: Der eigene Player spielt, der Tipp auf „Mit Helper herunterladen“ führt zum kontrollierten Fehler „Server verlangt Anmeldung“, der Helper erhält weder Cookie noch Authorization noch Referer, es gibt keinen anderen Weg, und die Wiedergabe läuft unverändert weiter.

Ablauf am Korrekturstand:
1. Das Original lädt nativ (`no-cors`) **mit** Cookie: 206.
2. Kadris Typprobe (`src/040 mediaProbe`, `credentials: 'same-origin'`) sendet zu einer anderen Herkunft **kein** Cookie und erhält 403. Ergebnis `''`, also kein Dateibeleg.
3. Seit P0-1 (`46fdaae`) gibt `claimed-file` nichts mehr frei: `tryNext` lädt nicht nativ. `useCapture` scheitert (`captureStream` → `SecurityError`), und der Player schließt mit „Dieses Video lässt sich hier nicht im eigenen Player zeigen“.
4. `open_player` in `test_mp4.py` wartet vergeblich 25 s auf `.vv`, und der Test bricht vor den sechs Prüfungen des Abschnitts ab.

| `tests/test_mp4.py` (unverändert) | Ergebnis |
|---|---|
| Bau `a7ac09d` | **143/143** |
| Bau `6011d74` | **Abbruch** im Anmeldefall: 53 bestandene Prüfungen, dann Timeout in `open_player` (`test_mp4.py:307`), Exitcode 1 – kein grüner Lauf (in dieser Runde erneut gemessen) |

## 3. Gemessene Requestklassen (Befundprüfer, Server 127.0.0.1:8791)

Je Anfrage protokolliert der Prüfer nur Range, `Sec-Fetch-Dest`/`-Mode`, die **Namen** der Cookies (nie Werte), Authorization/Referer ja/nein, Absender (Browser/Helper) und Status.

| Fenster | Bau `a7ac09d` | Bau `6011d74` |
|---|---|---|
| Original vor dem Tipp | `bytes=0-` video/no-cors, **Cookie**, 206 | identisch |
| Nach dem Tipp | Probe `0-4095` cors ohne Cookie **403**; **`prefetchExt` → `finalUrl` `bytes=0-1` über die Brücke mit Cookie 206** | Probe `0-4095` cors ohne Cookie **403**; kein weiterer Abruf |
| Eigener Player | startet (nativ, Original von Kadri angehalten) | startet nicht, Hinweis, **Original läuft weiter** |
| Zusätzlicher Cookie tragender Kadri-Abruf | **ja** (der bestehende 2-Byte-Abruf zur Weiterleitungsauflösung) | **nein** |
| Helper-Download | über das Player-Menü: 1 Abruf ohne Cookie/Authorization/Referer, 403, Hinweis „Server verlangt Anmeldung – direkter Download nicht möglich“ | über ⬇ an der Seite (D): 1 Abruf ohne Cookie/Authorization/Referer, 403, Auftrag `failed` mit demselben Text |
| Browser-Download / anderer Weg | keiner | keiner |

Befundprüfer: Bau `6011d74` 10/10, Bau `a7ac09d` 9/10. Die eine Abweichung auf `a7ac09d` ist gerade der dort vorhandene angemeldete `bytes=0-1`-Abruf.

## 4. Alternativen A–D

### A. Vorhandene positive Evidenz ohne neuen Abruf – widerlegt (unter den Randbedingungen nicht verfügbar)

| Weg | Messung / Grund |
|---|---|
| Bytes des Originals über `captureStream` | `SecurityError` am fremdherkunftigen Original ohne `crossorigin` (gemessen) |
| Resource Timing | ein Eintrag `initiatorType: video`, `transferSize`/`encodedBodySize` 0, kein `contentType` (ohne Timing-Allow-Origin), also kein Inhalt (gemessen) |
| Content-Type der Antwort | kein Beleg: Ein HLS-Master mit `Content-Type: video/mp4` unter `.mp4` ohne CORS wird von Chromium nativ abgespielt; Chromium lädt die Variante (2 Masterabrufe, 1 Variantenabruf, gemessen) |
| Antwortköpfe/-inhalte der Seitenabrufe | Chrome-Manifest ohne `webRequest`, nur `declarativeNetRequestWithHostAccess`; kein Lesezugriff (keine neue Interzeption, wie verlangt) |
| Bestehender angemeldeter Abruf (`prefetchExt`/`finalUrl`, `kadriPurpose: 'player-resolve'`) | läuft erst **nach** dem eigenen nativen Laden, liest nur 2 Bytes (`ftyp` steht in Byte 4–7, `#EXTM3U` braucht 7), dient der Weiterleitungsauflösung für „In App öffnen“ und findet am Korrekturstand nicht statt |
| `videoWidth`, laufende native Wiedergabe, Endung | kein Beleg (laut Auftrag; getarntes HLS spielt ebenfalls) |

### B. Bestehende Hintergrundfähigkeit – technisch möglich, aber nur mit angemeldetem Zusatzabruf (nicht freigegeben)

Gemessen über die bestehende Brücke (`GM_xmlhttpRequest` → Port `kadri-xhr` → `fetch` im Service Worker; im Test-Bau von der Seite aus erreichbar) sowie mit Roh-`fetch` im Service Worker:

| Fall | Ergebnis |
|---|---|
| B1 Roh-`fetch` im Service Worker an `127.0.0.1` | blockiert (Regel 51 Privatnetz), kein Serverkontakt |
| B1 Roh-`fetch` `credentials: 'include'` an `cdn.kadri-a.test` | **Cookies entfernt** (Regel 80), 403 |
| B2 Brücke, gleiche Site (IP, anderer Port), `Range 0-4095` | **mit `sess`**, 206, `ftyp` lesbar |
| B2 Brücke anonym | ohne Cookie, 403 |
| B3 Brücke Subdomain gleiche Site (`www.` → `cdn.kadri-a.test`) | Lax- **und** Strict-Cookie mitgesendet (Erweiterungsanfrage gilt als same-site), 206, `ftyp` |
| B3 Brücke andere Site | `anonymous` (Guard), ohne Cookie, 403 |
| B3 gleiche Site → 302 → andere Site | 1. Schritt mit Cookies (302), 2. Schritt **ohne** Cookie (Regel 80 nach Weiterleitung), 403 |
| (b) `fetch` `credentials: 'include'` im Seitenkontext (CORS wie Inhaltsskripte in MV3) | Server erhält **Cookie** und antwortet 206, Antwort aber **nicht lesbar** (`Access-Control-Allow-Origin: *` mit Credentials) → ein angemeldeter Abruf ohne Nutzen |
| Natives `<video>` der Seite zur Subdomain (Vergleich) | Lax und Strict mitgesendet |

Das bedeutet: Mit den vorhandenen Regeln (Guard, `credSites`, Regel 80, Privatnetzsperren) erreicht ein Brückenabruf **für dieselbe Site** denselben Sitzungskontext wie die Seite und liefert lesbare Bytes. Für eine andere Site sendet er nie Cookies. Die Brücke ist heute für Untertitel, „Laden über den Browser“ (Helper-Pull), Diagnose und die 2-Byte-Weiterleitungsauflösung freigegeben, **nicht für Typproben**. Ihr Einsatz vor der Typentscheidung wäre ein zusätzlicher angemeldeter GET je Quelle. Nach den Grenzen des Auftrags: **nicht implementiert**.

Drittanbieter-Cookies: Bei Brückenabrufen zu einer anderen Site entfernt Kadri die Cookies ohnehin (`anonymous` bzw. Regel 80). SameSite=None ließ sich über http nicht prüfen (verlangt `Secure`/TLS): **nicht geprüft**.

### C. Daten- und Authentifizierungsgrenzen

| Grenze | Korrekturstand (gemessen/abgeleitet) | Mit Option 1 (Abschnitt 7) |
|---|---|---|
| Gleiche Herkunft | Probe sendet Cookie (`same-origin`), positiver Beleg möglich – Review F5; in dieser Runde nicht neu gemessen | unverändert |
| Andere Herkunft, gleiche Site (Port, Subdomain) | kein Cookie, 403, Funktionsverlust (gemessen) | Cookie über die Brücke, 206, lesbar (gemessen B2/B3) |
| Andere Site | kein Cookie (gemessen) | weiterhin kein Cookie, Funktionsverlust bleibt |
| PSL-Grenzen | `baseDomain` über `vendor/psl.js`; `alice.eu.org` ≠ `bob.eu.org` (`ff_net_check.js`) | unverändert |
| Cross-Origin-Redirect | – | Regel 80 entfernt Cookies im Folgeschritt (gemessen B3) |
| HTTPS → HTTP | nicht geprüft (kein TLS im Prüfstand); `Secure`-Cookies gehen nicht über http, `mediaReferrer` lässt den Referer weg | nicht geprüft |
| Private/lokale Ziele | Roh-Abruf blockiert (gemessen); Brücke nur, wenn die Seite selbst dort liegt (`allowExact`) | unverändert |
| Signierte/Einmal-URLs | Probe verbraucht sie ohne Sitzung (`test_p2_probe_effects.py`) | würde sie **mit Sitzung** verbrauchen |
| 401/403 | `''`, keine Freigabe (gemessen) | Brückenprobe 401/403 → `''` |
| Range ignoriert (200, ganze Datei) | Probe liest höchstens 4096 Bytes, die Übertragung kann trotzdem laufen | Brücke liest für `arraybuffer` den **ganzen** Körper → braucht eine Bytegrenze im Hintergrund (Änderung an `chrome/background.js`) |
| Cache | Probecache 256 je Dokument, `''` 30 s | Brücke `cache: 'no-store'` |
| Zeitgrenze | 10 s (`PROBE_TIMEOUT_MS`) | Brücke: Aufrufer-Timeout, Kopfphase 15 s, Warteschlange 60 s |
| Parallele Abrufe | – | Kopfphase serialisiert (`headerGate`), `credSites` gilt nur in der Kopfphase |
| Wechsel der Medien-Epoche | Ergebnis an Player, `sourceRevision` und Quelle gebunden | unverändert anwendbar |
| Helper | nie Cookie/Authorization/Referer (gemessen auf beiden Bauten) | unverändert |
| Adressen in Logs/UI | keine | keine |

### D. Original weiterlaufen lassen – am Korrekturstand vorhanden, erfüllt `test_mp4.py` nicht

Gemessen am Korrekturstand: Kadri startet weder `vid.src` noch Play oder Seek am Original. Das Original läuft ununterbrochen weiter (Ereignisprotokoll: kein `pause`, kein `seeking`), und Kadri zeigt einen Hinweis. Über ⬇ an der Seite läuft der Helper-Download kontrolliert: 1 Abruf ohne Cookie, Authorization und Referer, 403, Auftrag `failed` mit „Server verlangt Anmeldung – direkter Download nicht möglich“. Es gibt keinen Browser-Download.

Lücke in der Bedienung: Auf diesem Weg erscheint der Fehler nicht als Toast in der Seite (nur „Helfer-App lädt …“). Er steht im Auftragsstatus bzw. in der Benachrichtigung.

**D ist kein Ersatz für 143/143.** Der unveränderte Test verlangt den eigenen Player.

## 5. Öffentliche MP4 ohne CORS (CORS-Funktionsverlust ≠ Sicherheitsnachweis)

Gemessen am Fall `127.0.0.1:8791/videos/pubnc.mp4` ohne `Access-Control-Allow-Origin` (gleiche Site):

| Bau | Probe | Eigener Player |
|---|---|---|
| `a7ac09d` | 206, unlesbar (CORS) | startet nativ, zusätzlich der angemeldete 2-Byte-Abruf |
| `6011d74` | 206, unlesbar (CORS) | startet nicht, Original läuft weiter |

Die Brücke liest dieselbe Datei auch **anonym** (`ftyp`, 206), weil der Service Worker mit Hostberechtigung kein CORS braucht. Dieser Fall wird also durch CORS blockiert, nicht durch eine Sicherheitsprüfung. Auch fremde MP4 ohne CORS (`test_p0a_nocors_type.py`, Funktionsverlust) sind kein Nachweis von Sicherheit.

## 6. Unverändert erhaltene Sicherheitsnachweise

Es wurde kein Produktcode geändert. Die Ergebnisse der Vorrunde gelten am identischen Baum `6011d74` (Übergabe `d692957`, Abschnitt 13):
- 29 Chromium-Komponentenprogramme 572/572: null Kind-Abrufe beim getarnten `.mp4`-HLS ohne CORS (`?token`, Redirect, Wiederöffnen), Verdrängung, 2048-Grenze, Filterüberlauf, Probecache, Probe-DASH, Vorschau, positive MP4/HLS/Qualität/Capture.
- 31/31 Node-Programme, DASH-Dispatcher 104/104.
- Erweiterung: `test_p0a_nocors_extension.py` 2/2; basic/HLS/frame_ui/direct_dl/dash_bind/helper grün.
- Offene Altbefunde, unverändert und nicht als PASS gewertet: `test_dash_msg.py` 20/23 (dieselben drei Fälle wie in Runde 3) und `test_dash_dl.py` (SyntaxError im Prüfer vor den Assertions).

## 7. Zur Freigabe vorgelegte Optionen (nicht implementiert)

**Option 1 – Angemeldete Typprobe derselben Site über die bestehende Brücke (minimal, löst `test_mp4.py`).**
- **Auslöser:** nur wenn die eigene unangemeldete Probe keinen Beleg liefert (401/403/unlesbar) **und** die Quelle zur Site des Fensters gehört (`baseDomain` gleich, dieselbe Regel wie `needsResolve`/`credSites`).
- **Abruf:** über `GM_xmlhttpRequest` mit eigenem Zweck, `Range: bytes=0-4095`, Zeitgrenze 10 s. Ausgewertet wird nur `mediaProbeType`; das Ergebnis ist ausschließlich ein Typ und wird nie weitergegeben. Das Probe-Ergebnis wird an Player, Revision und Quelle gebunden wie heute.
- **Sperren:** Andere Sites bleiben anonym und ohne Freigabe.
- **Netzwerkwirkung:** +1 angemeldeter GET je unbelegter Quelle derselben Site und Dokument (Cache). Auf `a7ac09d` gab es für denselben Ablauf ebenfalls genau einen angemeldeten Abruf (2 Byte, nach dem Laden). Die Sitzung erreicht nur dieselbe Site (gemessen B2/B3). Weiterleitungen zu anderen Sites verlieren die Cookies (Regel 80, gemessen). Einmaladressen werden **mit Sitzung** verbraucht.
- **Nötige Änderungen:**
  - `src/040` und `src/170` (Probepfad).
  - Bytegrenze für Brückenantworten. Ohne sie liest der Hintergrund bei ignorierter Range den ganzen Körper. Das ist eine kleine Änderung an `chrome/background.js` und braucht deshalb **gesonderte Freigabe**, oder man nimmt das Risiko der ganzen Übertragung ausdrücklich in Kauf.
- **Restrisiko:** Der Server kann der Probe (`Sec-Fetch-Dest: empty`) andere Bytes liefern als dem nativen Player (`video`). Das gilt schon heute für die unangemeldete Probe.
- **Abnahme:**
  - `test_mp4.py` 143/143 ohne Änderung.
  - Befundprüfer erweitert: genau ein angemeldeter Probe-Abruf, nur dieselbe Site, Redirect auf eine andere Site ohne Cookie, Helper ohne Cookie, getarntes HLS derselben Site mit Cookie → `hls` → 0 Kind-Abrufe, Einmaladresse, Range ignoriert mit Bytegrenze.
  - Volle Regression.

**Option 2 – Anonyme Hintergrundprobe** (Vorschlag der Review, `credentials: 'omit'`): Sie hilft öffentlichen MP4 ohne CORS (gemessen lesbar), **nicht** dem Login-Fall (403 gemessen). Sie berührt `chrome/background.js` und braucht eigene Freigabe.

**Option 3 – Funktionsverlust annehmen (D).** Kein zusätzlicher Abruf. `test_mp4.py` bleibt rot; eine Anpassung des Tests ist laut Auftrag verboten und müsste als eigene Entscheidung getroffen werden. Optional ohne Netzwirkung: den Fehler des Seiten-Downloads als Toast sichtbar machen (eigener Auftrag).

## 8. Offene Prüfungen

- Nicht geprüft: Android-App/Intent, Samsung/Vivaldi-Geräte, Firefox-DOM, HTTPS-Fälle und SameSite=None (kein TLS im Prüfstand), DASH-E2E (`test_dash_msg.py` 20/23, `test_dash_dl.py` Abbruch).
- Grenzen unverändert: `main`, Helper, `channel/`, Signierung, Pins, Berechtigungen, DNR-Regeln, Cookie-/Authorization-Politik, `dashplan`/`dashstart`, `vendor/hls.min.js`, Releaseworkflows. Kein APK/ZIP/Release; `tools/sync-src.sh` nicht ausgeführt. P0-B, P0-C und EssentialProperty bleiben gesperrt.

**STOP.** Die Entscheidung über Option 1, 2 oder 3 liegt bei Ihnen.
