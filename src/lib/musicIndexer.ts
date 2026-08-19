import { supabase } from '@/integrations/supabase/client';
import { findSongStreamUrl } from '@/lib/jiosaavn';
import { getCachedStream as getYtmCached, setCachedStream as setYtmCached, invalidateStream as invalidateYtmCached, invalidateStreamUrl as invalidateYtmCachedByUrl } from '@/lib/ytmStreamCache';
import { withRequestLock, isInFailureCooldown, markRequestFailed, clearRequestFailure } from '@/lib/requestLock';
import { recordPerfEvent } from '@/lib/perfMonitor';

/**
 * Resolver health telemetry. Every stream-resolution racer reports its own
 * outcome + latency so the admin Performance panel can show which source is
 * actually carrying playback and which one is failing, instead of guessing.
 */
function trackResolver<T extends { success?: boolean; streamUrl?: string } | null>(
  source: string,
  trackId: string,
  promise: Promise<T>,
): Promise<T> {
  const started = Date.now();
  return promise.then(
    (result) => {
      const ok = !!result?.streamUrl;
      noteSourceResult(source, ok);
      recordPerfEvent({
        event_type: ok ? 'resolve_hit' : 'resolve_miss',
        severity: 'info',
        source,
        track_id: trackId,
        latency_ms: Date.now() - started,
      });
      return result;
    },
    (err) => {
      noteSourceResult(source, false);
      recordPerfEvent({
        event_type: 'resolve_error',
        severity: 'warn',
        source,
        track_id: trackId,
        latency_ms: Date.now() - started,
        message: String((err as Error)?.message || err).slice(0, 180),
      });
      throw err;
    },
  );
}

/**
 * CIRCUIT BREAKER — when a resolver source is hard-down (e.g. the YouTube
 * extractor being IP-blocked from the datacenter) every play attempt otherwise
 * keeps a slow racer alive for its full timeout and burns the invoke gate.
 * After 3 consecutive failures we skip that source for 3 minutes so the fast
 * sources (JioSaavn / caches) decide playback immediately.
 */
const breaker = new Map<string, { fails: number; openUntil: number }>();
const BREAKER_TRIP = 3;
const BREAKER_OPEN_MS = 3 * 60 * 1000;

function isSourceDown(source: string): boolean {
  const state = breaker.get(source);
  return !!state && state.openUntil > Date.now();
}

function noteSourceResult(source: string, ok: boolean) {
  if (ok) {
    breaker.delete(source);
    return;
  }
  const state = breaker.get(source) || { fails: 0, openUntil: 0 };
  state.fails += 1;
  if (state.fails >= BREAKER_TRIP) {
    state.openUntil = Date.now() + BREAKER_OPEN_MS;
    state.fails = 0;
  }
  breaker.set(source, state);
}


export interface IndexedTrack {
  id: string;
  title: string;
  artist: string;
  audio_url?: string;
  album?: string;
  cover_url?: string;
  duration?: number;
  listeners?: number;
  rank?: number;
  videoId?: string;
  /** 'song' = official audio (YT Music Songs shelf), 'video' = generic music video. */
  kind?: 'song' | 'video';
}


interface IndexedTracksResponse {
  success: boolean;
  results?: IndexedTrack[];
  error?: string;
}

interface ResolveTrackResponse {
  success: boolean;
  streamUrl?: string;
  videoId?: string;
  duration?: number;
  title?: string;
  artist?: string;
  cover_url?: string;
  error?: string;
  fallback?: boolean;
}

interface YoutubeSearchResponse {
  success: boolean;
  results?: IndexedTrack[];
  error?: string;
}

interface YoutubeNewReleasesResponse {
  success: boolean;
  results?: IndexedTrack[];
  error?: string;
}

// ── Persistent stream cache (localStorage + memory) ──
// Memory cache for instant hits, localStorage for survival across reloads.
// TTL is 55min because most CDN signed URLs from the resolver are valid ~1h.
const streamCache = new Map<string, { url: string; expiresAt: number; meta?: Partial<ResolveTrackResponse> }>();
const inFlightResolutions = new Map<string, Promise<ResolveTrackResponse>>();
const STREAM_CACHE_TTL = 55 * 60 * 1000; // 55 min
const VOLATILE_STREAM_CACHE_TTL = 20 * 60 * 1000; // public mirror URLs go stale much faster
const LS_KEY = 'uf_stream_cache_v3';
const LS_MAX_ENTRIES = 200;
const SEARCH_CACHE_TTL = 20 * 60 * 1000;
const SEARCH_LS_KEY = 'uf_indexed_search_cache_v8_ytm_only_clean';
const searchCache = new Map<string, { data: IndexedTrack[]; expiresAt: number }>();

function makeCacheKey(artist: string, title: string) {
  return `${artist.toLowerCase().trim()}::${title.toLowerCase().trim()}`;
}

// Hydrate from localStorage on module load (one-time)
(function hydrateFromLocalStorage() {
  try {
    const raw = localStorage.getItem(LS_KEY);
    if (!raw) return;
    const parsed = JSON.parse(raw) as Record<string, { url: string; expiresAt: number; meta?: unknown }>;
    const now = Date.now();
    for (const [key, val] of Object.entries(parsed)) {
      if (val?.expiresAt > now && val?.url) streamCache.set(key, val as any);
    }
  } catch { /* ignore corrupted cache */ }
})();

