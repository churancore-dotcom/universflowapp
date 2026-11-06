import { memo } from 'react';
import { motion } from 'framer-motion';
import { Lock, X } from 'lucide-react';
import { useNavigate } from '@/lib/router-compat';
import { iosSpring } from '@/lib/animations';
import { useHaptics } from '@/hooks/useHaptics';

interface PremiumLockOverlayProps {
  title: string;
  description?: string;
  onClose: () => void;
}

/**
 * Full-screen premium upsell overlay used inside modals to gate features.
 */
const PremiumLockOverlay = memo(function PremiumLockOverlay({
  title, description, onClose,
}: PremiumLockOverlayProps) {
  const navigate = useNavigate();
  const haptics = useHaptics();

  return (
    <motion.div
      initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
      className="fixed inset-0 z-[200] flex items-end justify-center bg-background/70"
      onClick={onClose}
    >
      <motion.div
        initial={{ y: 40, opacity: 0 }}
        animate={{ y: 0, opacity: 1 }}
        exit={{ y: 40, opacity: 0 }}
        transition={iosSpring}
        onClick={e => e.stopPropagation()}
        className="w-full max-w-md rounded-t-[22px] bg-card border-t border-border/60 px-6 pt-3 pb-[calc(env(safe-area-inset-bottom)+20px)]"
      >
        <div className="w-9 h-1 rounded-full bg-muted mx-auto mb-5" />
        <div className="flex items-start justify-between gap-4">
          <div className="min-w-0">
            <p className="flex items-center gap-1.5 text-[12px] font-medium text-muted-foreground mb-1">
              <Lock className="w-3.5 h-3.5" /> Premium
            </p>
            <h2 className="text-[20px] font-semibold leading-snug">{title}</h2>
          </div>
          <button onClick={onClose} aria-label="Close" className="p-1.5 -mr-1.5 rounded-full text-muted-foreground active:bg-muted">
            <X className="w-5 h-5" />
          </button>
        </div>
        {description && <p className="text-[14px] text-muted-foreground mt-2 leading-relaxed">{description}</p>}

        <button
          onClick={() => { haptics.medium(); onClose(); navigate('/premium'); }}
          className="w-full mt-6 py-3.5 rounded-xl bg-primary text-primary-foreground font-semibold text-[15px] active:opacity-80"
        >
          See plans
        </button>
        <button onClick={onClose} className="w-full py-3 mt-1 text-[14px] text-muted-foreground">
          Not now
        </button>
      </motion.div>
    </motion.div>
  );
});

export default PremiumLockOverlay;
