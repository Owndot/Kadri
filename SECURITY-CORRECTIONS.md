# Phase 1 correction round — 2026-10-24

## Request ownership and recovery
All non-helper requests still own the global DNR context exclusively until final headers and awaited rule removal. Bodies remain concurrent.
If cleanup fails, the next owner must rebuild the baseline before any fetch. Rebuilding removes every temporary rule in the reserved ID range, clears credential exceptions, installs baseline rules, and compares their complete content with getSessionRules. A failed verification prevents fetching and is retried by the next owner. Initial setup failures do not fabricate installed grants or permanently poison the gate.
The helper does not enter or modify this recovery state and never follows redirects. Disconnects no longer launch unawaited rule deletions.

## Scheduling
A caller's existing timeout still covers its entire operation. Separately, a queued request has at most 60 seconds to acquire ownership and a non-helper owner has at most 15 seconds for setup/final headers. The header deadline aborts fetch; ownership is passed only after cleanup, or to baseline recovery before another fetch.
Player resolution requests are tagged in the Chrome adapter and preferred over waiting ordinary tasks; ordinary requests older than 5 seconds retain FIFO precedence to avoid starvation. Active requests are not preempted. Thus a resolution can still expire behind an already active slow header request; the existing four-second resolution fallback is preserved.
No new deadline is imposed on an unlimited body download.

## Validation
15 scenarios ran successfully using the actual background source inside the JS orchestration runtime, with a simulated Chrome DNR/fetch interface and minimal URL/abort doubles. These are NOT native Node, Chromium or device tests. The expanded suite fails on af294d1 (cleanup recovery).
Coverage includes both parallel redirect cases, startup orphan cleanup, repeated rule failure, setup/cleanup recovery, rule-content verification, queued/active aborts, caller/header timeouts, priority and two concurrent 8 MiB binary transfers.
Chromium redirect tests now hold server response headers behind explicit Events until both request handlers enter the gate. This avoids the previous fixed 1.2-second overlap assumption. These browser tests were not executed here.

## Still required
Run tests/test_guard.py, tests/test_redirect.py and the complete existing suites with built extension artifacts in Chromium. Terminate/restart an actual extension worker during setup, redirect and body transfer, and test aborts at browser API boundaries. Measure player handoff latency under download load, memory for large files, Range responses and battery/CPU on representative devices.
The JS tests do not prove Chromium DNR semantics, actual worker lifetime, large-file bounded memory or Android behavior. No device-performance improvement is claimed.
