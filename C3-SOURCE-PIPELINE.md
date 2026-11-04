# C3 – Gemeinsame Quellenpipeline und MP4-Auswahl (P0–P2)

Stand 04.11.2026, Branch `feature/c3-helper-mp4`. **Produktion bleibt UNAPPROVED.** Eine grüne CI ist keine Freigabe.
Grundlage: `CLAUDE-C3-HANDOFF.md`. Helper unverändert (`ca60540`, Pin in `vendor/kadri-pairing-poc/SOURCE`); kein neues
Kanalkommando, keine neue Berechtigung, keine neue APK.

## P0 – Testbasis

**P0a (`tests/test_mp4.py`, `tests/common.py`).** Jeder gestartete Download prüft zuerst ausdrücklich „Eintrag vorhanden“
und „Tipp ausgeführt“ (`start_item`). Fehlt etwas, kommt sofort ein eigener Fehler mit redigierter Diagnose
(`player_diag`): readyState, paused/ended, Fehlercode, srcObject vorhanden, Quelle passt (Boolean), Brücke, Menülabels,
Prüfzustand und -generation der Helfer-App (`data-hdl`/`data-hdl-gen` am Download-Knopf im geschlossenen Shadow-DOM).
Keine Adressen, Cookies oder Serverantworten. `open_player` hält fest, ob die Brücke endete, statt es zu verschlucken.

**Befund zu den vier Login-Fehlern (Run 41547332622).** Alle vier sind mit genau einer fehlenden Startvoraussetzung
vereinbar: `wait_item` lief 12 s ohne Eintrag ab, `pick` scheiterte unbemerkt, und der 12-s-Clip war danach zu Ende
(daher auch „Wiedergabe unverändert“). Derselbe Fehlerabdruck trat im Lauf 41721629903 (`0d5184b`, nur Doku geändert)
in einem *anderen* Szenario auf („Verbindungsabbruch“: kein Hinweis, kein Helfer-Abruf). Das Problem betrifft also das
Erscheinen des Eintrags allgemein, nicht die Anmeldung oder Cookies. Lokal (Chromium 1243, auch unter CPU-Last und mit
2 s verzögerter Caps-Antwort) nicht reproduziert. **Ursache weiterhin nicht bewiesen**; tritt es erneut auf, zeigt die
Diagnose jetzt Zustand und Prüfstand.

**P0b (`src/180-player-bedienung.js:hdlProbe`).** Belegter Fehler: `probed = u` vor der asynchronen Antwort; war die
Quelle beim Eintreffen kurz ungeeignet (z. B. `readyState < 2` während eines Sprungs) oder die Antwort vorübergehend
negativ, blieb die Adresse für die ganze Sitzung gesperrt. Jetzt getrennt: `pending` (Adresse + Generation), `checked`
(caps **und** find beantwortet), `gen`. Veraltete Antworten (anderer Player, neuere Prüfung, Quelle anders/ungeeignet)
werden verworfen, ohne spätere Prüfung zu sperren; „nicht unterstützt“ wird nicht wiederholt. Neuer Anlass nach einem
Sprung: `canplay`/`seeked` (danach kommt kein `loadeddata`). Keine Schleife, keine automatische Wiederholung, kein
Medienabruf. Test: `tests/download_source_check.js` (Deferred Promises mit dem echten Funktionstext), CI-Gegenprobe:
Stand `0cdf202` scheitert genau an „re-probe required after temporary unsuitability during caps“.

## P1 – Quellenmodell und Registry

`src/045-media-source.js` (reine Daten/Prüfungen) und `src/065-media-registry.js` (Registry + Adapter), gebündelt
über `tools/build.js` in Chrome, Firefox und Userscript (keine Browser-API außer `crypto.getRandomValues`).

- **Kontext:** `documentKey` (zufällig, neu nach Navigation inkl. SPA), `playerId` (je Videoelement, keine DOM-ID),
  `mediaEpoch` (neu bei `emptied`/`loadstart` mit vorhandenen Quellen). `tabId/frameId` = `null` im Inhaltsskript; sie
  kämen nur aus Runtime-`sender`. Jedes Fenster hat eine eigene Registry. Gleiche URL in zwei Playern = zwei Einträge.
- **Eintrag:** `sourceId`, `revision`, `urlRef` (opak); exakte URL nur privat in der Registry. `kind`
  mp4/hls/dash/unsupported/unknown nach Pfadende bzw. MIME (`…/720.mp4:hls:manifest.m3u8` = HLS); `role`
  standalone/master/media-playlist/segment/init/track/unknown – Rolle aus gelesenen Listen (`040:plParts`, EXT-X-MAP,
  Segmentzeilen, Unterlisten) schlägt Endung und `type`, und eine spätere Behauptung kann ein Stück nicht wieder zur
  Datei machen. Qualität/Ton/Bild/Dauer/MIME als `Knowledge` (unknown | claimed/observed/verified + Belege);
  `verified` aus Seiten-/Element-/Adapterangaben wird abgelehnt.
- **Bindung:** `bound` nur mit Beleg: `element-src`, `element-source` (`<source>`-Kinder desselben Elements),
  `segments-loaded` (Stücke genau dieses Streams geladen), `asset-id` (Facebook/Instagram), `adapter-variant-set` +
  `single-video` (vorhandener Pornhub-Adapter nur bei einem Video), `own-player-loaded` (vom eigenen Player tatsächlich
  geladene Datei, bisherige C3-Regel). Zeitpunkt/Vorschaubild = `ambiguous`, „zuletzt geladen“ = `unbound`,
  Seitennähe = `ambiguous`. Keine neue Site-Sonderlogik.
