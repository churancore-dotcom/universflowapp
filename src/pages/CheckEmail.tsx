import { useEffect, useRef, useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { useNavigate, useLocation, useSearchParams } from '@/lib/router-compat';
import { Mail, ArrowLeft, RefreshCw, CheckCircle2, ShieldCheck } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/contexts/AuthContext';
import { getArtistDestination } from '@/lib/artistRouting';
import { toast } from 'sonner';
import SEOHead from '@/components/SEOHead';

const CheckEmail = () => {
  const navigate = useNavigate();
  const location = useLocation();
  const [params] = useSearchParams();
  const { user, refreshEmailVerified, signOut } = useAuth();

  const state = (location.state || {}) as { email?: string; username?: string; next?: string };
  const email =
    state.email ||
    params.get('email') ||
    (typeof window !== 'undefined' ? localStorage.getItem('uf_pending_verify_email') || '' : '') ||
    user?.email ||
    '';
  const username = state.username || params.get('u') || '';
  const nextPath =
    state.next ||
    params.get('next') ||
    (typeof window !== 'undefined' ? localStorage.getItem('uf_post_verify_next') || '' : '');

  const [cooldown, setCooldown] = useState(45);
  const [resending, setResending] = useState(false);
  const [verified, setVerified] = useState(false);
  const pollRef = useRef<number | null>(null);

  // No address at all? bounce to /auth.
  useEffect(() => {
    if (!email) navigate('/auth', { replace: true });
  }, [email, navigate]);

  // Cooldown ticker
  useEffect(() => {
    if (cooldown <= 0) return;
    const t = window.setInterval(() => setCooldown((c) => Math.max(0, c - 1)), 1000);
    return () => window.clearInterval(t);
  }, [cooldown]);

  // Poll profile.email_verified every 3s while we have a session, and also on
  // tab focus. The moment it flips true, refresh context + show the success
  // state, then land in the correct workspace — without ever asking for the password again.
  useEffect(() => {
    if (!user || verified) return;

    const check = async () => {
      try {
        const { data } = await supabase
          .from('profiles')
          .select('email_verified')
          .eq('user_id', user.id)
          .maybeSingle();
        if (data?.email_verified) {
          setVerified(true);
          try { localStorage.removeItem('uf_pending_verify_email'); } catch { /* ignore */ }
          await refreshEmailVerified();
          const artistDestination = await getArtistDestination(user);
          const destination = artistDestination || (nextPath.startsWith('/artist') ? nextPath : '/home');
          window.setTimeout(() => navigate(destination, { replace: true }), 1100);
        }
      } catch { /* swallow */ }
    };

    check();
    pollRef.current = window.setInterval(check, 3000);
    const onFocus = () => check();
    window.addEventListener('focus', onFocus);
    document.addEventListener('visibilitychange', onFocus);
    return () => {
      if (pollRef.current) window.clearInterval(pollRef.current);
      window.removeEventListener('focus', onFocus);
      document.removeEventListener('visibilitychange', onFocus);
    };
  }, [user, verified, navigate, refreshEmailVerified, nextPath]);

  const handleResend = async () => {
    if (cooldown > 0 || resending) return;
    setResending(true);
    try {
      const { data, error } = await supabase.functions.invoke('send-verification-link', {
        body: { email, username },
      });
      if (error) {
        const ctx = (error as { context?: Response })?.context;
        let msg = 'Could not send email';
        try {
          if (ctx) {
            const j = await ctx.clone().json();
            if (typeof j?.error === 'string') msg = j.error;
          }
        } catch { /* keep */ }
        toast.error(msg);
      } else if (data?.already) {
        toast.success('Your email is already verified.');
        if (user) await refreshEmailVerified();
        if (!user) {
          navigate('/auth');
          return;
        }
        const artistDestination = await getArtistDestination(user);
        navigate(artistDestination || (nextPath.startsWith('/artist') ? nextPath : '/home'));
      } else {
        toast.success('Verification email sent again');
        setCooldown(45);
      }
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Failed to resend');
    } finally {
      setResending(false);
    }
  };

  const handleUseDifferent = async () => {
    try { localStorage.removeItem('uf_pending_verify_email'); } catch { /* ignore */ }
    if (user) await signOut();
    navigate('/auth', { replace: true });
  };

  const maskEmail = (e: string) => {
    const [u, d] = e.split('@');
    if (!u || !d) return e;
    const visible = u.length <= 2 ? u : u.slice(0, 2);
    return `${visible}${'•'.repeat(Math.max(2, Math.min(6, u.length - 2)))}@${d}`;
  };

  return (
    <>
    <SEOHead
      title="Check Your Inbox — Univers Flow"
      description="We sent you a confirmation link. Verify your email to start streaming music on Univers Flow."
      path="/check-email"
    />
    <div className="min-h-[100dvh] bg-background text-foreground flex flex-col items-center justify-center px-6 py-10 relative overflow-hidden">
      <div
        className="absolute inset-0 pointer-events-none"
        style={{
          background:
            'radial-gradient(ellipse at 50% 0%, hsl(340 100% 55% / 0.18) 0%, transparent 55%)',
        }}
      />

      <button
        onClick={handleUseDifferent}
        className="absolute top-5 left-5 z-20 w-10 h-10 rounded-full flex items-center justify-center active:scale-90 transition-transform"
        style={{
          background: 'rgba(255,255,255,0.05)',
          border: '0.5px solid rgba(255,255,255,0.08)',
          backdropFilter: 'blur(20px)',
        }}
        aria-label="Use a different email"
      >
        <ArrowLeft className="w-4 h-4" />
      </button>

      <motion.div
        className="relative w-full max-w-sm z-10 text-center"
        initial={{ opacity: 0, y: 16, filter: 'blur(8px)' }}
        animate={{ opacity: 1, y: 0, filter: 'blur(0px)' }}
        transition={{ duration: 0.5, ease: [0.22, 1, 0.36, 1] }}
      >
        <AnimatePresence mode="wait">
          {!verified ? (
            <motion.div
              key="waiting"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0, scale: 0.97 }}
            >
              {/* Envelope hero with single rose halo */}
              <div className="relative mx-auto mb-7" style={{ width: 108, height: 108 }}>
                <motion.div
                  className="absolute inset-0 rounded-full"
                  style={{
                    background: 'radial-gradient(circle, hsl(340 100% 55% / 0.5), transparent 70%)',
                    filter: 'blur(10px)',
                  }}
                  animate={{ opacity: [0.55, 0.85, 0.55] }}
                  transition={{ duration: 2.8, repeat: Infinity, ease: 'easeInOut' }}
                />
                <motion.div
                  className="relative w-full h-full rounded-[34px] flex items-center justify-center"
                  style={{
                    background: 'linear-gradient(180deg, #FF3B5C 0%, #E11D48 100%)',
                    boxShadow: '0 18px 50px hsl(340 100% 45% / 0.45), inset 0 1px 0 rgba(255,255,255,0.2)',
                  }}
                  animate={{ y: [0, -4, 0] }}
                  transition={{ duration: 3.4, repeat: Infinity, ease: 'easeInOut' }}
                >
                  <Mail className="w-11 h-11 text-white" strokeWidth={1.7} />
                </motion.div>
              </div>

              <h1 className="text-[26px] leading-none font-display tracking-tight mb-2">
                Check your inbox
                <span className="sr-only"> — Verify your Universflow email</span>
              </h1>
              <p className="text-[13px] text-muted-foreground px-4 leading-relaxed">
                We sent a confirmation link to
              </p>
              <div
                className="mt-2.5 inline-flex items-center gap-2 px-3.5 py-1.5 rounded-full"
                style={{
                  background: 'rgba(255,255,255,0.05)',
                  border: '0.5px solid rgba(255,255,255,0.08)',
                }}
              >
                <Mail className="w-3.5 h-3.5 text-primary" />
                <span className="text-[12.5px] font-semibold tracking-tight break-all">{maskEmail(email)}</span>
              </div>

              <div
                className="rounded-[24px] p-5 mt-7 space-y-4 text-left"
                style={{
                  background: 'rgba(16,16,18,0.78)',
                  border: '0.5px solid rgba(255,255,255,0.07)',
                  boxShadow: '0 24px 70px rgba(0, 0, 0, 0.5), inset 0 1px 0 rgba(255,255,255,0.04)',
                  backdropFilter: 'blur(24px)',
                }}
              >
                {[
                  { icon: CheckCircle2, text: <>Open the email and tap <strong className="text-foreground">Confirm my email</strong></> },
                  { icon: ShieldCheck, text: <>This page unlocks automatically — no need to sign in again</> },
                  { icon: Mail, text: <>Can't find it? Check your <strong className="text-foreground">spam folder</strong></> },
                ].map((item, i) => {
                  const Icon = item.icon;
                  return (
                    <div key={i} className="flex items-start gap-3">
                      <div
                        className="w-7 h-7 rounded-full flex items-center justify-center flex-shrink-0 mt-0.5"
                        style={{
                          background: 'rgba(255, 45, 85, 0.12)',
                          border: '0.5px solid rgba(255, 45, 85, 0.18)',
                        }}
                      >
                        <Icon className="w-3.5 h-3.5 text-primary" />
                      </div>
                      <p className="text-[12.5px] text-muted-foreground leading-snug pt-1">{item.text}</p>
                    </div>
                  );
                })}

                <Button
                  onClick={handleResend}
                  disabled={cooldown > 0 || resending}
                  className="w-full h-12 text-[13px] font-semibold rounded-xl mt-1"
                  style={{
                    background: cooldown > 0 ? 'rgba(255,255,255,0.04)' : 'rgba(255,255,255,0.07)',
                    color: cooldown > 0 ? 'hsl(var(--muted-foreground))' : 'hsl(var(--foreground))',
                    border: '0.5px solid rgba(255,255,255,0.08)',
                  }}
                >
                  {resending ? (
                    <RefreshCw className="w-4 h-4 animate-spin" />
                  ) : cooldown > 0 ? (
                    `Resend in ${cooldown}s`
                  ) : (
                    <span className="flex items-center gap-2">
                      <RefreshCw className="w-4 h-4" /> Resend email
                    </span>
                  )}
                </Button>

                {user && (
                  <div className="flex items-center justify-center gap-2 pt-1">
                    <span className="w-1.5 h-1.5 rounded-full bg-primary animate-pulse" />
                    <p className="text-[11px] text-muted-foreground/80">Waiting for confirmation…</p>
                  </div>
                )}
              </div>

              <button
                onClick={handleUseDifferent}
                className="mt-5 text-[12px] text-muted-foreground active:opacity-70 inline-flex items-center gap-1.5"
              >
                <ArrowLeft className="w-3 h-3" /> Use a different email
              </button>
            </motion.div>
          ) : (
            <motion.div
              key="done"
              initial={{ opacity: 0, scale: 0.96 }}
              animate={{ opacity: 1, scale: 1 }}
              transition={{ type: 'spring', stiffness: 220, damping: 22 }}
            >
              <motion.div
                className="mx-auto w-24 h-24 rounded-full flex items-center justify-center"
                style={{
                  background: 'linear-gradient(180deg, #34c759 0%, #1f9d3f 100%)',
                  boxShadow: '0 14px 40px rgba(52, 199, 89, 0.4)',
                }}
                initial={{ scale: 0.4 }}
                animate={{ scale: 1 }}
                transition={{ type: 'spring', stiffness: 240, damping: 16 }}
              >
                <CheckCircle2 className="w-12 h-12 text-white" strokeWidth={2} />
              </motion.div>
              <h1 className="text-[26px] leading-none font-display tracking-tight mt-7 mb-2">
                Email confirmed
              </h1>
              <p className="text-[13px] text-muted-foreground px-6 leading-relaxed">
                You're all set. Taking you in…
              </p>
            </motion.div>
          )}
        </AnimatePresence>
      </motion.div>
    </div>
    </>
  );
};

export default CheckEmail;
