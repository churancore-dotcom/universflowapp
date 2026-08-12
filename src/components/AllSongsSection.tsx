import React, { memo, useState, useCallback } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Play, Pause, LayoutGrid, List, Music2 } from 'lucide-react';
import { Song, usePlayer } from '@/contexts/PlayerContext';
import { useDownloads } from '@/contexts/DownloadContext';
import OptimizedImage from './OptimizedImage';
import LikeButton from './LikeButton';
import { triggerHaptic } from '@/hooks/useHaptics';

interface AllSongsSectionProps {
  songs: Song[];
}

// ── Premium list row ──
const SongRow = memo(({ song, index, songs }: { song: Song; index: number; songs: Song[] }) => {
  const { currentSong, isPlaying, playSong, togglePlay } = usePlayer();
  const { isDownloaded, getDownloadedUrl } = useDownloads();

  const isCurrentSong = currentSong?.id === song.id;
  const downloaded = isDownloaded(song.id);

  const handleClick = useCallback(() => {
    triggerHaptic('impactLight');
    if (isCurrentSong) {
      togglePlay();
    } else {
      const offlineUrl = getDownloadedUrl(song.id);
      playSong(song, offlineUrl, songs);
    }
  }, [isCurrentSong, togglePlay, getDownloadedUrl, song, playSong, songs]);

  const formatDuration = (seconds?: number) => {
    if (!seconds) return '--:--';
    const mins = Math.floor(seconds / 60);
    const secs = Math.floor(seconds % 60);
    return `${mins}:${secs.toString().padStart(2, '0')}`;
  };

  return (
    <div
      onClick={handleClick}
      className={`flex items-center gap-3.5 px-3 py-3 rounded-[28px] transition-all cursor-pointer neu-press ${
        isCurrentSong
          ? 'bg-primary/[0.08] ring-1 ring-primary/20'
          : ''
      }`}
    >
      {/* Rank / Playing indicator */}
      <div className="w-6 text-center flex-shrink-0">
        {isCurrentSong ? (
          <div className="flex items-center justify-center gap-[2.5px] h-5">
            {[0, 1, 2].map((i) => (
              <div
                key={i}
                className={`w-[3px] bg-primary rounded-full ${
                  isPlaying ? 'animate-audio-wave' : 'h-[5px]'
                }`}
                style={{ animationDelay: `${i * 0.12}s` }}
              />
            ))}
          </div>
        ) : (
          <span className="text-[12px] text-muted-foreground/30 font-bold tabular-nums">{index + 1}</span>
        )}
      </div>

      {/* Album art */}
      <div className="relative w-[52px] h-[52px] rounded-[14px] overflow-hidden flex-shrink-0"
        style={{
          boxShadow: isCurrentSong
            ? '0 4px 16px hsl(var(--primary) / 0.3)'
            : '0 2px 10px rgba(0,0,0,0.3)',
        }}
      >
        {song.cover_url ? (
          <OptimizedImage src={song.cover_url} alt={song.title} className="w-full h-full" />
        ) : (
          <div className="w-full h-full bg-gradient-to-br from-primary/20 to-accent/20 flex items-center justify-center">
            <Music2 className="w-5 h-5 text-foreground/25" />
          </div>
        )}
        {downloaded && (
          <div className="absolute bottom-0.5 right-0.5 w-4 h-4 rounded-full bg-green-500/90 flex items-center justify-center shadow">
            <svg className="w-2.5 h-2.5 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={3} d="M5 13l4 4L19 7" />
            </svg>
          </div>
        )}
      </div>

      {/* Song info */}
      <div className="flex-1 min-w-0">
        <p className={`font-semibold text-[14px] truncate leading-tight ${isCurrentSong ? 'text-primary' : 'text-foreground'}`}>
          {song.title}
        </p>
        <p className="text-[12px] text-muted-foreground/50 truncate mt-1">{song.artist}</p>
      </div>

      {/* Duration & Like */}
      <div className="flex items-center gap-2 flex-shrink-0">
        <span className="text-[11px] text-muted-foreground/30 w-10 text-right tabular-nums font-medium">
          {formatDuration(song.duration)}
        </span>
        <LikeButton songId={song.id} size="sm" className="w-9 h-9" />
      </div>
    </div>
  );
});

SongRow.displayName = 'SongRow';