(function hydrateSearchCache() {
  try {
    const raw = localStorage.getItem(SEARCH_LS_KEY);
    if (!raw) return;
    const parsed = JSON.parse(raw) as Record<string, { data: IndexedTrack[]; expiresAt: number }>;
    const now = Date.now();
    Object.entries(parsed).forEach(([key, val]) => {
      if (val?.expiresAt > now && Array.isArray(val.data)) searchCache.set(key, val);
    });
  } catch { /* ignore corrupted cache */ }
})();

let persistTimer: ReturnType<typeof setTimeout> | null = null;
function persistCache() {
  if (persistTimer) return;
  persistTimer = setTimeout(() => {
    persistTimer = null;
    try {
      // Trim to most recent N entries by expiresAt to stay under quota
      const entries = Array.from(streamCache.entries())
        .filter(([, v]) => v.expiresAt > Date.now())
        .sort((a, b) => b[1].expiresAt - a[1].expiresAt)
        .slice(0, LS_MAX_ENTRIES);
      localStorage.setItem(LS_KEY, JSON.stringify(Object.fromEntries(entries)));
    } catch { /* quota errors etc — ignore */ }
  }, 1500);
}

function persistSearchCache() {
  try {
    const entries = Array.from(searchCache.entries())
      .filter(([, v]) => v.expiresAt > Date.now())
      .sort((a, b) => b[1].expiresAt - a[1].expiresAt)
      .slice(0, 80);
    localStorage.setItem(SEARCH_LS_KEY, JSON.stringify(Object.fromEntries(entries)));
  } catch { /* ignore quota */ }
}

function searchKey(source: string, query: string, limit: number) {
  return `${source}:${limit}:${query.trim().toLowerCase().replace(/\s+/g, ' ')}`;
}

async function cachedSearch(key: string, fetcher: () => Promise<IndexedTrack[]>): Promise<IndexedTrack[]> {
  const hit = searchCache.get(key);
  if (hit && hit.expiresAt > Date.now()) return hit.data;
  const data = await fetcher();
  searchCache.set(key, { data, expiresAt: Date.now() + SEARCH_CACHE_TTL });
  persistSearchCache();
  return data;
}

function getCachedStream(key: string): { url: string; meta?: Partial<ResolveTrackResponse> } | null {
  const hit = streamCache.get(key);
  if (!hit || hit.expiresAt < Date.now()) { streamCache.delete(key); return null; }
  if (isKnownBrokenStreamUrl(hit.url)) { streamCache.delete(key); return null; }
  return { url: hit.url, meta: hit.meta };
}

function setCachedStream(key: string, url: string, meta?: Partial<ResolveTrackResponse>) {
  if (isKnownBrokenStreamUrl(url)) return;
  const ttl = isVolatileMirrorStream(url) ? VOLATILE_STREAM_CACHE_TTL : STREAM_CACHE_TTL;
  streamCache.set(key, { url, expiresAt: Date.now() + ttl, meta });
  persistCache();
}

function isKnownBrokenStreamUrl(url?: string | null) {
  // `yt-video:` is an iframe fallback marker, not an audio stream. Keeping it
  // in the stream cache makes the player bypass real extraction on future plays,
  // so Premium WebAudio EQ/effects stay stuck forever.
  if (!url) return false;
  if (url.startsWith('yt-video:')) return true;
  return false;
}

function isVolatileMirrorStream(url?: string | null) {
  if (!url) return false;
  return url.includes('/latest_version')
    || url.includes('/videoplayback')
    || url.includes('proxy.piped.')
    || url.includes('googlevideo.com');
}

function withTimeout<T>(promise: Promise<T>, timeoutMs: number, fallback: T): Promise<T> {
  return new Promise((resolve) => {
    let settled = false;
    const timer = window.setTimeout(() => {
      if (settled) return;
      settled = true;
      resolve(fallback);
    }, timeoutMs);
    promise
      .then((value) => {
        if (settled) return;
        settled = true;
        window.clearTimeout(timer);
        resolve(value);
      })
      .catch(() => {
        if (settled) return;
        settled = true;
        window.clearTimeout(timer);
        resolve(fallback);
      });
  });
}

function isSafeSharedCachedStream(url?: string | null) {
  if (!url) return false;
  // `yt-video:` is only an iframe fallback marker, not an audio stream. If we
  // return it from the shared DB cache, the player bypasses the HTMLAudio path
  // and the WebAudio equalizer can NEVER attach. Always keep resolving until we
  // get a real http(s)/blob stream; use `yt-video:` only as the final fallback.
  if (url.startsWith('yt-video:')) return false;
  // Public proxy URLs can expire or start returning bot-check HTML within minutes.
  // The edge resolver must re-probe those live instead of trusting shared DB cache.
  if (isVolatileMirrorStream(url)) return false;
  return true;
}

