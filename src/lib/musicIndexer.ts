import { supabase } from '@/integrations/supabase/client';
import { findSongStreamUrl } from '@/lib/jiosaavn';
import { getCachedStream as getYtmCached, setCachedStream as setYtmCached, invalidateStream as invalidateYtmCached } from '@/lib/ytmStreamCache';

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
      if (val?.expiresAt > now && val?.url) streamCache.set(key, val);
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
async function tryDbCachedStream(artist: string, title: string): Promise<ResolveTrackResponse | null> {
  try {
    const { data } = await supabase
      .from('stream_songs')
      .select('audio_url, title, artist, cover_url, duration, last_seen_at')
      .eq('artist', artist)
      .eq('title', title)
      .order('last_seen_at', { ascending: false })
      .limit(1)
      .maybeSingle();

    if (!data?.audio_url) return null;
    if (!isSafeSharedCachedStream(data.audio_url)) return null;
    if (isKnownBrokenStreamUrl(data.audio_url)) return null;
    // Treat audio_url as fresh if seen in last 4h (server refreshes on resolve)
    const ageMs = Date.now() - new Date(data.last_seen_at).getTime();
    if (ageMs > 4 * 60 * 60 * 1000) return null;

    return {
      success: true,
      streamUrl: data.audio_url,
      title: data.title,
      artist: data.artist,
      cover_url: data.cover_url || undefined,
      duration: data.duration || undefined,
    };
  } catch {
    return null;
  }
}

async function requestFunction<T>(functionName: string, body: Record<string, unknown>, requireSuccess = false): Promise<T> {
  const { data, error } = await supabase.functions.invoke(functionName, {
    body,
  });

  if (error) {
    throw new Error(error.message || 'Function request failed');
  }

  if (requireSuccess && !data?.success) {
    throw new Error(data?.error || 'Function request failed');
  }

  return data as T;
}

async function requestIndexer<T>(body: Record<string, unknown>): Promise<T> {
  return requestFunction<T>('music-indexer', body, true);
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

export async function getYouTubeMusicNewReleases(country = 'US', limit = 24): Promise<IndexedTrack[]> {
  const cc = /^[A-Z]{2}$/.test(country.toUpperCase()) ? country.toUpperCase() : 'US';
  return cachedSearch(searchKey('youtube-new-releases-v1', cc, limit), async () => {
    try {
      const data = await requestFunction<YoutubeNewReleasesResponse>('yt-music-search', {
        mode: 'new-releases',
        country: cc,
        limit,
      });
      return Array.isArray(data.results) ? data.results : [];
    } catch {
      return [];
    }
  });
}

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
  opts: { forceRefresh?: boolean } = {},
): Promise<ResolveTrackResponse> {
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
    // FAST PATH: shared DB cache first. This avoids waiting on external search
    // APIs for popular songs and cuts APK tap-to-audio latency.
    const dbHit = opts.forceRefresh ? null : await tryDbCachedStream(artist, title);
    if (dbHit?.streamUrl) {
      setCachedStream(cacheKey, dbHit.streamUrl, {
        title: dbHit.title,
        artist: dbHit.artist,
        cover_url: dbHit.cover_url,
        duration: dbHit.duration,
      });
      return dbHit;
    }

    // Next: use the deployed JioSaavn API. It returns direct CDN audio URLs
    // with CORS, avoiding stale/proxy YouTube streams.
    const saavnHit = await findSongStreamUrl(title, artist, opts).catch(() => null);
    if (saavnHit?.streamUrl) {
      const result: ResolveTrackResponse = {
        success: true,
        streamUrl: saavnHit.streamUrl,
        title: saavnHit.title || title,
        artist: saavnHit.artist || artist,
        cover_url: saavnHit.image,
        duration: Number(saavnHit.duration) || undefined,
      };
      setCachedStream(cacheKey, result.streamUrl!, result);
      return result;
    }

    // Fallback: slower edge resolver.
    return await resolveViaEdgeFunction(artist, title, cacheKey, opts.forceRefresh === true);
  })().finally(() => {
    inFlightResolutions.delete(cacheKey);
  });

  inFlightResolutions.set(cacheKey, pending);
  return pending;
}

