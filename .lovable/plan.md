# Spotify-for-Artists Style Access System

Rebuild artist onboarding to match how Spotify accepts artists — not a raw signup form, but a **claim-based access system** with roles, invites, and team management.

## What Spotify actually does (verified)

1. **Claim your profile** — Artists don't "sign up as artist". They claim an existing artist profile that's already on Spotify (indexed from their released music). If no profile exists, they upload via a distributor first.
2. **Verify identity** — Prove ownership via social/streaming link or distributor.
3. **Invite team** — Once approved, the artist can invite Managers, Admins, Editors, Viewers, Analysts to their dashboard with role-based permissions.
4. **Label access** — Labels/distributors get org-level access spanning multiple artists.
5. **Access requests** — Pending/approved/revoked flows for every team seat.

## What we'll build (Univers Flow versions)

### 1. `/artist` — Access Hub (rebuild)
Three big cards, Spotify-style:
- **Claim your artist profile** → `/artist/claim` (already exists — polish)
- **I'm on a team** → `/artist/team/join` (accept invite via code/link)
- **I'm a label / distributor** → `/artist/label/access` (multi-artist org access)

Kills the current "signup as artist" framing.

### 2. `/artist/team` — Team Management (new)
Owner/Admin view of their artist profile team:
- List members with role + status (active/pending/revoked)
- Invite by email → generates one-time invite code + link
- Change role, revoke access
- Roles: **Owner**, **Admin**, **Editor**, **Analyst**, **Viewer**

Permissions matrix:
```text
                Owner  Admin  Editor  Analyst  Viewer
Upload/edit songs  ✓     ✓      ✓       ·        ·
Edit profile       ✓     ✓      ✓       ·        ·
Request payouts    ✓     ✓      ·       ·        ·
View analytics     ✓     ✓      ✓       ✓        ✓
Invite team        ✓     ✓      ·       ·        ·
Transfer ownership ✓     ·      ·       ·        ·
```

### 3. `/artist/team/join?code=XXX` — Accept Invite (new)
- Signed-out users are routed through auth first, code preserved
- Shows artist name, inviter, role being granted
- Accept → membership becomes active
- Decline → invite marked declined

### 4. `/artist/label/access` — Label Access (new)
- Request label-level access covering multiple artist profiles
- Fields: label name, roster (artist stage names), proof (distributor dashboard URL, label website)
- Goes into admin review queue

### 5. `/admin/artist-access` — Admin queue (new)
- Unified review of claims + label access requests
- Approve/reject with note

## Database (new tables)

```text
artist_team_members
  id, artist_profile_id, user_id, role, status, invited_by,
  invited_at, joined_at, revoked_at

artist_team_invites
  id, artist_profile_id, email, role, code (unique),
  invited_by, expires_at, status (pending|accepted|declined|expired|revoked)

label_access_requests
  id, user_id, label_name, roster jsonb, proof_url,
  status, admin_note, reviewed_by, reviewed_at
```

RLS + GRANTs following the standard pattern. Owner auto-created when a claim is approved. `has_artist_access(user_id, artist_profile_id, min_role)` security-definer function drives all permission checks.

## Migration of existing behavior

- Current "artist owner = `artist_profiles.user_id`" stays as the Owner row in `artist_team_members` (auto-backfilled).
- All existing artist RPCs (`request_artist_payout`, upload, edit) gated through `has_artist_access(..., 'editor'|'admin')`.
- The old `/artist/apply` flow stays as an option under Claim, for artists who don't have a profile indexed yet.

## Files touched

New:
- `src/pages/artist/AccessHub.tsx` (replaces current onboarding hub)
- `src/pages/artist/TeamManagement.tsx`
- `src/pages/artist/JoinTeam.tsx`
- `src/pages/artist/LabelAccess.tsx`
- `src/pages/admin/ArtistAccessQueue.tsx`
- Migration for 3 tables + `has_artist_access` fn + owner backfill

Edited:
- `src/App.tsx` routes
- `src/pages/artist/ArtistLayout.tsx` — Team nav item for Owner/Admin
- `src/pages/artist/Onboarding.tsx` → redirects to new AccessHub

## Out of scope (this pass)

- Email delivery for invites (link + code shown in UI; email pipe can plug in later via existing `send-system-push`)
- 2FA on ownership transfer
- Bulk CSV roster import for labels

## Confirmation

This is a large, multi-file rebuild of the artist access model. Approve and I'll ship it in one pass — migration, pages, routes, permission gating.
