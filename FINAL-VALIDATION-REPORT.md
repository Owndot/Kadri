# Final technical validation — Kadri — 2026-10-24

**Ready for owner device validation; NOT approved for final merge or publication.**
Both security PRs remain drafts. Validation also corrected a proven pre-existing player metadata/position defect. The working Chrome request manager was not redesigned or modified in this final validation.

## Follow-up after repeated browser runs — 21:27 UTC
A repeated helper userscript run exposed a pre-existing player bug in both projects: later loadedmetadata events reused the earlier opening position on an unrelated new source. Native event traces reproduced an explicit currentTime=10 assignment on stable and development player source.

src/170-player-laden.js now consumes the opening seek once per intentional tryNext load. Quality/fallback loads re-arm that seek; an unrelated later metadata event does not. The bridge's first-load position logic is preserved.
- Runtime fix: Kadri 3145e864; helper/userscript 7af974c0.
- Kadri full existing 18-file suite with this runtime correction: PASS in run 40133376428.
- Counterbalanced source-switch observations in helper run 40133593779: both stable samples fail the exact assertion (35/36), both corrected samples pass (36/36). The overall job was red because the newly added standalone test initially looked for a lazy player before video discovery; that harness error was corrected and is not counted as a product pass.
- Added native event regression tests verify the opening position, then change source and inspect position at loadedmetadata rather than waiting an arbitrary number of seconds. They are present in both projects; a47e53ec / 0442866e correct fixture discovery before pausing.
- A fresh full-suite run and counterbalanced performance rerun after the player correction are in progress. Earlier 198-check results below are historical, not a claim that the new 19-file suite has finished.

## Executed checklist
PASS means executed with evidence. A prepared procedure is NOT TESTED.
Host execution used GitHub Actions because the shared shell environment was unavailable.

