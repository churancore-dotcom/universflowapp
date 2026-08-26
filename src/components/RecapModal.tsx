import { useEffect, useMemo, useRef, useState } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import { X, Share2, Loader2, Crown, ChevronRight } from 'lucide-react';
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

/**
 * "Your month in music" — built entirely from real play history. Slides whose
 * data is missing are simply not rendered; nothing is invented.
 */
const RecapModal = ({ isOpen, onClose, window: recapWindow = 'month' }: Props) => {
  const { user } = useAuth();
  const { isPremium } = usePremium();
  const navigate = useNavigate();
  const [loading, setLoading] = useState(true);
  const [recap, setRecap] = useState<RecapSlideData | null>(null);
  const [index, setIndex] = useState(0);
  const trackRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!isOpen) return;
    setLoading(true);
    setIndex(0);
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

  const slides = useMemo(() => {
    if (!recap) return [] as { key: string; kicker: string; big: string; sub?: string; note?: string; cover?: string | null; premium?: boolean }[];
    const out: { key: string; kicker: string; big: string; sub?: string; note?: string; cover?: string | null; premium?: boolean }[] = [];

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
        sub: `That is about ${Math.max(1, Math.round(recap.minutes / 60))} hour${Math.round(recap.minutes / 60) === 1 ? '' : 's'} of music.`,
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
        sub: `You spent ${fmt(recap.minutes)} minutes here ${recap.window === 'month' ? 'this month' : 'this year'}. Imagine all of it in the highest quality, with no ads in between.`,
        premium: true,
      });

    return out;
  }, [recap, isPremium]);

  const onScroll = () => {
    const el = trackRef.current;
    if (!el) return;
    setIndex(Math.round(el.scrollLeft / el.clientWidth));
  };

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

  return (
    <AnimatePresence>
      {isOpen && (
        <motion.div
          className="fixed inset-0 z-[220] bg-background flex flex-col"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
        >
          <div className="flex items-center justify-between px-5 pt-5 pb-3">
            <button onClick={onClose} className="w-10 h-10 rounded-full bg-muted/40 flex items-center justify-center" aria-label="Close recap">
              <X className="w-4 h-4" />
            </button>
            <div className="flex gap-1.5">
              {slides.map((s, i) => (
                <span
                  key={s.key}
                  className={`h-1 rounded-full transition-all ${i === index ? 'w-6 bg-primary' : 'w-2 bg-muted'}`}
                />
              ))}
            </div>
            <button onClick={share} disabled={!recap} className="w-10 h-10 rounded-full bg-muted/40 flex items-center justify-center disabled:opacity-40" aria-label="Share recap">
              <Share2 className="w-4 h-4" />
            </button>
          </div>

          {loading ? (
            <div className="flex-1 flex items-center justify-center">
              <Loader2 className="w-6 h-6 animate-spin text-muted-foreground" />
            </div>
          ) : !recap ? (
            <div className="flex-1 flex flex-col items-center justify-center px-10 text-center">
              <h2 className="font-display text-[28px] uppercase leading-tight">No recap yet</h2>
              <p className="text-[13px] text-muted-foreground mt-2">
                Play a few songs and your recap builds itself from your real listening — nothing made up.
              </p>
            </div>
          ) : (
            <div
              ref={trackRef}
              onScroll={onScroll}
              className="flex-1 flex overflow-x-auto snap-x snap-mandatory hide-scrollbar"
            >
              {slides.map((slide) => (
                <div key={slide.key} className="w-full shrink-0 snap-center px-6 pb-10">
                  <div
                    className="relative w-full h-full rounded-[28px] overflow-hidden border border-border/50 flex flex-col justify-end p-6"
                    style={{
                      background:
                        'linear-gradient(160deg, color-mix(in oklab, var(--primary) 26%, transparent), color-mix(in oklab, var(--primary) 6%, transparent))',
                    }}
                  >
                    {slide.cover && (
                      <img
                        src={slide.cover}
                        alt=""
                        className="absolute inset-0 w-full h-full object-cover opacity-25"
                        loading="lazy"
                      />
                    )}
                    <div className="absolute inset-0 bg-gradient-to-t from-background/90 via-background/40 to-transparent" />
                    <div className="relative">
                      <p className="text-[10.5px] font-bold uppercase tracking-[0.24em] text-primary">{slide.kicker}</p>
                      <h2 className="font-display text-[40px] leading-[0.95] uppercase text-foreground mt-3">
                        {slide.big}
                      </h2>
                      {slide.sub && (
                        <p className="text-[14px] text-muted-foreground mt-3 leading-relaxed">{slide.sub}</p>
                      )}
                      {slide.note && (
                        <p className="text-[11.5px] text-muted-foreground/70 mt-2">{slide.note}</p>
                      )}
                      {slide.premium && (
                        <button
                          onClick={() => { triggerHaptic('selection'); onClose(); navigate('/premium'); }}
                          className="mt-6 inline-flex items-center gap-2 h-12 px-5 rounded-2xl bg-primary text-primary-foreground text-[13px] font-bold"
                        >
                          <Crown className="w-4 h-4" /> See Premium <ChevronRight className="w-4 h-4" />
                        </button>
                      )}
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </motion.div>
      )}
    </AnimatePresence>
  );
};

export default RecapModal;
