# P4b – „Stream speichern …“ (HLS über die Helfer-App), Kadri-Seite

Teststand. Produktion bleibt **UNAPPROVED**; grüne Tests sind keine Sicherheitsfreigabe. Nichts ausgeliefert.
Gegenstück im Helfer: `DOWNLOADS-P4B.md` (Branch `feature/c3-browser-downloads`, Draft-PR #27).

## Commits (Branch `feature/c3-helper-mp4`, Draft-PR #11)

- `83afa8f` P4b-7: Menüpunkt, Planverwaltung, strenge Nachrichten, Tests.
- P4b-8: separate P4-Testerweiterungsidentität, Doku (dieser Commit).

## Ablauf

1. Die Registry kennt nur Streams, die der Player **dieser Wiedergabe** tatsächlich geladen hat
   (`resolveStream` → Adresse + `bind{player,gen,rev}`); keine Seitenadressen auf Verdacht.
2. Der Eintrag „Stream speichern …“ erscheint nur, wenn der gekoppelte Helfer `hls` meldet (alter Helfer: ehrlicher
   Hinweis, kein Eintrag) und der Stream HLS ist; nichts startet von selbst.
3. Tipp → `hlsplan` → Untermenü mit Optionen (Qualität · Ton). Nicht unterstützte Formate → klarer Grund, keine Datei.
4. Auswahl → `hlsstart`; Fortschritt, Abbruch und Ergebnis über die bestehende Download-Verwaltung (`dlstatus`,
   `dlcancel`).
5. Unterbrochen → „Fortsetzen“: gleicher Stream (Schlüssel = Digest der Adresse ohne Query, Token dürfen wechseln) →
   neuer Plan, gleiche Option (Höhe, Breite, Bitrate, Ton), gleiche Auftragskennung. Veralteter Plan oder neue
   Kanal-Sitzung → genau ein erneuter Plan, danach klarer Fehler.

Pläne liegen nur im Speicher des Service Workers. Der Helfer erhält nie Cookies, Referer oder Authorization; die
Adresse erscheint nie in Hinweisen, Menü oder Protokollen.

## Tests

`tests/channel/hls_unit_check.js` (61), `tests/channel/hls_integration_check.js` (25, gegen die echte `HlsEngine` im
Desktop-Harness), `tests/test_hls.py` (24, echtes Chromium + echter ChannelServer), 8 HLS-Mutanten in
`tests/channel/channel_mutation_check.js`, `tests/channel/p4_identity_check.js`. Bestehende MP4-/Kanal-Tests
unverändert grün. Grenze: im Desktop-Harness ersetzt eine Test-Verkettung das Media3-Umpacken (echtes Umpacken prüfen
die Helfer-JVM- und Emulatortests).

## P4-Testerweiterungsidentität (Prüfung vor dem Samsung-Test)

Ergebnis: **nötig.** Die C3-Testerweiterung (`fhjmppadldgkhdgkdplpalmoooocoinn`) hält die Kopplung mit
`de.evp.helfer.channeltest`. Mit der neuen Testapp `de.evp.helfer.p4test` gekoppelt, würde sie diese Kopplung
überschreiben. Deshalb eine eigene Identität:

- `tools/p4test/identity.json`: ID `pcccpjllneffccpenbepmfbkjedllkkf`, öffentlicher Schlüssel (RSA-3072) für das
  `key`-Feld eines entpackten Testpakets „Kadri P4 TEST“. Der private Schlüssel wurde bei der Erzeugung verworfen; ein
  entpacktes Testpaket braucht ihn nicht, die ID bleibt dennoch fest.
- Geprüft (`tests/channel/p4_identity_check.js`): ID aus dem Schlüssel abgeleitet, verschieden von der bestehenden
  Erweiterung und vom C3-Paar, kein privates Material, Produktion UNAPPROVED.
- Gepackt und ausgeliefert wird sie erst in P4c (nach Freigabe), nach dem Muster des C3-Testpakets (nur Name,
  Beschreibung und `key` verschieden).
