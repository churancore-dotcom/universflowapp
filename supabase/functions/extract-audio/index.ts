import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

const RATE_LIMIT_WINDOW_MS = 60_000;
const anonHits = new Map<string, number[]>();

function clientIp(req: Request): string {
  return (req.headers.get('x-forwarded-for') || '').split(',')[0].trim()
    || req.headers.get('cf-connecting-ip')
    || req.headers.get('x-real-ip')
    || 'unknown';
}

function checkLocalAnonRateLimit(ip: string, maxPerMinute: number): boolean {
  const now = Date.now();
  const hits = (anonHits.get(ip) || []).filter((t) => now - t < RATE_LIMIT_WINDOW_MS);
  if (hits.length >= maxPerMinute) {
    anonHits.set(ip, hits);
    return false;
  }
  hits.push(now);
  anonHits.set(ip, hits);
  if (anonHits.size > 5000) {
    for (const [key, values] of anonHits) {
      const kept = values.filter((t) => now - t < RATE_LIMIT_WINDOW_MS);
      if (!kept.length) anonHits.delete(key);
      else anonHits.set(key, kept);
    }
  }
  return true;
}

// Piped instances — refreshed 2026-06. Verified from kavin.rocks/instances + community list.
const PIPED_INSTANCES = [
  'https://pipedapi.kavin.rocks',
  'https://api.piped.private.coffee',
  'https://pipedapi.leptons.xyz',
  'https://pipedapi.r4fo.com',
  'https://api.piped.yt',
  'https://pipedapi.reallyaweso.me',
  'https://pipedapi.darkness.services',
  'https://pipedapi.drgns.space',
  'https://pipedapi.ducks.party',
];

// Invidious instances — refreshed 2026-06.
const INVIDIOUS_INSTANCES = [
  'https://inv.thepixora.com',
  'https://inv.nadeko.net',
  'https://invidious.nerdvpn.de',
  'https://invidious.private.coffee',
  'https://iv.datura.network',
  'https://invidious.jing.rocks',
  'https://invidious.privacyredirect.com',
  'https://invidious-production-d29a.up.railway.app',
  'https://invidious.protokolla.fi',
  'https://yewtu.be',
  'https://invidious.f5.si',
];

interface ExtractionResult {
  success: boolean;
  audioUrl?: string;
  title?: string;
  artist?: string;
  thumbnail?: string;
  duration?: number;
  platform?: string;
  error?: string;
  hint?: string;
  cached?: boolean;
}

// ---------- Module-level instance health cache ----------
// Skip an instance for 5 minutes after a failure so we don't keep waiting on dead hosts.
const HEALTH_TTL_MS = 5 * 60 * 1000;
const unhealthy = new Map<string, number>(); // host -> blockedUntil epoch ms

const isHealthy = (apiUrl: string): boolean => {
  const until = unhealthy.get(apiUrl);
  if (!until) return true;
  if (Date.now() > until) { unhealthy.delete(apiUrl); return true; }
  return false;
};
const markUnhealthy = (apiUrl: string) => {
  unhealthy.set(apiUrl, Date.now() + HEALTH_TTL_MS);
};

function extractVideoId(url: string): string | null {
  const patterns = [
    /(?:youtube\.com\/watch\?v=|youtu\.be\/|youtube\.com\/embed\/|youtube\.com\/v\/|youtube\.com\/shorts\/|music\.youtube\.com\/watch\?v=|youtube\.com\/live\/)([a-zA-Z0-9_-]{11})/,
    /^([a-zA-Z0-9_-]{11})$/,
  ];
  const cleanUrl = url.trim();
  try {
    const urlObj = new URL(cleanUrl);
    const vParam = urlObj.searchParams.get('v');
    if (vParam && vParam.length === 11) return vParam;
  } catch { /* not a URL */ }
  for (const pattern of patterns) {
    const match = cleanUrl.match(pattern);
    if (match && match[1]) return match[1];
  }
  return null;
}

function isPlaylistUrl(url: string): boolean {
  try {
    const urlObj = new URL(url);
    return urlObj.searchParams.has('list') && !urlObj.searchParams.has('v') && url.includes('playlist');
  } catch { return false; }
}

function normalizeUrl(candidate: string | undefined, origin: string) {
  if (!candidate) return undefined;
  if (candidate.startsWith('//')) return `https:${candidate}`;
  if (candidate.startsWith('/')) return `${origin.replace(/\/$/, '')}${candidate}`;
  return candidate;
}

