# P4-Testlieferung – gesicherter Entwurf, nicht aktiviert

> **Überholt (2026-11-17):** maßgeblich ist [P4-DELIVERY-READINESS.md](P4-DELIVERY-READINESS.md). Der Entwurf unten
> setzte `HELPER_SHA` auf die WASM-Herkunft `bd5ab29`; jetzt sind Helper-Anwendungscode (`546af14`) und
> WASM-Herkunft (`bd5ab29`) getrennte Pins, und der Workflow ist durch die Freigabesperre geschlossen.

Stand 2026-11-16. **BLOCKED** bis zur Bewertung des zusätzlichen API-34-Speicherfehlers.
Dieser Entwurf war lokal vorbereitet; er wurde nicht als Workflowänderung gepusht.
Der aktive Workflow bleibt auf seinem bisherigen Stand. Kein neues Paket ausgeliefert.

Vor Anwendung: maßgebliche `P4C3-HANDOFF.md` und Claude-Übergabe im Kadri-Repository lesen,
alle relevanten CI-Ergebnisse des exakten Quellstands prüfen. Nur P4B-A10-SIZE ist als
Gerätetest-Ausnahme freigegeben. Ein erneuter grüner Lauf erklärt den ersten Speicherfehler nicht.
Bei neuen Codeänderungen müssen die Quell-SHAs und Artefaktnamen angepasst werden.
Bestehender Branch und bestehender Workflow; keine Produktionssignierung, Tags oder Releases.

Der neue Wegwerf-Signierer verlangt beim Gerätewechsel ausschließlich die isolierte P4-App
zu ersetzen und erneut zu koppeln. Vorher laufende P4-Aufträge abschließen; keine anderen
Installationen ändern. Kadri-P4 nur aktualisieren. Noch keine Installationsaufforderung.

```diff
diff --git a/.github/workflows/p4-test-extension.yml b/.github/workflows/p4-test-extension.yml
index 263f4a7..0c36a10 100644
--- a/.github/workflows/p4-test-extension.yml
+++ b/.github/workflows/p4-test-extension.yml
@@ -21,8 +21,8 @@ concurrency:
   group: p4-test-extension
   cancel-in-progress: false
 env:
-  SOURCE_SHA: 7811d5a662152b96fdad6cd9e74d9cb97c41d6d3
-  HELPER_SHA: 8b906c504f0612ff4af69a397a2745b717f156b3
+  SOURCE_SHA: 7978a41232c3b1582289c53461da4fe63ad28ff9
+  HELPER_SHA: bd5ab293bbc6729cabafe72b6bd5606f8c74f5e5
   P4_ID: pcccpjllneffccpenbepmfbkjedllkkf
   RETENTION_DAYS: 2
 jobs:
@@ -178,8 +178,9 @@ jobs:
         m = json.loads(expected['manifest.json'])
         ev = {
           'purpose': 'Owner-approved controlled Samsung test (P4c). NOT a release. Production stays UNAPPROVED.',
-          'changes': 'Bounded 25-second response deadline for synchronous HLS planning only; other calls retain 5 seconds. Anonymous reports preserve exact known helper codes while removing private identifiers. site-a HTTP 404/412 remains open.',
-          'helper_update_required': False, 'pairing_reset_required': False,
+          'changes': 'Kadri 1.12.16: anonymous HLS planning phase and processed-playlist count from the updated helper. No download, credential, network-boundary or retry changes. Real HTTP 404/412 remains open.',
+          'helper_update_required': True, 'pairing_reset_required': True,
+          'pairing_reset_reason': 'The paired P4 helper uses a new disposable signer; replacing only the isolated P4 test app requires pairing that app again. Keep existing production and C3 installations.',
           'extension_name': m['name'], 'extension_version': m['version'], 'extension_id': os.environ['P4_ID'],
           'zip': 'kadri-p4-test-extension.zip', 'zip_sha256': zsha, 'folder': 'kadri-p4-test',
           'permissions': m['permissions'], 'host_permissions': m.get('host_permissions'),
@@ -202,7 +203,7 @@ jobs:
     - name: Short-lived isolated P4 TEST extension only (public Actions artifact, not a release)
       uses: actions/upload-artifact@ea165f8d65b6e75b540449e92b4886f43607fa02
       with:
-        name: kadri-p4test-7811d5a-vivaldi-test
+        name: kadri-p4test-7978a41-vivaldi-test
         path: ${{ runner.temp }}/deliver/
         retention-days: ${{ env.RETENTION_DAYS }}
         if-no-files-found: error
```
