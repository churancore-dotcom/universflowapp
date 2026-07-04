import { defineMcp } from "@lovable.dev/mcp-js";
import searchTracks from "./tools/search-tracks";
import getTrending from "./tools/trending";
import getArtist from "./tools/get-artist";

export default defineMcp({
  name: "universflow-mcp",
  title: "Univers Flow MCP",
  version: "0.1.0",
  instructions:
    "Tools for the Univers Flow music app. Use search_tracks to find songs, get_trending for the chart, and get_artist to fetch an artist's public profile.",
  tools: [searchTracks, getTrending, getArtist],
});
