import { useState, memo, useCallback, useRef, useEffect, useMemo } from 'react';
import { motion, AnimatePresence, PanInfo } from 'framer-motion';
import { Play, Pause, SkipBack, SkipForward, Volume2, VolumeX, Shuffle, Repeat, Repeat1, ChevronDown, ListMusic, Share2, Sliders, ListOrdered, Mic2 } from 'lucide-react';
import SyncedLyricsView from './SyncedLyricsView';
import { usePlayer } from '@/contexts/PlayerContext';
import { usePlayerProgress } from '@/lib/playerProgressStore';
import { useNavigate } from '@/lib/router-compat';
import { Slider } from '@/components/ui/slider';
import LikeButton from './LikeButton';

import DownloadButton from './DownloadButton';
import SocialShareModal from './SocialShareModal';
import AddToPlaylistModal from './AddToPlaylistModal';
import CreatePlaylistModal from './CreatePlaylistModal';
import EqualizerModal from './EqualizerModal';
import PremiumLockOverlay from './PremiumLockOverlay';
import QueueDrawer from './QueueDrawer';
import FollowArtistButton from './FollowArtistButton';
import type { Song } from '@/contexts/PlayerContext';
import { fetchLyrics } from '@/lib/lyrics';
import { triggerHaptic } from '@/hooks/useHaptics';
import { canDownloadSong, canLikeSong, isIndexedSong } from '@/lib/songSupport';
import { usePremium } from '@/hooks/usePremium';
import { getEQPresetLabel, useEQSettings } from '@/lib/eqSettings';
import { toast } from 'sonner';

const formatTime = (seconds: number) => {
  if (!seconds || isNaN(seconds) || !isFinite(seconds)) return '0:00';
  const mins = Math.floor(seconds / 60);
  const secs = Math.floor(seconds % 60);
  return `${mins}:${secs.toString().padStart(2, '0')}`;
};

const songInfoVariants = {
  initial: { opacity: 0, y: 20 },
  animate: { opacity: 1, y: 0, transition: { duration: 0.3, ease: [0.25, 0.1, 0.25, 1] as const } },
  exit: { opacity: 0, y: -15, transition: { duration: 0.15 } },
};

const albumArtVariants = {
  initial: { opacity: 0, scale: 0.88, rotate: -2 },
  animate: { opacity: 1, scale: 1, rotate: 0, transition: { type: "spring" as const, stiffness: 300, damping: 25, mass: 0.8 } },
  exit: { opacity: 0, scale: 0.92, rotate: 2, transition: { duration: 0.25 } },
};

const VolumeSlider = memo(function VolumeSlider({
  value,
  onChange
}: {
  value: number;
  onChange: (value: number) => void;
}) {
  return (
    <div className="flex items-center gap-2 w-full px-1">
      <VolumeX className="w-4 h-4 text-muted-foreground/80 flex-shrink-0" />
      <Slider 
        value={[value * 100]} 
        max={100} 
        step={1} 
        onValueChange={([v]) => onChange(v / 100)} 
        className="flex-1 [&_[role=slider]]:w-4 [&_[role=slider]]:h-4 [&_[role=slider]]:bg-foreground [&_[role=slider]]:border-0 [&_[data-radix-slider-track]]:h-[3px] [&_[data-radix-slider-track]]:bg-foreground/20 [&_[data-radix-slider-range]]:bg-primary" 
      />
      <Volume2 className="w-4 h-4 text-muted-foreground/80 flex-shrink-0" />
    </div>
  );
});

