import React, { memo, useMemo } from 'react';
import { motion } from 'framer-motion';
import { Song, usePlayer } from '@/contexts/PlayerContext';
import OptimizedImage from './OptimizedImage';
import { triggerHaptic } from '@/hooks/useHaptics';
import { useTasteProfile } from '@/hooks/useTasteProfile';
import { rerank } from '@/lib/feedPersonalizer';
import { isSpamSong } from '@/pages/Search';
import { useYtmRail, useYtmCharts } from '@/lib/ytmRails';
import { useUserCountry } from '@/hooks/useUserCountry';
import { getCountryQueries } from '@/lib/countryQueries';

interface Props { songs?: Song[]; enabled?: boolean }

const TrendingNowSection = memo(({ enabled = true }: Props) => {
  const { playSong, currentSong } = usePlayer();
  const taste = useTasteProfile();
  const country = useUserCountry();
  // PRIMARY: real YouTube Music Charts (Top Songs) for this country — same
  // data music.youtube.com/charts renders, so it's not fake or randomised.
  const { data: charts } = useYtmCharts(country, enabled);
  const q = getCountryQueries(country);
  // FALLBACK ONLY: if YT hasn't shipped charts for this region, use a
  // freshness-tagged search so the rail still has real official songs.
  const needsFallback = enabled && (charts?.top.length ?? 0) === 0;
  const { data: fallbackPool = [] } = useYtmRail(`trending-v3-${country}`, q.trending, 36, needsFallback);

  const trending = useMemo(() => {
    const pool = charts?.top?.length ? charts.top : fallbackPool;
    const clean = pool.filter((s) => !isSpamSong(s));
    return rerank(clean, taste).slice(0, 10);
  }, [charts, fallbackPool, taste]);


  if (trending.length === 0) return null;

  return (
    <section className="mb-2 pt-4">
      <div className="flex items-end justify-between mb-3 px-1">
        <div>
          <h2 className="text-[20px] leading-tight font-extrabold tracking-tight text-foreground">Trending Now</h2>
          <p className="text-[11px] text-muted-foreground/55 font-semibold mt-0.5">Most played from YouTube Music</p>
        </div>
      </div>

      <div className="rounded-3xl overflow-hidden border border-white/[0.06] bg-card/70">
        {trending.map((song, idx) => {
          const isPlaying = currentSong?.id === song.id;
          const rank = String(idx + 1).padStart(2, '0');
          return (
            <motion.button
              key={song.id}
              onClick={() => { triggerHaptic('selection'); playSong(song, undefined, trending); }}
              whileTap={{ scale: 0.985 }}
              initial={{ opacity: 0, x: -6 }}
              animate={{ opacity: 1, x: 0 }}
              transition={{ delay: idx * 0.02 }}
              className="w-full grid items-center gap-3 px-3 py-2.5 text-left border-b border-white/[0.05] last:border-0 active:bg-white/[0.04]"
              style={{ gridTemplateColumns: '26px 46px 1fr auto' }}
            >
              <span className={`text-[12px] font-black tabular-nums select-none ${isPlaying ? 'text-primary' : 'text-muted-foreground/40'}`}>
                {rank}
              </span>
              <div className="w-[46px] h-[46px] rounded-xl overflow-hidden flex-shrink-0 bg-muted ring-1 ring-white/10">
                {song.cover_url ? (
                  <OptimizedImage src={song.cover_url} alt={song.title} className="w-full h-full object-cover" eager={idx < 3} />
                ) : null}
              </div>
              <div className="min-w-0">
                <p className={`text-[13px] font-bold truncate leading-tight ${isPlaying ? 'text-primary' : 'text-foreground'}`}>
                  {song.title}
                </p>
                <p className="text-[10.5px] text-muted-foreground/65 truncate mt-0.5 font-medium">
                  {song.artist}
                </p>
              </div>
              <span className="text-[10px] text-muted-foreground/40 font-bold pl-1">
                Play
              </span>
            </motion.button>
          );
        })}
      </div>
    </section>
  );
});

TrendingNowSection.displayName = 'TrendingNowSection';
export default TrendingNowSection;