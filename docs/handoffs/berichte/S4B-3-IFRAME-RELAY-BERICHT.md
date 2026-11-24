# S4b-3 – iframe-Relay der DASH-Planung: Ursache, Fix, Abnahme

Stand 23.11.2026.

**Rahmen:**
- Testbranch `test/s4b-dash` (auf `72c4655`), Commit ``6a1e184``. `main` ist unverändert (`cd00ded`), die P4-Lieferpins sind unverändert.
- Keine APK, keine ZIP, keine Installation, keine Beta. Am Samsung nichts geändert.

## 1. Ergebnis

**Die Ursache von U1 lag im Prüfstand, nicht im Produkt.** Das korrigiert meine S4a-Einordnung („Produktfehler, 1 von 10“).

Die neue Relay-Spur belegt: Die Qualitätsauswahl kam in **jedem** Lauf im Hauptfenster an, rund 0,17–0,25 s nach dem Tipp. Der Prüfstand hat sie verpasst:
- Seine Wartebedingung nahm „irgendein Hinweis, der nicht ‚prüft‘ lautet“ als Ergebnis.
- Bei den Fenster-Szenarien stand noch der Hinweis „Anonymisierte Diagnose des Video-Fensters kopiert“ vom vorherigen Langdruck auf dem Bildschirm.
- Der Hinweis „prüft“ kommt aus dem iframe über das Relay einige Millisekunden **nach** dem Tipp. In dieser Lücke galt der alte Hinweis als Ergebnis.
- Im Hauptfenster-Szenario (a2) setzt der Klick „prüft“ synchron, deshalb trat der Fehler dort nie auf.
- Auch „0 MPD-Abrufe des Helfers“ in manchen Läufen war ein Messfehler: Gezählt wurde sofort nach dem Tipp, vor dem Abruf.

**Bei der Instrumentierung habe ich trotzdem zwei echte Produktfehler im Relay gefunden und behoben.** Beide sind mit einer Gegenprobe belegt (§3):
1. **Keine Antwortzuordnung.** Das Hauptfenster nahm *jede* Auswahl desselben Fensters an, wenn sie innerhalb von 30 s nach *irgendeinem* Tipp kam. Folge, wenn eine langsame Planung von einem neueren Tipp überholt wird:
   - Das Hauptfenster zeigt die **veraltete** Qualitätsauswahl.
   - Die Auswahl des neueren Tipps wird abgelehnt und erscheint als **lokales Blatt im iframe**.
2. **Zweiter ⬇-Tipp, während der erste Ablauf noch läuft:** Das Fenster ignorierte ihn. Mit der neuen Zuordnung hätte der Nutzer sonst gar keine Antwort bekommen. Jetzt übernimmt der laufende Ablauf die Kennung des neueren Tipps; es ist dieselbe Aktion.

**Abnahme (endgültiger Stand):**

| Szenario | Planung | Download |
|---|---|---|
| c1 (fremd-originiges iframe) | **5/5** | 5/5 vollständig |
| c3 (zweifach verschachtelt) | **5/5** | 5/5 vollständig |
| c1n (neu: veraltete Antwort) | 5/5 | – |

- Bei den Downloads wurde die Option absichtlich **doppelt** angetippt: Es entstand jeweils **genau ein** Auftrag.
- c1n: Die veraltete Antwort wird oben abgelehnt und im Fenster verworfen; die neuere Auswahl bleibt.

## 2. Ursache – Nachweis aus der Relay-Spur

Lauf c1, vor dem Fix des Prüfstands. Zeiten relativ zum ersten Eintrag; Kennungen gekürzt.

