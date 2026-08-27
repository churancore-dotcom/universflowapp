import { serve } from 'https://deno.land/std@0.168.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

// ── Persistent DB-backed stream cache (survives cold starts) ──
const SUPABASE_URL = Deno.env.get('SUPABASE_URL') || '';
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') || '';
const STREAM_DB_CACHE_TTL_MS = 6 * 60 * 60 * 1000; // 6 hours

// deno-lint-ignore no-explicit-any
let _adminClient: any = null;
function getAdminClient() {
  if (!_adminClient && SUPABASE_URL && SUPABASE_SERVICE_ROLE_KEY) {
    _adminClient = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
      auth: { persistSession: false, autoRefreshToken: false },
    });
  }
  return _adminClient;
}

async function getAuthenticatedUserId(req: Request): Promise<string | null> {
  const authHeader = req.headers.get('authorization') || '';
  const admin = getAdminClient();
  if (!authHeader.startsWith('Bearer ') || !admin) return null;
  const { data } = await admin.auth.getUser(authHeader.slice(7));
  return data?.user?.id ?? null;
}

function dbCacheKey(artist: string, title: string) {
  return `resolve:${artist.toLowerCase().trim()}::${title.toLowerCase().trim()}`.slice(0, 200);
}

function isKnownBrokenStreamUrl(url?: string | null) {
  // Only obvious placeholders; per-URL liveness is determined by probing
  if (!url) return false;
  if (url.startsWith('yt-video:')) return true;
  if (url.includes('adminforge.destreams') || url.includes('adminforge.desearch')) return true;
  if (url.includes('pipedapi.adminforge.de')) return true;
  return false;
}

async function getDbCachedStream(artist: string, title: string): Promise<{ streamUrl: string; videoId?: string; cover_url?: string; duration?: number } | null> {
  const client = getAdminClient();
  if (!client) return null;
  try {
    const trackId = dbCacheKey(artist, title);
    const { data } = await client
      .from('stream_songs')
      .select('audio_url, cover_url, duration, metadata, last_seen_at')
      .eq('track_id', trackId)
      .maybeSingle();
    if (!data?.audio_url) return null;
    if (isKnownBrokenStreamUrl(data.audio_url as string)) return null;
    if (isVolatileMirrorStream(data.audio_url as string)) return null;
    const ageMs = Date.now() - new Date(data.last_seen_at as string).getTime();
    if (ageMs > STREAM_DB_CACHE_TTL_MS) return null;
    // Do not block playback startup by probing cached streams here. If a cached
    // URL has expired, the player force-refreshes it after the first media error.
    const meta = (data.metadata as Record<string, unknown>) || {};
    return {
      streamUrl: data.audio_url as string,
      videoId: typeof meta.videoId === 'string' ? meta.videoId : undefined,
      cover_url: (data.cover_url as string) || undefined,
      duration: (data.duration as number) || undefined,
    };
  } catch (err) {
    console.warn('[db-cache] read failed:', err);
    return null;
  }
}

async function writeDbCachedStream(artist: string, title: string, payload: { streamUrl: string; videoId?: string; cover_url?: string; duration?: number }) {
  const client = getAdminClient();
  if (!client) return;
  try {
    const trackId = dbCacheKey(artist, title);
    await client.from('stream_songs').upsert({
      track_id: trackId,
      title,
      artist,
      audio_url: payload.streamUrl,
      cover_url: payload.cover_url || null,
      duration: payload.duration || null,
      source: 'resolved',
      metadata: { videoId: payload.videoId || null, cached_at: new Date().toISOString() },
      last_seen_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    }, { onConflict: 'track_id' });
  } catch (err) {
    console.warn('[db-cache] write failed:', err);
  }
}

// Exact-suffix allowlist to prevent attacker-registered hostnames like piped.attacker.com
const AUDIO_PROXY_ALLOWED_HOST_SUFFIXES = [
  '.googlevideo.com',
  '.youtube.com',
  'youtu.be',
  '.private.coffee',
  '.moomoo.me',
  '.syncpundit.io',
  '.mha.fi',
  '.leptons.xyz',
  '.r4fo.com',
  '.piped.yt',
  '.piped.video',
  '.piped.privacydev.net',
  '.piped.kavin.rocks',
  '.kavin.rocks',
  '.piped.tokhmi.xyz',
  '.piped.adminforge.de',
  '.projectsegfau.lt',
  '.invidious.io',
  '.invidious.privacydev.net',
  '.invidious.fdn.fr',
  '.invidious.projectsegfau.lt',
  '.invidious.protokolla.fi',
  '.protokolla.fi',
  '.nerdvpn.de',
  '.privacyredirect.com',
  '.nadeko.net',
  '.datura.network',
  '.invidious.f5.si',
  '.f5.si',
  '.thepixora.com',
  '.yewtu.be',
  '.reallyaweso.me',
  '.drgns.space',
  '.orangenet.cc',
  '.ducks.party',
  '.smnz.de',
  '.dhusch.de',
  '.materialio.us',
  '.perennialte.ch',
  '.melmac.space',
  'cobalt.tools',
  '.cobalt.tools',

  '.saavncdn.com',
];

function hostnameMatchesAllowedSuffix(hostname: string): boolean {
  const host = hostname.toLowerCase();
  return AUDIO_PROXY_ALLOWED_HOST_SUFFIXES.some((suffix) => {
    // Enforce a leading dot so bare entries like "youtu.be" don't match
    // attacker-registered hostnames like "eviltoutu.be".
    const dotted = suffix.startsWith('.') ? suffix : '.' + suffix;
    const bare = dotted.slice(1);
    return host === bare || host.endsWith(dotted);
  });
}

// Per-IP sliding-window rate limit for the unauthenticated audio proxy.
// Prevents random internet callers from using this function as a free
// high-bandwidth audio extraction proxy. 120 reqs/min/IP is plenty for a
// single user streaming + seeking (range requests).
const AUDIO_PROXY_RATE_LIMIT_MAX = 120;
const AUDIO_PROXY_RATE_LIMIT_WINDOW_MS = 60_000;
const audioProxyHits = new Map<string, number[]>();
function checkAudioProxyRateLimit(ip: string): boolean {
  const now = Date.now();
  const cutoff = now - AUDIO_PROXY_RATE_LIMIT_WINDOW_MS;
  const arr = (audioProxyHits.get(ip) || []).filter((t) => t > cutoff);
  if (arr.length >= AUDIO_PROXY_RATE_LIMIT_MAX) {
    audioProxyHits.set(ip, arr);
    return false;
  }
  arr.push(now);
  audioProxyHits.set(ip, arr);
  // Opportunistic GC so the map doesn't grow unbounded across the warm instance.
  if (audioProxyHits.size > 5000) {
    for (const [k, v] of audioProxyHits) {
      const kept = v.filter((t) => t > cutoff);
      if (kept.length === 0) audioProxyHits.delete(k);
      else audioProxyHits.set(k, kept);
    }
  }
  return true;
}

// Per-IP sliding-window rate limit for unauthenticated discovery JSON actions
// (search/top/geo-top/tag-top/artist-top/resolve/etc). Caps Last.fm + YouTube
// API quota abuse from anonymous callers. 60 reqs/min/IP is generous for a
// human user browsing /home and searching.
const ACTION_RATE_LIMIT_MAX = 60;
const ACTION_RATE_LIMIT_WINDOW_MS = 60_000;
const actionHits = new Map<string, number[]>();
function checkMusicIndexerActionRateLimit(ip: string): boolean {
  const now = Date.now();
  const cutoff = now - ACTION_RATE_LIMIT_WINDOW_MS;
  const arr = (actionHits.get(ip) || []).filter((t) => t > cutoff);
  if (arr.length >= ACTION_RATE_LIMIT_MAX) {
    actionHits.set(ip, arr);
    return false;
  }
  arr.push(now);
  actionHits.set(ip, arr);
  if (actionHits.size > 5000) {
    for (const [k, v] of actionHits) {
      const kept = v.filter((t) => t > cutoff);
      if (kept.length === 0) actionHits.delete(k);
      else actionHits.set(k, kept);
    }
  }
  return true;
}




const LASTFM_API_KEY = Deno.env.get('LASTFM_API_KEY') || '';
const YOUTUBE_API_KEY = Deno.env.get('YOUTUBE_API_KEY') || '';
const YOUTUBE_API_KEY_2 = Deno.env.get('YOUTUBE_API_KEY_2') || '';
const YOUTUBE_API_KEYS = [YOUTUBE_API_KEY, YOUTUBE_API_KEY_2].filter(Boolean);
const LASTFM_BASE_URL = 'https://ws.audioscrobbler.com/2.0/';

// ── Instance lists (refreshed 2026-07-17 after mass 401/403/500 outages) ──
// Stale entries that were serving HTML error pages or LOGIN_REQUIRED walls
// have been pruned. New entries verified against public uptime trackers
// (kavin.rocks piped-instances + api.invidious.io/instances.json).

const PIPED_INSTANCES = [
  'https://pipedapi.reallyaweso.me',
  'https://pipedapi.drgns.space',
  'https://pipedapi.orangenet.cc',
  'https://pipedapi.ducks.party',
  'https://pipedapi.smnz.de',
  'https://api.piped.private.coffee',
  'https://pipedapi.moomoo.me',
  'https://pipedapi.syncpundit.io',
  'https://api-piped.mha.fi',
  'https://pipedapi.leptons.xyz',
  'https://pipedapi.r4fo.com',
  'https://pipedapi.adminforge.de',
];


const INVIDIOUS_INSTANCES = [
  'https://invidious.reallyaweso.me',
  'https://invidious.materialio.us',
  'https://invidious.perennialte.ch',
  'https://iv.melmac.space',
  'https://iv.datura.network',
  'https://inv.nadeko.net',
  'https://invidious.f5.si',
  'https://invidious.nerdvpn.de',
  'https://invidious.private.coffee',
  'https://invidious.privacyredirect.com',
  'https://invidious.protokolla.fi',
  'https://invidious.jing.rocks',
  'https://yewtu.be',
];

// ── Dynamic instance discovery (cached 30 min) ──

let dynamicPiped: string[] = [];
let dynamicInvidious: string[] = [];
let instancesFetchedAt = 0;

async function refreshInstances() {
  if (Date.now() - instancesFetchedAt < 30 * 60 * 1000) return;
  instancesFetchedAt = Date.now();

  // Piped: try a few discovery endpoints; the kavin.rocks one is often down.
  const pipedSources = [
    'https://worker-piped-instances.mha.fi/',
    'https://piped-instances.kavin.rocks/',
    'https://pipedapi.kavin.rocks/instances',
  ];
  for (const src of pipedSources) {
    try {
      const data = await fetchJson(src, 4000);
      if (Array.isArray(data) && data.length) {
        const list = data
          .filter((d: any) => (d.api_url || d.apiUrl) && !(d.api_url || d.apiUrl).includes('.onion'))
          .map((d: any) => String(d.api_url || d.apiUrl).replace(/\/$/, ''))
          .filter((url: string) => {
            try { return hostnameMatchesAllowedSuffix(new URL(url).hostname); }
            catch { return false; }
          });
        if (list.length) { dynamicPiped = list; break; }
      }
    } catch { /* try next source */ }
  }

  try {
    const data = await fetchJson('https://api.invidious.io/instances.json?sort_by=api,health', 5000);
    if (Array.isArray(data)) {
      dynamicInvidious = data
        .filter(([, info]: any) => info?.api && info?.type === 'https')
        .slice(0, 15)
        .map(([, info]: any) => info.uri.replace(/\/$/, ''))
        .filter((url: string) => {
          try { return hostnameMatchesAllowedSuffix(new URL(url).hostname); }
          catch { return false; }
        });
    }
  } catch { /* keep stale list */ }
}

function getPipedInstances(): string[] {
  const all = [...new Set([...dynamicPiped, ...PIPED_INSTANCES])];
  // Prefer explicit known instances; dynamic instances follow as extra fallbacks.
  return all.sort((a, b) => (PIPED_INSTANCES.includes(a) ? 0 : 1) - (PIPED_INSTANCES.includes(b) ? 0 : 1));
}

function getInvidiousInstances(): string[] {
  const all = [...new Set([...dynamicInvidious, ...INVIDIOUS_INSTANCES])];
  return all.sort((a, b) => (INVIDIOUS_INSTANCES.includes(a) ? 0 : 1) - (INVIDIOUS_INSTANCES.includes(b) ? 0 : 1));
}

