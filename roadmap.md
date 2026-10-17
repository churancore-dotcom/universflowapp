# Roadmap

- [ ] Reconnect GitHub API after the 17 October 13:17 UTC workspace move; use only a freshly listed connection.

- [ ] Audit and harden Google Play Premium payment paths without changing website APK UPI; test fail-closed checkout and pricing. Real Play purchase verification requires configured Play products, credentials and a Play-installed device.

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
