# Spotify-for-Artists Parity — Gap Analysis + Build Plan

You already have most of what that prompt asks for. Rather than rebuild it, this plan **fills the missing pieces** so UniversFlow reaches full parity without breaking existing surfaces.

## What already exists (verified against current codebase)

- **Artist upload** (`/artist/upload`) — 4-step wizard: source → details (title, genre, cover, description) → schedule → review. Direct upload to storage.
- **Artist dashboard** (`/artist/studio`) — songs list with plays, likes, downloads, view counts; take-down; edit.
- **Artist analytics** (`/artist/analytics`) — KPI cards, streams/listeners time-series, top cities/countries, top songs, follower growth (from `get_artist_analytics` RPC + `song_play_events`).
- **Public artist page** (`/a/:slug`) — Artist Pick, gallery, accent color, follow button, verified badge, popular tracks.
- **Scheduling** — `scheduled_release_at`, `publish_due_scheduled_songs()` cron promoter, trigger auto-flip to `live`.
- **Notifications** — `notify_system_push` + `send-system-push` edge function; approval/rejection pushes wired.
- **Verification** — MediaPipe liveness + Gemini face-match + ownership code + social verification.

## What's actually missing (this plan)

### 1. Admin song review queue
- New admin route `/admin/song-reviews` listing `artist_songs` with `status = 'draft'` pending review (currently uploads go straight to `live` or `scheduled` — need an optional "review before live" pipeline).
- Add enum value `pending_review` to `artist_song_status`, plus a `review_required` app setting toggle so trusted verified artists can bypass.
- Admin actions: preview audio, approve (→ live or keep scheduled), reject with reason (writes to `takedown_reason`, notifies artist), flag explicit.
- Artist gets push on approve/reject via existing `notify_system_push`.

### 2. Royalties + payouts
- New table `artist_payouts` (artist_user_id, streams_count, amount_inr, amount_usd, period_start/end, status, upi_id, requested_at, paid_at, admin_note).
- Rate: ₹25 per 1000 verified streams (streams counted from `song_play_events` where `action = 'stream'`, deduped by `user_id`/`session_id` per song per day to prevent farming).
- SECURITY DEFINER RPC `request_artist_payout()` — validates ≥ ₹500 unpaid balance, locks the streams window into a pending payout row.
- Artist "Earnings" tab in `/artist/studio`: lifetime streams, unpaid balance, payout history table, "Request payout" button (opens UPI form).
- Admin `/admin/payouts` queue: pending list with UPI, mark-as-paid RPC, audit log entry.

### 3. Milestone notifications
- Trigger on `artist_songs` update: when `play_count` crosses 100 / 1k / 10k / 100k / 1M, fire `notify_system_push` to the artist. Track last-fired milestone in a new `milestone_reached` int column to avoid duplicate pushes.
- Trigger on `artist_followers` insert: notify artist "New follower: {username}" (throttled via existing `artist_push_throttle` at 1/hour).

### 4. Minor gaps in the prompt
- Featured artists, language, mood tags, explicit toggle → add to `artist_songs` (`featured_artists text[]`, `language text`, `mood_tags text[]`, `is_explicit bool`) and expose in Upload wizard step 2.
- Monthly listener count on public page → compute from `song_play_events` distinct listeners last 30 days, add to `ArtistPublic.tsx` header.
- "Estimated earnings" card in `/artist/studio` overview using the same ₹25/1k formula.

## What we're deliberately NOT doing

- No new pages for things already shipped (`/artist/upload`, `/artist/dashboard`→`/artist/studio`, `/artist/analytics`, `/a/:slug`). Just enhancing them.
- No UI restyle — dark theme + rose accent stays.
- No changes to verification flow.

## Technical outline

```text
artist_songs
  + featured_artists text[]
  + language text
  + mood_tags text[]
  + is_explicit bool default false
  + milestone_reached int default 0
  + status enum adds 'pending_review'

artist_payouts (new table, RLS: artist reads own; admin reads all)
  id, artist_user_id, streams_count, amount_inr, amount_usd,
  period_start, period_end, status ('pending'|'processing'|'paid'|'rejected'),
  upi_id, requested_at, paid_at, admin_note

RPCs (SECURITY DEFINER)
  request_artist_payout(_upi_id text) -> jsonb
  admin_mark_payout_paid(_payout_id uuid) -> jsonb
  get_artist_earnings_summary(_artist_user_id uuid) -> jsonb

Triggers
  artist_songs milestone check on UPDATE of play_count
  artist_followers new-follower push on INSERT (throttled)

Cron
  Reuse existing publish_due_scheduled_songs schedule.

Frontend
  src/pages/artist/Upload.tsx        (add featured/language/mood/explicit)
  src/pages/artist/Studio.tsx        (add Earnings tab)
  src/pages/artist/Earnings.tsx      (new — history + request payout)
  src/pages/ArtistPublic.tsx         (add monthly listeners)
  src/pages/admin/SongReviews.tsx    (new)
  src/pages/admin/Payouts.tsx        (new)
```

## Build order (2 passes)

**Pass A — Money + trust**
1. Migration: `artist_payouts` table + RLS + earnings RPCs + milestone trigger + new `artist_songs` columns.
2. `/artist/studio` Earnings tab + `/admin/payouts` queue.
3. Milestone + follower pushes.

**Pass B — Metadata + review pipeline**
4. Upload wizard extra fields (featured/language/mood/explicit).
5. `pending_review` status + `/admin/song-reviews` queue + toggle setting.
6. Monthly-listeners badge on public artist page.

Reply **GO** to start Pass A, or tell me which subset you want first.