// ── Health tracking: skip instances that failed recently ──

const failedUntil = new Map<string, number>(); // instance → timestamp

function markFailed(instance: string) {
  // 45s, not 2 min: most of these failures are transient rate-limits, and a
  // long lockout shrank the race pool to nothing during a mirror-wide wobble.
  failedUntil.set(instance, Date.now() + 45 * 1000);
}
function isHealthy(instance: string): boolean {
  const until = failedUntil.get(instance);
  if (!until) return true;
  if (Date.now() > until) { failedUntil.delete(instance); return true; }
  return false;
}

// Short-lived health probe cache so we don't hammer /api/v1/stats or /healthcheck
// on every resolve. Result lives for 60s.
const healthCache = new Map<string, { ok: boolean; at: number }>();
async function probeInstance(base: string, kind: 'invidious' | 'piped'): Promise<boolean> {
  const cached = healthCache.get(base);
  if (cached && Date.now() - cached.at < 60_000) return cached.ok;
  const path = kind === 'invidious' ? '/api/v1/stats' : '/healthcheck';
  let ok = false;
  try {
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), 1800);
    const r = await fetch(base + path, { signal: ctrl.signal, headers: { Accept: 'application/json' } });
    clearTimeout(t);
    ok = r.ok;
    if (ok && kind === 'invidious') {
      // Some proxies return 200 HTML. Peek at the body.
      const txt = await r.text();
      ok = txt.trimStart().startsWith('{');
    } else {
      await r.text().catch(() => '');
    }
  } catch { ok = false; }
  healthCache.set(base, { ok, at: Date.now() });
  if (!ok) markFailed(base);
  return ok;
}

async function pickHealthy(instances: string[], kind: 'invidious' | 'piped', max: number): Promise<string[]> {
  const healthy = instances.filter(isHealthy);
  const results = await Promise.all(healthy.slice(0, max * 2).map(async (i) => ({ i, ok: await probeInstance(i, kind) })));
  return results.filter((r) => r.ok).map((r) => r.i).slice(0, max);
}


// ── Types ──

type LastFmTrack = {
  name?: string;
  artist?: string | { name?: string };
  listeners?: string;
  duration?: string;
  album?: { title?: string; image?: Array<{ '#text'?: string }> };
  image?: Array<{ '#text'?: string }>;
  url?: string;
  '@attr'?: { rank?: string };
};

type IndexedTrack = {
  id: string; title: string; artist: string;
  album?: string; cover_url?: string; duration?: number;
  listeners?: number; rank?: number;
};

type ResolveResult = {
  success: boolean; streamUrl?: string; videoId?: string;
  duration?: number; title?: string; artist?: string; cover_url?: string; error?: string; fallback?: boolean;
  retryable?: boolean;
};

const LASTFM_PLACEHOLDER_HASH = '2a96cbd8b46e442fc41c2b86b821562f';

// ── Caching ──

const cache = new Map<string, { expiresAt: number; value: unknown }>();
function getCached<T>(key: string): T | null {
  const hit = cache.get(key);
  if (!hit || hit.expiresAt < Date.now()) { cache.delete(key); return null; }
  return hit.value as T;
}
function setCached(key: string, value: unknown, ttlMs: number) {
  cache.set(key, { value, expiresAt: Date.now() + ttlMs });
}

// ── Helpers ──

function normalizeText(v: string) {
  return v.toLowerCase().replace(/\([^)]*\)/g, ' ').replace(/\[[^\]]*\]/g, ' ')
    .replace(/[^a-z0-9\s]/g, ' ').replace(/\s+/g, ' ').trim();
}

const SEARCH_GENERIC_WORDS = new Set(['song', 'songs', 'music', 'track', 'tracks', 'official', 'audio', 'video', 'latest', 'new', 'fresh', 'best', 'top']);
function searchTokens(query: string) {
  return normalizeText(query).split(' ').filter((word) => word.length > 1 && !SEARCH_GENERIC_WORDS.has(word));
}

function queryOverlap(query: string, track: IndexedTrack) {
  const tokens = searchTokens(query);
  if (tokens.length === 0) return 1;
  const haystack = normalizeText(`${track.title} ${track.artist} ${track.album || ''}`);
  const hits = tokens.filter((token) => haystack.includes(token)).length;
  return hits / tokens.length;
}

function filterSearchMatches(query: string, tracks: IndexedTrack[]) {
  const tokens = searchTokens(query);
  if (tokens.length === 0) return tracks;
  return tracks.filter((track) => queryOverlap(query, track) > 0).sort((a, b) => queryOverlap(query, b) - queryOverlap(query, a));
}
function makeTrackId(artist: string, title: string) {
  return `lfm-${normalizeText(artist).replace(/\s+/g, '-')}-${normalizeText(title).replace(/\s+/g, '-')}`;
}
function getArtistName(a: LastFmTrack['artist']) { return typeof a === 'string' ? a : a?.name || 'Unknown Artist'; }
function getExtralargeImage(images?: Array<{ '#text'?: string }>) { return images?.[3]?.['#text'] || ''; }
function sanitizeArtwork(url?: string) {
  if (!url) return undefined;
  if (url.includes(LASTFM_PLACEHOLDER_HASH)) return undefined;
  return url;
}

function upscaleItunesArtwork(url?: string) {
  if (!url) return undefined;
  return url.replace(/\/\d+x\d+bb\./, '/600x600bb.');
}

function scoreMetadataCandidate(item: Record<string, unknown>, artist: string, title: string) {
  const itemArtist = normalizeText(String(item.artistName || ''));
  const itemTitle = normalizeText(String(item.trackName || ''));
  const wantedArtist = normalizeText(artist);
  const wantedTitle = normalizeText(title);
  let score = 0;
  if (wantedArtist && itemArtist.includes(wantedArtist)) score += 8;
  if (wantedTitle && itemTitle.includes(wantedTitle)) score += 10;
  score += wantedTitle.split(' ').filter((word) => word.length > 2 && itemTitle.includes(word)).length;
  return score;
}

async function getItunesArtwork(artist: string, title: string): Promise<string | undefined> {
  const cacheKey = `itunes-art:${artist}:${title}`;
  const cached = getCached<string | null>(cacheKey);
  if (cached !== null) return cached || undefined;

  try {
    const url = new URL('https://itunes.apple.com/search');
    url.searchParams.set('term', `${artist} ${title}`);
    url.searchParams.set('entity', 'song');
    url.searchParams.set('limit', '5');

    const data = await fetchJson(url.toString(), 5000);
    const results = Array.isArray(data?.results) ? data.results : [];
    const best = results
      .map((item: Record<string, unknown>) => ({ item, score: scoreMetadataCandidate(item, artist, title) }))
      .sort((a: { score: number }, b: { score: number }) => b.score - a.score)[0]?.item;

    const artwork = sanitizeArtwork(upscaleItunesArtwork(String(best?.artworkUrl100 || '')));
    setCached(cacheKey, artwork || null, 12 * 60 * 60 * 1000);
    return artwork;
  } catch {
    setCached(cacheKey, null, 30 * 60 * 1000);
    return undefined;
  }
}

async function getDeezerArtwork(artist: string, title: string): Promise<string | undefined> {
  const cacheKey = `deezer-art:${artist}:${title}`;
  const cached = getCached<string | null>(cacheKey);
  if (cached !== null) return cached || undefined;

  try {
    const url = new URL('https://api.deezer.com/search');
    url.searchParams.set('q', `artist:"${artist}" track:"${title}"`);
    url.searchParams.set('limit', '5');

    const data = await fetchJson(url.toString(), 5000);
    const results = Array.isArray(data?.data) ? data.data : [];
    const best = results
      .map((item: Record<string, any>) => ({
        item,
        score: scoreMetadataCandidate(
          {
            artistName: item?.artist?.name,
            trackName: item?.title,
          },
          artist,
          title,
        ),
      }))
      .sort((a: { score: number }, b: { score: number }) => b.score - a.score)[0]?.item;

    const artwork = sanitizeArtwork(String(best?.album?.cover_xl || best?.album?.cover_big || best?.album?.cover_medium || ''));
    setCached(cacheKey, artwork || null, 12 * 60 * 60 * 1000);
    return artwork;
  } catch {
    setCached(cacheKey, null, 30 * 60 * 1000);
    return undefined;
  }
}

async function resolveArtwork(artist: string, title: string, preferred?: string) {
  const safePreferred = sanitizeArtwork(preferred);
  if (safePreferred) return safePreferred;

  const deezerArtwork = await getDeezerArtwork(artist, title);
  if (deezerArtwork) return deezerArtwork;

  return getItunesArtwork(artist, title);
}

async function fetchJson(url: string, timeoutMs = 6000) {
  const controller = new AbortController();
  const t = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const r = await fetch(url, { signal: controller.signal, headers: { Accept: 'application/json', 'User-Agent': 'UniversFlow/1.0' } });
    if (!r.ok) throw new Error(`HTTP ${r.status}`);
    // Guard: some dead instances return an HTML error page with 200. Detect
    // that early so callers can markFailed(host) instead of surfacing a
    // JSON.parse "Unexpected token '<'" crash.
    const ct = (r.headers.get('content-type') || '').toLowerCase();
    const text = await r.text();
    const trimmed = text.trimStart();
    if (trimmed.startsWith('<') || (ct && !ct.includes('json') && !ct.includes('text/plain'))) {
      throw new Error(`non-json response (ct=${ct || 'none'})`);
    }
    try { return JSON.parse(text); }
    catch { throw new Error('invalid json body'); }
  } finally { clearTimeout(t); }
}


function buildLastFmUrl(method: string, params: Record<string, string>) {
  const url = new URL(LASTFM_BASE_URL);
  url.searchParams.set('method', method);
  url.searchParams.set('api_key', LASTFM_API_KEY);
  url.searchParams.set('format', 'json');
  Object.entries(params).forEach(([k, v]) => url.searchParams.set(k, v));
  return url.toString();
}

// ── Last.fm ──

async function getTrackInfo(artist: string, track: string): Promise<LastFmTrack | null> {
  const ck = `info:${artist}:${track}`;
  const c = getCached<LastFmTrack | null>(ck);
  if (c !== null) return c;
  try {
    const d = await fetchJson(buildLastFmUrl('track.getInfo', { artist, track, autocorrect: '1' }));
    const r = (d?.track || null) as LastFmTrack | null;
    setCached(ck, r, 15 * 60 * 1000);
    return r;
  } catch { setCached(ck, null, 2 * 60 * 1000); return null; }
}

function mapTrack(base: LastFmTrack, info?: LastFmTrack | null): IndexedTrack | null {
  const title = info?.name || base?.name || '';
  const artist = getArtistName(info?.artist || base?.artist);
  if (!title || !artist) return null;
  const cover_url = sanitizeArtwork(
    getExtralargeImage(info?.album?.image) ||
    getExtralargeImage(info?.image) ||
    getExtralargeImage(base?.image) ||
    getExtralargeImage(base?.album?.image) ||
    undefined
  );
  const rawD = info?.duration || base?.duration;
  const duration = rawD ? Math.round(Number(rawD) / (Number(rawD) > 1000 ? 1000 : 1)) : undefined;
  return {
    id: makeTrackId(artist, title), title, artist,
    album: info?.album?.title || base?.album?.title,
    cover_url, duration,
    listeners: Number(info?.listeners || base?.listeners || 0) || undefined,
    rank: Number(base?.['@attr']?.rank || 0) || undefined,
  };
}

async function hydrateTrackArtwork(track: IndexedTrack): Promise<IndexedTrack> {
  const artwork = await resolveArtwork(track.artist, track.title, track.cover_url);
  return artwork ? { ...track, cover_url: artwork } : track;
}

function uniqueTracks(tracks: Array<IndexedTrack | null>) {
  const seen = new Set<string>();
  return tracks.filter((t): t is IndexedTrack => {
    if (!t) return false;
    const k = `${normalizeText(t.artist)}::${normalizeText(t.title)}`;
    if (seen.has(k)) return false;
    seen.add(k); return true;
  });
}

async function searchLastFm(query: string, limit = 24) {
  const ck = `search:${query}:${limit}`;
  const c = getCached<IndexedTrack[]>(ck);
  if (c) return c;
  const d = await fetchJson(buildLastFmUrl('track.search', { track: query, limit: String(limit) }));
  const raw = d?.results?.trackmatches?.track;
  const matches: LastFmTrack[] = Array.isArray(raw) ? raw : raw ? [raw] : [];
  const enriched = await Promise.all(matches.slice(0, limit).map(async (t) => {
    const info = t.name ? await getTrackInfo(getArtistName(t.artist), t.name) : null;
    const mapped = mapTrack(t, info);
    return mapped ? hydrateTrackArtwork(mapped) : null;
  }));
  const results = filterSearchMatches(query, uniqueTracks(enriched));
  setCached(ck, results, 5 * 60 * 1000);
  return results;
}

