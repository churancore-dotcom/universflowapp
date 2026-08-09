import { useQuery } from '@tanstack/react-query';
import { getYouTubeMusicCharts, getYouTubeMusicNewReleases, searchYouTubeMusicTracks, type IndexedTrack } from '@/lib/musicIndexer';
import type { Song } from '@/contexts/PlayerContext';
import { cleanRail } from '@/lib/railQuality';


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

// Refresh rails every hour, not every day → real "trending / new" behaviour.
function hourBucket() { return Math.floor(Date.now() / (60 * 60 * 1000)); }

export function useYtmRail(key: string, query: string, limit = 20, enabled = true) {
  const isFreshRail = /trending|viral|top|new|fresh|chart/i.test(key) || /trending|viral|top songs|new/i.test(query);
  const currentYear = new Date().getFullYear();
  const freshQuery = isFreshRail
    ? `${query} ${currentYear} new release this week`
    : query;

  return useQuery({
    queryKey: ['ytm-rail-v2', key, query, limit, isFreshRail ? hourBucket() : 'static'],
    enabled,
    // Trending/viral: 10-min stale so new drops surface fast. Static: 30-min.
    staleTime: isFreshRail ? 10 * 60 * 1000 : 30 * 60 * 1000,
    gcTime: 6 * 60 * 60 * 1000,
    refetchInterval: isFreshRail ? 15 * 60 * 1000 : false,
    refetchOnWindowFocus: isFreshRail,
    refetchOnReconnect: true,
    queryFn: async (): Promise<Song[]> => {
      const tracks = await searchYouTubeMusicTracks(freshQuery, Math.max(limit, 40));
      const seen = new Set<string>();
      const out: Song[] = [];
      for (const t of tracks) {
        if (seen.has(t.id)) continue;
        seen.add(t.id);
        const s = toSong(t);
        if (s) out.push(s);
      }
      // Reshuffle per session so rails don't repeat identical order.
      // The API returns newest-first; do not randomize recency into an old-looking rail.
      return out.slice(0, limit);
    },
  });
}

export function useYtmNewReleases(country: string, limit = 24, enabled = true) {
  return useQuery({
    queryKey: ['ytm-new-releases-v3', country, limit, hourBucket()],
    enabled,
    staleTime: 10 * 60 * 1000,
    gcTime: 6 * 60 * 60 * 1000,
    refetchInterval: 20 * 60 * 1000,
    refetchOnWindowFocus: true,
    refetchOnReconnect: true,
    queryFn: async (): Promise<Song[]> => {
      const tracks = await getYouTubeMusicNewReleases(country, Math.max(limit, 40));
      const out: Song[] = [];
      for (const t of tracks) {
        // A release tile with no artwork or no artist is not a real release
        // card — those are the "mock looking" rows users complain about.
        if (!t.cover_url || !t.artist) continue;
        const s = toSong(t);
        if (s) out.push(s);
      }
      // YouTube returns new releases newest-first. Shuffling that is exactly
      // what made the rail look like random old songs, so order is preserved;
      // cleanRail only removes junk/duplicates in place.
      return cleanRail(out, { requireCover: true }).slice(0, limit);
    },

  });
}


/**
 * Real YouTube Music Charts (FEmusic_charts) — same data music.youtube.com/charts renders.
 */
export function useYtmCharts(country: string, enabled = true) {
  return useQuery({
    queryKey: ['ytm-charts-v2', (country || 'ZZ').toUpperCase(), hourBucket()],
    enabled,
    staleTime: 10 * 60 * 1000,
    gcTime: 6 * 60 * 60 * 1000,
    refetchInterval: 30 * 60 * 1000,
    refetchOnWindowFocus: false,
    refetchOnReconnect: true,
    queryFn: async (): Promise<{ top: Song[]; trending: Song[]; videos: Song[]; country: string }> => {
      const charts = await getYouTubeMusicCharts(country || 'ZZ', 40);
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
        // Top Songs stays ranked (users expect the #1 to be #1).
        top: toList(charts.top),
        // These are ranked chart feeds too; preserve their real ordering.
        trending: toList(charts.trending),
        videos: toList(charts.videos),
        country: charts.country,
      };
    },
  });
}
