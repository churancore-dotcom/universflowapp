import { defineTool } from "@lovable.dev/mcp-js";
import { createClient } from "@supabase/supabase-js";
import { z } from "zod";

export default defineTool({
  name: "get_artist",
  title: "Get artist profile",
  description: "Fetch a Univers Flow artist public profile by stage name.",
  inputSchema: {
    name: z.string().min(1).describe("Artist stage name (case-insensitive)."),
  },
  annotations: { readOnlyHint: true, idempotentHint: true, openWorldHint: false },
  handler: async ({ name }) => {
    const url = process.env.SUPABASE_URL!;
    const key = process.env.SUPABASE_PUBLISHABLE_KEY || process.env.SUPABASE_ANON_KEY!;
    const supabase = createClient(url, key, { auth: { persistSession: false } });

    const { data, error } = await supabase
      .from("artist_profiles")
      .select("stage_name, bio, avatar_url, follower_count, music_platform_url, verified")
      .ilike("stage_name", name)
      .limit(1)
      .maybeSingle();

    if (error) {
      return { content: [{ type: "text", text: `Lookup failed: ${error.message}` }], isError: true };
    }
    if (!data) {
      return { content: [{ type: "text", text: `No artist named "${name}" found.` }] };
    }
    return {
      content: [{ type: "text", text: JSON.stringify(data, null, 2) }],
      structuredContent: { artist: data },
    };
  },
});
