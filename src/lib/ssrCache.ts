/**
 * SSR cache isolation.
 *
 * Module-scope caches live for the whole lifetime of the *server* process, so a
 * cache written while rendering user A's request can be read while rendering
 * user B's request — leaking likes, follows, taste profiles and access
 * decisions across users. On the client the same module lives in one browser
 * tab for exactly one user, so caching there is safe and desirable.
 *
 * Rule: every module-scope cache must go through `cachesEnabled()`. When it
 * returns false (server render), reads miss and writes are dropped, which makes
 * every SSR request compute from scratch — per-request isolation by
 * construction, with zero client-side cost.
 */

/** True only in a browser runtime, where a module instance == one user. */
export function cachesEnabled(): boolean {
  return typeof window !== 'undefined';
}

/** Inverse of `cachesEnabled`, for readability at call sites. */
export function isServerRender(): boolean {
  return typeof window === 'undefined';
}
