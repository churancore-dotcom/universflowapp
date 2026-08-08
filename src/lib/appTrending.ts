// REAL trending — what UniversFlow listeners are actually playing right now.
//
// The old shelf was purely editorial (YT Music charts + a country query), so
// every listener in a country saw the same static rows and nothing the app's
// own users did ever moved it. This reads the aggregated play/skip/like signal
// from the last two days instead, ranked by unique listeners so replays and
// one heavy looper cannot fake a hot track.
import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import type { Song } from '@/contexts/PlayerContext';

interface TrendingRow {
  track_id: string;
  title: string;
  artist: string;
  cover_url: string | null;
  listeners: number;
  plays: number;
  score: number;
}

function rowToSong(r: TrendingRow): Song | null {
  if (!r.track_id || !r.title) return null;
  // track_id is the resolver key: `ytm-<videoId>` for indexed tracks, or a
  // library UUID for catalogue songs.
  const isYtm = r.track_id.startsWith('ytm-');
  const videoId = isYtm ? r.track_id.slice(4) : '';
  return {
    id: r.track_id,
    title: r.title,
    artist: r.artist || 'Unknown',
    cover_url: r.cover_url || (videoId ? `https://i.ytimg.com/vi/${videoId}/hqdefault.jpg` : undefined),
    audio_url: videoId ? `yt-video:${videoId}` : '',
    source: 'indexed',
  } as Song;
}

export interface AppTrendingResult {
  songs: Song[];
  /** Listener counts so callers can show "N listening" without a second read. */
  listeners: Map<string, number>;
}

export async function fetchAppTrending(country: string | null, hours = 48, limit = 40): Promise<AppTrendingResult> {
  const { data, error } = await supabase.rpc('app_trending_tracks', {
    p_country: country || undefined,
    p_hours: hours,
    p_limit: limit,
  });
  if (error) throw error;
  const rows = (data ?? []) as unknown as TrendingRow[];
  const listeners = new Map<string, number>();
  const songs: Song[] = [];
  for (const r of rows) {
    const song = rowToSong(r);
    if (!song || !song.audio_url) continue;
    listeners.set(song.id, Number(r.listeners) || 0);
    songs.push(song);
  }
  return { songs, listeners };
}

/**
 * In-app trending. Falls back to the global (country-less) window when a
 * country has too little history yet, so a small market never sees an empty
 * shelf and never gets stuck on editorial-only rows.
 */
export function useAppTrending(country: string | null, enabled = true) {
  return useQuery({
    queryKey: ['app-trending', country ?? 'global'],
    enabled,
    staleTime: 3 * 60 * 1000,
    gcTime: 30 * 60 * 1000,
    refetchInterval: 5 * 60 * 1000,
    queryFn: async (): Promise<AppTrendingResult> => {
      try {
        const local = await fetchAppTrending(country, 48, 40);
        if (local.songs.length >= 8) return local;
        const global = await fetchAppTrending(null, 72, 40);
        // Local rows first — they're closer to this listener's market.
        const seen = new Set(local.songs.map((s) => s.id));
        const merged = [...local.songs];
        const listeners = new Map(local.listeners);
        for (const s of global.songs) {
          if (seen.has(s.id)) continue;
          seen.add(s.id);
          listeners.set(s.id, global.listeners.get(s.id) ?? 0);
          merged.push(s);
        }
        return { songs: merged, listeners };
      } catch {
        return { songs: [], listeners: new Map() };
      }
    },
  });
}
