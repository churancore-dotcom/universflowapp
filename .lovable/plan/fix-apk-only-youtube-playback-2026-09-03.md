# Fix APK-only YouTube playback

## Goal
Make the Android app’s native YouTube path use valid video-bound proof tokens without adding tap-time waits, while preserving fast JioSaavn fallback.

## Changes
1. Replace the broken off-screen token page: the current jsDelivr file is an ES module and never creates `window.BG`, so token generation always reports “bgutils unavailable.” Load a browser-compatible bundled implementation instead.
2. Keep one initialized BotGuard/WebPo minter alive in the hidden WebView and mint a distinct content-bound token for each requested YouTube video ID. Do not reuse a visitor-bound token as the media token.
3. Extend the native token-provider seam to request tokens by video ID, asynchronously prewarm tokens for queued tracks, and read only cached tokens during playback resolution—no blocking/sleeping on tap.
4. Pass the video-bound token consistently to the WEB player request and the resulting `googlevideo` media URL, while leaving non-WEB clients token-free.
5. Improve native diagnostics so failures distinguish token unavailable, empty formats, SABR-only, HTTP/playability rejection, and fallback cutoff; cancel losing resolver work where practical.
6. Keep the current short YouTube-first race and immediate backup behavior so the fix cannot reintroduce multi-second silent starts.

## Verification
- Run repository checks available in this environment and validate generated WebView JavaScript independently.
- Confirm no blocking token wait remains in the playback path.
- Rebuild the APK in CI, then use Settings → Playback Diagnostics on a real device to measure YouTube wins and exact failures; Android-device proof is required for final success confirmation.

## Technical note
Current `bgutils-js@3.1.2/dist/index.min.js` is an ES module, not a browser global bundle, so the existing `<script>` integration cannot work. Current bgutils documentation also confirms modern web playback uses a token bound to each video ID rather than a reusable visitor-bound token.
