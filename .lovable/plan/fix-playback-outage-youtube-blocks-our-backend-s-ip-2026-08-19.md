# Fix playback outage: YouTube blocks our backend's IP

## What I verified (with live tests, not guesses)

- The finding's code is real and current: `supabase/functions/music-indexer/index.ts` races a small
  list of YouTube "clients" and logs `LOGIN_REQUIRED` when all of them are refused.
- I probed the exact failing tracks from this sandbox: the **iOS client returns OK with playable
  audio** for every one of them, while iOS Music / iOS Unplugged / Android Music / Android VR /
  TV / Web / Mobile-Web all return `LOGIN_REQUIRED` or `UNPLAYABLE`. So the client list was mostly
  dead weight.
- I applied two safe cleanups and deployed them:
  - dropped the clients that never work, kept the iOS family;
  - the "visitor token" the function scraped from YouTube was grabbed with a loose pattern that can
    capture the wrong value, and a wrong token makes **every** client fail at once — it is now
    validated, and every request is tried both with and without it.
- Then I re-tested the failing tracks **through the deployed backend**: still `LOGIN_REQUIRED`,
  even for the iOS client with no token.

**Conclusion:** the request that succeeds from one datacenter is refused from ours. YouTube is
blocking the backend's outbound IP range itself. No change to the client list, headers, or token
logic can fix that — the remaining work is about *where the request comes from* and *what we play
instead*. The public mirror fleet (Invidious/Piped/Cobalt) is simultaneously degraded (502/403),
which is why there is no safety net right now.

## Proposed work, in order of impact

### 1. Make JioSaavn the real first choice for playback (biggest win, lowest risk)
There is already a working JioSaavn resolver in the function, but the playback path that the app
actually calls (`resolve-video`, which only knows a video id) skips it entirely and goes straight
to YouTube. Change that path to look up the track's title/artist first (from our own database or a
lightweight metadata call) and try JioSaavn before YouTube. For the Indian catalogue this removes
the dependency on YouTube completely, and JioSaavn does not block us.

### 2. Route YouTube requests through an egress we control
Add an optional outbound proxy for the YouTube calls (a residential/consumer-IP HTTP proxy set as a
secret). When the secret is present, the resolver goes through it; when it is absent, behaviour is
unchanged. This is the only reliable way to keep YouTube as a source. It needs a proxy provider —
that is a decision and a cost, so I want your go-ahead rather than assuming it.

### 3. Honest failure instead of a dead tap
Today a failed resolve returns a placeholder that the player cannot play, so a tap looks like a
silent bug. Return an explicit "temporarily unavailable" result and show a retry message in the
player.

### 4. Stop wasting the mirror fleet's 4 seconds
While the public mirrors are broken they add ~4s to every failure. Add a short circuit-breaker so a
run of failures parks the whole fleet for a few minutes instead of retrying it on every tap.

## Notes

Android is less affected because the app resolves on-device there (a phone's IP is not blocked) —
this outage is the web/backend path. Items 1, 3 and 4 are self-contained and I can do them
immediately. Item 2 needs your decision on a proxy.
