import { memo, useState, useCallback, useEffect, useRef } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import {
  ChevronLeft, Crown, Check, Disc3, Download,
  Zap, Copy, Loader2, ShieldCheck, Sliders, Music2, Infinity as InfinityIcon, Clock,
  Moon, Orbit, Building2, Headphones,
} from 'lucide-react';
import { useNavigate } from '@/lib/router-compat';
import BottomNav from '@/components/BottomNav';
import PageTransition from '@/components/PageTransition';
import { iosSpring, iosBounce } from '@/lib/animations';
import { usePremium } from '@/hooks/usePremium';
import { useHaptics } from '@/hooks/useHaptics';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/contexts/AuthContext';
import { useEmailVerified } from '@/hooks/useEmailVerified';
import { toast } from '@/hooks/use-toast';
import SEOHead from '@/components/SEOHead';
import appLogo from '@/assets/app-logo.webp';


const LogoBadge = ({ size = 56 }: { size?: number }) => (
  <div
    className="mx-auto rounded-full flex items-center justify-center overflow-hidden"
    style={{
      width: size,
      height: size,
      background: 'linear-gradient(135deg, hsl(var(--primary) / 0.22), hsl(var(--accent) / 0.16))',
      border: '0.5px solid hsl(var(--primary) / 0.4)',
      boxShadow: '0 10px 30px -10px hsl(var(--primary) / 0.5)',
    }}
  >
    <img src={appLogo} alt="Universflow app logo" className="w-[68%] h-[68%] object-contain" />
  </div>
);

type PlanId = 'monthly' | 'bimonthly' | 'quarterly';

interface UpiSettings {
  monthlyPrice: number;
  bimonthlyPrice: number;
  quarterlyPrice: number;
  upiId: string;
  payeeName: string;
}

const PLAN_LABEL: Record<PlanId, string> = {
  monthly: '1 Month',
  bimonthly: '2 Months',
  quarterly: '3 Months',
};

interface Feature {
  icon: typeof Zap;
  title: string;
  desc: string;
  long: string;
  isNew?: boolean;
}

const FEATURES: Feature[] = [
  { icon: InfinityIcon, title: 'Smart Crossfade + Gapless Pro', desc: 'DJ-grade equal-power curves and zero-gap track swaps.', isNew: true,
    long: 'Choose between linear, equal-power, smooth, and exponential crossfade curves — the same math used in DJ software. Gapless Pro overlaps two decoded tracks so albums and live mixes play with literally zero silence between songs.' },
  { icon: Headphones, title: 'Headphone 3D Surround', desc: 'Binaural crossfeed lifts sound out of your head.', isNew: true,
    long: 'Lightweight binaural crossfeed reduces the harsh hard-panned-to-one-ear effect that flat stereo creates on headphones, placing instruments in a wider, more natural space — exactly like good studio monitors.' },
  { icon: Building2, title: 'Studio Spaces', desc: 'Vinyl Booth, Cathedral, Stadium — pick your room.', isNew: true,
    long: 'Six convolution-modelled rooms — Vinyl Booth, Jazz Club, Concert Hall, Cathedral, Stadium, and Off. Each adds the natural reflections and decay of a real space without smearing detail.' },
  { icon: Moon, title: 'Late Night Mode', desc: 'Whispered details lifted, loud peaks tamed.', isNew: true,
    long: 'A gentle dynamic range compressor pulls quiet vocals and details up while pushing loud peaks down, so you can listen at low volume without missing anything — perfect at 1 AM with someone asleep next to you.' },
  { icon: Zap, title: 'Zero Ads', desc: 'No pre-rolls, no banners. Music, uninterrupted.',
    long: 'Every ad surface is removed — no pre-roll audio ads, no banner ads, no interstitials, no skip-counter limits. The app is just music, from open to close.' },
  { icon: Orbit, title: 'Spatial 3D Audio', desc: 'Cinema-grade surround that orbits around your head.',
    long: 'A psycho-acoustic panner moves instruments around a virtual sphere around your head. Works on any pair of headphones and feels closest to a real cinema mix on tracks with rich stereo separation.' },
  { icon: Sliders, title: '8-Band Studio EQ', desc: 'Studio-grade tuning with crafted presets.',
    long: 'Eight-band parametric EQ with hand-tuned presets for bass, vocal, hip-hop, classical, podcast, and more. Build and save your own profile that follows you across devices.' },
  { icon: Download, title: 'Unlimited Downloads', desc: 'Save anything. Listen offline. Anywhere.',
    long: 'Download any track, album, or playlist to your phone for offline listening — no caps, no expiry while your subscription is active. Files stay in app-private storage so they\u2019re safe from other apps.' },
  { icon: Music2, title: 'Mood Playlists', desc: 'Mood-matched playlists, made instantly.',
    long: 'Auto-built playlists tuned to your mood and recent listening — focus, late drive, sunrise, sad-girl-hours and more. Refresh anytime; each generation is unique to your taste.' },
  { icon: Disc3, title: 'Premium-Only Tracks', desc: 'Early drops and exclusive releases.',
    long: 'A growing shelf of early releases and exclusives from independent artists on Universflow — heard here days or weeks before they go wide.' },
  { icon: ShieldCheck, title: 'Priority Support', desc: 'Skip the line — we answer first.',
    long: 'Your support tickets, bug reports and refund requests jump to the top of our queue. We aim to reply within a few hours, not days.' },
];

