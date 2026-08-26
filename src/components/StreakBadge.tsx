import { Flame } from 'lucide-react';
import { motion } from 'framer-motion';

interface Props {
  streak: number;
  best?: number;
  activeToday?: boolean;
  onClick?: () => void;
}

/**
 * Real streak indicator. Renders nothing when there is no streak to show —
 * a fake "0 day streak" badge is worse than no badge.
 */
const StreakBadge = ({ streak, best, activeToday = true, onClick }: Props) => {
  if (streak < 1) return null;

  return (
    <motion.button
      type="button"
      onClick={onClick}
      whileTap={{ scale: 0.96 }}
      className="neu-sm neu-press inline-flex items-center gap-2 pl-2.5 pr-3.5 py-2 rounded-full"
      aria-label={`${streak} day listening streak`}
    >
      <span
        className={`inline-flex w-6 h-6 rounded-full items-center justify-center ${
          activeToday ? 'bg-primary text-primary-foreground' : 'bg-muted text-muted-foreground'
        }`}
      >
        <Flame className="w-3.5 h-3.5 fill-current" />
      </span>
      <span className="text-[12px] font-bold tabular-nums text-foreground">
        {streak}
        <span className="text-muted-foreground font-semibold"> day{streak === 1 ? '' : 's'}</span>
      </span>
      {typeof best === 'number' && best > streak && (
        <span className="text-[10.5px] font-semibold text-muted-foreground/70">best {best}</span>
      )}
    </motion.button>
  );
};

export default StreakBadge;
