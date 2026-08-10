import React, { useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { X, Download, Trash2, ChevronDown, ChevronUp, ListMusic, Loader2, Check, Clock } from 'lucide-react';
import { useDownloads, QueuedSong } from '@/contexts/DownloadContext';
import { Button } from '@/components/ui/button';

const DownloadQueuePanel = () => {
  const {
    downloadQueue,
    downloadProgress,
    removeFromQueue,
    clearQueue,
    isProcessingQueue,
    downloads,
    cancelDownload,
    currentDownloadId,
  } = useDownloads();
  
  const [isExpanded, setIsExpanded] = useState(false);
  const [isVisible, setIsVisible] = useState(true);

  // Get currently downloading song
  const currentlyDownloading = Object.entries(downloadProgress).find(
    ([_, p]) => p.status === 'downloading' || p.status === 'pending'
  );

  const totalInQueue = downloadQueue.length + (currentlyDownloading ? 1 : 0);

  if (totalInQueue === 0 && !isProcessingQueue) return null;
  if (!isVisible) return null;

  const formatBytes = (bytes: number) => {
    if (bytes === 0) return '0 B';
    const k = 1024;
    const sizes = ['B', 'KB', 'MB', 'GB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(1)) + ' ' + sizes[i];
  };

  return (
    <motion.div
      initial={{ y: 100, opacity: 0 }}
      animate={{ y: 0, opacity: 1 }}
      exit={{ y: 100, opacity: 0 }}
      className="fixed bottom-24 left-4 right-4 z-50 max-w-md mx-auto"
    >
      <div className="ios-card border border-border/50 overflow-hidden">
        {/* Header - always visible */}
        <motion.div
          className="flex items-center justify-between p-4 cursor-pointer"
          onClick={() => setIsExpanded(!isExpanded)}
        >
          <div className="flex items-center gap-3">
            <div className="relative">
              <div className="w-10 h-10 rounded-full bg-gradient-to-br from-primary to-accent flex items-center justify-center">
                {isProcessingQueue ? (
                  <motion.div
                    animate={{ rotate: 360 }}
                    transition={{ duration: 1, repeat: Infinity, ease: "linear" }}
                  >
                    <Loader2 className="w-5 h-5 text-white" />
                  </motion.div>
                ) : (
                  <Download className="w-5 h-5 text-white" />
                )}
              </div>
              {totalInQueue > 0 && (
                <motion.div
                  initial={{ scale: 0 }}
                  animate={{ scale: 1 }}
                  className="absolute -top-1 -right-1 w-5 h-5 rounded-full bg-destructive flex items-center justify-center text-[10px] font-bold text-white"
                >
                  {totalInQueue}
                </motion.div>
              )}
            </div>
            <div>
              <p className="font-semibold text-foreground text-sm">Download Queue</p>
              <p className="text-xs text-muted-foreground" aria-live="polite" aria-atomic="true" role="status">
                {isProcessingQueue ? 'Downloading...' : `${totalInQueue} song${totalInQueue !== 1 ? 's' : ''} waiting`}
              </p>
            </div>

          </div>
          
          <div className="flex items-center gap-2">
            <Button
              variant="ghost"
              size="icon"
              aria-label="Hide download queue"
              className="h-8 w-8"
              onClick={(e) => {
                e.stopPropagation();
                setIsVisible(false);
              }}
            >
              <X className="w-4 h-4" />
            </Button>
            <motion.div
              animate={{ rotate: isExpanded ? 180 : 0 }}
              transition={{ duration: 0.2 }}
            >
              <ChevronUp className="w-5 h-5 text-muted-foreground" />
            </motion.div>
          </div>
        </motion.div>

        {/* Current download progress */}
        {currentlyDownloading && (
          <div className="px-4 pb-3">
            <div className="h-1.5 bg-muted rounded-full overflow-hidden">
              <motion.div
                className="h-full bg-gradient-to-r from-primary via-purple-500 to-accent"
                initial={{ width: 0 }}
                animate={{ width: `${currentlyDownloading[1].progress}%` }}
                transition={{ duration: 0.3 }}
              />
            </div>
            <p className="text-xs text-muted-foreground mt-1.5 text-center">
              {currentlyDownloading[1].progress}% complete
            </p>
          </div>
        )}

        {/* Expanded queue list */}
        <AnimatePresence>
          {isExpanded && (
            <motion.div
              initial={{ height: 0, opacity: 0 }}
              animate={{ height: 'auto', opacity: 1 }}
              exit={{ height: 0, opacity: 0 }}
              transition={{ duration: 0.2 }}
              className="overflow-hidden"
            >
              <div className="border-t border-border/50">
                {/* Queue items */}
                <div className="max-h-64 overflow-y-auto">
                  {downloadQueue.length === 0 && !currentlyDownloading ? (
                    <div className="p-6 text-center">
                      <ListMusic className="w-8 h-8 mx-auto text-muted-foreground/50 mb-2" />
                      <p className="text-sm text-muted-foreground">Queue is empty</p>
                    </div>
                  ) : (
                    <div className="divide-y divide-border/30">
                      {/* Currently downloading item */}
                      {currentlyDownloading && (
                        <QueueItem
                          song={(downloadQueue.find(q => q.id === currentlyDownloading[0])
                            || downloads.find(d => d.id === currentlyDownloading[0])
                            || (currentDownloadId === currentlyDownloading[0]
                              ? { id: currentlyDownloading[0], title: 'Downloading…', artist: '', cover_url: '', queuedAt: '', position: 0 }
                              : null)) as QueuedSong | null}
                          progress={currentlyDownloading[1].progress}
                          isDownloading={true}
                          onRemove={() => cancelDownload(currentlyDownloading[0])}
                        />
                      )}
                      
                      {/* Queued items */}
                      {downloadQueue.map((song, index) => (
                        <QueueItem
                          key={song.id}
                          song={song}
                          position={index + 1}
                          onRemove={() => removeFromQueue(song.id)}
                        />
                      ))}
                    </div>
                  )}
                </div>

                {/* Footer actions */}
                {downloadQueue.length > 0 && (
                  <div className="p-3 border-t border-border/50 flex justify-between items-center">
                    <p className="text-xs text-muted-foreground">
                      {downloadQueue.length} song{downloadQueue.length !== 1 ? 's' : ''} in queue
                    </p>
                    <Button
                      variant="ghost"
                      size="sm"
                      className="text-destructive hover:text-destructive h-8 text-xs"
                      onClick={clearQueue}
                    >
                      <Trash2 className="w-3.5 h-3.5 mr-1.5" />
                      Clear All
                    </Button>
                  </div>
                )}
              </div>
            </motion.div>
          )}
        </AnimatePresence>
      </div>
    </motion.div>
  );
};

interface QueueItemProps {
  song: QueuedSong | null;
  position?: number;
  progress?: number;
  isDownloading?: boolean;
  onRemove: () => void;
}

const QueueItem = ({ song, position, progress, isDownloading, onRemove }: QueueItemProps) => {
  if (!song) return null;
  
  return (
    <motion.div
      layout
      initial={{ opacity: 0, x: -20 }}
      animate={{ opacity: 1, x: 0 }}
      exit={{ opacity: 0, x: 20 }}
      className="flex items-center gap-3 p-3 hover:bg-muted/30 transition-colors"
    >
      {/* Position or status indicator */}
      <div className="w-8 h-8 rounded-lg flex items-center justify-center flex-shrink-0">
        {isDownloading ? (
          <motion.div
            animate={{ rotate: 360 }}
            transition={{ duration: 1, repeat: Infinity, ease: "linear" }}
            className="text-primary"
          >
            <Loader2 className="w-4 h-4" />
          </motion.div>
        ) : (
          <div className="w-full h-full rounded-lg bg-muted/50 flex items-center justify-center">
            <Clock className="w-4 h-4 text-muted-foreground" />
          </div>
        )}
      </div>

      {/* Song info */}
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2">
          {song.cover_url && (
            <img 
              src={song.cover_url} 
              alt={song.title}
              className="w-10 h-10 rounded-lg object-cover flex-shrink-0"
            />
          )}
          <div className="min-w-0">
            <p className="font-medium text-sm truncate text-foreground">
              {song.title}
            </p>
            <p className="text-xs text-muted-foreground truncate">
              {song.artist}
            </p>
          </div>
        </div>
        
        {/* Progress bar for downloading item */}
        {isDownloading && progress !== undefined && (
          <div className="mt-2">
            <div className="h-1 bg-muted rounded-full overflow-hidden">
              <motion.div
                className="h-full bg-primary"
                animate={{ width: `${progress}%` }}
                transition={{ duration: 0.3 }}
              />
            </div>
          </div>
        )}
      </div>

      {/* Cancel/remove button */}
      <Button
        variant="ghost"
        size="icon"
        className="h-8 w-8 flex-shrink-0 text-muted-foreground hover:text-destructive"
        onClick={(e) => {
          e.stopPropagation();
          onRemove();
        }}
        aria-label={isDownloading ? 'Cancel download' : 'Remove from queue'}
      >
        <X className="w-4 h-4" />
      </Button>
    </motion.div>
  );
};

export default DownloadQueuePanel;