// Try to grab a cached audio_url directly from the DB (stream_songs table) before
// hitting the edge function. This is shared across ALL users — instant warm cache.
//
// Batches concurrent lookups within a 20ms window into a single `.in()` query so
// prefetching a queue of N tracks costs 1 round-trip instead of N (fixes the
// Sentry N+1 on `stream_songs`).
type DbCacheRow = {
  audio_url: string | null;
  title: string | null;
  artist: string | null;
  cover_url: string | null;
  duration: number | null;
  last_seen_at: string;
};
type PendingLookup = {
  artist: string;
  title: string;
  resolve: (r: ResolveTrackResponse | null) => void;
};
let dbLookupQueue: PendingLookup[] = [];
let dbLookupTimer: ReturnType<typeof setTimeout> | null = null;

function rowToResponse(row: DbCacheRow, artist: string, title: string): ResolveTrackResponse | null {
  if (!row.audio_url) return null;
  if (!isSafeSharedCachedStream(row.audio_url)) return null;
  if (isKnownBrokenStreamUrl(row.audio_url)) return null;
  const ageMs = Date.now() - new Date(row.last_seen_at).getTime();
  if (ageMs > 4 * 60 * 60 * 1000) return null;
  return {
    success: true,
    streamUrl: row.audio_url,
    title: row.title || title,
    artist: row.artist || artist,
    cover_url: row.cover_url || undefined,
    duration: row.duration || undefined,
  };
}

async function flushDbLookupQueue() {
  const batch = dbLookupQueue;
  dbLookupQueue = [];
  dbLookupTimer = null;
  if (batch.length === 0) return;

  // Deduplicate identical (artist,title) pairs so N players prefetching the same
  // track produce one row-result reused across all waiters.
  const uniqueArtists = Array.from(new Set(batch.map((b) => b.artist)));
  const uniqueTitles = Array.from(new Set(batch.map((b) => b.title)));

  try {
    const { data } = await supabase
      .from('stream_songs')
      .select('audio_url, title, artist, cover_url, duration, last_seen_at')
      .in('artist', uniqueArtists)
      .in('title', uniqueTitles)
      .order('last_seen_at', { ascending: false });

    const rows = (data || []) as DbCacheRow[];
    // Newest-first index by (artist|title)
    const byKey = new Map<string, DbCacheRow>();
    for (const row of rows) {
      const key = `${(row.artist || '').toLowerCase()}|${(row.title || '').toLowerCase()}`;
      if (!byKey.has(key)) byKey.set(key, row);
    }

    for (const item of batch) {
      const key = `${item.artist.toLowerCase()}|${item.title.toLowerCase()}`;
      const row = byKey.get(key);
      item.resolve(row ? rowToResponse(row, item.artist, item.title) : null);
    }
  } catch {
    for (const item of batch) item.resolve(null);
  }
}

async function tryDbCachedStream(artist: string, title: string): Promise<ResolveTrackResponse | null> {
  return new Promise<ResolveTrackResponse | null>((resolve) => {
    dbLookupQueue.push({ artist, title, resolve });
    if (!dbLookupTimer) {
      dbLookupTimer = setTimeout(() => { void flushDbLookupQueue(); }, 20);
    }
    // Flush eagerly if the batch is getting large (queue prefetch of 30+ tracks).
    if (dbLookupQueue.length >= 25) {
      if (dbLookupTimer) { clearTimeout(dbLookupTimer); dbLookupTimer = null; }
      void flushDbLookupQueue();
    }
  });
}

// ── Edge concurrency gate ────────────────────────────────────────────────────
// Home renders 4+ rails, each pre-warming several tracks, and every warm fans
// out to 2 edge functions. Unthrottled that is 40+ simultaneous invokes: the
// browser/edge drops them ("Failed to fetch"), which is exactly what shows up
// in the monitor as a low playback-success rate and a high error rate.
// Foreground (a real tap) always jumps ahead of background pre-warms.
type Priority = 'high' | 'low';
const MAX_EDGE_CONCURRENCY = 4;
let activeEdgeCalls = 0;
const edgeWaiters: { priority: Priority; run: () => void }[] = [];

function pumpEdgeQueue() {
  while (activeEdgeCalls < MAX_EDGE_CONCURRENCY && edgeWaiters.length) {
    let idx = edgeWaiters.findIndex((w) => w.priority === 'high');
    if (idx === -1) idx = 0;
    const [next] = edgeWaiters.splice(idx, 1);
    activeEdgeCalls += 1;
    next.run();
  }
}

function acquireEdgeSlot(priority: Priority): Promise<void> {
  if (activeEdgeCalls < MAX_EDGE_CONCURRENCY) {
    activeEdgeCalls += 1;
    return Promise.resolve();
  }
  return new Promise<void>((resolve) => {
    edgeWaiters.push({ priority, run: resolve });
  });
}

function releaseEdgeSlot() {
  activeEdgeCalls = Math.max(0, activeEdgeCalls - 1);
  pumpEdgeQueue();
}

