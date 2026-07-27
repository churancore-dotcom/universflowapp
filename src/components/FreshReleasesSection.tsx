import React, { memo, useMemo } from 'react';
import { motion } from 'framer-motion';
import { Play } from 'lucide-react';
import { Song, usePlayer } from '@/contexts/PlayerContext';
import OptimizedImage from './OptimizedImage';
import { triggerHaptic } from '@/hooks/useHaptics';
import { useTasteProfile } from '@/hooks/useTasteProfile';
import { rerank } from '@/lib/feedPersonalizer';
import { isSpamSong } from '@/pages/Search';
import { useYtmNewReleases } from '@/lib/ytmRails';
import { useUserCountry } from '@/hooks/useUserCountry';

interface Props { songs?: Song[]; enabled?: boolean }

const FreshReleasesSection = memo(({ enabled = true }: Props) => {
  const { playSong } = usePlayer();
  const taste = useTasteProfile();
  const country = useUserCountry();
  const { data: pool = [] } = useYtmNewReleases(country, 24, enabled);

  const fresh = useMemo(() => {
    const clean = pool.filter((s) => !isSpamSong(s));
    return rerank(clean, taste).slice(0, 12);
  }, [pool, taste]);


  if (fresh.length === 0) return null;
  const play = (s: Song) => { triggerHaptic('selection'); playSong(s, undefined, fresh); };

  return (
    <section className="mb-2 pt-2">
      <div className="flex items-end justify-between mb-3 px-1">
        <div>
          <h2 className="text-[20px] leading-tight font-extrabold tracking-tight text-foreground">New Releases</h2>
          <p className="text-[11px] text-muted-foreground/55 font-semibold mt-0.5">Fresh official music picks</p>
        </div>
      </div>

      <div className="grid grid-cols-2 gap-2.5">
        {fresh.slice(0, 6).map((song, idx) => (
          <motion.button
            key={song.id}
            onClick={() => play(song)}
            whileTap={{ scale: 0.985 }}
            initial={{ opacity: 0, y: 3 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.03 + idx * 0.02 }}
            className="min-w-0 rounded-2xl border border-white/[0.06] bg-card/80 p-2.5 text-left active:bg-white/[0.04]"
          >
            <div className="flex items-center gap-2.5 min-w-0">
              <div className="w-12 h-12 rounded-xl overflow-hidden flex-shrink-0 bg-muted ring-1 ring-white/10">
                {song.cover_url && <OptimizedImage src={song.cover_url} alt={song.title} className="w-full h-full object-cover" eager={idx < 2} />}
              </div>
              <div className="min-w-0 flex-1">
                <p className="text-[12.5px] font-bold text-foreground truncate leading-tight">{song.title}</p>
                <p className="text-[10.5px] text-muted-foreground/65 truncate mt-0.5">{song.artist}</p>
              </div>
              {idx === 0 && <Play className="w-3.5 h-3.5 text-primary flex-shrink-0" fill="currentColor" />}
            </div>
          </motion.button>
        ))}
      </div>
    </section>
  );
});

FreshReleasesSection.displayName = 'FreshReleasesSection';
export default FreshReleasesSection;