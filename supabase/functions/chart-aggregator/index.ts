// Chart aggregator: pulls trending, viral, and latest from free public sources
// Sources: iTunes/Apple Music RSS, Last.fm, YouTube Data API, Deezer
// No API keys required except LASTFM_API_KEY + YOUTUBE_API_KEY (already in secrets)

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const LASTFM_KEY = Deno.env.get("LASTFM_API_KEY") ?? "";
const YT_KEY = Deno.env.get("YOUTUBE_API_KEY") ?? "";

// Countries to aggregate (ISO-2). GLOBAL is special (worldwide).
const COUNTRIES = ["GLOBAL", "US", "IN", "GB", "BR", "DE", "FR", "JP", "KR", "MX", "ID", "CA", "AU", "IT", "ES", "NL", "AE", "SA", "TR", "PH"];

// iTunes RSS country codes are lowercase, e.g. "us", "in"
const itunesCountry = (cc: string) => (cc === "GLOBAL" ? "us" : cc.toLowerCase());

type Row = {
  chart_type: "trending" | "viral" | "latest";
  country_code: string;
  rank: number;
  title: string;
  artist: string;
  cover_url?: string | null;
  source: string;
  external_id?: string | null;
};

// STRICT spam filter — mirrors yt-music-search so Trending Now stays clean.
const SPAM_PATTERNS = [
  /\b(sped\s*up|slowed(\s*\+?\s*reverb)?|nightcore|8\s*d|bass\s*boost(ed)?)\b/i,
  /\b(karaoke|instrumental|backing\s*track)\b/i,
  /\b(cover(\s*by)?|cover\s*version|fan\s*made|unofficial|tribute|ai\s*cover|ai\s*voice)\b/i,
  /\b(lyric\s*video|with\s*lyrics?|tutorial|reaction)\b/i,
  /\b(whatsapp\s*status|ringtone|loop(ed)?|tiktok\s*version|reels?\s*version|shorts?)\b/i,
  /\b\d+\s*(hour|hours|hr|hrs|minute|minutes|min)\b/i,
  /\b(non\s*stop|jukebox|mashup|medley|compilation|full\s*album)\b/i,
];

const isSpamRow = (r: Row) => {
  const hay = `${r.title} ${r.artist}`;
  return SPAM_PATTERNS.some((p) => p.test(hay));
};

const fetchJson = async (url: string, timeoutMs = 8000): Promise<any | null> => {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const r = await fetch(url, { signal: ctrl.signal, headers: { "User-Agent": "Universflow/1.0" } });
    if (!r.ok) return null;
    return await r.json();
  } catch {
    return null;
  } finally {
    clearTimeout(t);
  }
};

// --- Apple Music Most-Played (TRENDING) ---
async function fetchAppleMostPlayed(cc: string): Promise<Row[]> {
  const country = itunesCountry(cc);
  const url = `https://rss.marketingtools.apple.com/api/v2/${country}/music/most-played/50/songs.json`;
  const data = await fetchJson(url);
  const results = data?.feed?.results ?? [];
  return results.map((it: any, i: number) => ({
    chart_type: "trending" as const,
    country_code: cc,
    rank: i + 1,
    title: it.name,
    artist: it.artistName,
    cover_url: it.artworkUrl100?.replace("100x100", "500x500") ?? null,
    source: "apple",
    external_id: it.id,
  }));
}

