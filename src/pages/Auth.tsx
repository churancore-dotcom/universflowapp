import { useEffect, useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '@/contexts/AuthContext';
import { supabase } from '@/integrations/supabase/client';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Mail, Lock, ArrowRight, Loader2, Eye, EyeOff, AtSign } from 'lucide-react';
import { toast } from 'sonner';
import { FadeTransition } from '@/components/PageTransition';
import SEOHead from '@/components/SEOHead';
import ForgotPasswordModal from '@/components/ForgotPasswordModal';
import {
  getCooldownMs,
  registerFailure,
  clearCooldown,
  formatCooldown,
} from '@/lib/authCooldown';
import appLogo from '@/assets/app-logo.webp';


function detectCountryCode(): string | undefined {
  try {
    const locale = (Intl.DateTimeFormat().resolvedOptions().locale || '').toUpperCase();
    const m = locale.match(/-([A-Z]{2})\b/);
    return m?.[1];
  } catch { return undefined; }
}

type Mode = 'login' | 'signup' | 'artist';

const labels: Record<Mode, string> = {
  login: 'Sign in',
  signup: 'Sign up',
  artist: 'Artist',
};

// Lightweight slide+fade — no blur filter (blur causes jank on mobile GPUs).
const panelVariants = {
  initial: (isLogin: boolean) => ({ opacity: 0, x: isLogin ? -14 : 14 }),
  animate: { opacity: 1, x: 0 },
  exit: (isLogin: boolean) => ({ opacity: 0, x: isLogin ? 14 : -14 }),
};

