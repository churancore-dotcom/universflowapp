import React, { memo, useMemo } from 'react';
import { motion } from 'framer-motion';
import { Play } from 'lucide-react';
import { Song, usePlayer } from '@/contexts/PlayerContext';
import OptimizedImage from './OptimizedImage';
import { triggerHaptic } from '@/hooks/useHaptics';
import { useTasteProfile } from '@/hooks/useTasteProfile';
import { rerank, tasteScore } from '@/lib/feedPersonalizer';
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
    const relevant = taste.signalCount >= 5 ? clean.filter((song) => tasteScore(song, taste) > 0) : clean;
    return rerank(relevant, taste).slice(0, 12);
  }, [pool, taste]);


  if (fresh.length === 0) return null;
  const play = (s: Song) => { triggerHaptic('selection'); playSong(s, undefined, fresh); };

  return (
    <section className="mb-2 pt-2">
      <div className="flex items-end justify-between mb-4">
        <h2 className="font-display text-2xl tracking-[0.06em] text-foreground uppercase">New Releases</h2>
        <span className="text-[10px] text-muted-foreground font-bold tracking-[0.2em] uppercase">All releases</span>
      </div>

      <div className="grid grid-cols-2 gap-4">
        {fresh.slice(0, 6).map((song, idx) => (
          <motion.button
            key={song.id}
            onClick={() => play(song)}
            whileTap={{ scale: 0.96 }}
            initial={{ opacity: 0, y: 6 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.03 + idx * 0.03 }}
            className={`min-w-0 text-left ${idx % 2 === 1 ? 'pt-6' : ''}`}
          >
            <div className="aspect-square rounded-2xl overflow-hidden bg-card mb-2 relative">
              {song.cover_url && <OptimizedImage src={song.cover_url} alt={song.title} className="w-full h-full object-cover" eager={idx < 2} />}
              {idx === 0 && (
                <span className="absolute bottom-2 right-2 w-8 h-8 rounded-full bg-primary flex items-center justify-center">
                  <Play className="w-3.5 h-3.5 text-primary-foreground ml-0.5" fill="currentColor" />
                </span>
              )}
            </div>
            <p className="font-display text-lg leading-tight uppercase text-foreground truncate">{song.title}</p>
            <p className="text-[11px] text-muted-foreground truncate font-medium">{song.artist}</p>
          </motion.button>
        ))}
      </div>
    </section>
  );

});

FreshReleasesSection.displayName = 'FreshReleasesSection';
export default FreshReleasesSection;