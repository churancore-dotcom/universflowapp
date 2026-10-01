# Make navigation, playback, and scrolling feel instant

## Goal
Remove avoidable main-thread and graphics work from the mobile app’s hottest interactions while preserving playback behavior and the existing visual identity.

## Changes
- Simplify page transitions to short compositor-only fades/slides, respect reduced motion, and replace hard page reloads in Home actions with app navigation.
- Consolidate scroll visibility tracking so the bottom navigation and mini player follow the app’s real scroll containers without duplicate state updates.
- Make fullscreen-player gestures directional and conflict-free: upward movement always scrolls; downward movement at the top dismisses; controls never trigger a drag.
- Reduce player graphics cost during song changes by removing animated large-area blur layers, using lightweight crossfades, and avoiding layout-based artwork morphing.
- Stop Home from re-rendering its full feed on every playback progress tick; isolate live progress to the small surface that needs it.
- Add mobile performance CSS safeguards for off-screen content, touch scrolling, and reduced-motion/device-constrained rendering.
- Keep playback resolution, recommendations, charts, and backend behavior unchanged.

## Verification
- Run focused tests and confirm the preview build has no errors.
- Use a phone-sized browser check for route switches, Home scrolling, fullscreen-player scrolling, swipe-down dismissal, and a complete song-to-song visual transition where playable data is available.
- Report any interaction that cannot be fully exercised without a signed-in or native-device session.

## Technical notes
- Use stable React callbacks/memoized subtrees and the existing external progress store rather than broad context updates.
- Animate only transform and opacity on interaction-critical surfaces; avoid full-screen filters, layout animation, and simultaneous nested springs.
- Preserve the single global player mount so playback does not reset between routes.
