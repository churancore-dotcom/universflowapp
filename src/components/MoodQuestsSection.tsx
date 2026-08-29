import { memo, useCallback, useEffect, useMemo, useState } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import { Play, Loader2, Check } from 'lucide-react';
import { useAuth } from '@/contexts/AuthContext';
import { usePlayer, type Song } from '@/contexts/PlayerContext';
import { readLocalRecent } from '@/lib/localRecentlyPlayed';
import { searchYouTubeMusicTracks, feedRotationSalt } from '@/lib/musicIndexer';
import { prewarmSongs } from '@/lib/instantPlay';
import { triggerHaptic } from '@/hooks/useHaptics';
import { toast } from 'sonner';

/**
 * MOOD QUESTS
 *
 * A live read of the user's listening *flow*: each quest tracks how many songs
 * of a given mood they've played, fills up as they listen, and hands them a
 * fresh mood mix on tap. Everything is derived from real local play history —
 * no fake progress, no invented numbers.
 */

type Quest = {
  id: string;
  label: string;
  blurb: string;
  goal: number;
  query: string;
  /** words that indicate this mood in a title/artist string */
  cues: string[];
};

const QUESTS: Quest[] = [
  { id: 'chill', label: 'Chill Run', blurb: 'Slow it down', goal: 5, query: 'chill lofi songs', cues: ['chill', 'lofi', 'lo-fi', 'slow', 'acoustic', 'calm', 'soft'] },
  { id: 'hype', label: 'Hype Streak', blurb: 'Full throttle', goal: 5, query: 'hype workout bangers', cues: ['hype', 'party', 'remix', 'bass', 'workout', 'edm', 'phonk', 'trap'] },
  { id: 'love', label: 'Heart Mode', blurb: 'All feelings', goal: 4, query: 'romantic love songs', cues: ['love', 'heart', 'dil', 'pyaar', 'romantic', 'baby'] },
  { id: 'night', label: 'Late Night', blurb: 'After midnight sound', goal: 4, query: 'late night drive songs', cues: ['night', 'raat', 'moon', 'drive', 'midnight', 'dark'] },
  { id: 'focus', label: 'Deep Focus', blurb: 'Nothing but flow', goal: 6, query: 'instrumental focus music', cues: ['focus', 'instrumental', 'study', 'ambient', 'piano', 'beats'] },
];

function scoreQuest(quest: Quest, plays: string[]): number {
  let n = 0;
  for (const p of plays) {
    if (quest.cues.some((cue) => p.includes(cue))) n += 1;
  }
  return n;
}

