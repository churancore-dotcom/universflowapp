import { useState, useEffect, memo, useCallback, useRef } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Crown, SkipForward, ArrowUpRight, Zap, Download, Waves, Sparkle } from 'lucide-react';
import { useNavigate } from '@/lib/router-compat';
import { usePremium } from '@/hooks/usePremium';
import { iosSpring } from '@/lib/animations';
import { loadAdCampaign, getAdCampaignSync, recordAdEvent, type AdCampaign } from '@/lib/adEngine';

interface PrerollAdProps {
  isOpen: boolean;
  onComplete: () => void;
  onSkip?: () => void;
  adType?: 'start' | 'end';
}

const PERKS = [
  { icon: Zap, label: 'Zero ads' },
  { icon: Download, label: 'Offline' },
  { icon: Waves, label: 'Studio EQ' },
  { icon: Sparkle, label: 'Lossless' },
];

const PrerollAd = memo(function PrerollAd({ isOpen, onComplete, onSkip }: PrerollAdProps) {
  const { isPremium, isLoading } = usePremium();
  const navigate = useNavigate();
  const [campaign, setCampaign] = useState<AdCampaign | null>(getAdCampaignSync());
  const [elapsed, setElapsed] = useState(0);
  const [entitlementTimedOut, setEntitlementTimedOut] = useState(false);
  const viewLoggedFor = useRef<string | null>(null);

  const duration = campaign?.duration_seconds ?? 8;
  const remaining = Math.max(0, duration - elapsed);
  const progress = Math.min(100, (elapsed / Math.max(1, duration)) * 100);
  const canSkip =
    !!campaign?.skippable && elapsed >= Math.max(0, campaign.skip_after_seconds ?? 0);
  const entitlementPending = isLoading && !entitlementTimedOut;

  useEffect(() => {
    if (!isOpen || !isLoading) {
      setEntitlementTimedOut(false);
      return;
    }
    const fallback = window.setTimeout(() => setEntitlementTimedOut(true), 1500);
    return () => window.clearTimeout(fallback);
  }, [isOpen, isLoading]);

  // Keep the campaign fresh whenever the break opens.
  useEffect(() => {
    if (!isOpen || isPremium) return;
    let alive = true;
    void loadAdCampaign(true).then((c) => {
      if (alive) setCampaign(c);
    });
    return () => {
      alive = false;
    };
  }, [isOpen, isPremium]);

  // Countdown + auto-dismiss.
  useEffect(() => {
    if (!isOpen) {
      setElapsed(0);
      return;
    }
    if (isPremium && !isLoading) {
      onComplete();
      return;
    }
    if (entitlementPending) return;
    const timer = window.setInterval(() => setElapsed((v) => v + 1), 1000);
    return () => window.clearInterval(timer);
  }, [isOpen, isPremium, isLoading, entitlementPending, onComplete]);

  useEffect(() => {
    if (!isOpen || !campaign || viewLoggedFor.current === campaign.id) return;
    viewLoggedFor.current = campaign.id;
    recordAdEvent(campaign.id, 'view');
  }, [isOpen, campaign]);

  useEffect(() => {
    if (!isOpen) {
      viewLoggedFor.current = null;
      return;
    }
    if (elapsed >= duration) {
      if (campaign) recordAdEvent(campaign.id, 'complete');
      onComplete();
    }
  }, [elapsed, duration, isOpen, campaign, onComplete]);

  const handleSkip = useCallback(() => {
    if (campaign) recordAdEvent(campaign.id, 'skip');
    (onSkip ?? onComplete)();
  }, [campaign, onSkip, onComplete]);

  const handleCta = useCallback(() => {
    const url = campaign?.cta_url || '/premium';
    if (campaign) recordAdEvent(campaign.id, 'click');
    (onSkip ?? onComplete)();
    if (/^https?:\/\//i.test(url)) {
      window.open(url, '_blank', 'noopener,noreferrer');
    } else {
      navigate(url.startsWith('/') ? url : `/${url}`);
    }
  }, [campaign, navigate, onSkip, onComplete]);

  if (isPremium || entitlementPending) return null;

  const isBrand = campaign?.kind === 'brand';
  const headline = campaign?.headline ?? 'Music without limits';
  const subtext =
    campaign?.subtext ??
    'Go Premium for ad-free listening, offline downloads and Studio Sound EQ.';
  const ctaLabel = campaign?.cta_label ?? 'Get Premium';

  return (
    <AnimatePresence>
      {isOpen && (
        <motion.div
          className="fixed inset-0 z-[100] flex items-end justify-center sm:items-center"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.25 }}
        >
          <div className="absolute inset-0 bg-background/90 backdrop-blur-2xl" />

          {/* Ambient glow */}
          <motion.div
            className="pointer-events-none absolute -top-24 left-1/2 h-72 w-72 -translate-x-1/2 rounded-full opacity-40 blur-3xl"
            style={{ background: 'radial-gradient(circle, hsl(var(--primary)) 0%, transparent 70%)' }}
            animate={{ scale: [1, 1.15, 1] }}
            transition={{ duration: 6, repeat: Infinity, ease: 'easeInOut' }}
          />

          <motion.div
            className="relative z-10 w-full max-w-[26rem] px-4 pb-6 sm:pb-0"
            initial={{ y: 40, opacity: 0, scale: 0.97 }}
            animate={{ y: 0, opacity: 1, scale: 1 }}
            exit={{ y: 30, opacity: 0, scale: 0.98 }}
            transition={iosSpring}
          >
            {/* Top bar: label + skip */}
            <div className="mb-3 flex items-center justify-between">
              <div className="flex items-center gap-2">
                <span className="rounded-full border border-border/60 bg-card/70 px-2.5 py-1 text-[10px] font-semibold uppercase tracking-[0.14em] text-muted-foreground">
                  {isBrand ? `Ad · ${campaign?.advertiser ?? 'Sponsored'}` : 'Univers Flow'}
                </span>
                <span className="text-[11px] font-medium tabular-nums text-muted-foreground">
                  {remaining}s
                </span>
              </div>

              {canSkip ? (
                <motion.button
                  onClick={handleSkip}
                  className="flex items-center gap-1.5 rounded-full border border-border/60 bg-card/70 px-3 py-1.5 text-[11px] font-semibold text-foreground"
                  initial={{ opacity: 0, x: 8 }}
                  animate={{ opacity: 1, x: 0 }}
                  whileTap={{ scale: 0.94 }}
                >
                  Skip ad
                  <SkipForward className="h-3.5 w-3.5" />
                </motion.button>
              ) : (
                <span className="text-[11px] text-muted-foreground/70">
                  {campaign?.skippable
                    ? `Skip in ${Math.max(0, (campaign.skip_after_seconds ?? 0) - elapsed)}s`
                    : 'Ad'}
                </span>
              )}
            </div>

            {/* Progress */}
            <div className="mb-4 h-[3px] overflow-hidden rounded-full bg-muted/40">
              <motion.div
                className="h-full rounded-full bg-gradient-to-r from-primary to-accent"
                animate={{ width: `${progress}%` }}
                transition={{ duration: 0.9, ease: 'linear' }}
              />
            </div>

            {/* Card */}
            <div className="overflow-hidden rounded-[28px] border border-border/60 bg-card/80 shadow-2xl backdrop-blur-xl">
              {campaign?.image_url ? (
                <div className="relative aspect-[16/10] w-full overflow-hidden">
                  <motion.img
                    src={campaign.image_url}
                    alt={isBrand ? `${campaign.advertiser ?? 'Sponsor'} advertisement` : headline}
                    className="h-full w-full object-cover"
                    initial={{ scale: 1.06 }}
                    animate={{ scale: 1 }}
                    transition={{ duration: duration, ease: 'linear' }}
                    loading="eager"
                  />
                  <div className="absolute inset-0 bg-gradient-to-t from-card via-card/20 to-transparent" />
                </div>
              ) : (
                <div className="relative flex aspect-[16/10] w-full items-center justify-center overflow-hidden bg-gradient-to-br from-primary/25 via-accent/15 to-transparent">
                  <motion.div
                    className="flex h-24 w-24 items-center justify-center rounded-3xl bg-gradient-to-br from-primary to-accent shadow-xl"
                    animate={{ y: [0, -8, 0] }}
                    transition={{ duration: 4, repeat: Infinity, ease: 'easeInOut' }}
                  >
                    <Crown className="h-11 w-11 text-primary-foreground" />
                  </motion.div>
                </div>
              )}

              <div className="p-5 pt-4">
                <h2 className="text-[22px] font-bold leading-tight tracking-tight text-foreground">
                  {headline}
                </h2>
                <p className="mt-2 text-sm leading-relaxed text-muted-foreground">{subtext}</p>

                {!isBrand && (
                  <div className="mt-4 grid grid-cols-2 gap-2">
                    {PERKS.map(({ icon: Icon, label }) => (
                      <div
                        key={label}
                        className="flex items-center gap-2 rounded-2xl border border-border/50 bg-background/40 px-3 py-2"
                      >
                        <Icon className="h-3.5 w-3.5 text-primary" />
                        <span className="text-xs font-medium text-foreground">{label}</span>
                      </div>
                    ))}
                  </div>
                )}

                <motion.button
                  onClick={handleCta}
                  className="relative mt-5 flex w-full items-center justify-center gap-2 overflow-hidden rounded-2xl bg-gradient-to-r from-primary to-accent py-3.5 text-[15px] font-bold text-primary-foreground"
                  whileTap={{ scale: 0.98 }}
                >
                  <motion.span
                    className="absolute inset-0 bg-gradient-to-r from-transparent via-white/25 to-transparent"
                    animate={{ x: ['-120%', '120%'] }}
                    transition={{ duration: 2.2, repeat: Infinity, repeatDelay: 0.8 }}
                  />
                  <span className="relative z-10">{ctaLabel}</span>
                  <ArrowUpRight className="relative z-10 h-4 w-4" />
                </motion.button>

                <p className="mt-3 text-center text-[11px] text-muted-foreground/70">
                  {isBrand
                    ? 'Premium removes all ads — including this one.'
                    : 'Your music resumes automatically.'}
                </p>
              </div>
            </div>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
});

export default PrerollAd;
