import React, { memo, useMemo } from 'react';
import { motion } from 'framer-motion';
import { Play } from 'lucide-react';
import { Song, usePlayer } from '@/contexts/PlayerContext';
import OptimizedImage from './OptimizedImage';
import { triggerHaptic } from '@/hooks/useHaptics';
import { prewarmSongs, prewarmIntentProps } from '@/lib/instantPlay';
import { useTasteProfile } from '@/hooks/useTasteProfile';
import { tasteScore } from '@/lib/feedPersonalizer';
import { isSpamSong } from '@/pages/Search';
import { useYtmNewReleases } from '@/lib/ytmRails';
import { useUserCountry } from '@/hooks/useUserCountry';
import { RailSkeleton } from './PageSkeletons';
import { cleanRail, diversifyByArtist, songFingerprint, claimRailSongs, claimedByOtherRails, useRailClaimVersion } from '@/lib/railQuality';

interface Props { songs?: Song[]; enabled?: boolean }

const FreshReleasesSection = memo(({ enabled = true }: Props) => {
  const { playSong } = usePlayer();
  const taste = useTasteProfile();
  const country = useUserCountry();
  const { data: pool = [], isLoading } = useYtmNewReleases(country, 24, enabled);
  // Re-run the memo when another rail (Trending) changes what it claims.
  const claimVersion = useRailClaimVersion();

  const fresh = useMemo(() => {
    // The "fake/mock songs on top" were auto-generated compilations that
    // YouTube's release feed mixes in (jukebox / nonstop / slowed+reverb /
    // status edits). They are rejected before anything else, so the top of the
    // rail is always a real single with real artwork.
    // New Releases and Trending read the same per-country YouTube feeds, so a
    // charting regional single legitimately lands in both. Anything Trending is
    // already showing is dropped here — that duplication is what made Home look
    // like it kept repeating the same songs.
    const claimed = claimedByOtherRails('fresh');
    const clean = diversifyByArtist(
      cleanRail(
        pool.filter((s) => !isSpamSong(s) && !claimed.has(songFingerprint(s))),
        { requireCover: true },
      ),
    );
    // New Releases must stay chronological (that's what "new" means). We only
    // bubble taste matches to the front, preserving recency inside each group,
    // instead of re-ranking or filtering real fresh drops out of the rail.
    if (taste.signalCount < 5) return clean.slice(0, 12);
    const liked = clean.filter((song) => tasteScore(song, taste) > 0);
    const rest = clean.filter((song) => tasteScore(song, taste) <= 0);
    return [...liked, ...rest].slice(0, 12);
  }, [pool, taste, claimVersion]);




  React.useEffect(() => { claimRailSongs('fresh', fresh); }, [fresh]);
  React.useEffect(() => { prewarmSongs(fresh, 4); }, [fresh]);

  if (fresh.length === 0) return enabled && isLoading ? <RailSkeleton layout="grid" title="w-52" /> : null;
  const play = (s: Song) => { triggerHaptic('selection'); playSong(s, undefined, fresh); };

  return (
    <section className="relative">
      <div className="uf-slash mb-5" />
      {/* Sheared band: the whole shelf tilts, the content counter-tilts back. */}
      <div className="uf-shear">
        <div className="uf-unshear">
          <div className="flex items-stretch gap-3 mb-5 px-1">
            <span className="uf-index pt-1">02 / Fresh</span>
            <div className="min-w-0 flex-1">
              <h2 className="uf-shelf-title">New Releases</h2>
              <div className="uf-volt-rule w-16 mt-2 mb-2" />
              <p className="uf-shelf-sub block">Out now, straight off the feed</p>
            </div>
          </div>

          {/* Staircase: alternating notch direction + offset, never a flat grid */}
          <div className="grid grid-cols-2 gap-4">
            {fresh.slice(0, 6).map((song, idx) => (
              <motion.button
                key={song.id}
                onClick={() => play(song)}
                {...prewarmIntentProps(song)}
                whileTap={pressShear}
                initial={sliceUp.initial}
                whileInView={sliceUp.animate}
                viewport={{ once: true, margin: '-30px' }}
                transition={sliceTransition(0.04 + idx * 0.06)}
                className={`min-w-0 text-left ${idx === 0 ? 'col-span-2' : ''} ${idx % 2 === 0 && idx > 0 ? 'pt-7' : ''}`}
              >
                <div className={`overflow-hidden mb-3 relative uf-tile ${idx % 2 ? 'uf-cut-r' : 'uf-cut'} ${idx === 0 ? 'aspect-[16/9] uf-cut-lg' : idx % 3 === 0 ? 'aspect-[4/5]' : 'aspect-square'}`}>
                  {song.cover_url && <OptimizedImage src={song.cover_url} alt={song.title} className="w-full h-full object-cover" eager={idx < 2} />}
                  {idx === 0 && (
                    <span className="absolute bottom-3 right-3 w-10 h-10 uf-volt-chip uf-cut uf-cut-sm flex items-center justify-center">
                      <Play className="w-4 h-4 ml-0.5" fill="currentColor" />
                    </span>
                  )}
                </div>
                <p className="font-display text-[19px] font-bold leading-tight uppercase text-foreground truncate">{song.title}</p>
                <p className="text-[11px] text-muted-foreground/70 truncate font-semibold mt-0.5">{song.artist}</p>
              </motion.button>
            ))}
          </div>
        </div>
      </div>
    </section>
  );


});

FreshReleasesSection.displayName = 'FreshReleasesSection';
export default FreshReleasesSection;