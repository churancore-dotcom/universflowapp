import { memo, useMemo } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import {
  ChevronLeft, Download, Trash2, X, Loader2, HardDrive, CloudOff, Play, Music,
} from 'lucide-react';
import { useNavigate } from '@/lib/router-compat';
import BottomNav from '@/components/BottomNav';
import PageTransition from '@/components/PageTransition';
import { iosSpring, iosBounce } from '@/lib/animations';
import { useDownloads } from '@/contexts/DownloadContext';
import { usePlayer } from '@/contexts/PlayerContext';
import { useHaptics } from '@/hooks/useHaptics';
import { toast } from 'sonner';
import SEOHead from '@/components/SEOHead';

// Soft cap shown to user — IndexedDB is browser-managed but we surface a friendly ceiling.
const STORAGE_BUDGET_BYTES = 2 * 1024 * 1024 * 1024; // 2 GB

function formatBytes(bytes: number) {
  if (!bytes || bytes <= 0) return '0 B';
  const k = 1024;
  const sizes = ['B', 'KB', 'MB', 'GB'];
  const i = Math.min(Math.floor(Math.log(bytes) / Math.log(k)), sizes.length - 1);
  return `${(bytes / Math.pow(k, i)).toFixed(i === 0 ? 0 : 1)} ${sizes[i]}`;
}

