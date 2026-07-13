// Lyrics edge function — 100% free, real-time synced lyrics.
// Sources: artist uploads (own catalog) + LRCLIB (primary, huge global synced
// coverage) + KuGou / Netease / QQMusic (CJK + regional) + Lyrics.ovh (plain
// Western fallback). No Genius, no paid providers, no external branding.
// Public endpoint — no JWT required.

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

const SUPABASE_URL = Deno.env.get('SUPABASE_URL') || '';
const SERVICE_ROLE = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') || '';

type Source = 'artist' | 'lrclib' | 'kugou' | 'netease' | 'qqmusic' | 'lyricsovh';

interface LyricsResponse {
  success: boolean;
  synced?: string | null;
  plain?: string | null;
  source?: Source | null;
  error?: string;
}

type ProviderLyrics = { source: Source; synced?: string; plain?: string };

function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T | null> {
  return new Promise((resolve) => {
    const timer = setTimeout(() => resolve(null), ms);
    promise.then((v) => resolve(v)).catch(() => resolve(null)).finally(() => clearTimeout(timer));
  });
}

function decodeHtml(v: string): string {
  return v.replace(/&amp;/g, '&').replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&lt;/g, '<').replace(/&gt;/g, '>');
}
function decodeBase64Utf8(v: string): string {
  const bin = atob(v);
  return new TextDecoder('utf-8', { fatal: false }).decode(Uint8Array.from(bin, (c) => c.charCodeAt(0)));
}
function stripLrcTags(line: string): string { return line.replace(/\[[^\]]+\]/g, '').trim(); }

function clean(s: string): string {
  return s
    .replace(/\(feat\.?[^)]*\)/gi, '')
    .replace(/\[feat\.?[^\]]*\]/gi, '')
    .replace(/\(.*?(remaster|remix|version|edit|live|deluxe|extended|radio|acoustic|instrumental|slowed|reverb|8d|sped\s*up).*?\)/gi, '')
    .replace(/\s+-\s+(remaster|remix|version|edit|live|deluxe|extended|radio|acoustic|instrumental).*$/i, '')
    .replace(/\s*[-–—]\s*(official\s+(music\s+)?video|audio|lyric(s)?\s+video|visualizer|mv).*$/i, '')
    .replace(/\s+/g, ' ')
    .trim();
}

/** Split "A, B & C" / "A x B" / "A feat. B" into individual artist tokens. */
function splitArtists(artist: string): string[] {
  const norm = artist
    .replace(/\s+feat\.?\s+|\s+ft\.?\s+|\s+featuring\s+/gi, ',')
    .replace(/\s+&\s+|\s+x\s+|\s+×\s+|\s+vs\.?\s+|\s+with\s+/gi, ',')
    .replace(/\s*[,;/]\s*/g, ',');
  return Array.from(new Set(norm.split(',').map((s) => clean(s)).filter((s) => s.length >= 1)));
}

/** Build ordered candidate (artist, title) query variations for maximum hit rate. */
function buildVariants(artist: string, title: string): Array<{ artist: string; title: string }> {
  const artists = splitArtists(artist);
  const primary = artists[0] || clean(artist);
  const titleClean = clean(title);
  const titleNoParen = titleClean.replace(/[\(\[].*?[\)\]]/g, '').replace(/\s+/g, ' ').trim();
  const titleNoDash = titleClean.split(/\s+[-–—]\s+/)[0].trim();

  const titles = Array.from(new Set([titleClean, titleNoParen, titleNoDash].filter((t) => t.length >= 1)));
  const artistList = Array.from(new Set([primary, clean(artist), ...artists].filter((a) => a.length >= 1)));

  const out: Array<{ artist: string; title: string }> = [];
  for (const t of titles) for (const a of artistList) out.push({ artist: a, title: t });
  return out.slice(0, 6);
}

function isCreditLine(text: string, artist: string, title: string): boolean {
  const c = text.toLowerCase().replace(/\s+/g, ' ').trim();
  if (!c) return false;
  if (/^(lyrics?|lyricist|written|writer|composed|composer|作词|作曲|编曲|制作|出品)\s*(by|[:：])/.test(c)) return true;
  const label = `${clean(title)} - ${clean(artist)}`.toLowerCase();
  return c === label || c === clean(title).toLowerCase();
}
function sanitizeLrc(raw: string, artist: string, title: string): string {
  return raw.split(/\r?\n/).filter((l) => !isCreditLine(stripLrcTags(l), artist, title)).join('\n').trim();
}
function plainFromLrc(raw: string, artist: string, title: string): string | undefined {
  const plain = raw.split(/\r?\n/).map(stripLrcTags)
    .filter((l) => l && !isCreditLine(l, artist, title))
    .join('\n').replace(/\n{2,}/g, '\n').trim();
  return plain || undefined;
}
function stripArtistSongId(songId?: string): string | null {
  const raw = String(songId || '').trim().replace(/^as_/, '');
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(raw) ? raw : null;
}