| Zeit | Hauptfenster | Fenster (iframe) |
|---|---|---|
| +0 ms | `top:act(diag)` – Langdruck, Hinweis „Diagnose … kopiert“ erscheint | `frame:act(diag)` |
| +575 | `top:act(dl)` → `top:menu-gezeigt(seq=1)` (Angebot) | `frame:menu-send(seq=1)` |
| +839 | `top:pick(seq=1 i=0)` · `blatt:zu(nach-aktion)` | `frame:pick` → `plan:start` → `plan:helfer-send` |
| +846 | `top:toast-gezeigt` („prüft“, über das Relay) | `frame:toast-send` |
| +1017 | **`top:menu-gezeigt(seq=2 n=2)`** · `blatt:auf(n=2)` | `plan:helfer-antwort(ok:2 ms=249)` → `frame:menu-send(seq=2)` → `menu-reply(ok)` |

- Danach gab es **kein** `blatt:zu`: Die Auswahl stand offen.
- Mit Abfrage im 100-ms-Takt zeigt derselbe Lauf `DASH-Stream speichern` ab ca. 0,2 s und das Ergebnis „Planoptionen 360p + 180p“ (`zwischenstand/ursache-poll-nachweis-c1.log`).

**Korrektur am Prüfstand:**
- Vor dem Tipp wird der sichtbare Hinweis geleert.
- Als Ergebnis gilt nur die Auswahl selbst oder ein **neuer** Hinweis.
- Gezählt wird nach Abschluss der Planung.

## 3. Behobene Produktfehler – Gegenprobe

**Szenario c1n:**
- c1 mit verzögertem MPD für den Helfer (6 s): Tipp auf das Angebot, nach 1,5 s neuer Tipp auf ⬇.
- Der Helfer-Kanal arbeitet die Aufrufe nacheinander ab. Deshalb kommen beide Antworten fast gleichzeitig nach rund 6 s zurück: zuerst die alte Planauswahl, dann die neue Auswahl.

| | alter Produktstand (`72c4655`) | neuer Stand |
|---|---|---|
| Hauptfenster danach | **Qualitätsauswahl der veralteten Planung** | „Speichern“ mit Angebot (neuerer Tipp) |
| iframe | **lokales Blatt** (Auswahl des neueren Tipps fiel zurück ins Fenster) | kein Blatt |
| Spur | – | `…(alt) top:menu-abgelehnt(veraltet)` · `…(alt) frame:menu-reply(veraltet)` · `…(neu) top:menu-gezeigt(seq=3)` |
| Prüfstand | **4 von 8** | 8 von 8 |

## 4. Fix (Diff)

**Prinzip:** Jede Antwort eines Fensters gehört zu genau einem Tipp.

Die Kennung `rid` besteht aus 8 Hex-Zeichen aus `crypto.getRandomValues`. Sie dient **nur** der Zuordnung, nie der Identität. Identität und Herkunft prüft weiter der Browser (frameId und documentId; Ursprung http/https im Hintergrund).

| Datei | Änderung |
|---|---|
| `src/035-fenster-oberflaeche.js` | Siehe Tabelle unten. |
| `chrome/background.js` | `rid` nur als genau 8 Hex weiterreichen (act/pick nach unten, menu/toast nach oben), sonst weglassen. `stale` nur als echtes `true` zurück. Sonst unverändert: feste Befehle, Absender vom Browser, nur Hauptfenster bzw. genau das gemeldete Dokument. |
| `src/105-download-knopf.js` | Siehe Tabelle unten. |
| `src/100-knopf-oberflaeche.js` | Weitergeleitete Hinweise tragen `rid`. |
| `src/280-diagnose.js` | Neue Zeile **„Relay-Spur“** in der anonymen Diagnose: letzte 30 Schritte, nur Zeit, Kennung, Schritt-Name und kurzer Code. Keine Adresse, kein Seitentext. |

Änderungen in `src/035-fenster-oberflaeche.js`:
- **Hauptfenster:** Jeder Tipp (act/pick) erzeugt `rid`; ⬇, ▶ und Einträge setzen `credit = {g, t, rid}` und `lastRid`.
- **Annahme einer Auswahl** nur, wenn alles zutrifft:
  - `rid` ist die Kennung des **letzten** solchen Tipps und wurde noch nicht beantwortet;
  - die Auswahl kommt aus demselben Fenster (Dokument + Kennung);
  - sie kommt höchstens **45 s** nach dem Tipp (Kanal: 25 s je Planaufruf plus Warteschlange; vorher 30 s ohne Bezug zum Tipp).