// ── Artist-aware smart search (YouTube-style) ──
// When the user types an artist name, prepend that artist's top tracks so they
// see the artist's songs first instead of arbitrary track matches.

async function getArtistTopTracks(artist: string, limit = 20): Promise<IndexedTrack[]> {
  const ck = `artist-top:${artist.toLowerCase()}:${limit}`;
  const c = getCached<IndexedTrack[]>(ck);
  if (c) return c;
  try {
    const d = await fetchJson(buildLastFmUrl('artist.getTopTracks', {
      artist, limit: String(limit), autocorrect: '1',
    }));
    const raw = d?.toptracks?.track;
    const matches: LastFmTrack[] = Array.isArray(raw) ? raw : raw ? [raw] : [];
    const enriched = await Promise.all(matches.slice(0, limit).map(async (t) => {
      const info = t.name ? await getTrackInfo(getArtistName(t.artist) || artist, t.name) : null;
      const mapped = mapTrack({ ...t, artist: t.artist || artist }, info);
      return mapped ? hydrateTrackArtwork(mapped) : null;
    }));
    const results = uniqueTracks(enriched);
    setCached(ck, results, 30 * 60 * 1000);
    return results;
  } catch {
    setCached(ck, [], 5 * 60 * 1000);
    return [];
  }
}

async function findMatchingArtist(query: string): Promise<string | null> {
  const ck = `artist-match:${query.toLowerCase()}`;
  const c = getCached<string | null>(ck);
  if (c !== null) return c || null;
  try {
    const d = await fetchJson(buildLastFmUrl('artist.search', { artist: query, limit: '8' }));
    const raw = d?.results?.artistmatches?.artist;
    const list = Array.isArray(raw) ? raw : raw ? [raw] : [];
    const normalizedQuery = normalizeText(query);
    const candidates = list
      .map((artist: any) => {
        const name = String(artist?.name || '').trim();
        const normalizedName = normalizeText(name);
        const queryWords = normalizedQuery.split(' ').filter(Boolean);
        const hits = queryWords.filter((word) => normalizedName.includes(word)).length;
        let score = Number(artist?.listeners || 0) > 0 ? Math.log10(Number(artist.listeners)) : 0;
        if (normalizedName === normalizedQuery) score += 100;
        else if (normalizedName.includes(normalizedQuery) || normalizedQuery.includes(normalizedName)) score += 70;
        score += hits * 18;
        return { name, normalizedName, score };
      })
      .filter((artist: { name: string; normalizedName: string; score: number }) =>
        artist.name &&
        artist.normalizedName &&
        (artist.normalizedName === normalizedQuery || artist.normalizedName.includes(normalizedQuery) || normalizedQuery.includes(artist.normalizedName) || queryOverlap(query, { id: '', title: '', artist: artist.name }) >= 0.5)
      )
      .sort((a: { score: number }, b: { score: number }) => b.score - a.score);
    const result = candidates[0]?.name || null;
    setCached(ck, result || '', 60 * 60 * 1000);
    return result;
  } catch {
    setCached(ck, '', 5 * 60 * 1000);
    return null;
  }
}

async function smartSearch(query: string, limit = 30): Promise<IndexedTrack[]> {
  const ck = `smart-search:${query.toLowerCase()}:${limit}`;
  const c = getCached<IndexedTrack[]>(ck);
  if (c) return c;

  // Run artist detection + track search in parallel
  const [artistName, trackResults] = await Promise.all([
    findMatchingArtist(query),
    searchLastFm(query, limit),
  ]);

  let merged: IndexedTrack[] = trackResults;

  if (artistName) {
    const artistTracks = await getArtistTopTracks(artistName, Math.min(limit, 20));
    if (artistTracks.length) {
      // Prepend artist's top tracks, dedupe against general search results
      const seen = new Set<string>();
      const out: IndexedTrack[] = [];
      for (const t of [...artistTracks, ...trackResults]) {
        const key = `${normalizeText(t.artist)}::${normalizeText(t.title)}`;
        if (!seen.has(key)) { seen.add(key); out.push(t); }
      }
      merged = out;
    }
  }

  const results = merged.slice(0, limit);
  setCached(ck, results, 5 * 60 * 1000);
  return results;
}

// ── Artist directory (real PFPs: Spotify first, Deezer fallback) ──

type IndexedArtistInfo = {
  name: string;
  image_url?: string;
  listeners?: number;
};

// Spotify client-credentials token (cached in-memory until shortly before expiry)
let spotifyToken: { value: string; expiresAt: number } | null = null;
// When Spotify rejects the app (e.g. 403 "premium subscription required"), back off
// instead of hammering the API on every artist tile.
let spotifyBlockedUntil = 0;


async function getSpotifyToken(): Promise<string | null> {
  const id = Deno.env.get('SPOTIFY_CLIENT_ID');
  const secret = Deno.env.get('SPOTIFY_CLIENT_SECRET');
  if (!id || !secret) return null;
  if (spotifyToken && spotifyToken.expiresAt > Date.now()) return spotifyToken.value;
  try {
    const res = await fetch('https://accounts.spotify.com/api/token', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        Authorization: `Basic ${btoa(`${id}:${secret}`)}`,
      },
      body: 'grant_type=client_credentials',
    });
    if (!res.ok) {
      console.error('spotify token error', res.status, await res.text());
      return null;
    }
    const json = await res.json();
    const token = String(json?.access_token || '');
    if (!token) return null;
    spotifyToken = { value: token, expiresAt: Date.now() + Math.max(60, Number(json?.expires_in || 3600) - 60) * 1000 };
    return token;
  } catch (e) {
    console.error('spotify token failure', e);
    return null;
  }
}

async function getSpotifyArtistImage(name: string): Promise<string | undefined> {
  if (spotifyBlockedUntil > Date.now()) return undefined;
  const ck = `spotify-artist:${name.toLowerCase()}`;
  const cached = getCached<string | null>(ck);
  if (cached !== null) return cached || undefined;
  const token = await getSpotifyToken();
  if (!token) return undefined;
  try {
    const url = new URL('https://api.spotify.com/v1/search');
    url.searchParams.set('q', name);
    url.searchParams.set('type', 'artist');
    url.searchParams.set('limit', '5');
    const res = await fetch(url.toString(), { headers: { Authorization: `Bearer ${token}` } });
    if (res.status === 401) { spotifyToken = null; return undefined; }
    if (!res.ok) {
      const detail = await res.text();
      console.error('spotify search error', res.status, detail);
      if (res.status === 403 || res.status === 429) {
        // App-level rejection or rate limit — pause Spotify for 30 minutes, fall back to Deezer.
        spotifyBlockedUntil = Date.now() + 30 * 60 * 1000;
      }
      setCached(ck, null, 10 * 60 * 1000);
      return undefined;
    }

    const data = await res.json();
    const list: any[] = Array.isArray(data?.artists?.items) ? data.artists.items : [];
    const wanted = normalizeText(name);
    const exact = list.filter((a) => normalizeText(String(a?.name || '')) === wanted);
    // Never use Spotify's first fuzzy result for an artist tile. A near-name
    // result can be a tribute act, uploader, playlist brand, or video channel.
    const match = exact.sort((a, b) => Number(b?.popularity || 0) - Number(a?.popularity || 0))[0];
    if (!match) {
      setCached(ck, null, 10 * 60 * 1000);
      return undefined;
    }
    const images: any[] = Array.isArray(match?.images) ? match.images : [];
    const best = images.sort((a, b) => Number(b?.width || 0) - Number(a?.width || 0))[0];
    const image = String(best?.url || '');
    setCached(ck, image || null, 24 * 60 * 60 * 1000);
    return image || undefined;
  } catch (e) {
    console.error('spotify artist image failure', e);
    setCached(ck, null, 10 * 60 * 1000);
    return undefined;
  }
}

async function getDeezerArtistImage(name: string): Promise<string | undefined> {
  const ck = `deezer-artist:${name.toLowerCase()}`;
  const cached = getCached<string | null>(ck);
  if (cached !== null) return cached || undefined;
  try {
    const url = new URL('https://api.deezer.com/search/artist');
    url.searchParams.set('q', name);
    url.searchParams.set('limit', '3');
    const data = await fetchJson(url.toString(), 5000);
    const list = Array.isArray(data?.data) ? data.data : [];
    // Exact names only. A fuzzy first result can put a tribute act or similarly
    // named creator's face on the wrong artist card.
    const wantedKey = normalizeText(name);
    const match = list.find((a: any) => normalizeText(String(a?.name || '')) === wantedKey);
    if (!match) {
      setCached(ck, null, 30 * 60 * 1000);
      return undefined;
    }
    const image = match?.picture_xl || match?.picture_big || match?.picture_medium || '';
    setCached(ck, image || null, 24 * 60 * 60 * 1000);
    return image || undefined;
  } catch {
    setCached(ck, null, 30 * 60 * 1000);
    return undefined;
  }
}

// Canonical artist portrait resolver. Spotify is authoritative; Deezer's
// artist endpoint is a resilient exact-name fallback when Spotify is missing
// or temporarily rate-limited. Neither path uses track/video thumbnails.
async function getArtistPortrait(name: string): Promise<string | undefined> {
  return (await getSpotifyArtistImage(name)) || (await getDeezerArtistImage(name));
}


async function searchArtistDirectory(query: string, limit = 40): Promise<IndexedArtistInfo[]> {
  const ck = `artist-dir:${query.toLowerCase()}:${limit}`;
  const c = getCached<IndexedArtistInfo[]>(ck);
  if (c) return c;
  try {
    const d = await fetchJson(buildLastFmUrl('artist.search', { artist: query, limit: String(limit) }));
    const raw = d?.results?.artistmatches?.artist;
    const list = Array.isArray(raw) ? raw : raw ? [raw] : [];
    const enriched = await Promise.all(list.slice(0, limit).map(async (a: any) => {
      const name = String(a?.name || '').trim();
      if (!name) return null;
      const image = (await getArtistPortrait(name)) || sanitizeArtwork(getExtralargeImage(a?.image));
      return {
        name,
        image_url: image,
        listeners: Number(a?.listeners || 0) || undefined,
      } as IndexedArtistInfo;
    }));
    const results = enriched.filter((x): x is IndexedArtistInfo => Boolean(x));
    setCached(ck, results, 10 * 60 * 1000);
    return results;
  } catch {
    return [];
  }
}

async function getTopArtistsByTag(tag: string, limit = 30): Promise<IndexedArtistInfo[]> {
  const ck = `top-artists:${tag}:${limit}`;
  const c = getCached<IndexedArtistInfo[]>(ck);
  if (c) return c;
  try {
    const d = await fetchJson(buildLastFmUrl('tag.gettopartists', { tag, limit: String(limit) }));
    const raw = d?.topartists?.artist;
    const list = Array.isArray(raw) ? raw : raw ? [raw] : [];
    const enriched = await Promise.all(list.slice(0, limit).map(async (a: any) => {
      const name = String(a?.name || '').trim();
      if (!name) return null;
      const image = (await getArtistPortrait(name)) || sanitizeArtwork(getExtralargeImage(a?.image));
      return {
        name,
        image_url: image,
        listeners: Number(a?.listeners || 0) || undefined,
      } as IndexedArtistInfo;
    }));
    const results = enriched.filter((x): x is IndexedArtistInfo => Boolean(x));
    setCached(ck, results, 30 * 60 * 1000);
    return results;
  } catch {
    return [];
  }
}

async function enrichArtistImages(names: string[]): Promise<Record<string, string>> {
  const out: Record<string, string> = {};
  await Promise.all(names.map(async (name) => {
    const img = await getArtistPortrait(name);
    if (img) out[name] = img;
  }));
  return out;
}

// Rotating discovery tags so Top 30 keeps refreshing
const DISCOVERY_TAGS = [
  'pop', 'hip-hop', 'rock', 'electronic', 'r&b', 'indie',
  'dance', 'k-pop', 'latin', 'edm', 'rap', 'house', 'alternative', 'trap',
];

