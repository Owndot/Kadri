# Kadri

**Kadri** ist ein schlanker Vollbild-Video-Player als Browser-Erweiterung: Ein Knopf am laufenden Video öffnet es
in einem eigenen Player mit Wischgesten, Spul-Vorschau, Untertiteln, Ambient-Licht, Sleep-Timer und Download über
YTDLnis. Für Vivaldi und Chrome auf Android (und am Computer), eine Firefox-Fassung ist vorbereitet.

Kadri ist die Erweiterungs-Fassung des Userscripts „Video-Assistent“. Beide bestehen aus demselben Code.

## Installieren in Vivaldi auf Android

1. **Entpacken:** Die Datei `kadri-chrome-<Version>.zip` aufs Handy laden und entpacken. Es entsteht ein Ordner mit
   `manifest.json` darin.
2. **Desktop-Ansicht einschalten:** In Vivaldi im Menü **Desktop-Seite** einschalten. Vivaldi verlangt das beim
   Verwalten von Erweiterungen.
3. **Ordner laden:** Über das Puzzle-Symbol in der Adressleiste **Erweiterungen verwalten** öffnen, dann
   **Entwicklermodus** einschalten. Danach **Entpackt laden** wählen und den entpackten Ordner auswählen.
4. **Userscript abschalten:** Den Video-Assistent in Violentmonkey ausschalten, sonst laufen beide. Laufen doch
   beide, gewinnt der, der zuerst startet, und der andere bleibt still.

Für ein **Update** einen neuen Ordner entpacken und in der Erweiterungsliste bei Kadri auf **Neu laden** tippen,
oder den alten Ordner ersetzen. Kadri aktualisiert sich nie von selbst.

## Was kann Kadri?

- **Player:** Datei-Videos und Streams (HLS über das mitgelieferte hls.js), Vollbild, Drehen, Zoom per Doppeltipp.
  - Wischen spult und regelt die Lautstärke.
  - Wo Kadri das Video nicht selbst laden kann, spiegelt es das Video der Seite.
- **Richtiger Stream:** Kadri liest die Stream-Listen mit, die die Seite lädt, und erkennt so den Stream, der wirklich
  läuft. Das gilt auch, wenn die Seite schon das nächste Video vorlädt oder das Video wechselt, ohne neu zu laden
  (z. B. ARD-Mediathek).
- **Facebook und Instagram:** Ist sicher, welches Video läuft, spielt Kadri die fertige Datei mit Ton selbst ab. Dann
  gehen Bild-in-Bild, Hintergrund und Spulen wie auf jeder anderen Seite. Sonst spiegelt Kadri das Video der Seite.
  Auch dann geht Bild-in-Bild, weil Kadri vor der Seite verbirgt, dass sie im Hintergrund ist.
- **Reels:** Am Ende hält Kadri an und bricht den Countdown „Nächstes Reel“ ab. Teilen nimmt das laufende Reel.
- **Mehr Seiten:** Kadri erkennt Streams auch dann, wenn ihre Adresse nicht danach aussieht oder die Seite sie im
  Hintergrund lädt.
- **Download und Teilen:** Download über YTDLnis oder das Teilen-Menü, Speichern im Browser.
- **Menü im Puzzle-Symbol:** Kadri für die Seite an- oder ausschalten, Zustand der Helfer-App, Diagnose.
- **Einstellungsseite:** alle Einstellungen des Players an einem Ort, dazu die Seitenlisten: wo Kadri aus ist, wo nur
  der Download erscheint, welche Seiten YTDLnis kennt.

## Mit und ohne Helfer-App

Kadri funktioniert ohne die Helfer-App. Was nur mit ihr geht, ist dann ausgeblendet:

| | ohne Helfer | mit Helfer |
|---|---|---|
| Lautstärke (rechts wischen) | – (ausgeblendet) | echte Lautstärke des Handys, fein abgestuft |
| Helligkeit (links wischen) | – (ausgeblendet) | echte Bildschirmhelligkeit, ganz unten „Auto“ |
| Download-Menü | YTDLnis, Teilen, Browser | zusätzlich „Mit dem Helper“ und „Über den Browser laden“ |
| Einstellung „Helper-App“ | – | an/aus |

Koppeln wie bisher: In der Helfer-App auf **Verbinden** tippen. Die Seite, die sich dann öffnet, speichert den
Schlüssel in Kadri.

## Für Entwickler

Siehe [ENTWICKLUNG.md](ENTWICKLUNG.md). Kurz: `node tools/build.js` baut `dist/`. `node tools/build.js --test &&
tests/run_all.sh` testet in Chromium mit geladener Erweiterung.

## Lizenz

GPL-3.0 (siehe `LICENSE`). Enthält [hls.js](https://github.com/video-dev/hls.js) unter der Apache-Lizenz 2.0
(siehe `vendor/hls.LICENSE`).