- **Ablehnung:**
  - veraltet oder doppelt → `{ok:false, stale:true}`;
  - sonst `{ok:false}` (bisheriger kontrollierter Rückfall).
- **Fenster:** `{stale:true}` → Auswahl verwerfen, **kein** Rückfall ins Fenster. Jede Auswahl trägt die Kennung **ihres** Ablaufs (`fuiFrameMenu(title, items, rid)`).
- **Relay-Spur:** Ringpuffer mit 80 Einträgen je Kadri-Instanz.

Änderungen in `src/105-download-knopf.js`:
- Planungs- und Auswahl-Abläufe halten die Kennung beim Start fest (`pageDlRid`).
- `onPageDownload` antwortet mit der Kennung des **letzten** ⬇-Tipps (`pageDl.rid`).
- Spurpunkte: Plan gestartet, Helfer gesendet/geantwortet (Dauer), nicht mehr aktuell, Anzahl Optionen, Blatt auf/zu/popstate.

**Neue und angepasste Tests:**
- **neu** `tests/frame_ui_rid_check.js` (29 Prüfungen, auch in `ci.yml`):
  - Hintergrund: Kennung durchreichen oder verwerfen, `stale` nur als echtes `true`.
  - Hauptfenster:
    - Annahme nur mit der richtigen Kennung;
    - Doppelantwort, ältere Antwort vor und nach der neueren, ohne Kennung, anderes Fenster, unbekanntes Dokument;
    - Frist 45 s, langsame Planung 40 s.
  - Fenster: Kennung des eigenen Ablaufs; `stale` → kein Rückfall; Gegenstück `{ok:false}` → Rückfall.
- `tests/download_diag_check.js`: +2 (zweiter ⬇-Tipp während des ersten Ablaufs → ein Ablauf, eine Auswahl, Kennung des letzten Tipps).
- `tests/dl_sheet_unit_check.js`, `tests/download_diag_check.js`: Stubs für die Spur in der Sandbox.
- `tests/s4a_dash_player_matrix.py`:
  - Ergebniserkennung korrigiert (§2);
  - **harte Funktionsassertions je Szenario**: Bindung, Angebot, Planoptionen bzw. Ablehnung, vollständige Datei, genau ein Auftrag trotz Doppeltipp, MPD genau einmal ohne Cookie/Authorization;
  - Relay-Spur-Prüfung für c1/c3;
  - neues Szenario c1n;
  - c1/c3 jetzt mit Download.

## 5. Geprüfte Anforderungen

| Anforderung | Umsetzung / Nachweis |
|---|---|
| Antwortzuordnung | `rid` je Tipp, Annahme nur der passenden Kennung (frame_ui_rid 29/29, c1n) |
| Frame-Identität | unverändert vom Browser (frameId + documentId); Auswahl aus anderem oder unbekanntem Dokument abgelehnt (frame_ui_rid) |
| Origin-Prüfung | unverändert im Hintergrund (nur http/https-Absender, nur Hauptfenster bzw. gemeldetes Dokument); frame_ui_relay 28/28 |
| Timeout | 45 s ab Tipp (an Kanal-Frist gebunden); danach kontrollierter Rückfall wie bisher |
| Abbruch / Überholen | neuer Tipp macht ältere Antworten veraltet; sie werden oben abgelehnt und im Fenster verworfen (c1n 5×) |
| Doppelte Antworten | gleiche Kennung ein zweites Mal → veraltet (frame_ui_rid) |
| Keine Doppelstarts | Doppeltipp auf eine Option → genau ein Auftrag (c1, c3 je 5×); außerdem Einmal-Auswahl je Blatt und Dedupe der Download-Verwaltung (unverändert) |
| Anonyme Kennung | 8 Hex, zufällig, nur in der Spur; anonyme Diagnose in allen Matrix-Läufen geprüft |

## 6. Testergebnisse (endgültiger Stand)

