# Fix systemic playback failures ("all audio sources failed")

## What I verified

The finding is real and the code it points at still exists.

- `supabase/functions/music-indexer/index.ts` logs `[resolve] all sources failed …` when every stream source loses the race.
- Candidate search *does* succeed (the logs show real videoIds), so the outage is at the **stream resolution** step, not search. The `YouTube API key failed: HTTP 403` line is a secondary symptom in the search fallback chain.
- Stream resolution races only three families of sources, all of them free third-party services:
  - public **Invidious** instances (`/api/v1/videos/:id`)
  - public **Piped** instances (`/streams/:id`)
  - public **Cobalt** instances (`/api/json`)
- A comment in the same file documents that direct YouTube InnerTube extraction from the edge runtime is blocked (bot check / `FAILED_PRECONDITION`) because the function runs on datacenter IPs, which is exactly why the app depends on those third-party pools.

So: the web/edge playback path currently has **no source it controls**. When the public Invidious/Piped/Cobalt fleet degrades (which is what 403 / 502 / "invalid json body" in the evidence means), playback dies for every track. Android is unaffected on the native path, which resolves on-device.

This is not a one-line bug; it needs both an operational refresh and a resiliency change, so I have not edited anything yet.

## Proposed work

### 1. Operational (no code) — you need to do this part
- Replace or raise quota on the `YOUTUBE_API_KEY` secret(s). The 403s mean the configured keys are quota-exhausted or restricted. Add them in Project Settings → Secrets.

### 2. Refresh and harden the instance pools
- Re-fetch the Invidious/Piped instance lists from their public registries and drop the hardcoded seeds that are now dead, keeping only instances that currently answer.
- Widen the race from 8 to the full healthy pool, and shorten the per-instance timeout so a slow instance cannot eat the whole 4s budget.
- Make the `failedUntil` cache decay faster so a briefly rate-limited instance is not locked out of the next several requests.

### 3. Add a source the app actually controls
- Add a JioSaavn-first attempt in `resolveStream` before the YouTube-derived race, reusing the existing `src/lib/jiosaavn.ts` matching logic on the server. For Indian-catalogue tracks this removes the third-party dependency entirely and is the single biggest reliability win.
- Keep the existing race as the fallback for everything JioSaavn cannot match.

### 4. Honest failure state
- When resolution fails, return a distinct "temporarily unavailable, try again" result instead of the generic error, and surface it in the player so users see a retry affordance rather than a silent dead tap.

## Notes

Steps 2–4 touch one edge function plus a small player-side message change; step 1 is yours. I would do them in that order and deploy after each so we can watch the logs recover.
