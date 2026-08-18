import { memo, useCallback, useEffect, useMemo, useState } from 'react';
import { motion } from 'framer-motion';
import { Play, Pause, ListPlus } from 'lucide-react';
import { usePlayer, Song } from '@/contexts/PlayerContext';
import { useDownloads } from '@/contexts/DownloadContext';
import { useNavigate } from '@/lib/router-compat';
import LikeButton from './LikeButton';

import AddToPlaylistModal from './AddToPlaylistModal';
import CreatePlaylistModal from './CreatePlaylistModal';
import OptimizedImage from './OptimizedImage';
import { triggerHaptic } from '@/hooks/useHaptics';
import { prewarmSong, prewarmIntentProps } from '@/lib/instantPlay';

interface SongCardProps {
  song: Song;
  index?: number;
  sectionSongs?: Song[];
}

const SongCard = memo(({ song, index = 0, sectionSongs }: SongCardProps) => {
  const { currentSong, isPlaying, playSong, togglePlay } = usePlayer();
  const { isDownloaded, getDownloadedUrl } = useDownloads();
  const navigate = useNavigate();

  const [showAddToPlaylist, setShowAddToPlaylist] = useState(false);
  const [showCreatePlaylist, setShowCreatePlaylist] = useState(false);

  const isCurrentSong = useMemo(() => currentSong?.id === song.id, [currentSong?.id, song.id]);
  const downloaded = useMemo(() => isDownloaded(song.id), [isDownloaded, song.id]);

  const handleArtistClick = useCallback((e: React.MouseEvent) => {
    e.stopPropagation();
    if (song.artist_id) {
      triggerHaptic('selection');
      navigate(`/artist/${song.artist_id}`);
    }
  }, [song.artist_id, navigate]);

  // Echo-Music instant play: warm the stream for the first visible cards, and
  // for this card the instant a finger lands on it (before `click` fires).
  useEffect(() => {
    if (index < 2) prewarmSong(song);
  }, [index, song]);

  const handleClick = useCallback(() => {
    triggerHaptic('impactLight');
    if (isCurrentSong) {
      togglePlay();
    } else {
      const offlineUrl = getDownloadedUrl(song.id);
      playSong(song, offlineUrl, sectionSongs);
    }
  }, [isCurrentSong, togglePlay, getDownloadedUrl, song, playSong, sectionSongs]);

  const handleAddToPlaylist = useCallback((e: React.MouseEvent) => {
    e.stopPropagation();
    triggerHaptic('selection');
    setShowAddToPlaylist(true);
  }, []);

  return (
    <div
      className="group relative flex-shrink-0 w-[170px] snap-start"
      style={{ animationDelay: `${index * 50}ms` }}
    >
      {/* Album Art Container */}
      <motion.div
        className="relative aspect-square rounded-3xl overflow-hidden cursor-pointer"
        onClick={handleClick}
        {...prewarmIntentProps(song)}
        whileTap={{ scale: 0.95 }}
        transition={{ type: "spring", stiffness: 400, damping: 25 }}
        style={{
          boxShadow: isCurrentSong
            ? '0 8px 30px -4px hsl(var(--primary) / 0.4), 0 2px 8px rgba(0,0,0,0.3)'
            : '0 4px 20px -4px rgba(0, 0, 0, 0.5), 0 1px 4px rgba(0,0,0,0.2)',
        }}
      >
        {/* Cover Image */}
        {song.cover_url ? (
          <OptimizedImage
            src={song.cover_url}
            alt={song.title}
            className="w-full h-full"
            eager={index < 4}
          />
        ) : (
          <div className="w-full h-full bg-gradient-to-br from-primary/30 via-accent/20 to-muted flex items-center justify-center">
            <div className="w-full h-full bg-gradient-to-br from-primary/20 via-accent/10 to-transparent" />
          </div>
        )}

        {/* Cinematic bottom gradient */}
        <div className="absolute inset-x-0 bottom-0 h-2/3 bg-gradient-to-t from-black/70 via-black/30 to-transparent" />

        {/* Play/Pause overlay on active song */}
        {isCurrentSong && (
          <motion.div
            className="absolute inset-0 flex items-center justify-center"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            style={{
              background: 'linear-gradient(135deg, rgba(0,0,0,0.3), rgba(0,0,0,0.5))',
            }}
          >
            <div
              className="w-12 h-12 rounded-full flex items-center justify-center"
              style={{
                background: 'hsl(var(--primary))',
                boxShadow: '0 4px 24px hsl(var(--primary) / 0.6)',
              }}
            >
              {isPlaying ? (
                <div className="flex items-end gap-[3px] h-4">
                  {[0, 1, 2].map((i) => (
                    <div
                      key={i}
                      className="w-[3px] bg-primary-foreground rounded-full animate-audio-wave"
                      style={{ animationDelay: `${i * 0.12}s` }}
                    />
                  ))}
                </div>
              ) : (
                <Pause className="w-5 h-5 text-primary-foreground" />
              )}
            </div>
          </motion.div>
        )}

        {/* Quick actions — top right */}
        <div className="absolute top-2 right-2 z-20 flex items-center gap-1">
          <LikeButton
            songId={song.id}
            size="sm"
            className="w-8 h-8 rounded-full bg-black/50 backdrop-blur-md"
          />
          <button
            onClick={handleAddToPlaylist}
            className="w-8 h-8 rounded-full bg-black/50 backdrop-blur-md flex items-center justify-center text-foreground/80 active:bg-black/70 transition-colors"
          >
            <ListPlus className="w-3.5 h-3.5" />
          </button>
        </div>

        {/* Downloaded indicator */}
        {downloaded && (
          <div className="absolute top-2 left-2 z-10">
            <div className="w-5 h-5 rounded-full bg-green-500/90 backdrop-blur-sm flex items-center justify-center shadow-lg">
              <svg className="w-3 h-3 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={3} d="M5 13l4 4L19 7" />
              </svg>
            </div>
          </div>
        )}

        {/* Bottom overlay song info on artwork */}
        <div className="absolute bottom-0 inset-x-0 p-2.5 z-10">
          <p className={`font-bold text-[13px] truncate leading-tight drop-shadow-lg ${isCurrentSong ? 'text-primary' : 'text-white'}`}>
            {song.title}
          </p>
          <p className="text-[11px] text-white/60 truncate mt-0.5 drop-shadow-md">
            {song.artist}
          </p>
        </div>
      </motion.div>

      {/* Modals */}
      {showAddToPlaylist && (
        <AddToPlaylistModal
          isOpen={showAddToPlaylist}
          onClose={() => setShowAddToPlaylist(false)}
          song={song}
          onCreateNew={() => {
            setShowAddToPlaylist(false);
            setShowCreatePlaylist(true);
          }}
        />
      )}
      {showCreatePlaylist && (
        <CreatePlaylistModal
          isOpen={showCreatePlaylist}
          onClose={() => setShowCreatePlaylist(false)}
            initialSong={song}
          onCreated={() => {
            setShowCreatePlaylist(false);
          }}
        />
      )}
    </div>
  );
});

SongCard.displayName = 'SongCard';

export default SongCard;