interface PendingPayment {
  id: string;
  utr_number: string;
  amount_paise: number;
  plan: string;
  created_at: string;
}

const PremiumPage = memo(function PremiumPage() {
  const navigate = useNavigate();
  const { isPremium, subscription, refetch: refetchPremium } = usePremium();
  const { user } = useAuth();
  const haptics = useHaptics();
  const [showCheckout, setShowCheckout] = useState(false);
  const [selectedPlan, setSelectedPlan] = useState<PlanId>('bimonthly');
  const [settings, setSettings] = useState<UpiSettings | null>(null);
  const [pending, setPending] = useState<PendingPayment | null>(null);
  const [openFeature, setOpenFeature] = useState<Feature | null>(null);
  const pendingBannerRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    (async () => {
      const { data } = await supabase
        .from('app_settings')
        .select('key, value')
        .in('key', ['premium_price_monthly_inr', 'premium_price_bimonthly_inr', 'premium_price_quarterly_inr', 'upi_id', 'upi_payee_name']);
      const map: Record<string, any> = {};
      data?.forEach(r => {
        try { map[r.key] = typeof r.value === 'string' ? JSON.parse(r.value) : r.value; }
        catch { map[r.key] = r.value; }
      });
      const FALLBACK_UPI = 'shashankyadav12367@okhdfcbank';
      const rawUpi = String(map.upi_id ?? '').trim();
      setSettings({
        monthlyPrice: Number(map.premium_price_monthly_inr ?? 99),
        bimonthlyPrice: Number(map.premium_price_bimonthly_inr ?? 199),
        quarterlyPrice: Number(map.premium_price_quarterly_inr ?? 280),
        upiId: rawUpi && !/yourupi|example|@okaxis$/i.test(rawUpi) ? rawUpi : FALLBACK_UPI,
        payeeName: String(map.upi_payee_name ?? 'Universflow') || 'Universflow',
      });
    })();
  }, []);

  useEffect(() => {
    if (!user || isPremium) { setPending(null); return; }
    let cancelled = false;
    const fetchPending = async () => {
      const { data } = await supabase
        .from('payment_requests')
        .select('id, utr_number, amount_paise, plan, created_at')
        .eq('user_id', user.id)
        .eq('status', 'pending')
        .order('created_at', { ascending: false })
        .limit(1)
        .maybeSingle();
      if (!cancelled) setPending(data ?? null);
    };
    fetchPending();

    const prChannel = supabase
      .channel(`user-pr-${user.id}-${Math.random().toString(36).slice(2, 8)}`)
      .on('postgres_changes', {
        event: '*', schema: 'public', table: 'payment_requests',
        filter: `user_id=eq.${user.id}`,
      }, () => { fetchPending(); refetchPremium(); })
      .subscribe();

    const subChannel = supabase
      .channel(`user-sub-${user.id}-${Math.random().toString(36).slice(2, 8)}`)
      .on('postgres_changes', {
        event: '*', schema: 'public', table: 'user_subscriptions',
        filter: `user_id=eq.${user.id}`,
      }, () => { refetchPremium(); fetchPending(); })
      .subscribe();

    return () => {
      cancelled = true;
      supabase.removeChannel(prChannel);
      supabase.removeChannel(subChannel);
    };
  }, [user, isPremium, refetchPremium]);

  const monthly = settings?.monthlyPrice ?? 99;
  const bimonthly = settings?.bimonthlyPrice ?? 199;
  const quarterly = settings?.quarterlyPrice ?? 280;
  const bimonthlyPerMo = (bimonthly / 2).toFixed(0);
  const quarterlyPerMo = (quarterly / 3).toFixed(0);
  const bimonthlySave = Math.max(0, Math.round((1 - (bimonthly / 2) / monthly) * 100));
  const quarterlySave = Math.max(0, Math.round((1 - (quarterly / 3) / monthly) * 100));
  const selectedPrice = selectedPlan === 'quarterly' ? quarterly : selectedPlan === 'bimonthly' ? bimonthly : monthly;

  const handleUpgrade = useCallback(() => {
    haptics.medium();
    setShowCheckout(true);
  }, [haptics]);

  const handlePaymentSubmitted = useCallback((payment: PendingPayment) => {
    setPending(payment);
    setShowCheckout(false);
    window.setTimeout(() => {
      pendingBannerRef.current?.scrollIntoView({ behavior: 'smooth', block: 'center' });
    }, 80);
  }, []);

  const expiryText = subscription?.expires_at
    ? new Date(subscription.expires_at).toLocaleDateString(undefined, { day: 'numeric', month: 'long', year: 'numeric' })
    : null;

  return (
    <PageTransition>
      <SEOHead
        title="Univers Flow Premium — Ad-Free Music & Spatial Audio"
        description="Upgrade to Univers Flow Premium for zero ads, spatial 3D audio, studio EQ, unlimited downloads and exclusive tracks."
        keywords="Univers Flow Premium, premium music, ad-free streaming, spatial audio, music download"
        path="/premium"
        jsonLdId="premium-jsonld"
        jsonLd={[
          {
            '@context': 'https://schema.org',
            '@type': 'Product',
            name: 'Univers Flow Premium',
            description: 'Ad-free streaming, spatial audio, studio EQ, and unlimited offline downloads.',
            brand: { '@type': 'Brand', name: 'Univers Flow' },
            offers: {
              '@type': 'Offer',
              priceCurrency: 'INR',
              price: '199',
              url: 'https://universflow.in/premium',
              availability: 'https://schema.org/InStock',
            },
          },
          {
            '@context': 'https://schema.org',
            '@type': 'BreadcrumbList',
            itemListElement: [
              { '@type': 'ListItem', position: 1, name: 'Home', item: 'https://universflow.in/' },
              { '@type': 'ListItem', position: 2, name: 'Premium', item: 'https://universflow.in/premium' },
            ],
          },
        ]}
      />
      <motion.div
        className="ethereal-page min-h-dvh pb-44 relative overflow-hidden text-foreground"
        initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ duration: 0.25 }}
      >
        {/* Static rose glow — anchored top, single blur, perf-safe */}
        <div className="absolute inset-x-0 top-0 h-[420px] pointer-events-none overflow-hidden">
          <div
            className="absolute -top-40 left-1/2 -translate-x-1/2 w-[680px] h-[680px] rounded-full opacity-[0.35]"
            style={{
              background: 'radial-gradient(circle, hsl(var(--primary)) 0%, transparent 60%)',
              filter: 'blur(90px)',
            }}
          />
          <div
            className="absolute inset-0"
            style={{
              background: 'linear-gradient(to bottom, transparent 60%, hsl(var(--background)) 100%)',
            }}
          />
        </div>

        {/* Header */}
        <motion.header
          className="sticky top-0 z-30 px-2 pt-4 pb-3 flex items-center justify-between"
          style={{
            background: 'hsl(var(--background) / 0.7)',
            backdropFilter: 'blur(28px) saturate(180%)',
            WebkitBackdropFilter: 'blur(28px) saturate(180%)',
            paddingTop: 'max(16px, env(safe-area-inset-top))',
            borderBottom: '0.5px solid hsl(var(--border) / 0.4)',
          }}
          initial={{ opacity: 0, y: -16 }} animate={{ opacity: 1, y: 0 }} transition={iosSpring}
        >
          <motion.button
            onClick={() => { haptics.light(); navigate(-1); }}
            className="flex items-center gap-1 px-2 py-2 -ml-1 text-primary"
            whileTap={{ scale: 0.94, opacity: 0.7 }} transition={iosBounce}
          >
            <ChevronLeft className="w-5 h-5" />
            <span className="text-[15px] font-medium">Back</span>
          </motion.button>
          <span className="text-[15px] font-semibold">Premium</span>
          <div className="w-[60px]" />
        </motion.header>

        <main className="relative px-5">
          {/* ─── HERO — editorial, calm ─── */}
          <section className="pt-10 pb-8">
            <div className="mb-5"><LogoBadge size={64} /></div>
            <p className="text-[10.5px] font-bold tracking-[0.32em] uppercase text-primary mb-3">
              Subscription
            </p>
            <h1 className="text-[36px] leading-[1.04] font-bold tracking-tight mb-3">
              Universflow <span className="text-primary">Premium</span>
            </h1>
            <p className="text-[15px] leading-snug text-muted-foreground max-w-[340px]">
              Spatial audio, studio EQ, and zero ads — music the way it's meant to sound.
            </p>
          </section>

          {/* Active premium banner */}
          {isPremium && (
            <motion.section
              initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }}
              transition={iosSpring}
              className="rounded-3xl p-7 text-center mb-8 relative overflow-hidden"
              style={{
                background: 'linear-gradient(135deg, hsl(var(--primary) / 0.18), hsl(var(--primary) / 0.04))',
                border: '0.5px solid hsl(var(--primary) / 0.4)',
              }}
            >
              <div className="mb-3"><LogoBadge size={56} /></div>
              <p className="text-[22px] font-bold mb-1">You're Premium</p>
              {expiryText && (
                <p className="text-[12px] tracking-[0.12em] uppercase text-muted-foreground">
                  Active until {expiryText}
                </p>
              )}
              <button
                onClick={handleUpgrade}
                className="mt-5 inline-flex items-center gap-2 px-5 py-2.5 rounded-full text-[13px] font-semibold bg-primary text-primary-foreground"
              >
                Extend membership
              </button>
            </motion.section>
          )}

          {/* Pending payment */}
          {!isPremium && pending && (
            <div ref={pendingBannerRef} className="mb-8">
              <PendingProgressBanner pending={pending} />
            </div>
          )}

          {/* ─── PLAN PICKER — Apple Music-style horizontal cards ─── */}
          {!isPremium && !pending && (
            <motion.section
              initial={{ opacity: 0, y: 16 }} animate={{ opacity: 1, y: 0 }}
              transition={{ ...iosSpring, delay: 0.05 }}
              className="mb-10"
            >
              <h2 className="text-[20px] font-bold mb-4 px-1">Choose your plan</h2>
              <div className="space-y-2.5">
                <PlanCard
                  selected={selectedPlan === 'bimonthly'}
                  onSelect={() => { haptics.light(); setSelectedPlan('bimonthly'); }}
                  badge={`Save ${bimonthlySave}%`}
                  title="2 Months"
                  price={bimonthly}
                  perMonth={`₹${bimonthlyPerMo}/mo`}
                  tagline="Most popular"
                  recommended
                />
                <PlanCard
                  selected={selectedPlan === 'quarterly'}
                  onSelect={() => { haptics.light(); setSelectedPlan('quarterly'); }}
                  badge={`Save ${quarterlySave}%`}
                  title="3 Months"
                  price={quarterly}
                  perMonth={`₹${quarterlyPerMo}/mo`}
                  tagline="Best value"
                />
                <PlanCard
                  selected={selectedPlan === 'monthly'}
                  onSelect={() => { haptics.light(); setSelectedPlan('monthly'); }}
                  title="Monthly"
                  price={monthly}
                  perMonth="30 days"
                  tagline="Try it out"
                />
              </div>
            </motion.section>
          )}

          {/* ─── FEATURES — clean rows, no fluff ─── */}
          <section className="mb-10">
            <h2 className="text-[20px] font-bold mb-4 px-1">What you get</h2>
            <div
              className="rounded-3xl overflow-hidden"
              style={{
                background: 'hsl(var(--card) / 0.6)',
                border: '0.5px solid hsl(var(--border) / 0.5)',
              }}
            >
              {FEATURES.map((f, i) => {
                const Icon = f.icon;
                return (
                  <button
                    key={f.title}
                    onClick={() => { haptics.light(); setOpenFeature(f); }}
                    className="w-full text-left flex items-start gap-3.5 px-4 py-4 active:bg-primary/5 transition-colors"
                    style={i > 0 ? { borderTop: '0.5px solid hsl(var(--border) / 0.4)' } : undefined}
                  >
                    <div
                      className="w-10 h-10 rounded-xl flex items-center justify-center shrink-0"
                      style={{ background: 'hsl(var(--primary) / 0.12)' }}
                    >
                      <Icon className="w-5 h-5 text-primary" strokeWidth={2} />
                    </div>
                    <div className="flex-1 min-w-0 pt-0.5">
                      <div className="flex items-center gap-2 mb-0.5 flex-wrap">
                        <p className="text-[15px] font-semibold leading-tight">{f.title}</p>
                        {f.isNew && (
                          <span
                            className="text-[9px] font-bold tracking-[0.12em] uppercase px-1.5 py-0.5 rounded"
                            style={{ background: 'hsl(var(--primary-strong))', color: 'hsl(var(--primary-foreground))' }}
                          >
                            New
                          </span>
                        )}
                      </div>
                      <p className="text-[12.5px] text-muted-foreground leading-snug">{f.desc}</p>
                    </div>
                    <ChevronLeft className="w-4 h-4 text-muted-foreground/60 shrink-0 rotate-180 mt-3" />
                  </button>
                );
              })}
            </div>
          </section>

          {/* Trust strip */}
          <div className="flex items-center justify-center gap-3 text-[11px] text-muted-foreground mb-8">
            <span className="inline-flex items-center gap-1"><ShieldCheck className="w-3.5 h-3.5 text-primary" /> UPI Secure</span>
            <span className="w-1 h-1 rounded-full bg-muted-foreground/40" />
            <span>Activates in minutes</span>
          </div>

        </main>

        {/* ─── Sticky bottom CTA ─── */}
        {!isPremium && !pending && settings && (
          <motion.div
            initial={{ y: 80, opacity: 0 }} animate={{ y: 0, opacity: 1 }}
            transition={{ ...iosSpring, delay: 0.15 }}
            role="region"
            aria-label="Selected plan checkout"
            className="fixed bottom-[68px] left-0 right-0 z-40 px-4 pb-2 pointer-events-none"
            style={{ paddingBottom: 'max(8px, env(safe-area-inset-bottom))' }}
          >
            <div
              className="max-w-md mx-auto rounded-3xl p-3 pl-5 pointer-events-auto flex items-center gap-3"
              style={{
                background: 'hsl(var(--background) / 0.85)',
                border: '0.5px solid hsl(var(--border))',
                backdropFilter: 'blur(28px) saturate(180%)',
                WebkitBackdropFilter: 'blur(28px) saturate(180%)',
                boxShadow: '0 -10px 40px -10px rgba(0,0,0,0.5)',
              }}
            >
              <div className="min-w-0 flex-1">
                <p className="text-[10px] uppercase tracking-[0.18em] text-muted-foreground font-semibold">
                  {PLAN_LABEL[selectedPlan]}
                </p>
                <p className="text-[22px] font-bold leading-tight tracking-tight">
                  ₹{selectedPrice}
                </p>
              </div>
              <motion.button
                onClick={handleUpgrade}
                whileTap={{ scale: 0.96 }}
                className="px-6 py-3.5 rounded-xl text-[15px] font-bold bg-primary text-primary-foreground flex items-center gap-2"
                style={{ boxShadow: '0 10px 30px -8px hsl(var(--primary) / 0.5)' }}
              >
                Subscribe
              </motion.button>
            </div>
          </motion.div>
        )}

        <BottomNav />

        <AnimatePresence>
          {showCheckout && settings && (
            <UpiCheckoutSheet
              settings={settings}
              plan={selectedPlan}
              onClose={() => setShowCheckout(false)}
              onSubmitted={handlePaymentSubmitted}
            />
          )}
          {openFeature && (
            <FeatureDetailSheet
              feature={openFeature}
              onClose={() => setOpenFeature(null)}
            />
          )}
        </AnimatePresence>
      </motion.div>
    </PageTransition>
  );
});

