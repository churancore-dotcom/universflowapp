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

type Source = 'artist' | 'lrclib' | 'kugou' | 'netease' | 'qqmusic' | 'lyricsovh' | 'lyricsplus' | 'unison';

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
const LRC_UA = { 'User-Agent': 'Universflow/1.0 (https://universflow.in)' };

/**
 * Match verification — a lyrics row is only usable when BOTH the track title
 * and the artist credit line up with what is actually playing. Wrong lyrics are
 * worse than no lyrics, so anything we cannot verify is discarded.
 */
function normKey(s: string): string {
  return clean(String(s || '')).toLowerCase()
    .replace(/[’'`´]/g, '')
    .replace(/[^a-z0-9\u4e00-\u9fff\u3040-\u30ff\uac00-\ud7af ]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}
function tokensOf(s: string): string[] { return normKey(s).split(' ').filter(Boolean); }

export function titleMatches(want: string, got: string): boolean {
  const a = normKey(want), b = normKey(got);
  if (!a || !b) return false;
  if (a === b) return true;
  const at = tokensOf(a), bt = tokensOf(b);
  if (!at.length || !bt.length) return false;
  const overlap = at.filter((t) => bt.includes(t)).length;
  const ratio = overlap / Math.max(at.length, bt.length);
  // Allow a suffix/prefix difference (e.g. "Self Aware" vs "Self Aware (Demo)")
  // but never a merely-similar title.
  if (a.includes(b) || b.includes(a)) return ratio >= 0.6;
  return ratio >= 0.9;
}

export function artistMatches(want: string, got: string): boolean {
  const g = normKey(got);
  if (!want || !g || g.length < 2) return false;
  const wants = splitArtists(want).map(normKey).filter((w) => w.length >= 2);
  return wants.some((w) => g === w || g.includes(w) || w.includes(g));
}

/** Pick the best verified synced hit; unverified rows are rejected outright. */
function pickLrclib(arr: any[], wantArtist: string, wantTitle: string, durationSec?: number): { synced?: string; plain?: string } | null {
  if (!Array.isArray(arr) || arr.length === 0) return null;
  const verified = arr.filter((x: any) => {
    if (!titleMatches(wantTitle, x?.trackName || '')) return false;
    if (artistMatches(wantArtist, x?.artistName || '')) return true;
    // No artist confirmation: only accept on a near-exact duration match.
    const d = Number(x?.duration) || 0;
    return !!durationSec && durationSec > 0 && d > 0 && Math.abs(d - durationSec) <= 2;
  });
  if (!verified.length) return null;

  const syncedRows = verified.filter((x: any) => x?.syncedLyrics);
  if (syncedRows.length) {
    if (durationSec && durationSec > 0) {
      const scored = syncedRows
        .map((x: any) => ({ x, diff: Math.abs((Number(x?.duration) || 0) - durationSec) }))
        .sort((a, b) => a.diff - b.diff);
      const near = scored.find((s) => s.diff <= 5) || scored[0];
      if (near) return { synced: near.x.syncedLyrics, plain: near.x.plainLyrics || undefined };
    }
    return { synced: syncedRows[0].syncedLyrics, plain: syncedRows[0].plainLyrics || undefined };
  }
  const plainRow = verified.find((x: any) => x?.plainLyrics);
  return plainRow ? { plain: plainRow.plainLyrics } : null;
}

async function lrcJson(url: string): Promise<any | null> {
  try {
    const r = await fetch(url, { headers: LRC_UA });
    if (!r.ok) return null;
    return await r.json();
  } catch { return null; }
}

async function fetchLrclibOne(artist: string, title: string, durationSec?: number): Promise<{ synced?: string; plain?: string } | null> {
  if (!artist || !title) return null;
  // Tier 1 — exact artist + title + duration (LRCLIB does the matching).
  if (durationSec && durationSec > 0) {
    const j = await lrcJson(
      `https://lrclib.net/api/get?artist_name=${encodeURIComponent(artist)}&track_name=${encodeURIComponent(title)}&duration=${Math.round(durationSec)}`,
    );
    if (j && (j.syncedLyrics || j.plainLyrics) && titleMatches(title, j.trackName || title)) {
      return { synced: j.syncedLyrics || undefined, plain: j.plainLyrics || undefined };
    }
  }
  // Tier 2 — search by artist + title, verified locally, closest duration wins.
  const t2 = pickLrclib(
    await lrcJson(`https://lrclib.net/api/search?artist_name=${encodeURIComponent(artist)}&track_name=${encodeURIComponent(title)}`),
    artist, title, durationSec,
  );
  if (t2?.synced) return t2;
  // Tier 3 — free-text combined query, still verified against artist + title.
  const t3 = pickLrclib(
    await lrcJson(`https://lrclib.net/api/search?q=${encodeURIComponent(`${artist} ${title}`)}`),
    artist, title, durationSec,
  );
  if (t3?.synced) return t3;
  return t2 || t3 || null;
}



async function fetchLrclibAll(artist: string, title: string, duration?: number): Promise<{ synced?: string; plain?: string } | null> {
  const variants = buildVariants(artist, title);
  let bestPlain: { synced?: string; plain?: string } | null = null;
  for (const v of variants) {
    const r = await withTimeout(fetchLrclibOne(v.artist, v.title, duration), 4200);
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
    const cands = Array.isArray(sj?.candidates) ? sj.candidates : [];
    // Only accept a candidate whose song + singer actually match the track.
    const cand = cands.find((c: any) =>
      titleMatches(title, c?.song || '') && artistMatches(artist, c?.singer || ''),
    );
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
    // Require BOTH title and artist to line up — no "first result" fallback.
    const pick = songs.find((s: any) => {
      const sa = Array.isArray(s?.artists) ? s.artists.map((a: any) => String(a?.name || '')) : [];
      return titleMatches(title, s?.name || '') && sa.some((n: string) => artistMatches(artist, n));
    });
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
    const list = Array.isArray(j?.data?.song?.list) ? j.data.song.list : [];
    const song = list.find((s: any) => {
      const singers = Array.isArray(s?.singer) ? s.singer.map((x: any) => String(x?.name || '')) : [];
      return titleMatches(title, s?.songname || s?.songorig || '')
        && singers.some((n: string) => artistMatches(artist, n));
    });
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

// ───────── LyricsPlus mirror network ─────────
// Community mirrors of the same index; any one of them can be down, so all are
// raced and the last winner is promoted to the front of the list next time.
const LP_SERVERS = [
  'https://lyricsplus.prjktla.my.id',
  'https://lyricsplus.atomix.one',
  'https://lyricsplus.binimum.org',
  'https://lyricsplus.prjktla.workers.dev',
  'https://lyricsplus-seven.vercel.app',
  'https://lyrics-plus-backend.vercel.app',
];
let lpLastWorking: string | null = null;

/** Word/syllable-timed lines → standard `[mm:ss.xx]` LRC. */
function lpToLrc(items: any[]): string | undefined {
  const lines: string[] = [];
  for (const it of items) {
    const ms = Number(it?.time);
    const text = String(it?.text || '').trim();
    if (!Number.isFinite(ms) || !text) continue;
    const total = Math.max(0, Math.round(ms));
    const mm = String(Math.floor(total / 60000)).padStart(2, '0');
    const ss = String(Math.floor((total % 60000) / 1000)).padStart(2, '0');
    const cs = String(Math.floor((total % 1000) / 10)).padStart(2, '0');
    lines.push(`[${mm}:${ss}.${cs}]${text}`);
  }
  return lines.length >= 4 ? lines.join('\n') : undefined;
}

async function fetchLyricsPlusFrom(
  server: string,
  artist: string,
  title: string,
  durationSec?: number,
): Promise<{ synced?: string; plain?: string } | null> {
  const qs = new URLSearchParams({ title: clean(title), artist: clean(artist) });
  if (durationSec && durationSec > 0) qs.set('duration', String(Math.round(durationSec)));
  const r = await fetch(`${server}/v2/lyrics/get?${qs.toString()}`, {
    headers: { 'User-Agent': 'Universflow/1.0' },
  });
  if (!r.ok) return null;
  const j = await r.json();
  const synced = typeof j?.syncedLyrics === 'string' && j.syncedLyrics.includes('[')
    ? j.syncedLyrics
    : (Array.isArray(j?.lyrics) ? lpToLrc(j.lyrics) : undefined);
  const plain = typeof j?.plainLyrics === 'string' && j.plainLyrics.trim().length >= 15
    ? j.plainLyrics.trim()
    : undefined;
  if (!synced && !plain) return null;
  lpLastWorking = server;
  return { synced, plain };
}

async function fetchLyricsPlus(
  artist: string,
  title: string,
  durationSec?: number,
): Promise<{ synced?: string; plain?: string } | null> {
  const ordered = lpLastWorking
    ? [lpLastWorking, ...LP_SERVERS.filter((s) => s !== lpLastWorking)]
    : LP_SERVERS;
  const tasks = ordered.map((s) =>
    fetchLyricsPlusFrom(s, artist, title, durationSec).catch(() => null),
  );
  // First mirror with real content wins; the rest are abandoned.
  const results = await Promise.all(tasks.map((p) => withTimeout(p, 4000)));
  return results.find((r) => r?.synced) || results.find((r) => r?.plain) || null;
}

// ───────── Unison (server-side matching, LRC out) ─────────
async function fetchUnison(
  artist: string,
  title: string,
  durationSec?: number,
): Promise<{ synced?: string; plain?: string } | null> {
  try {
    const qs = new URLSearchParams({ song: clean(title), artist: clean(artist) });
    if (durationSec && durationSec > 0) qs.set('duration', String(Math.round(durationSec)));
    const r = await fetch(`https://unison.boidu.dev/lyrics?${qs.toString()}`, {
      headers: { 'User-Agent': 'Universflow/1.0' },
    });
    if (!r.ok) return null;
    const j = await r.json();
    const entry = Array.isArray(j?.data) ? j.data[0] : j?.data;
    const body = String(entry?.lyrics || '').trim();
    if (!body) return null;
    if (body.includes('[')) return { synced: body };
    return body.length >= 15 ? { plain: body } : null;
  } catch {
    return null;
  }
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
    withTimeout(fetchLrclibAll(artist, title, duration), 7000).then((r) => r ? { ...r, source: 'lrclib' as const } : null),
    withTimeout(fetchKugou(artist, title, duration), 3000).then((r) => r ? { ...r, source: 'kugou' as const } : null),
    withTimeout(fetchNetease(artist, title), 3000).then((r) => r ? { ...r, source: 'netease' as const } : null),
    withTimeout(fetchQQMusic(artist, title), 3000).then((r) => r ? { ...r, source: 'qqmusic' as const } : null),
    withTimeout(fetchLyricsOvh(artist, title), 3200).then((r) => r ? { ...r, source: 'lyricsovh' as const } : null),
    withTimeout(fetchLyricsPlus(artist, title, duration), 4200).then((r) => r ? { ...r, source: 'lyricsplus' as const } : null),
    withTimeout(fetchUnison(artist, title, duration), 3500).then((r) => r ? { ...r, source: 'unison' as const } : null),

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

/** Aggressive title normalisation for the fallback pass. */
function bareTitle(title: string): string {
  return clean(title)
    .replace(/\([^)]*\)/g, '')
    .replace(/\[[^\]]*\]/g, '')
    .replace(/\s*[-–—]\s*.*$/, '')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * Coverage pass: the strict (artist, title) query misses whenever the catalog
 * title carries video/mix suffixes or a multi-artist credit string. Retry with
 * progressively looser variants so "no lyrics found" becomes rare.
 */
async function fetchWithFallbacks(
  artist: string,
  title: string,
  duration?: number,
): Promise<{ provider: ProviderLyrics | null; attempt: number }> {
  const primaryArtist = splitArtists(artist)[0] || artist;
  const stripped = bareTitle(title);

  const variants: Array<{ artist: string; title: string; duration?: number }> = [
    { artist, title, duration },
  ];
  if (primaryArtist && primaryArtist !== artist) variants.push({ artist: primaryArtist, title });
  if (stripped && stripped !== clean(title)) variants.push({ artist: primaryArtist, title: stripped });
  // NOTE: no artist-less variant — a title-only lookup is exactly how another
  // song's lyrics used to end up on screen.

  for (let i = 0; i < variants.length; i++) {
    const v = variants[i];
    const provider = await fetchParallelProviders(v.artist, v.title, v.duration);
    if (provider?.synced || provider?.plain) return { provider, attempt: i + 1 };
  }
  return { provider: null, attempt: variants.length };
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
    let attempt = 0;
    let provider: ProviderLyrics | null = artistLyrics;
    if (!provider) {
      const res = await fetchWithFallbacks(artist, title, duration);
      provider = res.provider;
      attempt = res.attempt;
    }

    const payload: LyricsResponse = {
      success: true,
      synced: provider?.synced || null,
      plain: provider?.plain || null,
      source: provider?.source || null,
    };

    cacheSet(cacheKey, payload);

    return new Response(JSON.stringify(payload), {
      headers: {
        ...corsHeaders,
        'Content-Type': 'application/json',
        'Cache-Control': 'public, max-age=86400',
        'X-Lyrics-Source': provider?.source || 'none',
        'X-Lyrics-Attempt': String(attempt),
      },
    });

  } catch (e) {
    console.error('lyrics error', e);
    return new Response(JSON.stringify({ success: false, error: 'An unexpected error occurred' } satisfies LyricsResponse), {
      status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});