// --- New Releases (LATEST) ---
// The legacy `itunes.apple.com/*/rss/newreleases` feed was retired by Apple and
// now returns HTTP 400, which is why "New Releases" was permanently empty.
// Replacement: take the country's most-played albums feed, batch-look-up their
// real releaseDate via the iTunes Lookup API (one request), keep only genuinely
// recent records and order newest-first.
async function fetchAppleNewReleases(cc: string): Promise<Row[]> {
  const country = itunesCountry(cc);
  const feed = await fetchJson(
    `https://rss.marketingtools.apple.com/api/v2/${country}/music/most-played/50/albums.json`,
  );
  const ids: string[] = (feed?.feed?.results ?? [])
    .map((r: any) => String(r?.id || ""))
    .filter(Boolean)
    .slice(0, 50);
  if (!ids.length) return [];

  const lookup = await fetchJson(
    `https://itunes.apple.com/lookup?id=${ids.join(",")}&country=${country}&entity=album`,
  );
  const cutoff = Date.now() - 120 * 24 * 60 * 60 * 1000;
  const albums = (lookup?.results ?? [])
    .filter((r: any) => r?.collectionName && r?.artistName && r?.releaseDate)
    .map((r: any) => ({
      title: String(r.collectionName),
      artist: String(r.artistName),
      cover_url: (r.artworkUrl100 || r.artworkUrl60 || "").replace(/\d+x\d+bb/, "500x500bb") || null,
      external_id: String(r.collectionId ?? ""),
      released: Date.parse(r.releaseDate),
    }))
    .filter((r: any) => Number.isFinite(r.released) && r.released >= cutoff)
    .sort((a: any, b: any) => b.released - a.released)
    .slice(0, 50);

  return albums.map((r: any, i: number) => ({
    chart_type: "latest" as const,
    country_code: cc,
    rank: i + 1,
    title: r.title,
    artist: r.artist,
    cover_url: r.cover_url,
    source: "apple",
    external_id: r.external_id || null,
    metadata: { released_at: new Date(r.released).toISOString() },
  })) as Row[];
}


// --- Last.fm (VIRAL/trending globally + per country) ---
async function fetchLastFm(cc: string): Promise<Row[]> {
  if (!LASTFM_KEY) return [];
  const url = cc === "GLOBAL"
    ? `https://ws.audioscrobbler.com/2.0/?method=chart.gettoptracks&api_key=${LASTFM_KEY}&format=json&limit=50`
    : `https://ws.audioscrobbler.com/2.0/?method=geo.gettoptracks&country=${countryNameFromCode(cc)}&api_key=${LASTFM_KEY}&format=json&limit=50`;
  const data = await fetchJson(url);
  const tracks = data?.tracks?.track ?? data?.toptracks?.track ?? [];
  return tracks.map((t: any, i: number) => ({
    chart_type: "viral" as const,
    country_code: cc,
    rank: i + 1,
    title: t.name,
    artist: typeof t.artist === "string" ? t.artist : t.artist?.name ?? "",
    cover_url: t.image?.slice(-1)?.[0]?.["#text"] || null,
    source: "lastfm",
    external_id: t.mbid || null,
  })).filter((r: Row) => r.title && r.artist);
}

// --- YouTube Trending Music (TRENDING fallback per region) ---
async function fetchYouTubeTrending(cc: string): Promise<Row[]> {
  if (!YT_KEY || cc === "GLOBAL") return [];
  const url = `https://www.googleapis.com/youtube/v3/videos?part=snippet&chart=mostPopular&videoCategoryId=10&regionCode=${cc}&maxResults=50&key=${YT_KEY}`;
  const data = await fetchJson(url);
  const items = data?.items ?? [];
  return items.map((it: any, i: number) => {
    const sn = it.snippet ?? {};
    // Try to split "Artist - Title" patterns
    const raw = (sn.title ?? "").replace(/\(.*?official.*?\)/gi, "").trim();
    let title = raw, artist = sn.channelTitle ?? "";
    const dash = raw.split(/\s[-–]\s/);
    if (dash.length >= 2) {
      artist = dash[0].trim();
      title = dash.slice(1).join(" - ").trim();
    }
    return {
      chart_type: "trending" as const,
      country_code: cc,
      rank: i + 1 + 100, // de-rank under Apple
      title,
      artist,
      cover_url: sn.thumbnails?.maxres?.url ?? sn.thumbnails?.high?.url ?? sn.thumbnails?.medium?.url ?? null,
      source: "youtube",
      external_id: it.id,
    };
  }).filter((r: Row) => r.title && r.artist);
}

// --- Deezer Global Chart (VIRAL fallback when Last.fm misses) ---
async function fetchDeezerChart(cc: string): Promise<Row[]> {
  if (cc !== "GLOBAL") return [];
  const url = `https://api.deezer.com/chart/0/tracks?limit=50`;
  const data = await fetchJson(url);
  const tracks = data?.data ?? [];
  return tracks.map((t: any, i: number) => ({
    chart_type: "viral" as const,
    country_code: "GLOBAL",
    rank: i + 1 + 100,
    title: t.title,
    artist: t.artist?.name ?? "",
    cover_url: t.album?.cover_xl ?? t.album?.cover_big ?? null,
    source: "deezer",
    external_id: String(t.id),
  })).filter((r: Row) => r.title && r.artist);
}

