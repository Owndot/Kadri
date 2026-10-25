# Android E2E validation

The shared real-device test coordinator lives in
[video-assistent-helper/tests/android_e2e](https://github.com/Owndot/video-assistent-helper/tree/codex/android-e2e/tests/android_e2e).
Its [controlled workflow](https://github.com/Owndot/video-assistent-helper/blob/codex/android-e2e/.github/workflows/android-e2e.yml)
builds Kadri at an exact source SHA and installs the real Firefox extension on
Android emulators alongside an isolated Helper APK. No desktop mobile emulation,
GM shim, open-shadow test build or direct call to player internals is substituted.

## Re-run without a workflow flood

Use the Helper coordinator repository. Ordinary codex/android-e2e development
pushes do not launch the emulator matrix. Set tests/android_e2e/execution.json
to the intended API list (first 33/35), route (kadri/userscript/both), and exact
kadri_sha. Advance the dedicated codex/android-e2e-run execution ref once after
reviewing the prepared changes. Manual workflow_dispatch is also supported once
GitHub exposes the workflow on the default branch; do not merge merely to gain
that button.

The coordinator records the Helper APK source, Kadri source and automation
commit separately. A previous short-lived test APK bundle may be reused only
when its Android app/build Git inputs match exactly. Kadri is always rebuilt
for the chosen SHA. No production signing identity, release/tag operation or
production secret is used. Maximum matrix parallelism is two API workers;
browser routes run sequentially inside each emulator.

## Actual UI and evidence

Android UI Automator drives installed apps and Firefox, Android's file chooser,
player buttons/gestures and notifications. Owned MP4/HLS/WebVTT fixtures and
redirect/slow/Range endpoints keep media requests reproducible.
Screenshots, bounded-bitrate recordings, hierarchies, logcat, file hashes,
native media probes, memory snapshots and one consolidated report are retained.

Each case is PASS, FAIL, BLOCKED or NOT_TESTED. Read the result artifact; a
prepared test is not evidence it passed. Native APK HTTP/API checks are labeled
separately from browser pairing/playback. Host JVM tests are not Android UI tests.

Firefox Android supports Mozilla web-ext temporary loading. The userscript
route loads pinned real Violentmonkey and installs the unchanged userscript
through its actual installer. Those are separate clean browser profiles.
Vivaldi 8.2 officially documents Load unpacked on Android, but its APK/UI
automation route has not yet been executed by this harness; it remains
NOT_TESTED, not unsupported:
https://help.vivaldi.com/android/android-tools/extensions-on-android/

The local runner refuses physical devices before resetting test data. Samsung
S26 Ultra / reported Android 17 OEM behavior, physical battery/display checks,
production-signature decisions and actual production update paths remain
separate. This test branch does not merge or publish either security PR.

## Executed results and merge gate

The shared [technical validation report](https://github.com/Owndot/video-assistent-helper/blob/codex/android-e2e/tests/android_e2e/VALIDATION-REPORT.md)
records exact commits, real API33/35 route results, saved-file hashes, observed
memory, proven product corrections and remaining failures. The full comparison
[40197766277](https://github.com/Owndot/video-assistent-helper/actions/runs/40197766277)
is not green. Setup/pairing/playback and native APK security checks have real
positive evidence; full gesture/seek/download/PiP/lifecycle coverage is incomplete.
This is not a merge approval. Fixture pointer metadata distinguishes incorrectly
injected timing from product behavior, while all actions still use actual Android
input. Read the current report before interpreting one successful old case.

The tested extension is unmodified f76c209db9a3749007f4cd6a180d6d8509eb5971.
Host/JVM and captured-image regression checks are labeled separately from real
Android Firefox tests. Physical Samsung battery/OEM and production migration
remain outside these emulator results.
