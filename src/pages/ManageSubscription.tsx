import { motion } from 'framer-motion';
import {
  ChevronLeft,
  Crown,
  Check,
  Music2,
  Download,
  Headphones,
  Disc3,
  Calendar,
  Shield,
  Heart,
  Zap,
} from 'lucide-react';
import { useNavigate } from '@/lib/router-compat';
import BottomNav from '@/components/BottomNav';
import PageTransition from '@/components/PageTransition';
import { iosSpring, iosBounce } from '@/lib/animations';
import { useAuth } from '@/contexts/AuthContext';
import { usePremium } from '@/hooks/usePremium';
import SEOHead from '@/components/SEOHead';

const formatDebugTime = (iso: string | null) => {
  if (!iso) return 'Waiting…';
  try {
    return new Date(iso).toLocaleString(undefined, {
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
      day: '2-digit',
      month: 'short',
    });
  } catch {
    return iso;
  }
};

const formatDate = (iso: string | null) => {
  if (!iso) return 'Lifetime';
  try {
    return new Date(iso).toLocaleDateString(undefined, {
      year: 'numeric',
      month: 'long',
      day: 'numeric',
    });
  } catch {
    return 'Lifetime';
  }
};

const planLabel = (type?: string) => {
  switch (type) {
    case 'premium_yearly': return 'Premium Yearly';
    case 'premium_monthly': return 'Premium Monthly';
    case 'free': return 'Free';
    default: return 'Premium';
  }
};

