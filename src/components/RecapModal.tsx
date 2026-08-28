import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { AnimatePresence, motion, useMotionValue, useSpring, useTransform } from 'framer-motion';
import { createPortal } from 'react-dom';
import { X, Share2, Loader2, Crown, ChevronRight, Pause } from 'lucide-react';
import { useAuth } from '@/contexts/AuthContext';
import { usePremium } from '@/hooks/usePremium';
import { useNavigate } from '@/lib/router-compat';
import { buildRecap, loadPlayRecords, type RecapSlideData } from '@/lib/listeningInsights';
import { triggerHaptic } from '@/hooks/useHaptics';
import { toast } from 'sonner';

interface Props {
  isOpen: boolean;
  onClose: () => void;
  window?: 'month' | 'year';
}

const fmt = (n: number) => n.toLocaleString();
const SLIDE_MS = 5200;

type Slide = {
  key: string;
  kicker: string;
  big: string;
  /** Renders `big` as an animated count-up when set. */
  bigNumber?: number;
  bigSuffix?: string;
  sub?: string;
  note?: string;
  cover?: string | null;
  premium?: boolean;
};

/** Big numbers that tick up — the single most satisfying beat of a recap. */
const CountUp = ({ value, suffix }: { value: number; suffix?: string }) => {
  const mv = useMotionValue(0);
  const spring = useSpring(mv, { stiffness: 55, damping: 18 });
  const text = useTransform(spring, (v) => `${Math.round(v).toLocaleString()}${suffix ?? ''}`);
  useEffect(() => {
    mv.set(0);
    const t = setTimeout(() => mv.set(value), 120);
    return () => clearTimeout(t);
  }, [value, mv]);
  return <motion.span>{text}</motion.span>;
};

/** Word-by-word kinetic reveal for headline text. */
const Kinetic = ({ text, className }: { text: string; className?: string }) => (
  <span className={className}>
    {text.split(' ').map((word, i) => (
      <motion.span
        key={`${word}-${i}`}
        className="inline-block mr-[0.28em]"
        initial={{ y: '0.6em', opacity: 0, filter: 'blur(6px)' }}
        animate={{ y: 0, opacity: 1, filter: 'blur(0px)' }}
        transition={{ delay: 0.1 + i * 0.07, duration: 0.55, ease: [0.16, 1, 0.3, 1] }}
      >
        {word}
      </motion.span>
    ))}
  </span>
);

/**
 * "Your month in music" — a full-screen animated story built entirely from real
 * play history. Auto-advances, taps to skip, holds to pause. Slides whose data
 * is missing are simply not rendered; nothing is invented.
 */