const MoodQuestsSection = memo(() => {
  const { user } = useAuth();
  const { playSong, currentSong } = usePlayer();
  const [version, setVersion] = useState(0);
  const [loadingId, setLoadingId] = useState<string | null>(null);

  // Real-time: recompute whenever a play lands or the track changes.
  useEffect(() => {
    const bump = () => setVersion((v) => v + 1);
    window.addEventListener('universflow:recently-played-changed', bump);
    window.addEventListener('uf:likes-changed', bump);
    return () => {
      window.removeEventListener('universflow:recently-played-changed', bump);
      window.removeEventListener('uf:likes-changed', bump);
    };
  }, []);

  const plays = useMemo(() => {
    void version;
    void currentSong?.id;
    const recents = readLocalRecent(user?.id ?? null);
    return recents.map((r) => `${r.song?.title ?? ''} ${r.song?.artist ?? ''}`.toLowerCase());
  }, [user?.id, version, currentSong?.id]);

  const ranked = useMemo(() => {
    return QUESTS.map((quest) => {
      const done = Math.min(scoreQuest(quest, plays), quest.goal);
      return { quest, done, pct: Math.round((done / quest.goal) * 100) };
    }).sort((a, b) => b.done - a.done);
  }, [plays]);

  const start = useCallback(
    async (quest: Quest) => {
      triggerHaptic('impactMedium');
      setLoadingId(quest.id);
      try {
        const tracks = await searchYouTubeMusicTracks(`${quest.query}`, 30, feedRotationSalt());
        const songs = tracks
          .filter((t) => t.videoId && t.title)
          .slice(0, 25)
          .map<Song>((t) => ({
            id: `ytm-${t.videoId}`,
            title: t.title,
            artist: t.artist || 'Unknown Artist',
            cover_url: t.cover_url || '',
            audio_url: `yt-video:${t.videoId}`,
            duration: t.duration || 0,
            videoId: t.videoId,
          } as Song));
        if (!songs.length) {
          toast.error('No tracks for this quest right now');
          return;
        }
        prewarmSongs(songs, 3);
        playSong(songs[0], null, songs);
      } catch {
        toast.error('Could not start this quest');
      } finally {
        setLoadingId(null);
      }
    },
    [playSong],
  );

  return (
    <section>
      <div className="flex items-baseline justify-between mb-4">
        <h2 className="font-display text-[32px] leading-none font-black uppercase tracking-tight text-foreground">
          Mood Quests
        </h2>
      </div>
      <p className="text-[12px] text-muted-foreground mb-4 -mt-2">
        Fills up live as you listen. Tap one to dive in.
      </p>

      <div className="flex gap-3 overflow-x-auto scrollbar-hide -mx-6 px-6 pb-1">
        <AnimatePresence initial={false}>
          {ranked.map(({ quest, done, pct }, i) => {
            const complete = done >= quest.goal;
            const busy = loadingId === quest.id;
            return (
              <motion.button
                key={quest.id}
                layout
                type="button"
                onClick={() => void start(quest)}
                initial={{ opacity: 0, y: 14, scale: 0.96 }}
                animate={{ opacity: 1, y: 0, scale: 1 }}
                transition={{ type: 'spring', stiffness: 200, damping: 22, delay: 0.04 * i }}
                whileTap={{ scale: 0.96 }}
                className="relative shrink-0 w-[168px] text-left rounded-[28px] border border-border/60 bg-card/70 backdrop-blur-xl p-4 overflow-hidden"
              >
                {/* live fill */}
                <motion.div
                  className="absolute inset-x-0 bottom-0 bg-primary/15"
                  initial={{ height: 0 }}
                  animate={{ height: `${pct}%` }}
                  transition={{ type: 'spring', stiffness: 90, damping: 18 }}
                />
                <div className="relative">
                  <div className="flex items-center justify-between">
                    <span className="text-[11px] font-semibold uppercase tracking-widest text-muted-foreground">
                      {quest.blurb}
                    </span>
                    <span className="w-7 h-7 rounded-full bg-primary text-primary-foreground grid place-items-center">
                      {busy ? (
                        <Loader2 className="w-3.5 h-3.5 animate-spin" />
                      ) : complete ? (
                        <Check className="w-3.5 h-3.5" />
                      ) : (
                        <Play className="w-3 h-3 fill-current" />
                      )}
                    </span>
                  </div>
                  <p className="mt-6 text-[19px] font-black leading-tight text-foreground">{quest.label}</p>
                  <div className="mt-3 h-1.5 rounded-full bg-muted overflow-hidden">
                    <motion.div
                      className="h-full rounded-full bg-primary"
                      initial={{ width: 0 }}
                      animate={{ width: `${pct}%` }}
                      transition={{ type: 'spring', stiffness: 120, damping: 20 }}
                    />
                  </div>
                  <p className="mt-2 text-[11px] font-semibold text-muted-foreground tabular-nums">
                    {done}/{quest.goal} {complete ? '· cleared' : 'tracks'}
                  </p>
                </div>
              </motion.button>
            );
          })}
        </AnimatePresence>
      </div>
    </section>
  );
});

MoodQuestsSection.displayName = 'MoodQuestsSection';

export default MoodQuestsSection;
