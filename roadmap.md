# Roadmap

- [x] Reconnect GitHub API and Google Search Console after the 21 October 12:47 UTC workspace move; both freshly linked and account/property reads returned HTTP 200.

- [x] Replace page-loading gaps with a shared record animation; signed-in Settings → Memory Tape showed the loader and completed without page errors at 394×777.
- [x] Correct curve normalization, process both overlap players with saved effects, separate native 8D/3D and preserve enhancements in Auto EQ; 14 web logic tests and 4 native PCM tests passed against Media3 1.4.1; preview build OK.
- [ ] Compile the full updated APK and verify audible overlap/EQ/8D/3D on an Android phone — blocked by unavailable Android SDK/device; isolated native PCM compilation/tests passed, not a full APK build.

- [x] Reconnect GitHub API and Google Search Console after the 21 October workspace move; both were freshly linked and verified with an account read and a property list, each returning HTTP 200.
- [x] Reconnect GitHub API and Google Search Console after the 20 October workspace move; GitHub account read and Search Console property list both returned HTTP 200.
- [x] Reconnect GitHub API and Google Search Console after the 19 October workspace move; both account reads returned HTTP 200.
- [x] Recheck both connections after the repeated 19 October 11:24 UTC workspace-move request; freshly linked and verified both accounts.

- [x] Remove dedicated playback diagnostics code, language preference, and private-profile controls without weakening existing privacy; signed-in settings and source-reference checks passed.
- [x] Implement service-owned Android transitions, corrected browser gains/handover and autoplay extension; 12 focused tests passed, signed-in gapless/autoplay switches saved and restored, preview build OK.
- [ ] Verify audible crossfade/Gapless Pro and updated Android transitions — blocked by unavailable Android toolchain/device; real-song browser attempt did not reach confirmed playback, so audible behavior remains unverified.

- [x] Reconnect GitHub API after the 18 October 11:08 UTC workspace move; freshly linked connection verified with an account read.

- [x] Reconnect GitHub API after the 17 October 13:17 UTC workspace move; freshly linked connection verified with an account read.

- [x] Harden Google Play payment paths: Play-flagged builds never fall back to UPI, missing Play prices never use website prices, checkout requires verification readiness, fixed-term/refund disclosure is visible, and atomic token ledger prevents repeat grants. Twelve focused tests passed, signed-in website checkout opened, simulated Play-unavailable checkout stayed blocked, and server-only ledger grants were verified. Web build OK.
- [ ] Verify updated Billing 8 AAB, real Play purchases, restore/consumption recovery and refund handling — blocked by missing Google Play verification credential, unverified Console product/API configuration, and unavailable Play-installed Android device; no approval guarantee.

- [x] Remove mock function health, fabricated storage quotas, manual play-count editing and unused editorial placement switches; add missing-file/duplicate review, sorting and confirmed bulk visibility. Authorized show/hide persistence, cancel and CSV export passed; temporary songs removed. Device testing unavailable.

- [x] Reconnect GitHub API after the new 16 October 11:02 UTC workspace move; freshly linked connection verified with the account read.

- [x] Reconnect GitHub API after the 16 October workspace move; newly linked connection verified with the GitHub account read.

- [x] Test current filtering and the release feed with signed-in live data; 23 release-shelf tracks returned with no disclosed-AI matches, no browser errors, and focused tests passed. Metadata cannot certify undisclosed synthetic tracks.
- [x] Verify admin catalog filters and CSV export using an authorized account; all six filters, album search, exact filtered CSV, full CSV, and formula escaping passed with hidden temporary rows, all removed afterward.
- [x] Build the latest APK and inspect packaged launcher icons at phone sizes; run #933 succeeded, website APK replaced on 16 October, all 20 packaged PNGs match source and 48/64dp previews are centered. Physical phone testing remains unavailable.

- [x] Extend song management with visibility/AI-review filters, bounded pages, catalog export, and editorial placement controls; schema fields verified and 7 catalog tests passed.
- [x] Recheck real-song feed coverage and APK icon source consistency; New Releases uses the explicit release shelf without chart/search filler, 24 focused tests passed, circular icon previews checked, and AAB builds preserve committed icons.

- [x] Reconnect GitHub API after the latest workspace move (15 October); do not reuse earlier connections.

