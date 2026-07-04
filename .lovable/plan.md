## What I'll change

### 1. Kill government ID docs — replace with stronger, legal proofs
- **UI:** Rip out ID doc pickers from `Apply.tsx`. Add three new steps:
  - **Music-platform ownership code** — we generate a short 6-char code (e.g. `UF-9K4P2`). Artist pastes it into their Spotify/Apple/YouTube artist bio. On submit, an edge function `artist-verify-ownership` fetches the public bio HTML and confirms the code is present. Auto-approves this check if found.
  - **Dual social handle check** — both Instagram + YouTube become required (was 1-of-any). Client validates handle format; edge function does a lightweight HEAD/GET to confirm profiles exist and aren't empty.
  - **Live face + date-sign gesture** — upgrade `FaceLivenessCapture` to a two-shot flow: (a) MediaPipe FaceLandmarker liveness (blink detected) auto-clicks a real-human photo — this already exists, keeping it. (b) Second frame asks artist to hold a paper with today's date; we OCR the frame with Tesseract.js (already in `pytesseract` land — will use `tesseract.js` in browser) and confirm today's date string appears. Anti-deepfake.
- **DB migration:**
  - Drop `id_doc_type`, `id_doc_front_path`, `id_doc_back_path`, `id_image_hash` columns from `artist_applications` (and matching view).
  - Add `ownership_code`, `ownership_verified_at`, `date_sign_ocr_text` columns.
  - Backfill: for every existing row with non-null `id_doc_*_path`, enqueue a purge to the existing `purge-artist-kyc` edge function (which already deletes from storage), then null the columns.
- Update `docsForCountry`, `uploadKycFile` and related helpers → delete unused code paths.

### 2. Fix upload success UX
- After first successful song upload in `Upload.tsx`:
  - Trigger full-screen `canvas-confetti` burst + animated 🎉🎆🎇🎊 emoji rain (framer-motion staggered).
  - Optimistically prepend the new song to the artist's song list in `useArtistLive` so it appears **instantly** on the Songs screen without waiting for the realtime round-trip.
  - Show a success sheet: "Your first song is live!" with a button to go to Songs.

### 3. Fix real-time metric counters (root cause)
Currently `artist_songs.play_count / view_count / like_count / download_count` **only update when the RPCs `increment_artist_song_*` are called**. Grep of the codebase suggests:
- `increment_artist_song_play` — likely never called on client (or gated behind a condition that's failing).
- `increment_artist_song_view` — no call site.
- `increment_artist_song_download` — likely not wired.
- Likes only increment through the `on_user_library_artist_like` trigger, which requires `song_id` to be a valid uuid string matching an `artist_songs.id`; if the app stores likes differently for artist songs, this silently no-ops.

I'll audit all four counters, wire the missing RPC calls at the correct play/view/download moments, and add a `useArtistLive` optimistic refresh so numbers change without page reload. Realtime subscription in `useArtistLive` already listens to UPDATE events, so once the counters actually fire, live numbers will follow.

### 4. Full artist-page audit
Verify each page renders correctly against the new schema and live counters: `Overview`, `Analytics`, `Songs`, `Followers`, `Notifications`, `Promote`, `Activity`, `EditProfile`, `Status`, `Studio`, `Upload`, `Apply`, `ArtistPublic`. Fix any broken column references from the migration and any stale metric readings.

## Technical notes
- New edge function: `artist-verify-ownership` (fetch platform HTML, look for code, return `{ok:true|false, platform, matched_text}`).
- OCR: `bun add tesseract.js` (~2MB, lazy-loaded only when liveness step opens).
- Migration is destructive on ID files — user already approved the purge in the earlier choice.
- Confetti already in deps (`canvas-confetti` is imported in `Apply.tsx`).
- Instant song visibility uses local state prepend + realtime as backup (dedupe on id).

## Order of execution
1. DB migration (drop cols, add cols, backfill purge)
2. New edge function for ownership check
3. `Apply.tsx` rewrite (new steps, remove ID pickers)
4. `FaceLivenessCapture.tsx` upgrade (add date-sign OCR frame)
5. `Upload.tsx` confetti + optimistic insert
6. Wire all `increment_artist_song_*` RPCs at correct call sites
7. Sweep every artist page for schema/metric issues, fix

Confirm and I'll ship it in that order.
