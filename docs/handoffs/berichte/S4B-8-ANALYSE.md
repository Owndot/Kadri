# S4b-8 – Analyse: Annex I (UrlQueryInfo) vor der Implementierung

Stand 24.11.2026. Ausgangsstand: Kadri `72d5a46` (`test/s4b-dash`), Helfer Produkt `be157b2` / Tests `1ef214b` (`test/s4b5-dash`).

## 1. Quellen

| Quelle | Inhalt | Status |
|---|---|---|
| MPEG-Schema `DASH-MPD-UP.xsd` (MPEGGroup/DASHSchema, Zweig 5th-Ed) | Elemente und Attribute, Typen und Vorgaben | gelesen (`s4b8-ref/up.xsd`) |
| MPEG-Schema `DASH-MPD.xsd` (5th-Ed) | auf welchen Ebenen EssentialProperty/SupplementalProperty stehen dürfen | gelesen (`s4b8-ref/mpd.xsd`) |
| dash.js (DASH-IF-Referenzplayer), `ExtUrlQueryInfoController`, `Utils`, `HTTPLoader`, `ManifestLoader`; ausgeliefertes Paket 5.2.1 | tatsächliches Verhalten eines Referenzplayers | gelesen |
| ISO/IEC 23009-1 Annex I (Normtext) | normative Semantik | **nicht verfügbar**: kostenpflichtig, und dashif.org ist aus dieser Umgebung nicht auflösbar |

**Folge:** Wo der Normtext fehlt, wird nur umgesetzt, was Schema und Referenzplayer übereinstimmend und eindeutig festlegen. Alles andere wird kontrolliert abgelehnt.

## 2. Was der Standard festlegt

**Descriptor:**
- `EssentialProperty` oder `SupplementalProperty` mit `schemeIdUri="urn:mpeg:dash:urlparam:2014"`.
- Darin steht das Element `UrlQueryInfo` im Namensraum `urn:mpeg:dash:schema:urlparam:2014`.
- Erweiterte Formen haben eigene Schemata und Elemente:
  - `ExtUrlQueryInfo` und `ExtHttpHeaderInfo` mit `urn:mpeg:dash:urlparam:2016`;
  - dash.js kennt zusätzlich `urn:mpeg:dash:urlparam:2025` sowie das Präfix `urn:mpeg:dash:state:`.

**Ebenen (Schema 5th Ed.):**
- MPD: Essential und Supplemental.
- Period: **nur** Supplemental.
- AdaptationSet und Representation (RepresentationBase): Essential und Supplemental.

**Attribute von `UrlQueryInfo` (Schema):**

| Attribut | Typ | Vorgabe |
|---|---|---|
| `queryTemplate` | string | – |
| `useMPDUrlQuery` | boolean | false |
| `queryString` | string | – |
| `xlink:href` / `xlink:actuate` | – | Fernauflösung |
| beliebige Kindelemente und fremde Attribute | – | erlaubt (`xs:any`, `anyAttribute`) |

**Zusätzliche Attribute von `ExtUrlQueryInfo`:**

| Attribut | Vorgabe |
|---|---|
| `includeInRequests` | `segment` |
| `headerParamSource` | `segment` |
| `sameOriginOnly` | false |

**Verhalten von dash.js (Referenz, 5.2.1):**
- Je Ebene wird der erste passende Descriptor gewählt, Essential vor Supplemental. Auf Period-Ebene zählt nur Supplemental.
- Die Anfangs-Query wird über die Ebenen **aufgehängt**: Eltern-Query, dann `&queryString`, dann `&<MPD-Query>`, falls `useMPDUrlQuery="true"`. Bei Descriptoren auf mehreren Ebenen wird die MPD-Query mehrfach angehängt.
- `queryTemplate`:
  - nur `$querypart$` wird umgesetzt; der Quelltext sagt ausdrücklich, dass `$query:<param>$` fehlt;
  - jeder andere oder fehlende Wert ergibt eine **leere** Query.
- Die Query wird an **Init- und Mediensegmente** angehängt: `?` bzw. `&`, wenn die Adresse schon eine Query hat, nach der vorhandenen Query, ohne Duplikatentfernung. MPD- und Steering-Abrufe nur mit `ExtUrlQueryInfo@includeInRequests`.
- Die MPD-Query stammt aus `manifest.url`. Das ist die **endgültige Adresse nach Weiterleitungen** (XHR `responseURL`; Kommentar im Code: „as per RFC3986 Section 5.1.3“).
- **Kodierung:** dash.js zerlegt die Query (URLSearchParams) und setzt sie mit `encodeURIComponent` neu zusammen. Beispiele:
  - `sig=a/b` wird zu `sig=a%2Fb`;
  - `+` wird zu `%20`;
  - `flag` ohne Wert wird zu `flag=`.

  Das ist ein Artefakt der Implementierung, keine Annex-I-Regel.

## 3. Entscheidungen

