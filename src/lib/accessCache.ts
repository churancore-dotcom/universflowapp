/**
 * Access-decision cache.
 *
 * Role checks (`has_role`) and artist-destination resolution used to re-run on
 * EVERY navigation into a guarded route, because each guard component remounts
 * and fires its effect again. Each remount showed a blank fallback screen while
 * one-to-three round trips completed — the main reason pages felt slow to open.
 *
 * Decisions are cached per user id with a short TTL and an in-flight promise so
 * concurrent guards share a single request. `peek()` lets a guard render
 * instantly when the answer is already known.
 */

const TTL_MS = 5 * 60 * 1000;

type Entry<T> = { value?: T; resolvedAt: number; inflight?: Promise<T> };

const store = new Map<string, Entry<unknown>>();

function keyFor(userId: string, kind: string) {
  return `${userId}::${kind}`;
}

/** Synchronously read a fresh cached decision, or undefined when unknown. */
export function peekAccess<T>(userId: string | undefined | null, kind: string): T | undefined {
  if (!userId) return undefined;
  const entry = store.get(keyFor(userId, kind)) as Entry<T> | undefined;
  if (!entry || entry.value === undefined) return undefined;
  if (Date.now() - entry.resolvedAt > TTL_MS) return undefined;
  return entry.value;
}

/** Resolve a decision, reusing a fresh cached value or an in-flight request. */
export function getAccess<T>(
  userId: string,
  kind: string,
  loader: () => Promise<T>,
): Promise<T> {
  const key = keyFor(userId, kind);
  const entry = store.get(key) as Entry<T> | undefined;
  if (entry) {
    if (entry.inflight) return entry.inflight;
    if (entry.value !== undefined && Date.now() - entry.resolvedAt <= TTL_MS) {
      return Promise.resolve(entry.value);
    }
  }

  const inflight = loader()
    .then((value) => {
      store.set(key, { value, resolvedAt: Date.now() });
      return value;
    })
    .catch((err) => {
      store.delete(key);
      throw err;
    });

  store.set(key, { resolvedAt: 0, inflight });
  return inflight;
}

/** Drop cached decisions — call on sign-in/sign-out or role changes. */
export function clearAccessCache(userId?: string) {
  if (!userId) {
    store.clear();
    return;
  }
  for (const key of [...store.keys()]) {
    if (key.startsWith(`${userId}::`)) store.delete(key);
  }
}
