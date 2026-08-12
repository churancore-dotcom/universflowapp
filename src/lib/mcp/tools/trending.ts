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

    const { data, error } = await supabase
      .from("chart_tracks")
      .select("rank, title, artist, cover_url, chart_type, country_code, source, fetched_at")
      .eq("chart_type", chart ?? "trending")
      .eq("country_code", (country ?? "GLOBAL").toUpperCase())
      .order("rank", { ascending: true })
      .limit(n);

    if (error) {
      return { content: [{ type: "text", text: `Chart lookup failed: ${error.message}` }], isError: true };
    }

    const rows = data ?? [];
    return {
      content: [{ type: "text", text: rows.length ? JSON.stringify(rows, null, 2) : "No chart data." }],
      structuredContent: { tracks: rows },
    };
  },
});