async function getTopTracks(limit = 30) {
  // Rotation key changes every ~5 minutes so the chart visibly refreshes
  const rotation = Math.floor(Date.now() / (5 * 60 * 1000));
  const ck = `top-rotated:${limit}:${rotation}`;
  const c = getCached<IndexedTrack[]>(ck);
  if (c) return c;

  // Pick 2 random tags + global chart for the freshest blend
  const shuffled = [...DISCOVERY_TAGS].sort(() => Math.random() - 0.5);
  const picks = shuffled.slice(0, 2);
  const perBucket = Math.ceil(limit / 2) + 5;

  const fetches: Promise<LastFmTrack[]>[] = [
    fetchJson(buildLastFmUrl('chart.gettoptracks', { limit: String(perBucket), page: String((rotation % 3) + 1) }))
      .then((d) => (Array.isArray(d?.tracks?.track) ? d.tracks.track : []))
      .catch(() => []),
    ...picks.map((tag) =>
      fetchJson(buildLastFmUrl('tag.gettoptracks', { tag, limit: String(perBucket), page: String((rotation % 4) + 1) }))
        .then((d) => (Array.isArray(d?.tracks?.track) ? d.tracks.track : []))
        .catch(() => []),
    ),
  ];

  const buckets = await Promise.all(fetches);
  const merged: LastFmTrack[] = [];
  // Interleave so chart top + tag picks mix nicely
  const maxLen = Math.max(...buckets.map((b) => b.length));
  for (let i = 0; i < maxLen; i += 1) {
    for (const bucket of buckets) {
      if (bucket[i]) merged.push(bucket[i]);
    }
  }

  const enriched = await Promise.all(merged.slice(0, limit + 4).map(async (t) => {
    const info = t.name ? await getTrackInfo(getArtistName(t.artist), t.name) : null;
    const mapped = mapTrack(t, info);
    return mapped ? hydrateTrackArtwork(mapped) : null;
  }));
  // Re-shuffle slightly so order doesn't feel mechanical
  const unique = uniqueTracks(enriched).sort(() => Math.random() - 0.35);
  const results = unique.slice(0, limit).map((t, i) => ({ ...t, rank: i + 1 }));
  setCached(ck, results, 5 * 60 * 1000);
  return results;
}

// ── Video search & scoring ──

const BAD_VIDEO_PATTERNS = [
  /\b(top|best)\s*\d+\b/i,
  /\b\d+\s*(top|best|hit|hits|songs)\b/i,
  /\b(non\s*stop|jukebox|mashup|medley|playlist|compilation|collection|mixtape|album full|full album|all songs)\b/i,
  /\b(90'?s|80'?s|70'?s|evergreen|old is gold|purane|old songs?)\b/i,
  /\b(sped up|slowed|reverb|nightcore|8d|karaoke|cover|remix|instrumental|ringtone|shorts)\b/i,
  /\b\d+\s*(hour|hours|hr|hrs|minute|minutes|min)\b/i,
];

function isBadVideoCandidate(item: Record<string, unknown>, artist: string, title: string) {
  const raw = `${String(item.title || '')} ${String(item.author || item.uploaderName || item.uploader || '')}`;
  const normalizedWanted = normalizeText(`${artist} ${title}`);
  const normalizedRaw = normalizeText(raw);
  const dur = Number(item.lengthSeconds || item.duration || 0);
  const isLongFormWanted = /\b(lofi|mix|playlist|live|concert|podcast|mashup|medley|jukebox)\b/.test(normalizedWanted);
  if (dur && (dur < 45 || (!isLongFormWanted && dur > 720) || dur > 7200)) return true;
  if (/\boriginals?\b/i.test(raw) && !normalizedWanted.includes('original')) return true;
  if (BAD_VIDEO_PATTERNS.some((pattern) => pattern.test(raw))) return true;
  if (!normalizedWanted.includes('lofi') && normalizedRaw.includes('lofi')) return true;
  return false;
}

function scoreVideo(item: Record<string, unknown>, artist: string, title: string) {
  const iTitle = normalizeText(String(item.title || ''));
  const iArtist = normalizeText(String(item.author || item.uploaderName || item.uploader || ''));
  const wArtist = normalizeText(artist);
  const wTitle = normalizeText(title);
  const dur = Number(item.lengthSeconds || item.duration || 0);
  const published = Number(item.published || 0);
  const ageDays = published > 0 ? Math.max(0, (Date.now() / 1000 - published) / 86400) : 9999;
  let s = 0;
  if (wTitle && iTitle.includes(wTitle)) s += 12;
  if (wArtist && iTitle.includes(wArtist)) s += 4;
  if (wArtist && iArtist.includes(wArtist)) s += 8;
  s += wTitle.split(' ').filter(w => w.length > 2 && iTitle.includes(w)).length * 1.5;
  ['karaoke','sped up','slowed','reverb','8d audio','nightcore','live','cover','remix','instrumental','jukebox','mashup','playlist','non stop']
    .forEach(t => { if (iTitle.includes(t) && !wTitle.includes(t)) s -= 8; });
  if (dur >= 120 && dur <= 420) s += 5; else if (dur >= 45 && dur <= 720) s += 1; else s -= 4;
  if (ageDays <= 365) s += 3; else if (published > 0) s -= 6;
  if (isBadVideoCandidate(item, artist, title)) s -= 20;
  return s;
}

function extractVideoId(c: unknown) {
  if (typeof c !== 'string') return undefined;
  const d = c.match(/^[a-zA-Z0-9_-]{11}$/);
  if (d) return d[0];
  const w = c.match(/[?&]v=([a-zA-Z0-9_-]{11})/);
  return w?.[1];
}

// ── Match confidence ────────────────────────────────────────────────────────
// Same standard as the JioSaavn matcher: the candidate's title must really be
// the requested title, AND the artist must be evidenced in either the video
// title or the uploading channel. Without this a loose search score could win
// the race and we'd confidently play the wrong recording.
function strongTitleArtistMatch(item: Record<string, unknown>, artist: string, title: string): boolean {
  const iTitle = normalizeText(String(item.title || ''));
  const iArtist = normalizeText(String(item.author || item.uploaderName || item.uploader || ''));
  const wTitle = normalizeText(title);
  const wArtist = normalizeText(artist);
  if (!iTitle || !wTitle) return false;

  const titleHit = iTitle.includes(wTitle) || wTitle.includes(iTitle);
  if (!titleHit) {
    // Allow "title (feat. X)" / "title - topic" style variance, but demand that
    // nearly every meaningful word of the requested title is present.
    const words = wTitle.split(' ').filter((w) => w.length > 2);
    if (!words.length) return false;
    const hits = words.filter((w) => iTitle.includes(w)).length;
    if (hits / words.length < 0.85) return false;
  }

  if (!wArtist) return true;
  const haystack = `${iTitle} ${iArtist}`;
  if (haystack.includes(wArtist)) return true;
  const aWords = wArtist.split(' ').filter((w) => w.length > 2);
  if (!aWords.length) return false;
  return aWords.filter((w) => haystack.includes(w)).length / aWords.length >= 0.6;
}

// ── Search: parallel race across healthy instances ──

/**
 * Mirror-free candidate discovery via YouTube Music's own InnerTube search
 * (WEB_REMIX, songs-only params). Works without an API key and without any
 * third-party instance, so search survives the same outage the resolver does.
 */
async function innerTubeSearchCandidates(artist: string, title: string): Promise<Record<string, unknown>[]> {
  const query = `${artist} ${title}`.trim();
  try {
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), 6000);
    const res = await fetch('https://music.youtube.com/youtubei/v1/search?prettyPrint=false', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
        'Origin': 'https://music.youtube.com',
        'X-YouTube-Client-Name': '67',
        'X-YouTube-Client-Version': '1.20240101.01.00',
      },
      body: JSON.stringify({
        context: { client: { clientName: 'WEB_REMIX', clientVersion: '1.20240101.01.00', hl: 'en', gl: 'US' } },
        query,
        // songs-only search filter (public InnerTube param)
        params: 'EgWKAQIIAWoKEAoQCRADEAQQBQ%3D%3D',
      }),
      signal: ctrl.signal,
    });
    clearTimeout(t);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const raw = await res.text();
    const out: Record<string, unknown>[] = [];
    const seen = new Set<string>();
    // musicResponsiveListItemRenderer blobs are deeply nested and versioned;
    // pull ids in document order (relevance order) and score them by the
    // surrounding text window rather than walking a fragile renderer tree.
    for (const m of raw.matchAll(/"videoId":"([\w-]{11})"/g)) {
      const vid = m[1];
      if (seen.has(vid)) continue;
      seen.add(vid);
      const window = raw.slice(Math.max(0, (m.index ?? 0) - 4000), (m.index ?? 0) + 2000);
      const texts = [...window.matchAll(/"text":"((?:[^"\\]|\\.){2,120})"/g)].map((x) => x[1]);
      const itemTitle = texts.find((s) => !/^\s*[•·]\s*$/.test(s)) || '';
      out.push({ videoId: vid, title: itemTitle, author: texts.slice(1, 4).join(' '), _source: 'innertube-music' });
      if (out.length >= 6) break;
    }
    return out;
  } catch (e) {
    console.warn('[search] innertube music search failed:', (e as Error).message);
    return [];
  }
}

async function searchForCandidates(artist: string, title: string): Promise<Record<string, unknown>[]> {
  const query = `${artist} ${title} audio`;
  const candidates: Record<string, unknown>[] = [];
  const seen = new Set<string>();

  const addCandidate = (item: Record<string, unknown>) => {
    const vid = String(item.videoId || '');
    if (!vid || seen.has(vid)) return;
    seen.add(vid);
    candidates.push(item);
  };

  // Mirror-free source first: YouTube Music InnerTube songs search.
  for (const item of await innerTubeSearchCandidates(artist, title)) {
    if (!strongTitleArtistMatch(item, artist, title)) continue;
    if (isBadVideoCandidate(item, artist, title)) continue;
    addCandidate(item);
  }
  if (candidates.length >= 3) return candidates.slice(0, 8);

  // Try Piped first (generally more reliable). Do not globally skip recently
  // failed instances here — one region/video failure should not limit playback.
  const pipedInstances = getPipedInstances().slice(0, 8);

  const pipedResults = await Promise.allSettled(
    pipedInstances.map(async (inst) => {
      try {
        const data = await fetchJson(`${inst}/search?q=${encodeURIComponent(query)}&filter=videos`, 6000);
        const items = Array.isArray(data) ? data : Array.isArray(data?.items) ? data.items : [];
        return items.map((item: any) => ({
          ...item,
          videoId: item.videoId || extractVideoId(item.url),
          _source: inst,
        }));
      } catch (e) {
        markFailed(inst);
        throw e;
      }
    })
  );

  for (const r of pipedResults) {
    if (r.status === 'fulfilled' && Array.isArray(r.value)) {
      const ranked = r.value
        .map((item: any) => ({ item, score: scoreVideo({ title: item.title, author: item.uploaderName || item.uploader, lengthSeconds: item.duration || item.lengthSeconds }, artist, title) }))
        .filter((e: any) => {
          const shaped = { title: e.item.title, author: e.item.uploaderName || e.item.uploader, lengthSeconds: e.item.duration || e.item.lengthSeconds };
          return e.item.videoId && e.score > -8
            && strongTitleArtistMatch(shaped, artist, title)
            && !isBadVideoCandidate(shaped, artist, title);
        })
        .sort((a: any, b: any) => b.score - a.score)
        .slice(0, 4);
      ranked.forEach((e: any) => addCandidate(e.item));
    }
  }

  if (candidates.length >= 4) return candidates.slice(0, 8);

  // Fallback to YouTube Data API (most reliable search)
  if (YOUTUBE_API_KEYS.length > 0) {
    for (const key of YOUTUBE_API_KEYS) {
      try {
        const ytUrl = `https://www.googleapis.com/youtube/v3/search?part=snippet&q=${encodeURIComponent(query)}&type=video&videoCategoryId=10&maxResults=6&key=${key}`;
        const ytData = await fetchJson(ytUrl, 6000);
        const ytItems = Array.isArray(ytData?.items) ? ytData.items : [];
        for (const item of ytItems) {
          const vid = item?.id?.videoId;
          const candidate = {
            videoId: vid,
            title: item?.snippet?.title || '',
            author: item?.snippet?.channelTitle || '',
            published: item?.snippet?.publishedAt ? Math.floor(new Date(item.snippet.publishedAt).getTime() / 1000) : 0,
            _source: 'youtube-api',
          };
          if (vid && scoreVideo(candidate, artist, title) > -8 && strongTitleArtistMatch(candidate, artist, title) && !isBadVideoCandidate(candidate, artist, title)) {
            addCandidate({
              videoId: vid,
              title: item?.snippet?.title || '',
              author: item?.snippet?.channelTitle || '',
              published: item?.snippet?.publishedAt ? Math.floor(new Date(item.snippet.publishedAt).getTime() / 1000) : 0,
              _source: 'youtube-api',
            });
          }
        }
        console.log(`[search] YouTube API returned ${ytItems.length} results`);
        if (ytItems.length > 0) break; // Success — no need to burn second key
      } catch (e) {
        console.warn(`[search] YouTube API key failed, trying next:`, (e as Error).message);
      }
    }
  }

  if (candidates.length >= 4) return candidates.slice(0, 8);

  // Last resort: Invidious
  const invInstances = getInvidiousInstances().slice(0, 5);
  const invResults = await Promise.allSettled(
    invInstances.map(async (inst) => {
      try {
        const data = await fetchJson(`${inst}/api/v1/search?q=${encodeURIComponent(query)}&type=video&sort_by=relevance`, 6000);
        return Array.isArray(data) ? data.map((item: any) => ({ ...item, _source: inst })) : [];
      } catch (e) { markFailed(inst); throw e; }
    })
  );

  for (const r of invResults) {
    if (r.status === 'fulfilled' && Array.isArray(r.value)) {
      const ranked = r.value
        .map((item: any) => ({ item, score: scoreVideo(item, artist, title) }))
        .filter((e: any) => e.item.videoId && e.score > -8 && strongTitleArtistMatch(e.item, artist, title) && !isBadVideoCandidate(e.item, artist, title))
        .sort((a: any, b: any) => b.score - a.score)
        .slice(0, 4);
      ranked.forEach((e: any) => addCandidate(e.item));
    }
  }

  return candidates.slice(0, 8);
}