// ─────────── Plan card ───────────

interface PlanCardProps {
  selected: boolean;
  onSelect: () => void;
  title: string;
  price: number;
  perMonth: string;
  tagline: string;
  badge?: string;
  recommended?: boolean;
}

const PlanCard = memo(function PlanCard({
  selected, onSelect, title, price, perMonth, tagline, badge, recommended,
}: PlanCardProps) {
  return (
    <motion.button
      onClick={onSelect}
      whileTap={{ scale: 0.99 }}
      className="w-full text-left rounded-3xl px-4 py-4 flex items-center gap-4 relative transition-colors"
      style={{
        background: selected ? 'hsl(var(--primary) / 0.1)' : 'hsl(var(--card) / 0.6)',
        border: selected
          ? '1.5px solid hsl(var(--primary))'
          : '0.5px solid hsl(var(--border) / 0.6)',
        boxShadow: selected ? '0 8px 28px -10px hsl(var(--primary) / 0.4)' : 'none',
      }}
    >
      {recommended && (
        <div
          className="absolute -top-2 right-4 px-2 py-0.5 rounded-full text-[9px] tracking-[0.15em] uppercase z-10 bg-primary-strong text-primary-foreground font-bold"
        >
          Popular
        </div>
      )}

      {/* Radio */}
      <div
        className="w-5 h-5 rounded-full flex items-center justify-center shrink-0"
        style={{
          border: selected ? 'none' : '1.5px solid hsl(var(--border))',
          background: selected ? 'hsl(var(--primary))' : 'transparent',
        }}
      >
        {selected && <Check className="w-3 h-3 text-primary-foreground" strokeWidth={3.5} />}
      </div>

      {/* Title block */}
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2 flex-wrap">
          <p className="text-[16px] font-bold leading-none">{title}</p>
          {badge && (
            <span
              className="text-[9.5px] tracking-[0.1em] uppercase px-1.5 py-0.5 rounded font-bold"
              style={{
                background: 'hsl(var(--primary) / 0.15)',
                color: 'hsl(var(--primary))',
              }}
            >
              {badge}
            </span>
          )}
        </div>
        <p className="text-[11.5px] text-muted-foreground mt-1">{tagline}</p>
      </div>

      {/* Price */}
      <div className="text-right shrink-0">
        <p className="text-[20px] font-bold leading-none tracking-tight">₹{price}</p>
        <p className="text-[10px] mt-1 text-muted-foreground">{perMonth}</p>
      </div>
    </motion.button>
  );
});