async function invokeGated<T>(
  functionName: string,
  body: Record<string, unknown>,
  priority: Priority,
): Promise<{ data: T | null; error: { message?: string } | null }> {
  await acquireEdgeSlot(priority);
  try {
    // One retry for pure transport failures ("Failed to fetch"): those are
    // connection-pool casualties, not real resolver misses.
    for (let attempt = 0; attempt < 2; attempt += 1) {
      const startedAt = Date.now();
      const { data, error } = await supabase.functions.invoke(functionName, { body });
      const transport = /failed to fetch|network|load failed/i.test(error?.message || '');
      // Feed the on-device diagnostics panel: every attempt, its outcome and
      // whether a retry rescued it.
      recordPerfEvent({
        event_type: error ? 'edge_call_error' : 'edge_call_ok',
        severity: error ? (transport && attempt === 0 ? 'info' : 'warn') : 'info',
        source: functionName,
        latency_ms: Date.now() - startedAt,
        message: error?.message ?? null,
        details: { attempt: attempt + 1, retried: attempt > 0, priority },
      });
      if (!error || !transport || attempt === 1) {
        return { data: (data ?? null) as T | null, error: error as { message?: string } | null };
      }
      await new Promise((r) => setTimeout(r, 250 + Math.random() * 250));
    }

    return { data: null, error: { message: 'Function request failed' } };
  } finally {
    releaseEdgeSlot();
  }
}

async function requestFunction<T>(
  functionName: string,
  body: Record<string, unknown>,
  requireSuccess = false,
  priority: Priority = 'high',
): Promise<T> {
  const { data, error } = await invokeGated<T & { success?: boolean; error?: string }>(functionName, body, priority);

  if (error) {
    throw new Error(error.message || 'Function request failed');
  }

  if (requireSuccess && !data?.success) {
    throw new Error(data?.error || 'Function request failed');
  }

  return data as T;
}

async function requestIndexer<T>(body: Record<string, unknown>, priority: Priority = 'high'): Promise<T> {
  return requestFunction<T>('music-indexer', body, true, priority);
}

// ── Public API ──

export async function searchIndexedTracks(query: string, limit = 50): Promise<IndexedTrack[]> {
  const q = query.trim();
  if (q.length < 2) return [];
  return cachedSearch(searchKey('indexer', q, limit), async () => {
    const data = await requestIndexer<IndexedTracksResponse>({
      action: 'search',
      query: q,
      limit,
    });
    return Array.isArray(data.results) ? data.results : [];
  });
}

export async function searchYouTubeMusicTracks(query: string, limit = 50): Promise<IndexedTrack[]> {
  const q = query.trim();
  if (q.length < 2) return [];
  return cachedSearch(searchKey('youtube', q, limit), async () => {
    try {
      const data = await requestFunction<YoutubeSearchResponse>('yt-music-search', {
        query: q,
        limit,
      });
      return Array.isArray(data.results) ? data.results : [];
    } catch {
      return [];
    }
  });
}

export async function getYouTubeMusicNewReleases(country = 'ZZ', limit = 24): Promise<IndexedTrack[]> {
  // No detected country must fall back to the GLOBAL feed ('ZZ'), never the US
  // (or any other single market) chart — this app ships worldwide.
  const cc = /^[A-Z]{2}$/.test((country || '').toUpperCase()) ? country.toUpperCase() : 'ZZ';
  // Short in-memory cache (15 min) — no localStorage persistence, so fresh
  // drops actually appear when YT ships them instead of being pinned for days.
  const key = `youtube-new-releases-v2:${cc}:${limit}`;
  const hit = newReleasesMemCache.get(key);
  if (hit && hit.expiresAt > Date.now()) return hit.data;
  try {
    const data = await requestFunction<YoutubeNewReleasesResponse>('yt-music-search', {
      mode: 'new-releases',
      country: cc,
      limit,
    });
    const out = Array.isArray(data.results) ? data.results : [];
    newReleasesMemCache.set(key, { data: out, expiresAt: Date.now() + 15 * 60 * 1000 });
    return out;
  } catch {
    return [];
  }
}

const newReleasesMemCache = new Map<string, { data: IndexedTrack[]; expiresAt: number }>();

export interface YtmCharts {
  top: IndexedTrack[];
  trending: IndexedTrack[];
  videos: IndexedTrack[];
  country: string;
}

interface YoutubeChartsResponse {
  success: boolean;
  top?: IndexedTrack[];
  trending?: IndexedTrack[];
  videos?: IndexedTrack[];
  country?: string;
  error?: string;
}

// Real YouTube Music Charts (FEmusic_charts) per country. Same source that
// music.youtube.com/charts renders; refreshes daily on YT's side.
// 'ZZ' is YouTube Music's real Global chart. When we don't know the listener's
// country we must ask for Global, not the US chart — this app is worldwide.
export async function getYouTubeMusicCharts(country = 'ZZ', limit = 40): Promise<YtmCharts> {
  const cc = /^[A-Z]{2}$/.test(country.toUpperCase()) ? country.toUpperCase() : 'ZZ';
  const cacheKey = `ytm-charts::${cc}::${limit}`;
  const memHit = chartsMemCache.get(cacheKey);
  const now = Date.now();
  if (memHit && memHit.expiresAt > now) return memHit.data;
  const inflight = chartsInflight.get(cacheKey);
  if (inflight) return inflight;
  const p = (async () => {
    try {
      const data = await requestFunction<YoutubeChartsResponse>('yt-music-search', {
        mode: 'charts',
        country: cc,
        limit,
      });
      const out: YtmCharts = {
        top: Array.isArray(data.top) ? data.top : [],
        trending: Array.isArray(data.trending) ? data.trending : [],
        videos: Array.isArray(data.videos) ? data.videos : [],
        country: data.country || cc,
      };
      chartsMemCache.set(cacheKey, { data: out, expiresAt: Date.now() + 30 * 60 * 1000 });
      return out;
    } catch {
      return { top: [], trending: [], videos: [], country: cc } as YtmCharts;
    } finally {
      chartsInflight.delete(cacheKey);
    }
  })();
  chartsInflight.set(cacheKey, p);
  return p;
}

