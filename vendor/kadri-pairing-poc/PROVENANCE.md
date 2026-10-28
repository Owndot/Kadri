# Herkunft: `kadri_pairing_poc` (WASM-Kern des Helfer-Kanals)

**Nur für den isolierten Test-Build `dist/channel-poc`.** Die normalen Builds (`dist/chrome`, `dist/firefox`, Zips) enthalten diese Dateien nicht.

| Datei | SHA-256 |
| --- | --- |
| `kadri_pairing_poc_bg.wasm` | `d84e09bbfd365f69f50de99491705ba80a8ee85174dad220c6f5ed94c8fb79a4` |
| `kadri_pairing_poc.js` (wasm-bindgen-Glue, `--target no-modules`) | `bda8018d18c08ae01b4a935e5761f1ce7d13e67928636ce3e3f7261451bde874` |

- **Quelle:** <https://github.com/Owndot/video-assistent-helper>, Branch `feature/helper-channel-dummy`, Commit `15fed6d52b6b4b7de6658910ac2d71e9be10e519`, Verzeichnis `poc/pake-channel/core`. Der Kern ist dort unverändert gegenüber Commit `bf84258ed8219690e9760312f0f0a5b88ad755d5` (Android-/Vivaldi-Capability-PoC, auf dem Samsung Galaxy S26 Ultra getestet).
- **Verhältnis zum Gerätetest:** gleicher Kern-Quelltext (`bf84258`), gleiche Toolchain und gleiche Abhängigkeiten wie die auf dem S26 Ultra geladene WASM. **Bitgleichheit mit jener Datei ist nicht belegt:** Sie wurde auf einem anderen Rechner ohne Pfad-Umschreibung gebaut (absolute Build-Pfade stehen in Panic-Meldungen der `.wasm`), und ihr Hash ist nicht dokumentiert. Eine frühere Fassung dieser Datei behauptete Bitgleichheit – das war falsch. Seit Helper-Commit `15fed6d` wird mit `--remap-path-prefix` gebaut; die `.wasm` ist dadurch rechnerunabhängig reproduzierbar (lokal aus verschiedenen Pfaden und in Kadris CI geprüft). Der JavaScript-Glue ist `no-modules`, weil Kadris Service Worker ein klassisches Skript (`importScripts`) ist.
- **Bau:** `poc/android-capability/tools/build-wasm-kadri.sh OUT` (rustc 1.97.0 über `rust-toolchain.toml`, `cargo --locked`, Ziel `wasm32-unknown-unknown`, Feature `wasm`, `getrandom_backend="wasm_js"`, wasm-bindgen-cli 0.2.104). Kadris CI baut beide Dateien aus dem in `SOURCE` angegebenen Commit neu und vergleicht die Hashes.
- **Kryptografie:** ausschließlich in diesen Bibliotheken; Kadri implementiert keine eigene. SPAKE2 (RFC 9382, P-256) über `pakery-spake2` 0.6.2, Noise `Noise_KK_25519_ChaChaPoly_SHA256` über `snow` 0.10.0, Argon2id über `argon2` 0.6.0, Schlüsselprüfung über `curve25519-dalek` 4.1.3. Kein unabhängiger Audit des Protokolls.
- **Lizenzen der einkompilierten Crates** (alle mit GPL-3.0 verträglich): eigener Kern MIT; `curve25519-dalek` und `subtle` BSD-3-Clause; `generic-array` MIT; `unicode-ident` (nur Build-Zeit) (MIT OR Apache-2.0) AND Unicode-3.0; alle übrigen (u. a. `snow`, `pakery-*`, `p256`, `argon2`, `chacha20poly1305`, `sha2`, `hkdf`, `hmac`, `zeroize`, `getrandom`, `wasm-bindgen`) MIT OR Apache-2.0. Vollständige Liste: `cargo tree --locked --target wasm32-unknown-unknown --features wasm -e normal -f '{p} | {l}'` im Kern.
