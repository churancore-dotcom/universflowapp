import { defineTool } from "@lovable.dev/mcp-js";
import { createClient } from "@supabase/supabase-js";
import { z } from "zod";

export default defineTool({
  name: "search_tracks",
  title: "Search tracks",
  description: "Search the Univers Flow catalog for songs by title, artist, or album.",
  inputSchema: {
    query: z.string().min(1).describe("Search text (title, artist, or album)."),
    limit: z.number().int().min(1).max(50).optional().describe("Max results, default 10."),
  },
  annotations: { readOnlyHint: true, idempotentHint: true, openWorldHint: false },
  handler: async ({ query, limit }) => {
    const url = process.env.SUPABASE_URL!;
    const key = process.env.SUPABASE_PUBLISHABLE_KEY || process.env.SUPABASE_ANON_KEY!;
    const supabase = createClient(url, key, { auth: { persistSession: false } });

    const n = limit ?? 10;

    // Strip PostgREST filter metacharacters to prevent .or() filter injection.
    // Users can only search on plain alphanumeric text, spaces, and a small set
    // of safe punctuation (& - ' .). Everything else (commas, parens, %, wildcards,
    // colons, quotes, backslashes) is removed so the raw query can never break out
    // of the ilike operand into arbitrary PostgREST filter conditions.
    const sanitized = String(query)
      .replace(/[^\p{L}\p{N}\s\-'&.]/gu, " ")
      .replace(/\s+/g, " ")
      .trim()
      .slice(0, 80);

    if (!sanitized) {
      return {
        content: [{ type: "text", text: "No matches." }],
        structuredContent: { results: [] },
      };
    }

    const pattern = `%${sanitized}%`;
    const { data, error } = await supabase
      .from("songs")
      .select("id, title, artist, album, cover_url, duration")
      .or(`title.ilike.${pattern},artist.ilike.${pattern},album.ilike.${pattern}`)
      .limit(n);

    if (error) {
      return { content: [{ type: "text", text: `Search failed: ${error.message}` }], isError: true };
    }


    const rows = data ?? [];
    return {
      content: [{ type: "text", text: rows.length ? JSON.stringify(rows, null, 2) : "No matches." }],
      structuredContent: { results: rows },
    };
  },
});
