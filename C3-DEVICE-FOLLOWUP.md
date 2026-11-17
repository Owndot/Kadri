# C3 Samsung follow-up — UNAPPROVED

## Evidence and scope

Baseline: Kadri fb66e9138f27661532e2fe136c835afbcb37a489, helper ca605408924644eeba6c29b4037dd90a324bb078.
No helper application, signing, journal, channel, permissions or network policy changes.

The user's Samsung successfully downloaded and opened two Mozilla MP4 files. This is device evidence supplied by the user, not a device run performed by us.

### Kinogo / cinemar

The main frame has no video. Kadri runs inside the existing cross-origin cinemar.cc iframe (existing all_frames content script).
The Samsung iframe diagnosis supplied on 2026-11-02 identifies both candidates as M3U8:
- cfnd.cinemap.cc, suffix `720.mp4:hls:manifest.m3u8`;
- cfnd.cinemap.cc, suffix `hls.m3u8`.

These are HLS manifests, including the first URL despite the embedded ".mp4" text. The diagnosis reports two parsed playlists and matching stream duration; it contains no direct MP4 candidate. This establishes the source type for this test, not the absence of any other source the website could ever offer.

Code path: `playerSources()` in src/120-player-stil.js uses `resolve(orig)`; `tryNext()` in src/170-player-laden.js records `st.cur` and plays HLS through hls.js. `directUrl()` in src/180-player-bedienung.js excludes playlists, hls.js sessions and captured/blob streams. The C3 menu exists in Kadri's own player and uses that actual current direct URL. No external Android player is involved in the reported test.

C3 therefore cannot download this observed HLS source. Do not rewrite manifest URLs into guessed MP4 URLs. No player/download permission change is necessary. A later HLS downloader would require a separate design for manifest/variant/segment handling, SSRF validation at every request, bounded resources, explicit user action, cancellation/resume and safe publication; it is outside this fix.

Independent public-browser probing reached a Cloudflare challenge, not the movie player. The source classification above is based on the user's iframe diagnosis. Controlled browser regressions test direct MP4 and HLS in a cross-origin iframe without depending on this third-party site.

### Popup history and “File not found”

The old popup rendered all journal records, including terminal jobs, on every website. It now shows active jobs, a short completion notice for a transition observed while the popup is open, and individually dismissible failed/interrupted jobs. Reopening does not replay completed history.

Dismissal is separate presentation data under `kadri-download-dismissed-v1`. It never removes journal entries, cancels jobs, restarts downloads or deletes files. Pending cancellation remains active and visible.

The English text "File not found" translates `Datei nicht gefunden`. `channel-downloads.js:reasonText()` maps HTTP 404/410 to that text; the helper's DirectDownloads engine generates these codes for unsuccessful HTTP responses. It is not a local-file existence check. Such an entry records a failed remote download attempt and may be old because the popup previously retained all errors. The screenshot/device journal was not available, so the exact code, URL, time and cause for the user's two records are not independently verified. Tests reproduce both 404 and 410 and verify dismissal without journal changes.

## Validation

`node tests/popup_downloads_check.js --mutations` exercises actual popup rendering with deterministic timers, first-refresh completion, expiration, restart, cancellation, per-error dismissal, persistence failure and journal isolation. The old popup must fail the same behavior test. Nine mutations must be rejected.

`tests/test_mp4.py` adds browser/real-helper coverage for old-history suppression, 404/410 notices and dismissal, a direct MP4 in a cross-origin iframe, transient success, no sensitive request headers, and exclusion of HLS despite successful playback. Existing channel, privacy, integration and mutation tests remain enabled.

See the final build/test evidence for executed results. This document describes tests and does not itself assert that pending CI passed.

## Device update

Only update the isolated test extension, keeping ID `fhjmppadldgkhdgkdplpalmoooocoinn`. Production ID `ladlndddhohknfpnfibchcadhgbpdlhm` must remain untouched.
Keep the already installed helper APK, package `de.evp.helfer.channeltest`, source ca605408924644eeba6c29b4037dd90a324bb078 and existing test certificate. No APK rebuild/reinstallation or re-pairing is needed.
Do not delete the extension or its data: replace the contents of its current unpacked test folder and reload only that test extension. If Vivaldi offers an update/import path instead, verify the same test ID and retain data. Never remove the production installation.
