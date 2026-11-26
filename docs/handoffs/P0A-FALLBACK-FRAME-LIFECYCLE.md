# P0-A · Capture-Rückfall, iframe-Linkfreigabe und Stallwächter

**Stand zur unabhängigen Prüfung.** Die drei im Review [CODEX-REVIEW-HLS-VARIANTEN-UND-LINKS.md](https://github.com/Owndot/Kadri/blob/a981778a09d6b15bbe0094e44e5cca347c16c7d6/docs/handoffs/CODEX-REVIEW-HLS-VARIANTEN-UND-LINKS.md) bestätigten Befunde (zwei P0, ein P1) sind mit je einem Produktcommit korrigiert. Für jeden Befund liegt ein neuer Chromium-Prüfer vor, der auf dem unveränderten Ausgangsstand fachlich rot und auf dem Korrekturstand grün ist. Automatische DASH-Planung und DASH-Downloads bleiben gesperrt. P0-B und P0-C wurden nicht begonnen. Kein Merge, kein Paket, keine Installation.

## 1. Ausgangsstand und Commit-Kette

| Gegenstand | SHA |
|---|---|
| Produktbasis, Kopf von `fix/p0a-hls-variant-guard` | `0cfe56c4571415c0008d6c49c931a94d00523873` |
| Reviewgrundlage, `audit/p0a-hls-variant-review` (reiner Dokumentcommit auf der Basis, nicht Ausgangspunkt) | `a981778a09d6b15bbe0094e44e5cca347c16c7d6` |
| Commit 1 · P0 Capture-Rückfall, einziger Parent ist die Basis | `b4162f2` |
| Commit 2 · P0 iframe-Linkfreigabe, einziger Parent ist Commit 1 | `2bbdc21` |
| Commit 3 · P1 Stallwächter, einziger Parent ist Commit 2 | `97ae9b3` |
| Dieser Bericht, Parent ist Commit 3 | Kopf von `fix/p0a-fallback-frame-lifecycle` |
| Helper, unverändert (`test/s4b5-dash`) | `6e553fcb82b437ce0be487233dd35f41958bade6` |
| `main` Kadri / Helper auf GitHub, unverändert | `cd00ded7d68b3d2e8af9d2724cee03e7d351f091` / `bb8a42d83eac108c098600e50a20208446134e65` |

Verifizierte Vorfahren von `0cfe56c`: A1 `cc0c241`, A2 `4c05499`, Player-Klassifikation `cbeac18`, Redirect-Provenienz `7fe954f`, MPD-Identität `bc830c8`, HLS-Playlist-Guard `c247843`, Linkfreigabe `0cfe56c`. Gelesen wurden alle neun Dokumente an ihren Commits (Sanierungsplan `8157f17`, Audit `f4b9ac7`, Review P0-A `465f46c`, Nachreview `9455514`, B.2 `7fe954f`, Manifestidentität `bc830c8`, Review Manifestidentität `0ce2149`, HLS/Links `0cfe56c`, Review HLS/Links `a981778`). Die Audit-Dokumente wurden einzeln per `git show` gelesen, keine Branches zusammengeführt.

Die Commits 2 und 3 wurden vor der Veröffentlichung lokal einmal neu geschrieben: Die Dokumentprüfung in `045` war zunächst als `!document.defaultView` formuliert und brach den Node-Prüfer `download_diag_check.js` (Stub ohne `defaultView`). Endfassung: nur ein ausdrücklich abgelöstes Dokument (`defaultView === null`) sperrt. Die Produktdateien von `97ae9b3` sind identisch mit dem Baum, auf dem die vollständige Regression in Abschnitt 11 lief.

## 2. Technische Ursachen

**P0-A · Capture-Rückfall.** `src/170-player-laden.js` übergab bei leerer Levelauswahl (`pruneHlsLevels` → `false`) bzw. nach einem nicht behebbaren Guard-Fehler an `tryNext` und danach an `useCapture`. Dort prüfte Kadri für das pausierte Original nur die **Masteradresse** (`playbackAllowed`) und das Merkmal `noNativeHlsStart`, das ausschließlich im Zweig ohne hls.js gesetzt wird. Die Masteradresse war zulässig, also folgte `orig.play()`. Chromium 158 meldet für natives HLS `maybe`; der native Player forderte daraufhin eine gesperrte Variante an. Dieselbe Lücke bestand in `handBack`: Nach eigener Wiedergabe über die erlaubte Variante startete die Rückgabe das native Original mit derselben Masterliste, das eine bekannte MPD-Variante abrief.

**P0-A · iframe-Linkfreigabe.** `fuiFrameAct('share')` und `fuiFramePick` (Einträge mit `ext`) gaben nur `{k, u}` an das Hauptfenster (`src/035-fenster-oberflaeche.js`). `fuiTopExt` bildete dort mit `pageLinkOutputFor` bzw. dem Standardprüfer von `toYtdlnis` einen **neuen** Prüfer im Hauptdokument. MPD-Beobachtungen des Ursprungsdokuments erreichen nur dessen eigene gehaltene Auswahlen (`watchDashOutput`/`noteDashOutput`), nie einen Prüfer in einem anderen Dokument. Das betraf Knopf-Teilen, den Eintrag „Teilen …“ mit Beitragslink und „Mit YTDLnis“.

**P1 · Stallwächter.** `handBack` prüfte nur den ersten Originalstart. `watchStall` (`src/260-player-schliessen.js`) setzte nach drei Sekunden ohne Fortschritt erneut `currentTime` und `play()` und prüfte dabei nur Fortschritt und `isConnected`, weder Klassifikation noch Quelle, Epoche, Dokument oder einen inzwischen neu geöffneten Player.

**Gemeinsames Muster.** Eine einmal getroffene positive Entscheidung wurde über einen asynchronen Übergang (Capture, Relay, Timer) weiterverwendet, ohne dass der Prüfer, der spätere negative Klassifikationen erhält, am tatsächlichen Seiteneffekt beteiligt war.

## 3. Veränderte Dateien und Funktionen

| Datei | Änderung |
|---|---|
| `src/125-player-hls.js` | Neu `noteHlsMaster`, `noteHlsDenial`, `hlsOrigStartBlocked` |
| `src/170-player-laden.js` | `tryNext`: Variantensatz bei `MANIFEST_PARSED` festhalten, Ablehnung im Guard-Callback vermerken. `useCapture`: pausiertes Original nur ohne gesperrte Variante starten |
| `src/260-player-schliessen.js` | Neu `origStartGuard`, `handedLast`. `handBack` bildet die Übergabeentscheidung, `resume` und `watchStall(o, may)` prüfen sie vor jedem Seek und Play |
| `src/035-fenster-oberflaeche.js` | Neu `fuiFrameConfirm`. `fuiFrameAct('share')` und `fuiFramePick` geben keine Adresse mehr nach oben. `fuiTopExt` gibt nur noch den anonymisierten Diagnosetext aus. `fuiTopOutputContext` entfällt |
| `src/045-media-source.js` | `mediaOutputContext` und `mediaOutputFor` sperren in einem abgelösten Dokument (`defaultView === null`) |
| `src/105-download-knopf.js` | `pageDlExternal`: „Mit YTDLnis“ und „Teilen …“ mit Beitragslink tragen `frameConfirm` statt `ext` |
| `src/020-einstellungen-sprache.js` | Drei englische Übersetzungen der neuen Hinweise |
| Neue Prüfer | `tests/test_p0a_capture_fallback.py`, `tests/test_p0a_frame_share_lifecycle.py`, `tests/test_p1_stall_watch.py` |
| Angepasste Prüfer | `tests/test_p0a_page_link_budget.py`, `tests/frame_ui_result_check.js` (Abschnitt 11) |

## 4. Sicherheitsarchitektur

**Capture und Rückgabe.** Der Player hält je Hauptliste (Schlüssel `dashUrlKey` der Masteradresse) die bei `MANIFEST_PARSED` bekannten Level-, Audio- und Untertiteladressen und ein Ablehnungsbit. Das Bit wird gesetzt, sobald der Playlist-Guard eine Adresse dieser Instanz ablehnt oder eine Variante beim Parsen unzulässig ist. `hlsOrigStartBlocked` sperrt einen von Kadri ausgelösten Start eines Originals mit dieser Hauptliste, wenn das Bit gesetzt ist **oder** eine der Varianten nach heutigem Stand unzulässig ist. Keine neue globale Liste: Die Aufzeichnung lebt an der Playerinstanz und verwendet die bestehende dokumentweite MPD-Identität. Eine andere Quelle desselben Elements hat einen anderen Schlüssel und wird neu bewertet. Ein laufendes Original wird weiter passiv gespiegelt. Eine unabhängige zulässige MP4/HLS spielt `tryNext` wie bisher vor dem Rückfall ab. Ohne sichere Quelle schließt Kadri kontrolliert mit Hinweis (`closePaused`, Original bleibt angehalten).

**iframe-Ausgabe.** Eine Adresse aus einem eingebetteten Fenster wird nur noch im Ursprungsfenster ausgegeben. Das Hauptfenster löst die Aktion aus, das Fenster öffnet das Blatt „Im Video-Fenster bestätigen“ mit genau einem Eintrag, das Hauptfenster zeigt „Bitte im Video-Fenster bestätigen“. Erst ein echter Tipp im Fenster ruft `sharePageLink`, `toYtdlnis` bzw. den Medienweg auf. Prüfung, `navigator.share` und der Clipboard-Fallback laufen mit dem Prüfer dieses Dokuments, der spätere MPD-Erkennungen über `noteDashOutput` erhält. Die vorhandene `frameConfirm`-Architektur (bisher für Medien) wurde dafür verallgemeinert. Ein URL-Ergebnis, das dennoch das Hauptfenster erreicht, wird abgelehnt („Nichts geteilt oder geöffnet – bitte direkt im Video-Fenster bestätigen“). Es wird keine Benutzeraktivierung simuliert. Ein entfernter oder ersetzter Frame verliert seinen Browsing-Kontext; der Ausgabeprüfer sperrt dann auch Aufrufe, die im abgelösten Dokument noch ausgeführt würden.

**Stallwächter.** `origStartGuard` kombiniert `mediaOutputContext` (Element, Verbindung, gültiges Dokument, `src`, `currentSrc`, `srcObject`, Dokumentkennung, Player-ID, Medien-Epoche) mit der Übergabeidentität (dieselbe, nicht zurückgenommene Übergabe, `handedLast === st`, kein anderer offener Player), unveränderter Adresse, aktueller Registry-Zulassung und `hlsOrigStartBlocked`. Die Entscheidung ist monoton: einmal ungültig, bleibt sie ungültig. `resume` prüft vor dem ersten Play, `watchStall` bei jedem Durchlauf, vor dem Seek und erneut vor dem Play.

## 5. Rot-/Grünnachweise

Identische Prüfdatei auf dem Vorgänger (separater sauberer Worktree, nur die spätere Prüfdatei kopiert) und auf dem Korrekturstand, jeweils `KADRI_CHROMIUM=/opt/pw-browsers/chromium python3 tests/<Prüfer>.py`.

| Prüfer | Vorgänger | Korrektur | Endstand |
|---|---:|---:|---:|
| `test_p0a_capture_fallback.py` | `0cfe56c` **7/14** | `b4162f2` 14/14 | 14/14 |
| `test_p0a_frame_share_lifecycle.py` | `0cfe56c` **5/20**, `b4162f2` **5/20** | `2bbdc21` 20/20 | 20/20 |
| `test_p1_stall_watch.py` | `0cfe56c` **3/7**, `2bbdc21` **3/7** | `97ae9b3` 7/7 | 7/7 |

Die roten Assertions erreichten jeweils die fachlichen Messpunkte, keine Start- oder Importfehler. Beim iframe-Prüfer sind auf der Basis die Fälle Test A (vier Prüfungen) und Test B (Clipboard) **fachlich** rot. Die übrigen roten Fälle sind Positivkontrollen, die die neue Zuständigkeit verlangen (genau ein Aufruf im Ursprungsframe nach Bestätigung); auf der Basis lag der Aufruf im Hauptfenster.

## 6. Netzwerkrequests (P0-A, echtes hls.js, gezählte Chromium-Requests)

Lokale Zwei-Varianten-Fixture `tests/web/hls2`. Beide Varianten wurden per Fetch gelesen und mit `notePlaylist` als MPD registriert, danach 44 weitere Analysen; Prüfung `!dashSummaryOf(u) && mediaIsDashManifest(u)` wahr. Jede spätere Netzabfrage erhielt MPD-Bytes. Original pausiert, `preload=none`, `canPlayType` für natives HLS: `maybe`.

| Lauf (je mit resumeAfterClose an und aus) | Basis: Orig.-play / niedrig / hoch / Master | Fix: Orig.-play / niedrig / hoch / Master |
|---|---|---|
| Beide Varianten MPD, Capture-Rückfall | **1 / 1 / 0 / 2**, Capture aktiv | **0 / 0 / 0 / 1**, kontrolliert geschlossen, Original pausiert |
| Hohe Variante MPD, eigene Wiedergabe über niedrige, danach Schließen | Player: 0 Requests an hoch. Rückgabe: **1 Play, 1 Request an hoch** | Player: 0 an hoch. Rückgabe: **0 Play, 0 Requests** |

Der zweite Masterrequest auf der Basis stammt vom nativen Player nach `orig.play()`. Unterdrückt werden damit alle durch Kadri veranlassten Originalstarts mit bekannter gesperrter Variante.

## 7. Share-/Clipboard-Zähler (P0-A iframe)

Echte gleichherkunftige Dokumente, Produktquelltext in Haupt- und Ursprungsfenster, echte Antwortsanitisierung `fuiBack` aus `chrome/background.js`, nachgebildete IPC. Gezählt in **beiden** Dokumenten: `navigator.share`, `navigator.clipboard.writeText`, `execCommand('copy')`, Intent-Link-Klicks und die verzögerte Intent-Navigation. Bestätigungen per echtem Playwright-Klick; `navigator.userActivation.isActive` wurde am Share-Aufruf protokolliert.

| Fall | Basis (oben / Frame) | Fix (oben / Frame) |
|---|---|---|
| Test A, Knopf: MPD nach Antwort, vor Zustellung | Share 1 / 0 | Share 0 / 0, Clipboard 0 / 0 |
| Test A, Eintrag „Teilen …“ | Share 1 / 0 | 0 / 0 |
| Test A, Eintrag „Mit YTDLnis“ | Intent 1 / 0 | 0 / 0 |
| Test B: MPD nach begonnenem Share, Share scheitert | Share 1, **Clipboard 1** / 0 | Share 0 / **1**, Clipboard 0 / **0**, kein Hinweis „verhindert“ |

## 8. Ergebnisse Capture, Player und Stallwächter

| Fall | Basis | Fix |
|---|---|---|
| MP4 nach Schließen, danach MPD-Klassifikation, Fortschritt bleibt aus | 1 Seek + 1 Play nach Klassifikation | 0 / 0 |
| Weiterhin zulässige stockende MP4 (Positivkontrolle) | 1 Seek + 1 Play | 1 Seek + 1 Play |
| Medienwechsel im selben Element | 1 / 1 | 0 / 0 |
| Elementersatz | 0 / 0 | 0 / 0 |
| SPA-Dokumentwechsel (neue Registry-Dokumentkennung) | 1 / 1 | 0 / 0 |
| Neu geöffneter Player für dasselbe Original | Seek + Play **bei offenem Player** | keine |
| Zweites Schließen | 1 Start + 1 Anstoß | 1 Start + 1 Anstoß |

`play()` am Original wurde für diese Messung durch einen Zähler ohne Wirkung ersetzt (simulierter fehlender Fortschritt). Die eigene Wiedergabe im integrierten Player war echt dekodiert.

## 9. Positive dekodierte MP4-/HLS-Kontrollen

- MP4 dekodiert im Player (`videoWidth > 0`, Zeit läuft), Rückgabe startet das Original genau einmal.
- HLS mit zwei erlaubten Varianten dekodiert, manueller Qualitätswechsel erreicht das andere Level und läuft weiter; Rückgabe startet das Original genau einmal.
- Eine Variante gesperrt: eigene Wiedergabe über die erlaubte Variante dekodiert, null Requests an die gesperrte.
- Laufendes Blob-MP4-Original: passives Spiegeln mit fortschreitender Zeit, null Kadri-Starts.
- Nach legitimen Medienwechsel auf MP4 im selben Element: Player dekodiert, Rückgabe startet einmal.
- Bestand: `test_p0a_hls_variant_guard.py` 13/13 einschließlich Vorschau, Audio/Untertitel, Master-Retry, erlaubtem manuellen und automatischen Wechsel.

## 10. Positive gewöhnliche Linkfreigaben

Gültiger Beitragslink aus iframe (Knopf und Eintrag „Teilen …“): genau ein Share im Ursprungsframe mit Benutzeraktivierung, null oben. Gültige Dokumentadresse aus iframe: genau ein Share. „Mit YTDLnis“ mit gültigem Beitragslink: genau ein Intent im Ursprungsframe. Share-Fehler mit zulässigem Link: genau ein Clipboard-Aufruf. Nach Medienbudgetüberlauf (514 Manifeste): ein Share. Doppeltipp oben und im Fenster: ein Relay, ein Share. Eine bekannte MPD mit Beitragsform erreicht nie Share oder Clipboard; `postUrlFor` fällt dann auf die gewöhnliche Dokumentadresse zurück, die zulässig geteilt wird. Navigierter, ersetzter oder entfernter Frame nach offenem Bestätigungsblatt sowie ein während der Antwort ersetzter Frame: null Aufrufe. Lokale Linkfreigaben im Hauptdokument (`test_p0a_page_link_budget.py`) unverändert grün.

## 11. Bestehende Sicherheitsregressionen

**Chromium-Komponenten am Endstand: 16 Prüfer, 415/415.**

| Prüfer | Ergebnis |
|---|---|
| Neu: Capture-Rückfall / iframe-Linkfreigabe / Stallwächter | 14/14, 20/20, 7/7 |
| HLS-Playlist-Guard / Linkbudget / Manifestidentität / Player-Klassifikation / Redirect-Provenienz | 13/13, 12/12, 13/13, 8/8, 20/20 |
| Falsches Video B1–B4 (`test_dash_wrong_video.py`) | 10/10 |
| DASH: Parser, Gate, Fingerabdruck, Backfill, Alternativen, URL-Parameter, unbekannter Start | 61, 122, 30, 23, 12, 32, 18 jeweils vollständig |

**Node: 31 Programme bestanden** (26 `tests/*_check.js`, davon `guard_check.js` mit `chrome/background.js` und `ff_net_check.js` mit `firefox/background.js`, sowie fünf aus `tests/channel/`: channel_unit 45/45, dash_unit 104/104, download_unit 143/143, download_regression, hls_unit 97/97). Darunter Registry 140, Manifestmodell 35/35, Bindung 32/32, Epoche 13/13, DASH-Diagnose 32, DASH-Downloaddiagnose 19/19, DASH-Nachrichten 64/64, Download-Diagnose 102/102, Downloadblatt 20/20, Frame-Relay 33/33, Frame-Ergebnis 42/42, Frame-RID 36/36 und der Vertraulichkeitswächter.

**A1/A2.** `channel/` ist unverändert; `dash_unit_check.js` bestätigt 104/104 die Ablehnung neuer `dashplan`/`dashstart`, kein Neustart nach Antwortverlust, Status und Abbruch. `test_dash_wrong_video.py` bestätigt Diagnosekandidat ohne DASH-Angebot.

**Angepasste Bestandsassertions.** Zwei Prüfer kodierten genau den bestätigten P0-Pfad als Soll:

- `tests/frame_ui_result_check.js`: „Eintrag, Antwort {ok:true, ext}: Aktion hier ausgeführt“ erwartete die Ausgabe einer Frame-URL im Hauptfenster. Ersetzt durch acht Prüfungen (Eintrag und Knopf × `share`, `share-page`, `open`, `ytdlnis`): null Ausgaben oben und ein Hinweis auf die Bestätigung im Fenster. Die Prüfungen gegen `{ok:false}`, fehlendes `ok` und den Diagnose-Kopierweg bleiben unverändert. Mit dem neuen Prüfer bricht `0cfe56c` an der ersten neuen Assertion ab (20 PASS davor); Endstand 42/42.
- `tests/test_p0a_page_link_budget.py`: Der iframe-Fall verlangt jetzt null Aufrufe oben **und** genau einen Share im Ursprungsframe nach Bestätigung (vorher: ein Share oben). „Alter Frame: später Clipboard-Fallback“ prüft in der Schleife null Aufrufe oben; ein zusätzlicher Fall beginnt den Share im Frame, entfernt den Frame und verlangt null Kopien im abgelösten Dokument. Dieser Zusatzfall deckte während der Entwicklung die Lücke `isConnected` im abgelösten Dokument auf (Korrektur in `045`). `0cfe56c` 9/12, Endstand 12/12. Die vorherige Fassung ergab auf der Basis 11/11.

Kein `skip`, kein `xfail`, keine abgeschwächte Assertion.

## 12. Ausgeführte Programme und Umgebung

Chrome for Testing 158.0.8127.36 unter `/opt/pw-browsers/chromium` (nicht das im Review verwendete Debian Chromium 156), Python 3.13.18 mit `playwright` 1.58.0 (nur das Python-Paket installiert, kein Browserdownload), Node 22.23.5, Rust 1.97.0, OpenJDK 21. Alle Medien lokal oder synthetisch.

- `KADRI_CHROMIUM=/opt/pw-browsers/chromium python3 tests/test_<name>.py` für die 16 Chromium-Prüfer, nacheinander (Port 8790).
- `node tests/<name>_check.js [chrome|firefox/background.js]` und die fünf Kanalprüfer.
- Ungepackter Chromium-Testbuild ausschließlich über `write(dir, 'chrome', true)` aus `tools/build.js` in ein temporäres Verzeichnis, einschließlich der eingebauten `node --check`-Syntaxprüfung. Kein ZIP, kein `dist/`. `tools/sync-src.sh` nicht ausgeführt.
- Service-Worker-Probe mit diesem Build: Worker `background.js` sofort registriert (`launch_persistent_context`, Xvfb). `tests/test_basic.py` mit `KADRI_EXT` auf den Testbuild: 7/7.
- `test_mp4.py`, `test_hls.py`, `test_frame_ui.py`, `test_direct_dl.py`: Abbruch **vor** den Assertions, `HELPER_HOST_DIR fehlt`. Ein einmaliger Bauversuch des Harness aus einem separaten Klon von `6e553fc` mit `tests/java/channel/build.sh` übersetzte beide Rust-Bibliotheken und die Kanalklassen. Das Nachladen der gepinnten OkHttp-JARs scheiterte an **HTTP 429 von repo1.maven.org**. Der Harness wurde nicht fertiggestellt, keine Umgehung versucht. Diese vier Prüfer gelten als **nicht ausgeführt**.

## 13. Verbleibende Risiken

1. **Natives HLS ohne Kadri-Kenntnis.** Das Variantenveto setzt voraus, dass Kadris hls.js-Pfad die Hauptliste dieser Instanz geparst hat. Startet Kadri ein natives HLS-Original, dessen Hauptliste es nie geladen hat, kann es dessen Varianten nicht prüfen (bisheriges Verhalten). Spätere Content-Steering-Pfade und HTTP-Weiterleitungen innerhalb eines Transports sind nicht im aufgezeichneten Variantensatz.
2. **Nutzergesteuertes Play im Capture-Modus** eines bereits laufenden Originals bleibt möglich; es ist keine von Kadri ausgelöste Wiedergabe, der native Player lädt die Varianten dann ohnehin bereits.
3. **Zweiter Tipp im iframe.** Teilen, Beitrags-Teilen und YTDLnis aus einem eingebetteten Fenster brauchen jetzt eine Bestätigung im Fenster. In fremdherkunftigen Frames können Permissions Policy (`web-share`, `clipboard-write`) Teilen verhindern; dann greift der dokumentgebundene Kopier-Fallback. Bedienbarkeit in sehr kleinen Frames und die Intent-Annahme aus einem iframe auf Android sind nicht auf Geräten geprüft.
4. **Relay-Sanitisierung.** `chrome/background.js` lässt URL-Ergebnisse (`ytdlnis`, `open`, `share`, `share-page`) als Format weiterhin durch; das Hauptfenster führt sie nicht mehr aus. Ein zusätzliches Verwerfen im Hintergrund wäre eine mögliche spätere Verschärfung (bewusst nicht Teil dieser Änderung).
5. **Stallwächter und Epoche.** Löst der erste Play eines nie geladenen Originals einen `loadstart` mit neuer Registry-Epoche aus, endet der Wächter ohne Anstoß (konservativ). Für Blob-/MSE-Originale ohne prüfbare Adresse gilt wie bisher nur die Kontextprüfung.
6. **Abgelöstes Dokument.** Die Sperre stützt sich auf `defaultView === null` nach Verlust des Browsing-Kontexts (in Chromium 158 gemessen).
7. **Prüfstand.** Frame-Prüfer mit gleichherkunftigen Frames und nachgebildeter IPC; Zeitfenster der Tests sind begrenzt. Die Filterlast aus dem Vorreview (Abschnitt H) ist unverändert.

## 14. Fehlende vollständige E2E-Abnahme

Nicht ausgeführt und nicht als erfolgreich zu werten: echte Browser-IPC zum gepinnten Desktop-Harness und die Extension-/Helper-Kette (Harness-Build an Maven 429 gescheitert), Desktop-Rust-Harness-Lauf, echte fremdherkunftige und verschachtelte iframe-Zustellung, Android-App-Annahme, tatsächlicher Browserdateidownload und Systemzwischenablage, Samsung/Vivaldi. Der Service-Worker-Start wurde nur in Chrome for Testing 158 beobachtet, nicht im vorgesehenen Debian-Chromium-Prüfstand.

## 15. Unveränderte Bereiche

`git diff 0cfe56c..97ae9b3` ist leer für `chrome/` (einschließlich `manifest.json` und `background.js`), `firefox/`, `channel/`, `vendor/` (einschließlich `vendor/hls.min.js`), `tools/`, `.github/` und `package.json`. Damit sind Browserberechtigungen, Signier- und Releasekonfiguration, P4-Lieferpins, WASM-/Harness-Pins und Produktionskonfiguration unverändert. Der Helper-Checkout ist unverändert und sauber; der Remote-Kopf von `test/s4b5-dash` ist `6e553fc`. Kein Merge nach `main`, keine APK, kein ZIP, keine Beta, kein Release, keine Installation.

**Stopp.** P0-B wird nicht begonnen. Die Sperre für automatische DASH-Downloads bleibt aktiv. Unabhängige Prüfung erforderlich.