- [x] Strengthen Trending/New Releases filtering against explicitly synthetic songs without changing official chart order; 11 focused tests passed.
- [x] Reduce APK launcher mark size consistently across adaptive, round, and themed icons; circular-mask previews checked.
- [x] Add searchable admin navigation, pinned controls, and a live pending-work overview using existing management pages.
- [x] Verify the admin catalog controls end to end — tested with an existing authorized admin session without changing roles or access rules.
- [ ] Verify the new APK launcher on a phone — blocked by unavailable Android device.

- [x] Correct the Play Console ownership record and remove the mistakenly supplied Play service credential.
- [x] Harden long listening sessions: reset per-song retries, prevent duplicate native listeners, cancel stale app-resume listeners and volume ramps, and renew Android playback locks before timeout.
- [ ] Verify long-session playback on a newly built Android APK — blocked by unavailable Android build tools/device.

- [ ] Make the Google Play release submission-ready: Play Billing fixed-duration products, Play-supplied pricing/restore, accurate refund disclosure, seven-day recoverable account deletion with hourly cleanup, policy corrections, Android security hardening, and deterministic signed AAB validation are implemented; blocked on publishing the cleanup endpoint and validating a real signed AAB/Play purchase on-device.
- [ ] Complete Google Play Console declarations and the personal-account closed test — blocked on the developer account, rights documents, tester group, and Play Console access.

- [x] Fix offline cold startup and show device downloads before remote auth gates; 5 logic tests passed, disconnected browser cold start displayed a seeded local song and played its blob audio with no page errors.
- [ ] Verify offline cold startup on a newly built Android APK in airplane mode — blocked by unavailable Android build tools/device.

- [x] Audit APK playback, downloads, navigation, and lifecycle; guard stale retries, detach native listeners, extend cold-start readiness, and fix offline URL cleanup (30 logic tests passed).
- [ ] Verify changed native playback on a newly built APK — blocked by unavailable Android build tools/device; browser smoke checks remain partly blocked by repeated celebration overlays and outdated selectors.

- [x] Smooth the opening logo and remove stacked native/web launch delays; verify startup (Android device handoff still requires a new APK).

- [x] Replace screenshot-based launch scenes with actual recorded app use and motion graphics; export and verify a new video version.

- [x] Produce and verify a portrait Univers Flow launch video with real app screens, music, and sound effects.

- [x] Remove mobile player/download overlaps and short-screen clipping.
- [x] Use sharp artwork fallbacks in full player and recommendations.
- [x] Remove unrelated Smart Remix filler and tighten relevance.
- [x] Remove non-India JioSaavn chart fallback.
- [x] Add country tagging to play and skip trend events.
- [x] Reject stale and evergreen chart data.
- [x] Verify preview, focused checks, and Android-size layouts.
- [x] Replace animated/video sharing with immediate app-link sharing.
- [x] Make Trending follow official YouTube Music/Apple chart order only, with no in-app listener or AI ranking.
- [x] Isolate playback progress, unify scroll tracking, and simplify mobile player/page transitions.
- [x] Complete whole-app health audit: automated checks, live routes, backend logs, monitoring, and security.
- [x] Fix every confirmed user-facing issue found by the health audit and re-run verification.
- [x] Prevent dismissed ads from immediately repeating.
- [x] Support proper timed video ads with image fallback and admin upload.
- [x] Restore lightweight song sharing and remove animated story generation.
- [x] Harden automatic website APK replacement after successful Android builds; remove outdated download details and confirm only one website APK exists.
- [x] Verify a real automatic APK upload — run #933 completed publication on 16 October at 10:58 UTC, and the newly replaced website APK was downloaded and its packaged icons inspected.
- [x] Connect GitHub API in new workspace and re-check build runs
- [x] Connect GitHub API in new workspace
- [x] Reconnect GitHub API after the 17 October 13:12 UTC workspace move; freshly linked connection verified with the GitHub account read. Earlier workspace connection identifiers no longer apply.

- [x] Reconnect GitHub API + Google Search Console in new workspace

- [x] Fix Trending showing niche/non-viral charts (use country Trending 20 + Daily Top only)
- [x] Reconnect GitHub API + Search Console in new workspace (Oct 22)
- [x] New Releases: rank by real plays, keep charted artists, drop devotional uploads
