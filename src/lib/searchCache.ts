/**
 * In-memory LRU cache for library search results.
 *
 * Why: every keystroke after debounce hits Postgres with 3 ILIKE OR-conditions.
 * Repeated queries (back-and-forth typing, identical re-searches) are very
 * common and waste Lovable Cloud compute. Caching by normalized query for 1h
 * removes those round-trips entirely.
 *
 * Scope: client-side only. Each user has their own cache. RLS is unaffected.
 */

const TTL_MS = 60 * 60 * 1000; // 1 hour
const MAX_ENTRIES = 100;       // bounded so memory stays small on mobile

interface Entry<T> {
  value: T;
  expiresAt: number;
}

// Bump when filter logic changes so old polluted entries get evicted automatically.
const CACHE_VERSION = 'v4-ytm-innertube';

const namespaceKey = (namespace: string) => `${CACHE_VERSION}:${namespace}`;

import { cachesEnabled } from '@/lib/ssrCache';

const stores = new Map<string, Map<string, Entry<unknown>>>();

const getStore = <T>(namespace: string): Map<string, Entry<T>> => {
  const ns = namespaceKey(namespace);
  let s = stores.get(ns);
  if (!s) {
    s = new Map();
    stores.set(ns, s);
  }
  return s as Map<string, Entry<T>>;
};

const normalize = (key: string) => key.trim().toLowerCase().replace(/\s+/g, ' ');

export const getCached = <T>(namespace: string, key: string): T | undefined => {
  if (!cachesEnabled()) return undefined;
  const store = getStore<T>(namespace);
  const k = normalize(key);
  const hit = store.get(k);
  if (!hit) return undefined;
  if (hit.expiresAt < Date.now()) {
    store.delete(k);
    return undefined;
  }
  // refresh LRU recency
  store.delete(k);
  store.set(k, hit);
  return hit.value;
};

export const setCached = <T>(namespace: string, key: string, value: T): void => {
  if (!cachesEnabled()) return;
  const store = getStore<T>(namespace);
  const k = normalize(key);
  store.set(k, { value, expiresAt: Date.now() + TTL_MS });
  // LRU eviction
  while (store.size > MAX_ENTRIES) {
    const oldestKey = store.keys().next().value;
    if (oldestKey === undefined) break;
    store.delete(oldestKey);
  }
};

export const clearCache = (namespace?: string): void => {
  if (namespace) stores.get(namespaceKey(namespace))?.clear();
  else stores.clear();
};
