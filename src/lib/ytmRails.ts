import { useQuery } from '@tanstack/react-query';
import { getYouTubeMusicCharts, getYouTubeMusicNewReleases, searchYouTubeMusicTracks, type IndexedTrack } from '@/lib/musicIndexer';
import type { Song } from '@/contexts/PlayerContext';

/**
 * Spam / SEO-farm filter. YouTube "new releases" search is flooded with
 * pipe-stuffed reupload channels ("New Song 2026 | New Hindi Song | ..."
 * from AI-V-Series, Single Track Studio, Speed Records dump uploads, etc.).
 * These are NOT real releases — they are keyword-stuffed reuploads of old
 * songs or AI slop. We keep only tracks that look like a real single.
 */
const SPAM_ARTIST_RX = /(?:^|\b)(?:ai[\s-]*v[\s-]*series|v[\s-]*series official|single track studio|sawnta films|jazz grik|t-series junior|new song[s]? channel|hindi songs? channel|gaurav mali|vatsal bhoya)/i;
const SPAM_TITLE_HINT_RX = /(?:new (?:hindi|punjabi|haryanvi|bhojpuri|tamil|telugu|bollywood) songs?|new song 20\d{2}|full video song|official video song 20\d{2})/i;

function isSpammyTrack(t: { title?: string; artist?: string }): boolean {
  const title = (t.title || '').trim();
  const artist = (t.artist || '').trim();
  if (!title || !artist) return true;
  // Pipe-stuffed keyword farms: "A | B | C | D" — real titles rarely have 3+ pipes.
  const pipeCount = (title.match(/\|/g) || []).length;
  if (pipeCount >= 3) return true;
  // 2 pipes AND a spammy phrase → still a farm.
  if (pipeCount >= 2 && SPAM_TITLE_HINT_RX.test(title)) return true;
  // Obvious spam channels.
  if (SPAM_ARTIST_RX.test(artist)) return true;
  // Ridiculously long titles (SEO word-salad).
  if (title.length > 90) return true;
  return false;
}

function cleanTracks<T extends { id: string; title?: string; artist?: string }>(tracks: T[]): T[] {
  const seen = new Set<string>();
  const out: T[] = [];
  for (const t of tracks) {
    if (!t.id || seen.has(t.id)) continue;
    if (isSpammyTrack(t)) continue;
    seen.add(t.id);
    out.push(t);
  }
  return out;
}

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

// Session-stable random seed so each app open reshuffles rails, but they stay
// stable while the user scrolls. Prevents "same songs in the same order".
let SESSION_SEED = Math.floor(Math.random() * 1_000_000);
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
      const raw = await searchYouTubeMusicTracks(freshQuery, Math.max(limit, 60));
      const tracks = cleanTracks(raw);
      const out: Song[] = [];
      for (const t of tracks) {
        const s = toSong(t);
        if (s) out.push(s);
      }
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
      const raw = await getYouTubeMusicNewReleases(country, Math.max(limit, 60));
      const tracks = cleanTracks(raw);
      const out: Song[] = [];
      for (const t of tracks) {
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
