import { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import { AnimatePresence, motion } from 'framer-motion';
import { X, AlertTriangle } from 'lucide-react';
import { useAuth } from '@/contexts/AuthContext';
import { useNavigate } from '@/lib/router-compat';
import { toast } from 'sonner';
import { useServerFn } from '@tanstack/react-start';
import { requestAccountDeletion } from '@/lib/accountDeletion.functions';
import { Button } from '@/components/ui/button';

interface Props { isOpen: boolean; onClose: () => void; }

const DeleteAccountModal = ({ isOpen, onClose }: Props) => {
  const [mounted, setMounted] = useState(false);
  const { user, signOut } = useAuth();
  const navigate = useNavigate();
  const [confirm, setConfirm] = useState('');
  const [loading, setLoading] = useState(false);
  const scheduleDeletion = useServerFn(requestAccountDeletion);

  useEffect(() => setMounted(true), []);

  const submit = async () => {
    if (!user) return;
    if (confirm !== 'DELETE') { toast.error('Type DELETE to confirm'); return; }
    setLoading(true);
    try {
      const result = await scheduleDeletion();
      const date = new Date(result.deleteAfter).toLocaleDateString(undefined, { day: 'numeric', month: 'long', year: 'numeric' });
      toast.success(`Deletion scheduled for ${date}`);
      await signOut();
      navigate('/auth');
    } catch (e) {
      const msg = e instanceof Error ? e.message : 'Failed to schedule deletion';
      toast.error(msg);
    } finally {
      setLoading(false);
    }
  };

  if (!mounted) return null;

  return createPortal(
    <AnimatePresence>
      {isOpen && (
        <>
          <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} onClick={onClose} className="fixed inset-0 z-[80] bg-black/70 backdrop-blur-md" />
          <div className="fixed inset-0 z-[81] flex items-center justify-center p-4 pointer-events-none">
          <motion.div
            initial={{ y: 40, opacity: 0 }} animate={{ y: 0, opacity: 1 }} exit={{ y: 40, opacity: 0 }}
            className="pointer-events-auto w-full max-w-sm rounded-3xl bg-card/95 backdrop-blur-xl border border-destructive/40 p-5"
          >
            <div className="flex items-center justify-between mb-3">
              <div className="flex items-center gap-2">
                <div className="w-9 h-9 rounded-2xl bg-destructive/15 flex items-center justify-center"><AlertTriangle className="w-4 h-4 text-destructive" /></div>
                <h2 className="font-display text-xl tracking-tight">Delete Account</h2>
              </div>
              <Button type="button" variant="ghost" size="icon" onClick={onClose} aria-label="Close" className="rounded-full bg-foreground/10"><X className="w-4 h-4" /></Button>
            </div>
            <p className="text-sm text-white/60 mb-4 leading-relaxed">
              Your account will be scheduled for permanent deletion in 7 days. Sign back in before then to cancel. After the deadline, deletion cannot be undone; records required by law may be retained.
            </p>
            <p className="text-[11px] font-black uppercase tracking-[0.2em] text-white/40 mb-1.5">Type <span className="text-destructive">DELETE</span> to confirm</p>
            <input
              value={confirm} onChange={(e) => setConfirm(e.target.value)}
              placeholder="DELETE"
              aria-label="Type DELETE to confirm account deletion"
              className="w-full mb-4 rounded-2xl bg-white/[0.06] border border-white/10 px-4 py-3 text-sm outline-none font-mono"
            />
            <Button
              type="button"
              variant="destructive"
              onClick={submit} disabled={loading || confirm !== 'DELETE'}
              className="w-full rounded-2xl py-3 h-auto"
            >
              {loading ? 'Scheduling…' : 'Schedule Account Deletion'}
            </Button>
          </motion.div>
          </div>
        </>
      )}
    </AnimatePresence>,
    document.body
  );
};

export default DeleteAccountModal;