const chartsMemCache = new Map<string, { data: YtmCharts; expiresAt: number }>();
const chartsInflight = new Map<string, Promise<YtmCharts>>();

// Session-level cache for Global Top tracks so they don't refetch every time
// the user navigates back to Home. Survives across mounts during the session;
// localStorage layer survives across reloads (TTL 30 minutes).
const TOP_TRACKS_TTL = 30 * 60 * 1000;
const TOP_TRACKS_LS_KEY = 'uf_top_tracks_v1';
const topTracksMemCache = new Map<number, { data: IndexedTrack[]; expiresAt: number }>();
let topTracksInflight = new Map<number, Promise<IndexedTrack[]>>();

(function hydrateTopTracksCache() {
  try {
    const raw = localStorage.getItem(TOP_TRACKS_LS_KEY);
    if (!raw) return;
    const parsed = JSON.parse(raw) as Record<string, { data: IndexedTrack[]; expiresAt: number }>;
    const now = Date.now();
    Object.entries(parsed).forEach(([k, v]) => {
      if (v?.expiresAt > now && Array.isArray(v.data)) {
        topTracksMemCache.set(Number(k), v);
      }
    });
  } catch { /* ignore */ }
})();

function persistTopTracksCache() {
  try {
    const obj: Record<string, { data: IndexedTrack[]; expiresAt: number }> = {};
    topTracksMemCache.forEach((v, k) => { obj[String(k)] = v; });
    localStorage.setItem(TOP_TRACKS_LS_KEY, JSON.stringify(obj));
  } catch { /* ignore quota */ }
}

export async function getTopIndexedTracks(limit = 30): Promise<IndexedTrack[]> {
  const cached = topTracksMemCache.get(limit);
  if (cached && cached.expiresAt > Date.now()) {
    return cached.data;
  }
  const inflight = topTracksInflight.get(limit);
  if (inflight) return inflight;

  const promise = (async () => {
    const data = await requestIndexer<IndexedTracksResponse>({
      action: 'top',
      limit,
    });
    const results = Array.isArray(data.results) ? data.results : [];
    if (results.length > 0) {
      topTracksMemCache.set(limit, { data: results, expiresAt: Date.now() + TOP_TRACKS_TTL });
      persistTopTracksCache();
    }
    return results;
  })();
  topTracksInflight.set(limit, promise);
  try {
    return await promise;
  } finally {
    topTracksInflight.delete(limit);
  }
}

/**
 * Drop the cached stream URL for a track (memory + localStorage). Use this
 * when a previously cached URL has gone stale (e.g. the audio element fired
 * MEDIA_ERR_SRC_NOT_SUPPORTED) so the next resolve hits the network instead
 * of returning the dead URL.
 */
export function invalidateStreamCache(artist: string, title: string) {
  const cacheKey = makeCacheKey(artist, title);
  streamCache.delete(cacheKey);
  inFlightResolutions.delete(cacheKey);
  persistCache();
}

