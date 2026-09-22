/**
 * Memory Tape — every second the user saved, replayable as one reel.
 */
import { useMemo } from 'react';
import { motion } from 'framer-motion';
import { ArrowLeft, Play, Square, Trash2, Sparkles, Crown } from 'lucide-react';
import { useNavigate } from '@/lib/router-compat';
import { useMoments } from '@/hooks/useMoments';
import { useMemoryTape } from '@/hooks/useMemoryTape';
import { usePremium } from '@/hooks/usePremium';
import {
  formatMomentStamp,
  getFeeling,
  getTapeDurationSeconds,
  groupMomentsByMonth,
} from '@/lib/moments';
import { triggerHaptic } from '@/hooks/useHaptics';
import { Skeleton } from '@/components/ui/skeleton';
import OptimizedImage from '@/components/OptimizedImage';

const formatRuntime = (seconds: number) => {
  const mins = Math.round(seconds / 60);
  if (mins < 1) return `${seconds}s`;
  return `${mins} min`;
};

const Moments = () => {
  const navigate = useNavigate();
  const { moments, isLoading, error, remove } = useMoments();
  const { isPremium, isLoading: premiumLoading } = usePremium();
  const { isTapePlaying, currentMomentId, startTape, stopTape } = useMemoryTape();

  const groups = useMemo(() => groupMomentsByMonth(moments), [moments]);
  const runtime = useMemo(() => getTapeDurationSeconds(moments), [moments]);

  return (
    <div className="min-h-[100dvh] pb-36">
      <header className="sticky top-0 z-20 flex items-center gap-3 bg-background/85 px-5 py-4 backdrop-blur-xl">
        <button onClick={() => navigate(-1)} aria-label="Back" className="rounded-full bg-foreground/10 p-2">
          <ArrowLeft className="h-4 w-4" />
        </button>
        <h1 className="text-[17px] font-bold">Memory Tape</h1>
      </header>

      <div className="px-5">
        <div
          className="mb-6 rounded-3xl border border-primary/30 p-5"
          style={{
            background:
              'linear-gradient(150deg, hsl(var(--primary) / 0.22), hsl(var(--card)) 60%, hsl(var(--accent) / 0.16))',
          }}
        >
          <p className="mb-1 flex items-center gap-1.5 text-[10px] font-bold uppercase tracking-[0.2em] text-primary">
            <Sparkles className="h-3 w-3" /> Premium
          </p>
          <h2 className="text-[22px] font-bold leading-tight">Your seconds, back to back</h2>
          <p className="mt-1 text-[12.5px] text-muted-foreground">
            {moments.length
              ? `${moments.length} saved ${moments.length === 1 ? 'moment' : 'moments'} · about ${formatRuntime(runtime)} of tape`
              : 'While a song is playing, tap the sparkle button to save the exact second that hit.'}
          </p>

          {!premiumLoading && !isPremium ? (
            <button
              onClick={() => navigate('/premium')}
              className="mt-4 flex w-full items-center justify-center gap-2 rounded-full bg-primary py-3 text-[13.5px] font-bold text-primary-foreground active:scale-[0.98]"
            >
              <Crown className="h-4 w-4" /> Unlock Memory Tape
            </button>
          ) : (
            <button
              onClick={() => {
                triggerHaptic('selection');
                if (isTapePlaying) stopTape();
                else startTape(moments);
              }}
              disabled={!moments.length}
              className="mt-4 flex w-full items-center justify-center gap-2 rounded-full bg-primary py-3 text-[13.5px] font-bold text-primary-foreground active:scale-[0.98] disabled:opacity-50"
            >
              {isTapePlaying ? <Square className="h-4 w-4" /> : <Play className="h-4 w-4" />}
              {isTapePlaying ? 'Stop tape' : 'Play my tape'}
            </button>
          )}
        </div>

        {isLoading && (
          <div className="space-y-3">
            {[0, 1, 2].map((i) => <Skeleton key={i} className="h-20 w-full rounded-2xl" />)}
          </div>
        )}

        {!isLoading && error && (
          <p className="rounded-2xl border border-border bg-card p-4 text-[13px] text-muted-foreground">
            We couldn’t load your tape right now. Pull the page again in a moment.
          </p>
        )}

        {!isLoading && !error && !moments.length && (
          <div className="rounded-3xl border border-border bg-card p-6 text-center">
            <p className="text-[14px] font-semibold">No moments yet</p>
            <p className="mt-1 text-[12.5px] text-muted-foreground">
              Play something you love, then tap the sparkle in the player at the second that gives you goosebumps.
            </p>
          </div>
        )}

        {!isLoading && groups.map((group) => (
          <section key={group.key} className="mb-7">
            <h3 className="mb-3 text-[11px] font-bold uppercase tracking-[0.18em] text-muted-foreground">
              {group.label}
            </h3>
            <div className="space-y-2.5">
              {group.moments.map((moment) => {
                const feeling = getFeeling(moment.feeling);
                const active = currentMomentId === moment.id;
                return (
                  <motion.div
                    key={moment.id}
                    layout
                    className={`flex items-center gap-3 rounded-2xl border p-3 ${
                      active ? 'border-primary bg-primary/10' : 'border-border bg-card'
                    }`}
                  >
                    <button
                      onClick={() => {
                        triggerHaptic('selection');
                        const index = moments.findIndex((m) => m.id === moment.id);
                        startTape(moments, index < 0 ? 0 : index);
                      }}
                      className="relative h-12 w-12 flex-shrink-0 overflow-hidden rounded-xl bg-foreground/10"
                      aria-label={`Play ${moment.songTitle} from ${formatMomentStamp(moment.positionMs)}`}
                    >
                      {moment.coverUrl ? (
                        <OptimizedImage src={moment.coverUrl} alt="" className="h-full w-full object-cover" />
                      ) : (
                        <span className="flex h-full w-full items-center justify-center text-muted-foreground">♪</span>
                      )}
                      <span className="absolute inset-0 flex items-center justify-center bg-black/35">
                        <Play className="h-4 w-4 text-white" />
                      </span>
                    </button>

                    <div className="min-w-0 flex-1">
                      <p className="truncate text-[13.5px] font-semibold">{moment.songTitle}</p>
                      <p className="truncate text-[11.5px] text-muted-foreground">{moment.songArtist}</p>
                      <div className="mt-1 flex flex-wrap items-center gap-1.5">
                        <span className="rounded-full bg-foreground/10 px-2 py-0.5 text-[10px] font-semibold text-muted-foreground">
                          {formatMomentStamp(moment.positionMs)}
                        </span>
                        {feeling && (
                          <span className="rounded-full bg-primary/15 px-2 py-0.5 text-[10px] font-semibold text-primary">
                            {feeling.emoji} {feeling.label}
                          </span>
                        )}
                      </div>
                      {moment.note && (
                        <p className="mt-1 line-clamp-2 text-[11.5px] italic text-muted-foreground">“{moment.note}”</p>
                      )}
                    </div>

                    <button
                      onClick={() => { triggerHaptic('selection'); void remove(moment.id); }}
                      aria-label="Remove moment"
                      className="rounded-full p-2 text-muted-foreground active:scale-90"
                    >
                      <Trash2 className="h-4 w-4" />
                    </button>
                  </motion.div>
                );
              })}
            </div>
          </section>
        ))}
      </div>
    </div>
  );
};

export default Moments;
