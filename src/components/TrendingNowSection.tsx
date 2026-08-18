import { memo, useEffect, useMemo, useRef } from 'react';
import { motion } from 'framer-motion';
import { Play, ArrowUp, ArrowDown } from 'lucide-react';
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
import { RailSkeleton } from './PageSkeletons';
import { cleanRail, diversifyByArtist, songFingerprint, claimRailSongs } from '@/lib/railQuality';
import { slice, sliceTransition, pressShear } from '@/lib/ufMotion';
import RailHeader from './RailHeader';





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
  useEffect(() => { claimRailSongs('trending', trending); }, [trending]);

  // Pre-resolve the top of the chart so the first taps are instant.
  useEffect(() => { prewarmSongs(trending, 4); }, [trending]);

  // Real rank movement: compare this render's chart order against the previous
  // order we saw for the same country feed. No synthetic deltas — if a track is
  // new to the shelf or hasn't moved, no badge is shown.
  // NOTE: these hooks MUST stay above the early return below. They used to sit
  // after it, so the hook count changed between the skeleton render and the
  // loaded render ("Rendered more hooks than during the previous render").
  const prevRanks = useRef<Record<string, number>>({});
  const rankMoves = useMemo(() => {
    const moves: Record<string, number> = {};
    trending.forEach((s, i) => {
      const before = prevRanks.current[s.id];
      if (before !== undefined && before !== i) moves[s.id] = before - i;
    });
    return moves;
  }, [trending]);
  useEffect(() => {
    const next: Record<string, number> = {};
    trending.forEach((s, i) => { next[s.id] = i; });
    prevRanks.current = next;
  }, [trending]);

  // Never render nothing while the chart query is in flight — that is what made
  // Home look frozen. Skeleton mirrors the real poster layout.
  if (trending.length === 0) {
    return enabled && (chartsLoading || (needsFallback && !countryChart)) ? <RailSkeleton layout="poster" /> : null;
  }


  const play = (s: Song) => { triggerHaptic('selection'); playSong(s, undefined, trending); };
  const lead = trending[0];
  const rest = trending.slice(1);

  return (
    <section className="relative">
      <RailHeader
        title="Trending Now"
        subtitle={`Top in ${countryLabel(servedCountry)}, tuned to your taste`}
        badge={(
          <span className="uf-live shrink-0" aria-label="Live chart data">
            <span className="uf-live-dot" /> Live
          </span>
        )}
      />

      {/* Lead poster — one dominant visual */}
      <motion.button
        whileTap={pressShear}
        initial={slice.initial}
        animate={slice.animate}
        transition={sliceTransition()}
        onClick={() => play(lead)}
        {...prewarmIntentProps(lead)}
        className="relative w-full h-[210px] text-left rounded-xl overflow-hidden group border border-white/5"
      >
        {lead.cover_url && (
          <OptimizedImage src={lead.cover_url} alt={lead.title} className="absolute inset-0 w-full h-full object-cover transition-transform duration-700 group-hover:scale-105" eager />
        )}
        <div className="absolute inset-0 bg-gradient-to-t from-black/90 via-black/30 to-transparent" />
        <div className="absolute top-3 left-3 px-2 py-0.5 bg-primary text-white rounded-full text-[9px] font-bold uppercase tracking-wider">
          #1 Trending
        </div>
        <div className="absolute bottom-4 left-4 right-4 flex items-end justify-between gap-3">
          <div className="min-w-0">
            <h3 className="text-xl font-black leading-tight line-clamp-2 tracking-tight">{lead.title}</h3>
            <p className="text-xs text-muted-foreground/90 truncate mt-1 font-semibold">{lead.artist}</p>
          </div>
          <div className="w-11 h-11 bg-white text-black rounded-full shadow-lg flex items-center justify-center shrink-0 transition-transform hover:scale-105">
            <Play className="w-4 h-4 ml-0.5 fill-current" />
          </div>
        </div>
      </motion.button>


      {/* Ranked carousel — uniform tiles, reorders animate on a real chart move */}
      <div className="uf-rail mt-4 -mx-1 px-1 pb-2">
        {rest.map((song, idx) => {
          const active = currentSong?.id === song.id;
          const move = rankMoves[song.id] ?? 0;
          return (
            <motion.button
              key={song.id}
              layout="position"
              onClick={() => play(song)}
              {...prewarmIntentProps(song)}
              whileTap={pressShear}
              transition={{ type: 'spring', stiffness: 260, damping: 26 }}
              className="shrink-0 text-left w-[132px]"
            >
              <div className="relative rounded-lg overflow-hidden w-[132px] h-[132px] border border-white/5 group">
                {song.cover_url && (
                  <OptimizedImage src={song.cover_url} alt={song.title} className="w-full h-full object-cover" />
                )}
                <div className="absolute inset-x-0 bottom-0 h-1/2 bg-gradient-to-t from-black/90 to-transparent" />
                <span className="absolute bottom-2 left-2 text-[20px] font-black leading-none text-white drop-shadow-[0_2px_4px_rgba(0,0,0,0.8)] tabular-nums">
                  {idx + 2}
                </span>

                {move !== 0 && (
                  <motion.span
                    initial={{ opacity: 0, y: move > 0 ? 6 : -6 }}
                    animate={{ opacity: 1, y: 0 }}
                    transition={{ type: 'spring', stiffness: 300, damping: 22 }}
                    className="absolute top-2 right-2 flex items-center gap-0.5 px-1.5 py-0.5 rounded-full bg-background/70 backdrop-blur-sm text-[9px] font-black tabular-nums text-primary"
                    aria-label={`${move > 0 ? 'Up' : 'Down'} ${Math.abs(move)} places`}
                  >
                    {move > 0 ? <ArrowUp className="w-2.5 h-2.5" /> : <ArrowDown className="w-2.5 h-2.5" />}
                    {Math.abs(move)}
                  </motion.span>
                )}
              </div>
              <p className={`text-[12.5px] font-bold truncate mt-2 px-0.5 ${active ? 'text-primary' : 'text-foreground'}`}>{song.title}</p>
              <p className="text-[11px] text-muted-foreground/80 truncate px-0.5 mt-0.5">{song.artist}</p>
            </motion.button>
          );
        })}
      </div>

    </section>
  );

});

TrendingNowSection.displayName = 'TrendingNowSection';
export default TrendingNowSection;