// ── Stream resolution: parallel race per candidate ──

function normalizeUrl(candidate: string | undefined, origin: string) {
  if (!candidate) return undefined;
  if (candidate.startsWith('//')) return `https:${candidate}`;
  if (candidate.startsWith('/')) return `${origin}${candidate}`;
  return candidate;
}

function isCorsCompatible(url: string) {
  // Piped proxy URLs have CORS; raw googlevideo.com does NOT
  if (!url) return false;
  if (url.includes('googlevideo.com') && !url.includes('proxy.')) return false;
  return true;
}

function isAllowedAudioProxyUrl(value: string) {
  try {
    const parsed = new URL(value);
    if (!['http:', 'https:'].includes(parsed.protocol)) return false;
    return hostnameMatchesAllowedSuffix(parsed.hostname);
  } catch {
    return false;
  }
}

function isVolatileMirrorStream(url?: string | null) {
  if (!url) return false;
  return url.includes('/latest_version')
    || url.includes('/videoplayback')
    || url.includes('proxy.piped.')
    || url.includes('googlevideo.com');
}

async function fetchAllowedAudioProxyTarget(audioTarget: string, req: Request, range: string | null, redirects = 0): Promise<Response> {
  if (!isAllowedAudioProxyUrl(audioTarget)) throw new Error('Invalid audio source');
  const upstream = await fetch(audioTarget, {
    method: req.method,
    headers: {
      ...(range ? { range } : {}),
      'user-agent': 'Mozilla/5.0 (UniversFlow Audio Proxy)',
      accept: '*/*',
    },
    redirect: 'manual',
  });

  if (upstream.status >= 300 && upstream.status < 400) {
    // Signed music CDN URLs (googlevideo, JioSaavn) can legitimately bounce
    // through several validated hosts before reaching the final byte-serving
    // URL. A cap of 2 was too tight and turned valid streams into 500s.
    if (redirects >= 8) throw new Error('Too many redirects');
    const location = upstream.headers.get('location');
    if (!location) throw new Error('Redirect missing Location');
    const next = new URL(location, audioTarget).toString();
    return fetchAllowedAudioProxyTarget(next, req, range, redirects + 1);
  }

  return upstream;
}

function pickBestStream(data: Record<string, any>, instance: string) {
  const adaptive = Array.isArray(data.adaptiveFormats) ? data.adaptiveFormats : [];
  const audio = adaptive
    .filter((f: any) => f.type?.startsWith('audio/'))
    .sort((a: any, b: any) => {
      const am = a.type?.includes('mp4') || a.container === 'm4a' ? 1 : 0;
      const bm = b.type?.includes('mp4') || b.container === 'm4a' ? 1 : 0;
      if (am !== bm) return bm - am;
      return (b.bitrate || 0) - (a.bitrate || 0);
    });
  const chosen = audio[0] || (Array.isArray(data.formatStreams) ? data.formatStreams[0] : null);
  if (!chosen) return undefined;
  // Use Invidious's local proxy (/latest_version?local=true) — bypasses IP-bound googlevideo signing.
  const itag = chosen?.itag;
  const videoId = data?.videoId;
  if (itag && videoId) {
    return `${instance.replace(/\/$/, '')}/latest_version?id=${encodeURIComponent(String(videoId))}&itag=${encodeURIComponent(String(itag))}&local=true`;
  }
  return normalizeUrl(chosen?.url, instance);
}

async function probePlayableStream(url: string, timeoutMs = 4000) {
  if (isKnownBrokenStreamUrl(url)) return false;
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(url, {
      method: 'GET',
      signal: controller.signal,
      headers: { range: 'bytes=0-1', 'user-agent': 'Mozilla/5.0', accept: '*/*' },
    });
    const contentType = response.headers.get('content-type')?.toLowerCase() || '';
    if (!response.ok && response.status !== 206) {
      await response.body?.cancel().catch(() => undefined);
      return false;
    }
    if (contentType.includes('text/html') || contentType.includes('application/json')) {
      await response.body?.cancel().catch(() => undefined);
      return false;
    }
    await response.body?.cancel().catch(() => undefined);
    return true;
  } catch {
    return false;
  } finally {
    clearTimeout(timeout);
  }
}

async function pickBestPipedStream(data: Record<string, any>, instance: string) {
  const streams = Array.isArray(data.audioStreams) ? data.audioStreams : [];
  const ranked = streams
    .filter((s: any) => typeof s?.url === 'string')
    .sort((a: any, b: any) => {
      const am = a.mimeType?.includes('mp4') || a.format === 'm4a' ? 1 : 0;
      const bm = b.mimeType?.includes('mp4') || b.format === 'm4a' ? 1 : 0;
      if (am !== bm) return bm - am;
      return (b.bitrate || 0) - (a.bitrate || 0);
    });
  // Try each candidate: prefer proxyUrl, then url. Probe each before returning.
  for (const stream of ranked) {
    const candidates = [
      normalizeUrl(stream?.proxyUrl, instance),
      normalizeUrl(stream?.url, instance),
    ].filter(Boolean) as string[];
    for (const url of candidates) {
      if (await probePlayableStream(url)) return url;
    }
  }
  return undefined;
}

// Cobalt API — extracts direct audio URL from a YouTube videoId.
// Public Cobalt hosts churn; discover live ones from instances.cobalt.tools.
let cobaltEndpoints: string[] = [];
let cobaltFetchedAt = 0;
async function getCobaltEndpoints(): Promise<string[]> {
  if (Date.now() - cobaltFetchedAt < 30 * 60 * 1000 && cobaltEndpoints.length) return cobaltEndpoints;
  cobaltFetchedAt = Date.now();
  const seeds = ['https://cobalt.tools/api/json', 'https://api.cobalt.tools/api/json'];
  try {
    const data = await fetchJson('https://instances.cobalt.tools/instances.json', 4000);
    if (Array.isArray(data)) {
      const discovered = data
        .filter((d: any) => d?.api && (d.score ?? 100) >= 90)
        .map((d: any) => `https://${String(d.api).replace(/^https?:\/\//, '').replace(/\/$/, '')}/api/json`);
      cobaltEndpoints = [...new Set([...discovered, ...seeds])];
      return cobaltEndpoints;
    }
  } catch { /* fall through */ }
  cobaltEndpoints = seeds;
  return cobaltEndpoints;
}

async function resolveViaCobalt(videoId: string): Promise<{ streamUrl: string } | null> {
  const endpoints = await getCobaltEndpoints();

  const body = JSON.stringify({
    url: `https://www.youtube.com/watch?v=${videoId}`,
    isAudioOnly: true,
    aFormat: 'mp3',
    isNoTTWatermark: true,
  });
  for (const ep of endpoints.slice(0, 5)) {
    try {
      const ctrl = new AbortController();
      const t = setTimeout(() => ctrl.abort(), 8000);
      const res = await fetch(ep, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Accept': 'application/json' },
        body,
        signal: ctrl.signal,
      });
      clearTimeout(t);
      if (!res.ok) continue;
      const data = await res.json().catch(() => null) as any;
      const url = data?.url;
      if (typeof url === 'string' && /^https?:\/\//.test(url) && isAllowedAudioProxyUrl(url)) {
        console.log(`[resolve] ✓ ${videoId} via cobalt (${ep})`);
        return { streamUrl: url };
      }
    } catch (e) {
      console.warn(`[resolve] cobalt ${ep} failed for ${videoId}:`, (e as Error).message);
    }
  }
  return null;
}

// ── Direct InnerTube (no API key, no third-party mirror) ─────────────────────
// Re-tested 2026-08: the old note here claimed every client is bot-blocked from
// edge IPs. That was only half true. ANDROID_VR / ANDROID_MUSIC / ANDROID_CREATOR
// do return LOGIN_REQUIRED, but the IOS client (client id 5) still returns
// playable `adaptiveFormats` with plain `url=` values. The earlier verdict came
// from probing those URLs with a bare GET/HEAD, which googlevideo answers with
// 403 — they only serve with a Range header. With `range: bytes=0-1` the exact
// same URLs return 206 audio/mp4.
//
// The signed URL is issued against the requester (edge) IP, so we hand the
// client a stream-proxy URL rather than the raw googlevideo URL: the proxy
// fetches from the same edge network and also adds CORS + Range semantics.
const INNERTUBE_PLAYER = 'https://www.youtube.com/youtubei/v1/player?prettyPrint=false';

type ItClient = { name: string; id: string; version: string; ua: string; client: Record<string, unknown> };

// Re-probed 2026-08-19 against the exact videoIds from the LOGIN_REQUIRED
// alerts: IOS (client 5) answers `OK` with plain-url adaptiveFormats that probe
// 206 with a Range header, while IOS_MUSIC (26), IOS_UNPLUGGED (33),
// ANDROID_MUSIC (21), ANDROID_VR (28), TVHTML5*, WEB* and MWEB all return
// LOGIN_REQUIRED / UNPLAYABLE / ERROR for every single one. Keeping those in the
// race meant three failures and one real chance; worse, `Promise.any` had to wait
// on them. IOS is now the only family we ask, tried both with and without the
// visitor token (see below), plus IOS_MUSIC last purely as a free extra shot.
const IT_CLIENTS: ItClient[] = [
  {
    name: 'IOS', id: '5', version: '21.03.2',
    ua: 'com.google.ios.youtube/21.03.2 (iPhone16,2; U; CPU iOS 18_7_2 like Mac OS X)',
    client: {
      clientName: 'IOS', clientVersion: '21.03.2', deviceMake: 'Apple',
      deviceModel: 'iPhone16,2', osName: 'iPhone', osVersion: '18.7.2.22H124', hl: 'en', gl: 'US',
    },
  },
  {
    name: 'IOS_MUSIC', id: '26', version: '8.28.2',
    ua: 'com.google.ios.youtubemusic/8.28.2 (iPhone16,2; U; CPU iOS 18_7_2 like Mac OS X)',
    client: {
      clientName: 'IOS_MUSIC', clientVersion: '8.28.2', deviceMake: 'Apple',
      deviceModel: 'iPhone16,2', osName: 'iPhone', osVersion: '18.7.2.22H124', hl: 'en', gl: 'US',
    },
  },
];

let itVisitorData: string | null = null;
let itVisitorAt = 0;

/**
 * The old regex took the FIRST >=40-char token in sw.js_data, which is not
 * necessarily visitorData — any unrelated blob matched, and sending a bogus
 * visitorData makes YouTube answer LOGIN_REQUIRED for *every* client, which is
 * exactly the failure signature in the alerts. Real visitor tokens are
 * protobuf-base64 starting with `Cg`; anything else is discarded and we send no
 * token at all (which resolves fine anonymously).
 */
