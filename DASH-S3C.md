# DASH S3c – Kadri: DASH-Streams über die Helfer-App speichern

**Stand:** S3c auf `b4a8289` (DASH-Diagnose Stufe 1). Gegenstelle ist der Helfer mit S3b-Fix 2 (`ee54864`).

- Der Helfer-Produktcode ist unverändert.
- Für die Ende-zu-Ende-Tests ist nur der Desktop-Testharness des Helfers um `dash on` erweitert. Das ist reiner Testcode und als eigener Patch geliefert: `helper-dash-s3c-harness.patch`.
- Es gibt keine Samsung-APK und keine Extension-Testlieferung.

## 1. Ablauf

1. **Bindung (unverändert aus S2):** Ein gelesenes MPD gilt nur dann als an genau dieses Video gebunden, wenn seine Stücke nachweislich in Folge geladen wurden.
   - Grundlage ist `dashBindDecision`: mindestens 3 aufeinanderfolgende Stücke einer Darstellung, kürzlich und zusammenhängend.
   - Dann entsteht in der Registry die Beobachtung `bound` mit dem Beleg `dash-segments`.
   - Endung, zeitliche Nähe, Seitendaten oder ein MPD am Element binden DASH nie.
2. **Auswahl (`selectDashStreams`, src/045):**
   - nur ein MPD mit `bound` und `dash-segments`;
   - Schutz ist nicht bekannt (`drm`/`encrypted` → nicht angeboten);
   - Rolle `manifest`.
   - Sind mehrere MPDs zugleich gebunden, gilt das als nicht eindeutig zuordenbar: kein Angebot.
3. **Vorprüfung am gelesenen Text (src/039):** Fingerabdruck `kadri-dash-fp/1` und S3-Profil, soweit ohne Stückfolge entscheidbar:
   - `static`, genau eine Periode;
   - kein `ContentProtection` irgendwo;
   - Dauer bekannt und höchstens 48 h;
   - Video `video/mp4` mit `avc1`/`avc3` (sechs Hex-Ziffern);
   - Ton `audio/mp4` mit genau `mp4a.40.2` (AAC-LC);
   - Ton ist Pflicht;
   - Adressierung SegmentTemplate oder SegmentList ohne Byte-Bereiche.
4. **Fähigkeit:** Der Helfer meldet `"dashdl":{"v":1,"profiles":["fmp4-avc-aac"],"fp":"kadri-dash-fp/1"}`. Ohne diese Meldung, etwa bei älteren Helfern, gibt es kein Angebot.
5. **Angebot:** „DASH-Stream mit Helper herunterladen …“ im Download-Sheet des schwebenden Knopfs (src/105) und im Download-Menü des eigenen Players (src/180).
   - Nichts wird beim Öffnen des Menüs angefragt.
6. **Tipp → `dashplan`** über den bestehenden verschlüsselten Kanal. Übertragen werden:
   - die finale MPD-Adresse;
   - Kadris Fingerabdruck;
   - die Bindung `{player, gen, rev}`;
   - der Hinweis `played` (Nummern der Darstellungen mit beobachteten Stücken, höchstens 8);
   - bei Helfern mit `dashdl.ctx` der Anfragekontext wie bei HLS (Herkunft der Seite als Referer, User-Agent).

   Der Helfer lädt das MPD selbst, berechnet den Abdruck, lehnt jede Abweichung ab (`manifest_mismatch`), prüft das Profil und antwortet mit Optionen ohne Adressen.
7. **Auswahl im Sheet:** Kadri ordnet jede Option seinem eigenen Modell zu. Höhe, Breite, Sprache und die Summe der Bandbreiten (Video + Ton) müssen genau ein Paar ergeben, sonst entfällt die Option als nicht eindeutig zuordenbar.
   - Der Ton ist immer benannt: Sprache bzw. „Tonspur n (Sprache nicht angegeben)“.
   - Die gerade gespielte Kombination steht oben und ist als „läuft gerade“ markiert.
   - Es gibt keine stillschweigende Wahl einer Tonspur.
8. **Tipp → `dashstart`** mit Kennung, Plan, Option, Bindung und Name. Status, Abbruch und Liste laufen über die bestehende Download-Verwaltung (`dlstatus`/`dlcancel`, Art `dash`).

## 2. Fingerabdruck `kadri-dash-fp/1` in JavaScript (src/039)

Der Port folgt dem Helper:

| Teil im Helper | Port in src/039 |
|---|---|
| `DashXml` | gehärtetes Lesen aus dem DOMParser-Baum: nur MPD-Namensraum; jedes `<!` außer Kommentar/CDATA abgelehnt; XInclude und XLink abgelehnt; DASH-Namen in fremdem Namensraum abgelehnt; dieselben Grenzen |
| `DashNum` | ganze Zahlen ≤ 2^53−1; `xs:duration` exakt über BigInt |
| `DashUrl`/`HlsUri` | RFC-3986-Auflösung und kanonische Form; fail-closed bei allem, was WHATWG anders deuten würde |
| `DashTemplate` | Vorlagen |
| `DashManifest` | Vererbung, BaseURL-Kette, Adressierung, nur soweit für den Abdruck nötig |
| `DashFingerprint` | kanonischer Text |

