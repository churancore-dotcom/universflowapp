import { useQuery } from '@tanstack/react-query';
import { getYouTubeMusicCharts, getYouTubeMusicNewReleases, searchYouTubeMusicTracks, type YtmCharts, type IndexedTrack } from '@/lib/musicIndexer';
import type { Song } from '@/contexts/PlayerContext';

/** Convert a YTM IndexedTrack to the app's Song shape. */
function toSong(t: { id: string; title?: string; artist?: string; album?: string; cover_url?: string; audio_url?: string; videoId?: string; duration?: number }): Song | null {
  if (!t.id || !t.title || !t.artist) return null;
  return {
    id: t.id,
    title: t.title,
    artist: t.artist,
    album: t.album,
    cover_url: t.cover_url,
    audio_url: t.audio_url || (t.videoId ? `yt-video:${t.videoId}` : `yt-video:${t.id}`),
    duration: t.duration,
  } as Song;
}

export function useYtmRail(key: string, query: string, limit = 20, enabled = true) {
  // Bucket by day so trending rails silently rotate every 24h without hammering the network.
  const dayBucket = Math.floor(Date.now() / (24 * 60 * 60 * 1000));
  // Append time-sensitive freshness terms for trending/viral/new queries so YTM returns
  // genuinely fresh results instead of the same cached playlist week after week.
  const isFreshRail = /trending|viral|top|new|fresh|chart/i.test(key) || /trending|viral|top songs|new/i.test(query);
  const currentYear = new Date().getFullYear();
  const freshQuery = isFreshRail
    ? `${query} ${currentYear} new release this week`
    : query;

  return useQuery({
    queryKey: ['ytm-rail', key, query, limit, isFreshRail ? dayBucket : 'static'],
    enabled,
    // Trending/viral: 20-min stale so fresh drops appear same-session. Static: 30-min.
    staleTime: isFreshRail ? 20 * 60 * 1000 : 30 * 60 * 1000,
    gcTime: 6 * 60 * 60 * 1000,
    // Auto-refresh trending in the background so users see new releases without reloading.
    refetchInterval: isFreshRail ? 25 * 60 * 1000 : false,
    refetchOnWindowFocus: isFreshRail,
    refetchOnReconnect: true,
    queryFn: async (): Promise<Song[]> => {
      const tracks = await searchYouTubeMusicTracks(freshQuery, limit);
      const seen = new Set<string>();
      const out: Song[] = [];
      for (const t of tracks) {
        if (seen.has(t.id)) continue;
        seen.add(t.id);
        const s = toSong(t);
        if (s) out.push(s);
      }
      return out;
    },
  });
}

export function useYtmNewReleases(country: string, limit = 24, enabled = true) {
  return useQuery({
    queryKey: ['ytm-new-releases', country, limit],
    enabled,
    staleTime: 30 * 60 * 1000,
    gcTime: 6 * 60 * 60 * 1000,
    queryFn: async (): Promise<Song[]> => {
      const tracks = await getYouTubeMusicNewReleases(country, limit);
      const seen = new Set<string>();
      const out: Song[] = [];
      for (const t of tracks) {
        if (seen.has(t.id)) continue;
        seen.add(t.id);
        const s = toSong(t);
        if (s) out.push(s);
      }
      return out;
    },
  });
}

/**
 * Real YouTube Music Charts (FEmusic_charts) — same data music.youtube.com/charts renders.
 * Returns per-country buckets: `top` (Top Songs), `trending` (Trending / fastest-rising),
 * `videos` (Top Music Videos). Refreshes daily on YT's side; we cache 30 min.
 */
export function useYtmCharts(country: string, enabled = true) {
  return useQuery({
    queryKey: ['ytm-charts-v1', (country || 'US').toUpperCase()],
    enabled,
    staleTime: 30 * 60 * 1000,
    gcTime: 6 * 60 * 60 * 1000,
    refetchInterval: 60 * 60 * 1000,
    refetchOnWindowFocus: false,
    refetchOnReconnect: true,
    queryFn: async (): Promise<{ top: Song[]; trending: Song[]; videos: Song[]; country: string }> => {
      const charts = await getYouTubeMusicCharts(country, 40);
      const toList = (arr: IndexedTrack[]): Song[] => {
        const seen = new Set<string>();
        const out: Song[] = [];
        for (const t of arr) {
          if (seen.has(t.id)) continue;
          seen.add(t.id);
          const s = toSong(t);
          if (s) out.push(s);
        }
        return out;
      };
      return {
        top: toList(charts.top),
        trending: toList(charts.trending),
        videos: toList(charts.videos),
        country: charts.country,
      };
    },
  });
}
