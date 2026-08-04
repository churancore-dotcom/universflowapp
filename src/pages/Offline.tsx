import { memo, useEffect, useState } from 'react';
import { motion } from 'framer-motion';
import { Play, Music, HardDrive, ArrowLeft, Shuffle } from 'lucide-react';
import { usePlayer, type Song } from '@/contexts/PlayerContext';
import { useDownloads } from '@/contexts/DownloadContext';
import { useNavigate } from '@/lib/router-compat';
import BottomNav from '@/components/BottomNav';
import RoseHero from '@/components/RoseHero';
import { triggerHaptic } from '@/hooks/useHaptics';
import { iosSpring, staggerContainer, staggerItem } from '@/lib/animations';
import SEOHead from '@/components/SEOHead';


interface CachedSong {
  id: string;
  title: string;
  artist: string;
  cover_url?: string;
  audio_url: string;
}

const Offline = memo(function Offline() {
  const { playSong, currentSong, isPlaying, setQueue } = usePlayer();
  const { downloads } = useDownloads();
  const navigate = useNavigate();
  const [cachedSongs, setCachedSongs] = useState<CachedSong[]>([]);
  const [storageUsed, setStorageUsed] = useState<string>('0 MB');
  const [isOnline, setIsOnline] = useState(navigator.onLine);

  useEffect(() => {
    // Load downloaded songs from context
    if (downloads && downloads.length > 0) {
      setCachedSongs(downloads.map(d => ({
        id: d.id,
        title: d.title,
        artist: d.artist,
        cover_url: d.cover_url || undefined,
        audio_url: d.blobUrl || d.audio_url,
      })));
    }

    // Calculate storage usage
    if ('storage' in navigator && 'estimate' in navigator.storage) {
      navigator.storage.estimate().then((estimate) => {
        const usedMB = ((estimate.usage || 0) / (1024 * 1024)).toFixed(1);
        setStorageUsed(`${usedMB} MB`);
      });
    }

    // Listen for online/offline status
    const handleOnline = () => setIsOnline(true);
    const handleOffline = () => setIsOnline(false);
    
    window.addEventListener('online', handleOnline);
    window.addEventListener('offline', handleOffline);
    
    return () => {
      window.removeEventListener('online', handleOnline);
      window.removeEventListener('offline', handleOffline);
    };
  }, [downloads]);

  const handlePlayAll = () => {
    if (cachedSongs.length > 0) {
      triggerHaptic('impactMedium');
      const firstSong = cachedSongs[0];
      // Create queue with offline-ready songs - ensure all have their local blob URLs
      const offlineQueue = cachedSongs.map(s => ({
        id: s.id,
        title: s.title,
        artist: s.artist,
        cover_url: s.cover_url,
        audio_url: s.audio_url, // This is the blobUrl from downloads
      }));
      setQueue(offlineQueue as Song[]);
      // Pass the blob URL explicitly for offline playback
      playSong(firstSong as Song, firstSong.audio_url, offlineQueue as Song[]);
    }
  };

  const handleShufflePlay = () => {
    if (cachedSongs.length > 0) {
      triggerHaptic('impactMedium');
      const shuffled = [...cachedSongs].sort(() => Math.random() - 0.5);
      const offlineQueue = shuffled.map(s => ({
        id: s.id,
        title: s.title,
        artist: s.artist,
        cover_url: s.cover_url,
        audio_url: s.audio_url, // Local blob URL
      }));
      setQueue(offlineQueue as Song[]);
      playSong(shuffled[0] as Song, shuffled[0].audio_url, offlineQueue as Song[]);
    }
  };

  const handlePlaySong = (song: CachedSong) => {
    triggerHaptic('impactLight');
    // Create queue with all cached songs using their local URLs
    const offlineQueue = cachedSongs.map(s => ({
      id: s.id,
      title: s.title,
      artist: s.artist,
      cover_url: s.cover_url,
      audio_url: s.audio_url, // Local blob URL
    }));
    // Pass the blob URL and offline queue
    playSong(song as Song, song.audio_url, offlineQueue as Song[]);
  };

  return (
    <>
    <SEOHead
      title="Offline Library — Univers Flow"
      description="Play your downloaded songs without internet. Your offline Univers Flow library, ready when you are."
      keywords="offline player, downloaded songs, Univers Flow offline library"
    />
    <div className="ethereal-page min-h-screen flex flex-col pb-40 overflow-y-auto overflow-x-hidden" style={{ WebkitOverflowScrolling: 'touch' }}>
      {/* Header — rose-ember hero to match the rest of the app */}
      <header className="sticky top-0 z-40 px-3 pt-3 pb-3 bg-background/80 backdrop-blur-xl safe-area-pt">
        <div className="flex items-start gap-2">
          {isOnline && (
            <button
              onClick={() => navigate(-1)}
              aria-label="Go back"
              className="mt-2 w-9 h-9 rounded-full bg-white/[0.06] border border-white/[0.06] flex items-center justify-center active:scale-95 transition-transform"
            >
              <ArrowLeft className="w-4 h-4" />
            </button>
          )}
          <div className="flex-1 min-w-0">
            <RoseHero
              eyebrow={isOnline ? 'Downloaded' : 'Offline mode'}
              title="YOUR LIBRARY"
              subtitle={`${cachedSongs.length} songs · ${storageUsed} used`}
              compact
            />
          </div>
        </div>
      </header>


      {/* Content */}
      <div className="flex-1 px-4">
        {cachedSongs.length === 0 ? (
          <motion.div 
            className="flex flex-col items-center justify-center py-20 text-center"
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={iosSpring}
          >
            <div className="w-20 h-20 rounded-full bg-muted flex items-center justify-center mb-4">
              <HardDrive className="w-10 h-10 text-muted-foreground" />
            </div>
            <h2 className="text-lg font-semibold text-foreground mb-2">No Downloaded Songs</h2>
            <p className="text-sm text-muted-foreground max-w-[260px]">
              Download songs while online to listen offline. Tap the download icon on any song.
            </p>
          </motion.div>
        ) : (
          <>
            {/* Play All Buttons */}
            <div className="flex gap-3 mb-4">
              <motion.button
                className="flex-1 py-4 rounded-2xl bg-primary text-primary-foreground font-semibold text-base flex items-center justify-center gap-2"
                onClick={handlePlayAll}
                whileTap={{ scale: 0.97 }}
                transition={iosSpring}
              >
                <Play className="w-5 h-5" fill="currentColor" />
                Play All
              </motion.button>
              <motion.button
                className="py-4 px-6 rounded-2xl bg-muted text-foreground font-semibold text-base flex items-center justify-center gap-2"
                onClick={handleShufflePlay}
                whileTap={{ scale: 0.97 }}
                transition={iosSpring}
              >
                <Shuffle className="w-5 h-5" />
              </motion.button>
            </div>

            {/* Song List */}
            <motion.div
              className="space-y-2"
              variants={staggerContainer}
              initial="initial"
              animate="animate"
            >
              {cachedSongs.map((song, index) => (
                <motion.button
                  key={song.id}
                  className={`w-full flex items-center gap-3 p-3 rounded-2xl transition-colors ${
                    currentSong?.id === song.id 
                      ? 'bg-primary/15' 
                      : 'bg-card active:bg-card/80'
                  }`}
                  onClick={() => handlePlaySong(song)}
                  variants={staggerItem}
                  whileTap={{ scale: 0.98 }}
                >
                  {/* Cover */}
                  <div className="w-14 h-14 rounded-xl overflow-hidden bg-muted flex-shrink-0">
                    {song.cover_url ? (
                      <img 
                        src={song.cover_url} 
                        alt={song.title}
                        className="w-full h-full object-cover"
                      />
                    ) : (
                      <div className="w-full h-full flex items-center justify-center">
                        <Music className="w-6 h-6 text-muted-foreground" />
                      </div>
                    )}
                  </div>

                  {/* Info */}
                  <div className="flex-1 min-w-0 text-left">
                    <h3 className={`font-semibold text-base truncate ${
                      currentSong?.id === song.id ? 'text-primary' : 'text-foreground'
                    }`}>
                      {song.title}
                    </h3>
                    <p className="text-sm text-muted-foreground truncate">
                      {song.artist}
                    </p>
                  </div>

                  {/* Playing Indicator */}
                  {currentSong?.id === song.id && isPlaying && (
                    <div className="flex gap-0.5 items-end h-4">
                      {[1, 2, 3].map((i) => (
                        <div
                          key={i}
                          className="w-1 bg-primary rounded-full animate-equalizer"
                          style={{
                            height: '100%',
                            animationDelay: `${i * 0.15}s`,
                          }}
                        />
                      ))}
                    </div>
                  )}
                </motion.button>
              ))}
            </motion.div>
          </>
        )}
      </div>

      {/* Bottom Navigation */}
      <BottomNav />
    </div>
    </>
  );
});

export default Offline;
