# Project architecture rules

- Detect APK connectivity with Capacitor Network, never a bundled localhost fetch; route offline startup to device downloads before remote auth or profile gates.

- Own offline audio/cover object URLs in one registry and release them on removal, clearing, and teardown; native file URLs never need blob allocation.
- Native playback retries must match the active generation, player, item, and play intent; detach plugin listeners without stopping the background service.
- Reset native recovery per media item, sequence volume ramps to the active play request, renew long-session power locks, and cancel asynchronously attached lifecycle listeners.
- Schedule Android overlaps in the playback service and connect browser overlap audio to the existing effects graph; autoplay controls recommendation extension, not explicitly queued songs.
- Both Android overlap players use independent PCM processors with the same saved EQ/room/stem snapshot; 8D rotation and headphone crossfeed have separate persisted strengths so transitions never bypass effects or conflate controls.
- Auto EQ changes tonal bands and bass only, preserving user-selected spatial, room and speed settings so song changes cannot silently disable enhancements.
- All page, lazy-import and access-gate waits use the shared PageLoader, with navigation pending visible immediately and no artificial minimum duration to avoid blank screens.

- Keep native launch covered only until the shell paints; never stack a web logo reveal or fixed plugin-initialization delays over it, to avoid startup stalls.

- Keep India-specific JioSaavn editorial fallbacks gated to the IN market; other markets degrade to fresh global sources to avoid geographic feed bias.
- Smart queue expansion may return fewer tracks but must never use unrelated global popularity as filler; recommendation relevance beats queue length.
- Playback trend events include the silently detected two-letter market so country charts reflect local listening.
- Chart reads reject data older than 48 hours and exclude Last.fm all-time rows from the viral fallback because evergreen popularity is not current virality.
- Trending follows official external chart order only: YouTube Music regional charts first, then fresh Apple Music most-played fallback; never use app listeners, AI, taste, Audius, JioSaavn, or keyword search to rank it.
- Editorial rails use the shared AI-disclosure filter before display, preserving provider order; metadata detection cannot certify undisclosed synthetic tracks.
- New Releases uses the provider's explicit release shelf and never substitutes keyword search or most-played charts; an empty shelf is preferable to mislabeled old songs. India uses JioSaavn's dated release shelf because YouTube's anonymous shelf follows server IP, not market; search only maps listed songs to playable uploads, and undated tracks are dropped. Outside India the APK fetches YouTube Music's release shelf from the phone itself (its own network decides the market) with verified upload dates; web and unknown markets show no New Releases shelf. A failed fetch retries once, then may reuse only that market's last successful shelf from the past 24 hours, so a cold start never hides the rail.
- Admin work queues use existing RLS-protected counts and management destinations; pinned navigation is user-scoped convenience state, never authorization.
- Catalog management pages render bounded row windows, fetch all catalog batches for accurate filters/export, and neutralize spreadsheet formulas in CSV cells; this avoids truncated reviews and unsafe exports.
- Catalog quality diagnostics and bulk target selection use pure tested helpers; bulk visibility updates require confirmation and verify returned row IDs so partial or denied writes cannot appear successful.
- Launcher density assets share a centered, safe-zone foreground and monochrome mark; committed resources remain the build source of truth to prevent cropping and overwrites.
- Player share uses a static image card plus link sharing only; never animated or video cards (user rejected them).
- Ad completion is single-use and starts a cooldown before another completed-song boundary can schedule an ad.
- Private artist identity-photo paths must be rooted in the authenticated artist's own storage folder before persistence and privileged reads.
- Keep playback progress in the external progress store and use one shared scroll-visibility signal so high-frequency updates never repaint whole pages.
- Website APK releases use one fixed storage object replaced only after a successful CI build; downloads bypass caching and static release sizes/versions are omitted to prevent stale claims.
- Play-distributed Premium uses consumable fixed-duration products whose prices come from Google Play; server verification grants 30, 60, or 90 days and consumes each token once.
- Account deletion is recoverable for exactly seven days, then a privileged scheduled worker removes the authentication identity and cascading app data.
- Account deletion feedback is optional and saved atomically with its deadline; admin review never gates cleanup. Subscription event notices are persisted per recipient with unique event keys, and expiry processing handles rows already expired by other jobs.
- The Play AAB distribution flag selects Play-only checkout independent of bridge availability; require Play prices and server verification readiness before purchase, while website APKs retain UPI.
- Claim verified Play tokens atomically in a permanent server-only ledger before granting fixed-term access; retries must reattempt consumption without regranting access.
- Studio Spaces never add bass/EQ to the dry track; room character lives only in a band-limited, dry-ducked wet send (envelope normalised to full scale), and the Android output uses a look-ahead limiter plus dithered 16-bit rounding so rooms stay audible without muddying, crunching or hissing.
- A selected Studio Space owns the native reverb until explicitly cleared, and each space keeps its own physically modelled impulse response (image-source reflections, discrete echoes, per-octave decay) convolved with the song; kernels build off the audio thread and only swap while the room is faded out, so effect updates never swap rooms mid-song.
- Native bass, loudness and room gain have one PCM owner before the limiter; never re-enable vendor duplicates after session binding, because downstream gain bypasses clipping protection.
- The APK media cache sits below stream resolution and keys entries by exact file (video, itag, clen); unidentified streams (JioSaavn, fallbacks, metadata lookups) play uncached so two versions of a song can never be spliced.
- Admin release publishing and activation go through atomic admin-checked database functions, never multi-step client writes, so a failure can never leave zero active releases.
