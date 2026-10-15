# Roadmap

- [ ] Strengthen Trending/New Releases filtering against explicitly synthetic songs without changing official chart order.
- [ ] Reduce APK launcher mark size consistently across adaptive, round, and themed icons.
- [ ] Add searchable admin navigation, pinned controls, and a live pending-work overview using existing management pages.
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
- [ ] Verify a real automatic APK upload — cause found: the repository secret was saved as `APK_UPLOAD_SECRE` (missing the final T), so every build skipped publishing and the site still serves the 30 Sep file; workflow now accepts that spelling and reports upload failures loudly, awaiting a build that replaces the website APK.
- [x] Connect GitHub API in new workspace and re-check build runs
- [x] Connect GitHub API in new workspace
