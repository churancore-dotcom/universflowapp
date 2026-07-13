import { useEffect, useMemo, useRef, useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Music2 } from 'lucide-react';
import { fetchLyrics, findActiveLine, type LyricsResult, type LyricLine } from '@/lib/lyrics';
import { usePlayerProgress } from '@/lib/playerProgressStore';

interface Props {
  artist: string;
  title: string;
  duration?: number;
}

const EMPTY: LyricsResult = {
  synced: [], plain: null, source: null, hasLyrics: false, isSynced: false,
};

/**
 * Animated, full-stage lyrics player.
 * - Synced lyrics: active line is centered, large, glowing. Surrounding lines fade
 *   and blur into the distance with a smooth spring slide on each line change.
 * - Unsynced fallback: plain text, scrollable.
 * - No lyrics: artwork-friendly empty state with optional Genius link.
 */
const AnimatedLyricsStage = ({ artist, title, duration }: Props) => {
  const [lyrics, setLyrics] = useState<LyricsResult>(EMPTY);
  const [loading, setLoading] = useState(true);
  const { progress } = usePlayerProgress();

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setLyrics(EMPTY);
    fetchLyrics(artist, title, duration).then((r) => {
      if (!cancelled) { setLyrics(r); setLoading(false); }
    });
    return () => { cancelled = true; };
  }, [artist, title, duration]);

  const activeIdx = useMemo(
    () => (lyrics.isSynced ? findActiveLine(lyrics.synced, progress + 0.15) : -1),
    [lyrics, progress],
  );

  // Loading
  if (loading) {
    return (
      <div className="h-full w-full flex items-center justify-center">
        <motion.div
          className="flex items-center gap-2 text-white/45 text-[13px] font-medium tracking-wide"
          animate={{ opacity: [0.35, 0.85, 0.35] }}
          transition={{ duration: 1.6, repeat: Infinity, ease: 'easeInOut' }}
        >
          <span className="w-1.5 h-1.5 rounded-full bg-white/60" />
          Finding lyrics
        </motion.div>
      </div>
    );
  }

  // No lyrics
  if (!lyrics.hasLyrics) {
    return (
      <div className="h-full w-full flex flex-col items-center justify-center gap-4 px-8 text-center">
        <motion.div
          initial={{ scale: 0.7, opacity: 0 }}
          animate={{ scale: 1, opacity: 1 }}
          transition={{ type: 'spring', stiffness: 280, damping: 22 }}
          className="w-14 h-14 rounded-full bg-white/5 border border-white/10 flex items-center justify-center"
        >
          <Music2 className="w-6 h-6 text-white/40" />
        </motion.div>
        <p className="text-white/65 text-[16px] font-semibold tracking-tight">
          No lyrics for this track
        </p>
        <p className="text-white/35 text-[12px] font-medium max-w-[260px] leading-relaxed">
          Just vibe to the music — when lyrics exist they'll appear here in real-time.
        </p>
        {lyrics.geniusUrl && (
          <a
            href={lyrics.geniusUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center gap-1.5 text-[12px] text-white/55 underline underline-offset-4 mt-1"
          >
            View on Genius <ExternalLink className="w-3 h-3" />
          </a>
        )}
      </div>
    );
  }

  // Unsynced plain fallback
  if (!lyrics.isSynced) {
    return (
      <div
        className="h-full w-full overflow-y-auto px-7 py-10 [&::-webkit-scrollbar]:hidden"
        style={{
          scrollbarWidth: 'none',
          WebkitMaskImage: 'linear-gradient(180deg, transparent 0%, #000 12%, #000 88%, transparent 100%)',
          maskImage: 'linear-gradient(180deg, transparent 0%, #000 12%, #000 88%, transparent 100%)',
        }}
      >
        <p className="text-white/75 text-[18px] leading-[1.7] font-semibold whitespace-pre-wrap tracking-tight">
          {lyrics.plain}
        </p>
      </div>
    );
  }

  // ── Synced view: render a moving 7-line window centered on the active line ──
  return (
    <SyncedStage lines={lyrics.synced} activeIdx={activeIdx} />
  );
};

/**
 * Synced stage. The active line sits dead-center. We render a small window
 * of lines around it and slide the whole stack with a spring on each change.
 */
const LINE_HEIGHT = 56;
const WINDOW_RADIUS = 4; // lines above + below the active one

const SyncedStage = ({ lines, activeIdx }: { lines: LyricLine[]; activeIdx: number }) => {
  // Clamp the visual index so we never show a "below first line" empty stack
  const visualIdx = activeIdx < 0 ? 0 : activeIdx;

  return (
    <div className="relative h-full w-full overflow-hidden">
      {/* Soft fade mask top/bottom */}
      <div
        className="absolute inset-0 pointer-events-none"
        style={{
          WebkitMaskImage: 'linear-gradient(180deg, transparent 0%, #000 22%, #000 78%, transparent 100%)',
          maskImage: 'linear-gradient(180deg, transparent 0%, #000 22%, #000 78%, transparent 100%)',
          background: 'transparent',
        }}
      />

      {/* The moving stack — centered vertically, shifts as activeIdx changes */}
      <motion.div
        className="absolute left-0 right-0 px-7"
        style={{ top: '50%' }}
        animate={{ y: -visualIdx * LINE_HEIGHT - LINE_HEIGHT / 2 }}
        transition={{ type: 'spring', stiffness: 240, damping: 32, mass: 0.9 }}
      >
        {lines.map((line, i) => {
          const distance = i - activeIdx;
          const isActive = distance === 0;
          const inWindow = Math.abs(distance) <= WINDOW_RADIUS;

          if (!inWindow) {
            // Keep height for accurate offset math, but render nothing
            return <div key={i} style={{ height: LINE_HEIGHT }} aria-hidden />;
          }

          const absD = Math.abs(distance);
          const opacity = isActive ? 1 : Math.max(0.18, 0.55 - absD * 0.12);
          const scale = isActive ? 1 : 0.92 - Math.min(absD * 0.02, 0.08);
          const blur = isActive ? 0 : Math.min(absD * 0.6, 2.2);

          return (
            <motion.p
              key={`${i}-${line.time}`}
              layout
              initial={false}
              animate={{ opacity, scale, filter: `blur(${blur}px)` }}
              transition={{ type: 'spring', stiffness: 260, damping: 30 }}
              className="text-center font-extrabold tracking-tight leading-tight will-change-transform"
              style={{
                height: LINE_HEIGHT,
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                fontSize: isActive ? 28 : 22,
                color: isActive ? 'rgba(255,255,255,0.98)' : 'rgba(255,255,255,0.65)',
                textShadow: isActive
                  ? '0 4px 24px rgba(255,45,85,0.35), 0 0 1px rgba(255,255,255,0.4)'
                  : 'none',
              }}
            >
              <span className="line-clamp-2">{line.text || '♪'}</span>
            </motion.p>
          );
        })}
      </motion.div>

      {/* Subtle rose glow behind active line */}
      <div
        aria-hidden
        className="absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 w-[78%] h-[60px] pointer-events-none"
        style={{
          background: 'radial-gradient(ellipse at center, hsl(var(--primary) / 0.18) 0%, transparent 70%)',
          filter: 'blur(8px)',
        }}
      />
    </div>
  );
};

export default AnimatedLyricsStage;
