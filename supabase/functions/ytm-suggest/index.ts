// YT Music search suggestions (Innertube `music/get_search_suggestions`).
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
const YTM_CONTEXT = {
  client: { clientName: 'WEB_REMIX', clientVersion: '1.20241218.01.00', hl: 'en', gl: 'US' },
};

function runsText(t: any) { return (t?.runs || []).map((r: any) => r.text).join('').trim(); }

function* walk(node: any): Generator<any> {
  if (!node || typeof node !== 'object') return;
  if (Array.isArray(node)) { for (const c of node) yield* walk(c); return; }
  if (node.searchSuggestionRenderer) yield node.searchSuggestionRenderer;
  for (const k of Object.keys(node)) {
    const v = (node as any)[k];
    if (v && typeof v === 'object') yield* walk(v);
  }
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
    const input = String(body?.query || '').trim().slice(0, 120);
    if (input.length < 1) {
      return new Response(JSON.stringify({ success: true, suggestions: [] }),
        { headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
    }

    const resp = await fetch('https://music.youtube.com/youtubei/v1/music/get_search_suggestions?prettyPrint=false', {
      method: 'POST',
      headers: YTM_HEADERS,
      body: JSON.stringify({ context: YTM_CONTEXT, input }),
    });
    if (!resp.ok) {
      return new Response(JSON.stringify({ success: true, suggestions: [] }),
        { headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
    }
    const json = await resp.json();
    const out: string[] = [];
    const seen = new Set<string>();
    for (const r of walk(json)) {
      const text = runsText(r.suggestion);
      const key = text.toLowerCase();
      if (!text || seen.has(key)) continue;
      seen.add(key);
      out.push(text);
      if (out.length >= 10) break;
    }
    return new Response(JSON.stringify({ success: true, suggestions: out }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
  } catch (e) {
    console.error('ytm-suggest error', e instanceof Error ? e.message : e);
    return new Response(JSON.stringify({ success: true, suggestions: [] }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
  }
});
