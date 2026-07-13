import { useEffect, useMemo, useRef, useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Music2 } from 'lucide-react';
import { fetchLyrics, findActiveLine, type LyricsResult } from '@/lib/lyrics';
import { usePlayerProgress } from '@/lib/playerProgressStore';

interface Props {
  songId?: string;
  artist: string;
  title: string;
  duration?: number;
  /** Optional: hide outer card chrome; lock-screen renders raw */
  bare?: boolean;
}

const EMPTY: LyricsResult = {
  synced: [], plain: null, source: null, hasLyrics: false, isSynced: false,
};

const SyncedLyricsView = ({ songId, artist, title, duration, bare = true }: Props) => {
  const [lyrics, setLyrics] = useState<LyricsResult>(EMPTY);
  const [loading, setLoading] = useState(true);
  const { progress } = usePlayerProgress();
  const scrollerRef = useRef<HTMLDivElement>(null);
  const activeRef = useRef<HTMLParagraphElement>(null);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setLyrics(EMPTY);
    fetchLyrics(artist, title, duration, songId).then((r) => {
      if (!cancelled) { setLyrics(r); setLoading(false); }
    });
    return () => { cancelled = true; };
  }, [songId, artist, title, duration]);

  const activeIdx = useMemo(
    () => (lyrics.isSynced ? findActiveLine(lyrics.synced, progress) : -1),
    [lyrics, progress],
  );

  // Auto-scroll the active line into view (centered)
  useEffect(() => {
    if (activeIdx < 0 || !activeRef.current || !scrollerRef.current) return;
    const el = activeRef.current;
    const container = scrollerRef.current;
    const target = el.offsetTop - container.clientHeight / 2 + el.clientHeight / 2;
    container.scrollTo({ top: target, behavior: 'smooth' });
  }, [activeIdx]);

  const wrapper = bare
    ? 'relative h-full w-full overflow-hidden'
    : 'relative h-full w-full rounded-3xl overflow-hidden bg-black/40 backdrop-blur-2xl border border-white/10';

  if (loading) {
    return (
      <div className={wrapper}>
        <div className="h-full flex items-center justify-center">
          <motion.div
            className="text-white/40 text-sm font-medium"
            animate={{ opacity: [0.4, 0.7, 0.4] }}
            transition={{ duration: 1.6, repeat: Infinity, ease: 'easeInOut' }}
          >
            Finding lyrics…
          </motion.div>
        </div>
      </div>
    );
  }

  if (!lyrics.hasLyrics) {
    return (
      <div className={wrapper}>
        <div className="h-full flex flex-col items-center justify-center px-6 text-center gap-3">
          <Music2 className="w-7 h-7 text-white/30" />
          <p className="text-white/55 text-[15px] font-medium">No lyrics found for this track</p>
          {lyrics.geniusUrl && (
            <a
              href={lyrics.geniusUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-1.5 text-[12px] text-white/50 underline underline-offset-4"
            >
              View on Genius <ExternalLink className="w-3 h-3" />
            </a>
          )}
        </div>
      </div>
    );
  }

  // Synced view
  if (lyrics.isSynced) {
    return (
      <div className={wrapper}>
        <div
          ref={scrollerRef}
          className="h-full overflow-y-auto px-6 scroll-smooth"
          style={{
            scrollbarWidth: 'none',
            WebkitMaskImage: 'linear-gradient(180deg, transparent 0%, #000 18%, #000 82%, transparent 100%)',
            maskImage: 'linear-gradient(180deg, transparent 0%, #000 18%, #000 82%, transparent 100%)',
          }}
        >
          <div className="py-[40%]">
            {lyrics.synced.map((line, i) => {
              const active = i === activeIdx;
              const past = i < activeIdx;
              return (
                <p
                  key={i}
                  ref={active ? activeRef : undefined}
                  className="leading-tight tracking-tight font-bold transition-all duration-500 ease-out py-1.5"
                  style={{
                    fontSize: active ? 26 : 22,
                    color: active
                      ? 'rgba(255,255,255,0.98)'
                      : past ? 'rgba(255,255,255,0.28)' : 'rgba(255,255,255,0.42)',
                    transform: active ? 'translateY(0) scale(1)' : 'translateY(0) scale(0.97)',
                    filter: active ? 'blur(0px)' : 'blur(0.4px)',
                    textShadow: active ? '0 2px 24px rgba(255,45,85,0.25)' : 'none',
                  }}
                >
                  {line.text || '♪'}
                </p>
              );
            })}
          </div>
        </div>
      </div>
    );
  }

  // Unsynced fallback — show plain text, scrollable
  return (
    <div className={wrapper}>
      <div
        className="h-full overflow-y-auto px-6 py-8"
        style={{
          scrollbarWidth: 'none',
          WebkitMaskImage: 'linear-gradient(180deg, transparent 0%, #000 10%, #000 90%, transparent 100%)',
          maskImage: 'linear-gradient(180deg, transparent 0%, #000 10%, #000 90%, transparent 100%)',
        }}
      >
        <p className="text-white/75 text-[17px] leading-relaxed font-medium whitespace-pre-wrap">
          {lyrics.plain}
        </p>
      </div>
    </div>
  );
};

export default SyncedLyricsView;