// ─────────── UPI Checkout Sheet ───────────

interface CheckoutProps {
  settings: UpiSettings;
  plan: PlanId;
  onClose: () => void;
  onSubmitted: (payment: PendingPayment) => void;
}

type Step = 'pay' | 'confirm';

const UpiCheckoutSheet = memo(function UpiCheckoutSheet({ settings, plan, onClose, onSubmitted }: CheckoutProps) {
  const haptics = useHaptics();
  const { user } = useAuth();
  const { requireVerified } = useEmailVerified();
  const [step, setStep] = useState<Step>('pay');
  const [utr, setUtr] = useState('');
  const [submitting, setSubmitting] = useState(false);

  const basePrice = plan === 'quarterly' ? settings.quarterlyPrice : plan === 'bimonthly' ? settings.bimonthlyPrice : settings.monthlyPrice;
  const planLabel = PLAN_LABEL[plan];

  // Unique paise per user (1–99) for auto-matching
  const userPaise = user?.id
    ? (parseInt(user.id.replace(/[^0-9]/g, '').slice(-2) || '7', 10) % 99) + 1
    : 7;
  const amountFinal = `${basePrice}.${String(userPaise).padStart(2, '0')}`;
  const amountPaise = basePrice * 100 + userPaise;

  const upiUrl = `upi://pay?pa=${encodeURIComponent(settings.upiId)}&pn=${encodeURIComponent(settings.payeeName)}&am=${amountFinal}&cu=INR&tn=${encodeURIComponent(`Premium-${plan}-${user?.id?.slice(0, 8) ?? ''}`)}`;

  const copyUpi = () => { navigator.clipboard.writeText(settings.upiId); haptics.light(); toast({ title: 'UPI ID copied' }); };
  const copyAmount = () => { navigator.clipboard.writeText(amountFinal); haptics.light(); toast({ title: 'Amount copied' }); };
  const openUpiApp = () => { haptics.medium(); window.location.href = upiUrl; };

  const submitUtr = async () => {
    if (!user) { toast({ title: 'Please sign in first', variant: 'destructive' }); return; }
    if (!requireVerified('submit a payment')) return;
    const cleanUtr = utr.replace(/\D/g, '');
    if (cleanUtr.length !== 12) { toast({ title: 'UTR must be exactly 12 digits', variant: 'destructive' }); return; }
    setSubmitting(true);
    try {
      // Block re-submitting if a pending request already exists for this user
      const { data: existing } = await supabase
        .from('payment_requests')
        .select('id, utr_number, amount_paise, plan, created_at')
        .eq('user_id', user.id)
        .eq('status', 'pending')
        .limit(1)
        .maybeSingle();
      if (existing) {
        toast({ title: 'A payment is already being verified', description: 'Please wait for it to complete.', variant: 'destructive' });
        setSubmitting(false);
        onSubmitted(existing as PendingPayment);
        return;
      }
      const { data, error } = await supabase.from('payment_requests').insert({
        user_id: user.id,
        amount_paise: amountPaise,
        utr_number: cleanUtr,
        status: 'pending',
        plan,
      }).select('id, utr_number, amount_paise, plan, created_at').single();
      if (error) {
        if (error.code === '23505') toast({ title: 'This UTR was already submitted', variant: 'destructive' });
        else toast({ title: 'Submission failed', description: error.message, variant: 'destructive' });
        setSubmitting(false); return;
      }
      haptics.success();
      // Push the freshly-created request into parent state immediately — no refresh/realtime wait.
      if (data) onSubmitted(data as PendingPayment);
      // Fire-and-forget Telegram notification
      supabase.functions.invoke('telegram-notify', {
        body: {
          event: 'payment_submitted',
          email: user.email,
          user_id: user.id,
          plan,
          amount_inr: Math.round(amountPaise / 100),
          utr: cleanUtr,
        },
      }).catch(() => {});
    } catch {
      toast({ title: 'Something went wrong', variant: 'destructive' });
    } finally { setSubmitting(false); }
  };




  return (
    <motion.div
      initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
      className="fixed inset-0 z-[100] flex items-end justify-center bg-black/70"
      onClick={onClose}
    >
      <motion.div
        initial={{ y: '100%' }} animate={{ y: 0 }} exit={{ y: '100%' }}
        transition={iosSpring}
        onClick={e => e.stopPropagation()}
        className="w-full max-w-md rounded-t-3xl p-6 pb-10 max-h-[92vh] overflow-y-auto"
        style={{
          background: 'linear-gradient(180deg, hsl(var(--card)), hsl(var(--background)))',
          border: '0.5px solid hsl(var(--border))',
        }}
      >
        <div className="w-12 h-1 rounded-full bg-muted mx-auto mb-5" />

        {step === 'pay' && (
          <>
            <div className="text-center mb-5">
              <div className="mb-3"><LogoBadge size={56} /></div>
              <p className="text-[11px] uppercase tracking-widest text-muted-foreground mb-1">{planLabel} · Premium</p>
              <h3 className="text-[22px] font-bold">Pay ₹{amountFinal}</h3>
              <p className="text-[12px] text-muted-foreground mt-1">
                Unique amount helps us auto-match your payment
              </p>
            </div>

            <div
              className="rounded-3xl p-5 mb-3 text-center"
              style={{
                background: 'linear-gradient(135deg, hsl(var(--primary) / 0.18), hsl(var(--accent) / 0.12))',
                border: '0.5px solid hsl(var(--primary) / 0.3)',
              }}
            >
              <p className="text-[11px] tracking-widest uppercase text-muted-foreground mb-1">Amount</p>
              <button onClick={copyAmount} className="inline-flex items-center gap-2 group">
                <span className="text-[36px] font-bold tracking-tight">₹{amountFinal}</span>
                <Copy className="w-4 h-4 text-muted-foreground group-active:text-primary" />
              </button>
              <p className="text-[11px] text-muted-foreground mt-1">Tap to copy · Pay this exact amount</p>
            </div>

            <button
              onClick={copyUpi}
              className="w-full rounded-3xl p-4 mb-4 flex items-center justify-between"
              style={{ background: 'hsl(var(--muted) / 0.4)', border: '0.5px solid hsl(var(--border) / 0.5)' }}
            >
              <div className="text-left">
                <p className="text-[10px] tracking-widest uppercase text-muted-foreground">UPI ID</p>
                <p className="font-semibold text-[15px] mt-0.5">{settings.upiId}</p>
              </div>
              <Copy className="w-4 h-4 text-muted-foreground" />
            </button>

            <button
              onClick={openUpiApp}
              className="w-full py-4 rounded-3xl font-bold text-[16px] flex items-center justify-center gap-2 mb-3"
              style={{
                background: 'linear-gradient(135deg, hsl(var(--primary)), hsl(var(--accent)))',
                color: 'hsl(var(--primary-foreground))',
                boxShadow: '0 10px 30px -10px hsl(var(--primary) / 0.5)',
              }}
            >
              Open UPI app
            </button>

            <button
              onClick={() => { haptics.light(); setStep('confirm'); }}
              className="w-full py-3.5 rounded-3xl font-semibold text-[15px]"
              style={{ background: 'hsl(var(--muted) / 0.5)', border: '0.5px solid hsl(var(--border) / 0.5)' }}
            >
              I've paid · Submit transaction ID
            </button>

          </>
        )}

        {step === 'confirm' && (
          <>
            <button onClick={() => setStep('pay')} className="text-[14px] text-primary mb-4 flex items-center">
              <ChevronLeft className="w-4 h-4" /> Back
            </button>
            <h3 className="text-[22px] font-bold mb-1">Submit transaction ID</h3>
            <p className="text-[13px] text-muted-foreground mb-5">
              Find the 12-digit UTR / Transaction ID in your UPI app's payment receipt.
            </p>

            <input
              type="text"
              inputMode="numeric"
              pattern="[0-9]*"
              value={utr}
              onChange={e => setUtr(e.target.value.replace(/\D/g, '').slice(0, 12))}
              placeholder="123456789012"
              aria-label="UPI transaction ID"
              autoComplete="off"
              maxLength={12}
              className="w-full px-4 py-4 rounded-3xl text-[18px] font-mono tracking-[0.2em] mb-2 bg-transparent outline-none text-center"
              style={{
                background: 'hsl(var(--muted) / 0.4)',
                border: '1px solid hsl(var(--border))',
                color: 'hsl(var(--foreground))',
              }}
            />
            <p className="text-[11px] text-muted-foreground text-center mb-4">
              {utr.length}/12 digits
            </p>

            <div
              className="rounded-3xl p-3 mb-4 text-[12px] leading-relaxed"
              style={{ background: 'hsl(var(--primary) / 0.08)', border: '0.5px solid hsl(var(--primary) / 0.2)' }}
            >
              <p className="text-foreground/80">
                <strong className="text-primary">Auto-verify:</strong> We match the unique amount{' '}
                <strong>(₹{amountFinal})</strong> with your bank UTR. Premium activates within minutes.
              </p>
            </div>

            <button
              onClick={submitUtr}
              disabled={submitting || utr.length !== 12}
              className="w-full py-4 rounded-3xl font-bold text-[16px] flex items-center justify-center gap-2 disabled:opacity-50"
              style={{
                background: 'linear-gradient(135deg, hsl(var(--primary)), hsl(var(--accent)))',
                color: 'hsl(var(--primary-foreground))',
              }}
            >
              {submitting ? <Loader2 className="w-5 h-5 animate-spin" /> : 'Submit & Activate'}
            </button>
          </>
        )}
      </motion.div>
    </motion.div>
  );
});

