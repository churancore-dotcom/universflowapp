/**
 * Keyed request locking + deterministic retry.
 *
 * Two race conditions this removes:
 *
 *  1. **Duplicate work / wrong track.** Two taps on the same song (or a
 *     prewarm racing the real tap) used to start two independent resolver
 *     chains. Whichever finished last won, so the audio element could end up
 *     with the *other* attempt's URL. `withRequestLock` collapses concurrent
 *     calls for the same key onto one promise, so there is exactly one winner.
 *
 *  2. **Repeated failures / thundering herd.** Retries with random jitter make
 *     failures non-reproducible and can stack up. `retryDeterministic` uses a
 *     fixed exponential schedule (no jitter), a hard attempt cap, and a
 *     short-lived failure memo so a known-bad key fails fast instead of
 *     hammering the network on every tap.
 */

const inflight = new Map<string, Promise<unknown>>();
const failedAt = new Map<string, number>();

/** How long a key stays "known failed" before we allow a fresh attempt. */
const FAILURE_COOLDOWN_MS = 10_000;

/** Collapse concurrent calls for the same key onto a single in-flight promise. */
export function withRequestLock<T>(key: string, run: () => Promise<T>): Promise<T> {
  const existing = inflight.get(key) as Promise<T> | undefined;
  if (existing) return existing;
  const p = (async () => run())().finally(() => {
    inflight.delete(key);
  });
  inflight.set(key, p);
  return p;
}

export function isRequestInFlight(key: string): boolean {
  return inflight.has(key);
}

/** True while a key is inside its post-failure cooldown window. */
export function isInFailureCooldown(key: string): boolean {
  const at = failedAt.get(key);
  if (!at) return false;
  if (Date.now() - at > FAILURE_COOLDOWN_MS) {
    failedAt.delete(key);
    return false;
  }
  return true;
}

export function markRequestFailed(key: string): void {
  failedAt.set(key, Date.now());
}

export function clearRequestFailure(key: string): void {
  failedAt.delete(key);
}

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

/**
 * Deterministic exponential backoff: attempt N waits `baseMs * 2^(N-1)`,
 * capped at `maxDelayMs`. No jitter — identical inputs produce an identical
 * timing schedule, which is what makes playback failures reproducible.
 */
export async function retryDeterministic<T>(
  run: (attempt: number) => Promise<T>,
  opts: { attempts?: number; baseMs?: number; maxDelayMs?: number; shouldRetry?: (e: unknown) => boolean } = {},
): Promise<T> {
  const attempts = Math.max(1, opts.attempts ?? 2);
  const baseMs = opts.baseMs ?? 400;
  const maxDelayMs = opts.maxDelayMs ?? 2_000;
  let lastError: unknown;
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    try {
      return await run(attempt);
    } catch (err) {
      lastError = err;
      if (attempt === attempts || (opts.shouldRetry && !opts.shouldRetry(err))) break;
      await sleep(Math.min(maxDelayMs, baseMs * 2 ** (attempt - 1)));
    }
  }
  throw lastError instanceof Error ? lastError : new Error(String(lastError));
}
