import { memo } from 'react';
import { motion } from 'framer-motion';
import { Crown, Lock, X, Disc3 } from 'lucide-react';
import { useNavigate } from '@/lib/router-compat';
import { iosSpring, iosBounce } from '@/lib/animations';
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
      className="fixed inset-0 z-[200] flex items-center justify-center bg-black/85 p-6"
      onClick={onClose}
    >
      <motion.div
        initial={{ scale: 0.9, opacity: 0, y: 20 }}
        animate={{ scale: 1, opacity: 1, y: 0 }}
        exit={{ scale: 0.9, opacity: 0 }}
        transition={iosSpring}
        onClick={e => e.stopPropagation()}
        className="w-full max-w-sm rounded-3xl overflow-hidden relative"
        style={{
          background: 'linear-gradient(160deg, hsl(var(--primary) / 0.25) 0%, hsl(var(--card)) 50%, hsl(var(--accent) / 0.18) 100%)',
          border: '1px solid hsl(var(--primary) / 0.4)',
          boxShadow: '0 30px 80px -20px hsl(var(--primary) / 0.6)',
        }}
      >
        <div
          className="absolute -top-20 -right-20 w-44 h-44 rounded-full opacity-50 pointer-events-none"
          style={{ background: 'radial-gradient(circle, hsl(var(--primary) / 0.5), transparent 70%)', filter: 'blur(30px)' }}
        />

        <button
          onClick={onClose}
          className="absolute top-4 right-4 p-2 rounded-full bg-white/10 z-10"
        >
          <X className="w-4 h-4" />
        </button>

        <div className="p-7 pt-9 text-center relative">
          <motion.div
            initial={{ scale: 0, rotate: -20 }}
            animate={{ scale: 1, rotate: 0 }}
            transition={{ ...iosBounce, delay: 0.1 }}
            className="w-16 h-16 mx-auto mb-4 rounded-2xl flex items-center justify-center"
            style={{ background: 'linear-gradient(135deg, hsl(var(--primary)), hsl(var(--accent)))' }}
          >
            <Lock className="w-7 h-7 text-primary-foreground" />
          </motion.div>

          <p className="text-[10px] font-bold tracking-[0.2em] text-primary uppercase mb-2">
            Premium feature
          </p>
          <h2 className="text-[24px] font-bold mb-6 leading-tight">{title}</h2>
          {description && <p className="text-sm text-muted-foreground mb-6 leading-relaxed">{description}</p>}

          <motion.button
            whileTap={{ scale: 0.96 }}
            onClick={() => { haptics.medium(); onClose(); navigate('/premium'); }}
            className="w-full py-4 rounded-2xl font-bold text-[16px] flex items-center justify-center gap-2"
            style={{
              background: 'linear-gradient(135deg, hsl(var(--primary)), hsl(var(--accent)))',
              color: 'hsl(var(--primary-foreground))',
              boxShadow: '0 12px 30px -8px hsl(var(--primary) / 0.6)',
            }}
          >
            <Crown className="w-5 h-5" fill="currentColor" />
            Unlock with Premium
            <Disc3 className="w-4 h-4" />
          </motion.button>

          <button
            onClick={onClose}
            className="w-full py-3 mt-2 text-sm text-muted-foreground"
          >
            Maybe later
          </button>
        </div>
      </motion.div>
    </motion.div>
  );
});

export default PremiumLockOverlay;
