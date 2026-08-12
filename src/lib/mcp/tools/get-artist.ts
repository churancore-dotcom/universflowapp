import { defineTool } from "@lovable.dev/mcp-js";
import { z } from "zod";
import { sanitizeSearchText, supabaseAnon } from "../supabase";

export default defineTool({
  name: "get_artist",
  title: "Get artist profile",
  description: "Fetch a Univers Flow artist public profile by stage name, with follower and play totals.",
  inputSchema: {
    name: z.string().min(1).describe("Artist stage name (case-insensitive, partial match allowed)."),
  },
  annotations: { readOnlyHint: true, idempotentHint: true, openWorldHint: false },
  handler: async ({ name }) => {
    const supabase = supabaseAnon();
    const sanitized = sanitizeSearchText(name);
    if (!sanitized) {
      return { content: [{ type: "text", text: "Provide an artist name." }], isError: true };
    }

    const { data, error } = await supabase
      .from("artist_profiles")
      .select(
        "stage_name, slug, tagline, bio, avatar_url, banner_url, genres, location, country_code, music_platform_url, social_links, is_verified, total_followers, total_likes, total_plays",
      )
      .ilike("stage_name", `%${sanitized}%`)
      .order("total_followers", { ascending: false })
      .limit(1)
      .maybeSingle();

    if (error) {
      return { content: [{ type: "text", text: `Lookup failed: ${error.message}` }], isError: true };
    }
    if (!data) {
      return { content: [{ type: "text", text: `No artist matching "${sanitized}" found.` }] };
    }

    return {
      content: [{ type: "text", text: JSON.stringify(data, null, 2) }],
      structuredContent: { artist: data },
    };
  },
});
