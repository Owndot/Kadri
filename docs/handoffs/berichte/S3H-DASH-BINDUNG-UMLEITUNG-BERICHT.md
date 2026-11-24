# S3h – Fehlende DASH-Bindung auf dem Samsung: Ursache nachgewiesen, Testseite korrigiert

Stand 23.11.2026.

- **Nur die Testseite geändert.** Kein DASH-Produktcode, keine Lockerung des Hostvergleichs, keine Sicherheitsregel geändert.
- **Keine neue APK, keine neue Erweiterungs-ZIP.** Kadri 1.12.18 und Helfer 4 bleiben.
- Einziger Push: der Testbranch `test/s3h-dash-page-redirect` (`4290251`). `main` ist unverändert (`cd00ded`).

## 1. Ursache (nachgewiesen)

**Dein Verdacht stimmt.**

| Abruf | Antwort von `rawcdn.githack.com` |
|---|---|
| `s3d-dash.html` | **200**, die Seite selbst. Im Browser erscheint zuvor einmal die githack-Hinweisseite „One more step – Open the page“. |
| `s3d-dash/manifest.mpd` | **301** → `raw.githubusercontent.com`, **gleicher Pfad** |
| `s3d-dash/init-*.m4s`, `chunk-*.m4s` | **301** → `raw.githubusercontent.com`, **gleicher Pfad** |
| Ziel `raw.githubusercontent.com` | 200, starker ETag, `Access-Control-Allow-Origin: *`; Bytes identisch mit `SHA256SUMS` |

So entsteht der Befund:

1. **Kadri:** Die Seite lädt das MPD bei `rawcdn.githack.com`, die Antwort kommt nach der Weiterleitung von `raw.githubusercontent.com`. Kadri (`src/040`, `finalUrl || reqUrl`) baut den Stückindex richtig aus der **endgültigen** Adresse.
2. **Alte Testseite:** Sie löste die Stück-Adressen gegen die **angefragte** MPD-Adresse auf (`new URL(MPD, location.href)`). Jedes Stück ging deshalb zuerst an `rawcdn.githack.com` und erst über die 301-Weiterleitung an `raw.githubusercontent.com`.
3. **Zeitleiste:** Die Ressourcen-Zeitleiste des Browsers führt für solche Abrufe die **Ausgangsadresse**.
4. **Ergebnis:** Kadri sieht denselben Pfad auf einem anderen Host. Das ergibt „gleicher Pfad, anderer Host“, „Init anderer Host“, Stücke exakt 0 und `ambiguous (keine-treffer)`. Kadris strenge Prüfung hat damit **korrekt** nicht gebunden.

Echte Player wie dash.js und Shaka lösen gegen die endgültige Adresse auf. Der Fehler lag allein in der Testseite.

**Nachweis mit echtem Netz und echter Erweiterung 1.12.18** (Desktop-Chromium, githack-Hinweisseite durchgetippt wie auf dem Gerät):

| Seite | Hosts | DASH-Abgleich | Ergebnis |
|---|---|---|---|
| alt `bf9bc06` | – | Stücke exakt **0** · gleicher Pfad, anderer Host **6** · Init exakt 0 | `ambiguous (keine-treffer)` (= Samsung-Befund) |
| neu `4290251` | Seite `rawcdn.githack.com` · MPD angefragt `rawcdn.githack.com` · MPD endgültig `raw.githubusercontent.com` · Stücke `raw.githubusercontent.com` | Stücke exakt **6** · anderer Host **0** · Init exakt **2** · Init anderer Host **0** | **`bound (stueckfolge)`**, `Bindung bound(…dash-segments)`, Vorprüfung bestanden |

Für diesen Nachweis braucht die Sitzung Zugriff auf `rawcdn.githack.com`. Dafür habe ich mit deiner Bestätigung die persönliche Umgebung „Owndot Kadri + Helfer (Testauslieferung)“ angelegt: wie bisher, zusätzlich nur dieser Host.

## 2. Fix (nur Testseite `tests/web/public/s3d-dash.html`)

- **Auflösung:** Stück- und Init-Adressen werden jetzt gegen die **endgültige MPD-Adresse** aufgelöst (`Response.url` des MPD-Abrufs), wie bei dash.js und Shaka. Die Stücke kommen damit direkt vom Ziel-Host, ohne Weiterleitung.
- **Neue Hostzeile:** Unter dem Status zeigt die Seite die Hosts, ohne Pfad und ohne Query: Seite · MPD angefragt · MPD endgültig · Stücke.
- **Medien:** Fixture und Prüfsummen sind unverändert. `tests/s3d_dash_page_check.py` und `tests/p4_device_page_check.py` bestehen.

## 3. Regression `tests/s3d_dash_page_redirect_e2e.py` (lokal, **20 von 20**)

**Aufbau:** Ein lokaler Server liefert wie githack aus:
- HTML direkt;
- `.mpd` und `.m4s` per 301 auf einen anderen Host mit gleichem Pfad.

Dazu kommen die echte Erweiterung (1.12.18-Testbuild) und der echte Kanal-Helfer (`3887569` = `ee54864` + nur Testcode).