| Status | Check | Evidence / scope |
|---|---|---|
| PASS | Complete current suite: 18 files, 198 checks | [40130992535](https://github.com/Owndot/Kadri/actions/runs/40130992535), source 35d45a9f6e99a74f03940609b7c488211788746f |
| PASS | Native aborts and real, unmodified 15-second header deadline | test_abort.py: 12/12; queued job never reaches server; header/body abort and timeout permit subsequent requests |
| PASS | Redirects, cookies, explicit Authorization and both original parallel-context cases | test_redirect.py: 25/25; real Chromium DNR and controlled HTTPS/HTTP servers |
| PASS | Failed cleanup, repeated rule failure, verified recovery | test_redirect.py injects updateSessionRules rejection while preserving real installed DNR state; confirms orphan, no fetch on further error, then orphan/credential removal and recovery |
| PASS | Actual service-worker termination/restart during held headers | test_worker_restart.py: 8/8; CDP stopWorker; destroyed global marker; native session rules inspected through a fresh execution context |
| PASS | Concurrent bodies, player resolution/handoff, queue priority | test_scheduling.py: 10/10; two held download bodies; ordinary request queued before player request; both enter gate before release; player is served first |
| PASS | Deterministic lifecycle/security model | test_guard.py: 59/59 aggregate; includes actual Chrome/Firefox source against simulated APIs; these particular checks are NOT native Firefox/DNR evidence |
| PASS | Recovery regression discriminates predecessor/current | same CI run: af294d1 fails exactly “setup failure never recovered”; current source passes all 15 model scenarios |
| PASS | Baseline observations | [40119310209](https://github.com/Owndot/Kadri/actions/runs/40119310209), 6 fresh-browser samples/version |
| NOT TESTED | Real Vivaldi/Firefox on Samsung S26 Ultra / Android 17 | [owner guide](https://github.com/Owndot/video-assistent-helper/blob/codex/security-phase-1/S26-ANDROID17-TEST.md) |
| NOT TESTED | Real Firefox extension webRequest/DNS isolation | Source/model checks and helper userscript Firefox-engine tests do not prove installed-addon behavior |
| NOT TESTED | Actual worker termination at every setup/redirect/body boundary | Native restart case covers held response headers; other boundaries remain separate validation work |
| NOT TESTED | Battery, multi-GB file integrity/peak PSS, 20/50 device cycles, OEM PiP/background/brightness | No physical device access; no emulator/desktop energy claim |

Fault injection rejects the browser method through a test wrapper. Rule installation, persisted state, HTTP requests and redirect enforcement still use real Chromium. It does not reproduce every native quota/permission failure.

## Performance observations, not invented release thresholds
Stable source c559dfa0ee10f6ab8138028e1004298ebfde5b48; development measurement source 07807e10 (same request-manager runtime as the final test head). Chromium 141 via pinned Playwright 1.56. No Android conclusion follows.

| Median, 6 samples/version | Stable | Development |
|---|---:|---:|
| First video compositor frame from navigation | 96.4 ms | 104.1 ms |
| Own-player frame after bridge transition | 1037.8 ms | 1039.0 ms |
| URL resolution with two 32 MiB transfers | 16.7 ms | 31.3 ms |
| URL resolution behind deliberately 750 ms delayed headers | 2.4 ms | 755.6 ms |
| Playing browser-process CPU over approximately 3 s | 0.425 s | 0.430 s |
| Retained JS heap growth after 8 open/close cycles | 156,558 B | 158,340 B |
| Sampled browser-process RSS sum peak | 1350.2 MiB | 1340.2 MiB |

Raw samples and ranges: validation-results/kadri-raw.jsonl and validation-results/baseline-summary.json.
The RSS sum double-counts shared pages; it is not physical RAM/PSS or bounded-memory proof. The bridge keeps the original video visible; the roughly 1-second own-player transition is not a measured black-screen gap. Compositor callbacks are not camera measurements of the phone display. Small/noisy differences are not evidence of speed or battery improvements.

**Measured limitation:** a player request cannot preempt an active security owner waiting for headers. Priority only changes pending queue order. The slow-header case therefore has a clear additional wait, and a longer active wait can reach the existing four-second resolution fallback. Do not bypass cleanup or start overlapping global permissions to make this number smaller. Evaluate the fallback and visible transition on the real device before changing architecture.

## Remaining risks / merge gates
- Chrome DNS rebinding remains a documented platform limitation; no universal protection claim.
- Body transfers can overlap, but chrome/prelude.js accumulates binary chunks and creates a Blob/ArrayBuffer. Large-file bounded memory has NOT been achieved or proven by the transport changes.
- Physical Android playback, HLS, subtitles, PiP, mirroring, audio/brightness, rotation, settings, media-server and download rows require the owner checklist.
- Helper userscript Firefox tests have pre-existing failures on the unchanged stable source; see the helper final report. No all-browser stability claim.
- The old helper signer remains compromised and production migration is not executed. No merge/release/key generation occurs in this validation.

## Changes and reviewable commits
- 1787502 / 07807e1: worker/performance fixtures and playing/slow-header observations.
- 84a2b35: inspect restarted Chromium Runtime rather than a stale Playwright Worker wrapper.
- 6dde9be / 51485db: test-only abort bridge and native abort suite; production ZIPs do not include the request bridge.
- dbdc2c1: raw counterbalanced observations.
- af7b88a: await failed-cleanup completion in the model; add real DNR recovery checks; preserve shell pipeline failures.
- 20a6b9c: CI proof against af294d1.
- 35d45a9: native header deadline and real queue-priority assertions.

Earlier failed CDP/test-workflow iterations are superseded; they are not counted as passing evidence. No new performance optimization or request-manager refactor was made.

## Safe CI
Current ci.yml and performance-validation.yml have contents:read, install test fixtures/Chromium and upload artifacts. They have no production signing, release/tag command or release write permission. Native request hooks are built only into dist/test; uploaded distribution ZIPs use the normal build.