// ── Premium grid card ──
const CompactGridCard = memo(({ song, index, songs }: { song: Song; index: number; songs: Song[] }) => {
  const { currentSong, isPlaying, playSong, togglePlay } = usePlayer();
  const { isDownloaded, getDownloadedUrl } = useDownloads();

  const isCurrentSong = currentSong?.id === song.id;
  const downloaded = isDownloaded(song.id);

  const handleClick = useCallback(() => {
    triggerHaptic('impactLight');
    if (isCurrentSong) {
      togglePlay();
    } else {
      const offlineUrl = getDownloadedUrl(song.id);
      playSong(song, offlineUrl, songs);
    }
  }, [isCurrentSong, togglePlay, getDownloadedUrl, song, playSong, songs]);

  return (
    <div
      onClick={handleClick}
      className="cursor-pointer active:scale-[0.94] transition-transform"
    >
      {/* Album art */}
      <div
        className={`relative aspect-square rounded-[28px] overflow-hidden mb-2 neu neu-press ${
          isCurrentSong ? 'ring-2 ring-primary/80' : ''
        }`}
      >
        {song.cover_url ? (
          <OptimizedImage src={song.cover_url} alt={song.title} className="w-full h-full" eager={index < 9} />
        ) : (
          <div className="w-full h-full bg-gradient-to-br from-primary/25 via-accent/15 to-muted flex items-center justify-center">
            <Music2 className="w-7 h-7 text-foreground/15" />
          </div>
        )}

        {/* Gradient overlay for depth */}
        <div className="absolute inset-x-0 bottom-0 h-1/2 bg-gradient-to-t from-black/50 to-transparent" />

        {/* Play overlay on active */}
        {isCurrentSong && (
          <div className="absolute inset-0 bg-black/30 flex items-center justify-center">
            <div className="w-9 h-9 rounded-full flex items-center justify-center bg-primary shadow-lg">
              {isPlaying ? (
                <div className="flex items-end gap-[2.5px] h-3.5">
                  {[0, 1, 2].map((i) => (
                    <div
                      key={i}
                      className="w-[2.5px] bg-primary-foreground rounded-full animate-audio-wave"
                      style={{ animationDelay: `${i * 0.12}s` }}
                    />
                  ))}
                </div>
              ) : (
                <Pause className="w-4 h-4 text-primary-foreground" />
              )}
            </div>
          </div>
        )}

        {/* Downloaded badge */}
        {downloaded && !isCurrentSong && (
          <div className="absolute bottom-1.5 right-1.5 w-4.5 h-4.5 rounded-full bg-green-500/90 flex items-center justify-center shadow-lg">
            <svg className="w-2.5 h-2.5 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={3} d="M5 13l4 4L19 7" />
            </svg>
          </div>
        )}
      </div>

      {/* Song info */}
      <p className={`font-bold text-[12px] truncate leading-tight ${isCurrentSong ? 'text-primary' : 'text-foreground'}`}>
        {song.title}
      </p>
      <p className="text-[10px] text-muted-foreground/40 truncate mt-0.5 font-medium">{song.artist}</p>
    </div>
  );
});

CompactGridCard.displayName = 'CompactGridCard';

// ── Main Section ──
const AllSongsSection = memo(({ songs }: AllSongsSectionProps) => {
  const [viewMode, setViewMode] = useState<'grid' | 'list'>('grid');
  const [showAll, setShowAll] = useState(false);

  const displayCount = viewMode === 'grid' ? 12 : 8;
  const displayedSongs = showAll ? songs : songs.slice(0, displayCount);

  const toggleViewMode = useCallback(() => {
    triggerHaptic('selection');
    setViewMode(prev => prev === 'grid' ? 'list' : 'grid');
  }, []);

  const toggleShowAll = useCallback(() => {
    triggerHaptic('selection');
    setShowAll(prev => !prev);
  }, []);

  return (
    <section>
      <div className="rounded-[28px] p-4 neu">
        {/* Header */}
        <div className="flex items-center justify-between mb-4">
          <div>
            <h2 className="font-display text-[28px] leading-none tracking-[0.04em] uppercase text-foreground">All Songs</h2>
            <p className="text-xs text-muted-foreground/70 mt-0.5 font-semibold">
              {songs.length} {songs.length === 1 ? 'track' : 'tracks'}
            </p>
          </div>
          <button
            onClick={toggleViewMode}
            className="w-9 h-9 rounded-xl flex items-center justify-center active:scale-90 transition-transform"
            style={{
              background: 'rgba(255,255,255,0.06)',
              border: '0.5px solid rgba(255,255,255,0.10)',
            }}
          >
            {viewMode === 'grid' ? (
              <List className="w-4 h-4 text-foreground/50" />
            ) : (
              <LayoutGrid className="w-4 h-4 text-foreground/50" />
            )}
          </button>
        </div>

        {/* Content */}
        <AnimatePresence mode="wait">
          {viewMode === 'grid' ? (
            <motion.div
              key="grid"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              transition={{ duration: 0.2 }}
              className="grid grid-cols-3 gap-3"
            >
              {displayedSongs.map((song, index) => (
                <CompactGridCard key={song.id} song={song} index={index} songs={songs} />
              ))}
            </motion.div>
          ) : (
            <motion.div
              key="list"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              transition={{ duration: 0.2 }}
              className="space-y-0.5"
            >
              {displayedSongs.map((song, index) => (
                <SongRow key={song.id} song={song} index={index} songs={songs} />
              ))}
            </motion.div>
          )}
        </AnimatePresence>

        {/* Show more */}
        {songs.length > displayCount && (
          <motion.button
            onClick={toggleShowAll}
            className="w-full mt-4 py-3 rounded-[28px] text-[13px] font-bold active:scale-[0.98] transition-transform neu-accent"
            whileTap={{ scale: 0.97 }}
          >
            {showAll ? 'Show Less' : 'Show All'}
          </motion.button>
        )}
      </div>
    </section>
  );
});

AllSongsSection.displayName = 'AllSongsSection';

export default AllSongsSection;