async function fetchArtistUploadLyrics(songId?: string): Promise<ProviderLyrics | null> {
  const id = stripArtistSongId(songId);
  if (!id || !SUPABASE_URL || !SERVICE_ROLE) return null;
  try {
    const url = `${SUPABASE_URL}/rest/v1/artist_songs?id=eq.${encodeURIComponent(id)}&status=eq.live&select=lyrics_plain,lyrics_synced&limit=1`;
    const r = await fetch(url, { headers: { apikey: SERVICE_ROLE, Authorization: `Bearer ${SERVICE_ROLE}`, Accept: 'application/json' } });
    if (!r.ok) return null;
    const rows = await r.json();
    const row = Array.isArray(rows) ? rows[0] : null;
    const synced = typeof row?.lyrics_synced === 'string' ? row.lyrics_synced.trim() : '';
    const plain = typeof row?.lyrics_plain === 'string' ? row.lyrics_plain.trim() : '';
    if (!synced && !plain) return null;
    return { source: 'artist', synced: synced || undefined, plain: plain || undefined };
  } catch { return null; }
}

// ───────── LRCLIB (primary — huge synced catalog) with variant retries ─────────
async function fetchLrclibOne(artist: string, title: string, durationSec?: number): Promise<{ synced?: string; plain?: string } | null> {
  try {
    if (durationSec && durationSec > 0) {
      const url = `https://lrclib.net/api/get?artist_name=${encodeURIComponent(artist)}&track_name=${encodeURIComponent(title)}&duration=${Math.round(durationSec)}`;
      const r = await fetch(url, { headers: { 'User-Agent': 'Universflow/1.0 (https://universflow.in)' } });
      if (r.ok) {
        const j = await r.json();
        if (j && (j.syncedLyrics || j.plainLyrics)) {
          return { synced: j.syncedLyrics || undefined, plain: j.plainLyrics || undefined };
        }
      }
    }
    const sUrl = `https://lrclib.net/api/search?artist_name=${encodeURIComponent(artist)}&track_name=${encodeURIComponent(title)}`;
    const sr = await fetch(sUrl, { headers: { 'User-Agent': 'Universflow/1.0 (https://universflow.in)' } });
    if (!sr.ok) return null;
    const arr = await sr.json();
    if (!Array.isArray(arr) || arr.length === 0) return null;
    const synced = arr.find((x: any) => x?.syncedLyrics);
    const pick = synced || arr.find((x: any) => x?.plainLyrics) || arr[0];
    if (!pick) return null;
    return { synced: pick.syncedLyrics || undefined, plain: pick.plainLyrics || undefined };
  } catch { return null; }
}

async function fetchLrclibAll(artist: string, title: string, duration?: number): Promise<{ synced?: string; plain?: string } | null> {
  const variants = buildVariants(artist, title);
  let bestPlain: { synced?: string; plain?: string } | null = null;
  for (const v of variants) {
    const r = await withTimeout(fetchLrclibOne(v.artist, v.title, duration), 2600);
    if (r?.synced) return r;
    if (r?.plain && !bestPlain) bestPlain = r;
  }
  return bestPlain;
}

// ───────── KuGou lyrics (CJK + rare tracks) ─────────
async function fetchKugou(artist: string, title: string, durationSec?: number): Promise<{ synced?: string; plain?: string } | null> {
  try {
    const keyword = `${clean(artist)} - ${clean(title)}`;
    const searchUrl = new URL('https://lyrics.kugou.com/search');
    searchUrl.searchParams.set('ver', '1'); searchUrl.searchParams.set('man', 'yes');
    searchUrl.searchParams.set('client', 'pc'); searchUrl.searchParams.set('keyword', keyword);
    if (durationSec && durationSec > 0) searchUrl.searchParams.set('duration', String(Math.round(durationSec * 1000)));
    const sr = await fetch(searchUrl.toString(), { headers: { 'User-Agent': 'Mozilla/5.0', Accept: 'application/json' } });
    if (!sr.ok) return null;
    const sj = await sr.json();
    const cand = sj?.candidates?.[0];
    if (!cand?.id || !cand?.accesskey) return null;
    const dlUrl = new URL('https://lyrics.kugou.com/download');
    dlUrl.searchParams.set('ver', '1'); dlUrl.searchParams.set('client', 'pc');
    dlUrl.searchParams.set('id', String(cand.id)); dlUrl.searchParams.set('accesskey', String(cand.accesskey));
    dlUrl.searchParams.set('fmt', 'lrc'); dlUrl.searchParams.set('charset', 'utf8');
    const dr = await fetch(dlUrl.toString(), { headers: { 'User-Agent': 'Mozilla/5.0', Accept: 'application/json' } });
    if (!dr.ok) return null;
    const dj = await dr.json();
    if (!dj?.content) return null;
    const lrc = sanitizeLrc(decodeBase64Utf8(String(dj.content)), artist, title);
    if (!lrc || lrc.length < 10) return null;
    return { synced: lrc, plain: plainFromLrc(lrc, artist, title) };
  } catch { return null; }
}

