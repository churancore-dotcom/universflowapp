import { useEffect, useMemo, useRef, useState, type CSSProperties } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { fetchLyrics, findActiveLine, type LyricsResult, type LyricLine } from '@/lib/lyrics';
import { playerProgressStore, usePlayerProgress } from '@/lib/playerProgressStore';
import { annotateEmotions, dominantEmotion, EMOTION_STYLES, type Emotion } from '@/lib/lyricEmotion';
import EmotionVisualizer from './EmotionVisualizer';

interface Props {
  artist: string;
  title: string;
  duration?: number;
}

const EMPTY: LyricsResult = {
  synced: [], plain: null, source: null, hasLyrics: false, isSynced: false,
};

const KaraokeLyricsStage = ({ artist, title, duration }: Props) => {
  const [lyrics, setLyrics] = useState<LyricsResult>(EMPTY);
  const [loading, setLoading] = useState(true);
  const [activeIdx, setActiveIdx] = useState(-1);
  const rafRef = useRef<number | null>(null);
  const activeIdxRef = useRef(-1);
  const stageRef = useRef<HTMLDivElement | null>(null);
  const { playing } = usePlayerProgress();

  // Fetch lyrics whenever song changes
  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setLyrics(EMPTY);
    setActiveIdx(-1);
    fetchLyrics(artist, title, duration).then((r) => {
      if (!cancelled) { setLyrics(r); setLoading(false); }
    });
    return () => { cancelled = true; };
  }, [artist, title, duration]);

  useEffect(() => {
    if (!lyrics.isSynced) return;
    // The karaoke wipe repaints gradient-clipped text, which is expensive on
    // mobile GPUs. 15fps is visually identical for a sweep and removes the
    // per-frame text repaint that made the lyrics stage stutter.
    let last = 0;
    let lastPct = -1;
    const tick = (now: number) => {
      rafRef.current = requestAnimationFrame(tick);
      if (document.hidden || now - last < 66) return;
      last = now;
      const t = playerProgressStore.getEstimatedProgress();
      const idx = findActiveLine(lyrics.synced, t);
      if (activeIdxRef.current !== idx) {
        activeIdxRef.current = idx;
        setActiveIdx(idx);
      }

      const safeIdx = Math.max(0, idx);
      const start = lyrics.synced[safeIdx]?.time ?? 0;
      const end = lyrics.synced[safeIdx + 1]?.time ?? duration ?? start + 4;
      const pct = end > start ? Math.max(0, Math.min(1, (t - start) / (end - start))) : 0;
      const rounded = Math.round(pct * 100);
      if (rounded !== lastPct) {
        lastPct = rounded;
        stageRef.current?.style.setProperty('--lyric-progress', `${rounded}%`);
      }
    };
    rafRef.current = requestAnimationFrame(tick);
    return () => { if (rafRef.current) cancelAnimationFrame(rafRef.current); };
  }, [lyrics, duration]);


  const emotionLines = useMemo(
    () => (lyrics.isSynced ? annotateEmotions(lyrics.synced) : []),
    [lyrics],
  );
  const songMood = useMemo<Emotion>(
    () => (emotionLines.length ? dominantEmotion(emotionLines) : 'neutral'),
    [emotionLines],
  );
  const activeEmotion: Emotion = activeIdx >= 0
    ? (emotionLines[activeIdx]?.emotion ?? songMood)
    : songMood;

  if (loading) {
    return (
      <div className="h-full w-full flex items-center justify-center px-8">
        <motion.div
          className="text-center text-[18px] font-extrabold tracking-normal"
          style={{ color: 'hsl(var(--foreground) / 0.58)' }}
          animate={{ opacity: [0.35, 0.85, 0.35] }}
          transition={{ duration: 1.4, repeat: Infinity, ease: 'easeInOut' }}
        >
          Finding lyrics…
        </motion.div>
      </div>
    );
  }

  if (!lyrics.hasLyrics) {
    return (
      <div className="h-full w-full flex items-center justify-center px-9 text-center">
        <motion.div
          initial={{ scale: 0.92, opacity: 0, y: 16 }}
          animate={{ scale: 1, opacity: 1 }}
          transition={{ type: 'spring', stiffness: 260, damping: 26 }}
          className="text-[27px] leading-tight font-black tracking-normal"
          style={{ color: 'hsl(var(--foreground) / 0.76)' }}
        >
          Lyrics not available
        </motion.div>
      </div>
    );
  }

  if (!lyrics.isSynced) {
    return (
      <div className="h-full w-full overflow-y-auto px-7 py-20 [&::-webkit-scrollbar]:hidden"
        style={{
          scrollbarWidth: 'none',
          WebkitMaskImage: 'linear-gradient(180deg,transparent 0%,#000 12%,#000 88%,transparent 100%)',
          maskImage: 'linear-gradient(180deg,transparent 0%,#000 12%,#000 88%,transparent 100%)',
        }}>
        <p className="text-[24px] leading-[1.45] font-black whitespace-pre-wrap tracking-normal text-center"
          style={{ color: 'hsl(var(--foreground) / 0.82)' }}>
          {lyrics.plain}
        </p>
      </div>
    );
  }

  return (
    <div ref={stageRef} className="relative h-full w-full" style={{ '--lyric-progress': '0%' } as CSSProperties}>
      <EmotionVisualizer emotion={activeEmotion} playing={playing} />
      <KaraokeView lines={lyrics.synced} activeIdx={activeIdx} accent={EMOTION_STYLES[activeEmotion].colors[0]} />
    </div>
  );
};