| Prüfung | Ergebnis |
|---|---|
| Abnahme c1 + c3 + c1n, 5 Läufe (`endstand/abnahme-lauf-1…5.log`) | **5 × 22/22**, 0 FAIL |
| … davon c1: Planung 360p + 180p, Datei 824 580 Byte, genau 1 Auftrag trotz Doppeltipp | 5/5 |
| … davon c3: dasselbe | 5/5 |
| … davon c1n: veraltete Antwort oben abgelehnt, im Fenster verworfen, neuere Auswahl bleibt | 5/5 |
| volle Matrix, 27 Szenarien, harte Funktions- und Sicherheitsassertions (`endstand/matrix-voll.log`) | **124/124** (82 Funktionsprüfungen) |
| Suites MP4, HLS, DASH, Kanal/Helfer, Frame-UI, Download-Blatt, Sicherheit (20 Dateien, `endstand/suites.log`) | alle bestanden (u. a. test_mp4 141/141, test_direct_dl 87/87, test_frame_ui 61/61, test_dash_dl 37/37, test_guard 61/61, test_attack 8/8) |
| S3h-Umleitung Ende zu Ende | 20/20 |
| S3d-Seite Ende zu Ende | alle bestanden |
| Node-Checks aus `ci.yml` (26, `endstand/node-checks.txt`) | 0 Fehler (frame_ui_rid 29/29, frame_ui_relay 28/28, frame_ui_result 35/35, download_diag 102/102, dl_sheet_unit 20/20, confidential_names) |


Der Zwischenstand vor der letzten Änderung (Übernahme der Kennung bei zweitem ⬇) war ebenfalls vollständig grün (`zwischenstand/`):
- Abnahme 5× je 22/22;
- volle Matrix 124/124;
- 20 Suites;
- S3h 20/20 und S3d bestanden.

## 7. Offene Risiken
- **Schließen ohne neuen Tipp:**
  - Schließt der Nutzer das Blatt, ohne neu zu tippen, erscheint die Planauswahl trotzdem, wenn sie innerhalb von 45 s eintrifft.
  - Ein „Abbrechen“ der laufenden Planung gibt es nicht; der Helfer plant zu Ende (Planung ist nebenwirkungsfrei).
- **Planung über 45 s:**
  - Das ist nur möglich, wenn der Kanal stark ausgelastet ist (25 s Frist je Aufruf).
  - Folge: bisheriger Rückfall, die Auswahl erscheint im Fenster.
  - Es gibt keinen Test mit echter 45-s-Verzögerung, nur den Unit-Test mit Zeitmock.
- **Warteschlange:**
  - Der zweite ⬇-Tipp wartet, bis die laufende Planung zurück ist (c1n: Auswahl erst nach rund 6 s).
  - Das ist korrekt, kann sich aber träge anfühlen. In S4b-1/2 (Texte) prüfe ich einen Hinweis „Helfer-App ist beschäftigt“.
- **Langdruck-Diagnose:**
  - Für Videos im Hauptfenster bzw. im srcdoc-Fenster kopiert der Langdruck weiterhin die vollständige Diagnose.
  - Das wird in S4b-1/2 geändert (anonym als Standard, vollständig nur ausdrücklich).
- **Prüfung nur auf Desktop-Chromium:**
  - Alle Prüfungen liefen auf Desktop-Chromium 153 (Xvfb).
  - Vivaldi/Chromium auf Android (Samsung) ist für das Relay noch nicht erneut geprüft.

## 8. Dateien
- `S4B-3-IFRAME-RELAY-BERICHT.md` – dieser Bericht
- `kadri-s4b3.patch` – der Commit
- `endstand/` – Abnahme 5×, volle Matrix, Suites, S3h, S3d auf dem endgültigen Stand
- `zwischenstand/`:
  - Ursachen-Läufe (Spur, 100-ms-Abfrage);
  - Gegenprobe gegen den alten Produktstand;
  - erster Regressionsdurchgang.
- `SHA256SUMS`
