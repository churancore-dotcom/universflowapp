import { memo, useEffect, useMemo, useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import {
  WifiOff, Play, Pause, Music, Shuffle, Download, LogIn,
  Search, Sparkles, Clock, ListMusic, ChevronRight, Radio,
} from 'lucide-react';
import { usePlayer, type Song } from '@/contexts/PlayerContext';
import { useDownloads } from '@/contexts/DownloadContext';
import { useNavigate } from 'react-router-dom';
import { toast } from 'sonner';
import MiniPlayer from '@/components/MiniPlayer';
import FullscreenPlayer from '@/components/FullscreenPlayer';
import { triggerHaptic } from '@/hooks/useHaptics';
import { iosSpring, staggerContainer, staggerItem } from '@/lib/animations';
import appLogo from '@/assets/app-logo.webp';

type Tab = 'all' | 'artists' | 'recent';

const OfflinePlayerShell = memo(function OfflinePlayerShell() {
  const { playSong, currentSong, isPlaying, setQueue, togglePlay } = usePlayer();
  const { downloads } = useDownloads();
  const navigate = useNavigate();
  const [storageUsed, setStorageUsed] = useState('0 MB');
  const [quota, setQuota] = useState(0);
  const [used, setUsed] = useState(0);
  const [query, setQuery] = useState('');
  const [tab, setTab] = useState<Tab>('all');

  const cachedSongs = useMemo(
    () =>
      downloads.map((d) => ({
        id: d.id,
        title: d.title,
        artist: d.artist,
        cover_url: d.cover_url || undefined,
        audio_url: d.blobUrl || d.audio_url,
      })),
    [downloads],
  );

  useEffect(() => {
    if ('storage' in navigator && 'estimate' in navigator.storage) {
      navigator.storage.estimate().then((est) => {
        const u = est.usage || 0;
        const q = est.quota || 0;
        setUsed(u);
        setQuota(q);
        setStorageUsed(`${(u / (1024 * 1024)).toFixed(1)} MB`);
      });
    }
  }, [downloads.length]);

  // Group by artist
  const artistGroups = useMemo(() => {
    const map = new Map<string, typeof cachedSongs>();
    cachedSongs.forEach((s) => {
      const key = s.artist || 'Unknown';
      if (!map.has(key)) map.set(key, []);
      map.get(key)!.push(s);
    });
    return Array.from(map.entries()).sort((a, b) => b[1].length - a[1].length);
  }, [cachedSongs]);

  const filtered = useMemo(() => {
    if (!query.trim()) return cachedSongs;
    const q = query.toLowerCase();
    return cachedSongs.filter(
      (s) => s.title.toLowerCase().includes(q) || s.artist.toLowerCase().includes(q),
    );
  }, [cachedSongs, query]);

  const recent = useMemo(() => cachedSongs.slice(-12).reverse(), [cachedSongs]);

  const handlePlayAll = (list = cachedSongs) => {
    if (!list.length) return;
    triggerHaptic('impactMedium');
    setQueue(list as Song[]);
    playSong(list[0] as Song, list[0].audio_url, list as Song[]);
  };

  const handleShuffle = () => {
    if (!cachedSongs.length) return;
    triggerHaptic('impactMedium');
    const shuffled = [...cachedSongs].sort(() => Math.random() - 0.5);
    setQueue(shuffled as Song[]);
    playSong(shuffled[0] as Song, shuffled[0].audio_url, shuffled as Song[]);
  };

  const handlePlaySong = (song: typeof cachedSongs[0]) => {
    triggerHaptic('impactLight');
    playSong(song as Song, song.audio_url, cachedSongs as Song[]);
  };

  const handleSignIn = () => {
    if (!navigator.onLine) {
      toast.error('You’re offline. Reconnect to sign in.');
      return;
    }
    navigate('/auth');
  };

  const quotaPct = quota ? Math.min(100, (used / quota) * 100) : 0;
  const totalMinutes = Math.round(cachedSongs.length * 3.2); // rough estimate

  return (
    <div
      className="min-h-screen bg-background flex flex-col pb-40 overflow-y-auto overflow-x-hidden"
      style={{ WebkitOverflowScrolling: 'touch' }}
    >
      {/* Ambient gradient */}
      <div className="pointer-events-none fixed inset-0 -z-10">
        <div className="absolute -top-40 -left-20 w-[420px] h-[420px] rounded-full bg-primary/20 blur-[120px]" />
        <div className="absolute top-40 -right-20 w-[360px] h-[360px] rounded-full bg-rose-500/10 blur-[120px]" />
      </div>

      {/* Header */}
      <header className="sticky top-0 z-40 px-4 pt-4 pb-3 bg-background/70 backdrop-blur-2xl border-b border-white/[0.04] safe-area-pt">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-2xl overflow-hidden border border-white/10 shadow-lg">
            <img src={appLogo} alt="Univers Flow" className="w-full h-full object-cover" />
          </div>
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-1.5">
              <span className="w-1.5 h-1.5 rounded-full bg-destructive animate-pulse" />
              <p className="text-[10px] font-semibold tracking-[0.18em] uppercase text-destructive">
                Offline
              </p>
            </div>
            <h1 className="text-[17px] font-bold text-foreground leading-tight">Your Vault</h1>
          </div>
          <button
            onClick={handleSignIn}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-full bg-white/[0.06] border border-white/[0.08] active:scale-95 transition-transform"
          >
            <LogIn className="w-3.5 h-3.5" />
            <span className="text-[11px] font-medium">Sign In</span>
          </button>
        </div>
      </header>

      {cachedSongs.length === 0 ? (
        <EmptyState />
      ) : (
        <div className="px-4 mt-4 space-y-5">
          {/* Editorial hero */}
          <motion.section
            initial={{ opacity: 0, y: 12 }}
            animate={{ opacity: 1, y: 0 }}
            transition={iosSpring}
            className="relative overflow-hidden rounded-3xl border border-white/[0.06] bg-gradient-to-br from-primary/25 via-background to-background p-5"
          >
            <div className="flex items-start justify-between gap-3">
              <div>
                <div className="flex items-center gap-1.5 mb-2">
                  <Sparkles className="w-3.5 h-3.5 text-primary" />
                  <span className="text-[10px] tracking-[0.2em] uppercase text-primary font-semibold">
                    Saved for you
                  </span>
                </div>
                <h2 className="text-2xl font-black leading-[1.05] text-foreground">
                  {cachedSongs.length} tracks,
                  <br />
                  zero internet.
                </h2>
                <p className="text-xs text-muted-foreground mt-2">
                  ~{totalMinutes} min · {storageUsed}
                </p>
              </div>
              <CoverStack songs={cachedSongs.slice(0, 4)} />
            </div>

            <div className="flex gap-2 mt-5">
              <motion.button
                whileTap={{ scale: 0.96 }}
                onClick={() => handlePlayAll()}
                className="flex-1 h-12 rounded-2xl bg-primary text-primary-foreground font-semibold text-sm flex items-center justify-center gap-2 shadow-lg shadow-primary/30"
              >
                <Play className="w-4 h-4" fill="currentColor" />
                Play all
              </motion.button>
              <motion.button
                whileTap={{ scale: 0.96 }}
                onClick={handleShuffle}
                className="h-12 px-5 rounded-2xl bg-white/[0.06] border border-white/[0.08] text-foreground font-semibold text-sm flex items-center justify-center gap-2"
              >
                <Shuffle className="w-4 h-4" />
                Shuffle
              </motion.button>
            </div>
          </motion.section>

          {/* Storage card */}
          <section className="rounded-2xl border border-white/[0.06] bg-white/[0.02] p-4">
            <div className="flex items-center justify-between mb-2">
              <p className="text-[11px] uppercase tracking-wider text-muted-foreground font-semibold">
                Device storage
              </p>
              <p className="text-[11px] text-muted-foreground">
                {storageUsed} of {(quota / (1024 * 1024 * 1024)).toFixed(1)} GB
              </p>
            </div>
            <div className="h-1.5 w-full rounded-full bg-white/[0.06] overflow-hidden">
              <motion.div
                initial={{ width: 0 }}
                animate={{ width: `${quotaPct}%` }}
                transition={{ duration: 0.8, ease: 'easeOut' }}
                className="h-full bg-gradient-to-r from-primary to-rose-400"
              />
            </div>
          </section>

          {/* Search */}
          <div className="relative">
            <Search className="absolute left-4 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
            <input
              type="text"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search your vault"
              className="w-full h-11 pl-11 pr-4 rounded-2xl bg-white/[0.04] border border-white/[0.06] text-sm placeholder:text-muted-foreground focus:outline-none focus:border-primary/40 transition-colors"
            />
          </div>

          {/* Tabs */}
          <div className="flex gap-1.5 p-1 rounded-2xl bg-white/[0.04] border border-white/[0.04]">
            {([
              { id: 'all', label: 'All', icon: ListMusic },
              { id: 'artists', label: 'Artists', icon: Radio },
              { id: 'recent', label: 'Recent', icon: Clock },
            ] as const).map(({ id, label, icon: Icon }) => (
              <button
                key={id}
                onClick={() => {
                  triggerHaptic('selection');
                  setTab(id);
                }}
                className={`relative flex-1 h-9 rounded-xl text-xs font-semibold flex items-center justify-center gap-1.5 transition-colors ${
                  tab === id ? 'text-primary-foreground' : 'text-muted-foreground'
                }`}
              >
                {tab === id && (
                  <motion.div
                    layoutId="offlineTab"
                    className="absolute inset-0 rounded-xl bg-primary"
                    transition={iosSpring}
                  />
                )}
                <Icon className="w-3.5 h-3.5 relative z-10" />
                <span className="relative z-10">{label}</span>
              </button>
            ))}
          </div>

          {/* Content */}
          <AnimatePresence mode="wait">
            <motion.div
              key={tab + query}
              initial={{ opacity: 0, y: 6 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0 }}
              transition={{ duration: 0.18 }}
            >
              {tab === 'all' && (
                <SongList
                  songs={filtered}
                  currentId={currentSong?.id}
                  isPlaying={isPlaying}
                  onPlay={handlePlaySong}
                  onToggle={togglePlay}
                />
              )}

              {tab === 'artists' && (
                <motion.div
                  className="space-y-3"
                  variants={staggerContainer}
                  initial="initial"
                  animate="animate"
                >
                  {artistGroups.map(([artist, songs]) => (
                    <motion.button
                      key={artist}
                      variants={staggerItem}
                      whileTap={{ scale: 0.98 }}
                      onClick={() => handlePlayAll(songs)}
                      className="w-full flex items-center gap-3 p-3 rounded-2xl bg-white/[0.03] border border-white/[0.04] active:bg-white/[0.06]"
                    >
                      <ArtistAvatar songs={songs} />
                      <div className="flex-1 min-w-0 text-left">
                        <h3 className="font-semibold text-sm truncate">{artist}</h3>
                        <p className="text-xs text-muted-foreground">
                          {songs.length} {songs.length === 1 ? 'track' : 'tracks'}
                        </p>
                      </div>
                      <ChevronRight className="w-4 h-4 text-muted-foreground" />
                    </motion.button>
                  ))}
                </motion.div>
              )}

              {tab === 'recent' && (
                <SongList
                  songs={recent}
                  currentId={currentSong?.id}
                  isPlaying={isPlaying}
                  onPlay={handlePlaySong}
                  onToggle={togglePlay}
                />
              )}
            </motion.div>
          </AnimatePresence>
        </div>
      )}

      <MiniPlayer />
      <FullscreenPlayer />
    </div>
  );
});

const CoverStack = ({ songs }: { songs: { id: string; cover_url?: string; title: string }[] }) => (
  <div className="relative w-24 h-24 flex-shrink-0">
    {songs.map((s, i) => (
      <div
        key={s.id}
        className="absolute w-16 h-16 rounded-xl overflow-hidden border border-white/10 shadow-xl bg-muted"
        style={{
          top: `${i * 6}px`,
          left: `${i * 6}px`,
          transform: `rotate(${(i - 1.5) * 4}deg)`,
          zIndex: 10 - i,
        }}
      >
        {s.cover_url ? (
          <img src={s.cover_url} alt={s.title} className="w-full h-full object-cover" />
        ) : (
          <div className="w-full h-full flex items-center justify-center">
            <Music className="w-5 h-5 text-muted-foreground" />
          </div>
        )}
      </div>
    ))}
  </div>
);

const ArtistAvatar = ({ songs }: { songs: { cover_url?: string; title: string }[] }) => {
  const cover = songs.find((s) => s.cover_url)?.cover_url;
  return (
    <div className="w-12 h-12 rounded-full overflow-hidden bg-muted flex-shrink-0 border border-white/10">
      {cover ? (
        <img src={cover} alt="" className="w-full h-full object-cover" />
      ) : (
        <div className="w-full h-full flex items-center justify-center">
          <Music className="w-5 h-5 text-muted-foreground" />
        </div>
      )}
    </div>
  );
};

const SongList = ({
  songs,
  currentId,
  isPlaying,
  onPlay,
  onToggle,
}: {
  songs: { id: string; title: string; artist: string; cover_url?: string; audio_url: string }[];
  currentId?: string;
  isPlaying: boolean;
  onPlay: (s: { id: string; title: string; artist: string; cover_url?: string; audio_url: string }) => void;
  onToggle: () => void;
}) => {
  if (!songs.length) {
    return (
      <p className="text-center text-sm text-muted-foreground py-12">No tracks match.</p>
    );
  }
  return (
    <motion.div
      className="space-y-1.5"
      variants={staggerContainer}
      initial="initial"
      animate="animate"
    >
      {songs.map((song) => {
        const isCurrent = currentId === song.id;
        return (
          <motion.button
            key={song.id}
            variants={staggerItem}
            whileTap={{ scale: 0.985 }}
            onClick={() => (isCurrent ? onToggle() : onPlay(song))}
            className={`w-full flex items-center gap-3 p-2.5 rounded-2xl transition-colors ${
              isCurrent
                ? 'bg-primary/15 border border-primary/20'
                : 'bg-white/[0.02] border border-white/[0.03] active:bg-white/[0.05]'
            }`}
          >
            <div className="relative w-12 h-12 rounded-xl overflow-hidden bg-muted flex-shrink-0">
              {song.cover_url ? (
                <img src={song.cover_url} alt={song.title} className="w-full h-full object-cover" />
              ) : (
                <div className="w-full h-full flex items-center justify-center">
                  <Music className="w-5 h-5 text-muted-foreground" />
                </div>
              )}
              {isCurrent && (
                <div className="absolute inset-0 bg-black/40 flex items-center justify-center">
                  {isPlaying ? (
                    <Pause className="w-4 h-4 text-white" fill="currentColor" />
                  ) : (
                    <Play className="w-4 h-4 text-white" fill="currentColor" />
                  )}
                </div>
              )}
            </div>
            <div className="flex-1 min-w-0 text-left">
              <h3
                className={`font-semibold text-sm truncate ${
                  isCurrent ? 'text-primary' : 'text-foreground'
                }`}
              >
                {song.title}
              </h3>
              <p className="text-xs text-muted-foreground truncate">{song.artist}</p>
            </div>
            {isCurrent && isPlaying && (
              <div className="flex gap-0.5 items-end h-3.5 pr-1">
                {[1, 2, 3].map((i) => (
                  <div
                    key={i}
                    className="w-0.5 bg-primary rounded-full animate-pulse"
                    style={{ height: `${6 + i * 3}px`, animationDelay: `${i * 0.15}s` }}
                  />
                ))}
              </div>
            )}
          </motion.button>
        );
      })}
    </motion.div>
  );
};

const EmptyState = () => (
  <motion.div
    className="flex-1 flex flex-col items-center justify-center px-6 py-20 text-center"
    initial={{ opacity: 0, y: 20 }}
    animate={{ opacity: 1, y: 0 }}
    transition={iosSpring}
  >
    <div className="relative mb-6">
      <div className="absolute inset-0 rounded-full bg-primary/20 blur-2xl" />
      <div className="relative w-24 h-24 rounded-3xl bg-gradient-to-br from-primary/30 to-rose-500/20 border border-white/10 flex items-center justify-center">
        <Download className="w-10 h-10 text-primary" />
      </div>
    </div>
    <h2 className="text-xl font-bold text-foreground mb-2">Your vault is empty</h2>
    <p className="text-sm text-muted-foreground max-w-[280px] leading-relaxed mb-6">
      Reconnect, then tap the download icon on any track to save it for offline listening.
    </p>
    <div className="flex items-center gap-2 px-3 py-2 rounded-full bg-destructive/10">
      <WifiOff className="w-3.5 h-3.5 text-destructive" />
      <span className="text-[11px] font-medium text-destructive">No internet connection</span>
    </div>
  </motion.div>
);

export default OfflinePlayerShell;