export async function resolveYouTubeVideoStream(
  videoId: string,
  opts: { forceRefresh?: boolean; title?: string; artist?: string } = {},
): Promise<ResolveTrackResponse> {
  const id = videoId.trim();
  if (!/^[a-zA-Z0-9_-]{11}$/.test(id)) {
    return { success: false, error: 'Invalid video id' };
  }

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

  // 1.5) FAST PATH — if we know title/artist, try JioSaavn directly. This
  // bypasses every YouTube resolver (which can be IP-blocked or slow on web)
  // and delivers a CORS-clean CDN URL with no delay. Only accepted when the
  // match is confident (isConfidentMatch inside findSongStreamUrl).
  if ((opts.title || opts.artist) && !opts.forceRefresh) {
    try {
      const saavn = await findSongStreamUrl(opts.title || '', opts.artist || '');
      if (saavn?.streamUrl) {
        const result: ResolveTrackResponse = {
          success: true,
          streamUrl: saavn.streamUrl,
          videoId: id,
          title: saavn.title || opts.title,
          artist: saavn.artist || opts.artist,
          cover_url: saavn.image,
          duration: Number(saavn.duration) || undefined,
        };
        setYtmCached(id, result.streamUrl!, {
          title: result.title,
          artist: result.artist,
          cover_url: result.cover_url,
          duration: result.duration,
        });
        return result;
      }
    } catch { /* fall through to YouTube resolvers */ }
  }

  // 2) Race BOTH resolver stacks in parallel. Waiting for extract-audio to fail
  // before trying music-indexer made every tap feel frozen when a proxy batch was
  // bad. The first real audio URL wins; failed/iframe results are ignored.
  const resolvers: Promise<ResolveTrackResponse | null>[] = [
    (async () => {
      try {
        const { data, error } = await supabase.functions.invoke('extract-audio', {
          body: { videoId: id, forceRefresh: opts.forceRefresh === true },
        });
        if (error) throw error;
        if (data?.success && data?.audioUrl && !String(data.audioUrl).startsWith('yt-video:')) {
          return {
            success: true,
            streamUrl: data.audioUrl,
            videoId: id,
            title: data.title,
            artist: data.artist,
            cover_url: data.thumbnail,
            duration: data.duration,
          };
        }
      } catch { /* try other resolver */ }
      return null;
    })(),
    (async () => {
      try {
        const data = await requestIndexer<ResolveTrackResponse>({
          action: 'resolve-video',
          videoId: id,
          forceRefresh: opts.forceRefresh === true,
        });
        if (data?.success && data.streamUrl && !data.streamUrl.startsWith('yt-video:')) {
          return { ...data, videoId: id };
        }
      } catch { /* try other resolver */ }
      return null;
    })(),
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
  }), 9000, null);

  if (winner?.streamUrl) {
    setYtmCached(id, winner.streamUrl, {
      title: winner.title,
      artist: winner.artist,
      cover_url: winner.cover_url,
      duration: winner.duration,
    });
    return winner;
  }

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

  return { success: false, error: 'No audio stream available' };
}

export function invalidateYouTubeStream(videoId: string) {
  invalidateYtmCached(videoId);
}

async function resolveViaEdgeFunction(artist: string, title: string, cacheKey: string, forceRefresh = false): Promise<ResolveTrackResponse> {
  const result = await requestIndexer<ResolveTrackResponse>({
    action: 'resolve',
    artist,
    title,
    forceRefresh,
  });

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
  void resolveIndexedTrack(artist, title).catch(() => null);
}

export function prefetchYouTubeVideoStream(videoId?: string | null, hint?: { title?: string; artist?: string }) {
  const id = (videoId || '').trim();
  if (!/^[a-zA-Z0-9_-]{11}$/.test(id)) return;
  if (getYtmCached(id)?.url) return;
  void resolveYouTubeVideoStream(id, hint || {}).catch(() => null);
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

export async function enrichArtistImages(names: string[]): Promise<Record<string, string>> {
  const filtered = names.filter((n) => typeof n === 'string' && n.trim()).slice(0, 60);
  if (!filtered.length) return {};
  try {
    const data = await requestIndexer<ArtistImagesResponse>({
      action: 'enrich-artist-images',
      names: filtered,
    });
    return data.results && typeof data.results === 'object' ? data.results : {};
  } catch {
    return {};
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
