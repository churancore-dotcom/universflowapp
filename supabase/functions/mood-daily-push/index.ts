// Daily mood-based push notification. Infers mood from recent plays + hour
// using Google Gemini (free tier), then sends ONE push per eligible user
// with a real viral song matching that mood. Triggered by pg_cron.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const MOOD_TEMPLATES: Record<string, { title: string; body: (s: string, a: string) => string }> = {
  sad:       { title: "Feeling low?",      body: (s, a) => `“${s}” by ${a} might lift your mood` },
  chill:     { title: "Time to unwind",    body: (s, a) => `“${s}” by ${a} fits your vibe right now` },
  hype:      { title: "Pump it up 🔥",      body: (s, a) => `“${s}” by ${a} is going viral — turn it loud` },
  focus:     { title: "Lock in",           body: (s, a) => `“${s}” by ${a} for your flow state` },
  romantic:  { title: "Set the mood",      body: (s, a) => `“${s}” by ${a} — pure feels` },
  power:     { title: "Own the night ⚡",   body: (s, a) => `“${s}” by ${a} — power mode unlocked` },
  happy:     { title: "Good vibes only",   body: (s, a) => `“${s}” by ${a} is making everyone smile today` },
};

async function inferMood(songs: string[], hour: number, apiKey: string): Promise<string> {
  if (songs.length === 0) return hour >= 22 || hour < 6 ? "chill" : "hype";
  const prompt = `Given recent songs played by a user and the local hour, output ONE mood word from: sad, chill, hype, focus, romantic, power, happy. JSON only.\n\nHour: ${hour}\nSongs: ${songs.slice(0, 10).join(" | ")}\n\nRespond: {"mood":"<word>"}`;
  try {
    const res = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent?key=${apiKey}`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          contents: [{ parts: [{ text: prompt }] }],
          generationConfig: { responseMimeType: "application/json", temperature: 0.3 },
        }),
      },
    );
    if (!res.ok) return "chill";
    const data = await res.json();
    const text = data?.candidates?.[0]?.content?.parts?.[0]?.text ?? "";
    const parsed = JSON.parse(text);
    const m = String(parsed.mood || "").toLowerCase().trim();
    return MOOD_TEMPLATES[m] ? m : "chill";
  } catch {
    return "chill";
  }
}

function safeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let r = 0;
  for (let i = 0; i < a.length; i++) r |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return r === 0;
}

async function isAuthorized(req: Request, admin: ReturnType<typeof createClient>): Promise<boolean> {
  const header = req.headers.get("x-cron-secret") ?? "";
  if (!header) return false;
  const envSecret = (Deno.env.get("CRON_SECRET") ?? "").trim();
  if (envSecret && safeEqual(header, envSecret)) return true;
  const { data } = await admin
    .from("internal_secrets")
    .select("value")
    .eq("key", "chart_aggregator_cron_secret")
    .maybeSingle();
  const secret = typeof data?.value === "string" ? data.value.trim() : "";
  return secret.length > 0 && safeEqual(header, secret);
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  try {
    const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
    const SERVICE_ROLE = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const GEMINI_KEY = Deno.env.get("GEMINI_API_KEY");
    if (!GEMINI_KEY) {
      return new Response(JSON.stringify({ error: "Server misconfigured" }), {
        status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const admin = createClient(SUPABASE_URL, SERVICE_ROLE);

    if (!(await isAuthorized(req, admin))) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), {
        status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }


    // Eligible users: opted-in, has device token, not pushed in last 18h, played something last 24h
    const { data: candidates } = await admin
      .from("profiles")
      .select("user_id, country_code, last_mood_push_at, mood_pushes_enabled")
      .eq("mood_pushes_enabled", true)
      .or("last_mood_push_at.is.null,last_mood_push_at.lt." + new Date(Date.now() - 18 * 3600 * 1000).toISOString())
      .limit(500);

    const results: Array<{ user: string; mood: string; ok: boolean }> = [];

    for (const p of candidates ?? []) {
      // Recent plays
      const { data: plays } = await admin
        .from("song_play_events")
        .select("title, artist, country_code")
        .eq("user_id", p.user_id)
        .gte("created_at", new Date(Date.now() - 24 * 3600 * 1000).toISOString())
        .order("created_at", { ascending: false })
        .limit(10);

      if (!plays || plays.length < 3) continue; // need signal

      const songs = plays.map((x) => `${x.title} - ${x.artist}`);
      const hour = new Date().getUTCHours(); // approximate; could be refined per-country
      const mood = await inferMood(songs, hour, GEMINI_KEY);
      const country = p.country_code || plays[0]?.country_code || null;

      // Pick a real viral track matching mood region; fallback to global
      const { data: picks } = await admin
        .from("chart_tracks")
        .select("title, artist, country_code")
        .or(country ? `country_code.eq.${country},country_code.is.null` : "country_code.is.null")
        .order("rank", { ascending: true })
        .limit(20);

      if (!picks?.length) continue;
      const pick = picks[Math.floor(Math.random() * Math.min(picks.length, 10))];
      const tpl = MOOD_TEMPLATES[mood];

      // Send via internal system-push function
      const { data: secret } = await admin
        .from("internal_secrets").select("value").eq("key", "system_push_token").maybeSingle();
      const { data: urlRow } = await admin
        .from("app_settings").select("value").eq("key", "edge_send_system_push_url").maybeSingle();
      const url = String((urlRow?.value as unknown) ?? "").replace(/^"|"$/g, "");
      if (!url || !secret?.value) continue;

      const pushRes = await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          user_ids: [p.user_id],
          title: tpl.title,
          body: tpl.body(pick.title, pick.artist),
          deep_link: pick.deep_link || `/search?q=${encodeURIComponent(pick.title + " " + pick.artist)}`,
          system_token: secret.value,
        }),
      });

      const ok = pushRes.ok;
      if (ok) {
        await admin.from("profiles")
          .update({ last_mood_push_at: new Date().toISOString() })
          .eq("user_id", p.user_id);
      }
      results.push({ ok });
    }

    const sent = results.filter((r) => r.ok).length;
    return new Response(JSON.stringify({ processed: results.length, sent }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (e) {
    console.error("mood-daily-push error", e);
    return new Response(JSON.stringify({ error: "An unexpected error occurred" }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
