import { memo, useCallback, useEffect, useMemo } from 'react';
import { Flame, Loader2 } from 'lucide-react';
import { Song, usePlayer } from '@/contexts/PlayerContext';
import { prefetchIndexedTrack } from '@/lib/musicIndexer';
import { triggerHaptic } from '@/hooks/useHaptics';
import { useUserCountry } from '@/hooks/useUserCountry';
import { useYtmCharts } from '@/lib/ytmRails';
import { isSpamSong } from '@/pages/Search';

/**
 * Viral rail — powered by real YouTube Music Charts (FEmusic_charts).
 * Prefers the "Trending / fastest-rising" bucket; falls back to "Top Videos"
 * and then "Top Songs" so the rail is never empty. This is the same data
 * music.youtube.com/charts renders — no fake or randomised search results.
 */
const CountryViralSection = memo(function CountryViralSection() {
  const { currentSong, isPlaying, playSong, togglePlay } = usePlayer();
  const country = useUserCountry();
  const { data: charts, isLoading: loading } = useYtmCharts(country);

  const tracks = useMemo(() => {
    // Prefer real "Trending / fastest-rising" shelf; fall back to Videos so
    // the rail never duplicates Trending Now (which uses Top Songs).
    const pool = (charts?.trending?.length ? charts.trending
      : charts?.videos?.length ? charts.videos
      : []) as Song[];
    // Exclude anything already in Top Songs (rendered by TrendingNow) so the
    // two rails never repeat the exact same tracks.
    const topIds = new Set((charts?.top ?? []).map((s) => s.id));
    const clean = pool.filter((s) => !isSpamSong(s) && !topIds.has(s.id));
    const seen = new Set<string>();
    const out: Song[] = [];
    for (const s of clean) {
      if (seen.has(s.id)) continue;
      seen.add(s.id);
      out.push(s);
      if (out.length >= 24) break;
    }
    return out;
  }, [charts]);

  // Pre-resolve top 6 streams so taps feel instant.
  useEffect(() => {
    tracks.slice(0, 6).forEach((t) => prefetchIndexedTrack(t.artist, t.title));
  }, [tracks]);

  const handleTap = useCallback((song: Song) => {
    triggerHaptic('impactLight');
    if (currentSong?.id === song.id) togglePlay();
    else playSong(song, undefined, tracks);
  }, [tracks, currentSong?.id, togglePlay, playSong]);

  const label = 'Viral Right Now';
  const hasViral = loading || tracks.length > 0;
  if (!hasViral) return null;

  return (
    <div className="space-y-6">
      <section className="space-y-3">
        <div className="flex items-center justify-between px-1">
          <div className="flex items-center gap-2">
            <Flame className="w-4 h-4" style={{ color: '#FF6B2D' }} />
            <h2 className="text-sm font-bold text-foreground">{label}</h2>
          </div>
        </div>

        {loading ? (
          <div className="flex items-center justify-center py-6">
            <Loader2 className="w-4 h-4 animate-spin text-muted-foreground" />
          </div>
        ) : (
          <div className="flex gap-3 overflow-x-auto hide-scrollbar pb-1">
            {tracks.map((track, i) => {
              const active = currentSong?.id === track.id;
              return (
                <button
                  key={track.id}
                  type="button"
                  onClick={() => handleTap(track)}
                  className="w-32 flex-shrink-0 text-left active:scale-[0.96] transition-transform"
                >
                  <div className={`relative mb-2 aspect-square overflow-hidden rounded-3xl bg-muted/50 ${active ? 'ring-2 ring-primary' : ''}`}>
                    {track.cover_url && (
                      <img
                        src={track.cover_url}
                        alt={`${track.title} cover`}
                        className="h-full w-full object-cover"
                        loading="lazy"
                        referrerPolicy="no-referrer"
                      />
                    )}
                    <div className="absolute top-1.5 left-1.5 px-1.5 py-0.5 rounded-md bg-black/60 backdrop-blur-md text-[10px] font-bold text-white">
                      #{i + 1}
                    </div>
                    {active && isPlaying && (
                      <div className="absolute bottom-1.5 right-1.5 rounded-full bg-primary px-1.5 py-0.5 text-[9px] font-bold text-primary-foreground">
                        ▶
                      </div>
                    )}
                  </div>
                  <p className={`truncate text-[12px] font-semibold ${active ? 'text-primary' : 'text-foreground'}`}>{track.title}</p>
                  <p className="mt-0.5 truncate text-[10px] text-muted-foreground">{track.artist}</p>
                </button>
              );
            })}
          </div>
        )}
      </section>
    </div>
  );
});

export default CountryViralSection;