export async function resolveIndexedTrack(
  artist: string,
  title: string,
  opts: { forceRefresh?: boolean; background?: boolean } = {},
): Promise<ResolveTrackResponse> {
  const priority: Priority = opts.background ? 'low' : 'high';
  const cacheKey = makeCacheKey(artist, title);
  if (opts.forceRefresh) {
    streamCache.delete(cacheKey);
    inFlightResolutions.delete(cacheKey);
  }
  const cached = opts.forceRefresh ? null : getCachedStream(cacheKey);
  if (cached) {
    return {
      success: true,
      streamUrl: cached.url,
      title: cached.meta?.title || title,
      artist: cached.meta?.artist || artist,
      cover_url: cached.meta?.cover_url,
      duration: cached.meta?.duration,
      videoId: cached.meta?.videoId,
    };
  }

  const existing = inFlightResolutions.get(cacheKey);
  if (existing) return existing;

  const pending = (async () => {
    const startedAt = Date.now();
    // INSTANT PLAY: race every source in parallel. Whichever returns a usable
    // stream URL first wins — no more waiting for the DB cache to miss before
    // pinging Saavn, or waiting for Saavn to miss before hitting the edge.
    const dbP: Promise<ResolveTrackResponse | null> = opts.forceRefresh
      ? Promise.resolve(null)
      : trackResolver('db-cache', cacheKey, tryDbCachedStream(artist, title)).catch(() => null);

    const saavnP: Promise<ResolveTrackResponse | null> = trackResolver('jiosaavn', cacheKey, findSongStreamUrl(title, artist, opts)
      .then((s) => s?.streamUrl ? ({
        success: true,
        streamUrl: s.streamUrl,
        title: s.title || title,
        artist: s.artist || artist,
        cover_url: s.image,
        duration: Number(s.duration) || undefined,
      } as ResolveTrackResponse) : null))
      .catch(() => null);

    const edgeP: Promise<ResolveTrackResponse | null> = isSourceDown('music-indexer')
      ? Promise.resolve(null)
      : trackResolver('music-indexer', cacheKey, resolveViaEdgeFunction(
      artist, title, cacheKey, opts.forceRefresh === true, priority,
    )).catch(() => null);

    const racers = [dbP, saavnP, edgeP];
    const first = await new Promise<ResolveTrackResponse | null>((resolve) => {
      let settled = false;
      let remaining = racers.length;
      const done = (r: ResolveTrackResponse | null) => {
        if (settled) return;
        if (r?.success && r.streamUrl) {
          settled = true;
          resolve(r);
          return;
        }
        remaining -= 1;
        if (remaining <= 0) { settled = true; resolve(null); }
      };
      racers.forEach((p) => p.then(done, () => done(null)));
    });

    if (first?.streamUrl) {
      setCachedStream(cacheKey, first.streamUrl, {
        title: first.title,
        artist: first.artist,
        cover_url: first.cover_url,
        duration: first.duration,
        videoId: first.videoId,
      });
      recordPerfEvent({
        event_type: 'resolve_complete',
        severity: 'info',
        source: 'catalog',
        track_id: cacheKey,
        latency_ms: Date.now() - startedAt,
      });
      return first;
    }

    recordPerfEvent({
      event_type: 'resolve_failed',
      severity: opts.background ? 'info' : 'error',
      source: 'catalog',
      track_id: cacheKey,
      latency_ms: Date.now() - startedAt,
      message: 'All sources failed',
    });
    throw new Error('Could not find a playable stream for this track');

  })().finally(() => {
    inFlightResolutions.delete(cacheKey);
  });


  inFlightResolutions.set(cacheKey, pending);
  return pending;
}

export async function resolveYouTubeVideoStream(
  videoId: string,
  opts: { forceRefresh?: boolean; title?: string; artist?: string; background?: boolean } = {},
): Promise<ResolveTrackResponse> {
  const id = videoId.trim();
  if (!/^[a-zA-Z0-9_-]{11}$/.test(id)) {
    return { success: false, error: 'Invalid video id' };
  }

  // RACE GUARD: a prewarm, a tap and an error-recovery retry can all ask for the
  // same videoId at once. Without a lock they run independent resolver chains and
  // the last one to finish overwrites the cache — that is how a listener ends up
  // hearing the wrong track. One lock key per (videoId, forceRefresh).
  const lockKey = `yt:${id}:${opts.forceRefresh === true ? 'force' : 'cached'}`;
  // A YouTube-side cooldown must NOT block playback: JioSaavn is a fully
  // independent source and is usually the one that actually works. Only give up
  // early when we have no title/artist to search with.
  if (!opts.forceRefresh && isInFailureCooldown(lockKey) && !getYtmCached(id)?.url
      && !opts.title && !opts.artist) {
    return { success: false, error: 'No audio stream available' };
  }
  return withRequestLock(lockKey, () => resolveYouTubeVideoStreamInner(id, opts, lockKey));
}