const ManageSubscription = () => {
  const navigate = useNavigate();
  const { user } = useAuth();
  const {
    isPremium,
    subscription,
    verifiedStatus,
    subscriptionRow,
    lastRealtimeUpdate,
    lastCheckedAt,
    isLoading,
    error,
    refetch,
  } = usePremium();

  void subscriptionRow; void verifiedStatus; void lastRealtimeUpdate; void lastCheckedAt; void error; void refetch;


  const memberSince = subscription?.expires_at
    ? null
    : 'Lifetime member';

  const isLifetime =
    !subscription?.expires_at ||
    (subscription?.expires_at && new Date(subscription.expires_at).getFullYear() >= 2099);

  const features = [
    { icon: Music2, title: 'Unlimited Streaming', description: 'Listen to anything, anytime', color: 'from-pink-500 to-rose-500' },
    { icon: Download, title: 'Offline Downloads', description: 'Save songs and play without internet', color: 'from-blue-500 to-cyan-500' },
    { icon: Headphones, title: 'High-Quality Audio', description: 'Crystal clear up to 320kbps', color: 'from-purple-500 to-violet-500' },
    { icon: Shield, title: 'Ad-Free Experience', description: 'No interruptions, ever', color: 'from-emerald-500 to-teal-500' },
    { icon: Disc3, title: 'Exclusive Tracks', description: 'Premium-only releases & content', color: 'from-amber-500 to-orange-500' },
    { icon: Heart, title: 'Listen Together', description: 'Sync sessions with friends in real time', color: 'from-rose-500 to-pink-500' },
  ];

  if (isLoading) {
    return (
      <PageTransition>
        <div className="min-h-screen bg-background flex items-center justify-center">
          <div className="w-10 h-10 rounded-full border-2 border-primary border-t-transparent animate-spin" />
        </div>
      </PageTransition>
    );
  }

  // Non-premium fallback
  if (!isPremium) {
    return (
      <PageTransition>
        <div className="ethereal-page min-h-screen pb-44">
          <header className="sticky top-0 z-30 px-2 pt-4 pb-3 flex items-center safe-area-pt"
            style={{ background: 'hsl(var(--background) / 0.85)', backdropFilter: 'blur(40px)' }}>
            <button onClick={() => navigate(-1)} className="flex items-center gap-1 px-2 py-2 text-primary">
              <ChevronLeft className="w-6 h-6" />
              <span className="text-[17px]">Back</span>
            </button>
            <h1 className="text-[17px] font-semibold absolute left-1/2 -translate-x-1/2">Subscription</h1>
          </header>
          <main className="px-5 pt-8 space-y-5">
            <div className="text-center">
            <div className="w-20 h-20 mx-auto mb-4 rounded-3xl flex items-center justify-center"
              style={{ background: 'linear-gradient(135deg, hsl(var(--primary)), hsl(var(--accent)))' }}>
              <Crown className="w-10 h-10 text-primary-foreground" />
            </div>
            <h2 className="text-2xl font-bold mb-2">No active subscription</h2>
            <p className="text-muted-foreground mb-6">Unlock the full Universflow experience.</p>
            <button
              onClick={() => navigate('/premium')}
              className="px-6 py-3 rounded-3xl font-semibold bg-primary text-primary-foreground"
            >
              Upgrade to Premium
            </button>
            </div>
          </main>
          <BottomNav />
        </div>
      </PageTransition>
    );
  }

  return (
    <PageTransition>
      <SEOHead
        title="Manage Subscription — Univers Flow"
        description="Review and manage your Univers Flow Premium subscription, billing details and renewal options."
        keywords="manage subscription, Universflow premium plan, billing"
      />
      <motion.div
        className="ethereal-page min-h-screen pb-44"
        initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ duration: 0.3 }}
      >
        {/* Header */}
        <motion.header
          className="sticky top-0 z-30 px-2 pt-4 pb-3 flex items-center safe-area-pt"
          style={{
            background: 'hsl(var(--background) / 0.85)',
            backdropFilter: 'blur(40px) saturate(180%)',
            WebkitBackdropFilter: 'blur(40px) saturate(180%)',
          }}
          initial={{ opacity: 0, y: -30 }} animate={{ opacity: 1, y: 0 }} transition={iosSpring}
        >
          <motion.button
            onClick={() => navigate(-1)}
            className="flex items-center gap-1 px-2 py-2 -ml-1 text-primary"
            whileTap={{ scale: 0.95, opacity: 0.7 }} transition={iosBounce}
          >
            <ChevronLeft className="w-6 h-6" />
            <span className="text-[17px]">Back</span>
          </motion.button>
          <h1 className="text-[17px] font-semibold absolute left-1/2 -translate-x-1/2">My Subscription</h1>
        </motion.header>

        <main className="px-5 pt-4 space-y-6">
          {/* Hero plan card */}
          <motion.section
            initial={{ opacity: 0, y: 20, scale: 0.96 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            transition={iosSpring}
            className="relative overflow-hidden rounded-3xl p-6 uf-rose-gradient"
            style={{
              boxShadow: '0 24px 60px -20px rgba(255, 45, 85, 0.55)',
            }}
          >
            {/* Decorative blobs */}
            <div className="absolute -top-16 -right-10 w-48 h-48 rounded-full opacity-30 blur-3xl bg-white" />
            <div className="absolute -bottom-20 -left-10 w-56 h-56 rounded-full opacity-20 blur-3xl bg-black" />

            <div className="relative flex items-start justify-between">
              <div>
                <div className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-black/25 backdrop-blur-sm mb-3">
                  <Crown className="w-3.5 h-3.5 text-white" />
                  <span className="text-[10px] font-bold tracking-wider text-white uppercase">Premium</span>
                </div>
                <h2 className="text-3xl text-white drop-shadow uf-display-title">
                  {planLabel(subscription?.subscription_type)}
                </h2>
                <p className="text-sm text-white/85 mt-1">
                  {user?.email}
                </p>
              </div>
              <motion.div
                initial={{ rotate: -20, scale: 0 }}
                animate={{ rotate: 0, scale: 1 }}
                transition={{ ...iosSpring, delay: 0.1 }}
                className="w-14 h-14 rounded-3xl bg-white/20 backdrop-blur-sm flex items-center justify-center"
              >
                <Crown className="w-8 h-8 text-white" />
              </motion.div>
            </div>

            {/* Status row */}
            <div className="relative grid grid-cols-2 gap-3 mt-6">
              <div className="rounded-3xl bg-black/20 backdrop-blur-sm p-3">
                <p className="text-[10px] uppercase tracking-wider text-white/70 font-semibold mb-1">Status</p>
                <p className="text-sm font-bold text-white flex items-center gap-1.5">
                  <span className="w-2 h-2 rounded-full bg-emerald-400 animate-pulse" />
                  Active
                </p>
              </div>
              <div className="rounded-3xl bg-black/20 backdrop-blur-sm p-3">
                <p className="text-[10px] uppercase tracking-wider text-white/70 font-semibold mb-1 flex items-center gap-1">
                  <Calendar className="w-3 h-3" />
                  {isLifetime ? 'Valid until' : 'Renews'}
                </p>
                <p className="text-sm font-bold text-white">
                  {isLifetime ? 'Lifetime ♾️' : formatDate(subscription?.expires_at || null)}
                </p>
              </div>
            </div>
          </motion.section>

          {/* Thank-you note */}
          <motion.div
            initial={{ opacity: 0, y: 12 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ ...iosSpring, delay: 0.1 }}
            className="rounded-3xl p-4 flex items-start gap-3"
            style={{
              background: 'linear-gradient(135deg, hsl(var(--primary) / 0.15), hsl(var(--accent) / 0.08))',
              border: '1px solid hsl(var(--primary) / 0.2)',
            }}
          >
            <div className="w-9 h-9 rounded-3xl flex-shrink-0 flex items-center justify-center"
              style={{ background: 'linear-gradient(135deg, hsl(var(--primary)), hsl(var(--accent)))' }}>
              <Heart className="w-4.5 h-4.5 text-primary-foreground" fill="currentColor" />
            </div>
            <div>
              <p className="text-sm font-semibold">Thank you for being Premium 💜</p>
              <p className="text-xs text-muted-foreground mt-0.5">
                You're powering the music. Enjoy every track.
              </p>
            </div>
          </motion.div>

          {/* Features included */}
          <section>
            <div className="flex items-center gap-2 mb-3 px-1">
              
              <h3 className="text-[10px] font-extrabold text-white/40 uppercase tracking-[0.2em]">
                What you're using
              </h3>
            </div>
            <div className="grid grid-cols-2 gap-3">
              {features.map((f, i) => {
                const Icon = f.icon;
                return (
                  <motion.div
                    key={f.title}
                    initial={{ opacity: 0, y: 14 }}
                    animate={{ opacity: 1, y: 0 }}
                    transition={{ ...iosSpring, delay: 0.15 + i * 0.04 }}
                    className="rounded-3xl p-3.5 relative overflow-hidden"
                    style={{
                      background: 'hsl(var(--card))',
                      border: '1px solid hsl(var(--border) / 0.6)',
                    }}
                  >
                    <div className={`w-9 h-9 rounded-3xl mb-2.5 flex items-center justify-center bg-gradient-to-br ${f.color}`}>
                      <Icon className="w-4.5 h-4.5 text-white" />
                    </div>
                    <p className="text-[13px] font-semibold leading-tight">{f.title}</p>
                    <p className="text-[11px] text-muted-foreground mt-1 leading-snug">{f.description}</p>
                    <Check className="w-3.5 h-3.5 text-emerald-400 absolute top-3 right-3" />
                  </motion.div>
                );
              })}
            </div>
          </section>

          {/* Plan details */}
          <section className="rounded-3xl overflow-hidden bg-card/50 border border-white/5 backdrop-blur-sm">
            <div className="px-4 py-3 border-b border-white/5 flex items-center gap-2">
              <Zap className="w-4 h-4 text-primary" />
              <span className="text-sm font-semibold">Plan details</span>
            </div>
            <div className="divide-y divide-white/5">
              <Row label="Plan" value={planLabel(subscription?.subscription_type)} />
              <Row label="Status" value="Active" valueClass="text-emerald-400" />
              <Row label="Platform" value={(subscription?.platform || 'web').toUpperCase()} />
              <Row
                label={isLifetime ? 'Valid until' : 'Next billing date'}
                value={isLifetime ? 'Forever (Lifetime)' : formatDate(subscription?.expires_at || null)}
              />
            </div>
          </section>

          

        </main>

        <BottomNav />
      </motion.div>
    </PageTransition>
  );
};