**MPD-Anfrageadresse oder endgültige Adresse:**
- Es gilt die **endgültige Adresse nach Weiterleitungen**. Das ist dieselbe Adresse, gegen die Kadri und der Helfer schon heute alle relativen MPD-Adressen auflösen (RFC 3986 5.1.3, „retrieval URI“). Die Referenz verwendet ebenfalls diese.
- Kadri kennt sie aus `response.url` bzw. `xhr.responseURL` und schickt sie dem Helfer als `url`.
- Der Helfer lädt genau diese Adresse. Leitet sie erneut weiter, gilt dort wieder das endgültige Ziel.
- Weicht die Query dadurch von Kadris Stand ab, weicht der Fingerabdruck ab: `manifest_mismatch` bzw. `plan_changed`.

**Unterstützt (Minimalform, auf beiden Seiten gleich):**

| Merkmal | Festlegung |
|---|---|
| Descriptor | genau `urn:mpeg:dash:urlparam:2014` als Essential oder Supplemental (Period nur Supplemental); `@value` fehlt; genau **ein** Kind `UrlQueryInfo` (2014-Namensraum), sonst nichts |
| `UrlQueryInfo` | `queryTemplate="$querypart$"` **und** `useMPDUrlQuery="true"` (bzw. `1`); keine weiteren Attribute (auch keine fremden), keine Kindelemente |
| Wirkung | an jedes Init- und Mediensegment der betroffenen Darstellungen wird die Query der endgültigen MPD-Adresse **unverändert** angehängt (`?` bzw. `&`, nach der vorhandenen Query) |
| Identität | keine Umkodierung, Sortierung oder Duplikatentfernung; die Query gehört zur Identität der Adresse |
| ohne Query | hat die MPD-Adresse keine Query, wird nichts angehängt |
| Gültigkeit | höchstens **ein** Descriptor entlang der Kette MPD → Period → AdaptationSet → Representation; er gilt für alle Darstellungen unter seinem Element |

**Kontrolliert abgelehnt (fatal für das ganze MPD, fester Grund):**

| Fall | Grund |
|---|---|
| 2016/2025, `urn:mpeg:dash:state:*`, `ExtUrlQueryInfo`, `ExtHttpHeaderInfo` | `urlparam-unsupported` |
| `queryString`, `useMPDUrlQuery` fehlt/false/ungültig, `@value`, fremde Attribute, Kindelemente | `urlparam-unsupported` |
| Descriptor ohne `UrlQueryInfo` oder mit mehreren Kindern | `urlparam-unsupported` |
| Period-EssentialProperty (nicht schemakonform) | `urlparam-unsupported` |
| Descriptor an anderer Stelle (SubRepresentation, ContentComponent …) | `urlparam-unsupported` |
| `queryTemplate` fehlt oder ist nicht genau `$querypart$` (`$query:x$`, `$header:…$`, freier Text) | `urlparam-template` |
| zwei Descriptoren an einem Element oder entlang einer Kette (bei dash.js doppelte Anhängung; nicht eindeutig) | `urlparam-conflict` |
| mehr als 16 Descriptoren, MPD-Query über 2048 Zeichen oder mit mehr als 64 Parametern | `urlparam-limits` |
| MPD-Query mit Steuer- oder Sonderzeichen, die die beiden URL-Normen verschieden behandeln, oder `%` ohne zwei Hex-Ziffern | `urlparam-query` |

Eine Adresse, die mit Query zu lang wird, schließt die Darstellung aus (`uri-length`, wie bisher).

**Unverändert:**
- MPD-Query ohne Descriptor wird **nie** übernommen; d4 bleibt abgelehnt.
- `BaseSelection` und `dashplan` v2.
- Netzregeln, keine Cookies/Authorization, ContentProtection/DRM.

**Protokoll:**
- Die Nachrichtenform bleibt gleich.
- Die neue Semantik wird als Fähigkeit `dashdl.urlq=1` gemeldet. Kadri bietet ein MPD mit wirksamem Descriptor nur Helfern mit dieser Fähigkeit an, sonst E4 `no-urlq`.
- Ein älterer Helfer würde die Query nicht anhängen. Der Fingerabdruck (Adressen mit Query) schützt zusätzlich: `manifest_mismatch`.

**Fingerabdruck:**
- Die angehängte Query ist Teil der aufgelösten Adressen (`r.media`, `r.init`, `r.SegmentURL`).
- Abdrücke von MPDs ohne Descriptor bleiben byte-gleich.

## 4. Bekannte Grenzen (vorab)

- **Re-Kodierung von dash.js:** Bildet ein Player die Query anders als unverändert (dash.js bei `/`, `:`, `+`, `,`, `@`, `$`, `;`, `=` im Wert, Parametern ohne `=`), passen die beobachteten Adressen nicht. Ergebnis: keine Bindung, sicher.
- **Rotierende Tokens in der Weiterleitung** der endgültigen MPD-Adresse ergeben `manifest_mismatch`/`plan_changed`, sicher.
- **Nicht umgesetzt:** `$query:<param>$`, `queryString`, Header-Quellen, `includeInRequests`, `sameOriginOnly`, xlink-Fernauflösung.
