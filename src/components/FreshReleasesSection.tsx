import { memo, useEffect, useMemo } from 'react';
import { motion } from 'framer-motion';
import { Song, usePlayer } from '@/contexts/PlayerContext';
import OptimizedImage from './OptimizedImage';
import { triggerHaptic } from '@/hooks/useHaptics';
import { prewarmSongs, prewarmIntentProps } from '@/lib/instantPlay';
import { isSpamSong } from '@/pages/Search';
import { useYtmNewReleases } from '@/lib/ytmRails';
import { useUserCountry } from '@/hooks/useUserCountry';
import { RailSkeleton } from './PageSkeletons';
import { cleanRail, songFingerprint, claimRailSongs, claimedByOtherRails, useRailClaimVersion } from '@/lib/railQuality';
import { sliceUp, sliceTransition, pressShear } from '@/lib/ufMotion';
import RailHeader from './RailHeader';
import { useTasteProfile } from '@/hooks/useTasteProfile';
import { notInterestedKey } from '@/lib/notInterested';


interface Props { songs?: Song[]; enabled?: boolean }

const FreshReleasesSection = memo(({ enabled = true }: Props) => {
  const { playSong } = usePlayer();
  const country = useUserCountry();
  const { data: pool = [], isLoading } = useYtmNewReleases(country, 40, enabled);
  // Re-run the memo when another rail (Trending) changes what it claims.
  const claimVersion = useRailClaimVersion();

  const taste = useTasteProfile();
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
    const clean = cleanRail(
        pool.filter((s) => !isSpamSong(s) && !claimed.has(songFingerprint(s)) && !taste.hiddenSongs?.has(notInterestedKey(s.title, s.artist))),
        { requireCover: true },
    );
    // New Releases must stay chronological (that's what "new" means). We only
    // bubble taste matches to the front, preserving recency inside each group,
    // instead of re-ranking or filtering real fresh drops out of the rail.
    return clean.slice(0, 40);
  }, [pool, claimVersion, taste.hiddenSongs]);




  useEffect(() => { claimRailSongs('fresh', fresh); }, [fresh]);
  useEffect(() => () => claimRailSongs('fresh', []), []);
  useEffect(() => { prewarmSongs(fresh, 4); }, [fresh]);

  if (fresh.length === 0) return enabled && isLoading ? <RailSkeleton layout="grid" title="w-52" /> : null;
  const play = (s: Song) => { triggerHaptic('selection'); playSong(s, undefined, fresh); };

  return (
    <section className="relative">
      <RailHeader title="New Releases" subtitle="Out this week" />

      {/* Large covers in one swipeable row — artwork does the talking */}
      <div className="overflow-x-auto hide-scrollbar snap-x" style={{ WebkitOverflowScrolling: 'touch' }}>
        <div className="flex gap-3.5">
          {fresh.slice(0, 20).map((song, idx) => (
            <motion.button
              key={song.id}
              onClick={() => play(song)}
              {...prewarmIntentProps(song)}
              whileTap={pressShear}
              initial={sliceUp.initial}
              animate={sliceUp.animate}
              transition={sliceTransition(0.04 + Math.min(idx, 6) * 0.04)}
              className="snap-start shrink-0 w-[152px] text-left"
            >
              <div className="overflow-hidden rounded-2xl aspect-square bg-muted">
                {song.cover_url && <OptimizedImage src={song.cover_url} alt={song.title} className="w-full h-full object-cover" eager={idx < 3} />}
              </div>
              <p className="mt-2.5 text-[13.5px] font-semibold leading-tight text-foreground truncate">{song.title}</p>
              <p className="text-[12px] text-muted-foreground truncate mt-0.5">{song.artist}</p>
            </motion.button>
          ))}
        </div>
      </div>
    </section>
  );




});

FreshReleasesSection.displayName = 'FreshReleasesSection';
export default FreshReleasesSection;