const FullscreenPlayer = memo(function FullscreenPlayer() {
  const {
    currentSong,
    isPlaying,
    volume,
    shuffle,
    repeat,
    queue,
    isExpanded,
    playSong,
    togglePlay,
    nextSong,
    prevSong,
    seek,
    setVolume,
    toggleShuffle,
    toggleRepeat,
    setExpanded
  } = usePlayer();
  const { progress, duration } = usePlayerProgress();
  
  const [showShareModal, setShowShareModal] = useState(false);
  const [showPlaylistModal, setShowPlaylistModal] = useState(false);
  const [showCreatePlaylist, setShowCreatePlaylist] = useState(false);
  const [showEqualizer, setShowEqualizer] = useState(false);
  const [showEqPremium, setShowEqPremium] = useState(false);
  const [showQueue, setShowQueue] = useState(false);
  const [showLyrics, setShowLyrics] = useState(false);
  const [direction, setDirection] = useState(0);
  // Local seek-drag state — prevents the live `progress` updates from snapping
  // the slider thumb back while the user is dragging it.
  const [dragProgress, setDragProgress] = useState<number | null>(null);
  const { isPremium } = usePremium();
  const eqSettings = useEQSettings();
  const eqLabel = getEQPresetLabel(eqSettings);
  const prevSongIdRef = useRef<string | null>(null);
  const navigate = useNavigate();

  const handleOpenEqualizer = useCallback(() => {
    triggerHaptic('selection');
    // Studio EQ is a Premium feature.
    if (!isPremium) { setShowEqPremium(true); return; }
    setShowEqualizer(true);
  }, [isPremium]);

  const vibeSuggestions = useMemo(() => {
    if (!currentSong) return [];
    const seenVibes = new Set<string>();
    const currentMood = currentSong.mood?.toLowerCase().trim();
    const currentGenre = currentSong.genre?.toLowerCase().trim();
    const currentArtist = currentSong.artist.toLowerCase().trim();
    const currentAlbum = currentSong.album?.toLowerCase().trim();
    const currentTitleWords = currentSong.title.toLowerCase().replace(/[^a-z0-9]+/g, ' ').split(' ').filter((word) => word.length > 3);
    return queue
      .filter((song) => song.id !== currentSong.id && !song.id.startsWith('mock-'))
      .map((song) => {
        const songMood = song.mood?.toLowerCase().trim();
        const songGenre = song.genre?.toLowerCase().trim();
        const songArtist = song.artist.toLowerCase().trim();
        const songAlbum = song.album?.toLowerCase().trim();
        const titleHaystack = `${song.title} ${song.album || ''}`.toLowerCase().replace(/[^a-z0-9]+/g, ' ');
        const moodMatch = currentMood && songMood === currentMood ? 5 : 0;
        const genreMatch = currentGenre && songGenre === currentGenre ? 4 : 0;
        const artistMatch = currentArtist && songArtist === currentArtist ? 4 : 0;
        const albumMatch = currentAlbum && songAlbum === currentAlbum ? 3 : 0;
        const titleOverlap = currentTitleWords.filter((word) => titleHaystack.includes(word)).length;
        return { song, score: moodMatch + genreMatch + artistMatch + albumMatch + titleOverlap };
      })
      .filter((item) => item.score >= 4)
      .sort((a, b) => b.score - a.score)
      // Dedupe by track fingerprint — the queue can hold the same recording
      // several times (different ids/sources), which showed up as the same
      // chip repeated three times in a row.
      .filter((item, _i, _all) => {
        const fp = `${item.song.title} ${item.song.artist}`
          .toLowerCase()
          .replace(/\([^)]*\)|\[[^\]]*\]/g, ' ')
          .replace(/[^a-z0-9]+/g, ' ')
          .trim();
        if (seenVibes.has(fp)) return false;
        seenVibes.add(fp);
        return true;
      })
      .slice(0, 8)
      .map((item) => item.song);
  }, [currentSong, queue]);
  const suggestionsLabel = 'Same Vibe';


  useEffect(() => {
    if (currentSong?.id && currentSong.id !== prevSongIdRef.current) {
      prevSongIdRef.current = currentSong.id;
    }
  }, [currentSong?.id]);

  useEffect(() => {
    if (!currentSong) return;
    fetchLyrics(currentSong.artist, currentSong.title, currentSong.duration, currentSong.id);
    const currentIndex = queue.findIndex((song) => song.id === currentSong.id);
    const upcoming = currentIndex >= 0 ? queue.slice(currentIndex + 1, currentIndex + 3) : queue.slice(0, 2);
    upcoming.forEach((song) => fetchLyrics(song.artist, song.title, song.duration, song.id));
  }, [currentSong, queue]);

  const handleDragEnd = useCallback((_: MouseEvent | TouchEvent | PointerEvent, info: PanInfo) => {
    if (info.offset.y > 100) {
      setExpanded(false);
    }
  }, [setExpanded]);

  const handleNext = useCallback(() => {
    triggerHaptic('impactMedium');
    setDirection(1);
    nextSong();
  }, [nextSong]);

  const handlePrev = useCallback(() => {
    triggerHaptic('impactMedium');
    setDirection(-1);
    prevSong();
  }, [prevSong]);

  if (!currentSong || !isExpanded) return null;

  const liveProgress = isFinite(progress) ? progress : 0;
  const safeProgress = dragProgress !== null ? dragProgress : liveProgress;
  const safeDuration = isFinite(duration) && duration > 0 ? duration : Math.max(safeProgress + 1, 100);
  const timeRemaining = Math.max(0, safeDuration - safeProgress);
  const showLikeAction = canLikeSong(currentSong);
  const showDownloadAction = canDownloadSong(currentSong);
  const isPlaybackOnlyStream = isIndexedSong(currentSong);

  return (
    <>
      <AnimatePresence>
        <motion.div 
          className="fixed inset-0 z-50 bg-black flex flex-col" 
          initial={{ y: "100%" }} 
          animate={{ y: 0 }} 
          exit={{ y: "100%" }} 
          transition={{ type: "spring", stiffness: 400, damping: 30 }} 
          drag="y" 
          dragConstraints={{ top: 0, bottom: 0 }} 
          dragElastic={{ top: 0, bottom: 0.3 }} 
          onDragEnd={handleDragEnd}
        >
          {/* Blurred background */}
          <AnimatePresence mode="popLayout">
            <motion.div 
              key={currentSong.id + '-bg'}
              className="absolute inset-0 overflow-hidden"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              transition={{ duration: 0.6 }}
            >
              {currentSong.cover_url && (
                <img 
                  src={currentSong.cover_url} 
                  alt="" 
                  className="absolute inset-0 w-full h-full object-cover opacity-40"
                  style={{ filter: 'blur(60px) saturate(1.3)' }} 
                />
              )}
              <div className="absolute inset-0 bg-black/60" />
            </motion.div>
          </AnimatePresence>

          {/* Main content - uses flex to fill space like screenshot */}
          <div className="relative flex flex-col h-full px-5 pt-2 pb-3 overflow-hidden">
            {/* Drag indicator */}
            <div className="flex justify-center mb-1 flex-shrink-0">
              <div className="w-9 h-1 rounded-full bg-foreground/40" />
            </div>

            {/* Header */}
            <div className="flex items-center justify-between mb-2 flex-shrink-0">
              <button 
                className="w-10 h-10 flex items-center justify-center -ml-2 active:scale-90 transition-transform" 
                onClick={() => { triggerHaptic('impactLight'); setExpanded(false); }}
                aria-label="Close fullscreen player"
              >
                <ChevronDown className="w-6 h-6 text-foreground" />
              </button>
              
              <div className="text-center flex-1 px-2 min-w-0">
                <p className="text-[10px] font-medium uppercase tracking-wider text-muted-foreground">Now Playing · EQ {eqLabel.toUpperCase()}</p>
                <p className="text-xs font-semibold text-foreground truncate">{currentSong.album || 'Library'}</p>
              </div>
              
              <div className="flex items-center gap-1 -mr-2">
                <button
                  className={`w-10 h-10 flex items-center justify-center active:scale-90 transition-transform rounded-full ${showLyrics ? 'bg-primary/20 text-primary' : 'text-foreground'}`}
                  onClick={() => { triggerHaptic('impactLight'); setShowLyrics((v) => !v); }}
                  aria-label={showLyrics ? 'Hide lyrics' : 'Show lyrics'}
                >
                  <Mic2 className="w-5 h-5" />
                </button>
                <button
                  className="w-10 h-10 flex items-center justify-center active:scale-90 transition-transform"
                  onClick={() => { triggerHaptic('impactLight'); setShowQueue(true); }}
                  aria-label="Open queue"
                >
                  <ListOrdered className="w-5 h-5 text-foreground" />
                </button>
              </div>
            </div>

            {/* Album Art OR Lyrics — flex-1 to fill available space */}
            <div className="flex-1 flex items-center justify-center min-h-0 w-full overflow-hidden">
              {showLyrics ? (
                <div className="w-full h-full max-w-[420px]">
                  <SyncedLyricsView
                    songId={currentSong.id}
                    artist={currentSong.artist}
                    title={currentSong.title}
                    duration={currentSong.duration}
                    bare={false}
                  />
                </div>
              ) : (
              <div
                className="relative"
                style={{
                  width: 'min(84vw, 100%, calc(100dvh - 370px), 380px)',
                  height: 'min(84vw, 100%, calc(100dvh - 370px), 380px)',
                  aspectRatio: '1 / 1',
                }}
              >
                {isPlaying && (
                  <motion.div
                    className="absolute inset-[-15%] rounded-3xl pointer-events-none"
                    style={{
                      background: 'radial-gradient(circle, hsl(var(--primary) / 0.25) 0%, transparent 60%)',
                      filter: 'blur(30px)',
                    }}
                    animate={{ opacity: [0.6, 1, 0.6] }}
                    transition={{ duration: 3, repeat: Infinity, ease: "easeInOut" }}
                  />
                )}
                
                <motion.div
                  layoutId="uf-player-art"
                  className="absolute inset-0 rounded-2xl overflow-hidden shadow-2xl z-10 bg-muted"
                  transition={{ type: 'spring', stiffness: 380, damping: 34 }}
                  style={{
                    boxShadow: isPlaying
                      ? '0 0 40px 10px hsl(var(--primary) / 0.2)'
                      : '0 15px 30px -10px rgba(0, 0, 0, 0.5)',
                  }}
                >
                  <AnimatePresence mode="popLayout" initial={false}>
                    <motion.div
                      key={currentSong.id}
                      className="absolute inset-0"
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
                          draggable={false}
                        />
                      ) : (
                        <div className="w-full h-full bg-gradient-to-br from-primary to-primary/80 flex items-center justify-center">
                          <div className="text-muted-foreground text-5xl">♪</div>
                        </div>
                      )}
                    </motion.div>
                  </AnimatePresence>
                </motion.div>
              </div>
              )}
            </div>

            {/* Controls Section - fixed at bottom */}
            <div className="flex-shrink-0 space-y-2 mt-2">
              {/* Title and Artist */}
              <div className="relative overflow-hidden flex items-start justify-between gap-3 rounded-[28px] px-4 py-3.5 uf-rose-gradient">
                {currentSong.cover_url && (
                  <img
                    src={currentSong.cover_url}
                    alt=""
                    aria-hidden
                    className="absolute inset-y-0 right-0 h-full w-2/3 object-cover pointer-events-none"
                    style={{ filter: 'blur(18px) saturate(140%)', opacity: 0.42, WebkitMaskImage: 'linear-gradient(to left, #000 30%, transparent 100%)', maskImage: 'linear-gradient(to left, #000 30%, transparent 100%)' }}
                  />
                )}
                <AnimatePresence mode="popLayout" initial={false}>
                  <motion.div 
                    key={currentSong.id + '-info'}
                    className="relative z-10 flex-1 min-w-0"
                    variants={songInfoVariants}
                    initial="initial"
                    animate="animate"
                    exit="exit"
                  >
                    <h2
                      className="text-[24px] font-display tracking-wide text-primary-foreground leading-none"
                      style={{
                        display: '-webkit-box',
                        WebkitLineClamp: 2,
                        WebkitBoxOrient: 'vertical',
                        overflow: 'hidden',
                      }}
                    >
                      {currentSong.title}
                    </h2>
                    <button 
                      className="text-sm text-primary-foreground/80 font-bold block active:opacity-70 mt-1 text-left" 
                      style={{
                        display: '-webkit-box',
                        WebkitLineClamp: 2,
                        WebkitBoxOrient: 'vertical',
                        overflow: 'hidden',
                      }}
                      onClick={() => {
                        if (currentSong.artist_id) {
                          triggerHaptic('selection');
                          setExpanded(false);
                          navigate(`/artist/${currentSong.artist_id}`);
                        }
                      }}
                    >
                      {currentSong.artist}
                    </button>
                  </motion.div>
                </AnimatePresence>
                <div className="relative z-10 flex items-center gap-1 flex-shrink-0">
                  <FollowArtistButton
                    artistName={currentSong.artist}
                    artistImage={currentSong.artist_photo_url}
                    source={currentSong.artist_id ? 'catalog' : 'lastfm'}
                    size="sm"
                  />
                  <LikeButton songId={currentSong.id} song={currentSong} size="sm" />
                  <DownloadButton song={currentSong} size="sm" />
                </div>
              </div>

              {/* Progress bar */}
              <div className="py-0.5">
                <Slider 
                  value={[safeProgress]} 
                  max={safeDuration} 
                  step={0.1} 
                  onValueChange={([value]) => setDragProgress(value)}
                  onValueCommit={([value]) => { seek(value); setDragProgress(null); }}
                  className="[&_[role=slider]]:w-[18px] [&_[role=slider]]:h-[18px] [&_[role=slider]]:bg-foreground [&_[role=slider]]:border-0 [&_[data-radix-slider-track]]:h-[5px] [&_[data-radix-slider-track]]:bg-foreground/15 [&_[data-radix-slider-range]]:bg-primary" 
                />
                <div className="flex justify-between mt-1.5 text-[11px] font-semibold text-muted-foreground tabular-nums">
                  <span>{formatTime(safeProgress)}</span>
                  <span>-{formatTime(Math.max(0, timeRemaining))}</span>
                </div>
              </div>

              {/* Main Controls */}
              <div className="flex items-center justify-center gap-5">
                <motion.button 
                  className={`w-11 h-11 flex items-center justify-center rounded-full transition-colors ${shuffle ? 'text-primary bg-primary/15' : 'text-muted-foreground'}`} 
                  onClick={() => { triggerHaptic('impactLight'); toggleShuffle(); }}
                  whileTap={{ scale: 0.85 }}
                  aria-label={shuffle ? 'Disable shuffle' : 'Enable shuffle'}
                  aria-pressed={shuffle}
                >
                  <Shuffle className="w-[18px] h-[18px]" />
                </motion.button>

                <motion.button 
                  className="w-14 h-14 flex items-center justify-center" 
                  onClick={handlePrev}
                  whileTap={{ scale: 0.8, x: -4 }}
                  aria-label="Previous track"
                >
                  <SkipBack className="w-9 h-9 text-foreground" fill="currentColor" />
                </motion.button>
                
                <motion.button 
                  className="w-[74px] h-[74px] rounded-full bg-foreground flex items-center justify-center shadow-xl"
                  onClick={() => { triggerHaptic('impactHeavy'); togglePlay(); }}
                  whileTap={{ scale: 0.9 }}
                  aria-label={isPlaying ? 'Pause' : 'Play'}
                >
                  <AnimatePresence mode="wait" initial={false}>
                    <motion.div
                      key={isPlaying ? 'pause' : 'play'}
                      initial={{ scale: 0.5, opacity: 0, rotate: -90 }}
                      animate={{ scale: 1, opacity: 1, rotate: 0 }}
                      exit={{ scale: 0.5, opacity: 0, rotate: 90 }}
                      transition={{ duration: 0.15 }}
                    >
                      {isPlaying ? (
                        <Pause className="w-9 h-9 text-primary-foreground" fill="currentColor" />
                      ) : (
                        <Play className="w-9 h-9 text-primary-foreground ml-1" fill="currentColor" />
                      )}
                    </motion.div>
                  </AnimatePresence>
                </motion.button>
                
                <motion.button 
                  className="w-14 h-14 flex items-center justify-center" 
                  onClick={handleNext}
                  whileTap={{ scale: 0.8, x: 4 }}
                  aria-label="Next track"
                >
                  <SkipForward className="w-9 h-9 text-foreground" fill="currentColor" />
                </motion.button>

                <motion.button 
                  className={`w-11 h-11 flex items-center justify-center rounded-full transition-colors ${repeat !== 'off' ? 'text-primary bg-primary/15' : 'text-muted-foreground'}`} 
                  onClick={() => { triggerHaptic('impactLight'); toggleRepeat(); }}
                  whileTap={{ scale: 0.85 }}
                  aria-label={`Repeat mode: ${repeat}`}
                >
                  {repeat === 'one' ? <Repeat1 className="w-[18px] h-[18px]" /> : <Repeat className="w-[18px] h-[18px]" />}
                </motion.button>
              </div>

              {/* Volume slider */}
              <VolumeSlider value={volume} onChange={setVolume} />

              {vibeSuggestions.length > 0 && (
                <div className="flex items-center gap-2 -mx-1 px-1 overflow-x-auto hide-scrollbar">
                  <span className="flex-shrink-0 text-[9px] font-bold uppercase tracking-[0.18em] text-muted-foreground/80 pr-1">{suggestionsLabel}</span>
                  {vibeSuggestions.map((song) => (
                    <button
                      key={song.id}
                      type="button"
                      onClick={() => { triggerHaptic('selection'); playSong(song, undefined, queue); }}
                      className="group flex items-center gap-2 flex-shrink-0 rounded-full bg-foreground/5 hover:bg-foreground/10 pl-1 pr-3 py-1 active:scale-[0.96] transition-all max-w-[180px]"
                      aria-label={`Play ${song.title}`}
                    >
                      <div className="h-7 w-7 flex-shrink-0 overflow-hidden rounded-full bg-foreground/10">
                        {song.cover_url ? (
                          <img src={song.cover_url} alt="" className="h-full w-full object-cover" loading="lazy" />
                        ) : (
                          <div className="flex h-full w-full items-center justify-center text-[10px] text-muted-foreground/70">♪</div>
                        )}
                      </div>
                      <span className="truncate text-[11px] font-medium text-foreground">{song.title}</span>
                    </button>
                  ))}
                </div>
              )}


              {/* "From Your Artists" rail removed — only Same Vibes is shown in the player. */}

              {/* Bottom actions */}
              <div className="flex items-center justify-around">
                <button 
                  className="w-11 h-11 flex items-center justify-center active:scale-90 transition-transform" 
                  onClick={() => { triggerHaptic('selection'); setShowShareModal(true); }}
                >
                  <Share2 className="w-[18px] h-[18px] text-muted-foreground" />
                </button>
                <button 
                  className="w-11 h-11 flex items-center justify-center active:scale-90 transition-transform" 
                  onClick={handleOpenEqualizer}
                  aria-label="Equalizer"
                >
                  <Sliders className="w-[18px] h-[18px] text-muted-foreground" />
                </button>
                <button 
                  className="w-11 h-11 flex items-center justify-center active:scale-90 transition-transform" 
                  onClick={() => { triggerHaptic('selection'); setShowPlaylistModal(true); }}
                >
                  <ListMusic className="w-[18px] h-[18px] text-muted-foreground" />
                </button>
              </div>

            </div>
          </div>
        </motion.div>
      </AnimatePresence>

      {showShareModal && <SocialShareModal isOpen={showShareModal} onClose={() => setShowShareModal(false)} song={currentSong} />}
      {showPlaylistModal && <AddToPlaylistModal isOpen={showPlaylistModal} onClose={() => setShowPlaylistModal(false)} song={currentSong} onCreateNew={() => { setShowPlaylistModal(false); setShowCreatePlaylist(true); }} />}
      {showCreatePlaylist && <CreatePlaylistModal isOpen={showCreatePlaylist} onClose={() => setShowCreatePlaylist(false)} initialSong={currentSong} onCreated={() => setShowCreatePlaylist(false)} />}
      {showEqualizer && <EqualizerModal isOpen={showEqualizer} onClose={() => setShowEqualizer(false)} />}
      {showEqPremium && (
        <PremiumLockOverlay
          title="Studio Equalizer"
          description="Unlock live EQ and vocal or instrumental control on every song, including background playback on Android."
          onClose={() => setShowEqPremium(false)}
        />
      )}
      <QueueDrawer isOpen={showQueue} onClose={() => setShowQueue(false)} />
    </>
  );
});

export default FullscreenPlayer;
