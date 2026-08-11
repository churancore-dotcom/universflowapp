import { memo, useEffect, useMemo, useRef, useState } from 'react';
import { motion } from 'framer-motion';
import { Music2 } from 'lucide-react';
import { fetchLyrics, findActiveLine, type LyricsResult } from '@/lib/lyrics';
import { playerProgressStore } from '@/lib/playerProgressStore';
import { annotateEmotions, dominantEmotion, EMOTION_STYLES, type Emotion, type EmotionLine } from '@/lib/lyricEmotion';
import EmotionVisualizer from './EmotionVisualizer';

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

/**
 * One lyric row. Memoized on its own visual state so a line-change repaints two
 * rows instead of re-styling the whole song — that full-list restyle on every
 * 250ms progress tick is what made the lyrics view stutter.
 */
const LyricRow = memo(({ line, state }: { line: EmotionLine; state: 'active' | 'past' | 'future' }) => {
  const active = state === 'active';
  const shadow = EMOTION_STYLES[line.emotion].colors[0];
  // The active line lifts, sharpens and glows in its own mood colour; neighbours
  // sit back with a touch of blur so the eye locks onto the sung line.
  return (
    <p
      data-active={active || undefined}
      className="leading-tight tracking-tight font-bold py-1.5 will-change-transform"
      style={{
        fontSize: active ? 27 : 22,
        color: active
          ? 'rgba(255,255,255,0.98)'
          : state === 'past' ? 'rgba(255,255,255,0.26)' : 'rgba(255,255,255,0.44)',
        transform: active ? 'translateY(0) scale(1)' : 'translateY(2px) scale(0.965)',
        filter: active ? 'blur(0px)' : 'blur(0.7px)',
        textShadow: active ? `0 2px 30px ${shadow}70, 0 0 2px ${shadow}40` : 'none',
        transition: 'color 420ms ease-out, transform 520ms cubic-bezier(.22,1,.36,1), filter 420ms ease-out, font-size 380ms cubic-bezier(.22,1,.36,1), text-shadow 420ms ease-out',
      }}
    >
      {line.text || '♪'}
    </p>
  );
});

LyricRow.displayName = 'LyricRow';

