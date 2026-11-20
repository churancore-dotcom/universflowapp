import { memo } from 'react';
import { motion } from 'framer-motion';
import { Play, Pause } from 'lucide-react';
import { Song, usePlayer } from '@/contexts/PlayerContext';
import { triggerHaptic } from '@/hooks/useHaptics';

/** Editorial hero: ambient cover glow, square art, and a typographic block. */
const HomeStage = memo(({ song, label, next = [] }: { song: Song; label: string; next?: Song[] }) => {
  const { currentSong, isPlaying, playSong, togglePlay } = usePlayer();
  const active = currentSong?.id === song.id;
  const onPlay = () => {
    triggerHaptic('selection');
    if (active) togglePlay();
    else playSong(song, null, [song, ...next]);
  };
  const cover = song.cover_url;

  return (
    <section className="relative px-6 pt-2 pb-2">
      {cover && (
        <div aria-hidden className="pointer-events-none absolute inset-x-0 -top-24 h-[420px] overflow-hidden">
          <img src={cover} alt="" className="w-full h-full object-cover scale-125 blur-3xl opacity-40" />
          <div className="absolute inset-0 bg-gradient-to-b from-transparent via-background/60 to-background" />
        </div>
      )}
      <motion.div
        initial={{ opacity: 0, y: 12 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.5, ease: [0.22, 1, 0.36, 1] }}
        className="relative flex gap-4 items-end"
      >
        <button
          type="button"
          onClick={onPlay}
          aria-label={`${active && isPlaying ? 'Pause' : 'Play'} ${song.title}`}
          className="relative w-[46%] aspect-square shrink-0 rounded-[22px] overflow-hidden bg-muted shadow-2xl active:scale-[0.98] transition-transform"
        >
          {cover && <img src={cover} alt={song.title} className="absolute inset-0 w-full h-full object-cover" />}
        </button>
        <div className="min-w-0 flex-1 pb-1">
          <p className="text-[10px] font-bold uppercase tracking-[0.24em] text-primary">{label}</p>
          <h2 className="font-display text-[28px] leading-[0.95] uppercase text-foreground line-clamp-3 mt-2">{song.title}</h2>
          <p className="mt-1.5 text-[13px] font-medium text-muted-foreground line-clamp-1">{song.artist}</p>
          <button
            onClick={onPlay}
            className="mt-4 inline-flex items-center gap-2 rounded-full bg-primary text-primary-foreground pl-3.5 pr-4 py-2 text-[13px] font-bold active:scale-95 transition-transform"
          >
            {active && isPlaying ? <Pause className="w-4 h-4" fill="currentColor" /> : <Play className="w-4 h-4" fill="currentColor" />}
            {active && isPlaying ? 'Pause' : 'Play'}
          </button>
        </div>
      </motion.div>
    </section>
  );
});
HomeStage.displayName = 'HomeStage';
export default HomeStage;
