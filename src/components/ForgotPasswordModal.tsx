import { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import { AnimatePresence, motion } from 'framer-motion';
import { X, Mail, Send } from 'lucide-react';
import { supabase } from '@/integrations/supabase/client';
import { toast } from 'sonner';
import {
  getCooldownMs,
  registerFailure,
  clearCooldown,
  formatCooldown,
} from '@/lib/authCooldown';

interface Props {
  isOpen: boolean;
  onClose: () => void;
  defaultEmail?: string;
}

const ForgotPasswordModal = ({ isOpen, onClose, defaultEmail = '' }: Props) => {
  const [email, setEmail] = useState(defaultEmail);
  const [sending, setSending] = useState(false);
  const [cooldownMs, setCooldownMs] = useState(0);

  useEffect(() => { if (isOpen) setEmail(defaultEmail); }, [isOpen, defaultEmail]);

  // Live countdown while locked.
  useEffect(() => {
    if (!isOpen || !email) { setCooldownMs(0); return; }
    const tick = () => setCooldownMs(getCooldownMs('reset', email));
    tick();
    const t = setInterval(tick, 1000);
    return () => clearInterval(t);
  }, [isOpen, email]);

  const submit = async () => {
    const trimmed = email.trim();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(trimmed)) {
      toast.error('Enter a valid email address');
      return;
    }
    const locked = getCooldownMs('reset', trimmed);
    if (locked > 0) {
      toast.error(`Too many attempts. Try again in ${formatCooldown(locked)}.`);
      return;
    }
    setSending(true);
    try {
      const { error } = await supabase.functions.invoke('send-reset-email', {
        body: {
          email: trimmed,
          redirectTo: `${window.location.origin}/reset-password`,
        },
      });
      if (error) {
        const lock = registerFailure('reset', trimmed);
        setCooldownMs(lock);
        toast.error('Could not send reset email');
        return;
      }
      registerFailure('reset', trimmed);
      clearCooldown('login', trimmed);
      toast.success('Password reset link sent. Check your inbox.');
      onClose();
    } catch {
      toast.error('Something went wrong. Please try again.');
    } finally {
      setSending(false);
    }
  };

  const locked = cooldownMs > 0;

  return createPortal(
    <AnimatePresence>


      {isOpen && (
        <>
          <motion.div
            initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
            onClick={onClose}
            className="fixed inset-0 z-[80] bg-black/70 backdrop-blur-md"
          />
          <div className="fixed inset-0 z-[81] flex items-center justify-center p-4 pointer-events-none">
          <motion.div
            initial={{ y: 40, opacity: 0 }} animate={{ y: 0, opacity: 1 }} exit={{ y: 40, opacity: 0 }}
            className="pointer-events-auto w-full max-w-sm rounded-3xl bg-card/95 backdrop-blur-xl border border-white/10 p-5"
          >
            <div className="flex items-center justify-between mb-4">
              <div className="flex items-center gap-2">
                <div className="w-9 h-9 rounded-2xl bg-primary/15 flex items-center justify-center">
                  <Mail className="w-4 h-4 text-primary" />
                </div>
                <h2 className="font-display text-xl tracking-tight">Reset password</h2>
              </div>
              <button onClick={onClose} aria-label="Close" className="w-8 h-8 rounded-full bg-white/10 flex items-center justify-center">
                <X className="w-4 h-4" />
              </button>
            </div>
            <p className="text-xs text-muted-foreground mb-4 leading-relaxed">
              Enter your account email and we'll send you a link to set a new password.
            </p>
            <input
              type="email"
              inputMode="email"
              autoComplete="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="you@email.com"
              className="w-full mb-4 rounded-2xl bg-white/[0.06] border border-white/10 px-4 py-3 text-sm outline-none"
            />
            <button
              onClick={submit}
              disabled={sending || locked}
              className="w-full rounded-2xl bg-primary text-primary-foreground py-3 text-sm font-semibold active:scale-[0.98] disabled:opacity-50 flex items-center justify-center gap-2"
            >
              {locked
                ? `Try again in ${formatCooldown(cooldownMs)}`
                : sending ? 'Sending…' : (<><Send className="w-4 h-4" /> Send reset link</>)}
            </button>
          </motion.div>
        </>
      )}
    </AnimatePresence>,
    document.body
  );
};

export default ForgotPasswordModal;
