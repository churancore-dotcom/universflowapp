## Goal
Replace the current Supabase/web-resolution pipeline on Android with a native Kotlin resolver chain (JioSaavn → InnerTube → emergency fallback) feeding directly into ExoPlayer in a foreground Service. Zero UI changes.

## Files to create

1. **`android/app/src/main/java/com/universeflow/app/resolver/StreamResult.kt`**
   - Data class: `url`, `itag`, `bitrate`, `source` ("youtube" | "jiosaavn" | "edge"), `expiresAt`, `mimeType`.
   - Sealed `StreamResolutionException` hierarchy (NotFound, Network, Cipher, Parse).

2. **`android/app/src/main/java/com/universeflow/app/resolver/StreamCache.kt`**
   - `LruCache<String, StreamResult>` capacity 50, keyed by normalized track id (`yt:<videoId>` / `js:<saavnId>`).
   - `get()` returns null if `expiresAt < now`; `getStale()` returns within 30-min grace for emergency fallback.

3. **`android/app/src/main/java/com/universeflow/app/resolver/JioSaavnClient.kt`**
   - `searchAndResolve(title, artist): StreamResult?` calls `https://www.jiosaavn.com/api.php?__call=autocomplete.get` + `song.getDetails`.
   - Confidence match: normalized title equality + artist token overlap ≥1.
   - Decrypts the `encrypted_media_url` via JioSaavn's DES key (`38346591`) to direct CDN URL; sets `expiresAt = now + 6h`.

4. **`android/app/src/main/java/com/universeflow/app/resolver/InnerTubeClient.kt`**
   - POST `https://music.youtube.com/youtubei/v1/player?key=AIzaSyAOghZGza2MQSZkY_zfZ370N-PUdXEo8AI`.
   - Body uses `ANDROID_MUSIC` context (clientVersion `7.27.52`, androidSdkVersion 34, hl/gl).
   - Headers: Content-Type, UA matching `com.google.android.apps.youtube.music/7.27.52`, `X-Goog-Api-Format-Version: 2`.
   - OkHttp 10s timeout.

5. **`android/app/src/main/java/com/universeflow/app/resolver/YouTubeStreamResolver.kt`**
   - `resolveStream(videoId): StreamResult` — parses `streamingData.adaptiveFormats`, prefers itag 251 then 140, extracts `url` or deciphers `signatureCipher` via existing `PlayerJsManager`.
   - Sets `expiresAt` from URL's `expire` param.

6. **`android/app/src/main/java/com/universeflow/app/resolver/MasterResolver.kt`**
   - `resolve(track: TrackHint): StreamResult` — chain: cache → JioSaavn (if title+artist provided) → YouTube → stale cache → throw.
   - `prefetch(tracks: List<TrackHint>)` — `async/awaitAll` on IO dispatcher, up to first 5.

7. **`android/app/src/main/java/com/universeflow/app/StreamResolverPlugin.kt`**
   - `@CapacitorPlugin(name = "StreamResolver")` exposing `resolveStream({ videoId, title, artist })` returning `{ url, source }` for UI use only (lyrics, share, download).

## Files to modify

8. **`ExoPlayerPlugin.kt` / `NativeMediaSourceFactory.kt`**
   - Replace `NativeYouTubeResolver.resolve()` calls with `MasterResolver.resolve()`.
   - Tap-to-play path: cache hit → immediate `setMediaItem/prepare/play`; miss → IO resolve → main-thread play. Remove any Supabase edge call from this hot path (keep only in `MasterResolver` as last-resort).
   - Add `prefetch(videoIds, titles, artists)` JS-callable method invoking `MasterResolver.prefetch`.

9. **`ExoPlayerService.kt`**
   - Keep `MasterResolver` + `StreamCache` as service-scoped singletons (survive Activity recreation).
   - Audit: no auto-`pause()` after `prepare()`, no pause on `AUDIOFOCUS_LOSS_TRANSIENT` (duck only), `foregroundServiceType="mediaPlayback"` confirmed in manifest, `startForeground()` on first play.

10. **`MainActivity.kt`** — register `StreamResolverPlugin`.

11. **`android/app/build.gradle`** — already has OkHttp + Rhino; no new deps needed.

## JS-side change (minimal)

12. **`src/lib/nativeStreamResolver.ts`** (or wherever the resolver bridge lives) — on Android, call `prefetch` for first 5 visible songs in list components that already render rails; route tap-to-play through native plugin without Supabase round-trip. **No UI changes.**

## Verification

- `./gradlew :app:compileDebugKotlin` passes (run via `code--exec`).
- Manual smoke after build: tap song → audio in <1s for cached, <2s cold; lock screen → keeps playing; rotate → keeps playing.

## Out of scope

- All UI/layout/theme code.
- Web (non-Android) playback path is unchanged.
- iOS — no changes.