const SyncedLyricsView = ({ songId, artist, title, duration, bare = true }: Props) => {
  const [lyrics, setLyrics] = useState<LyricsResult>(EMPTY);
  const [loading, setLoading] = useState(true);
  const [activeIdx, setActiveIdx] = useState(-1);
  const [playing, setPlaying] = useState(() => playerProgressStore.getPlaying());
  const scrollerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setLyrics(EMPTY);
    setActiveIdx(-1);
    fetchLyrics(artist, title, duration, songId).then((r) => {
      if (!cancelled) { setLyrics(r); setLoading(false); }
    });
    return () => { cancelled = true; };
  }, [songId, artist, title, duration]);

  // Precompute emotion per lyric line once per song (keyword scoring — instant, offline)
  const emotionLines = useMemo(
    () => (lyrics.isSynced ? annotateEmotions(lyrics.synced) : []),
    [lyrics],
  );

  // Poll the progress store cheaply and only commit state when the *line index*
  // changes, so React work is proportional to lyric lines, not to audio ticks.
  useEffect(() => {
    const lines = lyrics.isSynced ? lyrics.synced : [];
    const tick = () => {
      const next = lines.length
        ? findActiveLine(lines, playerProgressStore.getEstimatedProgress())
        : -1;
      setActiveIdx((prev) => (prev === next ? prev : next));
      const isPlaying = playerProgressStore.getPlaying();
      setPlaying((prev) => (prev === isPlaying ? prev : isPlaying));
    };
    tick();
    const id = setInterval(tick, 250);
    const unsub = playerProgressStore.subscribe(tick);
    return () => { clearInterval(id); unsub(); };
  }, [lyrics]);

  const songMood = useMemo<Emotion>(
    () => (emotionLines.length ? dominantEmotion(emotionLines) : 'neutral'),
    [emotionLines],
  );

  const activeEmotion: Emotion = activeIdx >= 0
    ? (emotionLines[activeIdx]?.emotion ?? songMood)
    : songMood;
  const activeConfidence = activeIdx >= 0
    ? (emotionLines[activeIdx]?.confidence ?? 0.5)
    : 0.5;


  // Auto-scroll the active line into view (centered) without smooth-scroll
  // thrash: one rAF-aligned scrollTop write per line change.
  useEffect(() => {
    if (activeIdx < 0) return;
    const container = scrollerRef.current;
    if (!container) return;
    const raf = requestAnimationFrame(() => {
      const el = container.querySelector<HTMLElement>('[data-active]');
      if (!el) return;
      container.scrollTo({
        top: el.offsetTop - container.clientHeight / 2 + el.clientHeight / 2,
        behavior: 'smooth',
      });
    });
    return () => cancelAnimationFrame(raf);
  }, [activeIdx]);

  const wrapper = bare
    ? 'relative h-full w-full overflow-hidden'
    : 'relative h-full w-full rounded-3xl overflow-hidden bg-black/40 backdrop-blur-2xl border border-white/10';

  const style = EMOTION_STYLES[activeEmotion];

  const MoodBadge = () => (
    <div className="absolute top-3 left-1/2 -translate-x-1/2 z-20 pointer-events-none">
      <motion.span
        key={style.emotion}
        initial={{ opacity: 0, y: -6 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.45 }}
        className="px-2.5 py-1 rounded-full text-[10px] font-semibold uppercase tracking-[0.14em] border"
        style={{
          color: style.colors[0],
          borderColor: `${style.colors[0]}55`,
          background: `${style.colors[0]}14`,
        }}
      >
        {style.label}
      </motion.span>
    </div>
  );

  if (loading) {
    return (
      <div className={wrapper}>
        <EmotionVisualizer emotion="neutral" playing={playing} />
        <div className="relative h-full flex items-center justify-center">
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

  // No lyrics — graceful message, audio-reactive visuals only
  if (!lyrics.hasLyrics) {
    return (
      <div className={wrapper}>
        <EmotionVisualizer emotion="neutral" playing={playing} />
        <div className="relative h-full flex flex-col items-center justify-center px-6 text-center gap-3">
          <Music2 className="w-7 h-7 text-white/30" />
          <p className="text-white/55 text-[15px] font-medium">Lyrics not available</p>
          <p className="text-white/30 text-[12px]">Enjoy the visuals — they still move with the music</p>
        </div>
      </div>
    );
  }

  // Synced view — emotion-reactive canvas behind the scrolling lines
  if (lyrics.isSynced) {
    return (
      <div className={wrapper}>
        <EmotionVisualizer emotion={activeEmotion} playing={playing} confidence={activeConfidence} />
        <MoodBadge />
        <div
          ref={scrollerRef}
          className="relative h-full overflow-y-auto px-6"
          style={{
            scrollbarWidth: 'none',
            WebkitMaskImage: 'linear-gradient(180deg, transparent 0%, #000 18%, #000 82%, transparent 100%)',
            maskImage: 'linear-gradient(180deg, transparent 0%, #000 18%, #000 82%, transparent 100%)',
          }}
        >
          <div className="py-[40%]">
            {emotionLines.map((line, i) => (
              <LyricRow
                key={i}
                line={line}
                state={i === activeIdx ? 'active' : i < activeIdx ? 'past' : 'future'}
              />
            ))}
          </div>
        </div>
      </div>
    );
  }

  // Unsynced fallback — show plain text, scrollable
  return (
    <div className={wrapper}>
      <EmotionVisualizer emotion={songMood} playing={playing} />
      <div
        className="relative h-full overflow-y-auto px-6 py-8"
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
