import React, { memo, useMemo } from 'react';
import { motion } from 'framer-motion';
import { Play, Flame } from 'lucide-react';
import { Song, usePlayer } from '@/contexts/PlayerContext';
import OptimizedImage from './OptimizedImage';
import { triggerHaptic } from '@/hooks/useHaptics';
import { prewarmSong, prewarmSongs, prewarmIntentProps } from '@/lib/instantPlay';
import { useTasteProfile } from '@/hooks/useTasteProfile';
import { rerank } from '@/lib/feedPersonalizer';
import { isSpamSong } from '@/pages/Search';
import { useYtmRail, useYtmCharts } from '@/lib/ytmRails';
import { useUserCountry } from '@/hooks/useUserCountry';
import { getCountryQueries } from '@/lib/countryQueries';

interface Props { songs?: Song[]; enabled?: boolean }

/**
 * Trending Now — poster chart, not a list.
 * Ranked cover cards in a snap carousel; the rank sits on the artwork so the
 * eye reads "what's hot" as images instead of scanning text rows.
 */
const TrendingNowSection = memo(({ enabled = true }: Props) => {
  const { playSong, currentSong } = usePlayer();
  const taste = useTasteProfile();
  const country = useUserCountry();
  const { data: charts } = useYtmCharts(country, enabled);
  const q = getCountryQueries(country);
  const needsFallback = enabled && (charts?.top.length ?? 0) === 0;
  const { data: fallbackPool = [] } = useYtmRail(`trending-v3-${country}`, q.trending, 36, needsFallback);

  const trending = useMemo(() => {
    const pool = charts?.top?.length ? charts.top : fallbackPool;
    const clean = pool.filter((s) => !isSpamSong(s));
    // Personalization reorders a real chart; it must never delete most of the
    // chart merely because the listener has not played those artists before.
    return rerank(clean, taste).slice(0, 18);
  }, [charts, fallbackPool, taste]);

  // Pre-resolve the top of the chart so the first taps are instant.
  React.useEffect(() => { prewarmSongs(trending, 4); }, [trending]);

  if (trending.length === 0) return null;

  const play = (s: Song) => { triggerHaptic('selection'); playSong(s, undefined, trending); };
  const lead = trending[0];
  const rest = trending.slice(1);

  return (
    <section className="mb-2 pt-4">
      <div className="flex items-center gap-2 mb-3 px-1">
        <div className="w-7 h-7 rounded-2xl neu-inset flex items-center justify-center">
          <Flame className="w-3.5 h-3.5 text-primary" />
        </div>
        <div>
          <h2 className="font-display text-2xl tracking-[0.06em] uppercase text-foreground">Trending Now</h2>
          <p className="text-[10px] text-muted-foreground/55 font-semibold">Hot right now, tuned to your taste</p>
        </div>
      </div>

      {/* Lead poster — one dominant visual instead of row #1 */}
      <motion.button
        whileTap={{ scale: 0.98 }}
        onClick={() => play(lead)}
        {...prewarmIntentProps(lead)}
        className="relative w-full h-[188px] rounded-[30px] overflow-hidden text-left neu"
      >
        {lead.cover_url && (
          <OptimizedImage src={lead.cover_url} alt={lead.title} className="absolute inset-0 w-full h-full object-cover" eager />
        )}
        <div className="absolute inset-0 bg-gradient-to-t from-black/90 via-black/35 to-black/10" />
        <div className="absolute top-4 left-4 px-2.5 py-1 rounded-full bg-primary text-primary-foreground text-[9px] font-black uppercase tracking-[0.2em]">
          #1 Trending
        </div>
        <div className="absolute bottom-4 left-4 right-4 flex items-end justify-between gap-3">
          <div className="min-w-0">
            <h3 className="text-[22px] leading-[1.05] font-extrabold text-white line-clamp-2">{lead.title}</h3>
            <p className="text-[11.5px] text-white/70 truncate mt-1 font-semibold">{lead.artist}</p>
          </div>
          <div className="w-11 h-11 rounded-full bg-white flex items-center justify-center shrink-0">
            <Play className="w-4 h-4 text-black ml-0.5" fill="currentColor" />
          </div>
        </div>
      </motion.button>

      {/* Ranked poster carousel */}
      <div className="flex gap-3 overflow-x-auto hide-scrollbar snap-x snap-mandatory mt-3 -mx-1 px-1 pb-1">
        {rest.map((song, idx) => {
          const active = currentSong?.id === song.id;
          return (
            <motion.button
              key={song.id}
              onClick={() => play(song)}
              {...prewarmIntentProps(song)}
              whileTap={{ scale: 0.95 }}
              className="snap-start shrink-0 w-[124px] text-left"
            >
              <div className="relative w-[124px] h-[124px] rounded-[24px] overflow-hidden neu-inset">
                {song.cover_url && (
                  <OptimizedImage src={song.cover_url} alt={song.title} className="w-full h-full object-cover" />
                )}
                <div className="absolute inset-x-0 bottom-0 h-1/2 bg-gradient-to-t from-black/80 to-transparent" />
                <span className="absolute bottom-1.5 left-2.5 text-[26px] leading-none font-black text-white/90 tabular-nums drop-shadow">
                  {idx + 2}
                </span>
              </div>
              <p className={`text-[12px] font-bold truncate mt-2 px-0.5 ${active ? 'text-primary' : 'text-foreground'}`}>{song.title}</p>
              <p className="text-[10px] text-muted-foreground/65 truncate px-0.5 mt-0.5">{song.artist}</p>
            </motion.button>
          );
        })}
      </div>
    </section>
  );
});

TrendingNowSection.displayName = 'TrendingNowSection';
export default TrendingNowSection;