Weitere Eigenschaften:
- **SHA-256:** eigene, fortlaufende Implementierung. Sie arbeitet synchron und auch in nicht sicheren Kontexten, in denen `crypto.subtle` fehlt.
- **Rechengrenze:** höchstens 2 Mio. Zeilen. Geerbte Listen erscheinen je Darstellung erneut; darüber gibt es keinen Abdruck.
- **Belege:**
  - Alle 24 Golden-Vektoren des Helpers werden exakt reproduziert, ebenso der festgeschriebene kanonische Text.
  - Querprüfung an 58 Grenzfall-MPDs × 2 Dokumentadressen (`tests/web/dash/fp/x`, Erzeuger `tools/dash-fp-variants.py`). Die Werte und die Ablehnungen berechnet der Helper selbst (`fp-v1-crosscheck.tsv`).
  - Ergebnis: 74 identische Abdrücke, und 42 vom Helper abgelehnte Fälle ergeben auch hier keinen Abdruck.
- **Verwendung:** Der Abdruck entsteht beim Lesen des MPD (src/040, `notePlaylist`) gegen dessen finale Adresse. Er bleibt privat im Fenster und gelangt nie in Registry, Diagnose oder Speicher.
- **Keine Bindungsevidenz:** Der Abdruck ist nur die Konsistenzprüfung „gleiches MPD bei Kadri und beim Helfer“.

## 3. Korrekturen am Erkennungsindex (src/038)

- **`$Bandwidth%0Nd$`:** Das Format wurde vorher ignoriert; `b$Bandwidth%08d$` erzeugte `b64000` statt `b00064000`. Jetzt löst ein gemeinsamer Durchgang `dashTplExpand` die Vorlage wie der Helper auf:
  - `$$`, `$RepresentationID$` (ohne Format, nur unschädliche Zeichen), `$Bandwidth[%0Nd]$`, genau ein `$Number$`/`$Time$`;
  - unbekannte Platzhalter → keine Muster.
- **Feste Marke `KADRIIDXTOKEN9Q`:**

  | Fall | Folge vorher |
  |---|---|
  | Marke in der Darstellungs-ID oder in der Adresse | Marke kam zweimal vor, Darstellung nicht prüfbar |
  | Marke im Host | Klein geschrieben, nicht mehr gefunden |

  Das ergab nie eine falsche Bindung, aber eine verlorene. Ersetzt ist sie wie im Helper durch eine Marke aus Ziffern: „8“ + (längste 9er-Folge in Vorlage/Werten/Basis + 1) × „9“ + „8“. Sie kann nirgends sonst vorkommen, und die Auflösung ändert keine Ziffern. Eine Marke im Host wird abgelehnt.
- **Exakte Schreibweise der Stücknummer:** `%05d` passt nur auf `00012` (bzw. auf ≥ 5 Stellen ohne führende Null); ohne Format nur ohne führende Nullen. Werte gehen bis 2^53−1. `seg-7` ist nicht das Stück `seg-00007`.
- **Darstellungsnummer:** Sie zählt in Dokumentreihenfolge über alle Darstellungen, wie beim Helper. Darauf beruht `played`.

## 4. Protokoll, Status, Fehlercodes

```
→ {"op":"dashplan","v":1,"url":"…","fp":"<64 hex>","bind":{"player","gen","rev"}[,"played":"1,2"][,"ref":"…"][,"ua":"…"]}
→ {"op":"dashstart","v":1,"id":"<32 hex>","planId":"<32 hex>","option":"<24 hex>","bind":{…}[,"name":"…"]}
```

**Befehlsform (channel-session.js):** Jede andere Form verlässt den Browser nicht: zusätzliche Felder, Cookies, Header, ungültiges `fp`/`played`, eine Adresse in `dashstart`. Dieselben Regeln prüft die Route im Hintergrund (channel-service.js): nur aus Kadris Inhaltsskript in einem Tab.

**Zeitverhalten:**
- `dashplan` ist wie `hlsplan` nach „Sitzung unbekannt“ wiederholbar und hat dasselbe feste Zeitprofil (25 s).
- `dashstart` wird nie automatisch wiederholt. Die Download-Verwaltung sendet höchstens mit derselben Kennung erneut, wie bei HLS.

**Planablauf:** Die Antwort `plan_stale` kommt bei abgelaufenen 10 min, einer neuen Kanal-Sitzung oder einem Neustart des Helfers. Dann folgt genau einmal ein neuer Plan mit gleichem Fingerabdruck und gleichem `played`, und dieselbe Auswahl startet mit derselben Kennung. Ist die Auswahl im neuen Plan nicht eindeutig, endet das mit `plan_changed`, ohne Start.

**Strenge Planantwort:**
- `fp` muss `kadri-dash-fp/1` sein.
- Optionen nur mit `avc1/avc3` + `mp4a.40.2`, andere entfallen.
- Keine speicherbare Option → Protokollfehler.

