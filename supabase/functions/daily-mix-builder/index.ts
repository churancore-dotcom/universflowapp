// Daily-Mix Builder — runs nightly from pg_cron (04:10 UTC).
// For every active user (>= 5 plays in last 14d), builds up to 3 Daily Mix
// auto-playlists bucketed by top artist, with 24h expiry.

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { corsHeaders } from "npm:@supabase/supabase-js@2/cors";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

const MIN_PLAYS_FOR_DAILY = 5;
const MAX_MIXES_PER_USER = 3;
const TRACKS_PER_MIX = 20;
const ACTIVE_WINDOW_DAYS = 14;

type HistoryRow = { user_id: string; track_id: string; created_at: string; action: string };

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function buildForUser(
  admin: ReturnType<typeof createClient>,
  userId: string,
  history: HistoryRow[],
) {
  const trackIds = Array.from(new Set(history.map((h) => h.track_id)));
  if (trackIds.length < MIN_PLAYS_FOR_DAILY) return 0;

  const { data: songs } = await admin
    .from("stream_songs")
    .select("track_id, title, artist, cover_url")
    .in("track_id", trackIds.slice(0, 100));

  if (!songs || songs.length === 0) return 0;

  const buckets = new Map<string, Set<string>>();
  for (const s of songs as any[]) {
    const artist = (s.artist || "").toLowerCase().split(/[,&/]/)[0]?.trim();
    if (!artist) continue;
    if (!buckets.has(artist)) buckets.set(artist, new Set());
    buckets.get(artist)!.add(s.track_id);
  }

  const topBuckets = [...buckets.entries()]
    .sort((a, b) => b[1].size - a[1].size)
    .slice(0, MAX_MIXES_PER_USER);

  if (topBuckets.length === 0) return 0;

  await admin.from("auto_playlists").delete().eq("user_id", userId).eq("kind", "daily_mix");

  let inserted = 0;
  for (let i = 0; i < topBuckets.length; i++) {
    const [artistKey] = topBuckets[i];

    const { data: pool } = await admin
      .from("stream_songs")
      .select("track_id, title, artist, cover_url")
      .ilike("artist", `%${artistKey}%`)
      .limit(60);

    if (!pool || pool.length === 0) continue;

    const seen = new Set<string>();
    const picks: any[] = [];
    for (const p of pool as any[]) {
      if (seen.has(p.track_id)) continue;
      seen.add(p.track_id);
      picks.push({
        track_id: p.track_id,
        title: p.title,
        artist: p.artist,
        cover_url: p.cover_url,
      });
      if (picks.length >= TRACKS_PER_MIX) break;
    }
    if (picks.length < 5) continue;

    const titleCase = artistKey.replace(/\b\w/g, (c) => c.toUpperCase());
    const covers = picks.slice(0, 4).map((p) => p.cover_url).filter(Boolean);

    const { error } = await admin.from("auto_playlists").insert({
      user_id: userId,
      kind: "daily_mix",
      title: `Daily Mix ${i + 1}`,
      subtitle: `${titleCase} & similar`,
      seed_song_id: [...topBuckets[i][1]][0] || null,
      tracks: picks,
      cover_urls: covers,
      expires_at: new Date(Date.now() + 26 * 3600 * 1000).toISOString(),
    });
    if (!error) inserted++;
  }
  return inserted;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  // Auth gate: require cron secret OR admin JWT (mirrors chart-aggregator)
  const cronHeader = req.headers.get("x-cron-secret") ?? "";
  const cronSecret = Deno.env.get("CRON_SECRET") ?? "";
  let authorized = !!cronSecret && cronHeader === cronSecret;

  // Same stored cron secret the chart and mood jobs use. The nightly schedule
  // used to send no secret at all, so Daily Mixes were never rebuilt.
  if (!authorized && cronHeader) {
    try {
      const svc = createClient(SUPABASE_URL, SERVICE_KEY);
      const { data } = await svc.from("internal_secrets").select("value")
        .eq("key", "chart_aggregator_cron_secret").maybeSingle();
      const stored = typeof data?.value === "string" ? data.value.trim() : "";
      authorized = stored.length > 0 && stored === cronHeader.trim();
    } catch (_) { /* fall through to admin check */ }
  }

  if (!authorized) {
    const authHeader = req.headers.get("Authorization") ?? "";
    if (authHeader.startsWith("Bearer ")) {
      try {
        const userClient = createClient(SUPABASE_URL, Deno.env.get("SUPABASE_ANON_KEY")!, {
          global: { headers: { Authorization: authHeader } },
        });
        const token = authHeader.replace("Bearer ", "");
        const { data } = await userClient.auth.getClaims(token);
        const uid = data?.claims?.sub;
        if (uid) {
          const { data: roleRow } = await userClient
            .from("user_roles")
            .select("role")
            .eq("user_id", uid)
            .eq("role", "admin")
            .maybeSingle();
          if (roleRow) authorized = true;
        }
      } catch (_) { /* ignore */ }
    }
  }

  if (!authorized) {
    return new Response(JSON.stringify({ error: "Unauthorized" }), {
      status: 401,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  const admin = createClient(SUPABASE_URL, SERVICE_KEY);
  const since = new Date(Date.now() - ACTIVE_WINDOW_DAYS * 86400 * 1000).toISOString();

  const { data: activeRows } = await admin
    .from("song_play_events")
    .select("user_id")
    .gte("created_at", since)
    .eq("action", "stream")
    .not("user_id", "is", null)
    .limit(5000);

  const activeUsers = Array.from(
    new Set((activeRows || []).map((r: any) => r.user_id)),
  ).filter(Boolean);

  let totalMixes = 0;
  let users = 0;
  for (const userId of activeUsers as string[]) {
    const { data: history } = await admin
      .from("song_play_events")
      .select("user_id, track_id, created_at, action")
      .eq("user_id", userId)
      .eq("action", "stream")
      .gte("created_at", since)
      .order("created_at", { ascending: false })
      .limit(200);

    if (!history || history.length < MIN_PLAYS_FOR_DAILY) continue;
    try {
      const n = await buildForUser(admin, userId, history as HistoryRow[]);
      totalMixes += n;
      users++;
    } catch (e) {
      console.error(`daily-mix-builder user ${userId}:`, (e as Error).message);
    }
    await sleep(40);
  }

  return new Response(
    JSON.stringify({ ok: true, users_processed: users, mixes_written: totalMixes }),
    { headers: { ...corsHeaders, "Content-Type": "application/json" } },
  );
});
