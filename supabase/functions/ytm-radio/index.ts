// YT Music Radio / Autoplay queue (Innertube `next` endpoint).
// Public, undocumented API used by music.youtube.com itself. Clean-room.
import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

const YTM_HEADERS = {
  'Content-Type': 'application/json',
  'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/121.0 Safari/537.36',
  'X-Goog-AuthUser': '0',
  'X-Origin': 'https://music.youtube.com',
  'Origin': 'https://music.youtube.com',
  'Referer': 'https://music.youtube.com/',
};
const YTM_CONTEXT = {
  client: { clientName: 'WEB_REMIX', clientVersion: '1.20241218.01.00', hl: 'en', gl: 'US' },
};

function decode(v = '') {
  return v.replace(/&amp;/g, '&').replace(/&quot;/g, '"').replace(/&#039;/g, "'").replace(/&lt;/g, '<').replace(/&gt;/g, '>');
}
function runsText(t: any) { return (t?.runs || []).map((r: any) => r.text).join('').trim(); }
function parseDuration(t = ''): number {
  const p = t.split(':').map((n) => parseInt(n, 10));
  if (p.some(isNaN)) return 0;
  return p.length === 3 ? p[0] * 3600 + p[1] * 60 + p[2] : p.length === 2 ? p[0] * 60 + p[1] : 0;
}

interface RadioTrack {
  id: string;
  videoId: string;
  title: string;
  artist: string;
  audio_url: string;
  cover_url?: string;
  duration?: number;
}

function extractFromWatchItem(item: any): RadioTrack | null {
  const r = item?.playlistPanelVideoRenderer;
  if (!r) return null;
  const videoId = r?.videoId || r?.navigationEndpoint?.watchEndpoint?.videoId;
  if (!videoId) return null;
  const title = decode(runsText(r.title));
  const longBy = (r.longBylineText?.runs || []).map((x: any) => x.text).join('');
  const shortBy = (r.shortBylineText?.runs || []).map((x: any) => x.text).join('');
  const byline = longBy || shortBy;
  // Artist is typically the first run before the bullet
  const artist = decode((byline.split('•')[0] || '').trim());
  const cover = r.thumbnail?.thumbnails?.slice(-1)?.[0]?.url;
  const duration = parseDuration(r.lengthText?.runs?.[0]?.text || '');
  if (!title) return null;
  return {
    id: `ytm-${videoId}`,
    videoId,
    title,
    artist,
    audio_url: `yt-video:${videoId}`,
    cover_url: cover,
    duration: duration || undefined,
  };
}

function* walkPanel(node: any): Generator<any> {
  if (!node || typeof node !== 'object') return;
  if (Array.isArray(node)) { for (const c of node) yield* walkPanel(c); return; }
  if (node.playlistPanelVideoRenderer) yield node;
  for (const k of Object.keys(node)) {
    const v = (node as any)[k];
    if (v && typeof v === 'object') yield* walkPanel(v);
  }
}

async function fetchRadio(videoId: string): Promise<RadioTrack[]> {
  // RDAMVM<id> = official "Mix" radio playlist YT Music auto-builds for any video.
  const resp = await fetch('https://music.youtube.com/youtubei/v1/next?prettyPrint=false', {
    method: 'POST',
    headers: YTM_HEADERS,
    body: JSON.stringify({
      context: YTM_CONTEXT,
      videoId,
      playlistId: `RDAMVM${videoId}`,
      isAudioOnly: true,
      tunerSettingValue: 'AUTOMIX_SETTING_NORMAL',
    }),
  });
  if (!resp.ok) {
    console.warn('ytm-radio next failed', resp.status);
    return [];
  }
  const json = await resp.json();
  const out: RadioTrack[] = [];
  const seen = new Set<string>();
  for (const item of walkPanel(json)) {
    const t = extractFromWatchItem(item);
    if (!t) continue;
    if (t.videoId === videoId) continue;
    if (seen.has(t.videoId)) continue;
    seen.add(t.videoId);
    out.push(t);
    if (out.length >= 40) break;
  }
  return out;
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
    const videoId = String(body?.videoId || '').trim();
    if (!/^[A-Za-z0-9_-]{6,}$/.test(videoId)) {
      return new Response(JSON.stringify({ success: false, error: 'videoId required' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
    }

    const tracks = await fetchRadio(videoId);
    return new Response(JSON.stringify({ success: true, tracks }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
  } catch (e) {
    console.error('ytm-radio error', e instanceof Error ? e.message : e);
    return new Response(JSON.stringify({ success: false, error: 'Radio temporarily unavailable' }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
  }
});
