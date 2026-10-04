import { useState, useRef, useCallback } from 'react';
import { useMotionValue, animate, type MotionValue } from 'framer-motion';

interface UsePullToRefreshOptions {
  onRefresh: () => Promise<void>;
  threshold?: number;
  maxPull?: number;
}

/**
 * Pull distance lives in a MotionValue so finger movement never re-renders
 * the page; React state only changes when the trigger threshold is crossed
 * or a refresh starts/ends.
 */
export const usePullToRefresh = ({
  onRefresh,
  threshold = 80,
  maxPull = 120,
}: UsePullToRefreshOptions) => {
  const pullDistance: MotionValue<number> = useMotionValue(0);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [isTriggered, setIsTriggered] = useState(false);
  const startY = useRef(0);
  const isPulling = useRef(false);
  const refreshingRef = useRef(false);
  const triggeredRef = useRef(false);

  const setTriggered = (v: boolean) => {
    if (triggeredRef.current !== v) { triggeredRef.current = v; setIsTriggered(v); }
  };

  const handleTouchStart = useCallback((e: React.TouchEvent) => {
    if (refreshingRef.current) return;
    const target = e.currentTarget as HTMLElement;
    if ((target?.scrollTop ?? 0) <= 0) {
      startY.current = e.touches[0].clientY;
      isPulling.current = true;
    } else {
      isPulling.current = false;
    }
  }, []);

  const handleTouchMove = useCallback((e: React.TouchEvent) => {
    if (!isPulling.current || refreshingRef.current) return;
    const target = e.currentTarget as HTMLElement;
    const diff = e.touches[0].clientY - startY.current;
    if ((target?.scrollTop ?? 0) > 0 || diff <= 0) {
      if (pullDistance.get() !== 0) pullDistance.set(0);
      setTriggered(false);
      return;
    }
    // Rubber-band resistance that eases toward maxPull.
    // Trigger (~76px) is reached at ~120px of finger travel.
    const distance = maxPull * (1 - Math.exp(-diff / maxPull));
    pullDistance.set(distance);
    setTriggered(distance >= threshold * 0.95);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [maxPull, threshold, pullDistance]);

  const handleTouchEnd = useCallback(async () => {
    if (!isPulling.current) return;
    isPulling.current = false;
    if (triggeredRef.current && !refreshingRef.current) {
      refreshingRef.current = true;
      setIsRefreshing(true);
      animate(pullDistance, threshold * 0.7, { type: 'spring', stiffness: 400, damping: 35 });
      try {
        await onRefresh();
      } finally {
        refreshingRef.current = false;
        setIsRefreshing(false);
        setTriggered(false);
        animate(pullDistance, 0, { type: 'spring', stiffness: 400, damping: 38 });
      }
    } else {
      setTriggered(false);
      animate(pullDistance, 0, { type: 'spring', stiffness: 500, damping: 40 });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [threshold, onRefresh, pullDistance]);

  return {
    pullDistance,
    threshold,
    isRefreshing,
    isTriggered,
    handlers: {
      onTouchStart: handleTouchStart,
      onTouchMove: handleTouchMove,
      onTouchEnd: handleTouchEnd,
      onTouchCancel: handleTouchEnd,
    },
  };
};
