// YouTube Music Innertube search (server-side, no quota, no CORS).
// Hits the same endpoint music.youtube.com uses internally with the WEB_REMIX client.
// Returns normalized track results matching yt-music-search shape.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

interface SearchResult {
  id: string;
  videoId: string;
  title: string;
  artist: string;
  audio_url: string;
  cover_url?: string;
  duration?: number;
}

const INNERTUBE_URL = 'https://music.youtube.com/youtubei/v1/search?prettyPrint=false';
const INNERTUBE_CONTEXT = {
  client: {
    clientName: 'WEB_REMIX',
    clientVersion: '1.20250101.01.00',
    hl: 'en',
    gl: 'US',
  },
};
// params for "Songs" filter on YT Music
const SONGS_PARAMS = 'EgWKAQIIAWoOEAMQBBAJEAoQBRAVEBE%3D';

function parseDuration(text?: string): number | undefined {
  if (!text) return undefined;
  const parts = text.split(':').map((p) => parseInt(p, 10));
  if (parts.some(isNaN)) return undefined;
  let s = 0;
  for (const p of parts) s = s * 60 + p;
  return s || undefined;
}

function extractRuns(runs: any[] | undefined): string {
  if (!Array.isArray(runs)) return '';
  return runs.map((r) => r?.text || '').join('');
}

// Same songs-only gate yt-music-search and ytm-radio apply. YT Music's own
// "Songs" filter still leaks podcast clips, sports edits and motivational talks.
const NON_MUSIC = [
  /\b(podcast|episode|interview|talk\s*show|stand[\s-]?up|standup|comedy|sketch|skit|roast)\b/i,
  /\b(highlights?|grand\s*prix|formula\s*1|\bf1\b|race\s*(recap|review)|match|goals?|cricket|football|nba|nfl|wwe|ipl)\b/i,
  /(?<!radio\s)(?<!club\s)(?<!extended\s)(?<!special\s)(?<!clean\s)(?<!dirty\s)\bedits?\b/i,
  /\b(amv|montage|fan\s*cam|fancam|4k\s*edit|cinematic)\b/i,
  /\b(trailer|teaser|movie\s*clip|full\s*movie|web\s*series|documentary|scene\b)/i,
  /\b(gameplay|walkthrough|unboxing|review|reaction|vlog|tutorial|how\s*to|motivation(al)?|speech|seminar|leadership|business|mindset|success)\b/i,
  /\b(asmr|meditation|white\s*noise|sleep\s*sounds?|study\s*with\s*me|rain\s*sounds?)\b/i,
  /\b(news|breaking|q\s*&\s*a|explained|analysis)\b/i,
  /\b(jukebox|non\s*stop|mashup|medley|full\s*album|karaoke|ringtone)\b/i,
];
function isMusicResult(t: SearchResult): boolean {
  const hay = `${t.title} ${t.artist}`;
  if (NON_MUSIC.some((p) => p.test(hay))) return false;
  // Under 45s is a clip; past 15min is a compilation or a talk.
  if (t.duration && (t.duration < 45 || t.duration > 900)) return false;
  return true;
}

function extractFromShelf(shelf: any, out: SearchResult[]) {
  const contents = shelf?.musicShelfRenderer?.contents
    || shelf?.musicCardShelfRenderer?.contents
    || [];
  for (const c of contents) {
    const item = c?.musicResponsiveListItemRenderer;
    if (!item) continue;
    const videoId = item?.playlistItemData?.videoId
      || item?.overlay?.musicItemThumbnailOverlayRenderer?.content?.musicPlayButtonRenderer?.playNavigationEndpoint?.watchEndpoint?.videoId;
    if (!videoId) continue;
    const cols = item?.flexColumns || [];
    const title = extractRuns(cols?.[0]?.musicResponsiveListItemFlexColumnRenderer?.text?.runs);
    const meta = cols?.[1]?.musicResponsiveListItemFlexColumnRenderer?.text?.runs || [];
    const artist = meta.filter((r: any) => r?.navigationEndpoint?.browseEndpoint).map((r: any) => r.text).join(', ')
      || (meta[0]?.text || 'Unknown Artist');
    const durationText = meta.length ? meta[meta.length - 1]?.text : undefined;
    const thumbs = item?.thumbnail?.musicThumbnailRenderer?.thumbnail?.thumbnails || [];
    const cover_url = thumbs[thumbs.length - 1]?.url;
    if (!title || !videoId) continue;
    const track: SearchResult = {
      id: `ytm-${videoId}`,
      videoId,
      title: title.trim(),
      artist: String(artist).trim(),
      audio_url: `yt-video:${videoId}`,
      cover_url,
      duration: parseDuration(durationText),
    };
    if (!isMusicResult(track)) continue;
    out.push(track);
  }
}

