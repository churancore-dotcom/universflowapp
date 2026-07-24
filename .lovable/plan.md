# Spotify-for-Artists → Univers Flow Parity

Goal: mirror every core Spotify for Artists (S4A) flow inside Univers Flow, adapted to our stack (Supabase + native APK + editorial rails). No fake features — every screen backed by real data.

## How Spotify actually works (researched)

1. **Two entry points**
   - **New artist**: create Spotify account → sign up to Spotify for Artists → connect via a distributor (DistroKid, TuneCore, CD Baby, Amuse, etc.) → distributor delivers song → Spotify auto-creates artist profile → artist claims it.
   - **Existing artist**: already has releases on Spotify → goes to `artists.spotify.com` → requests access → verifies via social/email → gets dashboard.
2. **Verification** = blue checkmark (not paid). Automatic after: 1 release live + claim + basic profile filled.
3. **Dashboard tabs**: Home · Music · Audience · Playlists · Campaigns · Profile.
4. **Monetization**: ~$0.003–$0.005/stream, monthly rollup, paid via distributor (Spotify pays distributor, distributor pays artist).
5. **Distribution**: Spotify Distribution (via SoundOn / DistroKid partnership) → 1 upload → 150+ platforms.
6. **Profile tools**: Artist Pick, Canvas (looping video), Bio, Gallery, Concerts, Merch, Playlist submission for editorial.

## Univers Flow parity plan — 5 passes

Already shipped (from prior passes): OAuth, artist auth, KYC + face liveness, upload wizard w/ scheduling, analytics, earnings + payout, milestones, follower push, artist pick + gallery, accent color.

Remaining gaps → build in 5 passes.

### Pass 1 — Signup & Onboarding Rewrite (Spotify-parity)
- Rewrite `/artist/apply` as 4-step onboarding: **Account → Identity → Music Proof → Review**.
- Add "I already have music on Univers Flow" vs "I'm a new artist / distribute with us" branch.
- **Claim existing profile**: match user by stage name → auto-list unclaimed `artist_profiles` → send claim request.
- **New artist distribution**: use existing Upload wizard as the delivery pipeline (Univers Flow = its own distributor).
- Progress bar, save-and-resume state in `artist_applications`.

### Pass 2 — Native Distributor Layer ("UF Distribution")
- New table `distribution_releases` (release-level container: 1 release = N songs, artwork, UPC/ISRC placeholder, release date, territories).
- `/artist/studio/releases` — releases list (draft / in-review / live / takedown).
- New release wizard: **Release type (Single/EP/Album) → Tracks → Artwork → Metadata → Rights → Schedule → Review**.
- Rights checkbox: "I own or control 100% of the rights" (legal gate).
- Auto-assign internal UF-ISRC (`UF-{year}-{seq}`) and UF-UPC.
- Songs auto-materialized into `artist_songs` on approval.

### Pass 3 — Dashboard Rebuild (S4A layout)
- Rebuild `/artist/studio` (Overview) into S4A layout: Hero card + 28-day metric strip + Top songs + Recent listeners map + Playlist placements.
- Add `/artist/studio/audience` — gender/age skip (privacy), country breakdown, superfans (top 1% listeners), source of streams (search/library/rails).
- Add `/artist/studio/playlists` — where the artist's songs appear (auto-generated Daily Mix, Mood, Editorial).
- Add `/artist/studio/pitch` — submit unreleased song for editorial rail consideration (goes to admin queue).

### Pass 4 — Verified Badge System (real, not decorative)
- Auto-verify rules: (≥1 live song) AND (KYC approved) AND (profile ≥ 80% complete) AND (≥100 followers) → award `is_verified = true`.
- Nightly cron via `pg_cron` on `artist_profiles`.
- Manual admin override.
- Verified badge shown on Search, Rails, Public page, Player.

### Pass 5 — Promo Tools & Pitch
- **Canvas**: 3–8s looping video per song (reuse existing video upload; render behind fullscreen player).
- **Pre-save links**: `/pre/:releaseId` public landing for scheduled releases.
- **Marquee**: artist-purchased promo card in Home rail (uses existing payment_requests table for INR payout).
- **Share Cards** already shipped — link into Promote tab.

## Technical section

- **Migrations**: `distribution_releases`, `release_tracks`, `release_pitches`, `canvas_videos`, `pre_save_intents`; add `verified_reason` + `verified_at` to `artist_profiles`.
- **RPCs**: `submit_release`, `admin_approve_release`, `claim_artist_profile`, `submit_editorial_pitch`, `recompute_verified_status`.
- **Cron**: nightly verified recompute + weekly audience aggregation into a materialized view `artist_audience_28d`.
- **Storage buckets**: `release-artwork` (public read), `canvas-videos` (public read), reuse `artist-avatars`.
- **Push**: release approved / release live / editorial accepted / verified awarded.
- **Files touched** (approx 25): `Apply.tsx`, new `Releases.tsx` + `NewRelease.tsx`, `Overview.tsx` rebuild, new `Audience.tsx` + `Playlists.tsx` + `Pitch.tsx` + `Canvas.tsx` + `PreSave.tsx`, `App.tsx` routes, `ArtistLayout.tsx` nav, admin `ReleaseQueue.tsx` + `EditorialPitches.tsx`.

## Execution order

Pass 1 → 2 → 3 → 4 → 5. Each pass ends in a shippable state. I'll ask before starting each pass so you can reprioritize.

Reply **GO** to start Pass 1 (Signup & Onboarding Rewrite).