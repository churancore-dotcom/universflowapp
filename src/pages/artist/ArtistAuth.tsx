import { useMemo, useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { useNavigate, Link } from 'react-router-dom';
import { useAuth } from '@/contexts/AuthContext';
import { supabase } from '@/integrations/supabase/client';
import { getMyApplication } from '@/lib/artist';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import {
  Mail, Lock, ArrowRight, Loader2, Eye, EyeOff, AtSign,
  BadgeCheck, ArrowLeft, User as UserIcon, Phone, Calendar,
  Check, Shield, Headphones, TrendingUp,
} from 'lucide-react';
import { toast } from 'sonner';
import { validatePhone, PHONE_DIGITS } from '@/lib/phoneValidator';
import { FadeTransition } from '@/components/PageTransition';
import SEOHead from '@/components/SEOHead';
import { CountryCombobox } from '@/components/CountryCombobox';
import { COUNTRIES, getCountry } from '@/lib/countries';

function detectCountryCode(): string | undefined {
  try {
    const locale = (Intl.DateTimeFormat().resolvedOptions().locale || '').toUpperCase();
    const m = locale.match(/-([A-Z]{2})\b/);
    return m?.[1];
  } catch { return undefined; }
}

type Mode = 'login' | 'signup';

function ageFromDob(dob: string): number | null {
  if (!dob) return null;
  const d = new Date(dob);
  if (Number.isNaN(d.getTime())) return null;
  const now = new Date();
  let a = now.getFullYear() - d.getFullYear();
  const m = now.getMonth() - d.getMonth();
  if (m < 0 || (m === 0 && now.getDate() < d.getDate())) a--;
  return a;
}

const ArtistAuth = () => {
  const [mode, setMode] = useState<Mode>('signup');
  const [step, setStep] = useState<1 | 2>(1);
  const [email, setEmail] = useState('');
  const [username, setUsername] = useState('');
  const [fullName, setFullName] = useState('');
  const [dialIso, setDialIso] = useState(detectCountryCode() || 'IN');
  const [phone, setPhone] = useState('');
  const [dob, setDob] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [agreeTerms, setAgreeTerms] = useState(false);
  const [agreePrivacy, setAgreePrivacy] = useState(false);
  const [loading, setLoading] = useState(false);
  const { signIn, signUp } = useAuth();
  const navigate = useNavigate();

  const isLogin = mode === 'login';
  const dial = useMemo(
    () => getCountry(dialIso) ?? getCountry('IN') ?? COUNTRIES[0],
    [dialIso],
  );
  const age = ageFromDob(dob);
  const maxDob = useMemo(() => {
    const d = new Date();
    d.setFullYear(d.getFullYear() - 13);
    return d.toISOString().slice(0, 10);
  }, []);

  // Password strength (0–4)
  const pwStrength = useMemo(() => {
    let s = 0;
    if (password.length >= 6) s++;
    if (password.length >= 10) s++;
    if (/[A-Z]/.test(password) && /[a-z]/.test(password)) s++;
    if (/\d/.test(password) && /[^A-Za-z0-9]/.test(password)) s++;
    return s;
  }, [password]);

  const step1Valid =
    fullName.trim().length >= 2 &&
    username.trim().length >= 3 &&
    /\S+@\S+\.\S+/.test(email);

  const phoneCheck = useMemo(() => validatePhone(dial.code, phone), [dial, phone]);

  const signupValid =
    step1Valid &&
    password.length >= 6 &&
    phoneCheck.ok &&
    age !== null && age >= 13 &&
    agreeTerms && agreePrivacy;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!navigator.onLine) {
      toast.error('You are offline. Connect to the internet and try again.');
      return;
    }
    if (!isLogin) {
      if (step === 1) {
        if (!step1Valid) {
          toast.error('Please complete your identity details.');
          return;
        }
        setStep(2);
        return;
      }
      if (age !== null && age < 13) {
        toast.error('You must be at least 13 to create an artist account.');
        return;
      }
      if (!phoneCheck.ok) {
        toast.error(phoneCheck.troll || phoneCheck.reason || 'Enter a valid mobile number.');
        return;
      }
      if (!agreeTerms || !agreePrivacy) {
        toast.error('Please accept the Artist Terms and Privacy Policy.');
        return;
      }
    }
    setLoading(true);
    try {
      if (isLogin) {
        const { error } = await signIn(email, password);
        if (error) {
          if ((error as Error & { code?: string }).message === 'EMAIL_NOT_VERIFIED') {
            try {
              await supabase.functions.invoke('send-verification-link', { body: { email } });
            } catch { /* non-fatal */ }
            navigate(
              `/check-email?email=${encodeURIComponent(email)}&next=${encodeURIComponent('/artist/apply')}`,
              { state: { email, next: '/artist/apply' }, replace: true },
            );
            return;
          }
          toast.error(error.message);
          return;
        }
        const authedUser = (await supabase.auth.getUser()).data.user;
        if (!authedUser) {
          toast.error('Could not load your account. Please try again.');
          return;
        }

        // Admins are never trapped in the artist flow.
        try {
          const { data: isAdmin } = await supabase.rpc('has_role', {
            _user_id: authedUser.id, _role: 'admin',
          });
          if (isAdmin) { navigate('/home', { replace: true }); return; }
        } catch { /* fall through */ }

        // Approved artists land in Studio.
        try {
          const { data: isArtist } = await supabase.rpc('has_role', {
            _user_id: authedUser.id, _role: 'artist',
          });
          if (isArtist) { navigate('/artist/studio', { replace: true }); return; }
        } catch { /* fall through */ }

        // Pending / rejected applicants land on Status (this was previously
        // broken — returning artists with an in-review application would get
        // signed out with "no artist account found").
        try {
          const app = await getMyApplication(authedUser.id);
          if (app) { navigate('/artist/status', { replace: true }); return; }
        } catch { /* fall through */ }

        // No application on file yet. If the account was registered as an
        // artist (metadata says so), resume the onboarding at /artist/apply
        // instead of signing them out — this fixes "artists who close the app
        // mid-verification can never log back in".
        const meta = (authedUser.user_metadata || {}) as Record<string, unknown>;
        if (meta.account_type === 'artist') {
          toast.success('Welcome back — finish setting up your artist profile.');
          navigate('/artist/apply', { replace: true });
          return;
        }

        // The email belongs to a listener account. Keep them signed in and
        // switch the form to signup so they can create an artist profile.
        toast.info('This email is a listener account. Switch to Sign up to create an artist profile.');
        setMode('signup');
        return;
      } else {
        const fullPhone = `${dial.dial} ${phone.trim()}`;
        const artistMetadata = {
          full_name: fullName.trim(),
          phone: fullPhone,
          dob,
          account_type: 'artist',
        };
        const { error } = await signUp(email, password, username, dial.code, artistMetadata);
        if (error) { toast.error(error.message); return; }

        try {
          localStorage.setItem(
            'uf_artist_signup',
            JSON.stringify({
              full_name: fullName.trim(),
              phone: fullPhone,
              country_code: dial.code,
              dob,
              account_type: 'artist',
            }),
          );
        } catch { /* ignore quota */ }

        try {
          await supabase.auth.updateUser({
            data: {
              full_name: fullName.trim(),
              phone: fullPhone,
              dob,
              account_type: 'artist',
            },
          });
        } catch { /* non-fatal */ }

        localStorage.setItem('uf_just_signed_up', '1');
        localStorage.setItem('uf_post_verify_next', '/artist/apply');
        navigate(
          `/check-email?email=${encodeURIComponent(email)}&u=${encodeURIComponent(username)}&next=${encodeURIComponent('/artist/apply')}`,
          { state: { email, username, next: '/artist/apply' }, replace: true },
        );
        supabase.functions
          .invoke('send-verification-link', { body: { email, username, accountType: 'artist' } })
          .catch((er) => console.warn('verification email failed:', er));
      }
    } catch {
      toast.error('Something went wrong. Please try again.');
    } finally {
      setLoading(false);
    }
  };

  // Mode switch resets step
  const switchMode = (m: Mode) => {
    setMode(m);
    setStep(1);
  };

  return (
    <FadeTransition>
      <div className="min-h-[100dvh] bg-[#060608] text-foreground relative overflow-y-auto overflow-x-hidden">
        <SEOHead
          title="Become a Verified Artist on Universflow"
          description="Join Universflow for Artists. Upload your music, earn the rose verified checkmark, and reach new fans across India and beyond."
          path="/artist/auth"
        />

        {/* === CINEMATIC BACKDROP === */}
        <div
          className="fixed inset-0 pointer-events-none"
          style={{
            background:
              'radial-gradient(120% 80% at 0% 0%, hsl(340 100% 55% / 0.35) 0%, transparent 55%),' +
              'radial-gradient(90% 70% at 100% 100%, hsl(28 100% 60% / 0.18) 0%, transparent 55%),' +
              'radial-gradient(60% 40% at 50% 0%, hsl(0 0% 100% / 0.04) 0%, transparent 70%)',
          }}
        />
        <div
          className="fixed inset-0 pointer-events-none opacity-[0.05] mix-blend-overlay"
          style={{
            backgroundImage:
              'url("data:image/svg+xml;utf8,<svg xmlns=\'http://www.w3.org/2000/svg\' width=\'140\' height=\'140\'><filter id=\'n\'><feTurbulence type=\'fractalNoise\' baseFrequency=\'0.85\'/></filter><rect width=\'100%25\' height=\'100%25\' filter=\'url(%23n)\'/></svg>")',
          }}
        />

        {/* Top bar */}
        <div className="relative z-20 flex items-center justify-between px-5 pt-5">
          <Link
            to="/auth"
            className="inline-flex items-center gap-1.5 text-[11.5px] text-muted-foreground/80 hover:text-foreground transition-colors"
          >
            <ArrowLeft className="w-3.5 h-3.5" />
            Back
          </Link>
          <span className="text-[9.5px] tracking-[0.32em] uppercase text-muted-foreground/60 font-semibold">
            Universflow / Artists
          </span>
        </div>

        {/* === HERO === */}
        <section className="relative z-10 px-5 pt-6 pb-5">
          <motion.div
            initial={{ opacity: 0, y: 16 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.55, ease: [0.22, 1, 0.36, 1] }}
            className="relative rounded-[28px] overflow-hidden"
            style={{
              background:
                'linear-gradient(155deg, #FF2D55 0%, #C8133A 38%, #1a0a12 100%)',
              boxShadow:
                '0 30px 80px hsl(340 100% 30% / 0.5), inset 0 1px 0 rgba(255,255,255,0.12)',
            }}
          >
            {/* Sheen */}
            <div
              className="absolute inset-0 pointer-events-none mix-blend-overlay opacity-60"
              style={{
                background:
                  'radial-gradient(70% 60% at 80% 0%, rgba(255,255,255,0.35), transparent 60%)',
              }}
            />
            {/* Concentric arcs */}
            <svg className="absolute -right-12 -top-10 w-[220px] h-[220px] opacity-30" viewBox="0 0 200 200" fill="none">
              {[40, 60, 80, 100].map((r) => (
                <circle key={r} cx="100" cy="100" r={r} stroke="white" strokeWidth="0.5" />
              ))}
            </svg>

            <div className="relative p-5 pt-6">
              {/* Verified chip */}
              <div className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-black/30 border border-white/15 backdrop-blur-sm">
                <BadgeCheck className="w-3 h-3 text-white" fill="#FF2D55" />
                <span className="text-[9.5px] uppercase tracking-[0.22em] font-semibold text-white/90">
                  Verified Artist Program
                </span>
              </div>

              <h1 className="mt-4 font-display text-[34px] leading-[0.95] tracking-tight text-white">
                Your sound,<br />
                <span className="italic font-light">center stage.</span>
              </h1>

              <p className="mt-3 text-[13px] leading-snug text-white/85 max-w-[300px]">
                Upload your tracks, earn the rose checkmark, and reach listeners who actually care about new music.
              </p>

              {/* Honest promise strip — no fake stats, no royalty claims */}
              <div className="mt-5 grid grid-cols-3 gap-2">
                {[
                  { k: 'Uploads', v: 'Free' },
                  { k: 'Verify', v: 'Live face' },
                  { k: 'Own it', v: '100%' },
                ].map((s) => (
                  <div
                    key={s.k}
                    className="rounded-2xl px-2.5 py-2 bg-black/25 border border-white/10 backdrop-blur-sm"
                  >
                    <div className="text-[14px] font-display text-white tracking-tight leading-none">
                      {s.v}
                    </div>
                    <div className="mt-1 text-[8.5px] uppercase tracking-[0.18em] text-white/65 font-medium">
                      {s.k}
                    </div>
                  </div>
                ))}
              </div>

              <p className="mt-3 text-[10.5px] leading-snug text-white/55">
                Universflow does not currently pay royalties or per-stream payouts. Publishing is voluntary — you keep 100% of your rights.
              </p>

            </div>
          </motion.div>

          {/* Marquee strip */}
          <div className="relative mt-3 overflow-hidden h-7 rounded-full border border-white/[0.06] bg-white/[0.025]">
            <motion.div
              className="absolute inset-y-0 flex items-center gap-6 whitespace-nowrap text-[10.5px] uppercase tracking-[0.22em] text-muted-foreground/70 px-4"
              animate={{ x: ['0%', '-50%'] }}
              transition={{ duration: 28, repeat: Infinity, ease: 'linear' }}
            >
              {Array.from({ length: 2 }).flatMap((_, j) =>
                ['Independent', 'Punjabi', 'Hip-Hop', 'Indie', 'Lo-Fi', 'Pop', 'R&B', 'Classical', 'Electronic'].map((g, i) => (
                  <span key={`${j}-${i}`} className="flex items-center gap-6">
                    <span>{g}</span>
                    <span className="text-primary">●</span>
                  </span>
                )),
              )}
            </motion.div>
          </div>
        </section>

        {/* === FORM === */}
        <section className="relative z-10 px-5 pb-6">
          {/* Mode toggle */}
          <div
            className="relative grid grid-cols-2 p-1 rounded-full mb-5 mx-auto w-full max-w-[320px]"
            style={{
              background: 'rgba(255,255,255,0.04)',
              border: '1px solid rgba(255,255,255,0.07)',
            }}
          >
            <motion.div
              layout
              transition={{ type: 'spring', stiffness: 420, damping: 34 }}
              className="absolute top-1 bottom-1 rounded-full"
              style={{
                width: 'calc(50% - 4px)',
                left: isLogin ? 'calc(50% + 0px)' : 4,
                background: 'linear-gradient(180deg, #FF3B5C 0%, #E11D48 100%)',
                boxShadow: '0 6px 18px hsl(340 100% 45% / 0.45)',
              }}
            />
            {(['signup', 'login'] as Mode[]).map((m) => (
              <button
                key={m}
                type="button"
                onClick={() => switchMode(m)}
                className="relative z-10 h-9 text-[12.5px] font-semibold tracking-tight transition-colors"
                style={{ color: mode === m ? '#fff' : 'hsl(var(--muted-foreground))' }}
              >
                {m === 'signup' ? 'Join as Artist' : 'Sign in'}
              </button>
            ))}
          </div>

          {/* Step indicator (signup only) */}
          {!isLogin && (
            <div className="flex items-center justify-center gap-3 mb-4">
              {[1, 2].map((n) => (
                <div key={n} className="flex items-center gap-2">
                  <div
                    className="flex items-center justify-center w-6 h-6 rounded-full text-[10.5px] font-bold tabular-nums transition-all"
                    style={{
                      background: step >= n ? '#FF2D55' : 'rgba(255,255,255,0.06)',
                      color: step >= n ? '#fff' : 'hsl(var(--muted-foreground))',
                      boxShadow: step >= n ? '0 4px 12px hsl(340 100% 45% / 0.45)' : 'none',
                    }}
                  >
                    {step > n ? <Check className="w-3 h-3" strokeWidth={3} /> : n}
                  </div>
                  <span className="text-[10.5px] uppercase tracking-[0.18em] font-semibold text-muted-foreground/80">
                    {n === 1 ? 'Identity' : 'Secure & Verify'}
                  </span>
                  {n === 1 && <span className="text-muted-foreground/30 mx-1">·</span>}
                </div>
              ))}
            </div>
          )}

          <AnimatePresence mode="popLayout" initial={false}>
            <motion.form
              key={`${mode}-${step}`}
              onSubmit={handleSubmit}
              initial={{ opacity: 0, y: 8 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -6 }}
              transition={{ type: 'spring', stiffness: 260, damping: 32 }}

              className="relative rounded-[26px] p-5 space-y-3.5"
              style={{
                background: 'rgba(14,14,16,0.82)',
                border: '0.5px solid rgba(255,255,255,0.08)',
                boxShadow: '0 30px 80px rgba(0,0,0,0.55), inset 0 1px 0 rgba(255,255,255,0.04)',
                backdropFilter: 'blur(24px)',
                WebkitBackdropFilter: 'blur(24px)',
              }}
            >
              {/* SIGNUP STEP 1 */}
              {!isLogin && step === 1 && (
                <>
                  <div>
                    <FieldLabel>Full legal name</FieldLabel>
                    <IconInput icon={UserIcon}>
                      <Input
                        value={fullName}
                        onChange={(e) => setFullName(e.target.value.slice(0, 80))}
                        placeholder="As shown on your ID"
                        className="pl-10 h-12 text-[14px] rounded-xl border-0 bg-white/[0.04]"
                        required
                        minLength={2}
                        autoComplete="name"
                        autoFocus
                      />
                    </IconInput>
                  </div>

                  <div>
                    <FieldLabel>Stage handle</FieldLabel>
                    <IconInput icon={AtSign}>
                      <Input
                        value={username}
                        onChange={(e) => setUsername(e.target.value.replace(/[^a-zA-Z0-9_.]/g, '').slice(0, 20))}
                        placeholder="yourstagehandle"
                        className="pl-10 h-12 text-[14px] rounded-xl border-0 bg-white/[0.04]"
                        required
                        minLength={3}
                        maxLength={20}
                        autoComplete="username"
                      />
                    </IconInput>
                    {username.length >= 3 && (
                      <p className="text-[10.5px] text-muted-foreground/70 mt-1.5 pl-1">
                        Your profile: <span className="text-primary font-semibold">universflow.in/@{username}</span>
                      </p>
                    )}
                  </div>

                  <div>
                    <FieldLabel>Email</FieldLabel>
                    <IconInput icon={Mail}>
                      <Input
                        type="email"
                        placeholder="you@email.com"
                        value={email}
                        onChange={(e) => setEmail(e.target.value)}
                        className="pl-10 h-12 text-[14px] rounded-xl border-0 bg-white/[0.04]"
                        required
                        autoComplete="email"
                      />
                    </IconInput>
                  </div>
                </>
              )}

              {/* SIGNUP STEP 2 */}
              {!isLogin && step === 2 && (
                <>
                  {/* Identity recap chip */}
                  <button
                    type="button"
                    onClick={() => setStep(1)}
                    className="w-full flex items-center justify-between rounded-2xl px-3.5 py-2.5 bg-white/[0.03] border border-white/[0.06] text-left active:scale-[0.99] transition-transform"
                  >
                    <div className="min-w-0">
                      <div className="text-[10px] uppercase tracking-[0.2em] text-muted-foreground/70 font-semibold">
                        Signing up as
                      </div>
                      <div className="text-[13px] font-semibold text-foreground truncate">
                        @{username} <span className="text-muted-foreground/70 font-normal">· {email}</span>
                      </div>
                    </div>
                    <span className="text-[10.5px] text-primary font-semibold shrink-0 ml-3">Edit</span>
                  </button>

                  <div>
                    <FieldLabel>Phone number</FieldLabel>
                    <div className="flex gap-2">
                      <CountryCombobox
                        value={dialIso}
                        onChange={setDialIso}
                        variant="dial"
                        className="w-[118px] shrink-0"
                        ariaLabel="Search country phone code"
                      />
                      <IconInput icon={Phone} className="flex-1">
                        <Input
                          type="tel"
                          inputMode="numeric"
                          value={phone}
                          onChange={(e) => setPhone(e.target.value.replace(/\D/g, '').slice(0, 15))}
                          placeholder={`${PHONE_DIGITS[dial.code] ?? 'mobile'} number`}
                          className="pl-10 h-12 text-[14px] rounded-xl border-0 bg-white/[0.04]"
                          required
                          autoComplete="tel-national"
                        />
                      </IconInput>
                    </div>
                    {phone.length > 0 && !phoneCheck.ok && (
                      <p className="text-[10.5px] text-rose-300 mt-1.5 pl-1 leading-snug">
                        {phoneCheck.troll || phoneCheck.reason}
                      </p>
                    )}
                    {phoneCheck.ok && (
                      <p className="text-[10.5px] text-emerald-300 mt-1.5 pl-1">
                        ✓ Verified mobile format. Locked after signup.
                      </p>
                    )}
                    <p className="text-[10.5px] text-muted-foreground/60 mt-1 pl-1">
                      Used for account recovery. Can&apos;t be changed later.
                    </p>
                  </div>

                  <div>
                    <FieldLabel>Date of birth</FieldLabel>
                    <IconInput icon={Calendar}>
                      <Input
                        type="date"
                        value={dob}
                        max={maxDob}
                        onChange={(e) => setDob(e.target.value)}
                        className="pl-10 h-12 text-[14px] rounded-xl border-0 bg-white/[0.04]"
                        required
                      />
                    </IconInput>
                    {age !== null && age < 13 && (
                      <p className="text-[10.5px] text-rose-400 mt-1.5 pl-1">
                        You must be at least 13 years old.
                      </p>
                    )}
                  </div>

                  <div>
                    <FieldLabel>Create password</FieldLabel>
                    <IconInput icon={Lock}>
                      <Input
                        type={showPassword ? 'text' : 'password'}
                        placeholder="At least 6 characters"
                        value={password}
                        onChange={(e) => setPassword(e.target.value)}
                        className="pl-10 pr-10 h-12 text-[14px] rounded-xl border-0 bg-white/[0.04]"
                        required
                        minLength={6}
                        autoComplete="new-password"
                      />
                      <button
                        type="button"
                        className="absolute right-3 top-1/2 -translate-y-1/2 p-1.5 text-muted-foreground/70 active:scale-90 transition-transform"
                        onClick={() => setShowPassword(!showPassword)}
                        aria-label={showPassword ? 'Hide password' : 'Show password'}
                      >
                        {showPassword ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                      </button>
                    </IconInput>
                    {/* Strength meter */}
                    {password.length > 0 && (
                      <div className="mt-2 flex items-center gap-1.5">
                        {[0, 1, 2, 3].map((i) => (
                          <div
                            key={i}
                            className="h-[3px] flex-1 rounded-full transition-colors"
                            style={{
                              background:
                                i < pwStrength
                                  ? pwStrength <= 1
                                    ? '#ef4444'
                                    : pwStrength === 2
                                    ? '#f59e0b'
                                    : pwStrength === 3
                                    ? '#84cc16'
                                    : '#22c55e'
                                  : 'rgba(255,255,255,0.08)',
                            }}
                          />
                        ))}
                        <span className="text-[10px] text-muted-foreground/70 ml-1 tabular-nums w-12 text-right">
                          {['', 'Weak', 'Okay', 'Good', 'Strong'][pwStrength]}
                        </span>
                      </div>
                    )}
                  </div>

                  {/* Consents */}
                  <div className="space-y-2 pt-1">
                    <label className="flex items-start gap-2.5 cursor-pointer">
                      <input
                        type="checkbox"
                        checked={agreeTerms}
                        onChange={(e) => setAgreeTerms(e.target.checked)}
                        className="mt-0.5 w-4 h-4 accent-[#FF2D55] shrink-0"
                      />
                      <span className="text-[11.5px] leading-relaxed text-muted-foreground/90">
                        I agree to the{' '}
                        <Link to="/legal/artist-terms" target="_blank" className="underline text-primary">Artist Terms</Link>
                        {' '}and confirm I own or have rights to the music I will upload.
                      </span>
                    </label>
                    <label className="flex items-start gap-2.5 cursor-pointer">
                      <input
                        type="checkbox"
                        checked={agreePrivacy}
                        onChange={(e) => setAgreePrivacy(e.target.checked)}
                        className="mt-0.5 w-4 h-4 accent-[#FF2D55] shrink-0"
                      />
                      <span className="text-[11.5px] leading-relaxed text-muted-foreground/90">
                        I agree to the{' '}
                        <Link to="/legal/artist-privacy" target="_blank" className="underline text-primary">Artist Privacy Policy</Link>
                        , including that my ID will be deleted after review.
                      </span>
                    </label>
                  </div>
                </>
              )}

              {/* LOGIN */}
              {isLogin && (
                <>
                  <div>
                    <FieldLabel>Email</FieldLabel>
                    <IconInput icon={Mail}>
                      <Input
                        type="email"
                        placeholder="you@email.com"
                        value={email}
                        onChange={(e) => setEmail(e.target.value)}
                        className="pl-10 h-12 text-[14px] rounded-xl border-0 bg-white/[0.04]"
                        required
                        autoComplete="email"
                        autoFocus
                      />
                    </IconInput>
                  </div>
                  <div>
                    <FieldLabel>Password</FieldLabel>
                    <IconInput icon={Lock}>
                      <Input
                        type={showPassword ? 'text' : 'password'}
                        placeholder="Your password"
                        value={password}
                        onChange={(e) => setPassword(e.target.value)}
                        className="pl-10 pr-10 h-12 text-[14px] rounded-xl border-0 bg-white/[0.04]"
                        required
                        minLength={6}
                        autoComplete="current-password"
                      />
                      <button
                        type="button"
                        className="absolute right-3 top-1/2 -translate-y-1/2 p-1.5 text-muted-foreground/70 active:scale-90 transition-transform"
                        onClick={() => setShowPassword(!showPassword)}
                        aria-label={showPassword ? 'Hide password' : 'Show password'}
                      >
                        {showPassword ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                      </button>
                    </IconInput>
                  </div>
                </>
              )}

              {/* Submit / Next */}
              <div className="pt-1 flex gap-2">
                {!isLogin && step === 2 && (
                  <Button
                    type="button"
                    onClick={() => setStep(1)}
                    variant="ghost"
                    className="h-12 px-4 rounded-xl text-[13px] font-semibold text-muted-foreground hover:text-foreground"
                  >
                    Back
                  </Button>
                )}
                <Button
                  type="submit"
                  className="flex-1 h-12 text-[14px] font-semibold rounded-xl border-0 text-white active:scale-[0.98] transition-transform"
                  style={{
                    background: 'linear-gradient(180deg, #FF3B5C 0%, #E11D48 100%)',
                    boxShadow: '0 10px 28px hsl(340 100% 45% / 0.4), inset 0 1px 0 rgba(255,255,255,0.18)',
                  }}
                  disabled={
                    loading ||
                    (!isLogin && step === 1 && !step1Valid) ||
                    (!isLogin && step === 2 && !signupValid)
                  }
                >
                  {loading ? (
                    <Loader2 className="w-4 h-4 animate-spin" />
                  ) : (
                    <span className="flex items-center justify-center gap-2">
                      {isLogin
                        ? 'Sign in & continue'
                        : step === 1
                        ? 'Continue'
                        : 'Create artist account'}
                      <ArrowRight className="w-4 h-4" />
                    </span>
                  )}
                </Button>
              </div>

              <p className="text-center text-[10.5px] leading-relaxed text-muted-foreground/70 px-3 pt-1">
                {isLogin
                  ? "You'll continue to your verification application after sign-in."
                  : step === 1
                  ? 'Next: secure your account & accept artist terms.'
                  : 'Verification takes 1–3 days. We notify you the moment you\'re approved.'}
              </p>
            </motion.form>
          </AnimatePresence>

          {/* === WHAT YOU GET === */}
          {!isLogin && (
            <div className="mt-7">
              <div className="text-[10px] uppercase tracking-[0.28em] text-muted-foreground/60 font-semibold text-center mb-4">
                What you unlock
              </div>
              <div className="space-y-2.5">
                {[
                  {
                    Icon: BadgeCheck,
                    title: 'Rose Verified Checkmark',
                    body: 'Stand out in search, on profiles, and beside every track you release.',
                  },
                  {
                    Icon: TrendingUp,
                    title: 'Artist Studio & Analytics',
                    body: 'Real-time listener counts, top cities, retention, and song-by-song stats.',
                  },
                  {
                    Icon: Headphones,
                    title: 'Direct fan reach',
                    body: 'Featured in Jump Back In, New Releases, Moods and our Trending engine.',
                  },
                  {
                    Icon: Shield,
                    title: '100% royalty, KYC-protected',
                    body: 'Your ID is encrypted and auto-deleted after manual review. No middlemen.',
                  },
                ].map(({ Icon, title, body }) => (
                  <div
                    key={title}
                    className="flex gap-3 rounded-2xl p-3.5 bg-white/[0.025] border border-white/[0.05]"
                  >
                    <div
                      className="w-9 h-9 rounded-xl flex items-center justify-center shrink-0"
                      style={{
                        background: 'rgba(255,45,85,0.12)',
                        border: '0.5px solid rgba(255,45,85,0.28)',
                      }}
                    >
                      <Icon className="w-4 h-4 text-primary" strokeWidth={2} />
                    </div>
                    <div className="min-w-0">
                      <div className="text-[13px] font-semibold text-foreground tracking-tight leading-tight">
                        {title}
                      </div>
                      <div className="text-[11.5px] text-muted-foreground/80 leading-snug mt-0.5">
                        {body}
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Listener switch */}
          <p className="text-center text-[11.5px] text-muted-foreground/70 mt-7">
            Just here to listen?{' '}
            <Link to="/auth" className="text-primary font-semibold">Use the listener sign in →</Link>
          </p>

          <p className="text-[10px] tracking-[0.22em] uppercase text-muted-foreground/40 mt-6 mb-2 text-center">
            Universflow for Artists
          </p>
        </section>
      </div>
    </FadeTransition>
  );
};

function FieldLabel({ children }: { children: React.ReactNode }) {
  return (
    <label className="block text-[10.5px] uppercase tracking-[0.18em] font-semibold text-muted-foreground/70 mb-1.5 pl-1">
      {children}
    </label>
  );
}

function IconInput({
  icon: Icon,
  children,
  className = '',
}: {
  icon: React.ComponentType<{ className?: string }>;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <div className={`relative ${className}`}>
      <Icon className="absolute left-3.5 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground/70" />
      {children}
    </div>
  );
}

export default ArtistAuth;
