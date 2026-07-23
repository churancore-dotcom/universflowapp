# Spotify for Artists — Full Parity Plan

Ship in 4 sequential passes. Each pass is independently useful; nothing is left half-done.

## Current state

We already have: verification (MediaPipe liveness + music platform proof), `artist_profiles`, `artist_songs`, uploads to `covers` bucket, follower system, basic Studio/Overview/Analytics/Songs pages, share cards, `song_play_events` table with country/city, real view/play/like/download counters, admin approval flow.

Missing vs Spotify: real-time analytics depth, audience demographics/top-cities per song, Artist Pick, gallery, canvas videos, pre-save/smart links, release scheduling, release calendar, richer profile customization.

---

## Pass 1 — Analytics Dashboard (Spotify-grade)

**Data (single migration):**
- Add `song_saves_daily`, `song_plays_daily`, `artist_listeners_daily` materialized-ish rollup tables (real tables, refreshed by trigger from `song_play_events` + `user_library`) — powers fast charts without scanning raw events.
- `get_artist_analytics(artist_user_id, since, until)` SECURITY DEFINER RPC returning: streams, listeners, saves, followers-gained, top-songs, top-cities, top-countries, age-unknown/gender-unknown buckets (we don't collect demographics — show "coming soon" placeholder honestly).
- `get_song_analytics(song_id, since, until)` RPC: per-song streams/saves/skips/completion + top cities.

**UI — `src/pages/artist/Analytics.tsx` rebuild:**
- Header KPI row: Streams / Listeners / Saves / Followers with 7d delta arrows.
- Time-series area chart (28d default, toggles 7d/28d/90d/12mo/lifetime) — recharts.
- Top Songs table (sortable), Top Cities map-less list, Top Countries with flags.
- Per-song drill-down page `src/pages/artist/SongAnalytics.tsx` (route `/artist/songs/:id/analytics`).
- Realtime: subscribe to `song_play_events` for the artist's own songs; increment KPI counters live.

## Pass 2 — Profile Customization (Artist Pick, Gallery, richer bio)

**Data:**
- `artist_profiles`: add `artist_pick` jsonb (`{ type: 'song'|'playlist'|'message', ref_id, message, pinned_at }`), `gallery_urls text[]`, `tagline`, `pronouns`, `location`, `accent_color`.
- Storage: reuse `covers` bucket, path `artist-gallery/{user_id}/…` with RLS "artist can write own".

**UI:**
- `src/pages/artist/EditProfile.tsx` rebuild: sections for Bio, Artist Pick (search own songs, add note), Gallery (up to 8 images, drag-reorder), Tagline, Pronouns, Location, Accent color picker (drives page gradient).
- `src/pages/artist/ArtistPublic.tsx`: show Artist Pick card above discography, gallery carousel below, accent color used in banner gradient.

## Pass 3 — Release & Upload Flow (scheduling + calendar)

**Data:**
- `artist_songs`: add `release_at timestamptz`, `visibility text` ('draft'|'scheduled'|'live'|'taken_down'), keep `status` for moderation.
- Cron edge fn `release-scheduler` runs every 5 min: flips `scheduled → live` when `release_at <= now()` and moderation passed.

**UI:**
- Rebuild `src/pages/artist/Upload.tsx` as a 4-step wizard: Audio → Metadata → Cover → Release (now / schedule date+time / save draft).
- `src/pages/artist/Releases.tsx` — calendar view (month grid) + list of upcoming/past releases, edit/reschedule/cancel.
- `src/pages/artist/Songs.tsx`: filter chips for Draft / Scheduled / Live / Taken down.

## Pass 4 — Promo tools (Canvas, Pre-save, Share cards, Campaigns)

**Canvas (looping 3–8s vertical video per song):**
- `artist_songs.canvas_url`. Upload to `covers` bucket under `canvas/{song_id}/…`. Server validates dimensions (9:16) and duration (3–8s) in edge fn `validate-canvas`. Player fullscreen view already exists — swap static cover for `<video loop muted autoplay playsInline>` when `canvas_url` present.

**Pre-save / Smart links:**
- Public page `/link/:slug` — `smart_links` table (`slug`, `song_id`, `artist_user_id`, `created_at`, `click_count`, `presave_count`).
- Users signed in → one-tap "Add to Library on release" → row in `presaves` table; when song flips to `live`, edge fn `flush-presaves` inserts to `user_library` and sends push.
- Signed out → deep-link into app + web fallback.

**Share cards:** already exist (`ArtistShareCard.tsx`) — extend with song-specific card + Canvas frame preview.

**Campaigns (Marquee-lite):**
- `artist_campaigns` table (`artist_user_id`, `song_id`, `headline`, `budget_credits`, `starts_at`, `ends_at`, `status`, `impressions`, `clicks`).
- Renders as a promoted card in `HomeBento` for followers of the artist (free), or all users if `budget_credits > 0` (later). Budget in "credits" — no real payment yet; admin approves.
- Admin page `src/pages/admin/CampaignReview.tsx`.

---

## Technical notes

- All new tables get `GRANT` block + RLS: artists read/write own rows, public reads only where applicable (`artist_pick`, `gallery_urls`, `canvas_url`, `smart_links`).
- Analytics realtime: `supabase.channel(...).on('postgres_changes', ...)` filtered by artist's own song IDs.
- Storage RLS: `artist-gallery/{user_id}/…` and `canvas/{song_id}/…` only writable by owner.
- Cron: use `pg_cron` + `net.http_post` for `release-scheduler` and `flush-presaves` (matches existing patterns).
- No breaking changes to existing `Studio.tsx`; new pages added, old pages upgraded in-place.
- Estimated size: ~15 new/rebuilt files per pass, 1 migration per pass.

## Order of execution

1. Pass 1 (Analytics) — highest-value, most-visible Spotify feature.
2. Pass 2 (Profile) — visible win, small surface.
3. Pass 3 (Release) — unlocks scheduling.
4. Pass 4 (Promo) — Canvas + Pre-save + Campaigns.

I'll start with Pass 1 as soon as you approve. Confirm and I ship.