const RecapModal = ({ isOpen, onClose, window: recapWindow = 'month' }: Props) => {
  const { user } = useAuth();
  const { isPremium } = usePremium();
  const navigate = useNavigate();
  const [loading, setLoading] = useState(true);
  const [recap, setRecap] = useState<RecapSlideData | null>(null);
  const [index, setIndex] = useState(0);
  const [paused, setPaused] = useState(false);

  useEffect(() => {
    if (!isOpen) return;
    setLoading(true);
    setIndex(0);
    setPaused(false);
    let cancelled = false;
    (async () => {
      try {
        const records = await loadPlayRecords(user?.id ?? null);
        if (!cancelled) setRecap(buildRecap(records, user?.id ?? null, recapWindow));
      } catch {
        if (!cancelled) setRecap(null);
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [isOpen, user?.id, recapWindow]);

  const slides = useMemo<Slide[]>(() => {
    if (!recap) return [];
    const out: Slide[] = [];

    out.push({
      key: 'intro',
      kicker: recap.windowLabel,
      big: recap.window === 'month' ? 'Your month in music' : 'Your year in music',
      sub: `${fmt(recap.totalPlays)} plays across ${recap.activeDays} day${recap.activeDays === 1 ? '' : 's'}`,
      note: recap.sparse ? 'Still early — this gets richer the more you listen.' : undefined,
    });

    if (recap.minutes !== null)
      out.push({
        key: 'minutes',
        kicker: 'Time spent listening',
        big: `${fmt(recap.minutes)} min`,
        bigNumber: recap.minutes,
        bigSuffix: ' min',
        sub: `About ${Math.max(1, Math.round(recap.minutes / 60))} hour${Math.round(recap.minutes / 60) === 1 ? '' : 's'} of music.`,
        note: recap.minutesEstimated ? 'Estimated from track lengths — measured precisely from now on.' : undefined,
      });

    if (recap.topArtist)
      out.push({
        key: 'artist',
        kicker: 'Your top artist',
        big: recap.topArtist.name,
        sub: `${fmt(recap.topArtist.plays)} plays`,
        cover: recap.topArtist.cover,
      });

    if (recap.topSong)
      out.push({
        key: 'song',
        kicker: 'Your top song',
        big: recap.topSong.title,
        sub: recap.topSong.artist,
        cover: recap.topSong.cover,
      });

    if (recap.mostRepeated)
      out.push({
        key: 'repeat',
        kicker: 'On repeat',
        big: recap.mostRepeated.record.title,
        sub: `${recap.mostRepeated.plays} plays — ${recap.mostRepeated.record.artist}`,
        cover: recap.mostRepeated.record.cover,
      });

    out.push({
      key: 'personality',
      kicker: 'Your listening personality',
      big: recap.personality.name,
      sub: recap.personality.blurb,
      note: recap.topGenre ? `Most played sound: ${recap.topGenre}` : undefined,
    });

    if (!isPremium && recap.minutes !== null && recap.minutes >= 60)
      out.push({
        key: 'premium',
        kicker: 'One thought',
        big: `${fmt(recap.minutes)} minutes`,
        bigNumber: recap.minutes,
        bigSuffix: ' minutes',
        sub: `That is how long you spent here ${recap.window === 'month' ? 'this month' : 'this year'}. Imagine all of it in the highest quality, with nothing in between.`,
        premium: true,
      });

    return out;
  }, [recap, isPremium]);

  const total = slides.length;
  const slide = slides[Math.min(index, Math.max(0, total - 1))];

  const next = useCallback(() => {
    setIndex((i) => {
      if (i + 1 >= total) { onClose(); return i; }
      return i + 1;
    });
  }, [total, onClose]);

  const prev = useCallback(() => setIndex((i) => Math.max(0, i - 1)), []);

  // Auto-advance
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => {
    if (!isOpen || loading || paused || total === 0) return;
    timer.current = setTimeout(next, SLIDE_MS);
    return () => { if (timer.current) clearTimeout(timer.current); };
  }, [isOpen, loading, paused, index, total, next]);

  const share = async () => {
    if (!recap) return;
    const lines = [
      `${recap.window === 'month' ? 'My month' : 'My year'} in music — ${recap.windowLabel}`,
      recap.minutes !== null ? `${fmt(recap.minutes)} minutes listened` : null,
      recap.topArtist ? `Top artist: ${recap.topArtist.name}` : null,
      recap.topSong ? `Top song: ${recap.topSong.title}` : null,
      `Personality: ${recap.personality.name}`,
      'via Universflow',
    ].filter(Boolean).join('\n');
    try {
      if (navigator.share) await navigator.share({ title: 'My Universflow recap', text: lines });
      else {
        await navigator.clipboard.writeText(lines);
        toast.success('Recap copied — paste it anywhere');
      }
    } catch {
      /* user dismissed */
    }
  };

  const overlay = (
    <AnimatePresence>
      {isOpen && (
        <motion.div
          className="fixed inset-0 z-[220] bg-background flex flex-col overflow-hidden"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
        >
          {/* Living gradient field — the whole screen breathes */}
          <motion.div
            aria-hidden
            className="absolute -inset-[30%] pointer-events-none"
            style={{
              background:
                'radial-gradient(closest-side, hsl(var(--primary) / 0.42), transparent 70%)',
            }}
            animate={{ x: ['-8%', '10%', '-8%'], y: ['6%', '-10%', '6%'], scale: [1, 1.15, 1] }}
            transition={{ duration: 18, repeat: Infinity, ease: 'easeInOut' }}
          />
          <motion.div
            aria-hidden
            className="absolute -inset-[25%] pointer-events-none opacity-70"
            style={{
              background:
                'radial-gradient(closest-side, hsl(var(--accent) / 0.35), transparent 70%)',
            }}
            animate={{ x: ['12%', '-10%', '12%'], y: ['-8%', '12%', '-8%'] }}
            transition={{ duration: 24, repeat: Infinity, ease: 'easeInOut' }}
          />

          {/* Header: story progress bars */}
          <div className="relative px-4 pt-4 pb-2">
            <div className="flex gap-1.5">
              {slides.map((s, i) => (
                <div key={s.key} className="h-[3px] flex-1 rounded-full bg-foreground/15 overflow-hidden">
                  <motion.div
                    className="h-full bg-primary rounded-full"
                    initial={{ width: i < index ? '100%' : '0%' }}
                    animate={{ width: i < index ? '100%' : i === index ? '100%' : '0%' }}
                    transition={
                      i === index
                        ? { duration: paused ? 0 : SLIDE_MS / 1000, ease: 'linear' }
                        : { duration: 0.2 }
                    }
                  />
                </div>
              ))}
            </div>
            <div className="flex items-center justify-between mt-3">
              <button onClick={onClose} className="w-10 h-10 rounded-full bg-foreground/10 backdrop-blur flex items-center justify-center" aria-label="Close recap">
                <X className="w-4 h-4" />
              </button>
              <div className="flex items-center gap-2">
                {paused && (
                  <span className="flex items-center gap-1 text-[10.5px] font-bold uppercase tracking-[0.2em] text-muted-foreground">
                    <Pause className="w-3 h-3" /> Paused
                  </span>
                )}
                <button onClick={share} disabled={!recap} className="w-10 h-10 rounded-full bg-foreground/10 backdrop-blur flex items-center justify-center disabled:opacity-40" aria-label="Share recap">
                  <Share2 className="w-4 h-4" />
                </button>
              </div>
            </div>
          </div>

          {loading ? (
            <div className="flex-1 flex items-center justify-center">
              <Loader2 className="w-6 h-6 animate-spin text-muted-foreground" />
            </div>
          ) : !recap || !slide ? (
            <div className="relative flex-1 flex flex-col items-center justify-center px-10 text-center">
              <h2 className="font-display text-[32px] font-black uppercase leading-tight">No recap yet</h2>
              <p className="text-[13px] text-muted-foreground mt-2">
                Play a few songs and your recap builds itself from your real listening — nothing made up.
              </p>
            </div>
          ) : (
            <div
              className="relative flex-1 min-h-0"
              onPointerDown={() => setPaused(true)}
              onPointerUp={() => setPaused(false)}
              onPointerCancel={() => setPaused(false)}
            >
              {/* Tap zones */}
              <button className="absolute inset-y-0 left-0 w-1/3 z-20" aria-label="Previous" onClick={prev} />
              <button className="absolute inset-y-0 right-0 w-2/3 z-20" aria-label="Next" onClick={() => { triggerHaptic('selection'); next(); }} />

              <AnimatePresence mode="wait">
                <motion.div
                  key={slide.key}
                  className="absolute inset-0 px-7 pb-14 flex flex-col justify-center"
                  initial={{ opacity: 0, scale: 1.04 }}
                  animate={{ opacity: 1, scale: 1 }}
                  exit={{ opacity: 0, scale: 0.98 }}
                  transition={{ duration: 0.45, ease: [0.16, 1, 0.3, 1] }}
                >
                  {slide.cover && (
                    <motion.div
                      className="relative self-center w-[62%] aspect-square rounded-[28px] overflow-hidden mb-9 shadow-2xl"
                      initial={{ y: 26, opacity: 0, rotate: -3 }}
                      animate={{ y: [0, -10, 0], opacity: 1, rotate: 0 }}
                      transition={{
                        y: { duration: 6, repeat: Infinity, ease: 'easeInOut' },
                        opacity: { duration: 0.5 },
                        rotate: { duration: 0.6, ease: [0.16, 1, 0.3, 1] },
                      }}
                    >
                      <img src={slide.cover} alt="" className="w-full h-full object-cover" loading="lazy" />
                      <div className="absolute inset-0 ring-1 ring-inset ring-foreground/10 rounded-[28px]" />
                    </motion.div>
                  )}

                  <motion.p
                    className="text-[10.5px] font-bold uppercase tracking-[0.28em] text-primary"
                    initial={{ opacity: 0, y: 8 }}
                    animate={{ opacity: 1, y: 0 }}
                    transition={{ duration: 0.4 }}
                  >
                    {slide.kicker}
                  </motion.p>

                  <h2 className="font-display font-black uppercase text-foreground mt-3 leading-[0.92] text-[clamp(38px,12vw,58px)]">
                    {slide.bigNumber !== undefined ? (
                      <motion.span
                        className="inline-block"
                        initial={{ opacity: 0, scale: 0.9 }}
                        animate={{ opacity: 1, scale: 1 }}
                        transition={{ type: 'spring', stiffness: 120, damping: 14 }}
                      >
                        <CountUp value={slide.bigNumber} suffix={slide.bigSuffix} />
                      </motion.span>
                    ) : (
                      <Kinetic text={slide.big} />
                    )}
                  </h2>

                  {slide.sub && (
                    <motion.p
                      className="text-[15px] text-muted-foreground mt-4 leading-relaxed max-w-[34ch]"
                      initial={{ opacity: 0, y: 10 }}
                      animate={{ opacity: 1, y: 0 }}
                      transition={{ delay: 0.32, duration: 0.5 }}
                    >
                      {slide.sub}
                    </motion.p>
                  )}
                  {slide.note && (
                    <motion.p
                      className="text-[11.5px] text-muted-foreground/70 mt-2"
                      initial={{ opacity: 0 }}
                      animate={{ opacity: 1 }}
                      transition={{ delay: 0.5 }}
                    >
                      {slide.note}
                    </motion.p>
                  )}

                  {slide.premium && (
                    <motion.button
                      onClick={() => { triggerHaptic('selection'); onClose(); navigate('/premium'); }}
                      className="relative z-30 mt-7 self-start inline-flex items-center gap-2 h-12 px-5 rounded-2xl bg-primary text-primary-foreground text-[13px] font-bold"
                      initial={{ opacity: 0, y: 14 }}
                      animate={{ opacity: 1, y: 0 }}
                      transition={{ delay: 0.55, type: 'spring', stiffness: 140, damping: 16 }}
                      whileTap={{ scale: 0.97 }}
                    >
                      <Crown className="w-4 h-4" /> See Premium <ChevronRight className="w-4 h-4" />
                    </motion.button>
                  )}
                </motion.div>
              </AnimatePresence>

              <p className="absolute bottom-4 inset-x-0 text-center text-[10.5px] uppercase tracking-[0.22em] text-muted-foreground/60">
                Tap to continue · Hold to pause
              </p>
            </div>
          )}
        </motion.div>
      )}
    </AnimatePresence>
  );

  // Rendered into <body>: Profile's animated containers create a transform
  // context, which would otherwise trap this `fixed` overlay inside the page.
  if (typeof document === 'undefined') return null;
  return createPortal(overlay, document.body);
};

export default RecapModal;