**Status:**
- Art `dash`; die Art eines Auftrags wechselt nie.
- Fortschritt in Teilen und MB, danach die Phase.
- Fehlerort nur aus `mpd`, `video_init`, `audio_init`, `video_segment`, `audio_segment` mit Index.
- Kadris Speicher enthält keine Adresse und keinen Fingerabdruck, sondern nur einen gesalzenen Schlüssel.

**Feste Texte** u. a. für `manifest_mismatch`, `dash_no_audio`, `media_duration`, `segment_timing`, `codec_mismatch`, `remux_io`, `encrypted`, `audio_codec`, Profilgründe `dash_*` und `verify_*`.

## 5. Kein Angebot (bewusst)

Es gibt kein Angebot bei:
- ungebundenen Quellen (nur zeitlich vermutet, Stücke nicht beobachtet);
- mehreren gebundenen MPDs oder mehreren MPDs, die dieselben Stücke beschreiben (`konkurrenz`);
- geschützten Quellen (jedes `ContentProtection`);
- HE-AAC/HE-AACv2, VP9/AV1/HEVC, WebM, gemischtem Bild/Ton, Live, mehreren Perioden, SegmentBase/Byte-Bereichen, unbekannter Dauer;
- Helfern ohne `dashdl`;
- Optionen, die Kadri nicht eindeutig zuordnen kann.

Ist das MPD gebunden, aber nicht speicherbar, zeigt der Hinweis „DASH-Stream erkannt – derzeit nicht unterstützt“ den festen Grund in der Unterzeile.

## 6. Nicht unterstützte Player (neutral)

Kadri bietet DASH nur an, wenn es die Stücke im Hauptthread des Fensters selbst laden sieht und das MPD die Adressen dieser Stücke beschreibt. Nicht unterstützt bleiben daher:
- Player, die Medien über Peer-to-Peer/WebRTC verteilen oder überwiegend so beziehen;
- Player, die Stücke in Web- oder Service-Workern, über eigene Proxys, unter anderen Adressen als im MPD oder per WebSocket laden;
- Player, die nur Byte-Bereiche einer Datei (SegmentBase) abrufen.

Ebenso nicht unterstützt sind Formate außerhalb des S3-Profils: WebM/VP9, AV1, HEVC, HE-AAC, Live/dynamic, mehrere Perioden, DRM/ContentProtection.

Gemeldet wird das nur mit festen Texten, ohne Seitennamen oder Adressen.

## 7. Tests

| Prüfung | Inhalt |
|---|---|
| `tests/test_dash_fp.py` (Chromium, ohne Erweiterung) | 24 Golden-Vektoren, Golden-Text, Querprüfung 116 Fälle, Rechengrenze, Index-Korrekturen (Bandbreitenformat, Marke, Schreibweise, Nummerierung, abgelehnte Vorlagen), S3-Vorprüfung |
| `tests/channel/dash_unit_check.js` | Befehlsform, Wiederholbarkeit, Fähigkeit, Plan/Start/Status/Abbruch, Planablauf, Antwort verloren, Fehlercodes, Kontext, Route im Hintergrund, Registry-Auswahl und Auflösung |
| `tests/channel/dash_integration_check.js` (echter Helfer, DashEngine) | Helfer ohne DASH, Fähigkeit, abweichender Abdruck, Gutfall bis zur veröffentlichten Datei, Bindung (andere Bindung, andere Kanal-Sitzung), neue Sitzung → neu geplant mit gleicher Kennung, Fehlerort, Abbruch, Prozessabbruch |
| `tests/test_dash_dl.py` (Chromium + Erweiterung + echter Helfer) | bindbare, selbst erzeugte Quelle (`tests/make_dash_source.sh`); Angebot im Sheet und im Player; Plan; Tonauswahl; Start; Datei beim Helfer; keine Angebote bei HE-AAC, DRM, ungebunden und zwei MPDs; `manifest_mismatch` |
| Regressionen | HLS, MP4, Player-Oberfläche, DASH-Hinweis und -Bindung (siehe Bericht) |

## 8. Offen (nicht Teil von S3c)

- **CI:**
  - Die Ende-zu-Ende-Prüfungen gegen die echte DashEngine brauchen einen Helfer-Harness mit `dash on`. Der in `vendor/kadri-pairing-poc/SOURCE` gepinnte Helfer-Commit hat ihn noch nicht.
  - `test_dash_dl.py` ist deshalb aus dem allgemeinen Chromium-Lauf ausgenommen, `dash_integration_check.js` ist noch nicht im CI-Job.
  - Beides wird verdrahtet, sobald der Harness-Patch im Helfer liegt und der Pin bewusst angehoben ist.
- **Emulator-Tests API 26/29/34** des Helfers: Pflicht vor jeder neuen Helfer-APK.
- **Echter Remux:** Er ist nur in den Helfer-Tests geprüft (Media3 auf dem JVM, Emulator). Der Desktop-Harness verkettet.
- **Fortsetzen:** Ein unterbrochener DASH-Auftrag wird aus Kadri nicht fortgesetzt. Das geht über die Benachrichtigung der Helfer-App, solange sie läuft, sonst über einen neuen Start.
- **Firefox:** Die Fassung hat keinen Helfer-Kanal und damit kein Angebot.