- **Schema:** strikt; unbekannte Felder (z. B. Header, Cookie), Nicht-http(s), Zugangsdaten in der URL, > 4096 Zeichen,
  falsche Zahlen, `bound` ohne Beleg → abgelehnt. Budgets: 64 Quellen/Player, 256/Dokument, 16 Player; darüber
  `budget`. Nichts wird gespeichert.
- **Schnittstellen:** `contextFor`, `observe`, `snapshot` (eingefroren, ohne URL), `invalidate`, `subscribe`,
  `selectPlayback(ctx, legacyOrdering)`, `selectDownloads(snapshot, caps)`, `resolveSelection(ctx, sourceId, revision)`.
- **Wiedergabe (P1b):** `playerSources` (120) baut die Liste unverändert und meldet dieselben Ergebnisse zusätzlich als
  Beobachtungen; `130` übernimmt `selectPlayback` = exakt dieselbe Reihenfolge (plus Kennungen). `170`/`190` unverändert.

## P2 – MP4-Auswahl unabhängig von laufendem HLS

`180` bildet das Download-Menü aus `selectDownloads` über zwei Kontexte: eigenes Videoelement (geladene Datei; jeder
Quellwechsel = neue Epoche) und Originalvideo (Kontext vom Öffnen; wechselt die Seite das Medium, wird nichts davon
mehr angeboten). Je auswählbarer MP4 ein Eintrag „Mit der Helfer-App speichern · <Höhe>p“ (ohne Angabe = unbekannt).
HLS läuft dabei weiter; `190` bleibt reine Wiedergabeauswahl. Öffnen des Menüs ruft nichts ab; der Tipp löst
`resolveSelection` (aktuelles Dokument, Player, Epoche, Revision, auswählbar) und dann den **bestehenden**
`downloads.start(url, name)` → `dlstart` aus – genau ein Auftrag. Veraltete Auswahl: Hinweis „Die Quelle hat sich
geändert – bitte erneut auswählen“, kein Start. Ohne Auswahl: „Stream erkannt – HLS/DASH speichert die Helfer-App noch
nicht“ bzw. „MP4 nicht sicher zugeordnet“. Journal, Idempotenz, Abbruchwunsch, Popup unverändert; der Helfer prüft
den Abruf weiter selbst (Netzgrenzen, Redirect, TLS, Status, Länge, Typ, Signatur, Speicher). Die Signaturprüfung ist
keine Track-/Vollständigkeitsprüfung; es gibt keine „verifiziert“-Anzeige dafür.

## Abdeckung der Matrix (Browser, echte Helper-Engine)

| ID | Wo | Stand |
|---|---|---|
| M01 | `test_mp4.py` öffentliche MP4 | ein Abruf, volle Größe, ohne Cookie/Auth/Referer |
| M02 | `hlsalt.html` | HLS spielt (blob:), zwei `<source>`-MP4 angeboten, 720p gespeichert, exakte Query, HLS läuft weiter |
| M03 | `c3-iframe.html?frame=hlsalt&ad=…` | Hauptframe ohne Video; Angebot aus dem Cross-Origin-Fenster; Werbe-MP4 nie angeboten/abgerufen |
| M04 | `hlsalt.html` zweites Video | Quelle des anderen Players nicht angeboten |
| M05 | Init als `<source type=video/mp4>`, Stücke | Rolle aus Liste schlägt Endung (Browser + `media_registry_check.js`) |
| M06 | Medium wechselt bei offenem Menü | alte Auswahl verweigert, kein Abruf, keine Geister-Einträge |
| M07 | Signierte Query, 404/410 | Bytes unverändert; „Datei nicht gefunden“ |
| M08 | Login-Fixture | Browser mit Cookie, Helfer ohne; 403-Hinweis; kein anderer Weg |
| M09–M10, M14–M15 | Helper-Java-Tests (`tests/java/{net,dl}`), `channel_netguard_failure_check.js` | unverändert, Helper nicht geändert |
| M11–M13, M16 | `test_mp4.py`, `popup_downloads_check.js` | Dreifachtipp, Abbruch, SW-/Browser-/Helper-Neustart, Popup |

Externe Seiten (Pornhub-404, Eporner, Kinogo/cinemar) sind damit **nicht** als repariert belegt; nur Gerätetests zeigen
das. Bekannte Grenzen: Ein `<source>`-Kind ist eine Angabe der Seite (untrusted) – gebunden an das Element, nicht
inhaltlich geprüft; der Helfer prüft nur Typ/Signatur/Länge. Firefox/Userscript haben keinen Kanal und bieten nichts an.

**Hinweis Quellabgleich:** `tools/sync-src.sh` übernimmt `src/*.js` aus dem Helper-Repository. Die C3-Teile (`045`, `065`,
`040:plParts/mediaRoleHint`, `120`, `130`, `180`) existieren nur hier; `180` wich schon vor P0 ab. Vor einem Abgleich
müssen sie dort übernommen werden, sonst gehen sie verloren. Das Helper-Repository wurde dafür nicht verändert.
