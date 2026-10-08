# Roadmap

- [ ] Fix offline cold startup and show device downloads without waiting for sign-in or internet; verify disconnected launch and playback.

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
- [ ] Verify a real automatic APK upload — blocked on GitHub repository secret configuration and a successful Android workflow run, unavailable from this workspace.