function countryNameFromCode(cc: string): string {
  const map: Record<string, string> = {
    US: "United States", IN: "India", GB: "United Kingdom", BR: "Brazil",
    DE: "Germany", FR: "France", JP: "Japan", KR: "South Korea",
    MX: "Mexico", ID: "Indonesia", CA: "Canada", AU: "Australia",
    IT: "Italy", ES: "Spain", NL: "Netherlands", AE: "United Arab Emirates",
    SA: "Saudi Arabia", TR: "Turkey", PH: "Philippines",
  };
  return map[cc] ?? "United States";
}

const CRON_SECRET = Deno.env.get("CRON_SECRET") ?? "";

async function getCronSecret(supabase: ReturnType<typeof createClient>): Promise<string> {
  if (CRON_SECRET.trim()) return CRON_SECRET.trim();
  const { data, error } = await supabase
    .from("internal_secrets")
    .select("value")
    .eq("key", "chart_aggregator_cron_secret")
    .maybeSingle();
  if (error) {
    console.error("chart-aggregator cron secret lookup failed:", error.message);
    return "";
  }
  return typeof data?.value === "string" ? data.value.trim() : "";
}

function safeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let r = 0;
  for (let i = 0; i < a.length; i++) r |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return r === 0;
}

async function isAdminCaller(req: Request): Promise<boolean> {
  const auth = req.headers.get("Authorization") ?? "";
  if (!auth.startsWith("Bearer ")) return false;
  const jwt = auth.slice(7);
  const userClient = createClient(SUPABASE_URL, Deno.env.get("SUPABASE_ANON_KEY") ?? "", {
    global: { headers: { Authorization: `Bearer ${jwt}` } },
  });
  const { data: claims } = await userClient.auth.getClaims(jwt).catch(() => ({ data: null as any }));
  const uid = claims?.claims?.sub;
  if (!uid) return false;
  const admin = createClient(SUPABASE_URL, SERVICE_KEY);
  const { data, error } = await admin.rpc("has_role", { _user_id: uid, _role: "admin" });
  if (error) return false;
  return data === true;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  const supabase = createClient(SUPABASE_URL, SERVICE_KEY);

  // Authorize: matching CRON_SECRET header (scheduler) OR admin JWT (manual trigger).
  const cronHeader = req.headers.get("x-cron-secret") ?? "";
  const cronSecret = await getCronSecret(supabase);
  const cronOk = cronHeader.length > 0 && cronSecret.length > 0 && safeEqual(cronHeader, cronSecret);
  if (!cronOk) {
    const adminOk = await isAdminCaller(req);
    if (!adminOk) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), {
        status: 401,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
  }

  const startedAt = Date.now();

  // Optional: ?country=IN to refresh a single country, otherwise all
  const url = new URL(req.url);
  const onlyCountry = url.searchParams.get("country");
  const targets = onlyCountry ? [onlyCountry.toUpperCase()] : COUNTRIES;

  let totalInserted = 0;
  const summary: Record<string, number> = {};

  for (const cc of targets) {
    const [apple, itunes, lastfm, yt, deezer] = await Promise.all([
      fetchAppleMostPlayed(cc),
      fetchItunesNewReleases(cc),
      fetchLastFm(cc),
      fetchYouTubeTrending(cc),
      fetchDeezerChart(cc),
    ]);

    const rawRows: Row[] = [...apple, ...itunes, ...lastfm, ...yt, ...deezer];
    const rows = rawRows.filter((r) => !isSpamRow(r));
    if (rows.length === 0) {
      summary[cc] = 0;
      continue;
    }

    // Wipe + replace per country (atomic-ish)
    await supabase.from("chart_tracks").delete().eq("country_code", cc);

    // Insert in batches of 500
    for (let i = 0; i < rows.length; i += 500) {
      const batch = rows.slice(i, i + 500);
      const { error } = await supabase.from("chart_tracks").insert(batch);
      if (error) console.error(`[${cc}] insert error:`, error.message);
      else totalInserted += batch.length;
    }
    summary[cc] = rows.length;
  }

  const tookMs = Date.now() - startedAt;
  return new Response(
    JSON.stringify({ ok: true, totalInserted, tookMs, summary }),
    { headers: { ...corsHeaders, "Content-Type": "application/json" } }
  );
});
