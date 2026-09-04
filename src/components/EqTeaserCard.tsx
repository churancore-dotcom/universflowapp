/**
 * Inline Studio EQ teaser — a small live equalizer visualisation in the Home
 * feed that opens the real equalizer modal on tap. Bars animate from the saved
 * EQ curve when there is one, so the card reflects the listener's actual
 * settings rather than decorative noise.
 */
import { memo, useMemo } from 'react';
import { motion } from 'framer-motion';
import { SlidersHorizontal } from 'lucide-react';
import { triggerHaptic } from '@/hooks/useHaptics';
import { loadEqSettings } from '@/lib/eqSettings';

const BAR_COUNT = 12;

const EqTeaserCard = memo(({ onOpen }: { onOpen: () => void }) => {
  const { heights, label } = useMemo(() => {
    let gains: number[] = [];
    let presetLabel = 'Flat';
    try {
      const saved = loadEqSettings();
      const raw = (saved as unknown as { gains?: number[]; bands?: number[]; preset?: string }) || {};
      gains = raw.gains || raw.bands || [];
      if (raw.preset) presetLabel = String(raw.preset).replace(/[-_]/g, ' ');
    } catch {
      /* fall back to the neutral curve */
    }

    const base = Array.from({ length: BAR_COUNT }, (_, i) => {
      const g = gains.length ? gains[Math.floor((i / BAR_COUNT) * gains.length)] || 0 : 0;
      // 0 dB sits mid-height; ±12 dB spans the card.
      return Math.max(0.18, Math.min(1, 0.5 + g / 24));
    });

    return { heights: base, label: presetLabel };
  }, []);

  return (
    <motion.button
      type="button"
      onClick={() => { triggerHaptic('selection'); onOpen(); }}
      whileTap={{ scale: 0.98 }}
      aria-label="Open the studio equalizer"
      className="w-full rounded-[28px] border border-border/60 bg-card/70 p-4 text-left overflow-hidden"
    >
      <div className="flex items-center justify-between gap-3">
        <div className="min-w-0">
          <p className="flex items-center gap-1.5 text-[10px] font-bold uppercase tracking-[0.18em] text-primary">
            <SlidersHorizontal className="w-3 h-3" /> Studio EQ
          </p>
          <p className="text-[13.5px] font-bold text-foreground mt-1 truncate">
            Shape your sound
          </p>
          <p className="text-[11.5px] text-muted-foreground truncate capitalize">{label} · tap to tune</p>
        </div>

        <div className="flex items-end gap-[3px] h-12 shrink-0" aria-hidden="true">
          {heights.map((h, i) => (
            <motion.span
              key={i}
              className="w-[5px] rounded-full bg-primary/70"
              style={{ height: `${h * 100}%` }}
              animate={{ scaleY: [1, 0.62 + (i % 3) * 0.16, 1] }}
              transition={{
                duration: 1.1 + (i % 4) * 0.22,
                repeat: Infinity,
                ease: 'easeInOut',
                delay: i * 0.06,
              }}
            />
          ))}
        </div>
      </div>
    </motion.button>
  );
});

EqTeaserCard.displayName = 'EqTeaserCard';
export default EqTeaserCard;
