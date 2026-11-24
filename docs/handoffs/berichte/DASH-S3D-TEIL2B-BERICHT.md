# S3d Teil 2b – Signierplan, Sheet-Fix, REF-PRIV, Kadri 1.12.17 (Bericht)

Stand: 22.11.2026. Nur isolierte Testbranches:
- Kadri `test/s3d-dash` → `520c0bf`;
- Helfer `test/s3d-p4-unsigned` → `1e0f5f5`.

Kein Merge, kein Release. **Nichts signiert, installiert oder deinstalliert.** Keine APK und keine ZIP ausgeliefert.

## 1. Signatur (Entscheidung 1)

**Sicherung des alten Schlüssels: keine vorhanden.**
- Der Schlüssel entstand nur im Runner-Temp-Ordner, wurde nach einmaligem Signieren mit `shred` gelöscht, und der Schritt prüft, dass kein Schlüsselmaterial übrig bleibt.
- Das Artefakt war strikt auf vier Dateien geprüft und ist nach 2 Tagen abgelaufen.
- Weder Secrets noch Cache. Auch in dieser Umgebung gibt es keine passende Datei.
- Dabei wurde kein vertrauliches Material übertragen.

**Signierplan:** `signierplan/SIGNIERPLAN-P4-TERMUX.md`.
- Dauerhafter Eigentümerschlüssel nur im privaten Termux-Bereich, verschlüsselte Offline-Sicherung (`gpg`, zwei Träger), Paket bleibt `de.evp.helfer.p4test`.
- Ablauf: Termux einrichten → unsignierte APK übernehmen → Schlüssel erzeugen → Sicherung → Trockenlauf mit Wegwerfschlüssel → echt signieren → (eigene Freigabe) Migration.

**Termux geprüft:** Die Pakete `openjdk-21`, `apksigner` 37.0.0 und `aapt2` existieren. `zipalign` und `llvm-readelf` fehlen. Dafür liegen zwei Werkzeuge bei:
- `p4-termux-sign.sh` – dieselben Prüfungen und `apksigner`-Optionen wie `tools/p4test/sign.sh`.
- `p4-termux-verify.py` – Abnahme wie `verify-p4` plus selbst nachgerechnete 16-KB- und PT_LOAD-Prüfung.
  - Selbsttest 4/4.
  - In CI gegen die echte unsignierte APK: `P4-TERMUX-NATIVE PASS`.
  - Als `tools/p4test/termux-verify.py` im Testbranch, Commit `c08f10b`.
- Offen und erst auf dem Gerät prüfbar: ob `apksigner` 37 die 16-KB-Ausrichtung erhält. Das klärt der Trockenlauf T5; der Prüfer lehnt sonst ab.

