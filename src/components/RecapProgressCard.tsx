/**
 * Recap progress — a slim card showing genuine progress toward the next
 * listening recap, counted from real plays inside the current month.
 * It only renders once there is enough history for a recap to be meaningful.
 */
import { memo } from 'react';
import { motion } from 'framer-motion';
import { Sparkles, ChevronRight } from 'lucide-react';
import { triggerHaptic } from '@/hooks/useHaptics';

/** Recap needs a real amount of listening behind it to be worth showing. */
export const RECAP_TARGET = 60;

interface Props {
  monthPlays: number;
  onOpen: () => void;
}

const RecapProgressCard = memo(({ monthPlays, onOpen }: Props) => {
  if (monthPlays < 5) return null;

  const remaining = Math.max(0, RECAP_TARGET - monthPlays);
  const pct = Math.min(100, (monthPlays / RECAP_TARGET) * 100);
  const monthLabel = new Date().toLocaleDateString(undefined, { month: 'long' });

  return (
    <motion.button
      type="button"
      onClick={() => { triggerHaptic('selection'); onOpen(); }}
      whileTap={{ scale: 0.98 }}
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      className="w-full rounded-[28px] border border-border/60 bg-card/70 px-4 py-3.5 text-left"
      aria-label="Preview your listening recap"
    >
      <div className="flex items-center gap-3">
        <span className="w-9 h-9 shrink-0 rounded-full bg-primary/15 text-primary flex items-center justify-center">
          <Sparkles className="w-4 h-4" />
        </span>
        <div className="min-w-0 flex-1">
          <p className="text-[13px] font-bold text-foreground truncate">
            {remaining > 0
              ? `${remaining} more song${remaining === 1 ? '' : 's'} until your ${monthLabel} Recap`
              : `Your ${monthLabel} Recap is ready`}
          </p>
          <div className="h-[3px] rounded-full bg-foreground/12 overflow-hidden mt-2">
            <motion.div
              className="h-full rounded-full bg-primary"
              initial={{ width: 0 }}
              animate={{ width: `${pct}%` }}
              transition={{ type: 'spring', stiffness: 90, damping: 20 }}
            />
          </div>
          <p className="text-[11px] text-muted-foreground mt-1.5 tabular-nums">
            {monthPlays} played this month
          </p>
        </div>
        <ChevronRight className="w-4 h-4 shrink-0 text-muted-foreground" />
      </div>
    </motion.button>
  );
});

RecapProgressCard.displayName = 'RecapProgressCard';
export default RecapProgressCard;
