import { useState } from 'react';
import { Mail, Send } from 'lucide-react';
import { toast } from 'sonner';
import { useEmailVerified } from '@/hooks/useEmailVerified';

interface Props { compact?: boolean }

/**
 * Inline verify-email prompt. Renders nothing when the user is already verified
 * so parent containers (e.g. the Settings Account card) don't leave a gap.
 */
export const EmailVerificationCard = ({ compact }: Props) => {
  const { isVerified, loading, resendVerification, user } = useEmailVerified();
  const [sending, setSending] = useState(false);

  if (loading || isVerified || !user) return null;

  const send = async () => {
    setSending(true);
    try {
      const ok = await resendVerification();
      if (ok) toast.success('Verification link sent — check your inbox');
      else toast.error('Could not send verification email');
    } finally { setSending(false); }
  };

  return (
    <div className={`rounded-2xl border border-amber-500/25 bg-amber-500/10 ${compact ? 'px-3 py-2.5' : 'p-4'} flex items-center gap-3`}>
      <div className="w-8 h-8 rounded-xl bg-amber-500/20 flex items-center justify-center shrink-0">
        <Mail className="w-4 h-4 text-amber-400" />
      </div>
      <div className="flex-1 min-w-0">
        <p className="text-xs font-semibold text-amber-100">Verify your email</p>
        <p className="text-[10px] text-amber-200/70 truncate">We sent a link to {user.email}</p>
      </div>
      <button
        onClick={send}
        disabled={sending}
        className="inline-flex items-center gap-1 text-[11px] font-semibold px-2.5 py-1.5 rounded-lg bg-amber-500 text-black active:scale-95 disabled:opacity-50"
      >
        <Send className="w-3 h-3" />
        {sending ? 'Sending…' : 'Resend'}
      </button>
    </div>
  );
};

export default EmailVerificationCard;