const DownloadsPage = memo(function DownloadsPage() {
  const navigate = useNavigate();
  const haptics = useHaptics();
  const { playSong } = usePlayer();
  const {
    downloads,
    downloadQueue,
    downloadProgress,
    currentDownloadId,
    cancelDownload,
    removeFromQueue,
    clearQueue,
    removeSong,
    clearAllDownloads,
    getDownloadedUrl,
  } = useDownloads();

  const totalUsed = useMemo(
    () => downloads.reduce((acc, s) => acc + (s.size || 0), 0),
    [downloads],
  );
  const usedPct = Math.min(100, Math.round((totalUsed / STORAGE_BUDGET_BYTES) * 100));

  const activeProgress = currentDownloadId ? downloadProgress[currentDownloadId] : null;
  const activeSong = currentDownloadId
    ? (downloadQueue.find(q => q.id === currentDownloadId) || null)
    : null;

  const handlePlay = (songId: string) => {
    const song = downloads.find(d => d.id === songId);
    if (!song) return;
    const url = getDownloadedUrl(songId) || song.audio_url;
    haptics.light();
    playSong(song, url, downloads);
  };

  const handleRemove = (songId: string, title: string) => {
    haptics.medium();
    removeSong(songId);
    toast.success(`Removed "${title}"`);
  };

  const handleClearAll = () => {
    if (downloads.length === 0) return;
    haptics.medium();
    clearAllDownloads();
    toast.success('All downloads cleared');
  };

  return (
    <PageTransition>
      <SEOHead
        title="Downloads — Univers Flow"
        description="Manage your offline downloads and queued songs in Univers Flow. Listen anywhere without using mobile data."
        keywords="offline music, music downloads, Univers Flow offline"
      />
      <motion.div
        className="ethereal-page min-h-screen pb-44 relative overflow-hidden"
        initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ duration: 0.25 }}
      >
        {/* Header */}
        <motion.header
          className="sticky top-0 z-30 px-2 pt-4 pb-3 flex items-center safe-area-pt"
          style={{
            background: 'hsl(var(--background) / 0.85)',
            backdropFilter: 'blur(40px) saturate(180%)',
            WebkitBackdropFilter: 'blur(40px) saturate(180%)',
          }}
          initial={{ opacity: 0, y: -20 }} animate={{ opacity: 1, y: 0 }} transition={iosSpring}
        >
          <motion.button
            onClick={() => { haptics.light(); navigate(-1); }}
            className="flex items-center gap-1 px-2 py-2 -ml-1 text-primary"
            whileTap={{ scale: 0.95, opacity: 0.7 }} transition={iosBounce}
          >
            <ChevronLeft className="w-6 h-6" />
            <span className="text-[17px]">Back</span>
          </motion.button>
          <h1 className="ethereal-title ml-1 text-[17px] font-semibold">Downloads</h1>
        </motion.header>

        <main className="px-5 pt-2 space-y-6">
          {/* Storage usage card */}
          <motion.section
            initial={{ opacity: 0, y: 14 }} animate={{ opacity: 1, y: 0 }} transition={iosSpring}
            className="rounded-3xl p-5"
            style={{
              background: 'hsl(var(--card) / 0.65)',
              border: '0.5px solid hsl(var(--border) / 0.5)',
            }}
          >
            <div className="flex items-center gap-3 mb-4">
              <div
                className="w-11 h-11 rounded-2xl flex items-center justify-center shrink-0"
                style={{ background: 'linear-gradient(135deg, hsl(var(--primary) / 0.25), hsl(var(--primary) / 0.08))' }}
              >
                <HardDrive className="w-5 h-5 text-primary" />
              </div>
              <div className="flex-1 min-w-0">
                <p className="text-[10px] font-bold tracking-[0.22em] text-muted-foreground uppercase">Storage</p>
                <p className="text-[17px] font-semibold leading-tight">
                  {formatBytes(totalUsed)} <span className="text-muted-foreground text-[13px] font-normal">of {formatBytes(STORAGE_BUDGET_BYTES)} used</span>
                </p>
              </div>
            </div>
            <div className="h-2 rounded-full overflow-hidden" style={{ background: 'hsl(var(--muted))' }}>
              <motion.div
                className="h-full"
                style={{ background: 'linear-gradient(90deg, hsl(var(--primary)), hsl(var(--accent)))' }}
                initial={{ width: 0 }}
                animate={{ width: `${usedPct}%` }}
                transition={{ duration: 0.6, ease: 'easeOut' }}
              />
            </div>
            <div className="flex items-center justify-between mt-3">
              <p className="text-[12px] text-muted-foreground">
                {downloads.length} song{downloads.length === 1 ? '' : 's'} saved offline
              </p>
              {downloads.length > 0 && (
                <button
                  onClick={handleClearAll}
                  className="text-[12px] font-semibold text-destructive flex items-center gap-1"
                >
                  <Trash2 className="w-3.5 h-3.5" />
                  Clear all
                </button>
              )}
            </div>
          </motion.section>

          {/* Active download */}
          {activeProgress && (
            <motion.section
              initial={{ opacity: 0, y: 14 }} animate={{ opacity: 1, y: 0 }} transition={iosSpring}
              className="rounded-3xl p-4"
              style={{
                background: 'hsl(var(--primary) / 0.08)',
                border: '0.5px solid hsl(var(--primary) / 0.3)',
              }}
            >
              <div className="flex items-center gap-3">
                <div className="w-11 h-11 rounded-xl bg-gradient-to-br from-primary to-accent flex items-center justify-center shrink-0">
                  <motion.div animate={{ rotate: 360 }} transition={{ duration: 1.2, repeat: Infinity, ease: 'linear' }}>
                    <Loader2 className="w-5 h-5 text-primary-foreground" />
                  </motion.div>
                </div>
                <div className="flex-1 min-w-0">
                  <p className="text-[10px] font-bold tracking-[0.18em] text-primary uppercase">Downloading now</p>
                  <p className="font-semibold text-[14px] truncate">
                    {activeSong?.title ?? 'Preparing…'}
                  </p>
                  {activeSong?.artist && (
                    <p className="text-[12px] text-muted-foreground truncate">{activeSong.artist}</p>
                  )}
                </div>
                <button
                  onClick={() => { haptics.medium(); cancelDownload(currentDownloadId!); }}
                  className="w-9 h-9 rounded-full flex items-center justify-center text-destructive shrink-0"
                  style={{ background: 'hsl(var(--destructive) / 0.12)' }}
                  aria-label="Cancel download"
                >
                  <X className="w-4 h-4" strokeWidth={2.5} />
                </button>
              </div>
              <div className="mt-3 h-1.5 rounded-full overflow-hidden" style={{ background: 'hsl(var(--muted))' }}>
                <motion.div
                  className="h-full bg-gradient-to-r from-primary to-accent"
                  initial={{ width: 0 }}
                  animate={{ width: `${activeProgress.progress}%` }}
                  transition={{ duration: 0.3 }}
                />
              </div>
              <p className="text-[11px] text-muted-foreground mt-1.5 text-right tabular-nums">
                {activeProgress.progress}%
              </p>
            </motion.section>
          )}

          {/* Queue */}
          {downloadQueue.filter(q => q.id !== currentDownloadId).length > 0 && (
            <section>
              <div className="flex items-center justify-between mb-3 px-1">
                <p className="text-[10px] font-bold tracking-[0.22em] text-muted-foreground uppercase">
                  Up next ({downloadQueue.filter(q => q.id !== currentDownloadId).length})
                </p>
                <button
                  onClick={() => { haptics.light(); clearQueue(); }}
                  className="text-[12px] font-semibold text-destructive"
                >
                  Clear queue
                </button>
              </div>
              <div className="space-y-1.5">
                <AnimatePresence initial={false}>
                  {downloadQueue
                    .filter(q => q.id !== currentDownloadId)
                    .map(song => (
                      <motion.div
                        key={song.id}
                        layout
                        initial={{ opacity: 0, x: -8 }}
                        animate={{ opacity: 1, x: 0 }}
                        exit={{ opacity: 0, x: 16 }}
                        transition={iosSpring}
                        className="flex items-center gap-3 p-3 rounded-2xl"
                        style={{
                          background: 'hsl(var(--card) / 0.5)',
                          border: '0.5px solid hsl(var(--border) / 0.4)',
                        }}
                      >
                        {song.cover_url ? (
                          <img src={song.cover_url} alt="" className="w-11 h-11 rounded-lg object-cover shrink-0" />
                        ) : (
                          <div className="w-11 h-11 rounded-lg bg-muted flex items-center justify-center shrink-0">
                            <Music className="w-4 h-4 text-muted-foreground" />
                          </div>
                        )}
                        <div className="flex-1 min-w-0">
                          <p className="text-[14px] font-semibold truncate">{song.title}</p>
                          <p className="text-[12px] text-muted-foreground truncate">{song.artist}</p>
                        </div>
                        <button
                          onClick={() => { haptics.light(); removeFromQueue(song.id); }}
                          className="w-8 h-8 rounded-full flex items-center justify-center text-muted-foreground hover:text-destructive shrink-0"
                          aria-label="Remove from queue"
                        >
                          <X className="w-4 h-4" />
                        </button>
                      </motion.div>
                    ))}
                </AnimatePresence>
              </div>
            </section>
          )}

          {/* Saved offline */}
          <section>
            <p className="text-[10px] font-bold tracking-[0.22em] text-muted-foreground uppercase mb-3 px-1">
              Saved offline
            </p>
            {downloads.length === 0 ? (
              <div
                className="rounded-3xl p-10 text-center"
                style={{ background: 'hsl(var(--card) / 0.4)', border: '0.5px solid hsl(var(--border) / 0.4)' }}
              >
                <CloudOff className="w-9 h-9 mx-auto mb-3 text-muted-foreground/60" />
                <p className="text-[15px] font-semibold mb-1">No downloads yet</p>
                <p className="text-[12.5px] text-muted-foreground">
                  Tap the download icon on any song to save it here.
                </p>
              </div>
            ) : (
              <div className="space-y-1.5">
                <AnimatePresence initial={false}>
                  {downloads.map(song => (
                    <motion.div
                      key={song.id}
                      layout
                      initial={{ opacity: 0, y: 6 }}
                      animate={{ opacity: 1, y: 0 }}
                      exit={{ opacity: 0, x: 16 }}
                      transition={iosSpring}
                      className="flex items-center gap-3 p-3 rounded-2xl"
                      style={{
                        background: 'hsl(var(--card) / 0.55)',
                        border: '0.5px solid hsl(var(--border) / 0.45)',
                      }}
                    >
                      <button
                        onClick={() => handlePlay(song.id)}
                        className="relative shrink-0"
                        aria-label={`Play ${song.title}`}
                      >
                        {song.cover_url ? (
                          <img src={song.cover_url} alt="" className="w-12 h-12 rounded-lg object-cover" />
                        ) : (
                          <div className="w-12 h-12 rounded-lg bg-muted flex items-center justify-center">
                            <Music className="w-4 h-4 text-muted-foreground" />
                          </div>
                        )}
                        <div className="absolute inset-0 rounded-lg bg-black/35 opacity-0 hover:opacity-100 active:opacity-100 flex items-center justify-center transition-opacity">
                          <Play className="w-4 h-4 text-white" fill="currentColor" />
                        </div>
                      </button>
                      <div className="flex-1 min-w-0">
                        <p className="text-[14px] font-semibold truncate">{song.title}</p>
                        <p className="text-[12px] text-muted-foreground truncate">
                          {song.artist} · {formatBytes(song.size)}
                        </p>
                      </div>
                      <button
                        onClick={() => handleRemove(song.id, song.title)}
                        className="w-9 h-9 rounded-full flex items-center justify-center text-muted-foreground hover:text-destructive shrink-0"
                        style={{ background: 'hsl(var(--muted) / 0.5)' }}
                        aria-label="Delete download"
                      >
                        <Trash2 className="w-4 h-4" />
                      </button>
                    </motion.div>
                  ))}
                </AnimatePresence>
              </div>
            )}
          </section>
        </main>

        <BottomNav />
      </motion.div>
    </PageTransition>
  );
});

export default DownloadsPage;
