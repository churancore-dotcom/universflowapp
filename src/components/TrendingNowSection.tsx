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
import { useYtmCharts } from '@/lib/ytmRails';
import { useUserCountry } from '@/hooks/useUserCountry';
import { useCountryCharts, countryLabel } from '@/lib/countryCharts';
import { useAppTrending } from '@/lib/appTrending';
import { cleanRail, diversifyByArtist, songFingerprint, claimRailSongs } from '@/lib/railQuality';



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
  // REAL viral charts are the source of truth: the same ranked feeds
  // music.youtube.com/charts renders for this country (Top Songs + Trending +
  // Music Videos). UniversFlow's own play data is only a boost signal — it must
  // never *become* the chart, or the shelf shows in-house plays instead of what
  // is actually viral.
  const { data: charts, isLoading: chartsLoading } = useYtmCharts(country, enabled);
  const { data: appTrending } = useAppTrending(country, enabled);
  // Fallback is the aggregated per-country chart table (Apple / iTunes /
  // Last.fm / Deezer, refreshed hourly by cron), NOT a keyword search — a
  // search for "top songs this week" is not a chart and skewed every market
  // toward the same rows. This path also works while signed out.
  const needsFallback = enabled && !chartsLoading && !!charts && charts.top.length === 0;
  const { data: countryChart } = useCountryCharts(country, needsFallback);
  const fallbackPool = countryChart?.songs ?? [];
  const servedCountry = charts?.top?.length ? (charts.country || country) : (countryChart?.country ?? country);

  const trending = useMemo(() => {
    // 1) Real chart order: Top Songs → Trending → Music Videos, quality-gated
    // and deduped by fingerprint (the same song arrives under several ids).
    const feeds = charts?.top?.length
      ? [charts.top, charts.trending ?? [], charts.videos ?? []]
      : [fallbackPool];
    const chartRows = cleanRail(
      feeds.flat().filter((s) => !isSpamSong(s)),
      { requireCover: true },
    );
    if (!chartRows.length) return [];

    // 2) In-app heat as a boost only — a charting track that UniversFlow
    // listeners are also hammering right now moves up, nothing new is injected.
    const hot = new Set((appTrending?.songs ?? []).map((s) => songFingerprint(s)));

    // 3) Personalization reorders the real chart (never deletes it), then the
    // in-app heat boost is applied as a stable partition, then a diversity
    // pass stops one artist from owning the shelf.
    const ranked = rerank(chartRows, taste);
    const boosted = [
      ...ranked.filter((s) => hot.has(songFingerprint(s))),
      ...ranked.filter((s) => !hot.has(songFingerprint(s))),
    ];
    return diversifyByArtist(boosted).slice(0, 18);
  }, [charts, chartsLoading, fallbackPool, appTrending, taste]);






  // Trending owns these fingerprints: lower-priority rails (New Releases)
  // subtract them so the same regional hit never appears twice on Home.
  React.useEffect(() => { claimRailSongs('trending', trending); }, [trending]);

  // Pre-resolve the top of the chart so the first taps are instant.
  React.useEffect(() => { prewarmSongs(trending, 2); }, [trending]);

  if (trending.length === 0) return null;

  const play = (s: Song) => { triggerHaptic('selection'); playSong(s, undefined, trending); };
  const lead = trending[0];
  const rest = trending.slice(1);

  return (
    <section>
      <div className="flex items-center gap-2.5 mb-5 px-1">
        <div className="w-7 h-7 rounded-2xl neu-inset flex items-center justify-center">
          <Flame className="w-3.5 h-3.5 text-primary" />
        </div>
        <div>
          <h2 className="font-display text-[32px] leading-[0.95] tracking-[0.02em] uppercase text-foreground font-black">Trending Now</h2>
          <p className="text-[11px] uppercase tracking-[0.18em] font-bold text-muted-foreground/60 mt-1">
            Top in {countryLabel(servedCountry)}, tuned to your taste
          </p>

        </div>
      </div>

      {/* Lead poster — one dominant visual instead of row #1 */}
      <motion.button
        whileTap={{ scale: 0.98 }}
        onClick={() => play(lead)}
        {...prewarmIntentProps(lead)}
        className="relative w-full h-[196px] rounded-[28px] overflow-hidden text-left neu neu-press"
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
            <p className="text-xs text-white/70 truncate mt-1 font-semibold">{lead.artist}</p>
          </div>
          <div className="w-11 h-11 rounded-full bg-white flex items-center justify-center shrink-0">
            <Play className="w-4 h-4 text-black ml-0.5" fill="currentColor" />
          </div>
        </div>
      </motion.button>

      {/* Ranked poster carousel */}
      <div className="flex gap-3 overflow-x-auto hide-scrollbar snap-x snap-mandatory mt-4 -mx-1 px-1 pb-1">
        {rest.map((song, idx) => {
          const active = currentSong?.id === song.id;
          return (
            <motion.button
              key={song.id}
              onClick={() => play(song)}
              {...prewarmIntentProps(song)}
              whileTap={{ scale: 0.95 }}
              className="snap-start shrink-0 w-[124px] text-left neu-press rounded-[28px]"
            >
              <div className="relative w-[124px] h-[124px] rounded-[28px] overflow-hidden neu">
                {song.cover_url && (
                  <OptimizedImage src={song.cover_url} alt={song.title} className="w-full h-full object-cover" />
                )}
                <div className="absolute inset-x-0 bottom-0 h-1/2 bg-gradient-to-t from-black/80 to-transparent" />
                <span className="absolute bottom-1.5 left-2.5 text-[26px] leading-none font-black text-white/90 tabular-nums drop-shadow">
                  {idx + 2}
                </span>
              </div>
              <p className={`text-[13px] font-bold truncate mt-2 px-0.5 ${active ? 'text-primary' : 'text-foreground'}`}>{song.title}</p>
              <p className="text-[11px] text-muted-foreground/70 truncate px-0.5 mt-0.5">{song.artist}</p>
            </motion.button>
          );
        })}
      </div>
    </section>
  );
});

TrendingNowSection.displayName = 'TrendingNowSection';
export default TrendingNowSection;
