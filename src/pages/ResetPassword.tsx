import { useEffect, useState } from 'react';
import { useNavigate } from '@/lib/router-compat';
import { motion } from 'framer-motion';
import { Lock, Eye, EyeOff, ArrowRight, Loader2 } from 'lucide-react';
import { supabase } from '@/integrations/supabase/client';
import { toast } from 'sonner';
import SEOHead from '@/components/SEOHead';
import { FadeTransition } from '@/components/PageTransition';

const ResetPassword = () => {
  const navigate = useNavigate();
  const [pw, setPw] = useState('');
  const [pw2, setPw2] = useState('');
  const [show, setShow] = useState(false);
  const [saving, setSaving] = useState(false);
  const [ready, setReady] = useState(false);
  const [invalid, setInvalid] = useState(false);

  // Supabase parses the recovery hash in the URL and fires PASSWORD_RECOVERY.
  // Wait for a session before allowing the update so we don't silently no-op.
  useEffect(() => {
    let mounted = true;
    const { data: { subscription } } = supabase.auth.onAuthStateChange((event, session) => {
      if (!mounted) return;
      if (event === 'PASSWORD_RECOVERY' || (event === 'SIGNED_IN' && session)) {
        setReady(true);
      }
    });
    // If we already have a session (link consumed on load), enable immediately.
    supabase.auth.getSession().then(({ data: { session } }) => {
      if (!mounted) return;
      if (session) setReady(true);
      // Give the URL-hash parser a moment before declaring the link dead.
      setTimeout(() => {
        if (!mounted) return;
        if (!session && !window.location.hash.includes('access_token')) {
          setInvalid(true);
        }
      }, 800);
    });
    return () => { mounted = false; subscription.unsubscribe(); };
  }, []);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (pw.length < 8) { toast.error('Password must be at least 8 characters'); return; }
    if (pw !== pw2) { toast.error('Passwords do not match'); return; }
    setSaving(true);
    const { error } = await supabase.auth.updateUser({ password: pw });
    setSaving(false);
    if (error) { toast.error(error.message); return; }
    toast.success('Password updated. You are signed in.');
    navigate('/', { replace: true });
  };

  return (
    <FadeTransition>
      <div className="min-h-[100dvh] bg-background text-foreground flex flex-col items-center justify-center px-6">
        <SEOHead title="Reset password — Universflow" description="Set a new password for your Universflow account." path="/reset-password" />
        <motion.div
          initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }}
          className="w-full max-w-sm rounded-3xl p-6 border border-white/10 bg-card/80 backdrop-blur-xl"
        >
          <div className="flex items-center gap-2 mb-4">
            <div className="w-10 h-10 rounded-2xl bg-primary/15 flex items-center justify-center">
              <Lock className="w-5 h-5 text-primary" />
            </div>
            <h1 className="font-display text-2xl tracking-tight">Set new password</h1>
          </div>

          {invalid && !ready ? (
            <div className="text-sm text-muted-foreground leading-relaxed">
              This reset link is invalid or has expired. Head back to sign in and request a new one.
              <button
                onClick={() => navigate('/auth', { replace: true })}
                className="mt-4 w-full rounded-2xl bg-primary text-primary-foreground py-3 text-sm font-semibold"
              >
                Back to sign in
              </button>
            </div>
          ) : (
            <form onSubmit={submit} className="space-y-3">
              <div className="relative">
                <Lock className="absolute left-3.5 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground/70" />
                <input
                  type={show ? 'text' : 'password'}
                  value={pw} onChange={(e) => setPw(e.target.value)}
                  placeholder="New password"
                  aria-label="New password"
                  autoComplete="new-password"
                  minLength={8}
                  required
                  className="w-full pl-10 pr-10 rounded-2xl bg-white/[0.06] border border-white/10 py-3 text-sm outline-none"
                />
                <button type="button" onClick={() => setShow(!show)} aria-label={show ? 'Hide password' : 'Show password'}
                  className="absolute right-3 top-1/2 -translate-y-1/2 p-1.5 text-muted-foreground/70">
                  {show ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                </button>
              </div>
              <div className="relative">
                <Lock className="absolute left-3.5 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground/70" />
                <input
                  type={show ? 'text' : 'password'}
                  value={pw2} onChange={(e) => setPw2(e.target.value)}
                  placeholder="Confirm new password"
                  aria-label="Confirm new password"
                  autoComplete="new-password"
                  minLength={8}
                  required
                  className="w-full pl-10 rounded-2xl bg-white/[0.06] border border-white/10 py-3 text-sm outline-none"
                />
              </div>
              <button
                type="submit"
                disabled={saving || !ready}
                className="w-full rounded-2xl bg-primary text-primary-foreground py-3 text-sm font-semibold active:scale-[0.98] disabled:opacity-50 flex items-center justify-center gap-2"
              >
                {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : (<>Update password <ArrowRight className="w-4 h-4" /></>)}
              </button>
              {!ready && !invalid && (
                <p className="text-[11px] text-muted-foreground text-center">Verifying reset link…</p>
              )}
            </form>
          )}
        </motion.div>
      </div>
    </FadeTransition>
  );
};

export default ResetPassword;
