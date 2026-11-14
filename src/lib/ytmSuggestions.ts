export interface YtmSuggestionItem {
  kind: 'song' | 'video' | 'artist' | 'album';
  title: string;
  subtitle: string;
  thumbnail?: string;
  videoId?: string;
  browseId?: string;
}
export interface YtmSuggestions { queries: string[]; items: YtmSuggestionItem[] }

const runs = (t: any): string => (t?.runs ?? []).map((r: any) => r.text).join('');

/** Parse YouTube Music's get_search_suggestions response (pure, tested). */
export function parseYtmSuggestions(json: any): YtmSuggestions {
  const queries: string[] = [];
  const items: YtmSuggestionItem[] = [];
  for (const sec of json?.contents ?? []) {
    for (const c of sec?.searchSuggestionsSectionRenderer?.contents ?? []) {
      if (c.searchSuggestionRenderer) {
        const q = runs(c.searchSuggestionRenderer.suggestion).trim();
        if (q) queries.push(q);
        continue;
      }
      const r = c.musicResponsiveListItemRenderer;
      if (!r) continue;
      const cols = (r.flexColumns ?? []).map((f: any) => runs(f?.musicResponsiveListItemFlexColumnRenderer?.text));
      const title = (cols[0] || '').trim();
      if (!title) continue;
      const parts = (cols[1] || '').split(' • ').map((s: string) => s.trim()).filter(Boolean);
      const label = (parts[0] || '').toLowerCase();
      const ne = r.navigationEndpoint ?? {};
      const thumbs = r.thumbnail?.musicThumbnailRenderer?.thumbnail?.thumbnails ?? [];
      const thumbnail = thumbs[thumbs.length - 1]?.url?.replace(/=w\d+-h\d+/, '=w240-h240');
      const pageType = ne.browseEndpoint?.browseEndpointContextSupportedConfigs?.browseEndpointContextMusicConfig?.pageType ?? '';
      let kind: YtmSuggestionItem['kind'] | null = null;
      if (ne.watchEndpoint?.videoId) kind = label === 'video' ? 'video' : 'song';
      else if (pageType.includes('ARTIST')) kind = 'artist';
      else if (pageType.includes('ALBUM')) kind = 'album';
      if (!kind) continue;
      const subtitle = (kind === 'artist' ? parts : parts.slice(1)).join(' • ');
      items.push({ kind, title, subtitle, thumbnail, videoId: ne.watchEndpoint?.videoId, browseId: ne.browseEndpoint?.browseId });
    }
  }
  return { queries: queries.slice(0, 7), items: items.slice(0, 6) };
}
