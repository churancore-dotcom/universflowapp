# Reliable No-Proxy Android YouTube Playback

## Goal
Make YouTube playback as resilient as practical without a paid proxy, while being honest that no unofficial YouTube resolver can be guaranteed forever. Keep resolution and tokens on the Android device.

## Implementation
1. **Repair the current resolver foundation**
   - Derive cache lifetime from each signed stream URL’s real `expire` parameter instead of assuming five hours.
   - Invalidate expired or rejected URLs immediately and retry resolution once.
   - Rotate stale `visitorData` after repeated all-client failures so one poisoned session cannot break playback for 30 days.
   - Track short-lived client failures and temporarily deprioritize clients returning `LOGIN_REQUIRED`, SABR-only, or unusable formats.

2. **Make playback failures self-healing**
   - Return structured native failure reasons rather than one generic “resolve failed” error.
   - On HTTP 403, force-refresh player JavaScript, clear that track’s stream cache, and resolve again through another client.
   - Preserve JioSaavn/direct-source fallback and stale-stream fallback, but never loop indefinitely.

3. **Harden account-connected playback**
   - Separate authenticated TV requests from anonymous client requests so account tokens cannot be mixed with anonymous visitor state.
   - Improve token refresh/pairing retry handling and avoid silently treating transient Google errors as permanent disconnects.
   - Remove the embedded OAuth client secret from source; use a public-client-compatible flow if supported by the configured client. If Google rejects secretless exchange, stop and report that a secure server-side token exchange is required rather than shipping the secret in the APK.

4. **Prepare for YouTube’s current protocol direction**
   - Introduce clean provider seams for on-device PO-token generation and SABR playback, without pretending a stub fixes playback.
   - Keep current progressive/DASH clients as the active path; add PO-token/SABR only when a tested Android-compatible implementation can be integrated safely.

5. **Verification**
   - Add native unit coverage for URL expiry, client cooldowns, visitor rotation, and retry limits.
   - Run Android compile/tests and verify the web project remains unaffected.
   - Report exactly which paths are operational and any remaining YouTube-controlled limitations.

## Technical notes
- The app already has on-device multi-client InnerTube resolution, player-JS deciphering, ExoPlayer, account pairing, and direct-source fallback. The immediate reliability gaps are stale signed URLs, weak failure classification, poisoned visitor sessions, and no playback-time 403 recovery.
- A permanent guarantee is impossible for a private protocol controlled by YouTube. The sustainable model used by maintained open-source clients is layered fallback plus fast self-healing updates; PO tokens and SABR are the next major compatibility layer.
