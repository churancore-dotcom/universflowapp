import React, { memo, useCallback, useState } from 'react';
import { motion, AnimatePresence, Reorder, useMotionValue, useTransform, useDragControls, PanInfo } from 'framer-motion';
import { X, GripVertical, Play, Pause, Trash2 } from 'lucide-react';
import { Song, usePlayer } from '@/contexts/PlayerContext';
import SongArtwork from './SongArtwork';
import { iosSpring } from '@/lib/animations';
import { triggerHaptic } from '@/hooks/useHaptics';

interface QueueDrawerProps {
  isOpen: boolean;
  onClose: () => void;
}

interface QueueItemProps {
  song: Song;
  index: number;
  isActive: boolean;
  isPlaying: boolean;
  onPlay: () => void;
  onRemove: () => void;
}

const SWIPE_DELETE_THRESHOLD = 100;

const QueueItem = memo(({ song, index, isActive, isPlaying, onPlay, onRemove }: QueueItemProps) => {
  const [isRemoving, setIsRemoving] = useState(false);
  const x = useMotionValue(0);
  const deleteOpacity = useTransform(x, [-SWIPE_DELETE_THRESHOLD, -40], [1, 0]);
  const deleteScale = useTransform(x, [-SWIPE_DELETE_THRESHOLD, -40], [1, 0.6]);
  const dragControls = useDragControls();

  const handleDragEnd = useCallback((event: MouseEvent | TouchEvent | PointerEvent, info: PanInfo) => {
    if (info.offset.x < -SWIPE_DELETE_THRESHOLD) {
      triggerHaptic('impactMedium');
      setIsRemoving(true);
      setTimeout(() => {
        onRemove();
      }, 200);
    }
  }, [onRemove]);

  if (isRemoving) {
    return (
      <motion.div
        initial={{ opacity: 1, height: 'auto' }}
        animate={{ opacity: 0, height: 0, marginBottom: 0 }}
        transition={{ duration: 0.2 }}
      />
    );
  }

  return (
    <Reorder.Item
      value={song}
      id={song.id}
      className="relative overflow-hidden rounded-2xl"
      dragListener={false}
      dragControls={dragControls}
    >
      {/* Delete action background */}
      <motion.div 
        className="absolute inset-0 bg-destructive flex items-center justify-end pr-6 rounded-2xl"
        style={{ opacity: deleteOpacity }}
      >
        <motion.div style={{ scale: deleteScale }}>
          <Trash2 className="w-6 h-6 text-white" />
        </motion.div>
      </motion.div>

      {/* Swipeable content */}
      <motion.div
        className={`relative flex items-center gap-3 p-3 rounded-2xl transition-colors ${
          isActive ? 'bg-primary/10' : 'bg-white/5'
        }`}
        style={{ x }}
        drag="x"
        dragConstraints={{ left: 0, right: 0 }}
        dragElastic={{ left: 0.4, right: 0 }}
        dragDirectionLock
        onDragEnd={handleDragEnd}
      >
        {/* Drag handle — long-press or hold to reorder vertically */}
        <div
          className="p-1 -ml-1 touch-none cursor-grab active:cursor-grabbing"
          onPointerDown={(e) => { triggerHaptic('selection'); dragControls.start(e); }}
          aria-label="Reorder"
        >
          <GripVertical className="w-5 h-5 text-muted-foreground/60 flex-shrink-0" />
        </div>
        
        <span className="w-6 text-center text-sm text-muted-foreground flex-shrink-0">
          {index + 1}
        </span>

        <motion.button
          className="relative w-11 h-11 rounded-xl overflow-hidden flex-shrink-0"
          onClick={onPlay}
          whileTap={{ scale: 0.9 }}
        >
          {/* Full artwork ladder (provider → YouTube hq/mq/default → note tile)
              so a mix track without cover_url still shows real art. */}
          <SongArtwork song={song} size={44} className="w-full h-full" />

          <div className="absolute inset-0 flex items-center justify-center bg-black/30">
            {isActive && isPlaying ? (
              <Pause className="w-4 h-4 text-white" fill="white" />
            ) : (
              <Play className="w-4 h-4 text-white ml-0.5" fill="white" />
            )}
          </div>
        </motion.button>


        <div className="flex-1 min-w-0">
          <p className={`font-medium text-sm truncate ${isActive ? 'text-primary' : ''}`}>
            {song.title}
          </p>
          <p className="text-xs text-muted-foreground truncate">{song.artist}</p>
        </div>

        <motion.button
          className="p-2 rounded-full hover:bg-destructive/20 text-muted-foreground hover:text-destructive transition-colors"
          onClick={onRemove}
          whileTap={{ scale: 0.85 }}
        >
          <Trash2 className="w-4 h-4" />
        </motion.button>
      </motion.div>
    </Reorder.Item>
  );
});

