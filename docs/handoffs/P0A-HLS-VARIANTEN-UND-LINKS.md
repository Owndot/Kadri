# P0-A · HLS-Varianten und gewöhnliche Links

Der Branch `fix/p0a-hls-variant-guard` stammt direkt von `bc830c8958b87c6b07011aaaaa35b75d9d182151`. Der vollständige Astra-Review `0ce2149c5c3067e38105bae2fb8efaf30c16edc1` ist dessen Dokumentationsnachfolger. Der Helper steht weiter auf `6e553fcb82b437ce0be487233dd35f41958bade6`. [Astra-Review](https://github.com/Owndot/Kadri/blob/0ce2149c5c3067e38105bae2fb8efaf30c16edc1/docs/handoffs/CODEX-REVIEW-MANIFEST-IDENTITAET.md)

## P0 · Schutz am HLS-Playlistabruf

Der P0-Commit ist `c247843ddad3e781666521dd7c3c8ae192d29cbf`. Der anschließende P2-Commit enthält diesen Übergabebericht.

Die bisherige Playerprüfung sah nur die Masteradresse. hls.js liest die Variantenadressen aus der Masterplaylist, löst sie relativ zur Playlist auf und verwaltet sie in `Level.url`. Bei der gebündelten Version 1.7.3 liefert `Level.uri` den ersten Eintrag. Die früheren CDN-Fallback-Methoden dieses Levelmodells sind veraltet. Content Steering kann weitere Pfade pro Variante liefern. Der Guard prüft das aktuelle Levelarray und die konkrete Transportadresse jedes einzelnen Abrufs. `currentLevel` und `nextLevel` wählen manuell, `startLevel` legt den Start fest und `loadLevel` steuert die manuelle Auswahl für kommende Ladevorgänge. Die automatische Wahl kann über `nextLoadLevel` weitere Abrufe auslösen. [Level-Implementierung](https://github.com/video-dev/hls.js/blob/v1.7.3/src/types/level.ts) · [hls.js-API 1.7.3](https://github.com/video-dev/hls.js/blob/v1.7.3/docs/API.md)

Der dokumentierte `pLoader` wird für Master-, Varianten-, Audio- und Untertitel-Playlists verwendet. Der davon abgeleitete XHR-Loader prüft `loadInternal` vor dem Netzwerktransport. Derselbe Einstieg wird bei Bibliotheks-Retries erneut durchlaufen. Das Ereignis `LEVEL_LOADING` bleibt ein Messpunkt. Der interne Listener kann den Abruf schon im selben Ereignis auslösen, bevor ein später registrierter Listener läuft. Der Guard prüft sowohl die effektive Query der Transportadresse als auch die ursprüngliche Adresse im Level oder Track. Damit greifen dieselben dokumentweiten MPD-Identitäten auch nach Verdrängung der Analysedaten und bei von hls.js angehängten Abfrageparametern. [PlaylistLoader](https://github.com/video-dev/hls.js/blob/v1.7.3/src/loader/playlist-loader.ts) · [XHR-Loader](https://github.com/video-dev/hls.js/blob/v1.7.3/src/utils/xhr-loader.ts)

Hauptplayer und Vorschau starten erst nach der Prüfung der initialen Level. Falls ein Level später gesperrt wird, entfernt Kadri ihn aus der Instanz und setzt die Wiedergabe an der aktuellen Position mit einem verbleibenden Level fort. Andere Ablehnungen gehen als lokaler 403 an hls.js. Kadri startet dafür keinen Netzwerk-Request oder eigenen Retry. Ein veraltetes Qualitätsmenü hält das ursprüngliche Levelobjekt und prüft die Zulässigkeit sowie dessen heutigen Index beim Klick. Die Vorschau verwendet eine eigene abgesicherte Instanz. Im nativen HLS-Pfad könnte Kadri die internen Variantenabrufe nicht prüfen. Deshalb verwendet der integrierte Player dort eine andere erlaubte Quelle oder spiegelt die schon laufende Seitenwiedergabe. Beim Rückfall und bei der Rückgabe auf die Seite startet er kein pausiertes Original mit bekannter MPD-Adresse.

| Datei | Betroffene Funktionen |
|---|---|
| `src/125-player-hls.js` | `hlsLevelAllowed`, `pruneHlsLevels`, `guardedHlsLoader`, `recoverHlsLevel` |
| `src/170-player-laden.js` | HLS-Initialisierung in `tryNext`, nativer Rückfall in `useCapture` |
| `src/190-player-menues.js` | `qualityItems` |
| `src/230-player-vorschau.js` | HLS-Vorschauinstanz und deren Ausfallpfad |
| `src/260-player-schliessen.js` | `handBack`, Prüfung beim unmittelbaren und verzögerten Weiterlaufen des Originals |

### Chromium-Rot/Grün

`KADRI_CHROMIUM=/usr/bin/chromium python3 tests/test_p0a_hls_variant_guard.py` ergab mit Chromium 156.0.8078.79 **3/13 auf der Basis und 13/13 nach P0**. Der identische Prüfer zählt das gezielte Einlesen der MPD-Fixture separat. Er verifiziert die verdrängte Zusammenfassung nach 44 weiteren MPD-Beobachtungen sowie die fortbestehende MPD-Identität.

| Fall | Chromium-Requests auf der Basis | Chromium-Requests nach P0 |
|---|---:|---:|
| MPD vor Menüöffnung, manueller Klick | 1 | 0 |
| Bereits geöffnetes Menü, manueller Klick | 1 | 0 |
| Automatische Levelwahl | 1 | 0 |
| Verzögerte Levelwahl | 1 | 0 |
| Initiale Levelwahl | 1 | 0 |
| Quellenwechsel und neue Medien-Epoche | 1 | 0 |
| HLS-Vorschau | 1 | 0 |
| Alternative Audio-/Untertitel-Playlist | je 1 | je 0 |
| Master-Retry nach Klassifikation während des ersten Abrufs | 1 Retry | 0 Retries |

Beim automatischen und verzögerten Wechsel meldete hls.js auch im grünen Lauf jeweils ein `LEVEL_LOADING`. Chromium zählte dabei keinen Request. Der Hauptplayer spielte in allen vier Wechselszenarien weiter. Das erneute Öffnen hielt das Veto aufrecht. Die erlaubte HLS-Variante mit anderer Query dekodierte nach manuellem und automatischem Wechsel. Die Vorschau dekodierte mit erlaubter Variante. Die unabhängige MP4 dekodierte mit fortschreitender Wiedergabezeit.

## P2 · Linkfreigabe nach Überlauf

Der alte Teilpfad verwendete die Medienzulassung für gewöhnliche Beitrags- und Seitenlinks. Diese allgemeine Zulassung lehnt nach dem Überschreiten des Identitätsbudgets jeden neuen Medienschlüssel ab. Ein ausdrücklich vom Aufrufer gewählter Beitragslink oder die eigene Dokumentadresse erhält jetzt einen festen Linkkontext. `mediaOutputFor` prüft weiterhin dieselbe Seiten- und gegebenenfalls Medienlebensdauer, dass die Zieladresse unverändert ist und dass der Vorgang keine MPD-Ablehnung erhalten hat. Erkannte MPDs, Typmerkmale und als konkret beobachtete Medienadressen bleiben ausgeschlossen. Ungetypte Ziele behalten den bestehenden Medienguard. Beim alten Parent-`postMessage` kann ein gültiger lokaler Seitenlink einspringen, falls das ungetypte Ziel die Medienprüfung nicht besteht.

Der exakte Identitätsbestand von 512 Einträgen und die Medienzulassung von 256 Einträgen bleiben wirksam. Über diese Grenze hinaus beobachtete MPD-Schlüssel markieren jeweils drei Bits in einem festen, erst beim Überlauf allokierten Filter von 8 KiB. Das bewahrt ein Veto für tatsächlich beobachtete MPDs mit irreführendem Pfad nach Verdrängung aus dem Analysecache. Der Filter hält keine URLs, lebt nur im Dokument und kann durch Bitkollisionen auch einen gewöhnlichen Link vorsorglich verweigern. Die Komponententests messen keine Fehlablehnungsrate unter Dauerlast.

Beim Weiterleiten bleibt die Auswahl beim sendenden Frame. Der Browser-Relay adressiert weiterhin das konkrete Dokument über `frameId` und `documentId`. Ein einmal getippter Share-Vorgang läuft im Hauptdokument unter einem Framekontext, der bis zum Clipboard-Fallback gültig bleiben muss. Die zusätzliche Ergebnisart `share-page` durchläuft dieselbe Antwort-Sanitisierung. Laufende Share-Vorgänge werden vor Doppelklicks geschützt.

| Datei | Betroffene Funktionen |
|---|---|
| `src/040-quellen-netzwerk.js` | `rememberMpdIdentity`, `overflowMpdBits`, `mayBeOverflowMpd` |
| `src/045-media-source.js` | `mediaOutputFor` |
| `src/270-links-teilen.js` | `onDownload`, `pageLinkAllowed`, `pageLinkOutputFor`, `sharePageLink`, `shareLinkTo`, `shareUrl` |
| `src/105-download-knopf.js`, `src/180-player-bedienung.js` | Download-Alternativen und explizite Seiten-/Beitragsaktionen |
| `src/090-oeffnen-download.js` | `copyText` liefert die Lebensdauer des Clipboard-Fallbacks zurück |
| `src/035-fenster-oberflaeche.js`, `chrome/background.js` | Linkkontext bei Fensteraktion, Auswahl und Rückgabe, sowie Ergebnis-Sanitisierung |

### Chromium-Rot/Grün

`KADRI_CHROMIUM=/usr/bin/chromium python3 tests/test_p0a_page_link_budget.py` mit identischer Prüfdatei ergab **3/11 auf der Basis und 11/11 nach P2**. Nach Überlauf wechselten die Zähler bei Beitrags- und Seitenlinks von null auf genau einen vorgesehenen Share- oder Kopieraufruf. Nach einem Share-Fehler erreichte der gültige Link einmal den verzögerten Clipboard-Fallback. Ersetzte und navigierte Frames lösten null verspätete Share-Aktionen aus. Beim später entfernten Frame blieb der zusätzliche Kopieraufruf aus. Die MPD-Kontrolle mit Beitragsform blieb gesperrt. Nachträgliche MPD-Erkennung während der Medienausgabe unterband den Clipboard-Fallback. Die Prüfer zählen die Aufrufe der Browser-APIs im Komponentenprofil.

## Regressionen und Restgrenzen

| Gruppe | Ausgeführte Prüfungen |
|---|---|
| Chromium | MPD-Identität 13/13, B.1 8/8, B.2 20/20, Produktgrenze B1–B4 10/10 |
| Chromium-DASH | Parser 61/61, Gate 122/122, Fingerabdruck 30/30, Backfill 23/23, Alternativen 12/12, URL-Parameter 32/32, unbekannter Start 18/18 |
| Node-Quellen und Diagnose | Registry 140/140, Manifestmodell 35/35, Bindung 32/32, Epoche 13/13, DASH-Diagnose 32/32, DASH-Downloaddiagnose 19/19, Download-Diagnose 102/102, DASH-Nachrichten 64/64, Downloadblatt 20/20 |
| Node-Relay | Frame-Relay 33/33, Frame-Ergebnis 35/35, Frame-RID 36/36 |
| Kanal | DASH 104/104, Kanal 45/45, MP4/Download 143/143, HLS 97/97. MP4-Vorgängerregression ebenfalls bestanden. |
| Weitere Node-Regressionsprüfer | Chrome-/Firefox-Netzschutz, Header-Kontext, Download-Quellen, Helper-Route, Fixtures, Player-Priorität, PiP, Popup, Proxy, Referer und Vertraulichkeitswächter. Insgesamt 31 Node-Prüfprogramme erfolgreich. |
| Ungepackter Build | Chromium-Testfassung in einem temporären Verzeichnis mit der vorhandenen Buildroutine und ihrer Syntaxprüfung erzeugt. |

A1 blockiert `dashplan` und `dashstart`. A2 belässt dokumentweite DASH-Beobachtungen bei der Diagnose. Die vier ursprünglichen Gegenproben B1–B4 ergaben an der Produktgrenze keine neue DASH-Planung oder keinen Start. B.1, B.2, B.3 und der persistente Identitätsschutz innerhalb des Dokuments bleiben wirksam. Browserberechtigungen, Vendorbibliothek, Helper, Signierung, P4-/WASM-/Harness-Pins und Lieferworkflows wurden nicht geändert.

Die HLS-Prüfung deckt alle URL-Eingaben des Playlist-Loaders ab. HTTP-Zwischenziele, denen der Browser innerhalb eines bereits erlaubten Transports folgt, sieht dieser Einstieg vorab nicht. Für Content Steering mit tatsächlich wechselnden CDNs und für natives HLS liegt kein eigener Gerätetest vor. Die Frame-Komponente verwendet echte gleichherkunftige iframes und nachgebildete Browser-IPC. Der Service-Worker der ungepackten Erweiterung war in einer aktuellen 12-Sekunden-Probe weiterhin nicht erreichbar. Der Desktop-Helper-Harness blieb ohne `rustc`, `cargo` und `HELPER_HOST_DIR` offen. Vollständige Extension-/Helper-E2E-Abnahme, fremdherkunftige bzw. verschachtelte Frame-IPC und Samsung/Vivaldi-Geräteabnahme stehen aus.
