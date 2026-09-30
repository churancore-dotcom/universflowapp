import { memo, useMemo } from 'react';
import { motion } from 'framer-motion';
import { Play, Pause, Flame, Sparkles } from 'lucide-react';
import { usePlayer, type Song } from '@/contexts/PlayerContext';
import { useLocalRecents } from '@/hooks/useLocalRecents';
import { useTasteProfile } from '@/hooks/useTasteProfile';
import { useHomeInsights } from '@/hooks/useHomeInsights';
import { historyPlaylists, recentSongs, greetingForHour } from '@/lib/personalHome';
import { triggerHaptic } from '@/hooks/useHaptics';
import SongArtwork from '@/components/SongArtwork';

/**
 * Flow Core — the personal stage at the top of Home. Everything shown comes
 * from the listener's own history: their last track, streak, top artist and
 * "vibe channels" built from songs they actually played. No history → a
 * simple chart pick with honest labelling.
 */
const FlowCore = memo(({ fallback }: { fallback: Song[] }) => {
  const { currentSong, isPlaying, togglePlay, playSong } = usePlayer();
  const entries = useLocalRecents(60);
  const taste = useTasteProfile();
  const insights = useHomeInsights();

  const history = useMemo(() => recentSongs(entries), [entries]);
  const channels = useMemo(
    () => historyPlaylists(entries, taste, { minMood: 2, minArtist: 2, max: 8 }),
    [entries, taste],
  );

  const song = currentSong || history[0] || fallback[0];
  const label = currentSong
    ? 'Now in your flow'
    : history[0]
      ? 'Pick up where you left off'
      : 'Start your flow';
  const isCurrent = !!currentSong && song?.id === currentSong.id;
  const hour = typeof window === 'undefined' ? 12 : new Date().getHours();

  const onPlay = () => {
    if (!song) return;
    triggerHaptic('impactMedium');
    if (isCurrent) return togglePlay();
    const queue = history.length ? history : fallback;
    playSong(song, null, queue);
  };

  const playChannel = (songs: Song[]) => {
    if (!songs.length) return;
    triggerHaptic('selection');
    const shuffled = [...songs].sort(() => Math.random() - 0.5);
    playSong(shuffled[0], null, shuffled, { curated: true });
  };

  if (!song) return null;

  return (
    <section className="px-6">
      <motion.div
        initial={{ opacity: 0, y: 12 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.45, ease: [0.16, 1, 0.3, 1] }}
        className="relative overflow-hidden rounded-3xl border border-border/60 bg-card p-5"
      >
        {song.cover_url && (
          <img
            src={song.cover_url}
            alt=""
            aria-hidden
            referrerPolicy="no-referrer"
            className="absolute inset-0 h-full w-full object-cover opacity-30 blur-2xl scale-125 pointer-events-none"
          />
        )}
        <div className="absolute inset-0 bg-gradient-to-t from-card via-card/70 to-transparent pointer-events-none" />

        <div className="relative flex items-center gap-4">
          <div className="relative shrink-0">
            {isCurrent && isPlaying && (
              <motion.span
                aria-hidden
                className="absolute -inset-1.5 rounded-[22px] border-2 border-primary/60"
                animate={{ opacity: [0.35, 0.9, 0.35], scale: [1, 1.04, 1] }}
                transition={{ duration: 2.4, repeat: Infinity, ease: 'easeInOut' }}
              />
            )}
            <div className="w-24 h-24 rounded-2xl overflow-hidden shadow-lg">
              <SongArtwork song={song} className="w-full h-full object-cover" />
            </div>
          </div>
          <div className="min-w-0 flex-1">
            <p className="text-[10px] font-bold uppercase tracking-[0.2em] text-primary">{label}</p>
            <h2 className="text-[19px] font-bold leading-tight text-foreground truncate mt-1">{song.title}</h2>
            <p className="text-[13px] text-muted-foreground truncate">{song.artist}</p>
            <button
              onClick={onPlay}
              className="mt-3 inline-flex items-center gap-1.5 rounded-full bg-primary px-4 py-2 text-[12px] font-bold text-primary-foreground active:scale-95 transition-transform"
            >
              {isCurrent && isPlaying ? <Pause className="w-3.5 h-3.5" /> : <Play className="w-3.5 h-3.5 fill-current" />}
              {isCurrent && isPlaying ? 'Pause' : 'Play'}
            </button>
          </div>
        </div>

        {(insights.streak.current > 0 || insights.weekTopArtist || insights.topGenre) && (
          <div className="relative mt-4 flex flex-wrap gap-2">
            {insights.streak.current > 0 && (
              <span className="inline-flex items-center gap-1 rounded-full bg-background/60 px-2.5 py-1 text-[11px] font-semibold text-foreground">
                <Flame className="w-3 h-3 text-primary" /> {insights.streak.current}-day streak
              </span>
            )}
            {insights.weekTopArtist && (
              <span className="rounded-full bg-background/60 px-2.5 py-1 text-[11px] font-semibold text-foreground truncate max-w-[60%]">
                On repeat: {insights.weekTopArtist}
              </span>
            )}
            {insights.topGenre && (
              <span className="rounded-full bg-background/60 px-2.5 py-1 text-[11px] font-semibold text-muted-foreground">
                Your sound: {insights.topGenre}
              </span>
            )}
          </div>
        )}
      </motion.div>

      {channels.length > 0 && (
        <div className="mt-5">
          <div className="flex items-center gap-1.5 mb-2.5">
            <Sparkles className="w-3.5 h-3.5 text-primary" />
            <p className="text-[12px] font-bold text-foreground/90">
              Your vibe channels · {greetingForHour(hour).toLowerCase()}
            </p>
          </div>
          <div className="-mx-6 px-6 flex gap-2.5 overflow-x-auto scrollbar-hide pb-1">
            {channels.map((c) => (
              <button
                key={c.id}
                onClick={() => playChannel(c.songs)}
                className="shrink-0 flex items-center gap-2.5 rounded-full border border-border/60 bg-card pl-1 pr-4 py-1 active:scale-95 transition-transform"
              >
                <span className="w-8 h-8 rounded-full overflow-hidden bg-muted shrink-0">
                  {c.cover_url && <img src={c.cover_url} alt="" referrerPolicy="no-referrer" className="w-full h-full object-cover" />}
                </span>
                <span className="text-left">
                  <span className="block text-[12px] font-bold text-foreground leading-tight">{c.title}</span>
                  <span className="block text-[10px] text-muted-foreground">{c.songs.length} songs</span>
                </span>
              </button>
            ))}
          </div>
        </div>
      )}
    </section>
  );
});

FlowCore.displayName = 'FlowCore';
export default FlowCore;