function isPlausibleVisitorData(v: string): boolean {
  return v.startsWith('Cg') && v.length >= 40 && v.length <= 1024;
}

async function getVisitorData(): Promise<string | null> {
  if (itVisitorData && Date.now() - itVisitorAt < 6 * 60 * 60 * 1000) return itVisitorData;
  try {
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), 4000);
    const res = await fetch('https://www.youtube.com/sw.js_data', {
      headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36' },
      signal: ctrl.signal,
    });
    clearTimeout(t);
    const body = await res.text();
    const candidate = (body.match(/"(Cg[A-Za-z0-9_%\-]{38,})"/) || [])[1];
    if (candidate && isPlausibleVisitorData(candidate)) {
      itVisitorData = candidate;
      itVisitorAt = Date.now();
    } else {
      itVisitorData = null;
    }
  } catch { /* visitorData is optional */ }
  return itVisitorData;
}

function proxiedStreamUrl(raw: string): string {
  const base = (Deno.env.get('SUPABASE_URL') || '').replace(/\/$/, '');
  if (!base) return raw;
  return `${base}/functions/v1/stream-proxy?u=${encodeURIComponent(raw)}`;
}

/**
 * Format selection, ported from NewPipeExtractor's audio-stream handling
 * (ItagItem tiers + DRC rejection) rather than "highest bitrate wins":
 *
 *  - Reject `isDrc` / `drc=1` formats. YouTube ships loudness-compressed
 *    duplicates of the same itag; NewPipe drops them because they sound
 *    audibly squashed and their bitrate makes them win a naive score.
 *  - Prefer AAC (mp4a, itag 140/141/139) over Opus/WebM. NewPipe can pick
 *    either because ExoPlayer decodes both; a *browser* cannot — Safari/iOS
 *    has no Opus-in-WebM decoder, so an opus win means silent playback for
 *    every iPhone visitor. This was ranking webm ABOVE m4a before.
 *  - Keep the original-language guard (never a dubbed audioTrack).
 *  - Flag `n`-param URLs: those are throttle-signed and need player.js
 *    deciphering (NewPipe's throttling decrypter). We cannot decipher in the
 *    edge runtime, so we only log it — the playability probe is what actually
 *    rejects a crawling stream.
 */
const ITAG_RANK: Record<number, number> = {
  141: 100, // AAC 256k
  140: 90,  // AAC 128k  ← the workhorse, universally decodable
  139: 60,  // AAC 48k
  251: 55,  // Opus ~160k
  250: 45,
  249: 40,
};

function pickInnerTubeAudio(streamingData: Record<string, any> | undefined): { url: string; itag: number } | null {
  const lists = [streamingData?.adaptiveFormats, streamingData?.formats].filter(Array.isArray) as any[][];
  let best: { url: string; itag: number } | null = null;
  let bestScore = -1;
  for (const list of lists) {
    for (const f of list) {
      const url = typeof f?.url === 'string' ? f.url : '';
      if (!url) continue;                        // ciphered formats need player.js; skip
      const mime = String(f?.mimeType || '');
      const isAudio = mime.startsWith('audio/');
      const track = f?.audioTrack;
      const isOriginal = !track || track?.audioIsDefault === true || String(track?.id || '').includes('.original');
      if (!isOriginal) continue;                 // never hand back a dubbed track
      if (f?.isDrc === true || /[?&]drc=1/.test(url)) continue; // NewPipe: drop DRC dupes
      const itag = Number(f?.itag || 0);
      const codecPref = /mp4a/i.test(mime) ? 60_000 : /opus/i.test(mime) ? 10_000 : 0;
      const score =
        (isAudio ? 1_000_000 : 0) +
        (ITAG_RANK[itag] ?? 0) * 1_000 +
        codecPref +
        Math.min(Number(f?.bitrate || 0) / 1000, 500);
      if (score > bestScore) { best = { url, itag }; bestScore = score; }
    }
    if (best) break;                             // prefer adaptive over muxed
  }
  if (best && /[?&]n=/.test(best.url)) {
    console.warn(`[resolve] itag=${best.itag} carries an n= throttle param; probe will decide`);
  }
  return best;
}


async function innerTubeAttempt(videoId: string, c: ItClient, visitor: string | null) {
  const client = visitor ? { ...c.client, visitorData: visitor } : c.client;
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), 5000);
  try {
    const res = await fetch(INNERTUBE_PLAYER, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'User-Agent': c.ua,
        'Origin': 'https://www.youtube.com',
        'X-YouTube-Client-Name': c.id,
        'X-YouTube-Client-Version': c.version,
        ...(visitor ? { 'X-Goog-Visitor-Id': visitor } : {}),
      },
      body: JSON.stringify({
        context: { client },
        videoId,
        contentCheckOk: true,
        racyCheckOk: true,
        playbackContext: { contentPlaybackContext: { html5Preference: 'HTML5_PREF_WANTS' } },
      }),
      signal: ctrl.signal,
    });
    if (!res.ok) throw new Error(`innertube ${c.name}: HTTP ${res.status}`);
    const data = await res.json() as Record<string, any>;
    const status = data?.playabilityStatus?.status;
    if (status && status !== 'OK') throw new Error(`innertube ${c.name}: ${status}`);
    const picked = pickInnerTubeAudio(data?.streamingData);
    if (!picked) throw new Error(`innertube ${c.name}: no plain-url audio (sabr=${Boolean(data?.streamingData?.serverAbrStreamingUrl)})`);
    if (!isAllowedAudioProxyUrl(picked.url)) throw new Error(`innertube ${c.name}: host not allowed`);
    // googlevideo 403s bare requests — probe exactly how the player will read it.
    if (!(await probePlayableStream(picked.url, 5000))) throw new Error(`innertube ${c.name}: url not playable`);
    const seconds = Number(data?.videoDetails?.lengthSeconds || 0) || undefined;
    return {
      streamUrl: proxiedStreamUrl(picked.url),
      duration: seconds,
      src: `innertube:${c.name}`,
      itag: picked.itag,
    };
  } finally {
    clearTimeout(t);
  }
}

// ── InnerTube egress circuit breaker ───────────────────────────────────────
// Verified 2026-08-27: the exact same payload/clientVersion resolves `OK` with
// plain-url adaptiveFormats from a residential address, and LOGIN_REQUIRED from
// this backend's address — i.e. Google is refusing our datacentre egress, not
// rejecting our request shape. Retrying cannot fix an IP block, but each attempt
// still costs the full timeout on every tap, which is what users experience as
// "it spins for 15-30s and never plays".
//
// So: after IT_FAIL_THRESHOLD consecutive whole-client failures we park the
// InnerTube path for IT_PARK_MS and fail instantly, leaving the budget to
// JioSaavn / db-cache / mirrors. It self-heals — one success (or the park
// expiring) puts it straight back in rotation, so if egress is ever unblocked
// (or a residential proxy is added) nothing needs re-enabling.
//
// On-device InnerTube in the Android app is unaffected: it runs on the user's
// own residential IP and remains the real YouTube path.
const IT_FAIL_THRESHOLD = 3;
const IT_PARK_MS = 10 * 60 * 1000;
let itFailStreak = 0;
let itParkedUntil = 0;

/** Primary YouTube path: direct InnerTube /player, no mirror, no API key. */
async function resolveViaInnerTube(videoId: string): Promise<{ streamUrl: string; duration?: number; src: string } | null> {
  if (!/^[\w-]{11}$/.test(videoId)) return null;
  if (Date.now() < itParkedUntil) return null;

  const visitor = await getVisitorData();
  // A stale/bogus visitor token poisons every client at once (LOGIN_REQUIRED),
  // while anonymous requests resolve fine — so each client is raced BOTH with
  // and without the token instead of betting the whole request on it.
  const attempts = IT_CLIENTS.flatMap((c) =>
    visitor
      ? [innerTubeAttempt(videoId, c, visitor), innerTubeAttempt(videoId, c, null)]
      : [innerTubeAttempt(videoId, c, null)],
  );
  try {
    const winner = await Promise.any(attempts);
    itFailStreak = 0;
    console.log(`[resolve] ✓ ${videoId} via ${winner.src} itag=${winner.itag}`);
    return { streamUrl: winner.streamUrl, duration: winner.duration, src: winner.src };
  } catch (e) {
    const msgs = (e as AggregateError)?.errors?.map((err: Error) => err.message)?.join(' | ');
    // If every attempt says LOGIN_REQUIRED the cached visitor token is suspect;
    // drop it so the next request re-scrapes instead of repeating the failure.
    if (msgs?.includes('LOGIN_REQUIRED')) { itVisitorData = null; itVisitorAt = 0; }
    itFailStreak += 1;
    if (itFailStreak >= IT_FAIL_THRESHOLD) {
      itParkedUntil = Date.now() + IT_PARK_MS;
      itFailStreak = 0;
      console.warn(
        `[resolve] innertube breaker OPEN for ${IT_PARK_MS / 60000}min — ` +
        'egress appears blocked by YouTube; serving JioSaavn/cache/mirrors only',
      );
    }
    console.warn(`[resolve] innertube failed for ${videoId}: ${msgs}`);
    return null;
  }
}


// ── Mirror-fleet circuit breaker ───────────────────────────────────────────
// While the public Invidious/Piped/Cobalt fleet is down it costs ~4s on EVERY
// tap before we give up. After 3 consecutive whole-fleet failures we park the
// fleet for 5 minutes so failures are instant and JioSaavn/InnerTube keep their
// full budget. Any success resets the counter.
let fleetFailStreak = 0;
let fleetParkedUntil = 0;
const FLEET_PARK_MS = 5 * 60 * 1000;

/** Metadata for a bare videoId — oembed is public and is NOT IP-walled. */
async function videoMeta(videoId: string): Promise<{ title: string; artist: string } | null> {
  try {
    const data = await fetchJson(
      `https://www.youtube.com/oembed?url=${encodeURIComponent(`https://www.youtube.com/watch?v=${videoId}`)}&format=json`,
      4000,
    ) as any;
    const rawTitle = String(data?.title || '').trim();
    const artist = String(data?.author_name || '').replace(/\s*-\s*Topic$/i, '').trim();
    if (!rawTitle) return null;
    // "Artist - Title (Official Video)" → "Title"
    const title = rawTitle
      .replace(/\s*[([][^)\]]*(official|video|audio|lyrics?|hd|4k|visualizer)[^)\]]*[)\]]/gi, '')
      .replace(/^.*?\s[-–—]\s/, '')
      .trim() || rawTitle;
    return { title, artist };
  } catch {
    return null;
  }
}

