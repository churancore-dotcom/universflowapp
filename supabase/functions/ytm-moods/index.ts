// YT Music Moods & Genres browse (FEmusic_moods_and_genres).
// Two modes:
//  - { mode: 'list' }              → top-level mood/genre categories (params per item)
//  - { mode: 'browse', params }    → playlists for that mood/genre
//  - { mode: 'playlist', browseId } → tracks for a single playlist
import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

const YTM_HEADERS = {
  'Content-Type': 'application/json',
  'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/121.0 Safari/537.36',
  'X-Origin': 'https://music.youtube.com',
  'Origin': 'https://music.youtube.com',
  'Referer': 'https://music.youtube.com/',
};
function ctx(gl = 'US') {
  return { client: { clientName: 'WEB_REMIX', clientVersion: '1.20241218.01.00', hl: 'en', gl } };
}

function decode(v = '') {
  return v.replace(/&amp;/g, '&').replace(/&quot;/g, '"').replace(/&#039;/g, "'").replace(/&lt;/g, '<').replace(/&gt;/g, '>');
}
function runsText(t: any) { return (t?.runs || []).map((r: any) => r.text).join('').trim(); }
function parseDuration(t = ''): number {
  const p = t.split(':').map((n) => parseInt(n, 10));
  if (p.some(isNaN)) return 0;
  return p.length === 3 ? p[0] * 3600 + p[1] * 60 + p[2] : p.length === 2 ? p[0] * 60 + p[1] : 0;
}

async function browse(browseId: string, params?: string, gl = 'US') {
  const body: any = { context: ctx(gl), browseId };
  if (params) body.params = params;
  const resp = await fetch('https://music.youtube.com/youtubei/v1/browse?prettyPrint=false', {
    method: 'POST', headers: YTM_HEADERS, body: JSON.stringify(body),
  });
  if (!resp.ok) return null;
  return resp.json();
}

// Recursively yield every node of a given renderer kind.
function* findAll(node: any, kind: string): Generator<any> {
  if (!node || typeof node !== 'object') return;
  if (Array.isArray(node)) { for (const c of node) yield* findAll(c, kind); return; }
  if (node[kind]) yield node[kind];
  for (const k of Object.keys(node)) {
    const v = (node as any)[k];
    if (v && typeof v === 'object') yield* findAll(v, kind);
  }
}

// ── Categories (mode=list) ──────────────────────────────────────────
// FEmusic_moods_and_genres returns gridRenderers grouped by category header.
// Each item is a musicNavigationButtonRenderer with browseEndpoint{params}.
function parseCategories(json: any) {
  const categories: Array<{ title: string; items: Array<{ title: string; params: string; browseId: string }> }> = [];
  for (const shelf of findAll(json, 'musicCarouselShelfRenderer')) {
    const title = runsText(shelf?.header?.musicCarouselShelfBasicHeaderRenderer?.title);
    const items: Array<{ title: string; params: string; browseId: string }> = [];
    for (const btn of findAll(shelf, 'musicNavigationButtonRenderer')) {
      const t = runsText(btn?.buttonText);
      const ep = btn?.clickCommand?.browseEndpoint;
      if (!t || !ep?.browseId) continue;
      items.push({ title: decode(t), params: ep?.params || '', browseId: ep.browseId });
    }
    if (title && items.length) categories.push({ title: decode(title), items });
  }
  // Some regions return a grid instead of carousel — capture those too.
  for (const grid of findAll(json, 'gridRenderer')) {
    const items: Array<{ title: string; params: string; browseId: string }> = [];
    for (const btn of findAll(grid, 'musicNavigationButtonRenderer')) {
      const t = runsText(btn?.buttonText);
      const ep = btn?.clickCommand?.browseEndpoint;
      if (!t || !ep?.browseId) continue;
      items.push({ title: decode(t), params: ep?.params || '', browseId: ep.browseId });
    }
    if (items.length) categories.push({ title: 'Browse', items });
  }
  return categories;
}

// ── Playlists for a mood (mode=browse) ───────────────────────────────
function parsePlaylistShelves(json: any) {
  const shelves: Array<{ title: string; playlists: Array<{ title: string; browseId: string; playlistId?: string; cover?: string }> }> = [];
  for (const shelf of findAll(json, 'musicCarouselShelfRenderer')) {
    const title = decode(runsText(shelf?.header?.musicCarouselShelfBasicHeaderRenderer?.title));
    const playlists: Array<{ title: string; browseId: string; playlistId?: string; cover?: string }> = [];
    for (const it of findAll(shelf, 'musicTwoRowItemRenderer')) {
      const t = decode(runsText(it?.title));
      const ep = it?.navigationEndpoint?.browseEndpoint;
      if (!t || !ep?.browseId) continue;
      const cover = it?.thumbnailRenderer?.musicThumbnailRenderer?.thumbnail?.thumbnails?.slice(-1)?.[0]?.url;
      // Convert MPRE/VL browseId to playlistId (strip VL prefix when present)
      const playlistId = ep.browseId.startsWith('VL') ? ep.browseId.slice(2) : undefined;
      playlists.push({ title: t, browseId: ep.browseId, playlistId, cover });
    }
    if (title && playlists.length) shelves.push({ title, playlists });
  }
  return shelves;
}

// ── Tracks for a playlist (mode=playlist) ────────────────────────────
function parsePlaylistTracks(json: any) {
  const tracks: Array<{ id: string; videoId: string; title: string; artist: string; audio_url: string; cover_url?: string; duration?: number }> = [];
  const seen = new Set<string>();
  for (const item of findAll(json, 'musicResponsiveListItemRenderer')) {
    const cols = item?.flexColumns || [];
    const videoId =
      item?.playlistItemData?.videoId ||
      item?.overlay?.musicItemThumbnailOverlayRenderer?.content?.musicPlayButtonRenderer?.playNavigationEndpoint?.watchEndpoint?.videoId ||
      cols?.[0]?.musicResponsiveListItemFlexColumnRenderer?.text?.runs?.[0]?.navigationEndpoint?.watchEndpoint?.videoId;
    if (!videoId || seen.has(videoId)) continue;
    const title = decode(runsText(cols?.[0]?.musicResponsiveListItemFlexColumnRenderer?.text));
    const subRuns = cols?.[1]?.musicResponsiveListItemFlexColumnRenderer?.text?.runs || [];
    const artist = decode(subRuns.filter((r: any) => r?.navigationEndpoint?.browseEndpoint?.browseId?.startsWith('UC')).map((r: any) => r.text).join(', ') || subRuns[0]?.text || '');
    const durationText = (item?.fixedColumns?.[0]?.musicResponsiveListItemFixedColumnRenderer?.text?.runs?.[0]?.text) || '';
    const cover = item?.thumbnail?.musicThumbnailRenderer?.thumbnail?.thumbnails?.slice(-1)?.[0]?.url;
    if (!title) continue;
    seen.add(videoId);
    tracks.push({
      id: `ytm-${videoId}`,
      videoId,
      title,
      artist,
      audio_url: `yt-video:${videoId}`,
      cover_url: cover,
      duration: parseDuration(durationText) || undefined,
    });
  }
  return tracks;
}

serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response(null, { headers: corsHeaders });
  try {
    const authHeader = req.headers.get('authorization');
    if (!authHeader?.startsWith('Bearer ')) {
      return new Response(JSON.stringify({ success: false, error: 'Authentication required' }),
        { status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
    }
    const sb = createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      Deno.env.get('SUPABASE_ANON_KEY') ?? '',
      { global: { headers: { Authorization: authHeader } } }
    );
    const { data: u } = await sb.auth.getUser(authHeader.replace('Bearer ', ''));
    if (!u?.user) {
      return new Response(JSON.stringify({ success: false, error: 'Invalid auth' }),
        { status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
    }

    const body = await req.json().catch(() => ({}));
    const mode = String(body?.mode || 'list');
    const country = typeof body?.country === 'string' && /^[A-Z]{2}$/i.test(body.country) ? body.country.toUpperCase() : 'US';

    if (mode === 'list') {
      const json = await browse('FEmusic_moods_and_genres', undefined, country);
      const categories = json ? parseCategories(json) : [];
      return new Response(JSON.stringify({ success: true, categories }),
        { headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
    }

    if (mode === 'browse') {
      const browseId = String(body?.browseId || 'FEmusic_moods_and_genres_category');
      const params = body?.params ? String(body.params) : undefined;
      const json = await browse(browseId, params, country);
      const shelves = json ? parsePlaylistShelves(json) : [];
      return new Response(JSON.stringify({ success: true, shelves }),
        { headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
    }

    if (mode === 'playlist') {
      const browseId = String(body?.browseId || '');
      if (!browseId) {
        return new Response(JSON.stringify({ success: false, error: 'browseId required' }),
          { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
      }
      const id = browseId.startsWith('VL') ? browseId : `VL${browseId}`;
      const json = await browse(id, undefined, country);
      const tracks = json ? parsePlaylistTracks(json) : [];
      return new Response(JSON.stringify({ success: true, tracks }),
        { headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
    }

    return new Response(JSON.stringify({ success: false, error: 'Unknown mode' }),
      { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
  } catch (e) {
    console.error('ytm-moods error', e instanceof Error ? e.message : e);
    return new Response(JSON.stringify({ success: false, error: 'Moods temporarily unavailable' }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
  }
});