async function probePlayableStream(url: string, timeoutMs = 4000) {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(url, {
      method: 'GET',
      signal: controller.signal,
      headers: { range: 'bytes=0-1', 'user-agent': 'Mozilla/5.0', accept: '*/*' },
      redirect: 'follow',
    });
    const contentType = response.headers.get('content-type')?.toLowerCase() || '';
    await response.body?.cancel().catch(() => undefined);
    if (!response.ok && response.status !== 206) return false;
    if (contentType.includes('text/html') || contentType.includes('application/json')) return false;
    return true;
  } catch {
    return false;
  } finally {
    clearTimeout(timeoutId);
  }
}

async function tryPipedInstance(apiUrl: string, videoId: string): Promise<ExtractionResult | null> {
  if (!isHealthy(apiUrl)) return null;
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), 8000);
  try {
    const response = await fetch(`${apiUrl}/streams/${videoId}`, {
      signal: controller.signal,
      headers: { 'Accept': 'application/json', 'User-Agent': 'Mozilla/5.0' },
    });
    clearTimeout(timeoutId);
    if (!response.ok) { markUnhealthy(apiUrl); return null; }
    const data = await response.json();
    if (data.error || data.message || !data.audioStreams?.length) { markUnhealthy(apiUrl); return null; }
    const sorted = [...data.audioStreams].sort((a: any, b: any) => {
      const aM = a.mimeType?.includes('mp4') || a.format === 'm4a';
      const bM = b.mimeType?.includes('mp4') || b.format === 'm4a';
      if (aM && !bM) return -1;
      if (!aM && bM) return 1;
      return (b.bitrate || 0) - (a.bitrate || 0);
    });
    let playableUrl: string | undefined;
    for (const stream of sorted) {
      // Prefer the mirror's own proxy URL. Raw googlevideo URLs are often
      // signed/bound in a way that later fails through our WebAudio proxy,
      // which left EQ stuck because no real <audio> stream ever started.
      const candidates = [
        normalizeUrl(stream?.proxyUrl, apiUrl),
        normalizeUrl(stream?.url, apiUrl),
      ].filter(Boolean) as string[];
      for (const candidate of candidates) {
        if (await probePlayableStream(candidate)) {
          playableUrl = candidate;
          break;
        }
      }
      if (playableUrl) break;
    }
    if (!playableUrl) { markUnhealthy(apiUrl); return null; }
    console.log(`  ✓ [PIPED] ${new URL(apiUrl).hostname}`);
    return {
      success: true,
      audioUrl: playableUrl,
      title: data.title,
      artist: data.uploader,
      thumbnail: data.thumbnailUrl,
      duration: data.duration,
      platform: 'YouTube',
    };
  } catch {
    clearTimeout(timeoutId);
    markUnhealthy(apiUrl);
    return null;
  }
}

async function tryInvidiousInstance(apiUrl: string, videoId: string): Promise<ExtractionResult | null> {
  if (!isHealthy(apiUrl)) return null;
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), 8000);
  try {
    const response = await fetch(`${apiUrl}/api/v1/videos/${videoId}`, {
      signal: controller.signal,
      headers: { 'Accept': 'application/json', 'User-Agent': 'Mozilla/5.0' },
    });
    clearTimeout(timeoutId);
    if (!response.ok) { markUnhealthy(apiUrl); return null; }
    const data = await response.json();
    if (data.error || !data.adaptiveFormats?.length) { markUnhealthy(apiUrl); return null; }
    const audio = data.adaptiveFormats.filter((f: any) =>
      f.type?.startsWith('audio/') || f.encoding === 'opus' || f.encoding === 'aac'
    );
    if (!audio.length) { markUnhealthy(apiUrl); return null; }
    const sorted = [...audio].sort((a: any, b: any) => {
      const aM = a.type?.includes('mp4') || a.container === 'm4a';
      const bM = b.type?.includes('mp4') || b.container === 'm4a';
      if (aM && !bM) return -1;
      if (!aM && bM) return 1;
      return (b.bitrate || 0) - (a.bitrate || 0);
    });
    let playableUrl: string | undefined;
    for (const stream of sorted) {
      const itag = stream?.itag;
      const candidates = [
        // Use the Invidious local proxy endpoint first. It avoids handing the
        // client a raw googlevideo URL that later fails CORS/range/WebAudio.
        itag ? `${apiUrl.replace(/\/$/, '')}/latest_version?id=${encodeURIComponent(videoId)}&itag=${encodeURIComponent(String(itag))}&local=true` : undefined,
        normalizeUrl(stream?.url, apiUrl),
      ].filter(Boolean) as string[];
      for (const candidate of candidates) {
        if (await probePlayableStream(candidate)) {
          playableUrl = candidate;
          break;
        }
      }
      if (playableUrl) break;
    }
    if (!playableUrl) { markUnhealthy(apiUrl); return null; }
    let thumbnail = '';
    if (data.videoThumbnails?.length) {
      thumbnail = data.videoThumbnails.find((t: any) => t.quality === 'maxres')?.url
        || data.videoThumbnails[0]?.url || '';
    }
    console.log(`  ✓ [INV] ${new URL(apiUrl).hostname}`);
    return {
      success: true,
      audioUrl: playableUrl,
      title: data.title,
      artist: data.author,
      thumbnail,
      duration: data.lengthSeconds,
      platform: 'YouTube',
    };
  } catch {
    clearTimeout(timeoutId);
    markUnhealthy(apiUrl);
    return null;
  }
}

