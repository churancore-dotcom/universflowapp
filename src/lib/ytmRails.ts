import { useQuery } from '@tanstack/react-query';
import { getYouTubeMusicCharts, getYouTubeMusicNewReleases, searchYouTubeMusicTracks, type IndexedTrack } from '@/lib/musicIndexer';
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

// Session-stable seed so each app open reshuffles rails, but they stay stable
// while the user scrolls. MUST be deterministic on the server: a random value
// at module scope differs between the SSR render and hydration, which makes
// React throw away the tree and visibly reorder the rails after first paint.
let SESSION_SEED = typeof window === 'undefined' ? 1 : Math.floor(Math.random() * 1_000_000);
function seededShuffle<T>(arr: T[], seed = SESSION_SEED): T[] {
  const out = arr.slice();
  let s = seed || 1;
  for (let i = out.length - 1; i > 0; i--) {
    s = (s * 9301 + 49297) % 233280;
    const j = Math.floor((s / 233280) * (i + 1));
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
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
      return seededShuffle(out).slice(0, limit);
    },
  });
}

export function useYtmNewReleases(country: string, limit = 24, enabled = true) {
  return useQuery({
    queryKey: ['ytm-new-releases-v2', country, limit, hourBucket()],
    enabled,
    staleTime: 10 * 60 * 1000,
    gcTime: 6 * 60 * 60 * 1000,
    refetchInterval: 20 * 60 * 1000,
    refetchOnWindowFocus: true,
    refetchOnReconnect: true,
    queryFn: async (): Promise<Song[]> => {
      const tracks = await getYouTubeMusicNewReleases(country, Math.max(limit, 40));
      const seen = new Set<string>();
      const out: Song[] = [];
      for (const t of tracks) {
        if (seen.has(t.id)) continue;
        seen.add(t.id);
        const s = toSong(t);
        if (s) out.push(s);
      }
      return seededShuffle(out).slice(0, limit);
    },
  });
}

/**
 * Real YouTube Music Charts (FEmusic_charts) — same data music.youtube.com/charts renders.
 */
export function useYtmCharts(country: string, enabled = true) {
  return useQuery({
    queryKey: ['ytm-charts-v2', (country || 'US').toUpperCase(), hourBucket()],
    enabled,
    staleTime: 10 * 60 * 1000,
    gcTime: 6 * 60 * 60 * 1000,
    refetchInterval: 30 * 60 * 1000,
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
        // Top Songs stays ranked (users expect the #1 to be #1).
        top: toList(charts.top),
        // Trending / videos shuffle per session so the rails don't feel static.
        trending: seededShuffle(toList(charts.trending)),
        videos: seededShuffle(toList(charts.videos)),
        country: charts.country,
      };
    },
  });
}
