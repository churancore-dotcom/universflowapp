import React, { memo, ReactNode } from 'react';
import { ChevronRight } from 'lucide-react';
import { triggerHaptic } from '@/hooks/useHaptics';

interface RailHeaderProps {
  title: string;
  subtitle?: string;
  /** Small element rendered next to the title (e.g. a Live pill). */
  badge?: ReactNode;
  actionLabel?: string;
  onAction?: () => void;
}

/**
 * One header for every Home shelf: same type scale, same spacing, same
 * alignment. No gutter stamps, no diagonal rules — those were the parts that
 * read as broken.
 */
const RailHeader = memo(({ title, subtitle, badge, actionLabel, onAction }: RailHeaderProps) => (
  <div className="flex items-center justify-between gap-3 mb-5">
    <div className="min-w-0">
      <div className="flex items-center gap-2">
        <h2 className="text-[19px] font-bold tracking-tight text-foreground/90 truncate">{title}</h2>
        {badge}
      </div>
      {subtitle && (
        <p className="text-[12.5px] text-muted-foreground/60 font-medium truncate mt-0.5">
          {subtitle}
        </p>
      )}
    </div>
    {onAction && (
      <button
        onClick={() => { triggerHaptic('selection'); onAction(); }}
        className="flex items-center gap-0.5 shrink-0 text-[12px] font-bold text-primary active:opacity-60 transition-opacity"
      >
        {actionLabel || 'See all'}
        <ChevronRight className="w-3.5 h-3.5" />
      </button>
    )}
  </div>
));

RailHeader.displayName = 'RailHeader';
export default RailHeader;