async function resolveVideoId(
  videoId: string,
  meta?: { title?: string; artist?: string },
): Promise<{ streamUrl: string; duration?: number } | null> {
  const t0 = Date.now();

  // 1) JioSaavn first — a source that does not block our egress IP. The bare
  //    videoId path used to skip this entirely and go straight to YouTube, which
  //    is exactly why a YouTube-side block killed playback outright.
  const known = meta?.title ? { title: meta.title, artist: meta.artist || '' } : await videoMeta(videoId);
  if (known?.title) {
    const saavn = await resolveViaSaavn(known.artist, known.title);
    if (saavn?.streamUrl) return { streamUrl: saavn.streamUrl, duration: saavn.duration };
  }

  // 2) Direct InnerTube — no third-party dependency. Only fall through to the
  //    public mirror fleet when YouTube itself refuses us.
  const direct = await resolveViaInnerTube(videoId);
  if (direct?.streamUrl) return { streamUrl: direct.streamUrl, duration: direct.duration };

  if (Date.now() < fleetParkedUntil) {
    console.warn(`[resolve] mirror fleet parked (breaker open) — skipping for ${videoId}`);
    return null;
  }

  // Skip the pre-flight /stats & /healthcheck probes — they blocked ALL
  // instances when their status endpoints were rate-limited even though
  // /api/v1/videos still worked. Instead, race the actual resolve calls
  // across every instance not in the short-lived failedUntil cache and let
  // the fastest real response win. Cobalt joins the same race so we don't
  // pay a serial fallback wait.
  const invPool = getInvidiousInstances().filter(isHealthy).slice(0, 12);
  const pipedPool = getPipedInstances().filter(isHealthy).slice(0, 12);

  const attempts: Promise<{ streamUrl: string; duration?: number; src: string }>[] = [
    ...invPool.map(async (inst) => {
      try {
        const data = await fetchJson(`${inst}/api/v1/videos/${videoId}`, 4000);
        const url = pickBestStream(data, inst);
        if (!url) throw new Error('no audio stream');
        // Verify the URL is actually playable — otherwise a dead/expired/HTML
        // redirect URL can win Promise.any and get cached for 45 minutes.
        if (!(await probePlayableStream(url))) throw new Error('invidious url not playable');
        return { streamUrl: url, duration: Number(data.lengthSeconds || 0) || undefined, src: inst };
      } catch (e) { markFailed(inst); throw e; }
    }),
    ...pipedPool.map(async (inst) => {
      try {
        const data = await fetchJson(`${inst}/streams/${videoId}`, 4000);
        const url = await pickBestPipedStream(data, inst);
        if (!url) throw new Error('no audio stream');
        return { streamUrl: url, duration: Number(data.duration || 0) || undefined, src: inst };
      } catch (e) { markFailed(inst); throw e; }
    }),
    // Cobalt in parallel — no more serial 5s wait after pool fails.
    (async () => {
      const c = await resolveViaCobalt(videoId);
      if (!c?.streamUrl) throw new Error('cobalt: no url');
      if (!(await probePlayableStream(c.streamUrl, 5000))) throw new Error('cobalt url not playable');
      return { streamUrl: c.streamUrl, src: 'cobalt' };
    })(),
  ];

  try {
    const winner = await Promise.any(attempts);
    fleetFailStreak = 0;
    console.log(`[resolve] ✓ ${videoId} via ${winner.src} (${Date.now() - t0}ms, tried=${attempts.length})`);
    return { streamUrl: winner.streamUrl, duration: winner.duration };
  } catch (e) {
    const msgs = (e as AggregateError)?.errors?.map((err: Error) => err.message)?.slice(0, 3).join(', ');
    fleetFailStreak += 1;
    if (fleetFailStreak >= 3) {
      fleetParkedUntil = Date.now() + FLEET_PARK_MS;
      fleetFailStreak = 0;
      console.warn(`[resolve] mirror fleet breaker OPEN for ${FLEET_PARK_MS / 60000}min`);
    }
    console.warn(`[resolve] mirror fleet failed for ${videoId} in ${Date.now() - t0}ms: ${msgs}`);
    return null;
  }
}



// ── JioSaavn direct resolve (a source we control) ──
// Every YouTube-derived source (Invidious / Piped / Cobalt) is a free public
// mirror; when that fleet degrades (403/502/CAPTCHA walls) playback died for
// every track. JioSaavn serves CORS-clean CDN audio from our own worker, so we
// try it first and only fall back to the mirror race when it cannot match.
const SAAVN_API = 'https://jiosaavn-api.universflow.workers.dev';

