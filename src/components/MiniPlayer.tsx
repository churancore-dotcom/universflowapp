import { memo, useCallback, useState, useEffect, useRef } from 'react';
import { motion, AnimatePresence, PanInfo } from 'framer-motion';
// NOTE: This component is now mounted ONCE at App level via GlobalPlayerLayer
// to prevent flicker on route changes. Do not re-mount it inside individual pages.
import { Play, Pause, SkipForward, SkipBack, X } from 'lucide-react';
import { usePlayer } from '@/contexts/PlayerContext';
import { usePlayerProgress } from '@/lib/playerProgressStore';
import { triggerHaptic } from '@/hooks/useHaptics';
import { isLockscreenOpen, subscribeLockscreen } from '@/lib/lockscreenState';
import { getEQPresetLabel, useEQSettings } from '@/lib/eqSettings';

// Swipe thresholds
const SWIPE_UP_THRESHOLD = -50;
const SWIPE_HORIZONTAL_THRESHOLD = 80;

// Song info crossfade animation
const songInfoVariants = {
  initial: { opacity: 0, x: 20 },
  animate: { opacity: 1, x: 0, transition: { duration: 0.25, ease: [0.25, 0.1, 0.25, 1] as const } },
  exit: { opacity: 0, x: -20, transition: { duration: 0.12 } },
};

const albumArtVariants = {
  initial: { opacity: 0, scale: 0.8, rotate: -5 },
  animate: { opacity: 1, scale: 1, rotate: 0, transition: { type: "spring" as const, stiffness: 400, damping: 25 } },
  exit: { opacity: 0, scale: 0.8, rotate: 5, transition: { duration: 0.15 } },
};