**Unsignierte APK reproduzierbar über Läufe hinweg:**
- `ee54864`, `versionCode 4`, `versionName 1.0.4-p4test`: SHA-256 `2667665f3bd5e6753a9ab2d0cedc9c9cf088d0bf0013fcad36979964419445b3`.
- Vier unabhängige Builds in den Läufen [45056273523](https://github.com/Owndot/video-assistent-helper/actions/runs/45056273523) und [45056637910](https://github.com/Owndot/video-assistent-helper/actions/runs/45056637910).
- Befund dabei: `versionName` hängt laut `app/build.gradle` an `GITHUB_RUN_NUMBER`. Frühere Läufe gaben deshalb `1.0.1`/`1.0.2` mit anderem SHA-256. Der Build bekommt die Nummer jetzt fest gleich dem `versionCode`; die installierte Nr. 3 heißt entsprechend `1.0.3-p4test`.
- Identität wie die Referenz `e748180`: Paket, Bezeichnung, die 12 Berechtigungen und das Manifest sind gleich, nur `versionCode`/`versionName` unterscheiden sich.

**Datenverlust bei einmaliger Deinstallation (Plan Abschnitt 2):**
- Verloren gehen Kanal-Identität und Kopplungen; Kadri muss einmal neu koppeln.
- Ebenso verloren: Keystore-Schlüssel, laufende und unterbrochene MP4-/HLS-/DASH-Aufträge, Teildownloads, Einstellungen und Systemfreigaben.
- Erhalten bleiben die fertigen Downloads in `Download/Video-Assistent`, belegt mit „PERSIST_AFTER_UNINSTALL ok“ auf API 26, 29 und 34.
- **Eine verlässliche Sicherung ist nicht möglich**, und das ist beabsichtigt: `allowBackup=false`, Extraktionsregeln schließen alles aus, und Identität sowie Tresor hängen an nicht exportierbaren Keystore-Schlüsseln.

## 2. S3D-SHEET-BACK-141 – Produkt-Fix (Entscheidung 2)

**Ursache – korrigiert gegenüber meinem letzten Bericht.**
- Reproduziert mit Chrome for Testing 141.0.7390.37, also der CI-Fassung, und mit Diagnoseprotokoll.
- Die Zurück-Taste bei offenem Blatt war nie falsch. Der Fehler entsteht so:
  1. Unter 141 scrollt ein Wisch im Blatt die Seite mit (y 0 → 54).
  2. Nach dem Schließen stellt Kadris eigenes `history.back()` den Scrollstand vom Öffnen wieder her. Die Seite springt (y 54 → 0).
  3. Das Scrollen blendet ⬇ für 380 ms aus (`pointer-events:none`).
  4. Ein sofortiger Tipp trifft deshalb die Seite (`BODY`), das Blatt öffnet nicht, und erst die nächste Zurück-Taste verlässt die Seite.
- Chrome 153 löst kein einziges Scroll-Ereignis aus.

**Fix** (`da28290`, nur Verlaufscode in `src/105`, +18 Zeilen):
- Hat die Seite `history.scrollRestoration = "auto"`, wird der Wert für den Seiteneintrag nur für die Dauer des eigenen Blatt-Eintrags auf `"manual"` gesetzt; der eigene Eintrag bleibt `"auto"`.
- Nach der Rückkehr (eigenes Zurück oder Zurück-Taste) wird er wieder `"auto"`.
- Seiten mit `"manual"` bleiben unangetastet.

**Regressionstest** (`test_dl_sheet.py`, jetzt 41 Prüfungen statt 35):
- sofort wieder antippbar;
- Seite nicht gescrollt und Einstellung unverändert, nach Außentipp und nach der Zurück-Taste;
- eine Seite mit `"manual"` bleibt `"manual"`;
- bestehende Prüfungen: Mehrfaches Öffnen/Schließen, Seitenwechsel zur HLS-Seite (Quellwechsel MP4 → HLS mit Qualitätsauswahl), kleines Display.

| | Chrome 141.0.7390.37 | Chrome 153.0.8010.12 |
|---|---|---|
| mit Fix | 41/41 | 41/41 |
| **ohne Fix (Gegenprobe)** | **rot**: Scrollsprung `[0,54] → [0,0]`, Tipp verloren, Seite verlassen, Absturz | 41/41 |

**Volle Regression mit Fix, lokal, beide Browser – alles grün:**

| Test | Ergebnis |
|---|---|
| `test_helper` | 18/18 |
| `test_menu` | 7/7 |
| `test_mp4` | 141/141 |
| `test_hls` | 24/24 |
| `test_direct_dl` | 87/87 |
| `test_dl_sheet` | 41/41 |
| `test_frame_ui` | 61/61 |
| `test_dash_msg` | 23/23 |
| `test_dash_bind` | 28/28 |
| `test_dash_dl` | 30/30 |
| `test_dash_fp` | 29/29 |
| `channel-browser` | 34/34 |

**CI** [Kadri ci.yml 45055438062](https://github.com/Owndot/Kadri/actions/runs/45055438062) @ `520c0bf` (Chromium 141):
- Versuch 2:
  - build-test, dnr-scope, helper-key-regression, proxy-memory-regression **PASS**;
  - helper-channel: WASM-Neubau, Gegenstelle, alle Kanalschritte und 53/53 Mutanten **PASS**;
  - **der ganze Python-Browserschritt PASS**, darunter `test_dl_sheet` 41/41 und `test_mp4` 141/141;
  - P4-Erweiterungsidentität mit zwei Bauwegen **PASS**.
- Versuch 1: einmalig „HLS: Stream-Eintrag im Blatt“ leer (36/37). Lokal 7 Läufe, auch mit nur einem CPU-Kern, ohne Fehler; im Neulauf grün. Ich führe das als nicht reproduzierten Einzelausfall und beobachte es weiter.
- [dash-e2e 45055433406](https://github.com/Owndot/Kadri/actions/runs/45055433406) **PASS**.

**Letzte rote Stelle – P4-Lieferpaar (beabsichtigtes Tor, kein Testfehler):**
- Der Schritt verlangt, dass Kadris Dateien mit der gesperrten P4-Lieferquelle `SOURCE_SHA` in `p4-test-extension.yml` identisch sind, also mit dem alten Stand `7978a41`.
- Jeder spätere Produktstand fällt dort durch; zuletzt grün war das am 17.11.
- Lösung nur über neue Lieferpins im gesperrten Lieferworkflow (eigene Freigabe), nicht geändert.

## 3. S3D-REF-PRIV – vorläufig akzeptiert (Entscheidung 3)

Die Normerwartung „B kommt ohne Referer an“ ist aus `test_mp4.py` entfernt (`520c0bf`). Geprüft wird weiter das Sicherheitsrelevante:
- genau zwei Abrufe;
- nie Cookie, Authorization oder Range;
- A ohne Referer;
- ein Referer höchstens die Seite.

**Offener P2-Befund S3D-REF-PRIV:** Auf privaten Zielen (LAN, 127.0.0.1) verdrängt Kadris Freigaberegel (`allow`, Priorität 20) die Referer-Regel (Priorität 1). Diagnosevariante B kommt dann ohne Referer an. Öffentliche Ziele sind nicht betroffen. Später gezielt beheben.

## 4. Kadri 1.12.17 (Entscheidung 4)

Nur die Versionsnummer (`61d3496`): `package.json` liefert beim Build über `__VERSION__` die Manifest-Version.

ZIP „Kadri P4 TEST“ aus `520c0bf`:
- zwei unabhängige Builds (Arbeitsbaum und frischer Klon) **bitgleich**: `bf685a122610c7f7c926ba9016629238e67e0659b6a90f15301c83ba11b706fa`;
- Inhalt `42252ba42e7fba6c2f5821849be765ea289d4c0fec0b10b04677ad7e2d9cacc1`, 30 Dateien.

Gegen die installierte Fassung (`c302244`, Inhalt `b6e00416…` wie Lauf Nr. 3):
- ID **`pcccpjllneffccpenbepmfbkjedllkkf`**;
- Manifest-Unterschied **nur** `version` 1.12.16 → 1.12.17;
- Rechte `storage`, `declarativeNetRequestWithHostAccess`, `scripting`, `<all_urls>` unverändert;
- `rules.json`, `kadri_pairing_poc_bg.wasm` und `kadri_pairing_poc.js` byteidentisch;
- dieselbe Dateimenge; geändert sind nur `background.js`, `content.js`, `sub.js` und die drei Kanal-Skripte;
- Kopplungs- und Speicherschlüssel (`kadri-channel`, `kadri-dl-jobs` …) unverändert.

## 5. Prüfpatches (SHA-256)

| Datei | Inhalt | SHA-256 |
|---|---|---|
| `kadri-s3d-da28290-sheet-fix.patch` | **separater Sheet-Fix** + Regressionstest | `45ed28eae653e7ac5697ed4829f3314ea85422035da5ab702892296afa823265` |
| `kadri-s3d-61d3496-version.patch` | Kadri 1.12.17 | `4aec10943b3ed34d1178bc23802d8534f63f0444ad8e98874970f19bc3803bf5` |
| `kadri-s3d-520c0bf-refpriv.patch` | REF-PRIV keine Norm | `e120eb816b492ec1146bf9ded55b15d4bbd90c31d91a6a16146ad4069fd1dd11` |
| `helper-p4-unsigned-series/0001…` | unsignierter Vergleich (`8e9cfce`) | `d1b08768b2c30e28d7f684ab4500eb85385ebc4e049a0cf0909e699f7c322e21` |
| `helper-p4-unsigned-series/0002…` | Termux-Prüfer (`c08f10b`) | `4548ed7a77ae976f870bea1d03a1df3f4d9b02d7a3280d065a2d51b0c9aa936d` |
| `helper-p4-unsigned-series/0003…` | versionName fest (`e747533`) | `28620f1e1071c513f6ab4262e42c07bfa7f136a1d529892f63402f0c821afcd4` |
| `helper-p4-unsigned-series/0004…` | Manifestvergleich (`1e0f5f5`) | `1521e8f2eae3d73ffc532d04e600189d5b45b061aaeac89a6724e6a741bacbd9` |
| `signierplan/SIGNIERPLAN-P4-TERMUX.md` | Plan | `48b1c70fbf61903c7708866121709dee5e4465a9f188e58f0466add38ba9e5c5` |
| `signierplan/p4-termux-sign.sh` | Termux-Signierskript | `9302b8a62226129fa0a84caa909549e4d387f854eb89fa1ef0b6190f982e1b86` |
| `signierplan/p4-termux-verify.py` | Termux-Abnahme | `7ba6ecc44a41cbe3b909a1cab9eebe90981da3af8fc293dc08837bd3601e3e0c` |

## 6. Nachtrag – Umsetzung der Freigabe (T1–T6 GO, T7 NO-GO)

### 6.1 Unsignierte Helfer-APK – bereitgestellt
Datei `helper-p4test-unsigned-4.apk`, **nicht installierbar** (unsigniert).

| Eigenschaft | Wert / Nachweis |
|---|---|
| SHA-256 | `2667665f3bd5e6753a9ab2d0cedc9c9cf088d0bf0013fcad36979964419445b3`, 1 810 910 Byte |
| Quell-Commit | `ee5486442266f2730893353ac71611809dfd21b1` (laut `META-INF/version-control-info.textproto`) |
| Paket | `de.evp.helfer.p4test`, versionCode 4, versionName `1.0.4-p4test` |
| Herkunft | Übergabe-Workflow `s3d-p4-handover.yml` (`aeada50`), Lauf [45061847009](https://github.com/Owndot/video-assistent-helper/actions/runs/45061847009) |
| Prüfung hier | `P4-TERMUX-NATIVE PASS`; keine Signaturdateien |

Zum Übergabeweg:
- Der Workflow baut die APK wie die vier Vergleichsbuilds, bricht bei abweichendem SHA-256 ab und gibt die Datei nur als nummerierte Base64-Zeilen im Joblog aus. Es gibt kein Artefakt und keinen Schlüssel.
- Hier aus 805 Zeilen zusammengesetzt und unabhängig geprüft (SHA-256 und Größe).
- Hinweis: Der Zeilenzähler im Log lautet 804, weil `wc -l` die letzte Zeile ohne Zeilenumbruch nicht zählt. Maßgeblich ist der SHA-256.

### 6.2 Termux-Werkzeuge und Anleitung

| Datei | SHA-256 |
|---|---|
| `p4-termux-sign.sh` | `c29f90b7951efd0b91b9163f9e2375fdf33e2bc7a6a4a1ef465be945c35f18fd` |
| `p4-termux-verify.py` | `7ba6ecc44a41cbe3b909a1cab9eebe90981da3af8fc293dc08837bd3601e3e0c` (= `tools/p4test/termux-verify.py` in `c08f10b`) |
| `ANLEITUNG-SAMSUNG-TERMUX-T1-T6.md` | `7f89a95818e44e461b5eb9c50bf1c28e619917e92f2ec4ee9b579846619e59c1` |
| `SIGNIERPLAN-P4-TERMUX.md` | `eda0a3ad7a320533dd9702b3095affe19ed0921178c6fe0252d094a99a554395` |

- Änderung gegenüber dem letzten Stand von `p4-termux-sign.sh`: Die Prüfung „Schlüssel im privaten Termux-Bereich“ vergleicht jetzt mit dem aufgelösten `$HOME`. Je nach Android-Version heißt dieser Ordner `/data/data/…` oder `/data/user/0/…`; die feste Pfadprüfung hätte den Schlüssel sonst fälschlich abgelehnt.
- Die Anleitung enthält T1–T6 mit erwarteten Ausgaben und STOP-Bedingungen:
  - T4: zwei geprüfte, verschlüsselte Sicherungen vor T6;
  - T5: Probelauf, der Signatur, 16 KB und alle Paketprüfungen bestehen muss.
- Alle Schlüsselschritte führst du ausschließlich auf deinem Gerät aus. **T7 ist ausdrücklich ausgeschlossen.**

### 6.3 Separater Test-Liefernachweis (P4-Lieferpin `7978a41` unverändert)
- `vendor/s3d-test-delivery/SOURCE` und `.github/workflows/s3d-test-delivery.yml` (`ca56f7f`, Korrektur `45018f7`).
- Lauf [45068855448](https://github.com/Owndot/Kadri/actions/runs/45068855448) **PASS**:
  - P4-Lieferworkflow und Pins `7978a41`/`546af14`/`bd5ab29` unverändert;
  - Kadri-Produktdateien = `520c0bf`;
  - Harness `3887569` = `ee54864` + nur `tests/`;
  - ZIP Kadri P4 TEST 1.12.17: Inhalt `42252ba4…`, **ZIP-SHA-256 `bf685a12…` auch in CI bitgleich**, ID `pcccpjllneffccpenbepmfbkjedllkkf`;
  - gepacktes Paket gegen ChannelServer und DashEngine des Helfers: `channel-integration` 74/74, `download-integration` 44/44, `hls-integration` 109/109, **`dash-integration` 26/26**, `channel-browser` 34/34, `netguard` 4/4.
- Erster Lauf [45061974348](https://github.com/Owndot/Kadri/actions/runs/45061974348) wurde abgebrochen, weil im Nachweis-Workflow Python-Playwright für `dash_fp.py` fehlte. Lokal reproduziert und behoben.
  - Nebenbefund (bestehend, nicht geändert): `dash_integration_check.js` beendet sich nach einem solchen Fehler nicht von selbst; der Schritt hat jetzt eine Zeitgrenze von 25 Minuten.
- Signierer-Fingerabdruck im Nachweis: `PENDING`, bis du ihn nach T3 nennst.

### 6.4 Patches (SHA-256)

| Datei | SHA-256 |
|---|---|
| `kadri-s3d-ca56f7f-delivery-proof.patch` | `39af275a67932b2d15066c5a110d51940c7c05c7ed472d2a7835684aaa40f0f8` |
| `kadri-s3d-45018f7-delivery-proof-fix.patch` | `7c0fb54101e522b91613b475c562d735dc300382e80f75d6400c4763d8d0092e` |
| `helper-s3d-aeada50-handover.patch` | `cc1ce2a94eb1882003c44ee2691f4fd3f1d9fd2ad594bae39f531c35691c361f` |

### 6.5 Festlegungen beibehalten
Sheet-Fix `da28290`, S3D-REF-PRIV als offener P2-Befund, Kadri 1.12.17, keine weiteren Produktänderungen. Die abgelaufene CI-Überwachung wurde nicht neu gestartet, weil alle benötigten Nachweise vorliegen.

## 7. Nächster Schritt

Du führst T1–T6 nach der Anleitung auf dem Samsung aus. Danach schickst du mir nur:
- den Zertifikats-Fingerabdruck;
- den SHA-256 der signierten APK;
- die Zeilen `SIGNED …` und `P4-TERMUX-VERIFY PASS …`.

Bei REJECT oder REFUSED: STOP, und schick die Fehlerzeile.

**STOP vor T7** – keine Deinstallation, Installation oder Migration ohne eure ausdrückliche Freigabe.
