import { motion, useTransform, type MotionValue } from 'framer-motion';
import { RefreshCw } from 'lucide-react';

interface PullToRefreshIndicatorProps {
  pullDistance: MotionValue<number>;
  threshold: number;
  isRefreshing: boolean;
  isTriggered: boolean;
}

/** GPU-only indicator: driven by a MotionValue, no per-frame React renders. */
const PullToRefreshIndicator = ({
  pullDistance,
  threshold,
  isRefreshing,
  isTriggered,
}: PullToRefreshIndicatorProps) => {
  const y = useTransform(pullDistance, (d) => d - 40);
  const opacity = useTransform(pullDistance, [threshold * 0.15, threshold * 0.45], [0, 1]);
  const scale = useTransform(pullDistance, [0, threshold], [0.8, 1], { clamp: true });
  const rotate = useTransform(pullDistance, [0, threshold], [0, 180]);

  return (
    <motion.div
      className="absolute left-0 right-0 flex justify-center pointer-events-none z-40 will-change-transform"
      style={{ top: 60, y, opacity }}
    >
      <motion.div
        className="w-10 h-10 rounded-full flex items-center justify-center bg-card border border-border shadow-lg"
        style={{ scale }}
      >
        <motion.div style={isRefreshing ? undefined : { rotate }}
          animate={isRefreshing ? { rotate: 360 } : undefined}
          transition={isRefreshing ? { duration: 0.8, repeat: Infinity, ease: 'linear' } : undefined}
        >
          <RefreshCw
            className={`w-5 h-5 transition-colors ${isTriggered || isRefreshing ? 'text-primary' : 'text-muted-foreground'}`}
          />
        </motion.div>
      </motion.div>
    </motion.div>
  );
};

export default PullToRefreshIndicator;