// ─────────── Feature detail drawer ───────────

interface FeatureDetailSheetProps {
  feature: Feature;
  onClose: () => void;
}

const FeatureDetailSheet = memo(function FeatureDetailSheet({ feature, onClose }: FeatureDetailSheetProps) {
  const Icon = feature.icon;
  return (
    <motion.div
      initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
      className="fixed inset-0 z-[100] flex items-end justify-center bg-black/70"
      onClick={onClose}
    >
      <motion.div
        initial={{ y: '100%' }} animate={{ y: 0 }} exit={{ y: '100%' }}
        transition={iosSpring}
        onClick={e => e.stopPropagation()}
        className="w-full max-w-md rounded-t-3xl p-6 pb-10"
        style={{
          background: 'linear-gradient(180deg, hsl(var(--card)), hsl(var(--background)))',
          border: '0.5px solid hsl(var(--border))',
        }}
      >
        <div className="w-12 h-1 rounded-full bg-muted mx-auto mb-6" />
        <div className="flex items-start gap-4 mb-4">
          <div
            className="w-14 h-14 rounded-2xl flex items-center justify-center shrink-0"
            style={{ background: 'hsl(var(--primary) / 0.14)' }}
          >
            <Icon className="w-7 h-7 text-primary" strokeWidth={2} />
          </div>
          <div className="flex-1 min-w-0 pt-1">
            <div className="flex items-center gap-2 mb-1 flex-wrap">
              <h3 className="text-[20px] font-bold leading-tight">{feature.title}</h3>
              {feature.isNew && (
                <span
                  className="text-[9px] font-bold tracking-[0.12em] uppercase px-1.5 py-0.5 rounded"
                  style={{ background: 'hsl(var(--primary-strong))', color: 'hsl(var(--primary-foreground))' }}
                >
                  New
                </span>
              )}
            </div>
            <p className="text-[13px] text-muted-foreground">{feature.desc}</p>
          </div>
        </div>
        <p className="text-[14.5px] leading-relaxed text-foreground/85 mb-6">
          {feature.long}
        </p>
        <button
          onClick={onClose}
          className="w-full py-3.5 rounded-3xl font-semibold text-[15px] bg-muted/50"
          style={{ border: '0.5px solid hsl(var(--border) / 0.5)' }}
        >
          Close
        </button>
      </motion.div>
    </motion.div>
  );
});



