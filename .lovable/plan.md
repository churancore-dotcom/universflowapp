## Universflow Artist Verification v2 — full rebuild

### What changes for the artist (UX)

The application becomes a 3-step guided flow — no ID documents, no scans, no back-of-passport photo:

1. **Claim your artist page** — paste your Spotify / Apple Music / YouTube Music artist URL. We generate a unique 6-character code (e.g. `UF-A3K9`) and ask you to add it to your artist bio for ~10 minutes. Tap "Check now" and we fetch the public page, look for the code, and mark ✓ Owned.
2. **Prove you're real** — live selfie with MediaPipe blink + smile liveness (already built). We also pull the artist headshot from the platform page you claimed in step 1 and compare embeddings. Match score is stored for admin review.
3. **Optional social proof** — link an Instagram/X/TikTok with a verified badge. We scrape and record whether the badge is present. Doesn't gate approval, boosts admin confidence.

Every field autosaves. A progress rail shows which checks passed live via Supabase realtime — no page refresh needed.

### What changes for the admin

Admin queue rows now show, per applicant:

- Platform URL + ✓/✗ bio-code ownership + timestamp
- Selfie ↔ platform-photo embedding match score
- Social URL + ✓/✗ verified-badge presence
- Stage name, real name, country, phone (hashed dedupe already in place)

No auto-approval ever — every application waits for admin to approve/reject. Same admin queue, same one-tap approve/reject flow, just cleaner signals.

### Anti-bypass rules

- **1 application per user account, ever.** Rejected users cannot re-apply from the same account (no 7-day cooldown, no re-submit RPC). Old `reapply_artist_application` RPC dropped.
- Unique phone hash (already enforced) — kept.
- Platform URL normalized + unique across `pending`/`approved` applications.
- Bio-code single-use, expires 60 min after mint, one active code per user.

### Database migration

```text
artist_applications:
  DROP  id_doc_type, id_doc_front_path, id_doc_back_path, id_image_hash
  ADD   platform_url          text
  ADD   platform_verify_code  text
  ADD   platform_verify_status text  -- 'pending' | 'passed' | 'failed'
  ADD   platform_verify_checked_at timestamptz
  ADD   platform_photo_url    text   -- headshot scraped from platform page
  ADD   face_match_platform_score numeric
  ADD   face_match_platform_status text
  ADD   social_verified_url   text
  ADD   social_verified_status text  -- 'pending' | 'passed' | 'failed'
  UNIQUE(platform_url) WHERE status IN ('pending','approved')

RPCs:
  DROP  reapply_artist_application  (no re-apply per account)
  ALTER submit_artist_application   (block ALL prior applications, not just non-rejected;
                                     accept platform_url; mint verify code)
  NEW   check_artist_platform_ownership(app_id)  -- edge-function trigger
  NEW   check_artist_social_badge(app_id)

Triggers:
  ALTER purge_artist_kyc_files_on_review  -- purge only selfie + artist_photo now
```

RLS unchanged: applicants read/write only their own row; admins read all via `has_role`. Grants already correct.

### Edge functions

- **`artist-verify-checks`** rewritten: three isolated async checks (platform-code, face-match-vs-platform-photo, social-badge). Each writes back to its own status column so partial results show up live.
- **`purge-artist-kyc`** simplified: purge selfie + artist_photo on decision (no more ID paths).
- Face-match uses Lovable AI Gateway (`google/gemini-embedding-2` multimodal — image embeddings, cosine sim ≥ 0.72 = pass).

### Files touched

```text
supabase/migrations/<new>.sql              schema + RPC changes
supabase/functions/artist-verify-checks/   rewritten
supabase/functions/purge-artist-kyc/       shrunk
src/pages/artist/Apply.tsx                 3-step rebuild (no ID doc UI)
src/pages/artist/Status.tsx                live-only, no re-apply button
src/pages/admin/ArtistApplications.tsx     new columns, ID doc previews removed
src/lib/artist.ts                          types + helper updates
src/lib/musicPlatformValidator.ts          URL normalizer + code-scrape helper
src/components/FaceLivenessCapture.tsx     unchanged (already good)
```

### Rollback

Migration is destructive on ID columns. If you want a safer path, say so and I'll keep the columns nullable + hidden instead of dropping them.

### What I need from you before I start

Just confirm and I'll ship the migration first, then wire the edge functions and UI in one pass. If the destructive drop of `id_doc_*` columns concerns you, tell me now and I'll switch to nullable-hidden mode.