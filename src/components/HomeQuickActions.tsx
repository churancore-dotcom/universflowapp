/**
 * Quick actions strip — a horizontally scrollable row of distinct, tappable
 * chips instead of one static hero card.
 *
 * Every chip is backed by real state:
 *  - Continue: the live player, or the persisted player snapshot, or the newest
 *    device history entry.
 *  - Jump back in: the next-most-recent track in device history.
 *  - On your streak: the track played most across the current streak days.
 * A chip that has no signal behind it simply isn't rendered.
 */
import { memo } from 'react';
import { motion } from 'framer-motion';
import { Play, Pause, History, Flame } from 'lucide-react';
import { Song, usePlayer } from '@/contexts/PlayerContext';
import OptimizedImage from './OptimizedImage';
import { triggerHaptic } from '@/hooks/useHaptics';
import { prewarmIntentProps } from '@/lib/instantPlay';

export interface QuickAction {
  key: 'continue' | 'jump' | 'streak';
  label: string;
  song: Song;
  queue: Song[];
}

const STYLES: Record<
  QuickAction['key'],
  { icon: typeof Play; ring: string; tint: string; text: string }
> = {
  continue: {
    icon: Play,
    ring: 'border-primary/45',
    tint: 'bg-primary/12',
    text: 'text-primary',
  },
  jump: {
    icon: History,
    ring: 'border-sky-400/40',
    tint: 'bg-sky-400/10',
    text: 'text-sky-400',
  },
  streak: {
    icon: Flame,
    ring: 'border-amber-400/45',
    tint: 'bg-amber-400/10',
    text: 'text-amber-400',
  },
};

const HomeQuickActions = memo(({ actions }: { actions: QuickAction[] }) => {
  const { currentSong, isPlaying, playSong, togglePlay } = usePlayer();

  if (!actions.length) return null;

  return (
    <div className="flex gap-3 overflow-x-auto scrollbar-hide -mx-6 px-6 pb-1 snap-x">
      {actions.map((action, idx) => {
        const style = STYLES[action.key];
        const Icon = style.icon;
        const live = currentSong?.id === action.song.id;
        const showPause = live && isPlaying;

        return (
          <motion.button
            key={action.key}
            initial={{ opacity: 0, y: 12 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ type: 'spring', stiffness: 150, damping: 20, delay: idx * 0.05 }}
            whileTap={{ scale: 0.97 }}
            onClick={() => {
              triggerHaptic('selection');
              if (live) { togglePlay(); return; }
              playSong(action.song, null, action.queue.slice(0, 40));
            }}
            {...prewarmIntentProps(action.song)}
            aria-label={`${action.label}: ${action.song.title}`}
            className={`shrink-0 snap-start w-[236px] text-left rounded-[28px] border ${style.ring} ${style.tint} p-3 flex items-center gap-3`}
          >
            <div className="w-14 h-14 shrink-0 rounded-[14px] overflow-hidden bg-muted">
              <OptimizedImage
                src={action.song.cover_url}
                alt={action.song.title}
                className="w-full h-full object-cover"
              />
            </div>
            <div className="min-w-0 flex-1">
              <p className={`flex items-center gap-1.5 text-[10px] font-bold uppercase tracking-[0.18em] ${style.text}`}>
                <Icon className="w-3 h-3" /> {action.label}
              </p>
              <p className="text-[13.5px] font-bold text-foreground truncate mt-1">{action.song.title}</p>
              <p className="text-[11.5px] text-muted-foreground truncate">{action.song.artist}</p>
            </div>
            <span className={`w-9 h-9 shrink-0 rounded-full flex items-center justify-center bg-background/70 ${style.text}`}>
              {showPause ? <Pause className="w-4 h-4 fill-current" /> : <Play className="w-4 h-4 fill-current ml-0.5" />}
            </span>
          </motion.button>
        );
      })}
    </div>
  );
});

HomeQuickActions.displayName = 'HomeQuickActions';
export default HomeQuickActions;
