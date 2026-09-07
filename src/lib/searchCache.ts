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

/**
 * On-device (localStorage) mirror of the memory cache.
 *
 * The memory cache dies with the process, which on the APK means every cold
 * start re-queries the network for searches the user just ran. Mirroring a
 * trimmed copy to disk makes repeat searches paint instantly offline/online.
 */
const DISK_PREFIX = `ufsearch:${CACHE_VERSION}:`;
const DISK_MAX_ITEMS = 60;   // rows kept per query — enough for the first screens
const DISK_MAX_QUERIES = 40; // bounded so storage stays small on mobile

const diskKey = (namespace: string, key: string) => `${DISK_PREFIX}${namespace}:${key}`;

const readDisk = <T>(namespace: string, key: string): T | undefined => {
  try {
    const raw = localStorage.getItem(diskKey(namespace, key));
    if (!raw) return undefined;
    const parsed = JSON.parse(raw) as { v: T; e: number };
    if (!parsed || parsed.e < Date.now()) {
      localStorage.removeItem(diskKey(namespace, key));
      return undefined;
    }
    return parsed.v;
  } catch {
    return undefined;
  }
};

const writeDisk = <T>(namespace: string, key: string, value: T): void => {
  try {
    const trimmed = (Array.isArray(value) ? value.slice(0, DISK_MAX_ITEMS) : value) as T;
    localStorage.setItem(diskKey(namespace, key), JSON.stringify({ v: trimmed, e: Date.now() + TTL_MS }));
    // Drop older-format entries and keep the query count bounded.
    const keys: string[] = [];
    for (let i = 0; i < localStorage.length; i += 1) {
      const k = localStorage.key(i);
      if (!k) continue;
      if (k.startsWith('ufsearch:') && !k.startsWith(DISK_PREFIX)) { localStorage.removeItem(k); continue; }
      if (k.startsWith(DISK_PREFIX)) keys.push(k);
    }
    if (keys.length > DISK_MAX_QUERIES) {
      keys.slice(0, keys.length - DISK_MAX_QUERIES).forEach((k) => localStorage.removeItem(k));
    }
  } catch {
    /* quota or private mode — memory cache still works */
  }
};

export const getCached = <T>(namespace: string, key: string): T | undefined => {
  if (!cachesEnabled()) return undefined;
  const store = getStore<T>(namespace);
  const k = normalize(key);
  const hit = store.get(k);
  if (!hit) {
    const disk = readDisk<T>(namespace, k);
    if (disk !== undefined) {
      store.set(k, { value: disk, expiresAt: Date.now() + TTL_MS });
      return disk;
    }
    return undefined;
  }
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
  writeDisk(namespace, k, value);
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
  try {
    for (let i = localStorage.length - 1; i >= 0; i -= 1) {
      const k = localStorage.key(i);
      if (!k?.startsWith(DISK_PREFIX)) continue;
      if (!namespace || k.startsWith(`${DISK_PREFIX}${namespace}:`)) localStorage.removeItem(k);
    }
  } catch { /* ignore */ }
};