async function resolveYouTubeVideoStreamInner(
  id: string,
  opts: { forceRefresh?: boolean; title?: string; artist?: string; background?: boolean },
  lockKey: string,
): Promise<ResolveTrackResponse> {

  // 1) 6h client cache
  if (!opts.forceRefresh) {
    const cached = getYtmCached(id);
    if (cached?.url) {
      return {
        success: true,
        streamUrl: cached.url,
        videoId: id,
        title: cached.meta?.title,
        artist: cached.meta?.artist,
        cover_url: cached.meta?.cover_url,
        duration: cached.meta?.duration,
      };
    }
  } else {
    invalidateYtmCached(id);
  }

  const ytStartedAt = Date.now();
  // INSTANT PLAY: race JioSaavn (fast CDN, CORS-clean) in parallel with the
  // YouTube resolver stack. First real audio URL wins.
  const saavnRacer: Promise<ResolveTrackResponse | null> = (opts.title || opts.artist) && !opts.forceRefresh
    ? trackResolver('jiosaavn', id, findSongStreamUrl(opts.title || '', opts.artist || '')
        .then((s) => s?.streamUrl ? ({
          success: true,
          streamUrl: s.streamUrl,
          videoId: id,
          title: s.title || opts.title,
          artist: s.artist || opts.artist,
          cover_url: s.image,
          duration: Number(s.duration) || undefined,
        } as ResolveTrackResponse) : null))
        .catch(() => null)
    : Promise.resolve(null);

  const priority: Priority = opts.background ? 'low' : 'high';
  const resolvers: Promise<ResolveTrackResponse | null>[] = [
    saavnRacer,
    isSourceDown('extract-audio') ? Promise.resolve(null) : trackResolver('extract-audio', id, (async () => {
      const { data, error } = await invokeGated<{
        success?: boolean; audioUrl?: string; title?: string; artist?: string;
        thumbnail?: string; duration?: number;
      }>('extract-audio', { videoId: id, forceRefresh: opts.forceRefresh === true }, priority);
      if (error) throw new Error(error.message || 'extract-audio failed');
      if (data?.success && data?.audioUrl && !String(data.audioUrl).startsWith('yt-video:')) {
        return {
          success: true,
          streamUrl: data.audioUrl,
          videoId: id,
          title: data.title,
          artist: data.artist,
          cover_url: data.thumbnail,
          duration: data.duration,
        } as ResolveTrackResponse;
      }
      return null;
    })()).catch(() => null),
    isSourceDown('innertube') ? Promise.resolve(null) : trackResolver('innertube', id, (async () => {
      const data = await requestIndexer<ResolveTrackResponse>({
        action: 'resolve-video',
        videoId: id,
        // Metadata hints let the backend try JioSaavn (which does not block us)
        // before YouTube, instead of paying an oembed lookup first.
        title: opts.title,
        artist: opts.artist,
        forceRefresh: opts.forceRefresh === true,
      }, priority);
      if (data?.success && data.streamUrl && !data.streamUrl.startsWith('yt-video:')) {
        return { ...data, videoId: id };
      }
      return null;
    })()).catch(() => null),
  ];

  const winner = await withTimeout(new Promise<ResolveTrackResponse | null>((resolve) => {
    let settled = false;
    let remaining = resolvers.length;
    const done = (result: ResolveTrackResponse | null) => {
      if (settled) return;
      if (result?.success && result.streamUrl && !result.streamUrl.startsWith('yt-video:')) {
        settled = true;
        resolve(result);
        return;
      }
      remaining -= 1;
      if (remaining <= 0) {
        settled = true;
        resolve(null);
      }
    };
    resolvers.forEach((resolver) => resolver.then(done).catch(() => done(null)));
  }), 6500, null);


  if (winner?.streamUrl) {
    clearRequestFailure(lockKey);
    setYtmCached(id, winner.streamUrl, {
      title: winner.title,
      artist: winner.artist,
      cover_url: winner.cover_url,
      duration: winner.duration,
    });
    recordPerfEvent({
      event_type: 'resolve_complete',
      severity: 'info',
      source: 'youtube',
      track_id: id,
      latency_ms: Date.now() - ytStartedAt,
    });
    return winner;
  }

  recordPerfEvent({
    event_type: 'resolve_failed',
    severity: opts.background ? 'info' : 'error',
    source: 'youtube',
    track_id: id,
    latency_ms: Date.now() - ytStartedAt,
    message: 'All YouTube resolvers failed',
  });


  // LAST RESORT — if YouTube resolvers all failed AND we have title/artist,
  // retry JioSaavn with a looser (non-confident) match. Better to play a close
  // cover than nothing at all when the user is on a blocked network.
  if (opts.title || opts.artist) {
    try {
      const saavn = await findSongStreamUrl(opts.title || '', opts.artist || '');
      if (saavn?.streamUrl) {
        setYtmCached(id, saavn.streamUrl, {
          title: saavn.title,
          artist: saavn.artist,
          cover_url: saavn.image,
          duration: Number(saavn.duration) || undefined,
        });
        return {
          success: true,
          streamUrl: saavn.streamUrl,
          videoId: id,
          title: saavn.title || opts.title,
          artist: saavn.artist || opts.artist,
          cover_url: saavn.image,
          duration: Number(saavn.duration) || undefined,
        };
      }
    } catch { /* nothing left */ }
  }

  markRequestFailed(lockKey);
  return { success: false, error: 'No audio stream available' };
}

export function invalidateYouTubeStream(videoId: string) {
  invalidateYtmCached(videoId);
}

/** Forget a specific stream URL after it failed to play (expired signature etc). */
export function invalidateStreamUrl(url?: string | null) {
  invalidateYtmCachedByUrl(url);
}

async function resolveViaEdgeFunction(artist: string, title: string, cacheKey: string, forceRefresh = false, priority: Priority = 'high'): Promise<ResolveTrackResponse> {
  const result = await requestIndexer<ResolveTrackResponse>({
    action: 'resolve',
    artist,
    title,
    forceRefresh,
  }, priority);

  if (!result?.success || !result.streamUrl) {
    throw new Error(result?.error || 'Could not find a playable stream for this track');
  }

  setCachedStream(cacheKey, result.streamUrl, {
    title: result.title,
    artist: result.artist,
    cover_url: result.cover_url,
    duration: result.duration,
    videoId: result.videoId,
  });

  return result;
}


export function prefetchIndexedTrack(artist: string, title: string) {
  const cacheKey = makeCacheKey(artist, title);
  if (getCachedStream(cacheKey) || inFlightResolutions.has(cacheKey)) return;
  void resolveIndexedTrack(artist, title, { background: true }).catch(() => null);
}

export function prefetchYouTubeVideoStream(videoId?: string | null, hint?: { title?: string; artist?: string }) {
  const id = (videoId || '').trim();
  if (!/^[a-zA-Z0-9_-]{11}$/.test(id)) return;
  if (getYtmCached(id)?.url) return;
  void resolveYouTubeVideoStream(id, { ...(hint || {}), background: true }).catch(() => null);
}

