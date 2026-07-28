import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
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
  published?: number;
  kind?: 'song' | 'video';
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
    audio_url: track.audio_url || `yt-video:${track.videoId}`,
    duration: track.duration ?? null,
    metadata: { provider: 'youtube', videoId: track.videoId },
    last_seen_at: now,
    updated_at: now,
  }));
  const { error } = await adminClient.from('stream_songs').upsert(rows, { onConflict: 'track_id' });
  if (error) console.warn('Unable to cache search results:', error.message);
}

const normalize = (v = '') => v.toLowerCase().normalize('NFKD').replace(/[\u0300-\u036f]/g, '').replace(/[^a-z0-9]+/g, ' ').trim();
function decodeEntities(v = '') {
  return v.replace(/&amp;/g, '&').replace(/&quot;/g, '"').replace(/&#039;/g, "'").replace(/&lt;/g, '<').replace(/&gt;/g, '>');
}

const HARD_SPAM = [
  /\b(karaoke|instrumental|backing\s*track)\b/i,
  /\b(sped\s*up|slowed(\s*\+?\s*reverb)?|nightcore|8\s*d|bass\s*boost(ed)?)\b/i,
  /\b(non\s*stop|jukebox|mashup|medley|full album|all songs|playlist|compilation|collection)\b/i,
  /\b\d+\s*(hour|hours|hr|hrs)\b/i,
  /\b(whatsapp\s*status|ringtone|caller\s*tune)\b/i,
  /\b(ai\s*cover|ai\s*voice|deepfake)\b/i,
  /\b(shorts?|reels?|tiktok\s*version|status\s*video|lyric\s*video|with\s*lyrics?)\b/i,
  /\b(top|best)\s*\d+\b/i,
  /\b\d+\s*(top|best|hit|hits|songs)\b/i,
];
const SPAM_AUTHORS = [
  /\b(7clouds|cloudx|wave\s*music|unique\s*vibes|lyrics?|lyrical|lyric\s*zone|status|ringtone|karaoke|nightcore|cover\s*world|remix\s*(king|world))\b/i,
];
function looksHardSpam(title: string, author: string, q: string) {
  const hay = `${title} ${author}`;
  if (HARD_SPAM.some((p) => p.test(hay))) return true;
  if (SPAM_AUTHORS.some((p) => p.test(author))) return true;
  if (!/remix/i.test(q) && /\bremix\b/i.test(title)) return true;
  return false;
}

function relevanceScore(r: SearchResult, q: string, index: number, pass: 'songs' | 'videos') {
  const tokens = normalize(q).split(' ').filter((t) => t.length > 1 && !['song', 'songs', 'music', 'official', 'video', 'audio'].includes(t));
  const title = normalize(r.title);
  const artist = normalize(r.artist);
  const hay = `${title} ${artist}`;
  const titleHits = tokens.reduce((n, t) => n + (title.includes(t) ? 1 : 0), 0);
  const artistHits = tokens.reduce((n, t) => n + (artist.includes(t) ? 1 : 0), 0);
  const qNorm = normalize(q);
  const titlePhrase = qNorm.length > 2 && title.includes(qNorm);
  const allTitle = tokens.length > 0 && tokens.every((t) => title.includes(t));
  const anyHit = tokens.length === 0 || tokens.some((t) => hay.includes(t));
  if (!anyHit) return -9999;
  let score = pass === 'songs' ? 500 : 360;
  score += titlePhrase ? 900 : 0;
  score += title.startsWith(qNorm) ? 650 : 0;
  score += allTitle ? 420 : 0;
  score += titleHits * 150 + artistHits * 55;
  if (/\b(official\s*(music\s*)?(video|audio)|provided to youtube by|vevo|topic)\b/i.test(`${r.title} ${r.artist}`)) score += 140;
  if (/\b(lyric|lyrics|status|shorts|reels|cover|remix|slowed|sped)\b/i.test(`${r.title} ${r.artist}`)) score -= 260;
  if (r.duration && (r.duration < 75 || r.duration > 540)) score -= 600;
  return score - index * 1.5;
}

// ---------- Innertube YouTube Music (WEB_REMIX) ----------
// Used by Echo Music, ViMusic, InnerTune, OuterTune, ytmusicapi. No key. No quota.
const YTM_CONTEXT = {
  client: {
    clientName: 'WEB_REMIX',
    clientVersion: '1.20241218.01.00',
    hl: 'en',
    gl: 'US',
  },
};
function ytmContext(gl = 'US') {
  return {
    client: {
      clientName: 'WEB_REMIX',
      clientVersion: '1.20241218.01.00',
      hl: 'en',
      gl: /^[A-Z]{2}$/.test(gl) ? gl : 'US',
    },
  };
}
const YTM_HEADERS = {
  'Content-Type': 'application/json',
  'Origin': 'https://music.youtube.com',
  'Referer': 'https://music.youtube.com/',
  'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
  'X-Goog-Visitor-Id': 'CgtsZG5pUVRMb2VUcyiMjuG6BjIKCgJVUxIEGgAgOA%3D%3D',
  'X-Youtube-Client-Name': '67',
  'X-Youtube-Client-Version': '1.20241218.01.00',
};
// Songs-only filter param for YT Music search ("EgWKAQIIAWoKEAkQBRAKEAMQBA").
const PARAMS_SONGS = 'EgWKAQIIAWoKEAkQBRAKEAMQBA';
// Videos-only filter param (used as a second pass for broader coverage).
const PARAMS_VIDEOS = 'EgWKAQIQAWoKEAkQBRAKEAMQBA';

function pickThumb(thumbs: any[]): string | undefined {
  if (!Array.isArray(thumbs) || !thumbs.length) return undefined;
  const raw = thumbs[thumbs.length - 1]?.url?.replace(/^http:/, 'https:');
  if (!raw) return undefined;
  if (raw.includes('googleusercontent.com')) return raw.replace(/=w\d+-h\d+[^&]*/i, '=w544-h544-l90-rj');
  return raw.replace(/\/default\.jpg/i, '/hqdefault.jpg');
}

async function ytMusicBrowse(browseId: string, gl = 'US', extra: Record<string, unknown> = {}): Promise<any | null> {
  const resp = await fetch('https://music.youtube.com/youtubei/v1/browse?prettyPrint=false', {
    method: 'POST',
    headers: YTM_HEADERS,
    body: JSON.stringify({ context: ytmContext(gl), browseId, ...extra }),
  });
  if (!resp.ok) return null;
  return await resp.json();
}

// ─── Real YouTube Music Charts (FEmusic_charts) ───
// Returns per-country shelves (Top songs, Trending, Top videos). YT uses a
// "formData.selectedValues" payload to switch regions. Falls back to Global
// when the requested country has no chart. This is the same endpoint the
// music.youtube.com/charts page fetches, so results are real and up-to-date.
const CHART_COUNTRIES = new Set([
  'ZZ','AR','AU','AT','BE','BO','BR','CA','CL','CO','CR','CZ','DK','DO','EC','EG','SV','FI','FR','DE','GT','HN','HU','IS','IN','ID','IE','IL','IT','JP','KE','LU','MX','NL','NZ','NI','NG','NO','PA','PY','PE','PL','PT','RO','RU','SA','RS','ZA','KR','ES','SE','CH','TZ','TH','TR','UG','UA','AE','GB','US','UY','VE','VN','ZW'
]);

function chartsCountryOrGlobal(gl: string): string {
  const cc = gl.toUpperCase();
  return CHART_COUNTRIES.has(cc) ? cc : 'ZZ';
}

function extractShelfHeaderTitle(shelf: any): string {
  return runsText(shelf?.header?.musicCarouselShelfBasicHeaderRenderer?.title)
    || runsText(shelf?.header?.musicResponsiveHeaderRenderer?.title)
    || '';
}

function* walkShelves(node: any): Generator<any> {
  if (!node || typeof node !== 'object') return;
  if (node.musicCarouselShelfRenderer) yield node.musicCarouselShelfRenderer;
  if (node.musicShelfRenderer) yield node.musicShelfRenderer;
  for (const k of Object.keys(node)) {
    const v = (node as any)[k];
    if (v && typeof v === 'object') yield* walkShelves(v);
  }
}

function classifyShelf(title: string): 'top' | 'trending' | 'videos' | 'artists' | 'other' {
  const t = title.toLowerCase();
  if (/(video)/.test(t)) return 'videos';
  if (/(trending|movers|shakers|fast[- ]rising|viral)/.test(t)) return 'trending';
  if (/(artist)/.test(t)) return 'artists';
  if (/(song|track|hit|chart|top)/.test(t)) return 'top';
  return 'other';
}

async function getYouTubeMusicCharts(gl: string): Promise<Record<'top' | 'trending' | 'videos', SearchResult[]>> {
  const country = chartsCountryOrGlobal(gl);
  const json = await ytMusicBrowse('FEmusic_charts', country, {
    formData: { selectedValues: [country] },
  });
  const out: Record<'top' | 'trending' | 'videos', SearchResult[]> = { top: [], trending: [], videos: [] };
  if (!json) return out;

  const seenPerBucket: Record<string, Set<string>> = { top: new Set(), trending: new Set(), videos: new Set() };
  const addTrack = (bucket: 'top' | 'trending' | 'videos', item: any) => {
    // Two shapes: musicResponsiveListItemRenderer (list) OR musicTwoRowItemRenderer (grid).
    let track: SearchResult | null = null;
    if (item?.thumbnailRenderer || item?.navigationEndpoint?.watchEndpoint) {
      // Two-row style (charts videos shelf uses this).
      const parsed = extractNewReleaseVideoCard(item);
      if (parsed) track = parsed;
    } else {
      const parsed = extractFromItem(item);
      if (parsed?.videoId && parsed.title) {
        if (!looksHardSpam(parsed.title, parsed.artist, parsed.title)) {
          track = {
            id: `ytm-${parsed.videoId}`,
            videoId: parsed.videoId,
            title: parsed.title,
            artist: parsed.artist,
            audio_url: `yt-video:${parsed.videoId}`,
            cover_url: parsed.cover,
            duration: parsed.duration || undefined,
          };
        }
      }
    }
    if (!track) return;
    if (seenPerBucket[bucket].has(track.videoId)) return;
    seenPerBucket[bucket].add(track.videoId);
    out[bucket].push(track);
  };

  for (const shelf of walkShelves(json)) {
    const kind = classifyShelf(extractShelfHeaderTitle(shelf));
    if (kind === 'artists' || kind === 'other') continue;
    const bucket = kind === 'videos' ? 'videos' : kind; // 'top' | 'trending' | 'videos'
    // musicShelfRenderer uses .contents; musicCarouselShelfRenderer uses .contents too.
    for (const item of shelf.contents || []) {
      const inner = item?.musicResponsiveListItemRenderer || item?.musicTwoRowItemRenderer || item;
      addTrack(bucket, inner);
    }
  }

  // Do NOT auto-promote the top-songs shelf into "trending" — that made the
  // Viral rail render the same tracks as Trending Now. Leave it empty so the
  // client can fall back to the Videos shelf (which is a different bucket).
  return out;
}

function runsText(runs: any): string {
  if (!runs) return '';
  if (Array.isArray(runs?.runs)) return runs.runs.map((r: any) => r?.text || '').join('');
  if (typeof runs === 'string') return runs;
  return '';
}

function parseDuration(text: string): number {
  if (!text) return 0;
  const parts = text.split(':').map((n) => parseInt(n, 10) || 0);
  if (parts.length === 3) return parts[0] * 3600 + parts[1] * 60 + parts[2];
  if (parts.length === 2) return parts[0] * 60 + parts[1];
  return 0;
}

const SUBTITLE_BADGES = new Set(['song', 'video', 'single', 'album', 'ep', 'playlist', 'artist']);

// Walk the deeply-nested Innertube response and extract every musicResponsiveListItemRenderer.
function* walkItems(node: any): Generator<any> {
  if (!node || typeof node !== 'object') return;
  if (node.musicResponsiveListItemRenderer) yield node.musicResponsiveListItemRenderer;
  for (const k of Object.keys(node)) {
    const v = (node as any)[k];
    if (v && typeof v === 'object') yield* walkItems(v);
  }
}

function* walkTwoRowItems(node: any): Generator<any> {
  if (!node || typeof node !== 'object') return;
  if (node.musicTwoRowItemRenderer) yield node.musicTwoRowItemRenderer;
  for (const k of Object.keys(node)) {
    const v = (node as any)[k];
    if (v && typeof v === 'object') yield* walkTwoRowItems(v);
  }
}

function parseReleaseArtist(subtitle = ''): string {
  return decodeEntities(subtitle)
    .replace(/^(single|album|ep)\s*•\s*/i, '')
    .replace(/\s*•\s*YouTube Music$/i, '')
    .trim();
}

function extractReleaseCard(item: any): { browseId: string; title: string; artist: string; cover?: string; type: 'single' | 'album' | 'ep' } | null {
  const title = decodeEntities(runsText(item?.title)).trim();
  const subtitle = decodeEntities(runsText(item?.subtitle)).trim();
  const browseId = item?.navigationEndpoint?.browseEndpoint?.browseId || '';
  const type = /^single\b/i.test(subtitle) ? 'single' : /^ep\b/i.test(subtitle) ? 'ep' : /^album\b/i.test(subtitle) ? 'album' : null;
  if (!title || !browseId.startsWith('MPRE') || !type) return null;
  const artist = parseReleaseArtist(subtitle);
  if (!artist || /YouTube Music/i.test(artist)) return null;
  const cover = pickThumb(item?.thumbnailRenderer?.musicThumbnailRenderer?.thumbnail?.thumbnails || item?.thumbnail?.musicThumbnailRenderer?.thumbnail?.thumbnails);
  return { browseId, title, artist, cover, type };
}

function extractNewReleaseVideoCard(item: any): SearchResult | null {
  const title = decodeEntities(runsText(item?.title)).trim();
  const subtitle = decodeEntities(runsText(item?.subtitle)).trim();
  const videoId = item?.navigationEndpoint?.watchEndpoint?.videoId || item?.overlay?.musicItemThumbnailOverlayRenderer?.content?.musicPlayButtonRenderer?.playNavigationEndpoint?.watchEndpoint?.videoId;
  if (!videoId || !title) return null;
  const artist = subtitle.split('•')[0]?.trim() || 'Unknown Artist';
  if (!artist || looksHardSpam(title, artist, title)) return null;
  const cover = pickThumb(item?.thumbnailRenderer?.musicThumbnailRenderer?.thumbnail?.thumbnails || item?.thumbnail?.musicThumbnailRenderer?.thumbnail?.thumbnails);
  return { id: `ytm-${videoId}`, videoId, title, artist, audio_url: `yt-video:${videoId}`, cover_url: cover };
}

function extractReleaseTrack(item: any, fallbackArtist: string, fallbackCover?: string): SearchResult | null {
  const parsed = extractFromItem(item);
  if (!parsed?.videoId || !parsed.title) return null;
  const artist = parsed.artist && parsed.artist !== 'Unknown Artist' ? parsed.artist : fallbackArtist;
  if (looksHardSpam(parsed.title, artist, parsed.title)) return null;
  return {
    id: `ytm-${parsed.videoId}`,
    videoId: parsed.videoId,
    title: parsed.title,
    artist,
    audio_url: `yt-video:${parsed.videoId}`,
    cover_url: parsed.cover || fallbackCover,
    duration: parsed.duration || undefined,
  };
}

async function fetchTracksFromRelease(release: { browseId: string; artist: string; cover?: string; type: 'single' | 'album' | 'ep' }, gl: string): Promise<SearchResult[]> {
  const json = await ytMusicBrowse(release.browseId, gl);
  if (!json) return [];
  const out: SearchResult[] = [];
  for (const item of walkItems(json)) {
    const track = extractReleaseTrack(item, release.artist, release.cover);
    if (!track) continue;
    out.push(track);
    if (release.type === 'single' || out.length >= 2) break;
  }
  return out;
}

async function getLocalizedNewReleases(gl: string, limit: number): Promise<SearchResult[]> {
  const [releasesJson, videosJson] = await Promise.all([
    ytMusicBrowse('FEmusic_new_releases', gl),
    ytMusicBrowse('FEmusic_new_releases_videos', gl),
  ]);

  const releaseCards: ReturnType<typeof extractReleaseCard>[] = [];
  for (const item of walkTwoRowItems(releasesJson)) {
    const card = extractReleaseCard(item);
    if (card) releaseCards.push(card);
  }

  const orderedCards = releaseCards
    .filter((card): card is NonNullable<typeof card> => !!card)
    .sort((a, b) => (a.type === 'single' ? 0 : 1) - (b.type === 'single' ? 0 : 1))
    .slice(0, Math.min(18, Math.max(8, limit)));

  const releaseTracks = (await Promise.all(orderedCards.map((card) => fetchTracksFromRelease(card, gl)))).flat();
  const videoTracks: SearchResult[] = [];
  for (const item of walkTwoRowItems(videosJson)) {
    const track = extractNewReleaseVideoCard(item);
    if (track) videoTracks.push(track);
  }

  const seen = new Set<string>();
  const out: SearchResult[] = [];
  for (const track of [...releaseTracks, ...videoTracks]) {
    if (!track.videoId || seen.has(track.videoId)) continue;
    seen.add(track.videoId);
    out.push(track);
    if (out.length >= limit) break;
  }
  return out;
}

function extractFromItem(item: any): { videoId?: string; title: string; artist: string; duration: number; cover?: string } | null {
  const videoId =
    item?.playlistItemData?.videoId ||
    item?.overlay?.musicItemThumbnailOverlayRenderer?.content?.musicPlayButtonRenderer?.playNavigationEndpoint?.watchEndpoint?.videoId ||
    item?.flexColumns?.[0]?.musicResponsiveListItemFlexColumnRenderer?.text?.runs?.[0]?.navigationEndpoint?.watchEndpoint?.videoId;
  if (!videoId) return null;
  const cols = item?.flexColumns || [];
  const title = runsText(cols?.[0]?.musicResponsiveListItemFlexColumnRenderer?.text);
  const subRuns = cols?.[1]?.musicResponsiveListItemFlexColumnRenderer?.text?.runs || [];
  // Subtitle format: [TypeBadge] • [Artist] • [Album] • [Duration] (or similar).
  const artistParts: string[] = [];
  const plainParts: string[] = [];
  let durationText = '';
  for (const r of subRuns) {
    const t = r?.text || '';
    if (t === ' • ') continue;
    const clean = normalize(t);
    if (!clean || SUBTITLE_BADGES.has(clean)) continue;
    if (/^\d+:\d+/.test(t)) { durationText = t; continue; }
    const browseId = r?.navigationEndpoint?.browseEndpoint?.browseId || '';
    const isArtist = !!browseId && !browseId.startsWith('MPRE') && !browseId.startsWith('VL');
    if (isArtist) artistParts.push(t);
    plainParts.push(t);
  }
  const artist = artistParts.length
    ? artistParts.join(', ')
    : (plainParts[0] || 'Unknown Artist');
  const cover = pickThumb(item?.thumbnail?.musicThumbnailRenderer?.thumbnail?.thumbnails);
  return { videoId, title: decodeEntities(title), artist: decodeEntities(artist), duration: parseDuration(durationText), cover };
}

function findContinuationToken(json: any): string | null {
  const stack: any[] = [json];
  while (stack.length) {
    const n = stack.pop();
    if (!n || typeof n !== 'object') continue;
    const tok =
      n?.continuationItemRenderer?.continuationEndpoint?.continuationCommand?.token ||
      n?.nextContinuationData?.continuation;
    if (tok && typeof tok === 'string') return tok;
    for (const k of Object.keys(n)) {
      const v = (n as any)[k];
      if (v && typeof v === 'object') stack.push(v);
    }
  }
  return null;
}

function parseSearchPage(json: any, query: string, out: SearchResult[], seen: Set<string>) {
  for (const item of walkItems(json)) {
    const parsed = extractFromItem(item);
    if (!parsed?.videoId || seen.has(parsed.videoId)) continue;
    if (!parsed.title) continue;
    if (looksHardSpam(parsed.title, parsed.artist, query)) continue;
    seen.add(parsed.videoId);
    out.push({
      id: `ytm-${parsed.videoId}`,
      videoId: parsed.videoId,
      title: parsed.title,
      artist: parsed.artist,
      audio_url: `yt-video:${parsed.videoId}`,
      cover_url: parsed.cover,
      duration: parsed.duration || undefined,
    });
  }
}

async function ytMusicSearch(query: string, params: string, targetCount = 80): Promise<SearchResult[]> {
  const resp = await fetch('https://music.youtube.com/youtubei/v1/search?prettyPrint=false', {
    method: 'POST',
    headers: YTM_HEADERS,
    body: JSON.stringify({ context: YTM_CONTEXT, query, params }),
  });
  if (!resp.ok) {
    console.warn('YT Music search failed', resp.status);
    return [];
  }
  const json = await resp.json();
  const out: SearchResult[] = [];
  const seen = new Set<string>();
  parseSearchPage(json, query, out, seen);

  // Follow continuation tokens for deeper results (Innertube paginates ~20/page).
  let continuation = findContinuationToken(json);
  let pages = 0;
  while (continuation && out.length < targetCount && pages < 5) {
    pages += 1;
    try {
      const cResp = await fetch(
        `https://music.youtube.com/youtubei/v1/search?prettyPrint=false&ctoken=${encodeURIComponent(continuation)}&continuation=${encodeURIComponent(continuation)}&type=next`,
        {
          method: 'POST',
          headers: YTM_HEADERS,
          body: JSON.stringify({ context: YTM_CONTEXT }),
        },
      );
      if (!cResp.ok) break;
      const cJson = await cResp.json();
      const before = out.length;
      parseSearchPage(cJson, query, out, seen);
      if (out.length === before) break;
      continuation = findContinuationToken(cJson);
    } catch {
      break;
    }
  }
  return out;
}

// ---------- Optional fallback: official YouTube Data API ----------
async function dataApiSearch(query: string, limit: number): Promise<SearchResult[]> {
  const apiKeys = [Deno.env.get('YOUTUBE_API_KEY'), Deno.env.get('YOUTUBE_API_KEY_2')].filter(Boolean) as string[];
  for (const apiKey of apiKeys) {
    const url = new URL('https://www.googleapis.com/youtube/v3/search');
    url.searchParams.set('part', 'snippet');
    url.searchParams.set('q', query);
    url.searchParams.set('type', 'video');
    url.searchParams.set('videoCategoryId', '10');
    url.searchParams.set('maxResults', String(Math.min(50, limit)));
    url.searchParams.set('key', apiKey);
    const r = await fetch(url.toString());
    if (!r.ok) continue;
    const j = await r.json();
    const out: SearchResult[] = [];
    for (const item of j.items || []) {
      const vid = item?.id?.videoId;
      if (!vid) continue;
      const s = item.snippet || {};
      const title = decodeEntities(s.title || '');
      const author = decodeEntities(s.channelTitle || '');
      if (looksHardSpam(title, author, query)) continue;
      out.push({
        id: `ytm-${vid}`,
        videoId: vid,
        title,
        artist: author,
        audio_url: `yt-video:${vid}`,
        cover_url: s.thumbnails?.high?.url || s.thumbnails?.medium?.url,
      });
    }
    if (out.length) return out;
  }
  return [];
}

serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response(null, { headers: corsHeaders });

  try {
    const authHeader = req.headers.get('authorization');
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      return new Response(JSON.stringify({ success: false, error: 'Authentication required' }), {
        status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }
    const supabaseClient = createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      Deno.env.get('SUPABASE_ANON_KEY') ?? '',
      { global: { headers: { Authorization: authHeader } } }
    );
    const token = authHeader.replace('Bearer ', '');
    const { data: userData, error: authError } = await supabaseClient.auth.getUser(token);
    if (authError || !userData?.user) {
      return new Response(JSON.stringify({ success: false, error: 'Invalid authentication' }), {
        status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }
    const adminClient = createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''
    );
    const { data: allowed } = await adminClient.rpc('check_and_increment_rate_limit', {
      _user_id: userData.user.id,
      _endpoint: 'yt-music-search',
      _max_per_minute: 120,
    });
    if (allowed === false) {
      return new Response(JSON.stringify({ success: false, error: 'Rate limit exceeded. Try again in a minute.' }), {
        status: 429, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    const { query, limit: requestedLimit, mode, country } = await req.json();
    const limit = Math.max(1, Math.min(200, typeof requestedLimit === 'number' ? requestedLimit : 50));

    if (mode === 'new-releases') {
      const gl = typeof country === 'string' && /^[A-Z]{2}$/i.test(country) ? country.toUpperCase() : 'US';
      const results = await getLocalizedNewReleases(gl, limit);
      if (results.length === 0) {
        return new Response(JSON.stringify({ success: false, error: 'No new releases' }), {
          status: 404, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        });
      }
      await persistSearchResults(adminClient, results);
      return new Response(JSON.stringify({ success: true, results, source: 'youtube-music-new-releases' }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    if (mode === 'charts') {
      const gl = typeof country === 'string' && /^[A-Z]{2}$/i.test(country) ? country.toUpperCase() : 'US';
      const buckets = await getYouTubeMusicCharts(gl);
      const top = buckets.top.slice(0, limit);
      const trending = buckets.trending.slice(0, limit);
      const videos = buckets.videos.slice(0, limit);
      const all = [...top, ...trending, ...videos];
      if (all.length === 0) {
        // Return 200 with empty buckets so the client can silently fall back
        // to keyword-search rails instead of surfacing a runtime error.
        return new Response(JSON.stringify({
          success: false,
          fallback: true,
          error: 'Charts unavailable',
          source: 'youtube-music-charts',
          country: chartsCountryOrGlobal(gl),
          top: [], trending: [], videos: [],
        }), { headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
      }
      // Persist all real chart tracks so the resolver can use their metadata.
      await persistSearchResults(adminClient, all);
      return new Response(JSON.stringify({
        success: true,
        source: 'youtube-music-charts',
        country: chartsCountryOrGlobal(gl),
        top, trending, videos,
      }), { headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
    }

    if (!query || typeof query !== 'string' || query.trim().length < 2) {
      return new Response(JSON.stringify({ success: false, error: 'A search query is required' }), {
        status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }
    const cleanQuery = query.trim().replace(/^new:\s*/i, '');

    // PRIMARY: YouTube Music Innertube. Run songs + videos + "all" in parallel,
    // each following continuation tokens so we return 100-200 hits, not 20.
    const PARAMS_ALL = '';
    const target = Math.max(limit, 100);
    const [songs, videos, all] = await Promise.all([
      ytMusicSearch(cleanQuery, PARAMS_SONGS, target).catch(() => []),
      ytMusicSearch(cleanQuery, PARAMS_VIDEOS, target).catch(() => []),
      ytMusicSearch(cleanQuery, PARAMS_ALL, target).catch(() => []),
    ]);

    const merged: Array<SearchResult & { _score?: number; _kind: 'song' | 'video' }> = [];
    const seen = new Set<string>();
    for (const [pass, list] of [['songs', songs], ['videos', videos], ['videos', all]] as const) {
      for (let i = 0; i < list.length; i++) {
        const r = list[i];
        if (seen.has(r.videoId)) continue;
        const score = relevanceScore(r, cleanQuery, i, pass);
        if (score < 0) continue;
        seen.add(r.videoId);
        merged.push({ ...r, _score: score, _kind: pass === 'songs' ? 'song' : 'video', kind: pass === 'songs' ? 'song' : 'video' });
      }
    }

    // Keep REAL songs (from YT Music SONGS shelf) strictly above generic videos,
    // then sort each bucket by relevance score.
    let results = merged
      .sort((a, b) => {
        if (a._kind !== b._kind) return a._kind === 'song' ? -1 : 1;
        return (b._score || 0) - (a._score || 0);
      })
      .slice(0, limit)
      .map(({ _score, _kind, ...r }) => r);

    let source = 'youtube-music-innertube';

    // FALLBACK: official Data API only if Innertube returns nothing.
    if (results.length === 0) {
      results = (await dataApiSearch(cleanQuery, limit)).slice(0, limit);
      source = 'youtube-data-api';
    }

    if (results.length === 0) {
      return new Response(JSON.stringify({ success: false, error: 'No results' }), {
        status: 404, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    await persistSearchResults(adminClient, results);
    return new Response(JSON.stringify({ success: true, results, source }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : 'Unexpected error';
    console.error('yt-music-search error:', message);
    return new Response(JSON.stringify({ success: false, error: 'Search is temporarily unavailable' }), {
      status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});
