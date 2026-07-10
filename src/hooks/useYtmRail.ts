import { useQuery } from '@tanstack/react-query';
import { searchYouTubeMusicTracks } from '@/lib/musicIndexer';
import type { Song } from '@/contexts/PlayerContext';

// Same spam filter used in ytmRails — keep in sync.
const SPAM_ARTIST_RX = /(?:^|\b)(?:ai[\s-]*v[\s-]*series|v[\s-]*series official|single track studio|sawnta films|jazz grik|t-series junior|new song[s]? channel|hindi songs? channel|gaurav mali|vatsal bhoya)/i;
const SPAM_TITLE_HINT_RX = /(?:new (?:hindi|punjabi|haryanvi|bhojpuri|tamil|telugu|bollywood) songs?|new song 20\d{2}|full video song|official video song 20\d{2})/i;
function isSpam(title = '', artist = ''): boolean {
  if (!title || !artist) return true;
  const pipes = (title.match(/\|/g) || []).length;
  if (pipes >= 3) return true;
  if (pipes >= 2 && SPAM_TITLE_HINT_RX.test(title)) return true;
  if (SPAM_ARTIST_RX.test(artist)) return true;
  if (title.length > 90) return true;
  return false;
}

export interface YtmRailOptions {
  limit?: number;
  staleMinutes?: number;
  enabled?: boolean;
}

/**
 * Fetches a YouTube Music rail (Trending / New / Charts / Made For You).
 * Returns Song[] ready for the existing player and rail components:
 *   - id is `ytm-<videoId>` (matches search results)
 *   - audio_url is `yt-video:<videoId>` so PlayerContext routes through extract-audio
 */
export function useYtmRail(query: string, options: YtmRailOptions = {}) {
  const { limit = 30, staleMinutes = 60, enabled = true } = options;
  return useQuery({
    queryKey: ['ytm-rail', query, limit],
    enabled: enabled && !!query && query.trim().length >= 2,
    staleTime: staleMinutes * 60 * 1000,
    gcTime: 6 * 60 * 60 * 1000,
    queryFn: async (): Promise<Song[]> => {
      const results = await searchYouTubeMusicTracks(query, limit);
      return results
        .filter((t) => t.id && t.title && t.artist)
        .map((t) => ({
          id: t.id,
          title: t.title,
          artist: t.artist,
          album: t.album,
          cover_url: t.cover_url,
          audio_url: t.audio_url || (t.videoId ? `yt-video:${t.videoId}` : 'resolving'),
          duration: t.duration,
        } as Song));
    },
  });
}
