import { memo } from 'react';
import { motion } from 'framer-motion';
import { Play, Pause } from 'lucide-react';
import { Song, usePlayer } from '@/contexts/PlayerContext';
import { triggerHaptic } from '@/hooks/useHaptics';

/** Editorial cover-led stage at the top of the Listen screen. */
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
    <section className="px-6 pt-1">
      <motion.div
        initial={{ opacity: 0, y: 10 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.45, ease: [0.22, 1, 0.36, 1] }}
        className="relative overflow-hidden rounded-[28px] border border-border/60 bg-card"
      >
        {cover && (
          <img
            src={cover}
            alt=""
            aria-hidden
            className="absolute inset-0 w-full h-full object-cover scale-125 blur-2xl opacity-60"
          />
        )}
        <div className="absolute inset-0 bg-gradient-to-b from-background/10 via-background/40 to-background/90" />
        <div className="relative flex items-end gap-4 p-4">
          <div className="w-[118px] h-[118px] shrink-0 rounded-2xl overflow-hidden bg-muted shadow-2xl ring-1 ring-border/60">
            {cover && <img src={cover} alt={song.title} className="w-full h-full object-cover" />}
          </div>
          <div className="min-w-0 flex-1 pb-1">
            <p className="text-[10px] font-semibold uppercase tracking-[0.24em] text-primary">{label}</p>
            <h2 className="mt-1.5 text-[19px] font-bold leading-tight text-foreground line-clamp-2">{song.title}</h2>
            <p className="mt-0.5 text-[13px] text-muted-foreground truncate">{song.artist}</p>
            <button
              onClick={onPlay}
              aria-label={active && isPlaying ? 'Pause' : 'Play'}
              className="mt-3 inline-flex items-center gap-2 rounded-full bg-primary px-4 py-2 text-[13px] font-semibold text-primary-foreground active:scale-95 transition-transform"
            >
              {active && isPlaying ? <Pause className="w-4 h-4" fill="currentColor" /> : <Play className="w-4 h-4" fill="currentColor" />}
              {active && isPlaying ? 'Pause' : active ? 'Resume' : 'Play'}
            </button>
          </div>
        </div>
      </motion.div>
    </section>
  );
});
HomeStage.displayName = 'HomeStage';
export default HomeStage;
