import { useEffect, useState } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import { Flame, Music2, CalendarHeart, ListMusic, Sparkles, Crown, X } from 'lucide-react';
import { useAuth } from '@/contexts/AuthContext';
import { usePremium } from '@/hooks/usePremium';
import { useNavigate } from '@/lib/router-compat';
import { supabase } from '@/integrations/supabase/client';
import { buildRecap, computeStreak, loadPlayRecords } from '@/lib/listeningInsights';
import {
  canShowPremiumMoment,
  markPremiumMomentShown,
  markSeen,
  nextMilestone,
  type Milestone,
} from '@/lib/milestones';
import { triggerHaptic } from '@/hooks/useHaptics';

const ICONS = {
  streak: Flame,
  plays: Music2,
  time: CalendarHeart,
  playlist: ListMusic,
  genre: Sparkles,
} as const;

/**
 * A single, earned celebration. Every number comes from real counters, each
 * milestone is celebrated once per listener, and the premium line only appears
 * after a genuine milestone — never on a timer.
 */
const MilestoneCelebration = () => {
  const { user } = useAuth();
  const { isPremium, loading: premiumLoading } = usePremium();
  const navigate = useNavigate();
  const [milestone, setMilestone] = useState<Milestone | null>(null);
  const [premiumLine, setPremiumLine] = useState<string | null>(null);

  useEffect(() => {
    if (!user || premiumLoading) return;
    let cancelled = false;
    const timer = window.setTimeout(async () => {
      try {
        const [records, playlistRes] = await Promise.all([
          loadPlayRecords(user.id),
          supabase.from('playlists').select('id', { count: 'exact', head: true }).eq('user_id', user.id),
        ]);
        if (cancelled || records.length === 0) return;

        const streak = computeStreak(records, user.id);
        const recap = buildRecap(records, user.id, 'month');
        const oldest = records[records.length - 1]?.at ?? Date.now();
        const monthsOnApp = Math.floor((Date.now() - oldest) / (30 * 86_400_000));

        const found = nextMilestone(user.id, {
          streak: streak.current,
          totalPlays: records.length,
          playlists: playlistRes.count || 0,
          topGenre: recap?.topGenre ?? null,
          monthsOnApp,
        });
        if (!found || cancelled) return;

        setMilestone(found);
        triggerHaptic('success');

        const minutes = recap?.minutes ?? null;
        if (!isPremium && minutes !== null && minutes >= 60 && canShowPremiumMoment(user.id, found.id)) {
          setPremiumLine(
            `You have listened for ${minutes.toLocaleString()} minutes this month. Imagine all of it in the highest quality, with nothing interrupting it.`,
          );
          markPremiumMomentShown(user.id, found.id);
        }
      } catch {
        /* enhancement only */
      }
    }, 4000); // let the app settle before celebrating anything

    return () => { cancelled = true; window.clearTimeout(timer); };
  }, [user, isPremium, premiumLoading]);

  const dismiss = () => {
    if (milestone) markSeen(user?.id, milestone.id);
    setMilestone(null);
    setPremiumLine(null);
  };

  const Icon = milestone ? ICONS[milestone.kind] : Sparkles;

  return (
    <AnimatePresence>
      {milestone && (
        <motion.div
          className="fixed inset-0 z-[215] flex items-end justify-center"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          onClick={dismiss}
          style={{ background: 'color-mix(in oklab, var(--background) 72%, transparent)', backdropFilter: 'blur(18px)' }}
        >
          <motion.div
            initial={{ y: '100%' }}
            animate={{ y: 0 }}
            exit={{ y: '100%' }}
            transition={{ type: 'spring', stiffness: 300, damping: 30 }}
            onClick={(e) => e.stopPropagation()}
            className="w-full max-w-md rounded-t-[28px] bg-card border-t border-border/50 p-6 pb-8"
          >
            <div className="flex items-start justify-between">
              <motion.div
                initial={{ scale: 0.5, rotate: -12 }}
                animate={{ scale: 1, rotate: 0 }}
                transition={{ type: 'spring', stiffness: 260, damping: 14 }}
                className="w-14 h-14 rounded-2xl bg-primary text-primary-foreground flex items-center justify-center"
              >
                <Icon className="w-7 h-7 fill-current" />
              </motion.div>
              <button onClick={dismiss} className="w-9 h-9 rounded-full bg-muted/40 flex items-center justify-center" aria-label="Dismiss">
                <X className="w-4 h-4" />
              </button>
            </div>

            <p className="font-display text-[44px] leading-[0.9] uppercase text-primary mt-5">{milestone.value}</p>
            <h3 className="font-display text-[24px] leading-tight uppercase text-foreground mt-2">{milestone.title}</h3>
            <p className="text-[13.5px] text-muted-foreground mt-2 leading-relaxed">{milestone.line}</p>

            {premiumLine && (
              <div className="mt-5 rounded-2xl border border-border/50 p-4">
                <p className="text-[13px] text-foreground leading-relaxed">{premiumLine}</p>
                <button
                  onClick={() => { markSeen(user?.id, milestone.id); setMilestone(null); navigate('/premium'); }}
                  className="mt-3 inline-flex items-center gap-2 h-11 px-4 rounded-xl bg-primary text-primary-foreground text-[12.5px] font-bold"
                >
                  <Crown className="w-4 h-4" /> Explore Premium
                </button>
              </div>
            )}

            <button
              onClick={dismiss}
              className="w-full h-12 mt-5 rounded-2xl bg-muted/50 text-foreground text-[13px] font-semibold"
            >
              Nice
            </button>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
};

export default MilestoneCelebration;
