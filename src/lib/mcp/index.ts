import { auth, defineMcp } from "@lovable.dev/mcp-js";
import searchTracks from "./tools/search-tracks";
import getTrending from "./tools/trending";
import getArtist from "./tools/get-artist";

// Direct Supabase issuer (never the .lovable.cloud proxy) so token verification
// matches the discovery document. Built from the inlined project ref.
const projectRef = import.meta.env.VITE_SUPABASE_PROJECT_ID ?? "project-ref-unset";

export default defineMcp({
  name: "universflow-mcp",
  title: "Univers Flow MCP",
  version: "0.1.0",
  instructions:
    "Tools for the Univers Flow music app. Use search_tracks to find songs, get_trending for the chart, and get_artist to fetch an artist's public profile.",
  auth: auth.oauth.issuer({
    issuer: `https://${projectRef}.supabase.co/auth/v1`,
    acceptedAudiences: "authenticated",
  }),
  tools: [searchTracks, getTrending, getArtist],
});
