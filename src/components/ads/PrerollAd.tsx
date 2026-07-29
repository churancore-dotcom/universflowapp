import { useState, useEffect, memo, useCallback } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Crown, X, Volume2, VolumeX, Music, Disc3, Zap } from 'lucide-react';
import { useNavigate } from '@/lib/router-compat';
import { usePremium } from '@/hooks/usePremium';
import { iosSpring } from '@/lib/animations';

interface PrerollAdProps {
  isOpen: boolean;
  onComplete: () => void;
  onSkip?: () => void;
  adDuration?: number;
  adType?: 'start' | 'end';
}

const PrerollAd = memo(function PrerollAd({ 
  isOpen, 
  onComplete, 
  onSkip,
  adDuration = 5,
  adType = 'start'
}: PrerollAdProps) {
  const { isPremium, isLoading } = usePremium();
  const navigate = useNavigate();
  const [countdown, setCountdown] = useState(adDuration);
  const [isMuted, setIsMuted] = useState(false);
  const [progress, setProgress] = useState(0);

  useEffect(() => {
    if (!isOpen) {
      setCountdown(adDuration);
      setProgress(0);
      return;
    }

    // If premium, skip ad immediately
    if (isPremium && !isLoading) {
      onComplete();
      return;
    }

    const interval = setInterval(() => {
      setCountdown((prev) => {
        if (prev <= 1) {
          clearInterval(interval);
          onComplete();
          return 0;
        }
        return prev - 1;
      });
      setProgress((prev) => Math.min(prev + (100 / adDuration), 100));
    }, 1000);

    return () => clearInterval(interval);
  }, [isOpen, adDuration, onComplete, isPremium, isLoading]);

  const handleUpgrade = useCallback(() => {
    onSkip?.();
    navigate('/profile');
  }, [navigate, onSkip]);

  // Don't show for premium users or while loading
  if (isPremium || isLoading) {
    return null;
  }

  const isEndAd = adType === 'end';

  return (
    <AnimatePresence>
      {isOpen && (
        <motion.div
          className="fixed inset-0 z-[100] flex items-center justify-center"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.3 }}
        >
          {/* Backdrop */}
          <motion.div 
            className="absolute inset-0 bg-black/95"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
          />

          {/* Animated Background */}
          <div className="absolute inset-0 overflow-hidden">
            <motion.div
              className="absolute top-1/4 left-1/4 w-64 h-64 rounded-full opacity-20"
              style={{ background: 'radial-gradient(circle, hsl(var(--primary)) 0%, transparent 70%)' }}
              animate={{ scale: [1, 1.2, 1], x: [0, 30, 0], y: [0, -20, 0] }}
              transition={{ duration: 8, repeat: Infinity, ease: 'easeInOut' }}
            />
            <motion.div
              className="absolute bottom-1/4 right-1/4 w-48 h-48 rounded-full opacity-15"
              style={{ background: 'radial-gradient(circle, hsl(var(--accent)) 0%, transparent 70%)' }}
              animate={{ scale: [1.2, 1, 1.2], x: [0, -20, 0], y: [0, 30, 0] }}
              transition={{ duration: 6, repeat: Infinity, ease: 'easeInOut' }}
            />
          </div>

          {/* Content */}
          <motion.div
            className="relative z-10 w-full max-w-sm mx-4"
            initial={{ scale: 0.9, opacity: 0, y: 20 }}
            animate={{ scale: 1, opacity: 1, y: 0 }}
            exit={{ scale: 0.9, opacity: 0, y: 20 }}
            transition={iosSpring}
          >
            {/* Ad Label & Controls */}
            <div className="flex items-center justify-between mb-4">
              <div className="flex items-center gap-2">
                <motion.div
                  className="w-2 h-2 rounded-full bg-primary"
                  animate={{ scale: [1, 1.3, 1], opacity: [1, 0.7, 1] }}
                  transition={{ duration: 1, repeat: Infinity }}
                />
                <span className="text-xs text-muted-foreground font-medium tracking-wider uppercase">
                  {isEndAd ? 'Song Complete' : 'Loading Music'} • {countdown}s
                </span>
              </div>
              <motion.button
                onClick={() => setIsMuted(!isMuted)}
                className="w-8 h-8 rounded-full flex items-center justify-center bg-white/10 backdrop-blur-sm"
                whileTap={{ scale: 0.9 }}
              >
                {isMuted ? (
                  <VolumeX className="w-4 h-4 text-muted-foreground" />
                ) : (
                  <Volume2 className="w-4 h-4 text-muted-foreground" />
                )}
              </motion.button>
            </div>

            {/* Progress Bar */}
            <div className="h-1.5 rounded-full bg-white/10 mb-6 overflow-hidden backdrop-blur-sm">
              <motion.div
                className="h-full rounded-full bg-gradient-to-r from-primary via-accent to-primary"
                initial={{ width: 0 }}
                animate={{ width: `${progress}%` }}
                transition={{ duration: 0.3 }}
              />
            </div>

            {/* Ad Card */}
            <motion.div
              className="rounded-3xl p-6 text-center backdrop-blur-xl"
              style={{
                background: 'linear-gradient(135deg, rgba(232, 76, 111, 0.15), rgba(139, 92, 246, 0.1))',
                border: '1px solid rgba(232, 76, 111, 0.25)',
              }}
              initial={{ y: 20, opacity: 0 }}
              animate={{ y: 0, opacity: 1 }}
              transition={{ ...iosSpring, delay: 0.1 }}
            >
              {/* Premium Icon with Animation */}
              <motion.div
                className="w-24 h-24 rounded-2xl mx-auto mb-5 flex items-center justify-center relative"
                style={{
                  background: 'linear-gradient(135deg, hsl(var(--primary)), hsl(var(--accent)))',
                  boxShadow: '0 15px 50px -10px hsl(var(--primary) / 0.5)',
                }}
                initial={{ scale: 0, rotate: -20 }}
                animate={{ scale: 1, rotate: 0 }}
                transition={{ ...iosSpring, delay: 0.2 }}
              >
                <Crown className="w-12 h-12 text-white" />
                <motion.div
                  className="absolute -top-1 -right-1"
                  animate={{ rotate: [0, 15, -15, 0] }}
                  transition={{ duration: 2, repeat: Infinity }}
                >
                  <Disc3 className="w-5 h-5 text-accent" />
                </motion.div>
              </motion.div>

              {/* Message */}
              <motion.h2
                className="text-2xl font-bold mb-2 bg-gradient-to-r from-white to-white/80 bg-clip-text text-transparent"
                initial={{ opacity: 0, y: 10 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: 0.25 }}
              >
                {isEndAd ? 'Enjoyed That Song?' : 'Unlimited Music Awaits'}
              </motion.h2>
              <motion.p
                className="text-sm text-muted-foreground mb-6 leading-relaxed"
                initial={{ opacity: 0, y: 10 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: 0.3 }}
              >
                {isEndAd 
                  ? 'Go Premium for ad-free listening, offline downloads, and exclusive content.'
                  : 'Skip all ads forever with Premium. Enjoy uninterrupted music, offline mode, and lossless audio.'}
              </motion.p>

              {/* Benefits */}
              <motion.div
                className="grid grid-cols-2 gap-2 mb-6"
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                transition={{ delay: 0.35 }}
              >
                {[
                  { icon: Zap, label: 'Ad-free' },
                  { icon: Music, label: 'Offline' },
                  { icon: Disc3, label: 'Lossless' },
                  { icon: Crown, label: 'Exclusive' },
                ].map(({ icon: Icon, label }) => (
                  <motion.div
                    key={label}
                    className="flex items-center gap-2 px-3 py-2 rounded-xl"
                    style={{
                      background: 'rgba(232, 76, 111, 0.1)',
                      border: '1px solid rgba(232, 76, 111, 0.2)',
                    }}
                    whileHover={{ scale: 1.02 }}
                  >
                    <Icon className="w-4 h-4 text-primary" />
                    <span className="text-xs font-medium text-foreground">{label}</span>
                  </motion.div>
                ))}
              </motion.div>

              {/* CTA Button */}
              <motion.button
                className="w-full py-4 rounded-xl font-bold text-white text-lg relative overflow-hidden"
                style={{
                  background: 'linear-gradient(135deg, hsl(var(--primary)), hsl(var(--accent)))',
                }}
                onClick={handleUpgrade}
                whileHover={{ scale: 1.02 }}
                whileTap={{ scale: 0.98 }}
                initial={{ opacity: 0, y: 10 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: 0.4 }}
              >
                <motion.div
                  className="absolute inset-0 bg-gradient-to-r from-transparent via-white/20 to-transparent"
                  animate={{ x: ['-100%', '100%'] }}
                  transition={{ duration: 2, repeat: Infinity, repeatDelay: 1 }}
                />
                <span className="relative z-10">🎵 Get Premium Now</span>
              </motion.button>
            </motion.div>

            {/* Skip hint */}
            <motion.div
              className="text-center mt-4 space-y-1"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              transition={{ delay: 0.5 }}
            >
              <p className="text-xs text-muted-foreground">
                Ad closes in {countdown} seconds
              </p>
              <p className="text-[10px] text-muted-foreground/60">
                Universflow
              </p>
            </motion.div>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
});

export default PrerollAd;
