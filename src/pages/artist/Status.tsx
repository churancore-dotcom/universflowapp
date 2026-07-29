import { useEffect, useMemo, useState } from 'react';
import { useNavigate } from '@/lib/router-compat';
import { motion } from 'framer-motion';
import {
  ArrowLeft, ArrowRight, RotateCw, LogOut, Send, ScanFace,
  ShieldCheck, BadgeCheck, XCircle, Headphones,
} from 'lucide-react';
import SEOHead from '@/components/SEOHead';
import { FadeTransition } from '@/components/PageTransition';
import { Button } from '@/components/ui/button';
import { useAuth } from '@/contexts/AuthContext';
import { supabase } from '@/integrations/supabase/client';
import {
  getMyApplication,
  type ArtistApplicationSafe, type ArtistAppStatus,
} from '@/lib/artist';
import { toast } from 'sonner';
import StepRail, { type RailStep } from '@/components/artist/StepRail';
import BentoCard from '@/components/artist/BentoCard';
import ArtistLoading from './ArtistLoading';

function fmtShort(iso?: string | null) {
  if (!iso) return '';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' }) +
    ' · ' + d.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' });
}


export default function ArtistStatus() {
  const { user, isLoading } = useAuth();
  const navigate = useNavigate();
  const [app, setApp] = useState<ArtistApplicationSafe | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState(false);
  const [, force] = useState(0);

  const load = async () => {
    if (!user) { setLoading(false); return; }
    try {
      let data = await getMyApplication(user.id);
      let justSubmittedAt = 0;
      try { justSubmittedAt = Number(sessionStorage.getItem('uf_artist_just_submitted') || '0'); } catch { /* ignore */ }
      const submittedRecently = justSubmittedAt > 0 && Date.now() - justSubmittedAt < 60_000;
      const maxAttempts = submittedRecently ? 12 : 3;
      let attempt = 0;
      while (!data && attempt < maxAttempts) {
        await new Promise((r) => setTimeout(r, 600));
        try { data = await getMyApplication(user.id); } catch { /* keep retrying */ }
        attempt++;
      }
      if (data) {
        try { sessionStorage.removeItem('uf_artist_just_submitted'); } catch { /* ignore */ }
      }
      setApp(data);
      setLoadError(false);
    } catch (err) {
      console.error('artist status load failed', err);
      setApp(null);
      setLoadError(true);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (isLoading) return;
    if (!user) { navigate('/auth', { replace: true }); return; }
    load();
    const channel = supabase
      .channel('artist-app-status')
      .on('postgres_changes',
        { event: '*', schema: 'public', table: 'artist_applications', filter: `user_id=eq.${user.id}` },
        () => load(),
      )
      .subscribe();
    return () => { supabase.removeChannel(channel); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user, isLoading]);

  // tick countdown every minute when rejected
  useEffect(() => {
    if (app?.status !== 'rejected') return;
    const i = setInterval(() => force((n) => n + 1), 60_000);
    return () => clearInterval(i);
  }, [app?.status]);

  useEffect(() => {
    window.history.pushState({ uf: 'artist-status' }, '', window.location.pathname);
    const onPop = (e: PopStateEvent) => {
      e.preventDefault?.();
      if (app?.status === 'approved') navigate('/artist/studio', { replace: true });
      else window.history.pushState({ uf: 'artist-status' }, '', window.location.pathname);
    };
    window.addEventListener('popstate', onPop);
    return () => window.removeEventListener('popstate', onPop);
  }, [app?.status, navigate]);

  const steps: RailStep[] = useMemo(() => {
    if (!app) return [];
    const status = app.status as ArtistAppStatus;
    const submittedAt = fmtShort(app.created_at);
    const reviewedAt = fmtShort(app.reviewed_at);
    const autoDone = !!app.created_at; // auto-checks run on submit

    if (status === 'approved') {
      return [
        { key: 's', label: 'Submitted', sub: 'Your application reached our review desk.', icon: Send, state: 'done', at: submittedAt },
        { key: 'a', label: 'Automated identity checks', sub: 'ID, face match and link signals scored.', icon: ScanFace, state: 'done' },
        { key: 'h', label: 'Human review', sub: 'Trust & Safety team confirmed your account.', icon: ShieldCheck, state: 'done', at: reviewedAt },
        { key: 'd', label: 'Verified', sub: "You earned the rose checkmark. Studio is unlocked.", icon: BadgeCheck, state: 'done' },
      ];
    }
    if (status === 'rejected') {
      return [
        { key: 's', label: 'Submitted', sub: 'Your application was received.', icon: Send, state: 'done', at: submittedAt },
        { key: 'a', label: 'Automated identity checks', sub: 'ID, face match and link signals scored.', icon: ScanFace, state: 'done' },
        { key: 'h', label: 'Human review', sub: 'A reviewer flagged something below.', icon: ShieldCheck, state: 'failed', at: reviewedAt },
        { key: 'd', label: 'Decision', sub: 'Not approved this time — see notes below.', icon: XCircle, state: 'failed' },
      ];
    }
    // pending
    return [
      { key: 's', label: 'Submitted', sub: 'Your application is in the queue.', icon: Send, state: 'done', at: submittedAt },
      { key: 'a', label: 'Automated identity checks', sub: 'ID, face match and link signals scored.', icon: ScanFace, state: autoDone ? 'done' : 'active' },
      { key: 'h', label: 'Human review', sub: 'A real person reviews every artist. Usually 1–3 days.', icon: ShieldCheck, state: 'active' },
      { key: 'd', label: 'Decision & rose checkmark', sub: "We'll push you the moment you're verified.", icon: BadgeCheck, state: 'todo' },
    ];
  }, [app]);

  if (isLoading || loading) return <ArtistLoading label="Checking your verification…" />;

  if (!app) {
    return (
      <FadeTransition>
        <Shell>
          <SEOHead title="Artist Verification — Universflow" description="Your artist identity verification is being prepared." path="/artist/status" />
          <div className="pt-10">
            <BentoCard glow className="p-6 text-center">
              <div className="relative mx-auto mb-5 h-20 w-20">
                <span className="absolute inset-0 rounded-full bg-primary/25 blur-2xl animate-pulse" />
                <span className="relative grid h-20 w-20 place-items-center rounded-[28px] bg-primary/12 border border-primary/25">
                  <ScanFace className="w-9 h-9 text-primary animate-pulse" />
                </span>
              </div>
              <p className="text-[10.5px] uppercase tracking-[0.24em] text-primary/80 font-semibold mb-2">
                Verification starting
              </p>
              <h2 className="font-display text-[25px] leading-tight tracking-tight">
                We&apos;re verifying your identity
              </h2>
              <p className="mt-3 text-[13px] leading-relaxed text-muted-foreground">
                {loadError
                  ? 'We could not read the latest verification row right now. Your application is still protected — refresh here and the live status will appear as soon as the secure check responds.'
                  : 'Your artist workspace is being prepared. If you just submitted, keep this screen open — the live status will appear automatically when the review row syncs.'}
              </p>
              <div className="mt-5 rounded-2xl bg-white/[0.035] border border-white/[0.06] p-3 text-left space-y-2.5">
                {[
                  'Checking your verified email session',
                  'Looking for your latest application securely',
                  'Blocking duplicate submissions while status syncs',
                ].map((text) => (
                  <div key={text} className="flex items-center gap-2.5 text-[12px] text-foreground/80">
                    <span className="relative flex h-2 w-2 shrink-0">
                      <span className="absolute inset-0 rounded-full bg-primary animate-ping" />
                      <span className="relative rounded-full h-2 w-2 bg-primary" />
                    </span>
                    {text}
                  </div>
                ))}
              </div>
              <div className="mt-5 grid grid-cols-1 gap-2.5">
                <Button onClick={load} style={{ background: '#FF2D55' }} className="h-12 text-white">
                  <RotateCw className="w-4 h-4 mr-1.5" /> Refresh verification
                </Button>
                <Button variant="outline" onClick={() => navigate('/artist/apply')} className="h-12 border-white/10 bg-white/[0.03]">
                  Continue application <ArrowRight className="w-4 h-4 ml-1.5" />
                </Button>
              </div>
            </BentoCard>
          </div>
        </Shell>
      </FadeTransition>
    );
  }

  const status = app.status as ArtistAppStatus;

  // Status hero copy
  const hero = status === 'approved'
    ? {
        eyebrow: 'Verified',
        title: "You're on the stage.",
        sub: 'Welcome to Universflow for Artists. Your Studio, analytics and uploads are all unlocked.',
        accent: '#10B981',
      }
    : status === 'rejected'
      ? {
          eyebrow: 'Not approved',
          title: 'This application was not approved.',
          sub: 'Each account gets one artist application. If you believe this decision was wrong, contact our team below and we\'ll take another look.',
          accent: '#FB7185',
        }
      : {
          eyebrow: 'Under review',
          title: 'Sit tight — humans are looking at it.',
          sub: 'Most artists are verified within 1 to 3 days. You can close the app, we\'ll push you the moment it\'s decided.',
          accent: '#FF2D55',
        };

  return (
    <FadeTransition>
      <SEOHead title="Artist Status — Universflow" description="Your Universflow artist application status." path="/artist/status" />
      <Shell backTo={status === 'approved' ? '/artist/studio' : '/artist/status'}>

        {/* === HERO === */}
        <motion.section
          initial={{ opacity: 0, y: 14 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.55, ease: [0.22, 1, 0.36, 1] }}
          className="relative rounded-[28px] overflow-hidden mb-5"
          style={{
            background:
              status === 'approved'
                ? 'linear-gradient(155deg, #064E3B 0%, #0A0A0B 70%)'
                : status === 'rejected'
                  ? 'linear-gradient(155deg, #4C0519 0%, #0A0A0B 70%)'
                  : 'linear-gradient(155deg, #FF2D55 0%, #2A0712 45%, #0A0A0B 100%)',
            boxShadow: '0 30px 80px rgba(0,0,0,0.55), inset 0 1px 0 rgba(255,255,255,0.08)',
          }}
        >
          {/* live pulse for pending */}
          {status === 'pending' && (
            <span
              aria-hidden
              className="pointer-events-none absolute -top-24 -left-12 w-64 h-64 rounded-full opacity-60"
              style={{ background: 'radial-gradient(closest-side, rgba(255,45,85,0.5), transparent 70%)' }}
            />
          )}

          <div className="relative p-5 pt-6">
            <div className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-black/35 border border-white/15 backdrop-blur-sm">
              {status === 'pending' && (
                <span className="relative flex w-1.5 h-1.5">
                  <span className="absolute inset-0 rounded-full bg-white/90 animate-ping" />
                  <span className="relative inline-flex w-1.5 h-1.5 rounded-full bg-white" />
                </span>
              )}
              {status === 'approved' && <BadgeCheck className="w-3 h-3" fill="#10B981" stroke="#fff" />}
              {status === 'rejected' && <XCircle className="w-3 h-3 text-white/90" />}
              <span className="text-[9.5px] uppercase tracking-[0.22em] font-semibold text-white/90">
                {hero.eyebrow}
              </span>
            </div>

            <h1 className="mt-3 font-display text-[28px] leading-[1.02] tracking-tight text-white">
              {hero.title}
            </h1>
            <p className="mt-2 text-[13px] leading-snug text-white/80 max-w-[300px]">
              {hero.sub}
            </p>

            {status === 'approved' && (
              <Button
                className="mt-5 w-full h-12 rounded-xl text-[14px] font-semibold text-white"
                style={{ background: '#FF2D55', boxShadow: '0 12px 30px rgba(255,45,85,0.45)' }}
                onClick={() => navigate('/artist/studio')}
              >
                Open Artist Studio <ArrowRight className="w-4 h-4 ml-1.5" />
              </Button>
            )}
          </div>
        </motion.section>

        {/* === TIMELINE === */}
        <BentoCard glow={status === 'pending'} className="p-5 mb-4">
          <p className="text-[10.5px] uppercase tracking-[0.22em] text-muted-foreground/70 font-semibold mb-4">
            Verification timeline
          </p>
          <StepRail steps={steps} />
        </BentoCard>

        {/* === REJECTION NOTE === */}
        {status === 'rejected' && (
          <BentoCard className="p-5 mb-4" delay={0.05}>
            <p className="text-[10.5px] uppercase tracking-[0.22em] text-rose-300/80 font-semibold mb-2">
              Note from review team
            </p>
            <p className="text-[14px] text-foreground/90 leading-relaxed font-display italic">
              "{app.admin_note || 'Your selfie, face check, or artist platform links did not pass review.'}"
            </p>
            <div className="mt-4 rounded-2xl p-3.5 flex items-start gap-3"
              style={{ background: 'rgba(251,191,36,0.07)', border: '1px solid rgba(251,191,36,0.18)' }}>
              <div className="w-9 h-9 rounded-full grid place-items-center bg-amber-500/15 text-amber-300 shrink-0">
                <ShieldCheck className="w-4 h-4" />
              </div>
              <div className="flex-1 min-w-0">
                <p className="text-[12.5px] font-semibold text-amber-100">
                  One application per account
                </p>
                <p className="text-[11.5px] text-amber-100/75 leading-snug mt-0.5">
                  Universflow only allows a single artist application per user. If this was decided in error, our team can review it manually.
                </p>
              </div>
            </div>
            <a
              href="mailto:universflow.in@gmail.com?subject=Artist%20verification%20appeal"
              className="mt-4 w-full h-12 rounded-xl text-[14px] font-semibold text-white flex items-center justify-center gap-1.5"
              style={{ background: '#FF2D55', boxShadow: '0 12px 30px rgba(255,45,85,0.35)' }}
            >
              Contact review team <ArrowRight className="w-4 h-4" />
            </a>
            <p className="mt-3 text-[11.5px] text-center text-muted-foreground/80 leading-relaxed">
              Or email <a href="mailto:universflow.in@gmail.com" className="text-primary underline">universflow.in@gmail.com</a> directly.
            </p>

          </BentoCard>
        )}

        {/* === WHILE YOU WAIT (pending only) === */}
        {status === 'pending' && (
          <BentoCard className="p-5 mb-4" delay={0.08}>
            <div className="flex items-center gap-3 mb-3">
              <div className="w-9 h-9 rounded-full grid place-items-center bg-primary/15 text-primary">
                <BadgeCheck className="w-4 h-4" />
              </div>
              <div>
                <p className="text-[14px] font-semibold tracking-tight">While you wait</p>
                <p className="text-[11.5px] text-muted-foreground">Get ahead before approval lands</p>
              </div>
            </div>
            <ul className="space-y-2.5">
              {[
                { icon: Headphones, t: 'Pick your release cover', s: 'Square, 1500×1500, no watermark.' },
                { icon: ShieldCheck, t: 'Stage your direct audio URL', s: 'WAV / 320 MP3 on a CDN you control.' },
                { icon: Send, t: 'Plan your launch day', s: 'Story assets ready, fans alerted.' },
              ].map((row) => {
                const I = row.icon;
                return (
                  <li key={row.t} className="flex items-start gap-3 rounded-xl p-2.5 -mx-1 hover:bg-white/[0.03] transition">
                    <span className="w-7 h-7 rounded-lg grid place-items-center bg-white/[0.05] text-foreground/80 shrink-0 mt-0.5">
                      <I className="w-3.5 h-3.5" />
                    </span>
                    <div className="min-w-0">
                      <p className="text-[13px] font-medium">{row.t}</p>
                      <p className="text-[11.5px] text-muted-foreground/85 leading-snug">{row.s}</p>
                    </div>
                  </li>
                );
              })}
            </ul>
          </BentoCard>
        )}

        {/* Submitted meta + logout */}
        <p className="mt-4 text-[11px] text-center text-muted-foreground/60 tabular-nums">
          Submitted {fmtShort(app.created_at)} · ref {(app.id ?? '').slice(0, 8)}
        </p>

        <button
          type="button"
          onClick={async () => {
            await supabase.auth.signOut();
            toast.success('Signed out');
            navigate('/auth', { replace: true });
          }}
          className="mt-5 mx-auto flex items-center justify-center gap-2 text-[12px] font-medium text-white/55 hover:text-white px-4 py-2.5 rounded-xl bg-white/[0.03] border border-white/[0.06] active:scale-[0.98] transition"
        >
          <LogOut className="w-3.5 h-3.5" /> Log out
        </button>

      </Shell>
    </FadeTransition>
  );
}

function Shell({ children, backTo = '/artist/status' }: { children: React.ReactNode; backTo?: string }) {
  const navigate = useNavigate();
  const isSelf = backTo === '/artist/status';
  return (
    <div className="min-h-[100dvh] bg-[#060608] text-foreground relative overflow-y-auto overflow-x-hidden">
      {/* Ambient backdrop */}
      <div
        className="fixed inset-0 pointer-events-none"
        style={{
          background:
            'radial-gradient(120% 80% at 0% 0%, hsl(340 100% 55% / 0.20) 0%, transparent 55%),' +
            'radial-gradient(80% 60% at 100% 100%, hsl(28 100% 60% / 0.10) 0%, transparent 60%)',
        }}
      />
      <header className="sticky top-0 z-20 bg-[#060608]/85 backdrop-blur-xl border-b border-white/5">
        <div className="max-w-md mx-auto px-4 py-3 flex items-center gap-3">
          {!isSelf && (
            <button
              onClick={() => navigate(backTo, { replace: true })}
              className="w-9 h-9 rounded-full flex items-center justify-center bg-white/[0.04] active:scale-95"
            >
              <ArrowLeft className="w-5 h-5" />
            </button>
          )}
          <h1 className="text-[15px] font-semibold tracking-tight">Artist Verification</h1>
          <span className="ml-1 text-[9.5px] tracking-[0.28em] uppercase text-muted-foreground/55 font-semibold">
            Universflow
          </span>
        </div>
      </header>
      <main className="relative max-w-md mx-auto px-5 pt-6 pb-32">{children}</main>
    </div>
  );
}