const Auth = () => {
  const [mode, setMode] = useState<Mode>('login');
  const [email, setEmail] = useState('');
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [loading, setLoading] = useState(false);
  const [forgotOpen, setForgotOpen] = useState(false);
  const [cooldownMs, setCooldownMs] = useState(0);
  const { signIn, signUp, user } = useAuth();
  const navigate = useNavigate();

  const isLogin = mode === 'login';
  const cooldownAction = isLogin ? 'login' : 'signup';

  // Live countdown for the current identifier.
  useEffect(() => {
    const id = (isLogin ? email : email) || '';
    if (!id) { setCooldownMs(0); return; }
    const tick = () => setCooldownMs(getCooldownMs(cooldownAction, id));
    tick();
    const t = setInterval(tick, 1000);
    return () => clearInterval(t);
  }, [email, isLogin, cooldownAction]);

  const handleTab = (m: Mode) => {
    if (m === mode) return;
    if (m === 'artist') {
      // Navigate instantly to the artist auth page — no delay, no setTimeout.
      navigate('/artist/auth');
      return;
    }
    setMode(m);
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!navigator.onLine) {
      toast.error('You are offline. Connect to the internet and try again.');
      return;
    }
    setLoading(true);
    try {
      if (isLogin) {
        const { error, isAdmin } = await signIn(email, password);
        if (error) {
          if ((error as Error & { code?: string }).message === 'EMAIL_NOT_VERIFIED') {
            // Session is kept alive — the verification screen will auto-advance
            // the moment the user taps the link, without re-asking for password.
            try {
              await supabase.functions.invoke('send-verification-link', { body: { email } });
            } catch { /* non-fatal */ }
            navigate(`/check-email?email=${encodeURIComponent(email)}`, { state: { email }, replace: true });
            return;
          }
          toast.error(error.message);
          return;
        }
        navigate(isAdmin ? '/admin' : '/home');
      } else {
        const { error } = await signUp(email, password, username, detectCountryCode());
        if (error) { toast.error(error.message); return; }
        localStorage.setItem('uf_just_signed_up', '1');
        navigate(
          `/check-email?email=${encodeURIComponent(email)}&u=${encodeURIComponent(username)}`,
          { state: { email, username }, replace: true }
        );
        supabase.functions
          .invoke('send-verification-link', { body: { email, username, accountType: 'listener' } })
          .catch((e) => console.warn('verification email failed:', e));
      }
    } catch {
      toast.error('Something went wrong. Please try again.');
    } finally {
      setLoading(false);
    }
  };

  return (
    <FadeTransition>
      <div className="min-h-[100dvh] bg-background text-foreground flex flex-col items-center justify-center px-6 py-8 relative overflow-y-auto">
        <SEOHead
          title="Sign in — Universflow"
          description="Sign in or create your Universflow account to stream music, build playlists, and listen offline."
          path="/auth"
        />

        {/* One restrained rose halo — not a rainbow */}
        <div
          className="fixed inset-0 pointer-events-none"
          style={{
            background:
              'radial-gradient(ellipse at 50% -10%, hsl(340 100% 55% / 0.18) 0%, transparent 55%)',
          }}
        />

        <motion.div
          className="relative w-full max-w-sm z-10"
          initial={{ opacity: 0, y: 16 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.5, ease: [0.22, 1, 0.36, 1] }}
        >
          {/* Logo + wordmark — shares layoutId with SplashScreen for a seamless morph */}
          <div className="flex flex-col items-center mb-7">
            <motion.div
              layoutId="uf-brand-logo"
              className="relative"
              transition={{ type: 'spring', stiffness: 260, damping: 32, mass: 0.7 }}
            >
              <div
                className="absolute -inset-8 rounded-full pointer-events-none"
                style={{ background: 'radial-gradient(circle, hsl(var(--primary) / 0.28), transparent 70%)', filter: 'blur(14px)' }}
              />
              <div
                className="relative w-[124px] h-[124px] rounded-full overflow-hidden"
                style={{
                  background: 'linear-gradient(135deg, hsl(var(--card)) 0%, hsl(var(--background)) 100%)',
                  boxShadow: 'inset 0 0 0 0.5px hsl(var(--foreground) / 0.08), 0 18px 56px hsl(var(--primary) / 0.24)',
                }}
              >
                <img
                  src={appLogo}
                  alt="Universflow app logo"
                  className="w-full h-full object-cover scale-[1.18]"
                />
              </div>
            </motion.div>

            <motion.h1
              layoutId="uf-brand-wordmark"
              className="mt-6 text-[38px] leading-none font-display tracking-wide text-foreground"
              transition={{ type: 'spring', stiffness: 260, damping: 32, mass: 0.7 }}
            >
              Universflow
              <span className="sr-only"> — Sign in to stream and download music</span>
            </motion.h1>
            <p className="mt-2 text-[10.5px] tracking-[0.28em] uppercase text-muted-foreground/80">
              {isLogin ? 'Welcome back' : 'Start your sound'}
            </p>
          </div>

          {/* Segmented tabs — listener + artist signup together */}
          <div
            className="relative grid grid-cols-3 p-1 rounded-full mb-5 mx-auto w-[92%]"
            style={{
              background: 'rgba(255,255,255,0.04)',
              border: '1px solid rgba(255,255,255,0.06)',
            }}
          >
            {(['login', 'signup', 'artist'] as Mode[]).map((m) => (
              <button
                key={m}
                type="button"
                onClick={() => handleTab(m)}
                className="relative z-10 h-9 text-[12px] font-semibold tracking-tight transition-colors"
                style={{ color: mode === m ? '#fff' : 'hsl(var(--muted-foreground))' }}
              >
                {mode === m && (
                  <motion.div
                    layoutId="activeAuthTab"
                    className="absolute inset-0 rounded-full"
                    style={{
                      background: '#FF2D55',
                      boxShadow: '0 6px 18px hsl(340 100% 45% / 0.4)',
                    }}
                    transition={{ type: 'spring', stiffness: 600, damping: 38, mass: 0.5 }}
                  />
                )}
                <span className="relative z-10">{labels[m]}</span>
              </button>
            ))}
          </div>

          <AnimatePresence mode="popLayout" initial={false} custom={isLogin}>
            {mode !== 'artist' && (
              <motion.form
                key={mode}
                custom={isLogin}
              variants={panelVariants}
              onSubmit={handleSubmit}
              className="relative rounded-[26px] p-5 space-y-3.5"
              style={{
                background: 'rgba(16,16,18,0.78)',
                border: '0.5px solid rgba(255,255,255,0.07)',
                boxShadow: '0 30px 80px rgba(0,0,0,0.55), inset 0 1px 0 rgba(255,255,255,0.04)',
              }}
              initial="initial"
              animate="animate"
              exit="exit"
              transition={{ duration: 0.22, ease: [0.22, 1, 0.36, 1] }}
            >
              <AnimatePresence initial={false} mode="popLayout">
                {!isLogin && (
                  <motion.div
                    key="username"
                    initial={{ opacity: 0, height: 0, y: -4 }}
                    animate={{ opacity: 1, height: 'auto', y: 0 }}
                    exit={{ opacity: 0, height: 0, y: -4 }}
                    transition={{ duration: 0.22 }}
                    className="overflow-hidden"
                  >
                    <label className="block text-[10.5px] uppercase tracking-[0.18em] font-semibold text-muted-foreground/70 mb-1.5 pl-1">
                      Username
                    </label>
                    <div className="relative">
                      <AtSign className="absolute left-3.5 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground/70" />
                      <Input
                        type="text"
                        placeholder="yourname"
                        aria-label="Username"
                        value={username}
                        onChange={(e) => setUsername(e.target.value.replace(/[^a-zA-Z0-9_.]/g, '').slice(0, 20))}
                        className="pl-10 h-12 text-[14px] rounded-xl border-0 bg-white/[0.04]"
                        required={!isLogin}
                        minLength={3}
                        maxLength={20}
                        autoComplete="username"
                        autoFocus
                      />
                    </div>
                  </motion.div>
                )}
              </AnimatePresence>

              <div>
                <label className="block text-[10.5px] uppercase tracking-[0.18em] font-semibold text-muted-foreground/70 mb-1.5 pl-1">
                  Email
                </label>
                <div className="relative">
                  <Mail className="absolute left-3.5 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground/70" />
                  <Input
                    type="email"
                    placeholder="you@email.com"
                    aria-label="Email address"
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    className="pl-10 h-12 text-[14px] rounded-xl border-0 bg-white/[0.04]"
                    required
                    autoComplete="email"
                  />
                </div>
              </div>

              <div>
                <label className="block text-[10.5px] uppercase tracking-[0.18em] font-semibold text-muted-foreground/70 mb-1.5 pl-1">
                  Password
                </label>
                <div className="relative">
                  <Lock className="absolute left-3.5 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground/70" />
                  <Input
                    type={showPassword ? 'text' : 'password'}
                    placeholder={isLogin ? 'Your password' : 'At least 6 characters'}
                    aria-label="Password"
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    className="pl-10 pr-10 h-12 text-[14px] rounded-xl border-0 bg-white/[0.04]"
                    required
                    minLength={6}
                    autoComplete={isLogin ? 'current-password' : 'new-password'}
                  />
                  <button
                    type="button"
                    className="absolute right-3 top-1/2 -translate-y-1/2 p-1.5 text-muted-foreground/70 active:scale-90 transition-transform"
                    onClick={() => setShowPassword(!showPassword)}
                    aria-label={showPassword ? 'Hide password' : 'Show password'}
                  >
                    {showPassword ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                  </button>
                </div>
              </div>

              <Button
                type="submit"
                className="w-full h-12 text-[14px] font-semibold rounded-xl border-0 text-white active:scale-[0.98] transition-transform mt-1"
                style={{
                  background: 'linear-gradient(180deg, #FF3B5C 0%, #E11D48 100%)',
                  boxShadow: '0 10px 28px hsl(340 100% 45% / 0.4), inset 0 1px 0 rgba(255,255,255,0.18)',
                }}
                disabled={loading}
              >
                {loading ? (
                  <Loader2 className="w-4 h-4 animate-spin" />
                ) : (
                  <span className="flex items-center gap-2">
                    {isLogin ? 'Sign in' : 'Create account'}
                    <ArrowRight className="w-4 h-4" />
                  </span>
                )}
              </Button>

              {!isLogin && (
                <p className="text-center text-[10.5px] leading-relaxed text-muted-foreground/70 px-3 pt-1">
                  By creating an account, you agree to Universflow's{' '}
                  <a href="/legal/terms" className="underline">Terms</a> and{' '}
                  <a href="/legal/privacy" className="underline">Privacy Policy</a>.
                </p>
              )}
            </motion.form>
          )}
          </AnimatePresence>
        </motion.div>

        <p className="relative z-10 text-[10px] tracking-[0.22em] uppercase text-muted-foreground/50 mt-8">
          Universflow · Built for music lovers
        </p>
      </div>
    </FadeTransition>
  );
};

export default Auth;
