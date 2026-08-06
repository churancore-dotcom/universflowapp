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
  failedUntil.set(instance, Date.now() + 2 * 60 * 1000); // skip for 2 min
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
    // Prefer exact name match
    const wantedKey = normalizeText(name);
    const match = list.find((a: any) => normalizeText(String(a?.name || '')) === wantedKey) || list[0];
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

// ── Search: parallel race across healthy instances ──

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
        .filter((e: any) => e.item.videoId && e.score > -8 && !isBadVideoCandidate({ title: e.item.title, author: e.item.uploaderName || e.item.uploader, lengthSeconds: e.item.duration || e.item.lengthSeconds }, artist, title))
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
          if (vid && scoreVideo(candidate, artist, title) > -8 && !isBadVideoCandidate(candidate, artist, title)) {
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
        .filter((e: any) => e.item.videoId && e.score > -8 && !isBadVideoCandidate(e.item, artist, title))
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

// NOTE on direct YouTube Innertube /player extraction:
// We tested ANDROID_VR, TVHTML5_SIMPLY_EMBEDDED_PLAYER, and IOS clients from
// the edge runtime. ALL of them get blocked with either "LOGIN_REQUIRED — Sign
// in to confirm you're not a bot" or "FAILED_PRECONDITION" because Supabase
// edge functions run on Cloudflare/Deno datacenter IPs that YouTube flags.
// Bypassing this requires either a PoToken solver (needs a real browser
// WebView) or a residential proxy — neither is feasible in a stateless edge
// function. We rely on third-party Piped/Invidious instances which use
// residential or dedicated IPs YouTube does not block.

async function resolveVideoId(videoId: string): Promise<{ streamUrl: string; duration?: number } | null> {
  const t0 = Date.now();

  // Skip the pre-flight /stats & /healthcheck probes — they blocked ALL
  // instances when their status endpoints were rate-limited even though
  // /api/v1/videos still worked. Instead, race the actual resolve calls
  // across every instance not in the short-lived failedUntil cache and let
  // the fastest real response win. Cobalt joins the same race so we don't
  // pay a serial fallback wait.
  const invPool = getInvidiousInstances().filter(isHealthy).slice(0, 8);
  const pipedPool = getPipedInstances().filter(isHealthy).slice(0, 8);

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
    console.log(`[resolve] ✓ ${videoId} via ${winner.src} (${Date.now() - t0}ms, tried=${attempts.length})`);
    return { streamUrl: winner.streamUrl, duration: winner.duration };
  } catch (e) {
    const msgs = (e as AggregateError)?.errors?.map((err: Error) => err.message)?.slice(0, 3).join(', ');
    console.warn(`[resolve] all sources failed for ${videoId} in ${Date.now() - t0}ms: ${msgs}`);
    return null;
  }
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

  return { success: false, error: 'All stream sources are currently unavailable', fallback: true };
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
      const userId = await getAuthenticatedUserId(req);
      if (!userId) {
        return new Response(JSON.stringify({ success: false, error: 'Authentication required' }), {
          status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        });
      }
      const admin = getAdminClient();
      if (admin) {
        const { data: allowed } = await admin.rpc('check_and_increment_rate_limit', {
          _user_id: userId,
          _endpoint: 'music-indexer:enrich-artist-images',
          _max_per_minute: 20,
        });
        if (allowed === false) {
          return new Response(JSON.stringify({ success: false, error: 'Rate limit exceeded' }), {
            status: 429, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
          });
        }
      }

      const names = Array.isArray(body.names) ? body.names.filter((n: unknown): n is string => typeof n === 'string').slice(0, 60) : [];
      if (!names.length) {
        return new Response(JSON.stringify({ success: true, results: {} }), {
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        });
      }
      try {
        const results = await enrichArtistImages(names);
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

      const resolved = await resolveVideoId(videoId);
      return new Response(JSON.stringify(resolved
        ? { success: true, streamUrl: resolved.streamUrl, duration: resolved.duration, videoId }
        : { success: true, streamUrl: `yt-video:${videoId}`, videoId, fallback: true }
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
