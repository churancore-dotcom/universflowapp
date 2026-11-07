import { useEffect, useState } from 'react';
import { ArrowLeft, ArrowRight, Trash2 } from 'lucide-react';
import { useAuth } from '@/contexts/AuthContext';
import { useNavigate } from '@/lib/router-compat';
import { toast } from 'sonner';
import { useServerFn } from '@tanstack/react-start';
import { requestAccountDeletion } from '@/lib/accountDeletion.functions';
import { DELETION_REASONS } from '@/lib/accountNoticeRules';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Dialog, DialogContent, DialogTitle, DialogDescription } from '@/components/ui/dialog';

interface Props { isOpen: boolean; onClose: () => void; }

export default function DeleteAccountModal({ isOpen, onClose }: Props) {
  const { user, signOut } = useAuth();
  const navigate = useNavigate();
  const scheduleDeletion = useServerFn(requestAccountDeletion);
  const [step, setStep] = useState(0);
  const [reason, setReason] = useState('');
  const [details, setDetails] = useState('');
  const [confirm, setConfirm] = useState('');
  const [loading, setLoading] = useState(false);
  useEffect(() => {
    if (isOpen) { setStep(0); setReason(''); setDetails(''); setConfirm(''); }
  }, [isOpen]);

  const submit = async () => {
    if (!user || confirm !== 'DELETE' || loading) return;
    setLoading(true);
    try {
      const result = await scheduleDeletion({ data: { reason, details } });
      const date = new Date(result.deleteAfter).toLocaleDateString(undefined, { day: 'numeric', month: 'long', year: 'numeric' });
      toast.success(`Deletion scheduled for ${date}`);
      onClose();
      await signOut();
      navigate('/auth');
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Failed to schedule deletion');
    } finally { setLoading(false); }
  };

  return <Dialog open={isOpen} onOpenChange={open => { if (!open && !loading) onClose(); }}>
    <DialogContent className="w-[calc(100%-2rem)] max-w-sm max-h-[85dvh] overflow-y-auto rounded-lg border border-border bg-background text-foreground">
      <p className="text-xs text-muted-foreground">Account deletion · {step + 1} of 3</p>
      <DialogTitle className="pr-8 text-xl">{['Why are you leaving?', 'Before you go', 'Confirm account deletion'][step]}</DialogTitle>
      <DialogDescription>{step === 0 ? 'Your feedback is optional and will be shared with the Univers Flow team.' : 'You can cancel your request within seven days. Admin review will not delay deletion.'}</DialogDescription>
      {step === 0 && <>
        <fieldset className="space-y-2">
          <legend className="sr-only">Reason for leaving</legend>
          {DELETION_REASONS.map(option => <label key={option} className="flex items-center gap-3 rounded-md border border-border p-3 text-sm cursor-pointer">
            <input type="radio" name="deletion-reason" value={option} checked={reason === option} onChange={() => setReason(option)} className="accent-primary" />{option}
          </label>)}
        </fieldset>
        <label className="text-sm">Anything else? <span className="text-muted-foreground">(optional)</span>
          <textarea value={details} onChange={event => setDetails(event.target.value)} maxLength={1500} rows={3} placeholder="What could we do better?" className="mt-2 w-full rounded-md border border-input bg-background p-3 text-sm" />
        </label>
      </>}
      {step === 1 && <div className="space-y-4 text-sm leading-relaxed">
        <p>Your profile, library, playlists and eligible account data will be permanently removed after the seven-day recovery period. Records required by law may be retained.</p>
        <p>You will be signed out after confirming. Sign back in and choose <strong>Settings → Cancel Account Deletion</strong> before the deadline to keep your account.</p>
        <p>Deleting your account does not automatically create a payment refund.</p>
      </div>}
      {step === 2 && <>
        <div className="border-y border-border py-3 text-sm space-y-2">
          <p className="break-all">{user?.email}</p>
          <p className="text-muted-foreground">Reason: {reason || 'Prefer not to say'}</p>
          <p className="text-muted-foreground">Recovery period: seven days</p>
        </div>
        <label className="text-sm">Type DELETE to confirm
          <Input className="mt-2" value={confirm} onChange={event => setConfirm(event.target.value)} autoComplete="off" aria-label="Type DELETE to confirm account deletion" placeholder="DELETE" />
        </label>
      </>}
      <div className="flex gap-2">
        <Button variant="outline" className="flex-1" disabled={loading} onClick={() => step > 0 ? setStep(step - 1) : onClose()}><ArrowLeft className="w-4 h-4 mr-2" />{step > 0 ? 'Back' : 'Keep account'}</Button>
        {step < 2 ? <Button className="flex-1" onClick={() => setStep(step + 1)}>Continue<ArrowRight className="w-4 h-4 ml-2" /></Button> : <Button variant="destructive" className="flex-1" disabled={loading || confirm !== 'DELETE'} onClick={submit}><Trash2 className="w-4 h-4 mr-2" />{loading ? 'Scheduling…' : 'Delete account'}</Button>}
      </div>
    </DialogContent>
  </Dialog>;
}