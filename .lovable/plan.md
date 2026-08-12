# Audit findings first, then targeted fixes

## 1. Audit: what is actually wrong with "Made For You"

`MadeForYouSection` (src/components/MadeForYouSection.tsx) does exist and is genuinely per-user: it seeds YouTube Music searches from `topTasteArtists`/`topTasteKeywords` (built in `feedPersonalizer.ts` from 30 days of `song_play_events`, liked songs, followed artists, and local recents), removes recently played, mutes heavily-skipped artists, reranks and diversifies. So the engine is real — it is **not** a fake shelf. Four concrete defects:

1. **Broken seed query (silent DB error).** It calls `stream_songs.select('artist,title').in('id', recentIds)`. `stream_songs` has no `id` column (its key is `track_id`), so that request errors, `data` is null, and that whole seed source is silently dropped. Only the local-recents + taste seeds survive.
2. **Signed-out and first-session users get the generic pool.** `recentEntries` is gated on `user?.id`, while the anonymous taste profile reads recents under the `anon` key. Cold visitors therefore always land on the rotating "top hits / viral songs" fallback queries — the same rows for everyone, which is exactly the "not personalized" complaint.
3. **It depends entirely on an authenticated edge call.** `searchYouTubeMusicTracks` → `yt-music-search`, which requires a valid JWT (verified live: anonymous calls return `401 Invalid authentication`). For signed-out visitors the section renders nothing at all.
4. **No country awareness.** The cold-start fallback pool mixes Bollywood/Punjabi queries into every region's feed regardless of the listener's country.

## 2. Audit: why trending looks like one country for everyone

`TrendingNowSection` asks `useYtmCharts(country)`; `useUserCountry()` starts as `''` on every cold open, so the first fetch is the Global (`ZZ`) chart, and only re-fetches once geo resolves. When YT returns no chart tiles, or when the edge call 401s (signed-out), the component falls back to a **keyword search** using `getCountryQueries(country).trending`. With country still empty that is the string `global top songs this week official music …` — a plain YouTube search, which returns whatever YouTube's search ranking gives (heavily India/Bollywood weighted for this app's traffic). That fallback, not the real chart, is what users are seeing.

Meanwhile the app already has a genuine per-country chart source that nobody on Home reads: the `chart_tracks` table, refreshed today at 06:00 UTC by the `chart-aggregator` cron, with 20 countries + GLOBAL across `trending` / `viral` / `latest` chart types, and an anon-readable SELECT policy (verified).

## 3. Fixes to make (no rebuilds)

**Country resolution (`src/hooks/useUserCountry.ts`)**
- Persist the resolved country in `localStorage` (not just `sessionStorage`) so cold opens start with the last known real country instead of `''`.
- Keep priority: profile `country_code` → `geo-detect` edge (IP) → locale region → Global.

**Trending (`src/components/TrendingNowSection.tsx`, small helper in `src/lib/appTrending.ts` or a new `src/lib/countryCharts.ts`)**
- Replace the keyword-search fallback with `chart_tracks` for the resolved country (`trending`, then `viral`, then GLOBAL), preserving `rank`. This works signed-out and is real chart data, not search noise.
- Keep the existing order of precedence: real YTM chart → `chart_tracks` for the country → GLOBAL `chart_tracks`. Keyword search is dropped entirely.
- Keep the existing in-app heat boost, taste rerank, and artist diversification untouched.
- Show a quiet country label under the heading (e.g. "Top in Brazil" / "Top worldwide") so it is verifiable that the right chart is being served.

**Made For You (`src/components/MadeForYouSection.tsx`)**
- Fix the `stream_songs` seed query to filter on `track_id` instead of the nonexistent `id`.
- Read local recents with the same key the taste profile uses, so signed-out listeners' device history seeds the shelf.
- Replace the hardcoded genre fallback pool with country-aware seeds from `getCountryQueries(country)` plus `chart_tracks` rows for the listener's country, so the cold-start state is real regional music instead of a static list.
- When the YTM search path returns nothing (signed-out 401), fall back to `chart_tracks` reranked by the existing taste profile — the shelf then still personalizes ordering instead of disappearing.
- No new tables, no new edge functions, no parallel recommender.

## 4. UI pass (only after 1–3 verified)

Targeted, not a redesign — the Trending poster carousel and the bottom nav pill already match the brief. Limited to:
- "Made For You" hero card: add the depth treatment the Trending hero already has (blurred artwork bleed, gradient scrim, subtle glass border) so the two heroes read as one design language.
- Add the country/label chip and skeleton shimmer states so the rails don't pop in bare.
- No changes to navigation, theme tokens, or other sections.

## Verification
- Query `chart_tracks` per country and confirm the rendered Trending rows match the stored chart for that country.
- Load Home in the preview with a forced country override and confirm rows differ per country and that the section renders while signed out.
- Confirm the `stream_songs` seed query returns rows instead of an error.

## Technical notes
- `yt-music-search` requires a JWT (`verify_jwt`), so every fallback added here must be a direct table read via the anon-readable `chart_tracks` policy.
- `chart_tracks` has no `listeners`/`plays` columns; listener counts continue to come from the `app_trending_tracks` RPC where needed.