const Row = ({ label, value, valueClass = '' }: { label: string; value: string; valueClass?: string }) => (
  <div className="px-4 py-3 flex items-center justify-between">
    <span className="text-[13px] text-muted-foreground">{label}</span>
    <span className={`text-[13px] font-semibold ${valueClass}`}>{value}</span>
  </div>
);

const PremiumDebugPanel = ({
  verifiedStatus,
  subscriptionRow,
  lastRealtimeUpdate,
  lastCheckedAt,
  errorMessage,
  onRefresh,
}: {
  verifiedStatus: boolean;
  subscriptionRow: Record<string, unknown> | null;
  lastRealtimeUpdate: string | null;
  lastCheckedAt: string | null;
  errorMessage: string | null;
  onRefresh: () => Promise<void>;
}) => (
  <section className="rounded-3xl overflow-hidden bg-card/50 border border-white/5 backdrop-blur-sm text-left">
    <div className="px-4 py-3 border-b border-white/5 flex items-center justify-between gap-3">
      <div className="min-w-0">
        <p className="text-sm font-semibold">Premium status debug</p>
        <p className="text-[11px] text-muted-foreground">Live server verification details</p>
      </div>
      <button
        onClick={() => { void onRefresh(); }}
        className="shrink-0 px-3 py-1.5 rounded-3xl text-xs font-semibold bg-primary text-primary-foreground"
      >
        Refresh
      </button>
    </div>
    <div className="divide-y divide-white/5">
      <Row label="Verified status" value={verifiedStatus ? 'Premium verified' : 'Not verified'} valueClass={verifiedStatus ? 'text-emerald-400' : 'text-amber-400'} />
      <Row label="Last realtime update" value={formatDebugTime(lastRealtimeUpdate)} />
      <Row label="Last server check" value={formatDebugTime(lastCheckedAt)} />
      {errorMessage && <Row label="Last error" value={errorMessage} valueClass="text-red-400" />}
    </div>
    <details className="group border-t border-border/60">
      <summary className="px-4 py-3 text-[12px] text-muted-foreground cursor-pointer select-none list-none flex items-center justify-between">
        <span>Technical details (for support)</span>
        <span className="text-[11px] opacity-60 group-open:hidden">Show</span>
        <span className="text-[11px] opacity-60 hidden group-open:inline">Hide</span>
      </summary>
      <div className="p-4 pt-0">
        <pre className="max-h-44 overflow-auto rounded-3xl bg-background/70 border border-border/50 p-3 text-[11px] leading-relaxed whitespace-pre-wrap break-words text-muted-foreground">
          {subscriptionRow ? JSON.stringify(subscriptionRow, null, 2) : 'No subscription row returned by the server.'}
        </pre>
      </div>
    </details>
  </section>
);

export default ManageSubscription;
