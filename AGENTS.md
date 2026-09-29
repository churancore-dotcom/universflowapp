# Project architecture rules

- Keep India-specific JioSaavn editorial fallbacks gated to the IN market; other markets degrade to fresh global sources to avoid geographic feed bias.
- Smart queue expansion may return fewer tracks but must never use unrelated global popularity as filler; recommendation relevance beats queue length.
- Playback trend events include the silently detected two-letter market so country charts reflect local listening.
- Chart reads reject data older than 48 hours and exclude Last.fm all-time rows from the viral fallback because evergreen popularity is not current virality.
- Trending follows official external chart order only: YouTube Music regional charts first, then fresh Apple Music most-played fallback; never use app listeners, AI, taste, Audius, JioSaavn, or keyword search to rank it.
- Player sharing must remain lightweight: share song details with the UniversFlow app URL only; never generate video cards or expose per-song URLs.