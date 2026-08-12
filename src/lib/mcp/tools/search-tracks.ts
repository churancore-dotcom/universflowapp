import { defineTool } from "@lovable.dev/mcp-js";
import { z } from "zod";
import { sanitizeSearchText, supabaseAnon } from "../supabase";

type Track = {
  title: string;
  artist: string;
  cover_url: string | null;
  source: string;
  duration?: number | null;
  chart_rank?: number | null;
};

export default defineTool({
  name: "search_tracks",
  title: "Search tracks",
  description:
    "Search Univers Flow for songs by title or artist. Covers artist-uploaded releases and the live chart catalog.",
  inputSchema: {
    query: z.string().min(1).describe("Search text (song title or artist name)."),
    limit: z.number().int().min(1).max(50).optional().describe("Max results, default 10."),
  },
  annotations: { readOnlyHint: true, idempotentHint: true, openWorldHint: false },
  handler: async ({ query, limit }) => {
    const supabase = supabaseAnon();
    const n = limit ?? 10;
    const sanitized = sanitizeSearchText(query);

    if (!sanitized) {
      return { content: [{ type: "text", text: "No matches." }], structuredContent: { results: [] } };
    }

    const pattern = `%${sanitized}%`;

    // Artist-uploaded releases first (Univers Flow originals), then the chart catalog.
    const [uploads, charts] = await Promise.all([
      supabase
        .from("artist_songs")
        .select("id, title, cover_url, duration, play_count, artist_profiles(stage_name)")
        .eq("status", "live")
        .ilike("title", pattern)
        .order("play_count", { ascending: false })
        .limit(n),
      supabase
        .from("chart_tracks")
        .select("title, artist, cover_url, rank, chart_type, country_code")
        .or(`title.ilike.${pattern},artist.ilike.${pattern}`)
        .order("rank", { ascending: true })
        .limit(n),
    ]);

    if (uploads.error && charts.error) {
      return {
        content: [{ type: "text", text: `Search failed: ${charts.error.message}` }],
        isError: true,
      };
    }

    const results: Track[] = [];
    for (const row of uploads.data ?? []) {
      const profile = (row as { artist_profiles?: { stage_name?: string } | { stage_name?: string }[] })
        .artist_profiles;
      const stage = Array.isArray(profile) ? profile[0]?.stage_name : profile?.stage_name;
      results.push({
        title: row.title,
        artist: stage ?? "Univers Flow artist",
        cover_url: row.cover_url,
        duration: row.duration,
        source: "universflow_artist",
      });
    }

    const seen = new Set(results.map((r) => `${r.title.toLowerCase()}|${r.artist.toLowerCase()}`));
    for (const row of charts.data ?? []) {
      const key = `${row.title.toLowerCase()}|${row.artist.toLowerCase()}`;
      if (seen.has(key)) continue;
      seen.add(key);
      results.push({
        title: row.title,
        artist: row.artist,
        cover_url: row.cover_url,
        chart_rank: row.rank,
        source: "chart",
      });
    }

    const trimmed = results.slice(0, n);
    return {
      content: [
        {
          type: "text",
          text: trimmed.length ? JSON.stringify(trimmed, null, 2) : `No matches for "${sanitized}".`,
        },
      ],
      structuredContent: { results: trimmed },
    };
  },
});
