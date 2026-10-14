# Project architecture rules

- Detect APK connectivity with Capacitor Network, never a bundled localhost fetch; route offline startup to device downloads before remote auth or profile gates.

- Own offline audio/cover object URLs in one registry and release them on removal, clearing, and teardown; native file URLs never need blob allocation.
- Native playback retries must match the active generation, player, item, and play intent; detach plugin listeners without stopping the background service.
- Reset native recovery per media item, sequence volume ramps to the active play request, renew long-session power locks, and cancel asynchronously attached lifecycle listeners.

- Keep native launch covered only until the shell paints; never stack a web logo reveal or fixed plugin-initialization delays over it, to avoid startup stalls.

- Keep India-specific JioSaavn editorial fallbacks gated to the IN market; other markets degrade to fresh global sources to avoid geographic feed bias.
- Smart queue expansion may return fewer tracks but must never use unrelated global popularity as filler; recommendation relevance beats queue length.
- Playback trend events include the silently detected two-letter market so country charts reflect local listening.
- Chart reads reject data older than 48 hours and exclude Last.fm all-time rows from the viral fallback because evergreen popularity is not current virality.
- Trending follows official external chart order only: YouTube Music regional charts first, then fresh Apple Music most-played fallback; never use app listeners, AI, taste, Audius, JioSaavn, or keyword search to rank it.
- Player share uses a static image card plus link sharing only; never animated or video cards (user rejected them).
- Ad completion is single-use and starts a cooldown before another completed-song boundary can schedule an ad.
- Private artist identity-photo paths must be rooted in the authenticated artist's own storage folder before persistence and privileged reads.
- Keep playback progress in the external progress store and use one shared scroll-visibility signal so high-frequency updates never repaint whole pages.
- Website APK releases use one fixed storage object replaced only after a successful CI build; downloads bypass caching and static release sizes/versions are omitted to prevent stale claims.
- Play-distributed Premium uses consumable fixed-duration products whose prices come from Google Play; server verification grants 30, 60, or 90 days and consumes each token once.
- Account deletion is recoverable for exactly seven days, then a privileged scheduled worker removes the authentication identity and cascading app data.- Google Play Billing activates only when the Play AAB build sets VITE_PLAY_STORE=true; website APKs keep UPI checkout because they are not installed from Play.