const MiniPlayer = memo(function MiniPlayer() {
  const {
    currentSong,
    isPlaying,
    isExpanded,
    togglePlay,
    nextSong,
    prevSong,
    stopSong,
    setExpanded
  } = usePlayer();
  const { progress, duration } = usePlayerProgress();
  const eqSettings = useEQSettings();
  const eqLabel = getEQPresetLabel(eqSettings);

  const [dragX, setDragX] = useState(0);
  const [isDragging, setIsDragging] = useState(false);
  const [isNavVisible, setIsNavVisible] = useState(true);
  const [lockscreenVisible, setLockscreenVisible] = useState(isLockscreenOpen());
  const lastScrollY = useRef(0);

  // Hide whenever the in-app lockscreen overlay is showing
  useEffect(() => subscribeLockscreen(setLockscreenVisible), []);

  // Sync visibility with bottom nav scroll behavior
  useEffect(() => {
    const handleScroll = () => {
      const currentScrollY = window.scrollY;
      const scrollDelta = currentScrollY - lastScrollY.current;
      
      if (Math.abs(scrollDelta) > 10) {
        if (scrollDelta > 0 && currentScrollY > 100) {
          setIsNavVisible(false);
        } else {
          setIsNavVisible(true);
        }
        lastScrollY.current = currentScrollY;
      }
    };

    window.addEventListener('scroll', handleScroll, { passive: true });
    return () => window.removeEventListener('scroll', handleScroll);
  }, []);

  const handleTogglePlay = useCallback((e: React.MouseEvent) => {
    e.stopPropagation();
    triggerHaptic('impactMedium');
    togglePlay();
  }, [togglePlay]);

  const handleNextSong = useCallback((e?: React.MouseEvent) => {
    e?.stopPropagation();
    triggerHaptic('impactLight');
    nextSong();
  }, [nextSong]);

  const handlePrevSong = useCallback(() => {
    triggerHaptic('impactLight');
    prevSong();
  }, [prevSong]);

  const handleStopSong = useCallback((e: React.MouseEvent) => {
    e.stopPropagation();
    triggerHaptic('impactLight');
    stopSong();
  }, [stopSong]);

  const handleExpand = useCallback(() => {
    if (!isDragging) {
      triggerHaptic('impactLight');
      setExpanded(true);
    }
  }, [setExpanded, isDragging]);

  const handleDragStart = useCallback(() => {
    setIsDragging(true);
  }, []);

  const handleDrag = useCallback((_: MouseEvent | TouchEvent | PointerEvent, info: PanInfo) => {
    setDragX(info.offset.x);
  }, []);

  const handleDragEnd = useCallback((_: MouseEvent | TouchEvent | PointerEvent, info: PanInfo) => {
    const { offset, velocity } = info;
    
    if (offset.y < SWIPE_UP_THRESHOLD || velocity.y < -300) {
      triggerHaptic('impactMedium');
      setExpanded(true);
    } else if (offset.x < -SWIPE_HORIZONTAL_THRESHOLD || velocity.x < -500) {
      handleNextSong();
    } else if (offset.x > SWIPE_HORIZONTAL_THRESHOLD || velocity.x > 500) {
      handlePrevSong();
    }

    setDragX(0);
    setTimeout(() => setIsDragging(false), 100);
  }, [setExpanded, handleNextSong, handlePrevSong]);

  if (!currentSong || lockscreenVisible || isExpanded) return null;

  const progressPercent = duration > 0 && isFinite(progress) && isFinite(duration) 
    ? Math.min(100, Math.max(0, (progress / duration) * 100)) 
    : 0;

  const isSwipingLeft = dragX < -30;
  const isSwipingRight = dragX > 30;
  const swipeOpacity = Math.min(Math.abs(dragX) / 150, 0.5);

  return (
    <motion.div
      className="fixed left-0 right-0 w-full z-40 px-2"
      style={{ bottom: 'calc(56px + env(safe-area-inset-bottom, 0px))' }}
        initial={{ y: 60, opacity: 0, scale: 0.95, filter: 'blur(10px)' }}
        animate={{ 
          y: isNavVisible ? 0 : 100, 
          opacity: isNavVisible ? 1 : 0, 
          scale: 1, 
          filter: 'blur(0px)' 
        }}
        exit={{ y: 60, opacity: 0, scale: 0.98, filter: 'blur(5px)' }}
        transition={{ 
          type: "spring", 
          stiffness: 300, 
          damping: 25,
          opacity: { duration: 0.3 },
          filter: { duration: 0.25 }
        }}
      >
        <motion.div
          layoutId="uf-player-surface"
          className="liquid-glass liquid-glass-interactive rounded-3xl overflow-hidden relative touch-manipulation"
          style={{ ['--lg-blur' as string]: '40px' }}
          transition={{ type: 'spring', stiffness: 380, damping: 34 }}
          drag
          dragDirectionLock
          dragConstraints={{ left: 0, right: 0, top: 0, bottom: 0 }}
          dragElastic={{ left: 0.3, right: 0.3, top: 0.2, bottom: 0 }}
          onDragStart={handleDragStart}
          onDrag={handleDrag}
          onDragEnd={handleDragEnd}
          onClick={handleExpand}
          whileTap={{ scale: isDragging ? 1 : 0.99 }}
        >
          {currentSong.cover_url && (
            <img
              src={currentSong.cover_url}
              alt=""
              aria-hidden
              className="absolute inset-y-0 right-0 h-full w-2/3 object-cover pointer-events-none"
              style={{
                filter: 'blur(16px) saturate(140%)',
                opacity: 0.42,
                WebkitMaskImage: 'linear-gradient(to left, #000 22%, transparent 100%)',
                maskImage: 'linear-gradient(to left, #000 22%, transparent 100%)',
              }}
            />
          )}
          {/* Swipe hints */}
          {isSwipingLeft && (
            <div 
              className="absolute inset-y-0 right-2 flex items-center z-20 pointer-events-none"
              style={{ opacity: swipeOpacity }}
            >
              <div className="bg-primary/80 rounded-full px-3 py-1.5 text-xs font-semibold text-white">
                Next →
              </div>
            </div>
          )}
          {isSwipingRight && (
            <div 
              className="absolute inset-y-0 left-2 flex items-center z-20 pointer-events-none"
              style={{ opacity: swipeOpacity }}
            >
              <div className="bg-primary/80 rounded-full px-3 py-1.5 text-xs font-semibold text-white">
                ← Prev
              </div>
            </div>
          )}

          {/* Progress bar - smooth transition */}
          <div className="absolute top-0 left-0 right-0 h-[2px] bg-white/10 overflow-hidden rounded-t-xl z-10">
            <motion.div
              className="h-full bg-white/90"
              style={{ width: `${progressPercent}%` }}
              transition={{ duration: 0.3, ease: "linear" }}
            />
          </div>

          <div className="relative z-10 flex items-center gap-3 p-2">
            {/* Album Art with shared-layout morph to fullscreen */}
            <motion.div
              layoutId="uf-player-art"
              className="relative w-12 h-12 flex-shrink-0 rounded-xl overflow-hidden shadow-lg bg-muted"
              transition={{ type: 'spring', stiffness: 380, damping: 34 }}
            >
              <AnimatePresence mode="popLayout" initial={false}>
                <motion.div
                  key={currentSong.id}
                  className="absolute inset-0 w-full h-full"
                  variants={albumArtVariants}
                  initial="initial"
                  animate="animate"
                  exit="exit"
                >
                  {currentSong.cover_url ? (
                    <img
                      src={currentSong.cover_url}
                      alt={currentSong.title}
                      className="w-full h-full object-cover"
                      loading="lazy"
                      draggable={false}
                    />
                  ) : (
                    <div className="w-full h-full bg-gradient-to-br from-rose-500 to-pink-600 flex items-center justify-center">
                      <span className="text-white text-lg">♪</span>
                    </div>
                  )}
                </motion.div>
              </AnimatePresence>
            </motion.div>
            
            {/* Song info with crossfade */}
            <div className="flex-1 min-w-0 pr-0 relative min-h-[2.5rem] flex flex-col justify-center">
              <AnimatePresence mode="popLayout" initial={false}>
                <motion.div
                  key={currentSong.id + '-mini-info'}
                  variants={songInfoVariants}
                  initial="initial"
                  animate="animate"
                  exit="exit"
                  className="absolute inset-0 flex flex-col justify-center"
                >
                    <p
                    className="font-bold text-[14px] text-foreground leading-tight pr-1"
                    style={{
                      display: '-webkit-box',
                      WebkitLineClamp: 2,
                      WebkitBoxOrient: 'vertical',
                      overflow: 'hidden',
                    }}
                  >
                    {currentSong.title}
                  </p>
                  <p className="text-[12px] text-muted-foreground truncate mt-0.5 pr-1">
                    {currentSong.artist} · EQ {eqLabel.toUpperCase()}
                  </p>
                </motion.div>
              </AnimatePresence>
            </div>

            {/* Controls with play/pause animation */}
            <div className="flex items-center gap-0">
              <motion.button
                className="w-10 h-10 min-w-[40px] rounded-full flex items-center justify-center"
                onClick={(e) => { e.stopPropagation(); handlePrevSong(); }}
                aria-label="Previous song"
                whileTap={{ scale: 0.85, x: -3 }}
                transition={{ type: "spring", stiffness: 500, damping: 20 }}
              >
                <SkipBack className="w-5 h-5 text-foreground" fill="currentColor" />
              </motion.button>
              <motion.button
                className="w-12 h-12 min-w-[48px] rounded-full flex items-center justify-center"
                onClick={handleTogglePlay}
                aria-label={isPlaying ? 'Pause' : 'Play'}
                whileTap={{ scale: 0.85 }}
                transition={{ type: "spring", stiffness: 500, damping: 20 }}
              >
                <AnimatePresence mode="wait" initial={false}>
                  <motion.div
                    key={isPlaying ? 'pause' : 'play'}
                    initial={{ scale: 0.5, opacity: 0 }}
                    animate={{ scale: 1, opacity: 1 }}
                    exit={{ scale: 0.5, opacity: 0 }}
                    transition={{ duration: 0.1 }}
                  >
                    {isPlaying ? (
                      <Pause className="w-6 h-6 text-foreground" fill="currentColor" />
                    ) : (
                      <Play className="w-6 h-6 text-foreground ml-0.5" fill="currentColor" />
                    )}
                  </motion.div>
                </AnimatePresence>
              </motion.button>
              
              <motion.button
                className="w-12 h-12 min-w-[48px] rounded-full flex items-center justify-center"
                onClick={handleNextSong}
                aria-label="Next song"
                whileTap={{ scale: 0.85, x: 3 }}
                transition={{ type: "spring", stiffness: 500, damping: 20 }}
              >
                <SkipForward className="w-5 h-5 text-foreground" fill="currentColor" />
              </motion.button>

              <motion.button
                className="w-10 h-10 min-w-[40px] rounded-full flex items-center justify-center"
                onClick={handleStopSong}
                aria-label="Close player"
                whileTap={{ scale: 0.85 }}
                transition={{ type: "spring", stiffness: 500, damping: 20 }}
              >
                <X className="w-5 h-5 text-muted-foreground" />
              </motion.button>
            </div>
          </div>
        </motion.div>
    </motion.div>
  );
});

export default MiniPlayer;