**1. Gegenprobe:** dieselbe Seite mit der früheren Auflösung. Sie reproduziert exakt den Samsung-Befund:
- jedes Stück zuerst beim Seiten-Host angefragt;
- Stücke exakt 0, gleicher Pfad und anderer Host 6, Init anderer Host 2, sonst kein Unterschied;
- `ambiguous (keine-treffer)`, Vorprüfung bestanden;
- **kein Angebot**, nur „Vermutlich DASH-Stream – nicht sicher zugeordnet …“.

**2. Korrigierte Seite:**
- Hostzeile korrekt (MPD weitergeleitet, Stücke direkt vom Ziel), alle Stücke beim Ziel-Host;
- Stücke exakt 6, Init exakt 2, anderer Host 0;
- **`bound` über `dash-segments`**, `Ergebnis bound (stueckfolge)`, Vorprüfung bestanden, Diagnose anonym;
- Angebot „DASH-Stream mit Helper herunterladen …“;
- **`dashplan`**: 360p (läuft gerade) und 180p, H.264 + AAC. Der Helfer lud das MPD selbst von der endgültigen Adresse, ohne Cookie und ohne Authorization;
- **`dashstart`**: Datei beim Helfer, 824 580 Byte (Init + 5 Video- + 6 Tonstücke). Der Helfer lud nur vom Ziel-Host, nur 360p und Ton, ohne Cookie und ohne Authorization;
- keine Seitenfehler.

**Unterwegs bestätigt (unverändert, korrekt):**
- Der Helfer lehnt als Ziel den Namen `localhost` mit `blocked_host_name` ab. Die Regression nutzt deshalb einen gewöhnlichen Namen, den Browser und Gegenstelle lokal auflösen.
- Im echten Fall ist das Ziel der öffentliche `raw.githubusercontent.com`.

**Weitere Prüfungen:**
- `tests/s3d_dash_page_e2e.py` (ohne Weiterleitung): alle Prüfungen bestanden. Dabei die Pfadnormalisierung korrigiert, nur Testcode.
- Seitenprüfung, P4-Seitenprüfung und `confidential_names_check` grün.

## 4. Neue commitgebundene HTTPS-Testadresse

`https://rawcdn.githack.com/Owndot/Kadri/4290251693e9f232fb219b95077538758cac5129/tests/web/public/s3d-dash.html`

## 5. Erneute Prüfung auf dem Samsung (Kadri 1.12.18, Helfer 4)

1. **Seite öffnen.** Erscheint die githack-Seite „One more step“, auf **„Open the page“** tippen.
2. **Unter dem Video prüfen.** Erwartet:
   - „MSE H.264 ja · AAC-LC ja“;
   - grün „Stückfolge aktuell …“;
   - darunter neu: `Hosts: Seite rawcdn.githack.com · MPD angefragt rawcdn.githack.com · MPD endgültig raw.githubusercontent.com · Stücke raw.githubusercontent.com (MPD weitergeleitet – Stücke direkt vom Ziel)`.
3. **Ton einschalten**, über den Lautsprecher in der Bedienleiste.
4. **Diagnose, noch im grünen Fenster:** Kadri-Menü → Diagnose → „Anonymisiert kopieren“. Erwartet:
   - `Helfer-Fähigkeiten: MP4 ja · HLS ja · DASH ja …` (nachdem einmal ⬇ angetippt wurde; sonst „noch nicht abgefragt“);
   - `Bindung bound(…dash-segments)`;
   - `DASH-Stückprüfung 1/1: … Ergebnis bound (stueckfolge) · Vorprüfung bestanden`;
   - `DASH-Abgleich …: Stücke exakt ≥ 6 · … gleicher Pfad, anderer Host 0 · … Init exakt ≥ 2 · … Init anderer Host 0`;
   - `Auswahl DASH: Manifest gebunden · Kadri-Vorprüfung bestanden · Angebot ja`.
5. **⬇ antippen.** Erwartet: „DASH-Stream mit Helper herunterladen …“.
6. **Angebot antippen.** Erwartet `dashplan`: „360p · Ton: Sprache nicht angegeben“ (läuft gerade) und „180p …“.
7. **360p antippen.** Erwartet `dashstart`: „Helfer-App lädt …“. In der Diagnose: `Helfer-Downloads 1. Typ dash · … Aufruf dashstart`.
8. **MP4 prüfen** in `Download/Video-Assistent`: 0:20, 640×360, Blitz und Piepton gleichzeitig, spulbar.

Wird das grüne Fenster überschritten: „Neu starten · 360p“ antippen, dann Schritte 3–5 wiederholen.

**Nicht verändert und nicht installiert:** Am Samsung habe ich nichts geändert.

## 6. Dateien

| Datei | Inhalt |
|---|---|
| `S3H-DASH-BINDUNG-UMLEITUNG-BERICHT.md` | dieser Bericht |
| `regression-umleitung-20von20.log` | lokale Regression (Gegenprobe + korrigierte Seite, Ende zu Ende) |
| `oeffentlich-alt-bf9bc06.log` / `oeffentlich-neu-4290251.log` | echte öffentliche Adresse, alt vs. neu (Bindung, anonyme Diagnose) |
| `kadri-s3h-4290251.patch` | der Commit (Testseite, Regression, Pfadkorrektur im Testskript) |
| `SHA256SUMS` | Prüfsummen |
