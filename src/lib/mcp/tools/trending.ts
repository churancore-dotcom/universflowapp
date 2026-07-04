import { defineTool } from "@lovable.dev/mcp-js";
import { createClient } from "@supabase/supabase-js";
import { z } from "zod";

export default defineTool({
  name: "get_trending",
  title: "Get trending tracks",
  description: "Return the current Univers Flow trending chart tracks.",
  inputSchema: {
    limit: z.number().int().min(1).max(50).optional().describe("Max tracks, default 20."),
  },
  annotations: { readOnlyHint: true, idempotentHint: true, openWorldHint: false },
  handler: async ({ limit }) => {
    const url = process.env.SUPABASE_URL!;
    const key = process.env.SUPABASE_PUBLISHABLE_KEY || process.env.SUPABASE_ANON_KEY!;
    const supabase = createClient(url, key, { auth: { persistSession: false } });

    const n = limit ?? 20;
    const { data, error } = await supabase
      .from("chart_tracks")
      .select("rank, title, artist, cover_url, listeners")
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