/* ─────────────────── Karaoke renderer ─────────────────── */

const LINE_GAP = 88;
const WINDOW = 3;

const KaraokeView = ({ lines, activeIdx, accent }: { lines: LyricLine[]; activeIdx: number; accent: string }) => {
  const focusIdx = Math.max(0, activeIdx);
  const start = Math.max(0, focusIdx - WINDOW);
  const end = Math.min(lines.length - 1, focusIdx + WINDOW);
  const visible = lines.slice(start, end + 1).map((line, offset) => ({ line, index: start + offset }));

  return (
    <div className="relative h-full w-full overflow-hidden px-5"
      style={{
        WebkitMaskImage: 'linear-gradient(180deg,transparent 0%,#000 18%,#000 82%,transparent 100%)',
        maskImage: 'linear-gradient(180deg,transparent 0%,#000 18%,#000 82%,transparent 100%)',
      }}>

      <motion.div aria-hidden className="absolute left-1/2 top-1/2 h-[132px] w-[88%] -translate-x-1/2 -translate-y-1/2 pointer-events-none rounded-full"
        animate={{ scale: [0.94, 1.06, 0.94], opacity: [0.34, 0.58, 0.34] }}
        transition={{ duration: 3.6, repeat: Infinity, ease: 'easeInOut' }}
        style={{ background: 'radial-gradient(ellipse at center, hsl(var(--primary) / 0.34) 0%, transparent 72%)' }} />

      <AnimatePresence initial={false}>
        {visible.map(({ line, index }) => {
          const d = index - focusIdx;
          const isActive = index === activeIdx;
          const absD = Math.abs(d);
          const opacity = isActive ? 1 : Math.max(0.12, 0.54 - absD * 0.12);
          const scale = isActive ? 1 : 0.88 - Math.min(absD * 0.035, 0.12);
          const blur = isActive ? 0 : Math.min(absD * 0.45, 1.4);

          return (
            <motion.div
              key={index}
              initial={{ opacity: 0, y: d * LINE_GAP + 28, scale: 0.86, filter: 'blur(6px)' }}
              animate={{ opacity, y: d * LINE_GAP, scale, filter: `blur(${blur}px)` }}
              exit={{ opacity: 0, y: d * LINE_GAP - 28, scale: 0.82, filter: 'blur(6px)' }}
              transition={{ type: 'spring', stiffness: 210, damping: 31, mass: 0.82 }}
              className="absolute left-0 right-0 top-1/2 flex items-center justify-center text-center font-black tracking-normal leading-[1.08] will-change-transform"
              style={{
                minHeight: 96,
                marginTop: -48,
                fontSize: isActive ? 31 : 22,
                color: 'hsl(var(--foreground) / 0.62)',
              }}
            >
              {isActive ? (
                <motion.span
                  key={`active-${index}`}
                  initial={{ opacity: 0, y: 18, scale: 0.92 }}
                  animate={{ opacity: 1, y: 0, scale: 1 }}
                  transition={{ type: 'spring', stiffness: 260, damping: 22 }}
                  className="relative line-clamp-3 px-2"
                  style={{
                    backgroundImage: 'linear-gradient(90deg, hsl(var(--foreground)) 0%, hsl(var(--foreground)) var(--lyric-progress), hsl(var(--foreground) / 0.36) var(--lyric-progress), hsl(var(--foreground) / 0.36) 100%)',
                    WebkitBackgroundClip: 'text',
                    backgroundClip: 'text',
                    color: 'transparent',
                    textShadow: `0 8px 34px ${accent}6b`,
                  }}
                >
                  {line.text || '♪'}
                </motion.span>
              ) : (
                <span className="line-clamp-2 px-2" style={{ color: 'hsl(var(--foreground) / 0.54)' }}>{line.text || '♪'}</span>
              )}
            </motion.div>
          );
        })}
      </AnimatePresence>

      <style>{`
        @media (prefers-reduced-motion: reduce) {
          * { animation-duration: 0.001ms !important; animation-iteration-count: 1 !important; transition-duration: 0.001ms !important; }
        }
      `}</style>
    </div>
  );
};

export default KaraokeLyricsStage;
