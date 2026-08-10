import { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import { AnimatePresence, motion } from 'framer-motion';
import { X, Lock } from 'lucide-react';
import { supabase } from '@/integrations/supabase/client';
import { toast } from 'sonner';

interface Props { isOpen: boolean; onClose: () => void; }

const ChangePasswordModal = ({ isOpen, onClose }: Props) => {
  const [mounted, setMounted] = useState(false);
  const [pw, setPw] = useState('');
  const [pw2, setPw2] = useState('');
  const [saving, setSaving] = useState(false);

  useEffect(() => setMounted(true), []);

  const submit = async () => {
    if (pw.length < 8) { toast.error('Password must be at least 8 characters'); return; }
    if (pw !== pw2) { toast.error('Passwords do not match'); return; }
    setSaving(true);
    const { error } = await supabase.auth.updateUser({ password: pw });
    setSaving(false);
    if (error) { toast.error(error.message); return; }
    toast.success('Password updated');
    setPw(''); setPw2('');
    onClose();
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
            className="pointer-events-auto w-full max-w-sm rounded-3xl bg-card/95 backdrop-blur-xl border border-white/10 p-5"
          >
            <div className="flex items-center justify-between mb-4">
              <div className="flex items-center gap-2">
                <div className="w-9 h-9 rounded-2xl bg-primary/15 flex items-center justify-center"><Lock className="w-4 h-4 text-primary" /></div>
                <h2 className="font-display text-xl tracking-tight">Change Password</h2>
              </div>
              <button onClick={onClose} aria-label="Close" className="w-8 h-8 rounded-full bg-white/10 flex items-center justify-center"><X className="w-4 h-4" /></button>
            </div>
            <input
              type="password" value={pw} onChange={(e) => setPw(e.target.value)}
              placeholder="New password"
              aria-label="New password"
              className="w-full mb-2 rounded-2xl bg-white/[0.06] border border-white/10 px-4 py-3 text-sm outline-none"
              autoComplete="new-password"
            />
            <input
              type="password" value={pw2} onChange={(e) => setPw2(e.target.value)}
              placeholder="Confirm new password"
              aria-label="Confirm new password"
              className="w-full mb-4 rounded-2xl bg-white/[0.06] border border-white/10 px-4 py-3 text-sm outline-none"
              autoComplete="new-password"
            />
            <button
              onClick={submit} disabled={saving}
              className="w-full rounded-2xl bg-primary text-primary-foreground py-3 text-sm font-semibold active:scale-[0.98] disabled:opacity-50"
            >
              {saving ? 'Updating…' : 'Update Password'}
            </button>
          </motion.div>
          </div>
        </>
      )}
    </AnimatePresence>,
    document.body
  );
};

export default ChangePasswordModal;
