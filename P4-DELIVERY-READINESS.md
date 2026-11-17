# P4-Testerweiterung – Vorbereitung nach dem Codex-Release-Readiness-Review

Stand 2026-11-17. Codex-Urteil **CONDITIONAL GO** für eine isolierte Samsung-Android-17-Diagnoselieferung.
**Keine Lieferung gestartet**, Freigabe geschlossen (`DELIVERY_APPROVAL: 'none'`), Produktion **UNAPPROVED**.
Gemeinsame Einzelheiten (Gate, Restrisiken, Freigabeverfahren) im Helper:
[P4-DELIVERY-READINESS.md](https://github.com/Owndot/video-assistent-helper/blob/feature/c3-browser-downloads/P4-DELIVERY-READINESS.md).

## Pins in `.github/workflows/p4-test-extension.yml`

| Rolle | Commit |
|---|---|
| Kadri-Quelle des Pakets (`SOURCE_SHA`) | `7978a41232c3b1582289c53461da4fe63ad28ff9` |
| Gepaarter Helper-Anwendungscode der P4-App (`HELPER_SHA`); Gegenstelle des Kanaltests | `546af144fe2c2efa00c9c93b745c695f6077dbaa` |
| Herkunft des vendorten WASM-Kerns (`WASM_CORE_ORIGIN_SHA`, = `vendor/kadri-pairing-poc/SOURCE`) | `bd5ab293bbc6729cabafe72b6bd5606f8c74f5e5` |
| Erweiterungs-ID / Helper-Testpaket | `pcccpjllneffccpenbepmfbkjedllkkf` / `de.evp.helfer.p4test` |

Was der Paketjob mit den drei Herkünften macht:

- Der WASM-Kern wird aus einem eigenen Checkout von `WASM_CORE_ORIGIN_SHA` bitgenau neu gebaut und verglichen.
  `vendor/kadri-pairing-poc/SOURCE` bleibt unverändert und muss genau diese Herkunft nennen. Eine Umetikettierung
  auf `HELPER_SHA` findet nicht statt.
- `WASM_CORE_ORIGIN_SHA` muss Vorgänger von `HELPER_SHA` sein. Ob sich die Kernquellen dazwischen geändert haben,
  steht als eigene Angabe in der Evidenz (lokal: unverändert).
- Kanal-, Download- und HLS-Integrationstests sowie Browser-Kanaltests laufen mit genau dem gepackten Paket gegen
  den echten ChannelServer von `HELPER_SHA`.
- Nach `SOURCE_SHA` weichen nur ab: dieser Workflow, `ci.yml`, `tools/delivery/*.py`, `tests/delivery/**` und
  Root-Markdown. Nichts davon geht ins Paket.

## Freigabesperre

- Job `gate` mit `tools/delivery/lock.py`, byte-gleich mit dem Helper und wörtlich eingebettet. Die Sperre greift
  vor Checkout, Bau und Upload.
- Eine Freigabe muss `SOURCE_SHA`, `HELPER_SHA` und `WASM_CORE_ORIGIN_SHA` nennen. Sie muss vom auslösenden Push neu
  eingeführt werden, braucht die Zeile `Delivery-Approval: <ID>`, ist höchstens 72 h gültig und nur einmal nutzbar.
- Doku-Commits, Pin-Korrekturen und spätere Pushes liefern nie.
- Selbsttest `tests/delivery/test_lock.py` läuft in `ci.yml` und ohne Netzwerk lokal:
  - Struktur, Standard gesperrt, 27 Einzelverletzungen gesperrt;
  - 12 Mutanten der Sperre erkannt;
  - Ende-zu-Ende fail closed.

## CI ohne Lieferung

`ci.yml` (Job `helper-channel`) liest die Pins aus dem Lieferworkflow und prüft dann:

- Die Kadri-Dateien sind identisch mit `SOURCE_SHA`.
- Das P4-Paket von `dist/chrome` läuft im Runner gegen den echten ChannelServer von `HELPER_SHA`. Das Paket wird
  danach verworfen, nichts wird hochgeladen.

## Liefermetadaten

- Die Evidenz trennt drei Herkünfte: `kadri_source_commit`, `helper_pair_commit` (Anwendungscode) und
  `wasm_core_origin_commit` mit den WASM-Hashes.
- `helper_update_required: true`, `pairing_reset_required: true`, `existing_p4_install_compatible: false`.
  Grund: Die gepaarte P4-App hat einen neuen Wegwerf-Signierer, deshalb muss sie ersetzt und neu gekoppelt werden.
  Kadri P4 TEST wird als entpackter Ordner mit gleicher ID ersetzt; Produktions- und C3-Erweiterung bleiben unberührt.
- Artefaktname `kadri-p4test-<SOURCE_SHA kurz>-<Freigabe-ID>`; Ablauf 2 Tage; `production_status: UNAPPROVED`.

## Erst bei genehmigtem Paketbau prüfbar (nicht ausgeführt)

- Bau aus zwei Wegen mit Byte-Vergleich des ZIP.
- Isolationstest im Wegwerf-Chromium.
- Der Upload.
- Der positive Freigabepfad gegen die echte GitHub-API.
