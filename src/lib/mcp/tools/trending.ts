import { defineTool } from "@lovable.dev/mcp-js";
import { z } from "zod";
import { supabaseAnon } from "../supabase";

export default defineTool({
  name: "get_trending",
  title: "Get trending tracks",
  description: "Return the current Univers Flow trending chart tracks.",
  inputSchema: {
    limit: z.number().int().min(1).max(50).optional().describe("Max tracks, default 20."),
    chart: z
      .enum(["trending", "viral"])
      .optional()
      .describe("Chart type, default 'trending'."),
    country: z
      .string()
      .regex(/^[A-Za-z]{2}$|^GLOBAL$/i)
      .optional()
      .describe("ISO-3166 country code or GLOBAL (default)."),
  },
  annotations: { readOnlyHint: true, idempotentHint: true, openWorldHint: false },
  handler: async ({ limit, chart, country }) => {
    const supabase = supabaseAnon();
    const n = limit ?? 20;
    const countryCode = (country ?? "GLOBAL").toUpperCase();

    const { data, error } = await supabase
      .from("chart_tracks")
      .select("rank, title, artist, cover_url, chart_type, country_code, source, metadata, fetched_at")
      .eq("chart_type", chart ?? "trending")
      .eq("country_code", countryCode)
      .order("rank", { ascending: true })
      .limit(n);

    if (error) {
      return { content: [{ type: "text", text: `Chart lookup failed: ${error.message}` }], isError: true };
    }

    // `chart_tracks` has no play/listener columns. Real counts come from in-app
    // playback events, exposed by the app_trending_tracks RPC.
    const stats = new Map<string, { plays: number; listeners: number }>();
    const { data: appTrending } = await supabase.rpc("app_trending_tracks", {
      p_country: countryCode === "GLOBAL" ? null : countryCode,
      p_hours: 168,
      p_limit: 500,
    });
    for (const row of (appTrending ?? []) as Array<{
      title: string | null;
      artist: string | null;
      plays: number | null;
      listeners: number | null;
    }>) {
      const key = `${(row.title ?? "").toLowerCase().trim()}|${(row.artist ?? "").toLowerCase().trim()}`;
      stats.set(key, { plays: Number(row.plays ?? 0), listeners: Number(row.listeners ?? 0) });
    }

    const rows = (data ?? []).map((row) => {
      const meta = (row.metadata ?? {}) as Record<string, unknown>;
      const metaPlays = Number(meta.play_count ?? meta.plays ?? 0) || 0;
      const key = `${row.title.toLowerCase().trim()}|${row.artist.toLowerCase().trim()}`;
      const local = stats.get(key);
      const { metadata: _metadata, ...rest } = row;
      return {
        ...rest,
        plays: local?.plays ?? metaPlays,
        listeners: local?.listeners ?? 0,
      };
    });

    return {
      content: [{ type: "text", text: rows.length ? JSON.stringify(rows, null, 2) : "No chart data." }],
      structuredContent: { tracks: rows },
    };
  },
});
