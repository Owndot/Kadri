# Phase 1: Chrome request isolation

Base: c559dfa0ee10f6ab8138028e1004298ebfde5b48.

Verified defects:
- Exact-URL session grants were visible to concurrent foreign redirects to that same URL.
- Concurrent authenticated requests contributed a union of cookie-exempt sites.

Implementation:
- All non-helper background fetches acquire an abortable bounded FIFO gate BEFORE changing network exceptions.
- The gate covers setup, redirects, final response headers, and awaited exception removal. It does not cover response body consumption.
- Helper requests bypass the gate, omit browser credentials, follow no redirects, and install no Referer exception.
- Abort/disconnect and the existing request deadline apply while queued. Duplicate request messages on one port are ignored.
- A cleanup failure closes the gate until worker restart. Startup removes orphaned temporary session rules before admitting fetches.

No playback, HLS, PiP, captureStream, audio/brightness, or player transition code was edited. This does not prove absence of regressions.

Validation performed in the available JavaScript orchestration runtime:
- Source compilation using Function.
- Eight deterministic scenarios against the actual modified background source: exact-URL overlap; credential overlap; concurrent response bodies; queued abort and helper responsiveness; orphan-rule startup cleanup; cleanup failure; initialization failure; queue timeout/disconnect.
- The unmodified base failed the exact-URL overlap regression as expected.
- URL and AbortController were small test doubles in that runtime. The committed Node runner uses native URL and AbortController.
- Tests model DNR/fetch and establish lifecycle ordering, NOT browser enforcement or performance.

Added actual Chromium regression cases in test_redirect.py for identical local URL and concurrent authenticated B request, with server-side hit/header checks. Added the Node lifecycle runner to test_guard.py.

Not executed here: Node/Playwright full suite, Chromium DNR enforcement, real worker termination/restart, large file memory measurements, Firefox, Android/Gradle/APK, and device transition/battery tests. The execution environment was unavailable. This branch must remain a draft until those checks pass.

Performance tradeoff: response bodies can remain concurrent, but different background requests wait for earlier final headers and cleanup. A slow headers response can delay following requests (helper gestures bypass this). Measure actual startup/seek/subtitle/download latency before merging. No claim of unchanged latency is made.

Remaining scope: Chrome DNS rebinding; helper redirect reachability; Firefox/Userscript context verification; Android cookie/redirect and streaming changes; complete signing-secret migration in the companion repository. These are not fixed by this commit.
