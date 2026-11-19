import { memo } from 'react';
import { motion } from 'framer-motion';
import { Play, Pause } from 'lucide-react';
import { Song, usePlayer } from '@/contexts/PlayerContext';
import { triggerHaptic } from '@/hooks/useHaptics';

/** Cover-led hero at the top of the Listen screen: the artwork is the design. */
const HomeStage = memo(({ song, label }: { song: Song; label: string }) => {
  const { currentSong, isPlaying, playSong, togglePlay } = usePlayer();
  const active = currentSong?.id === song.id;
  const onPlay = () => {
    triggerHaptic('selection');
    if (active) togglePlay();
    else playSong(song);
  };
  const cover = song.cover_url;

  return (
    <section className="px-5 pt-1">
      <motion.button
        type="button"
        onClick={onPlay}
        aria-label={`${active && isPlaying ? 'Pause' : 'Play'} ${song.title}`}
        initial={{ opacity: 0, scale: 0.985 }}
        animate={{ opacity: 1, scale: 1 }}
        whileTap={{ scale: 0.985 }}
        transition={{ duration: 0.5, ease: [0.22, 1, 0.36, 1] }}
        className="relative block w-full aspect-[5/6] max-h-[440px] overflow-hidden rounded-[30px] bg-muted text-left"
      >
        {cover && (
          <img src={cover} alt={song.title} className="absolute inset-0 w-full h-full object-cover" />
        )}
        <div className="absolute inset-0 bg-gradient-to-t from-background via-background/55 to-transparent" />
        <div className="absolute inset-x-0 top-0 h-24 bg-gradient-to-b from-background/50 to-transparent" />

        <span className="absolute left-5 top-5 rounded-full bg-background/55 backdrop-blur-md px-3 py-1 text-[10px] font-bold uppercase tracking-[0.22em] text-primary">
          {label}
        </span>

        <div className="absolute inset-x-0 bottom-0 p-5 flex items-end gap-4">
          <div className="min-w-0 flex-1">
            <h2 className="font-display text-[34px] leading-[0.95] uppercase text-foreground line-clamp-2">{song.title}</h2>
            <p className="mt-2 text-[14px] font-medium text-foreground/70 truncate">{song.artist}</p>
          </div>
          <span className="w-14 h-14 shrink-0 rounded-full bg-primary text-primary-foreground grid place-items-center shadow-[0_10px_30px_-8px_hsl(var(--primary)/0.7)]">
            {active && isPlaying ? <Pause className="w-6 h-6" fill="currentColor" /> : <Play className="w-6 h-6 ml-0.5" fill="currentColor" />}
          </span>
        </div>
      </motion.button>
    </section>
  );
});
HomeStage.displayName = 'HomeStage';
export default HomeStage;
