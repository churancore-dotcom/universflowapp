import { useEffect, useMemo, useRef, useState } from 'react';
import { motion } from 'framer-motion';
import { Music2 } from 'lucide-react';
import { fetchLyrics, findActiveLine, type LyricsResult } from '@/lib/lyrics';
import { usePlayerProgress } from '@/lib/playerProgressStore';
import { annotateEmotions, dominantEmotion, EMOTION_STYLES, type Emotion } from '@/lib/lyricEmotion';
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

const SyncedLyricsView = ({ songId, artist, title, duration, bare = true }: Props) => {
  const [lyrics, setLyrics] = useState<LyricsResult>(EMPTY);
  const [loading, setLoading] = useState(true);
  const { progress, playing } = usePlayerProgress();
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

  // Precompute emotion per lyric line once per song (keyword scoring — instant, offline)
  const emotionLines = useMemo(
    () => (lyrics.isSynced ? annotateEmotions(lyrics.synced) : []),
    [lyrics],
  );

  const activeIdx = useMemo(
    () => (lyrics.isSynced ? findActiveLine(lyrics.synced, progress) : -1),
    [lyrics, progress],
  );

  const songMood = useMemo<Emotion>(
    () => (emotionLines.length ? dominantEmotion(emotionLines) : 'neutral'),
    [emotionLines],
  );

  const activeEmotion: Emotion = activeIdx >= 0
    ? (emotionLines[activeIdx]?.emotion ?? songMood)
    : songMood;

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
        <EmotionVisualizer emotion={activeEmotion} playing={playing} />
        <MoodBadge />
        <div
          ref={scrollerRef}
          className="relative h-full overflow-y-auto px-6 scroll-smooth"
          style={{
            scrollbarWidth: 'none',
            WebkitMaskImage: 'linear-gradient(180deg, transparent 0%, #000 18%, #000 82%, transparent 100%)',
            maskImage: 'linear-gradient(180deg, transparent 0%, #000 18%, #000 82%, transparent 100%)',
          }}
        >
          <div className="py-[40%]">
            {emotionLines.map((line, i) => {
              const active = i === activeIdx;
              const past = i < activeIdx;
              const lineStyle = EMOTION_STYLES[line.emotion];
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
                    textShadow: active ? `0 2px 26px ${lineStyle.colors[0]}66` : 'none',
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
