# Fix queue, layout, recommendations, and trending

## What will change
- Remove the confirmed phone-screen collisions: place download status above the player/navigation stack and make full-player controls reachable on short screens.
- Route all large and queue-adjacent artwork through the high-resolution artwork loader to eliminate blurry thumbnails and broken aspect-ratio flashes.
- Make Smart Remix strict: keep only seed-relevant artist/title/genre/mood results, remove unrelated global-trending filler, and allow a shorter queue rather than inserting random songs.
- Stop India-specific catalog fallbacks outside India; preserve the listener’s actual country through chart results and use global/keyless chart fallbacks when local data is unavailable.
- Tag playback trend events with the listener’s country so “Trending” reflects recent local listeners instead of silently becoming global.
- Reject stale chart rows and avoid presenting evergreen Last.fm popularity as current viral activity.

## Verification
- Check Home, queue, mini-player, download panel, and full player at short and standard Android phone sizes for clipping or overlap.
- Confirm queue and full-player artwork load sharp fallback candidates.
- Exercise Smart Remix and verify every inserted track passes the relevance gate with no arbitrary popularity fallback.
- Verify a non-India market does not call or label the India catalog as its local chart.
- Run focused checks and inspect the latest preview diagnostics before reporting completion.

## Technical details
- Changes will stay within the existing player, artwork, chart, and feed systems.
- Any database/function update will retain current row-security rules and be delivered as a migration where required.
- No claim of perfect recommendations or universal stream success will be made; completion means the identified faults are fixed and verified in the available preview.