// Race N promises — resolve as soon as the first returns a successful result.
function raceForSuccess<T extends { success: boolean }>(promises: Promise<T | null>[]): Promise<T | null> {
  return new Promise((resolve) => {
    let pending = promises.length;
    if (pending === 0) { resolve(null); return; }
    let settled = false;
    for (const p of promises) {
      p.then((res) => {
        if (settled) return;
        if (res && res.success) {
          settled = true;
          resolve(res);
        } else if (--pending === 0) {
          settled = true;
          resolve(null);
        }
      }).catch(() => {
        if (settled) return;
        if (--pending === 0) { settled = true; resolve(null); }
      });
    }
  });
}

async function extractFromYouTube(videoId: string): Promise<ExtractionResult> {
  console.log(`\n=== Extracting: ${videoId} ===`);
  const primaryInvidious = 'https://inv.thepixora.com';
  const piped = [...PIPED_INSTANCES].filter(isHealthy).sort(() => Math.random() - 0.5);
  const invid = [primaryInvidious, ...INVIDIOUS_INSTANCES.filter((u) => u !== primaryInvidious)]
    .filter(isHealthy);

  // Invidious local-proxy streams are the only outputs that reliably survive
  // our stream-proxy + WebAudio path. Try them first; Piped is only fallback.
  const RACE_SIZE = 3;
  for (let i = 0; i < invid.length; i += RACE_SIZE) {
    const batch = invid.slice(i, i + RACE_SIZE);
    const hit = await raceForSuccess(batch.map((u) => tryInvidiousInstance(u, videoId)));
    if (hit) return hit;
  }
  for (let i = 0; i < piped.length; i += RACE_SIZE) {
    const batch = piped.slice(i, i + RACE_SIZE);
    const hit = await raceForSuccess(batch.map((u) => tryPipedInstance(u, videoId)));
    if (hit) return hit;
  }

  return {
    success: false,
    error: 'Could not extract audio. All servers are busy or the video is unavailable.',
    hint: 'Try again in a moment.',
    platform: 'YouTube',
  };
}

serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response(null, { headers: corsHeaders });

  try {
    const authHeader = req.headers.get('authorization');
    const adminClient = createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''
    );

    // <audio>/prefetch flows can hit this function before Supabase auth is ready.
    // Do not hard-401 those calls; resolve with a strict IP throttle so playback
    // and EQ don't get stuck on `yt-video:` placeholders.
    let authenticatedUserId: string | null = null;
    if (authHeader?.startsWith('Bearer ')) {
      const supabaseClient = createClient(
        Deno.env.get('SUPABASE_URL') ?? '',
        Deno.env.get('SUPABASE_ANON_KEY') ?? '',
        { global: { headers: { Authorization: authHeader } } }
      );
      const token = authHeader.replace('Bearer ', '');
      const { data: claimsData } = await supabaseClient.auth.getUser(token);
      authenticatedUserId = claimsData?.user?.id ?? null;
    }

    if (authenticatedUserId) {
      // Per-user rate limit — every authenticated user can call this, not just admins.
      const { data: allowed } = await adminClient.rpc('check_and_increment_rate_limit', {
        _user_id: authenticatedUserId, _endpoint: 'extract-audio', _max_per_minute: 30,
      });
      if (allowed === false) {
        return new Response(JSON.stringify({ success: false, error: 'Rate limit exceeded. Try again in a minute.' }),
          { status: 429, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
      }
    } else {
      const ip = clientIp(req);
      if (!checkLocalAnonRateLimit(ip, 12)) {
        return new Response(JSON.stringify({ success: false, error: 'Rate limit exceeded. Try again in a minute.' }),
          { status: 429, headers: { ...corsHeaders, 'Content-Type': 'application/json', 'retry-after': '60' } });
      }
    }

    const body = await req.json().catch(() => ({}));
    const rawUrl: string | undefined = body?.url;
    const directVideoId: string | undefined = body?.videoId;
    const forceRefresh: boolean = body?.forceRefresh === true;

    let videoId: string | null = null;
    if (directVideoId && /^[a-zA-Z0-9_-]{11}$/.test(String(directVideoId))) {
      videoId = String(directVideoId);
    } else if (rawUrl) {
      // Direct audio URL passthrough
      if (rawUrl.match(/\.(mp3|wav|flac|aac|ogg|m4a|opus|webm)(\?.*)?$/i)) {
        return new Response(JSON.stringify({
          success: true, audioUrl: rawUrl, platform: 'Direct Link',
          title: rawUrl.split('/').pop()?.split('?')[0] || 'audio',
        }), { headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
      }
      if (isPlaylistUrl(rawUrl)) {
        return new Response(JSON.stringify({
          success: false,
          error: 'Playlist URLs are not supported. Please copy a specific video link.',
        }), { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
      }
      const isYouTube = rawUrl.includes('youtube.com') || rawUrl.includes('youtu.be') || rawUrl.includes('music.youtube.com');
      if (!isYouTube) {
        return new Response(JSON.stringify({
          success: false, error: 'Currently only YouTube URLs are supported.',
        }), { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
      }
      videoId = extractVideoId(rawUrl);
    }

    if (!videoId) {
      return new Response(JSON.stringify({
        success: false, error: 'A YouTube videoId or url is required.',
      }), { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
    }

    // Allow client to force a fresh extraction if its cached URL just failed.
    if (forceRefresh) {
      try { await adminClient.from('stream_url_cache').delete().eq('video_id', videoId); } catch { /* ignore */ }
    }

    // ---------- DB stream cache check ----------
    try {
      const { data: cached } = await adminClient
        .from('stream_url_cache')
        .select('audio_url, title, artist, thumbnail, duration, expires_at')
        .eq('video_id', videoId)
        .gt('expires_at', new Date().toISOString())
        .maybeSingle();

      if (cached?.audio_url) {
        console.log(`✓ CACHE HIT for ${videoId}`);
        return new Response(JSON.stringify({
          success: true,
          audioUrl: cached.audio_url,
          title: cached.title || undefined,
          artist: cached.artist || undefined,
          thumbnail: cached.thumbnail || undefined,
          duration: cached.duration || undefined,
          platform: 'YouTube',
          cached: true,
        }), { headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
      }
    } catch (e) {
      console.warn('cache read failed:', (e as Error).message);
    }

    const result = await extractFromYouTube(videoId);

    if (!result.success) {
      return new Response(JSON.stringify(result),
        { status: 503, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
    }

    // ---------- Persist to cache (5h TTL, YouTube URLs valid ~6h) ----------
    try {
      await adminClient.from('stream_url_cache').upsert({
        video_id: videoId,
        audio_url: result.audioUrl!,
        title: result.title ?? null,
        artist: result.artist ?? null,
        thumbnail: result.thumbnail ?? null,
        duration: result.duration ?? null,
        expires_at: new Date(Date.now() + 5 * 60 * 60 * 1000).toISOString(),
        updated_at: new Date().toISOString(),
      }, { onConflict: 'video_id' });
    } catch (e) {
      console.warn('cache write failed:', (e as Error).message);
    }

    return new Response(JSON.stringify(result),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } });

  } catch (error) {
    console.error('Edge function error:', error);
    return new Response(JSON.stringify({ success: false, error: 'An unexpected error occurred' }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
  }
});
