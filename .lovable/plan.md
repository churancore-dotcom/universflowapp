## Problem (confirmed from logs)

`supabase/functions/music-indexer/index.ts` resolves YouTube audio through a **hardcoded** list of public Invidious/Piped instances (lines ~212–234). Those instances are largely dead or CAPTCHA-walled:

- Primary `https://inv.thepixora.com` returns an HTML error page → JSON parse crash.
- Fallbacks return 401/403/404/500/502; `invidious.jing.rocks` fails DNS.
- Cobalt last-ditch has no successful path either.

Users on the **web** (and any Android path that falls back to the edge function) see `"Could not find a playable stream for this track"`.

Note: Android already prefers the native InnerTube plugin per project memory, so this primarily affects web + native-fallback edge cases.

## Fix strategy

### 1. Kill the hardcoded lists as the source of truth
- Fetch `https://api.invidious.io/instances.json?sort_by=api,health` on cold start (already partially wired at line 260) and cache in-memory for ~15 min.
- Fetch Piped instances from `https://piped-instances.kavin.rocks/` (or the maintained `github.com/TeamPiped/piped-instances` JSON).
- Filter to instances that report `api: true`, `cors: true`, healthy uptime ≥ 90%, and whose host matches the existing exact-suffix allowlist (line ~98).
- Keep the current hardcoded arrays only as a *seed* if the fetch fails.

### 2. Add real health-gating before use
- On each resolve, run a 1.5s HEAD/GET probe (e.g. `/api/v1/stats` for Invidious, `/healthcheck` for Piped) against the top N instances in parallel.
- Only instances that return 200 JSON are used for the actual video lookup.
- Cache health results for 60s to avoid probe storms.

### 3. Harden `fetchJson`
- Detect `content-type` not containing `application/json` OR body starting with `<` → treat as failure and `markFailed(host)` instead of throwing an unhandled `Unexpected token '<'`.

### 4. Add a maintained-source fast path
- Try **JioSaavn resolver** (already in `src/lib/jiosaavn.ts` conceptually) first for any track that has a matched Saavn ID — it's stable and free.
- Only fall back to Invidious/Piped when Saavn has no match.

### 5. Improve Cobalt fallback
- Cobalt public instance rotates; hit `https://co.wuk.sh/api/serverInfo` and the community list at `instances.cobalt.tools` before calling `/api/json`.

### 6. Observability
- Log a single structured line per resolve: `{videoId, sourcesTried, winner, ms}` so future dead-instance waves are visible in one query.

## Files to touch

```text
supabase/functions/music-indexer/index.ts
  ├─ fetchJson()               → content-type guard
  ├─ getInvidiousInstances()   → dynamic + cached
  ├─ getPipedInstances()       → dynamic + cached
  ├─ new probeHealth()         → parallel health probe
  ├─ resolveVideoId()          → Saavn fast-path, then health-gated pools
  └─ resolveViaCobalt()        → dynamic Cobalt instance selection
```

No DB migration, no client changes, no new secrets.

## Rollout

1. Ship the edge-function change (auto-deploys on approval).
2. Monitor `edge_function_logs` for `[resolve] ✓` vs `[resolve] all fallbacks failed` ratio over 1h.
3. If ratio stays >90% success, mark finding fixed; otherwise iterate on the health-probe thresholds.

Approve this and I'll implement it in one edge-function edit.