# Restore real YouTube playback (server side)

## What I verified

The LOGIN_REQUIRED outage is real, but the suspected cause (stale client version / bad visitor token) is wrong. I sent the exact same InnerTube payload the edge function uses, for the exact video IDs in the alert, from a different network:

```text
cUJR4CiGdfY  IOS  OK   5 audio formats, plain URLs
kK0Vd3daL_o  IOS  OK   5 audio formats, plain URLs
dQw4w9WgXcQ  IOS  OK   5 audio formats, plain URLs
ANDROID_VR / WEB_EMBEDDED / TVHTML5_EMBEDDED -> LOGIN_REQUIRED / ERROR
```

So the payload is fine. The requests fail only when they leave the backend's own datacenter address, which Google is refusing. Swapping client versions, adding more clients, or re-bootstrapping the visitor token cannot fix that — this matches the earlier production telemetry (YouTube resolves ~0 successes from the server, JioSaavn ~1,700 at ~810ms). The separate "YouTube API key 403 x17" line is a quota/restriction problem on the key itself, also not a code bug.

## Options to actually fix it

**Option A — Residential egress for resolution (real fix, needs a paid service)**
- Add a rotating residential/mobile proxy for InnerTube player calls and for the stream-proxy fetch.
- Store the proxy endpoint + credentials as a backend secret.
- Route only `youtubei/v1/player` and `googlevideo` requests through it; everything else stays direct.
- Keep the existing JioSaavn race as the fast path, so nothing gets slower.

**Option B — Stop paying the cost of a path that cannot work (free, ships today)**
- Skip server-side InnerTube entirely on web and go straight to JioSaavn + cache, so users stop waiting 15–31s for a call that always fails.
- Keep on-device InnerTube on Android (residential IP, already working) as the real YouTube path.
- Downgrade the ALL_SOURCES_FAILED alert noise to reflect the expected server behaviour.

**Option C — YouTube Data API key**
- Issue a fresh key with no HTTP-referrer restriction and raise/verify quota, then replace the secret. Purely a credential change; I cannot do it without the new key.

## Recommendation

Ship Option B now (removes the visible 15–30s stalls and the failure alerts), and add Option A when you're ready to pay for residential egress. Option C is worth doing regardless, since it only needs a new key.

## Technical notes

- Resolver clients and visitor bootstrap: `supabase/functions/music-indexer/index.ts` (~1407-1485).
- Stream signing is bound to the requester IP, so the proxy in Option A must fetch the media too, not just the player JSON.
- No client-side changes needed for B; the web resolver already falls back to JioSaavn.