async function fetchNetease(artist: string, title: string): Promise<{ synced?: string; plain?: string } | null> {
  try {
    const q = `${clean(title)} ${clean(artist)}`;
    const search = await fetch(`https://music.163.com/api/search/get/web?type=1&limit=5&s=${encodeURIComponent(q)}`, {
      headers: { 'User-Agent': 'Mozilla/5.0', Referer: 'https://music.163.com/' },
    });
    if (!search.ok) return null;
    const sj = await search.json();
    const songs = sj?.result?.songs;
    if (!Array.isArray(songs) || songs.length === 0) return null;
    const tN = clean(title).toLowerCase(); const aN = clean(artist).toLowerCase();
    const pick = songs.find((s: any) => {
      const st = String(s?.name || '').toLowerCase();
      const sa = Array.isArray(s?.artists) ? s.artists.map((a: any) => String(a?.name || '').toLowerCase()).join(' ') : '';
      return st.includes(tN.slice(0, 18)) || (tN.includes(st) && sa.includes(aN.slice(0, 12)));
    }) || songs[0];
    if (!pick?.id) return null;
    const lr = await fetch(`https://music.163.com/api/song/lyric?id=${encodeURIComponent(String(pick.id))}&lv=1&kv=1&tv=-1`, {
      headers: { 'User-Agent': 'Mozilla/5.0', Referer: 'https://music.163.com/' },
    });
    if (!lr.ok) return null;
    const lj = await lr.json();
    const lrc = sanitizeLrc(decodeHtml(String(lj?.lrc?.lyric || '')).trim(), artist, title);
    if (!lrc || lrc.length < 10) return null;
    return { synced: lrc, plain: plainFromLrc(lrc, artist, title) };
  } catch { return null; }
}

async function fetchQQMusic(artist: string, title: string): Promise<{ synced?: string; plain?: string } | null> {
  try {
    const q = encodeURIComponent(`${clean(title)} ${clean(artist)}`);
    const search = await fetch(`https://c.y.qq.com/soso/fcgi-bin/client_search_cp?w=${q}&format=json&n=5&p=1`, {
      headers: { 'User-Agent': 'Mozilla/5.0', Referer: 'https://y.qq.com/' },
    });
    if (!search.ok) return null;
    const raw = await search.text();
    const j = JSON.parse(raw.replace(/^callback\(|\)$/g, ''));
    const song = j?.data?.song?.list?.[0];
    if (!song?.songmid) return null;
    const lr = await fetch(`https://c.y.qq.com/lyric/fcgi-bin/fcg_query_lyric_new.fcg?songmid=${encodeURIComponent(song.songmid)}&format=json&nobase64=1`, {
      headers: { 'User-Agent': 'Mozilla/5.0', Referer: 'https://y.qq.com/' },
    });
    if (!lr.ok) return null;
    const lj = await lr.json();
    const lrc = sanitizeLrc(decodeHtml(String(lj?.lyric || '')).trim(), artist, title);
    if (!lrc || lrc.length < 10) return null;
    return { synced: lrc.includes('[') ? lrc : undefined, plain: plainFromLrc(lrc, artist, title) };
  } catch { return null; }
}

async function fetchLyricsOvh(artist: string, title: string): Promise<{ plain?: string } | null> {
  // Try primary then split artists as fallback for "A & B" style credits.
  const attempts = [artist, ...splitArtists(artist)].slice(0, 3);
  for (const a of attempts) {
    try {
      const r = await fetch(`https://api.lyrics.ovh/v1/${encodeURIComponent(clean(a))}/${encodeURIComponent(clean(title))}`, {
        headers: { 'User-Agent': 'Universflow/1.0' },
      });
      if (!r.ok) continue;
      const j = await r.json();
      const plain = String(j?.lyrics || '').trim();
      if (plain && plain.length >= 15) return { plain };
    } catch { /* try next */ }
  }
  return null;
}

