import { memo, useEffect, useRef, useState } from 'react';
import { Music2 } from 'lucide-react';
import { fetchLyrics, findActiveLine, type LyricLine, type LyricsResult } from '@/lib/lyrics';
import { playerProgressStore } from '@/lib/playerProgressStore';

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

const FADE = 'linear-gradient(180deg, transparent 0%, #000 14%, #000 80%, transparent 100%)';

/** One lyric row, memoized on its own state so a line change repaints two rows. */
const LyricRow = memo(({ line, state }: { line: LyricLine; state: 'active' | 'past' | 'future' }) => {
  const active = state === 'active';
  return (
    <p
      data-active={active || undefined}
      className={[
        'origin-left py-2 text-[26px] font-extrabold leading-[1.18] tracking-tight transition-all duration-500 ease-out',
        active ? 'text-foreground opacity-100 scale-100' : 'text-foreground scale-[0.97]',
        state === 'past' ? 'opacity-25' : state === 'future' ? 'opacity-40' : '',
      ].join(' ')}
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

  // Commit state only when the line index changes, not on every audio tick.
  useEffect(() => {
    const lines = lyrics.isSynced ? lyrics.synced : [];
    const tick = () => {
      const next = lines.length ? findActiveLine(lines, playerProgressStore.getEstimatedProgress()) : -1;
      setActiveIdx((prev) => (prev === next ? prev : next));
    };
    tick();
    const id = setInterval(tick, 250);
    const unsub = playerProgressStore.subscribe(tick);
    return () => { clearInterval(id); unsub(); };
  }, [lyrics]);

  // Keep the sung line about a third down the view.
  useEffect(() => {
    if (activeIdx < 0) return;
    const container = scrollerRef.current;
    if (!container) return;
    const raf = requestAnimationFrame(() => {
      const el = container.querySelector<HTMLElement>('[data-active]');
      if (!el) return;
      container.scrollTo({ top: el.offsetTop - container.clientHeight * 0.32, behavior: 'smooth' });
    });
    return () => cancelAnimationFrame(raf);
  }, [activeIdx]);

  const wrapper = bare
    ? 'relative h-full w-full overflow-hidden'
    : 'relative h-full w-full overflow-hidden rounded-3xl border border-border bg-background';

  if (loading) {
    return (
      <div className={wrapper}>
        <div className="flex h-full flex-col justify-center gap-4 px-6">
          {[78, 62, 70].map((w) => (
            <div key={w} className="h-6 animate-pulse rounded-md bg-foreground/10" style={{ width: `${w}%` }} />
          ))}
        </div>
      </div>
    );
  }

  if (!lyrics.hasLyrics) {
    return (
      <div className={wrapper}>
        <div className="flex h-full flex-col items-center justify-center gap-3 px-6 text-center">
          <Music2 className="h-7 w-7 text-muted-foreground" />
          <p className="text-[15px] font-semibold text-foreground/80">No lyrics for this song yet</p>
        </div>
      </div>
    );
  }

  if (lyrics.isSynced) {
    return (
      <div className={wrapper}>
        <div
          ref={scrollerRef}
          className="relative h-full overflow-y-auto px-6"
          style={{ scrollbarWidth: 'none', WebkitMaskImage: FADE, maskImage: FADE }}
        >
          <div className="pb-[60%] pt-[30%]">
            {lyrics.synced.map((line, i) => (
              <LyricRow key={i} line={line} state={i === activeIdx ? 'active' : i < activeIdx ? 'past' : 'future'} />
            ))}
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className={wrapper}>
      <div
        className="relative h-full overflow-y-auto px-6 py-10"
        style={{ scrollbarWidth: 'none', WebkitMaskImage: FADE, maskImage: FADE }}
      >
        <p className="whitespace-pre-wrap text-[20px] font-bold leading-relaxed text-foreground/80">{lyrics.plain}</p>
      </div>
    </div>
  );
};

export default SyncedLyricsView;
