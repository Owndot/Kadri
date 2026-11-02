# C3: discovered MP4 candidates versus loaded player sources

Production status remains **UNAPPROVED**. Helper source stays pinned to ca605408924644eeba6c29b4037dd90a324bb078; no helper, signing, network, journal or permission changes.

## Independently reproduced defect

In src/170-player-laden.js, tryNext assigns st.cur before media data has loaded. The opening bridge may still display the original page's HLS video. In src/180-player-bedienung.js the old hdlUrl accepted that candidate even with readyState=0 and currentSrc empty. The initial refreshDl/capability probe could therefore offer it to C3 before Kadri had loaded any video data from it.

The fix requires an own HTTP(S) file source with current media data (readyState >= HAVE_CURRENT_DATA), no media error, no srcObject, and currentSrc matching the selected URL as canonicalized by the browser. A loadeddata event refreshes eligibility. Closed/replaced players are ignored. Existing HLS/DASH and non-MP4 exclusions remain. URL canonicalization is only used for comparison; the URL handed to the existing download manager is unchanged, including signed query parameter order and duplicates.

This validates the selected player source, **not** whether the remote server will accept a separate credential-free helper request. It does not turn a real server HTTP 404 into success, refresh arbitrary signed URLs, add retries, send browser headers, or implement a fallback.

## Device evidence supplied by the user

- First site's diagnosis includes four MP4 candidates from its own metadata endpoint, while the recorded opening had no confirmed own-player playback yet. This is consistent with the reproduced early-offer defect, but is not proof that it caused the reported 404. Expiry, request binding and a different server response remain unverified.
- Eporner's current playback source is HLS. A metadata contentUrl and several network URLs have MP4 suffixes. Neither the suffix nor the metadata alone proves a complete, matching, independently downloadable file; network entries may belong to the stream. No candidate was silently substituted for the playing source.
- Cinemar's supplied candidates are all HLS manifests, including paths containing `.mp4:hls:manifest.m3u8`. C3 still does not download HLS.

The diagnostics were captured with the own player closed, so they do not establish the exact source and readiness at the download click. The device-specific cause of HTTP 404 is still to be confirmed. No full signed URL, cookie or authorization value is requested or stored.

## Regression coverage

tests/download_source_check.js executes the real selector against loading, metadata-only, failed, captured, stale-source and HLS/DASH cases, plus loaded MP4 and signed query preservation. The old source must fail the same test. Six deliberate mutations must fail.

tests/test_mp4.py holds the own player's HTTP response while its original-page video is already loaded. It checks absence of the helper option until video data arrives, reappearance without reopening, and no helper download without a click. Existing completion, cancellation, restart, 404/410, iframe and privacy tests remain enabled. See the CI results for executed outcomes; this document alone does not assert pending tests passed.