QueueItem.displayName = 'QueueItem';

const QueueDrawer = memo(({ isOpen, onClose }: QueueDrawerProps) => {
  const { queue, setQueue, currentSong, isPlaying, playSong, togglePlay } = usePlayer();

  const handlePlay = useCallback((song: Song) => {
    if (currentSong?.id === song.id) {
      togglePlay();
    } else {
      playSong(song);
    }
  }, [currentSong, togglePlay, playSong]);

  const handleRemove = useCallback((songId: string) => {
    setQueue(queue.filter(s => s.id !== songId));
  }, [queue, setQueue]);

  const handleReorder = useCallback((newOrder: Song[]) => {
    setQueue(newOrder);
  }, [setQueue]);

  const handleClearQueue = useCallback(() => {
    setQueue([]);
    onClose();
  }, [setQueue, onClose]);

  if (!isOpen) return null;

  return (
    <AnimatePresence>
      <motion.div
        className="fixed inset-0 z-[60] flex items-end justify-center bg-black/60 backdrop-blur-sm"
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0 }}
        onClick={onClose}
      >
        <motion.div
          className="w-full max-w-md h-[70vh] rounded-t-3xl flex flex-col overflow-hidden"
          style={{
            background: 'linear-gradient(180deg, rgba(38, 38, 40, 0.98), rgba(28, 28, 30, 0.98))',
            backdropFilter: 'blur(40px)',
          }}
          initial={{ y: '100%' }}
          animate={{ y: 0 }}
          exit={{ y: '100%' }}
          transition={iosSpring}
          onClick={(e) => e.stopPropagation()}
        >
          {/* Handle */}
          <div className="flex-shrink-0 pt-3 pb-4">
            <div className="w-9 h-1 rounded-full bg-white/30 mx-auto" />
          </div>

          {/* Header */}
          <div className="flex-shrink-0 flex items-center justify-between px-6 pb-4">
            <h2 className="text-xl font-bold">Up Next</h2>
            <div className="flex items-center gap-2">
              {queue.length > 0 && (
                <motion.button
                  className="px-3 py-1.5 rounded-full bg-destructive/20 text-destructive text-sm font-medium"
                  onClick={handleClearQueue}
                  whileTap={{ scale: 0.95 }}
                >
                  Clear All
                </motion.button>
              )}
              <motion.button
                className="p-2 rounded-full bg-white/10"
                onClick={onClose}
                whileTap={{ scale: 0.9 }}
              >
                <X className="w-5 h-5" />
              </motion.button>
            </div>
          </div>

          {/* Queue List */}
          <div className="flex-1 overflow-y-auto px-4 pb-10">
            {queue.length === 0 ? (
              <div className="flex flex-col items-center justify-center h-full text-center">
                <div className="w-16 h-16 rounded-full bg-white/5 flex items-center justify-center mb-4">
                  <Play className="w-8 h-8 text-muted-foreground" />
                </div>
                <p className="text-muted-foreground">Queue is empty</p>
                <p className="text-sm text-muted-foreground/60 mt-1">
                  Add songs to start playing
                </p>
              </div>
            ) : (
              <Reorder.Group
                axis="y"
                values={queue}
                onReorder={handleReorder}
                className="space-y-2"
              >
                {queue.map((song, index) => (
                  <QueueItem
                    key={song.id}
                    song={song}
                    index={index}
                    isActive={currentSong?.id === song.id}
                    isPlaying={currentSong?.id === song.id && isPlaying}
                    onPlay={() => handlePlay(song)}
                    onRemove={() => handleRemove(song.id)}
                  />
                ))}
              </Reorder.Group>
            )}
          </div>
        </motion.div>
      </motion.div>
    </AnimatePresence>
  );
});

QueueDrawer.displayName = 'QueueDrawer';

export default QueueDrawer;