async function persistSearchResults(adminClient: any, results: SearchResult[]) {
  if (!results.length) return;
  const now = new Date().toISOString();
  const rows = results.map((track) => ({
    track_id: track.id,
    source: 'indexed',
    title: track.title,
    artist: track.artist,
    cover_url: track.cover_url ?? null,
    audio_url: track.audio_url,
    duration: track.duration ?? null,
    metadata: { provider: 'youtube-innertube', videoId: track.videoId },
    last_seen_at: now,
    updated_at: now,
  }));
  const { error } = await adminClient.from('stream_songs').upsert(rows, { onConflict: 'track_id' });
  if (error) console.warn('innertube cache write failed:', error.message);
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response(null, { headers: corsHeaders });

  try {
    const authHeader = req.headers.get('authorization');
    if (!authHeader?.startsWith('Bearer ')) {
      return new Response(JSON.stringify({ success: false, error: 'Authentication required' }),
        { status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
    }

    const supabaseClient = createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      Deno.env.get('SUPABASE_ANON_KEY') ?? '',
      { global: { headers: { Authorization: authHeader } } },
    );
    const token = authHeader.replace('Bearer ', '');
    const { data: userData, error: authError } = await supabaseClient.auth.getUser(token);
    if (authError || !userData?.user) {
      return new Response(JSON.stringify({ success: false, error: 'Invalid authentication' }),
        { status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
    }

    const adminClient = createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '',
    );
    const { data: allowed } = await adminClient.rpc('check_and_increment_rate_limit', {
      _user_id: userData.user.id,
      _endpoint: 'yt-innertube-search',
      _max_per_minute: 30,
    });
    if (allowed === false) {
      return new Response(JSON.stringify({ success: false, error: 'Rate limit exceeded' }),
        { status: 429, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
    }

    const { query, limit: requestedLimit } = await req.json();
    if (!query || typeof query !== 'string' || query.trim().length < 2) {
      return new Response(JSON.stringify({ success: false, error: 'A search query is required' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
    }
    const limit = Math.max(1, Math.min(50, typeof requestedLimit === 'number' ? requestedLimit : 25));
    const q = query.trim();

    const r = await fetch(INNERTUBE_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
        'Origin': 'https://music.youtube.com',
        'Referer': 'https://music.youtube.com/',
        'X-Goog-Visitor-Id': 'CgtfaGtMTEx2X3J0OCi3qK6vBg%3D%3D',
      },
      body: JSON.stringify({
        context: INNERTUBE_CONTEXT,
        query: q,
        params: SONGS_PARAMS,
      }),
    });

    if (!r.ok) {
      const txt = await r.text().catch(() => '');
      console.error('Innertube non-OK:', r.status, txt.slice(0, 200));
      return new Response(JSON.stringify({ success: false, error: 'Innertube search failed', status: r.status }),
        { status: 502, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
    }
    const data = await r.json();

    const tabs = data?.contents?.tabbedSearchResultsRenderer?.tabs || [];
    const sections = tabs?.[0]?.tabRenderer?.content?.sectionListRenderer?.contents || [];
    const out: SearchResult[] = [];
    for (const sec of sections) {
      extractFromShelf(sec, out);
      if (out.length >= limit) break;
    }

    const results = out.slice(0, limit);
    await persistSearchResults(adminClient, results);

    return new Response(JSON.stringify({ success: true, results, source: 'innertube' }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
  } catch (e) {
    console.error('yt-innertube-search error:', (e as Error).message);
    return new Response(JSON.stringify({ success: false, error: 'Search temporarily unavailable' }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
  }
});
