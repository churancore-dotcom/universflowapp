# Reliable queue, playback handoff, and settings

## Goal
Make queue playback deterministic on Android and web: no repeated copies of the same song, no silent tracks with a moving progress bar, and playback settings that audibly affect the real player.

## Changes
1. **Make every queue unique**
   - Normalize all queue writes through one title/artist-aware fingerprint deduplicator.
   - Prevent the current song, repeated recommendations, restored queues, and repeated taps from inserting duplicate entries.
   - Preserve the requested/tapped song and its correct queue position after deduplication.

2. **Fix Android track handoff**
   - Give each native queue item a position-aware media ID so transitions cannot resolve to the wrong duplicate.
   - Synchronize the web queue index from every real native media transition.
   - Reapply volume, playback speed, EQ, and effects after each Android audio-session or track change.
   - Detect a progressing-but-inaudible/invalid handoff as a playback failure, retry the source once, then skip cleanly instead of pretending to play.

3. **Repair next-song behavior**
   - Ensure only one layer owns auto-advance at a time: Android's native queue on APK, browser logic on web.
   - Cancel stale crossfade/advance timers when the track changes or the user pauses.
   - Make failed next tracks recover or advance once without recursively skipping, duplicating, or leaving hidden playback running.

4. **Wire playback settings to audible output**
   - Send Playback Speed directly to Android ExoPlayer and reapply it after track changes.
   - Apply the selected crossfade curve to both fade-out and fade-in.
   - Make Crossfade, Gapless Pro, standard Gapless, Autoplay, duration, curve, quality, and speed update the active player immediately.
   - Keep premium gating and stored preferences unchanged.

5. **Verification**
   - Add focused regression tests for queue deduplication and native media-ID/index mapping.
   - Run type checks and the app build.
   - Verify web playback state in the preview; Android-specific audio output will require a fresh APK/device test.

## Technical details
- Centralize queue normalization instead of patching individual screens.
- Use stable content fingerprints for deduplication and position-aware IDs only for native timeline synchronization.
- Keep native and browser playback ownership mutually exclusive to prevent double advancement.