// ── Artist directory (with real PFPs from Deezer) ──

export interface IndexedArtistInfo {
  name: string;
  image_url?: string;
  listeners?: number;
}

interface ArtistDirectoryResponse {
  success: boolean;
  results?: IndexedArtistInfo[];
  error?: string;
}

interface ArtistImagesResponse {
  success: boolean;
  results?: Record<string, string>;
  error?: string;
}

export async function searchArtistDirectory(query: string, limit = 30): Promise<IndexedArtistInfo[]> {
  if (!query || query.trim().length < 2) return [];
  try {
    const data = await requestIndexer<ArtistDirectoryResponse>({
      action: 'search-artists',
      query: query.trim(),
      limit,
    });
    return Array.isArray(data.results) ? data.results : [];
  } catch {
    return [];
  }
}

export async function getTopArtistsByTag(tag: string, limit = 40): Promise<IndexedArtistInfo[]> {
  try {
    const data = await requestIndexer<ArtistDirectoryResponse>({
      action: 'top-artists',
      tag,
      limit,
    });
    return Array.isArray(data.results) ? data.results : [];
  } catch {
    return [];
  }
}

const PORTRAIT_CACHE_KEY = 'uf_artist_portraits_v1';
const PORTRAIT_TTL = 7 * 24 * 60 * 60 * 1000;

type PortraitCache = Record<string, { url: string; at: number }>;

function readPortraitCache(): PortraitCache {
  if (typeof window === 'undefined') return {};
  try {
    const raw = window.localStorage.getItem(PORTRAIT_CACHE_KEY);
    const parsed = raw ? (JSON.parse(raw) as PortraitCache) : {};
    return parsed && typeof parsed === 'object' ? parsed : {};
  } catch {
    return {};
  }
}

function writePortraitCache(cache: PortraitCache) {
  if (typeof window === 'undefined') return;
  try {
    const entries = Object.entries(cache)
      .filter(([, v]) => v && Date.now() - v.at < PORTRAIT_TTL)
      .slice(-400);
    window.localStorage.setItem(PORTRAIT_CACHE_KEY, JSON.stringify(Object.fromEntries(entries)));
  } catch { /* quota — cache is best-effort */ }
}

/** Read the locally cached portrait for a name (instant paint, no network). */
export function cachedArtistPortrait(name: string): string | null {
  const hit = readPortraitCache()[name.trim().toLowerCase()];
  return hit && Date.now() - hit.at < PORTRAIT_TTL ? hit.url : null;
}

export async function enrichArtistImages(names: string[]): Promise<Record<string, string>> {
  const filtered = names.filter((n) => typeof n === 'string' && n.trim()).slice(0, 60);
  if (!filtered.length) return {};

  // Serve known portraits instantly and only ask the backend for the rest, so a
  // cold start (or a failing request) never leaves artist cards blank.
  const cache = readPortraitCache();
  const out: Record<string, string> = {};
  const missing: string[] = [];
  for (const name of filtered) {
    const hit = cache[name.trim().toLowerCase()];
    if (hit && Date.now() - hit.at < PORTRAIT_TTL) out[name] = hit.url;
    else missing.push(name);
  }
  if (!missing.length) return out;

  try {
    const data = await requestIndexer<ArtistImagesResponse>({
      action: 'enrich-artist-images',
      names: missing,
    });
    const fresh = data.results && typeof data.results === 'object' ? data.results : {};
    for (const [name, url] of Object.entries(fresh)) {
      if (typeof url !== 'string' || !url) continue;
      out[name] = url;
      cache[name.trim().toLowerCase()] = { url, at: Date.now() };
    }
    writePortraitCache(cache);
    return out;
  } catch {
    return out;
  }
}


// Country viral chart (Last.fm geo.getTopTracks). Returns real per-country trending tracks.
export async function getGeoTopTracks(country: string, limit = 30): Promise<IndexedTrack[]> {
  if (!country) return [];
  try {
    const data = await requestIndexer<IndexedTracksResponse & { country?: string }>({
      action: 'geo-top',
      country,
      limit,
    });
    return Array.isArray(data.results) ? data.results : [];
  } catch {
    return [];
  }
}

// Mood/genre tag chart (Last.fm tag.getTopTracks). e.g. "chill", "sad", "workout".
export async function getTagTopTracks(tag: string, limit = 30): Promise<IndexedTrack[]> {
  if (!tag) return [];
  return cachedSearch(searchKey('tag', tag, limit), async () => {
    try {
      const data = await requestIndexer<IndexedTracksResponse & { tag?: string }>({
        action: 'tag-top',
        tag,
        limit,
      });
      return Array.isArray(data.results) ? data.results : [];
    } catch {
      return [];
    }
  });
}

// Top tracks for a single artist (used for non-catalog followed artists).
export async function getArtistTopTracksByName(artist: string, limit = 12): Promise<IndexedTrack[]> {
  if (!artist) return [];
  try {
    const data = await requestIndexer<IndexedTracksResponse>({
      action: 'artist-top',
      artist,
      limit,
    });
    return Array.isArray(data.results) ? data.results : [];
  } catch {
    return [];
  }
}