// ─────────── Pending progress banner (shown on /premium when a UTR is awaiting verification) ───────────

interface PendingProgressBannerProps {
  pending: PendingPayment;
}

const PendingProgressBanner = memo(function PendingProgressBanner({ pending }: PendingProgressBannerProps) {
  // Animated stage advancement to feel "live" — caps at stage 3 (last step is activation)
  const [stage, setStage] = useState<1 | 2 | 3>(1);
  const [elapsed, setElapsed] = useState(0);

  useEffect(() => {
    const start = new Date(pending.created_at).getTime();
    const tick = () => {
      const seconds = Math.floor((Date.now() - start) / 1000);
      setElapsed(seconds);
      if (seconds < 3) setStage(1);
      else if (seconds < 10) setStage(2);
      else setStage(3);
    };
    tick();
    const id = window.setInterval(tick, 1000);
    return () => clearInterval(id);
  }, [pending.created_at]);

  const amountInr = (pending.amount_paise / 100).toFixed(2);
  const planLabel = (PLAN_LABEL as Record<string, string>)[pending.plan] ?? pending.plan;
  const mins = Math.floor(elapsed / 60);
  const secs = elapsed % 60;

  const steps = [
    { label: 'UTR submitted', detail: `UTR ${pending.utr_number.slice(0, 6)}…${pending.utr_number.slice(-2)}` },
    { label: 'Checking UTR with bank', detail: `Matching exact amount ₹${amountInr}` },
    { label: 'Activating your Premium', detail: 'Almost there — hold on' },
  ];

  return (
    <motion.section
      initial={{ opacity: 0, y: 16 }} animate={{ opacity: 1, y: 0 }} transition={iosSpring}
      className="rounded-3xl p-6 relative overflow-hidden"
      style={{
        background: 'linear-gradient(160deg, hsl(var(--primary) / 0.22) 0%, hsl(var(--card)) 60%, hsl(var(--accent) / 0.18) 100%)',
        border: '1px solid hsl(var(--primary) / 0.4)',
        boxShadow: '0 20px 60px -20px hsl(var(--primary) / 0.45)',
      }}
    >
      <div
        className="absolute -top-16 -right-16 w-40 h-40 rounded-full opacity-50 pointer-events-none"
        style={{ background: 'radial-gradient(circle, hsl(var(--primary) / 0.5), transparent 70%)', filter: 'blur(30px)' }}
      />

      <div className="flex items-center gap-3 mb-1 relative">
        <motion.div
          animate={{ scale: [1, 1.08, 1] }}
          transition={{ duration: 1.6, repeat: Infinity, ease: 'easeInOut' }}
          className="w-11 h-11 rounded-3xl flex items-center justify-center shrink-0"
          style={{ background: 'hsl(var(--primary) / 0.2)' }}
        >
          <Loader2 className="w-5 h-5 text-primary animate-spin" />
        </motion.div>
        <div className="min-w-0 flex-1">
          <p className="text-[10px] font-bold tracking-[0.22em] text-primary uppercase">
            You're so close
          </p>
          <h2 className="text-[20px] font-bold leading-tight">Activating Premium · {planLabel}</h2>
        </div>
      </div>

      <p className="text-[13px] text-muted-foreground mb-5 relative">
        Your payment of <strong className="text-foreground">₹{amountInr}</strong> is being matched with our bank records.
        This usually takes <strong className="text-foreground">1–2 minutes</strong>.
      </p>

      <div className="space-y-2 mb-4 relative">
        {steps.map((s, idx) => {
          const done = stage > (idx + 1);
          const active = stage === (idx + 1);
          const pendingStep = !done && !active;
          return (
            <div
              key={s.label}
              className="flex items-center gap-3 p-3 rounded-3xl"
              style={{
                background: active
                  ? 'hsl(var(--primary) / 0.12)'
                  : done
                  ? 'hsl(var(--primary) / 0.06)'
                  : 'hsl(var(--muted) / 0.25)',
                border: `0.5px solid ${active ? 'hsl(var(--primary) / 0.4)' : 'hsl(var(--border) / 0.4)'}`,
              }}
            >
              <div
                className="w-7 h-7 rounded-full flex items-center justify-center shrink-0"
                style={{
                  background: done
                    ? 'hsl(var(--primary))'
                    : active
                    ? 'hsl(var(--primary) / 0.25)'
                    : 'hsl(var(--muted) / 0.6)',
                }}
              >
                {done ? (
                  <Check className="w-4 h-4 text-primary-foreground" strokeWidth={3} />
                ) : active ? (
                  <Loader2 className="w-3.5 h-3.5 text-primary animate-spin" />
                ) : (
                  <span className="text-[10px] text-muted-foreground font-bold">{idx + 1}</span>
                )}
              </div>
              <div className="min-w-0 flex-1">
                <p className={`text-[14px] font-semibold ${pendingStep ? 'text-muted-foreground' : ''}`}>
                  {s.label}
                </p>
                <p className="text-[11px] text-muted-foreground truncate">{s.detail}</p>
              </div>
              {active && (
                <motion.div
                  className="w-1.5 h-1.5 rounded-full bg-primary"
                  animate={{ opacity: [0.3, 1, 0.3] }}
                  transition={{ duration: 1.2, repeat: Infinity }}
                />
              )}
            </div>
          );
        })}
      </div>

      <div
        className="rounded-3xl p-3 flex items-center gap-2 relative"
        style={{ background: 'hsl(var(--background) / 0.5)', border: '0.5px solid hsl(var(--border) / 0.5)' }}
      >
        <Clock className="w-4 h-4 text-primary shrink-0" />
        <p className="text-[12px] text-foreground/80 flex-1">
          Waiting <strong className="text-foreground">{mins > 0 ? `${mins}m ` : ''}{secs}s</strong> · You'll get a push notification the instant it's live.
        </p>
        <ShieldCheck className="w-4 h-4 text-primary shrink-0" />
      </div>
    </motion.section>
  );
});

export default PremiumPage;