// ───────── Rate limit (per-IP, per instance) ─────────
const RATE_LIMIT_MAX = 60;
const RATE_LIMIT_WINDOW_MS = 60_000;
const ipHits = new Map<string, number[]>();
function getClientIp(req: Request): string {
  const fwd = req.headers.get('x-forwarded-for') || '';
  return (fwd.split(',')[0] || req.headers.get('cf-connecting-ip') || 'unknown').trim();
}
function rateLimited(ip: string): boolean {
  const now = Date.now(); const cutoff = now - RATE_LIMIT_WINDOW_MS;
  const arr = (ipHits.get(ip) || []).filter((t) => t > cutoff);
  if (arr.length >= RATE_LIMIT_MAX) { ipHits.set(ip, arr); return true; }
  arr.push(now); ipHits.set(ip, arr);
  if (ipHits.size > 5000) {
    for (const [k, v] of ipHits) {
      const f = v.filter((t) => t > cutoff);
      if (f.length === 0) ipHits.delete(k); else ipHits.set(k, f);
    }
  }
  return false;
}

// ───────── In-memory response cache ─────────
const CACHE_TTL_MS = 24 * 60 * 60 * 1000;
const cache = new Map<string, { at: number; payload: LyricsResponse }>();
function cacheGet(key: string): LyricsResponse | null {
  const hit = cache.get(key);
  if (!hit) return null;
  if (Date.now() - hit.at > CACHE_TTL_MS) { cache.delete(key); return null; }
  return hit.payload;
}
function cacheSet(key: string, payload: LyricsResponse) {
  if (cache.size > 1000) {
    for (const k of [...cache.keys()].slice(0, 200)) cache.delete(k);
  }
  cache.set(key, { at: Date.now(), payload });
}

async function fetchParallelProviders(artist: string, title: string, duration?: number): Promise<ProviderLyrics | null> {
  const started = Date.now();
  let bestPlain: ProviderLyrics | null = null;

  const tasks: Array<Promise<ProviderLyrics | null>> = [
    withTimeout(fetchLrclibAll(artist, title, duration), 5000).then((r) => r ? { ...r, source: 'lrclib' as const } : null),
    withTimeout(fetchKugou(artist, title, duration), 3000).then((r) => r ? { ...r, source: 'kugou' as const } : null),
    withTimeout(fetchNetease(artist, title), 3000).then((r) => r ? { ...r, source: 'netease' as const } : null),
    withTimeout(fetchQQMusic(artist, title), 3000).then((r) => r ? { ...r, source: 'qqmusic' as const } : null),
    withTimeout(fetchLyricsOvh(artist, title), 3200).then((r) => r ? { ...r, source: 'lyricsovh' as const } : null),
  ];
  const pending = tasks.map((p, i) => ({ i, promise: p.then((r) => ({ r, i })) }));
  while (pending.length) {
    const { r, i } = await Promise.race(pending.map((e) => e.promise));
    const pos = pending.findIndex((e) => e.i === i);
    if (pos >= 0) pending.splice(pos, 1);
    if (r?.synced) return r;
    if (r?.plain && !bestPlain) bestPlain = r;
    if (bestPlain && Date.now() - started > 2200) return bestPlain;
  }
  return bestPlain;
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });

  try {
    const ip = getClientIp(req);
    if (rateLimited(ip)) {
      return new Response(JSON.stringify({ success: false, error: 'Too many requests' } satisfies LyricsResponse), {
        status: 429,
        headers: { ...corsHeaders, 'Content-Type': 'application/json', 'Retry-After': '60' },
      });
    }

    const body = await req.json().catch(() => ({}));
    const artist = String(body?.artist || '').trim();
    const title = String(body?.title || '').trim();
    const duration = Number(body?.duration) || undefined;
    const songId = String(body?.songId || '').trim() || undefined;

    if (!artist || !title) {
      return new Response(JSON.stringify({ success: false, error: 'artist and title required' } satisfies LyricsResponse), {
        status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    const cacheKey = `${stripArtistSongId(songId) || 'catalog'}|${clean(artist).toLowerCase()}|${clean(title).toLowerCase()}|${duration || 0}`;
    const cached = cacheGet(cacheKey);
    if (cached) {
      return new Response(JSON.stringify(cached), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json', 'Cache-Control': 'public, max-age=86400', 'X-Cache': 'HIT' },
      });
    }

    const artistLyrics = await fetchArtistUploadLyrics(songId);
    const provider = artistLyrics || await fetchParallelProviders(artist, title, duration);

    const payload: LyricsResponse = {
      success: true,
      synced: provider?.synced || null,
      plain: provider?.plain || null,
      source: provider?.source || null,
    };

    cacheSet(cacheKey, payload);

    return new Response(JSON.stringify(payload), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json', 'Cache-Control': 'public, max-age=86400' },
    });
  } catch (e) {
    console.error('lyrics error', e);
    return new Response(JSON.stringify({ success: false, error: 'An unexpected error occurred' } satisfies LyricsResponse), {
      status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});