const saavnClean = (v = '') =>
  v.replace(/&amp;/g, '&').replace(/&quot;/g, '"').replace(/&#039;/g, "'")
    .toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();

function saavnArtists(song: any): string {
  const primary = song?.artists?.primary;
  if (Array.isArray(primary) && primary.length) {
    return primary.map((a: any) => a?.name).filter(Boolean).join(', ');
  }
  if (typeof song?.primaryArtists === 'string') return song.primaryArtists;
  return song?.artist || '';
}

function saavnAudio(song: any): string | undefined {
  const dl = song?.downloadUrl;
  if (typeof dl === 'string') return dl;
  if (Array.isArray(dl)) {
    const hi = dl.find((u: any) => u?.quality === '320kbps')
      || dl.find((u: any) => u?.quality === '160kbps')
      || dl[dl.length - 1];
    return hi?.url || hi?.link;
  }
  return undefined;
}

function saavnImage(song: any): string | undefined {
  const img = song?.image;
  if (typeof img === 'string') return img;
  if (Array.isArray(img)) {
    const last = img[img.length - 1];
    return last?.url || last?.link;
  }
  return undefined;
}

/** Title must match; artist must overlap unless the title is an exact hit. */
function saavnConfident(song: any, title: string, artist: string): boolean {
  const st = saavnClean(song?.name || song?.title || '');
  const sa = saavnClean(saavnArtists(song));
  const wt = saavnClean(title);
  const wa = saavnClean(artist);
  if (!st || !wt) return false;
  const titleExact = st === wt;
  const titleLoose = titleExact || st.includes(wt) || wt.includes(st);
  if (!titleLoose) return false;
  if (!wa || !sa) return titleLoose;
  const artistOverlap = sa.includes(wa) || wa.includes(sa)
    || wa.split(' ').some((tok) => tok.length > 2 && sa.includes(tok));
  return artistOverlap || titleExact;
}

async function resolveViaSaavn(
  artist: string,
  title: string,
): Promise<{ streamUrl: string; duration?: number; cover_url?: string } | null> {
  const query = [title, artist].filter(Boolean).join(' ').trim();
  if (query.length < 2) return null;
  try {
    const data = await fetchJson(
      `${SAAVN_API}/api/search/songs?query=${encodeURIComponent(query)}&limit=8`,
      5000,
    ) as any;
    const results: any[] = Array.isArray(data?.data?.results) ? data.data.results : [];
    for (const song of results) {
      if (!saavnConfident(song, title, artist)) continue;
      const url = saavnAudio(song);
      if (!url || !isAllowedAudioProxyUrl(url)) continue;
      const duration = Number(song?.duration) || undefined;
      console.log(`[resolve] ✓ ${artist} - ${title} via jiosaavn (${song?.id})`);
      return { streamUrl: url, duration, cover_url: saavnImage(song) };
    }
  } catch (e) {
    console.warn('[resolve] jiosaavn failed:', (e as Error).message);
  }
  return null;
}

async function resolveStream(artist: string, title: string, forceRefresh = false): Promise<ResolveResult> {
  const ck = `resolve:${artist}:${title}`;
  const cached = getCached<ResolveResult>(ck);
  if (!forceRefresh && cached && !isKnownBrokenStreamUrl(cached.streamUrl)) return cached;

  // ── Persistent DB cache (survives cold starts; shared across users) ──
  const dbCached = forceRefresh ? null : await getDbCachedStream(artist, title);
  if (dbCached?.streamUrl) {
    const result: ResolveResult = {
      success: true,
      streamUrl: dbCached.streamUrl,
      videoId: dbCached.videoId,
      duration: dbCached.duration,
      title, artist,
      cover_url: dbCached.cover_url,
    };
    setCached(ck, result, 30 * 60 * 1000);
    return result;
  }

  // ── Source we control, tried first ──
  const saavn = await resolveViaSaavn(artist, title);
  if (saavn?.streamUrl) {
    const result: ResolveResult = {
      success: true,
      streamUrl: saavn.streamUrl,
      duration: saavn.duration,
      title, artist,
      cover_url: saavn.cover_url,
    };
    setCached(ck, result, 45 * 60 * 1000);
    void writeDbCachedStream(artist, title, {
      streamUrl: result.streamUrl!,
      duration: result.duration,
      cover_url: result.cover_url,
    });
    return result;
  }

  await refreshInstances();

  console.log(`[resolve] searching for: ${artist} - ${title}`);
  const candidates = await searchForCandidates(artist, title);
  console.log(`[resolve] found ${candidates.length} candidates: ${candidates.map(c => c.videoId).join(', ')}`);

  if (!candidates.length) {
    return { success: false, error: 'Could not find a playable stream for this track', fallback: true };
  }

  const shortlist = candidates.slice(0, 4).map((c) => String(c.videoId));
  const firstVideoId: string | null = shortlist[0] || null;

  // Race the top candidates in parallel — one bad videoId no longer stalls
  // the whole resolve for 4-8s before moving on.
  const races = shortlist.map(async (videoId) => {
    console.log(`[resolve] trying videoId: ${videoId}`);
    const r = await resolveVideoId(videoId);
    if (!r) throw new Error(`vid ${videoId} failed`);
    return { videoId, ...r };
  });

  try {
    const winner = await Promise.any(races);
    const cover_url = await resolveArtwork(artist, title);
    const cand = candidates.find((c) => String(c.videoId) === winner.videoId);
    const result: ResolveResult = {
      success: true,
      streamUrl: winner.streamUrl,
      videoId: winner.videoId,
      duration: winner.duration || Number(cand?.lengthSeconds || cand?.duration || 0) || undefined,
      title, artist, cover_url,
    };
    setCached(ck, result, 45 * 60 * 1000);
    void writeDbCachedStream(artist, title, {
      streamUrl: result.streamUrl!,
      videoId: result.videoId,
      duration: result.duration,
      cover_url: result.cover_url,
    });
    return result;
  } catch { /* fall through to iframe fallback */ }

  // ── MONITORING SIGNAL ──────────────────────────────────────────────────────
  // Every source is exhausted here: JioSaavn matcher, direct InnerTube, and the
  // Invidious/Piped/Cobalt mirror fleet. This single grep-able line is the alert
  // we watch for; if it starts appearing at volume, playback is broken app-wide
  // and we know before a user reports it.
  console.error(
    `[resolve][ALERT] ALL_SOURCES_FAILED artist="${artist}" title="${title}" ` +
    `candidates=${candidates.length} tried=${shortlist.join(',')} ` +
    `sources=jiosaavn,innertube${Date.now() < itParkedUntil ? '(parked)' : ''},mirrors ` +
    `at=${new Date().toISOString()}`,
  );

  // YouTube IFrame fallback — guaranteed playback even when no audio host is reachable

  if (firstVideoId) {
    const fallback: ResolveResult = {
      success: true,
      streamUrl: `yt-video:${firstVideoId}`,
      videoId: firstVideoId,
      title, artist,
      cover_url: await resolveArtwork(artist, title),
      fallback: true,
    };
    // Do NOT cache iframe fallbacks. They are not real audio streams, so a
    // single mirror outage used to poison memory/DB cache for 30+ minutes and
    // Premium EQ could never retry extraction into the WebAudio path.
    return fallback;
  }

  return {
    success: false,
    error: 'This track is temporarily unavailable — tap play again to retry',
    fallback: true,
    retryable: true,
  };
}

// ── HTTP handler ──

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  try {
    const requestUrl = new URL(req.url);
    const audioTarget = requestUrl.searchParams.get('audio');

    // Audio proxy is host-allowlisted and safe for unauthenticated access.
    // <audio> tags cannot send Authorization headers, so requiring a token
    // here causes streams to fail and the player auto-pauses. Discovery
    // actions (top/geo-top/resolve) are also public so /home stays indexable.


    if ((req.method === 'GET' || req.method === 'HEAD') && audioTarget) {
      if (!isAllowedAudioProxyUrl(audioTarget)) {
        return new Response('Invalid audio source', { status: 400, headers: corsHeaders });
      }
      // Per-IP rate limit to prevent unauthenticated bandwidth abuse.
      // <audio> tags can't send Authorization headers, so we throttle by IP instead.
      const clientIp = (req.headers.get('x-forwarded-for') || '').split(',')[0].trim()
        || req.headers.get('cf-connecting-ip')
        || req.headers.get('x-real-ip')
        || 'unknown';
      if (!checkAudioProxyRateLimit(clientIp)) {
        return new Response('Too many requests', {
          status: 429,
          headers: { ...corsHeaders, 'retry-after': '60' },
        });
      }

      const range = req.headers.get('range');
      const upstream = await fetchAllowedAudioProxyTarget(audioTarget, req, range);

      const headers = new Headers(corsHeaders);
      ['content-type', 'content-length', 'content-range', 'accept-ranges', 'cache-control', 'etag', 'last-modified'].forEach((name) => {
        const value = upstream.headers.get(name);
        if (value) headers.set(name, value);
      });

      return new Response(req.method === 'HEAD' ? null : upstream.body, {
        status: upstream.status,
        headers,
      });
    }
    // Per-IP throttle for discovery actions to protect Last.fm / YouTube API quotas.
    {
      const clientIp = (req.headers.get('x-forwarded-for') || '').split(',')[0].trim()
        || req.headers.get('cf-connecting-ip')
        || req.headers.get('x-real-ip')
        || 'unknown';
      if (!checkMusicIndexerActionRateLimit(clientIp)) {
        return new Response(JSON.stringify({ success: false, error: 'Too many requests' }), {
          status: 429,
          headers: { ...corsHeaders, 'Content-Type': 'application/json', 'retry-after': '60' },
        });
      }
    }

    const body = await req.json().catch(() => ({}));
    const action = typeof body.action === 'string' ? body.action : '';


    if (!LASTFM_API_KEY) {
      return new Response(JSON.stringify({ success: false, error: 'Last.fm is not configured' }), {
        status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    if (action === 'search') {
      const query = typeof body.query === 'string' ? body.query.trim() : '';
      const limit = Math.max(1, Math.min(60, typeof body.limit === 'number' ? body.limit : 50));
      if (query.length < 2) {
        return new Response(JSON.stringify({ success: false, error: 'Search query must be at least 2 characters' }), {
          status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        });
      }
      try {
        const results = await smartSearch(query, limit);
        return new Response(JSON.stringify({ success: true, results }), {
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        });
      } catch (error) {
        console.error('music-indexer search error:', error);
        return new Response(JSON.stringify({ success: true, results: [], error: 'Search is temporarily unavailable' }), {
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        });
      }
    }

    if (action === 'search-artists') {
      const query = typeof body.query === 'string' ? body.query.trim() : '';
      const limit = Math.max(1, Math.min(60, typeof body.limit === 'number' ? body.limit : 30));
      if (query.length < 2) {
        return new Response(JSON.stringify({ success: false, error: 'Query must be at least 2 characters' }), {
          status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        });
      }
      try {
        const results = await searchArtistDirectory(query, limit);
        return new Response(JSON.stringify({ success: true, results }), {
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        });
      } catch (error) {
        console.error('music-indexer search-artists error:', error);
        return new Response(JSON.stringify({ success: true, results: [] }), {
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        });
      }
    }

    if (action === 'top-artists') {
      const tag = typeof body.tag === 'string' && body.tag.trim() ? body.tag.trim() : 'pop';
      const limit = Math.max(1, Math.min(60, typeof body.limit === 'number' ? body.limit : 40));
      try {
        const results = await getTopArtistsByTag(tag, limit);
        return new Response(JSON.stringify({ success: true, results }), {
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        });
      } catch (error) {
        console.error('music-indexer top-artists error:', error);
        return new Response(JSON.stringify({ success: true, results: [] }), {
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        });
      }
    }

    if (action === 'enrich-artist-images') {
      // Public: artist portraits are public catalogue imagery (Spotify/Deezer),
      // no user data involved. Gating it behind auth was why artist cards showed
      // blank monograms for signed-out sessions and on cold APK starts.
      const cacheRound = Math.floor(Date.now() / (6 * 60 * 60 * 1000));


      const names = Array.isArray(body.names) ? body.names.filter((n: unknown): n is string => typeof n === 'string').slice(0, 60) : [];
      if (!names.length) {
        return new Response(JSON.stringify({ success: true, results: {} }), {
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        });
      }
      try {
        const ck = `artist-imgs:${cacheRound}:${names.map((n) => n.toLowerCase()).sort().join('|')}`;
        const cached = getCached<Record<string, string>>(ck);
        if (cached) {
          return new Response(JSON.stringify({ success: true, results: cached }), {
            headers: { ...corsHeaders, 'Content-Type': 'application/json' },
          });
        }
        const results = await enrichArtistImages(names);
        setCached(ck, results, 6 * 60 * 60 * 1000);
        return new Response(JSON.stringify({ success: true, results }), {
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        });

      } catch (error) {
        console.error('music-indexer enrich-artist-images error:', error);
        return new Response(JSON.stringify({ success: true, results: {} }), {
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        });
      }
    }

    if (action === 'top') {
      const limit = Math.max(1, Math.min(50, typeof body.limit === 'number' ? body.limit : 30));
      try {
        const results = await getTopTracks(limit);
        return new Response(JSON.stringify({ success: true, results }), {
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        });
      } catch (error) {
        console.error('music-indexer top error:', error);
        return new Response(JSON.stringify({ success: true, results: [], error: 'Top tracks are temporarily unavailable' }), {
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        });
      }
    }

    if (action === 'geo-top') {
      // Real per-country viral chart (Last.fm geo.getTopTracks)
      const country = (typeof body.country === 'string' ? body.country.trim() : '').slice(0, 60);
      const limit = Math.max(1, Math.min(50, typeof body.limit === 'number' ? body.limit : 30));
      if (!country) {
        return new Response(JSON.stringify({ success: false, error: 'country is required' }), {
          status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        });
      }
      try {
        const ck = `geo:${country.toLowerCase()}:${limit}:${Math.floor(Date.now() / (10 * 60 * 1000))}`;
        const cached = getCached<IndexedTrack[]>(ck);
        if (cached) {
          return new Response(JSON.stringify({ success: true, results: cached, country }), {
            headers: { ...corsHeaders, 'Content-Type': 'application/json' },
          });
        }
        // Pull a much wider sample so we can diversify by artist (Last.fm geo charts
        // are heavily biased toward whichever artist is currently being scrobbled most).
        const d = await fetchJson(buildLastFmUrl('geo.getTopTracks', {
          country, limit: String(Math.min(200, Math.max(60, limit * 6))),
        }));
        const raw = d?.tracks?.track;
        const matches: LastFmTrack[] = Array.isArray(raw) ? raw : raw ? [raw] : [];
        // Cap each artist to at most 2 entries — keeps the chart truly "viral", not a single album.
        const perArtistCap = 2;
        const perArtistCount: Record<string, number> = {};
        const diversified: LastFmTrack[] = [];
        for (const t of matches) {
          const a = (getArtistName(t.artist) || '').toLowerCase().trim();
          if (!a) continue;
          const c = perArtistCount[a] || 0;
          if (c >= perArtistCap) continue;
          perArtistCount[a] = c + 1;
          diversified.push(t);
          if (diversified.length >= limit + 6) break;
        }
        const enriched = await Promise.all(diversified.map(async (t) => {
          const info = t.name ? await getTrackInfo(getArtistName(t.artist), t.name) : null;
          const mapped = mapTrack(t, info);
          return mapped ? hydrateTrackArtwork(mapped) : null;
        }));
        const results = uniqueTracks(enriched).slice(0, limit).map((t, i) => ({ ...t, rank: i + 1 }));
        setCached(ck, results, 10 * 60 * 1000);
        return new Response(JSON.stringify({ success: true, results, country }), {
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        });
      } catch (error) {
        console.error('music-indexer geo-top error:', error);
        return new Response(JSON.stringify({ success: true, results: [] }), {
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        });
      }
    }

    if (action === 'tag-top') {
      // Mood/genre discovery (e.g. "chill", "sad", "workout") via Last.fm tag.getTopTracks
      const tag = (typeof body.tag === 'string' ? body.tag.trim() : '').slice(0, 40);
      const limit = Math.max(1, Math.min(50, typeof body.limit === 'number' ? body.limit : 30));
      if (!tag) {
        return new Response(JSON.stringify({ success: false, error: 'tag is required' }), {
          status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        });
      }
      try {
        const ck = `tag-top:${tag.toLowerCase()}:${limit}`;
        const cached = getCached<IndexedTrack[]>(ck);
        if (cached) {
          return new Response(JSON.stringify({ success: true, results: cached, tag }), {
            headers: { ...corsHeaders, 'Content-Type': 'application/json' },
          });
        }
        const d = await fetchJson(buildLastFmUrl('tag.getTopTracks', {
          tag, limit: String(Math.min(50, limit + 5)),
        }));
        const raw = d?.tracks?.track;
        const matches: LastFmTrack[] = Array.isArray(raw) ? raw : raw ? [raw] : [];
        const enriched = await Promise.all(matches.slice(0, limit + 4).map(async (t) => {
          const info = t.name ? await getTrackInfo(getArtistName(t.artist), t.name) : null;
          const mapped = mapTrack(t, info);
          return mapped ? hydrateTrackArtwork(mapped) : null;
        }));
        const results = uniqueTracks(enriched).slice(0, limit);
        setCached(ck, results, 30 * 60 * 1000);
        return new Response(JSON.stringify({ success: true, results, tag }), {
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        });
      } catch (error) {
        console.error('music-indexer tag-top error:', error);
        return new Response(JSON.stringify({ success: true, results: [] }), {
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        });
      }
    }

    if (action === 'artist-top') {
      // Top tracks for a specific artist (used by "From Your Artists" for non-catalog follows)
      const artist = (typeof body.artist === 'string' ? body.artist.trim() : '').slice(0, 100);
      const limit = Math.max(1, Math.min(30, typeof body.limit === 'number' ? body.limit : 12));
      if (!artist) {
        return new Response(JSON.stringify({ success: false, error: 'artist is required' }), {
          status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        });
      }
      try {
        const results = await getArtistTopTracks(artist, limit);
        return new Response(JSON.stringify({ success: true, results }), {
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        });
      } catch (error) {
        console.error('music-indexer artist-top error:', error);
        return new Response(JSON.stringify({ success: true, results: [] }), {
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        });
      }
    }

    if (action === 'resolve-video') {
      const videoId = typeof body.videoId === 'string' ? body.videoId.trim() : '';
      if (!/^[a-zA-Z0-9_-]{11}$/.test(videoId)) {
        return new Response(JSON.stringify({ success: false, error: 'Valid videoId is required' }), {
          status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        });
      }

      const authHeader = req.headers.get('authorization') || '';
      const admin = getAdminClient();
      let userId: string | null = null;
      if (authHeader.startsWith('Bearer ') && admin) {
        const jwt = authHeader.slice(7);
        const { data: u } = await admin.auth.getUser(jwt);
        userId = u?.user?.id ?? null;
      }
      if (admin) {
        if (userId) {
          const { data: allowed } = await admin.rpc('check_and_increment_rate_limit', {
            _user_id: userId,
            _endpoint: 'music-indexer:resolve-video',
            _max_per_minute: 30,
          });
          if (allowed === false) {
            return new Response(JSON.stringify({ success: false, error: 'Rate limit exceeded' }), {
              status: 429, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
            });
          }
        }
      }

      // Pass through whatever metadata the client already knows so the JioSaavn
      // attempt inside resolveVideoId doesn't need an oembed round-trip.
      const hintTitle = typeof body.title === 'string' ? body.title.trim() : '';
      const hintArtist = typeof body.artist === 'string' ? body.artist.trim() : '';
      const resolved = await resolveVideoId(videoId, hintTitle ? { title: hintTitle, artist: hintArtist } : undefined);
      // A `yt-video:` marker is not a playable stream — every client already
      // discards it, so returning it as `success: true` just produced a silent
      // dead tap. Report the failure honestly and let the UI offer a retry.
      return new Response(JSON.stringify(resolved
        ? { success: true, streamUrl: resolved.streamUrl, duration: resolved.duration, videoId }
        : {
          success: false,
          videoId,
          error: 'This track is temporarily unavailable — tap play again to retry',
          fallback: true,
          retryable: true,
        }
      ), {
        status: 200,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    if (action === 'resolve') {
      const artist = typeof body.artist === 'string' ? body.artist.trim() : '';
      const title = typeof body.title === 'string' ? body.title.trim() : '';
      let forceRefresh = body.forceRefresh === true;
      if (!artist || !title) {
        return new Response(JSON.stringify({ success: false, error: 'Artist and title are required' }), {
          status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        });
      }

      // Resolve must be public because playback can start before Supabase auth
      // finishes hydrating. The handler-level IP throttle protects API quota;
      // authenticated users also get the normal per-user limiter below.
      const authHeader = req.headers.get('authorization') || '';
      const admin = getAdminClient();
      let userId: string | null = null;
      if (authHeader.startsWith('Bearer ') && admin) {
        const jwt = authHeader.slice(7);
        const { data: u } = await admin.auth.getUser(jwt);
        userId = u?.user?.id ?? null;
      }
      if (admin) {
        if (userId) {
          const { data: allowed } = await admin.rpc('check_and_increment_rate_limit', {
            _user_id: userId,
            _endpoint: 'music-indexer:resolve',
            _max_per_minute: 30,
          });
          if (allowed === false) {
            return new Response(JSON.stringify({ success: false, error: 'Rate limit exceeded' }), {
              status: 429, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
            });
          }
        }
      }
      // Let real playback recovery bypass stale stream caches for normal users.
      // This was previously admin-only, so expired Invidious/Piped URLs kept
      // returning after an audio error and Premium EQ stayed stuck connecting.
      // Abuse is still controlled by the per-IP/per-user rate limits above.

      const result = await resolveStream(artist, title, forceRefresh);
      return new Response(JSON.stringify(result), {
        status: 200,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    return new Response(JSON.stringify({ success: false, error: 'Unsupported action' }), {
      status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  } catch (error) {
    console.error('music-indexer error:', error);
    return new Response(JSON.stringify({ success: false, error: 'Unexpected error', fallback: true }), {
      status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});
