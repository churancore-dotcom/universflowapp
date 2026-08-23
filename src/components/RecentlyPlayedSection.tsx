import { memo, useMemo } from 'react';
import { motion } from 'framer-motion';
import { Play } from 'lucide-react';
import { Song, usePlayer } from '@/contexts/PlayerContext';
import OptimizedImage from './OptimizedImage';
import RailHeader from './RailHeader';
import { triggerHaptic } from '@/hooks/useHaptics';
import { prewarmIntentProps } from '@/lib/instantPlay';
import { useLocalRecents } from '@/hooks/useLocalRecents';
import { recentSongs } from '@/lib/personalHome';

/** Real device play history, newest first. Self-hides with no history. */
const RecentlyPlayedSection = memo(() => {
  const { playSong, currentSong } = usePlayer();
  const entries = useLocalRecents(40);
  const songs = useMemo(() => recentSongs(entries).slice(0, 20), [entries]);

  if (songs.length < 3) return null;

  const play = (song: Song) => {
    triggerHaptic('selection');
    playSong(song, null, songs);
  };

  return (
    <section>
      <RailHeader title="Recently Played" subtitle="Straight from your history" />
      <div className="flex gap-3 overflow-x-auto hide-scrollbar -mx-5 px-5 pb-1">
        {songs.map((song) => (
          <motion.button
            key={`${song.id}-${song.title}`}
            onClick={() => play(song)}
            whileTap={{ scale: 0.95 }}
            className="w-[132px] shrink-0 text-left"
            {...prewarmIntentProps(song)}
          >
            <div className="relative w-[132px] h-[132px] rounded-[14px] overflow-hidden bg-muted border border-border/40">
              <OptimizedImage src={song.cover_url} alt={song.title} className="w-full h-full object-cover" />
              {currentSong?.id === song.id && (
                <div className="absolute inset-0 bg-background/45 flex items-center justify-center">
                  <Play className="w-6 h-6 text-primary fill-current" />
                </div>
              )}
            </div>
            <p className="mt-2 text-[13px] font-semibold text-foreground truncate">{song.title}</p>
            <p className="text-[11.5px] text-muted-foreground truncate">{song.artist}</p>
          </motion.button>
        ))}
      </div>
    </section>
  );
});

RecentlyPlayedSection.displayName = 'RecentlyPlayedSection';
export default RecentlyPlayedSection;
