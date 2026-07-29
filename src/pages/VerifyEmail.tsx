import { useEffect, useState } from 'react';
import { motion } from 'framer-motion';
import { useNavigate, useSearchParams } from '@/lib/router-compat';
import { CheckCircle2, XCircle, Loader2, ArrowRight } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/contexts/AuthContext';
import { getArtistDestination } from '@/lib/artistRouting';
import appLogo from '@/assets/app-logo.webp';
import SEOHead from '@/components/SEOHead';


type State = 'loading' | 'success' | 'error';

const VerifyEmail = () => {
  const [params] = useSearchParams();
  const navigate = useNavigate();
  const { user } = useAuth();
  const [state, setState] = useState<State>('loading');
  const [message, setMessage] = useState('');

  useEffect(() => {
    const token = params.get('token') || '';
    if (!token) {
      setState('error');
      setMessage('This verification link is missing a token.');
      return;
    }

    let cancelled = false;
    (async () => {
      try {
        const { data, error } = await supabase.functions.invoke('confirm-verification-link', {
          body: { token },
        });
        if (cancelled) return;
        if (error || !data?.success) {
          const ctx = (error as { context?: Response })?.context;
          let msg = 'This link is invalid or has already been used.';
          try {
            if (ctx) {
              const j = await ctx.clone().json();
              if (typeof j?.error === 'string') msg = j.error;
            } else if (data?.error) {
              msg = data.error;
            }
          } catch { /* keep default */ }
          setState('error');
          setMessage(msg);
          return;
        }
        setState('success');
        setMessage('Your email is confirmed.');
      } catch (e) {
        if (cancelled) return;
        setState('error');
        setMessage(e instanceof Error ? e.message : 'Something went wrong.');
      }
    })();

    return () => { cancelled = true; };
  }, [params]);

  const handleContinue = async () => {
    if (!user) {
      navigate('/auth');
      return;
    }
    const artistDestination = await getArtistDestination(user);
    navigate(artistDestination || '/home');
  };

  return (
    <>
    <SEOHead
      title="Verify Your Email — Univers Flow"
      description="Confirm your email address to activate your Univers Flow account and start streaming music."
      path="/verify"
    />
    <div className="h-[100dvh] bg-background flex flex-col items-center justify-center p-5 relative overflow-hidden">
      <div
        className="absolute inset-0 pointer-events-none"
        style={{
          background:
            'radial-gradient(ellipse at 30% 20%, hsl(340 100% 50% / 0.18) 0%, transparent 50%), radial-gradient(ellipse at 70% 80%, hsl(260 100% 60% / 0.15) 0%, transparent 50%)',
        }}
      />

      <motion.div
        className="relative w-full max-w-sm z-10 text-center"
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.5 }}
      >
        <motion.div
          className="mx-auto w-24 h-24 rounded-full overflow-hidden mb-6 relative"
          initial={{ scale: 0.5, opacity: 0 }}
          animate={{ scale: 1, opacity: 1 }}
          transition={{ type: 'spring', stiffness: 200, damping: 20 }}
          style={{
            background: '#000',
            boxShadow: '0 0 28px hsl(var(--primary) / 0.35)',
          }}
        >
          <img src={appLogo} alt="Universflow" className="w-full h-full object-cover" />
        </motion.div>

        <h1 className="text-3xl font-bold tracking-tight mb-2">
          <span
            style={{
              background: 'linear-gradient(135deg, #FF2D55, #BF5AF2, #5E5CE6)',
              WebkitBackgroundClip: 'text',
              WebkitTextFillColor: 'transparent',
            }}
          >
            Univers
          </span>
          <span className="text-foreground ml-1.5 font-light">Flow</span>
          <span className="sr-only"> — Verify your email</span>
        </h1>

        <motion.div
          className="rounded-3xl p-7 mt-6 space-y-5"
          style={{
            background: 'rgba(28, 28, 30, 0.75)',
            border: '1px solid rgba(255, 255, 255, 0.10)',
            boxShadow: '0 20px 60px rgba(0, 0, 0, 0.4), inset 0 1px 0 rgba(255,255,255,0.06)',
          }}
          initial={{ opacity: 0, y: 15 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.15 }}
        >
          {state === 'loading' && (
            <>
              <Loader2 className="w-12 h-12 mx-auto animate-spin text-primary" />
              <p className="text-base font-medium">Confirming your email…</p>
              <p className="text-xs text-muted-foreground">Hang tight, this only takes a second.</p>
            </>
          )}

          {state === 'success' && (
            <>
              <motion.div
                initial={{ scale: 0 }}
                animate={{ scale: 1 }}
                transition={{ type: 'spring', stiffness: 240, damping: 16 }}
                className="mx-auto w-16 h-16 rounded-full flex items-center justify-center"
                style={{
                  background: 'linear-gradient(135deg, #34c759, #30b454)',
                  boxShadow: '0 8px 30px rgba(52, 199, 89, 0.35)',
                }}
              >
                <CheckCircle2 className="w-9 h-9 text-white" />
              </motion.div>
              <div>
                <h2 className="text-xl font-bold mb-1.5">Email confirmed 🎉</h2>
                <p className="text-sm text-muted-foreground">
                  You're all set. {user ? 'Tap continue to start listening.' : 'Sign in to start listening.'}
                </p>
              </div>
              <Button
                onClick={handleContinue}
                className="w-full h-12 text-sm font-bold rounded-xl border-0 text-primary-foreground active:scale-[0.97] transition-transform"
                style={{
                  background: 'linear-gradient(135deg, #FF2D55, #BF5AF2, #5E5CE6)',
                  boxShadow: '0 4px 20px hsl(340 100% 50% / 0.25)',
                }}
              >
                <span className="flex items-center gap-2">
                  {user ? 'Open Universflow' : 'Sign in'}
                  <ArrowRight className="w-4 h-4" />
                </span>
              </Button>
            </>
          )}

          {state === 'error' && (
            <>
              <div
                className="mx-auto w-16 h-16 rounded-full flex items-center justify-center"
                style={{ background: 'rgba(255, 69, 58, 0.15)' }}
              >
                <XCircle className="w-9 h-9 text-destructive" />
              </div>
              <div>
                <h2 className="text-xl font-bold mb-1.5">We couldn't verify this link</h2>
                <p className="text-sm text-muted-foreground">{message}</p>
              </div>
              <Button
                onClick={() => navigate('/auth')}
                variant="outline"
                className="w-full h-12 text-sm font-bold rounded-xl"
              >
                Back to sign in
              </Button>
            </>
          )}
        </motion.div>
      </motion.div>
    </div>
    </>
  );
};

export default VerifyEmail;
