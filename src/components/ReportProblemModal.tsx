import { useState } from 'react';
import { createPortal } from 'react-dom';
import { motion, AnimatePresence } from 'framer-motion';
import { X, Flag, Bug, Music, User, AlertTriangle, Lightbulb, Loader2 } from 'lucide-react';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/contexts/AuthContext';
import { toast } from 'sonner';

const CATEGORIES = [
  { id: 'bug', label: 'Bug or crash', icon: Bug },
  { id: 'song', label: 'Song or audio issue', icon: Music },
  { id: 'user', label: 'User or content', icon: User },
  { id: 'suggestion', label: 'Suggestion', icon: Lightbulb },
  { id: 'other', label: 'Something else', icon: AlertTriangle },
] as const;

interface Props {
  isOpen: boolean;
  onClose: () => void;
}

const ReportProblemModal = ({ isOpen, onClose }: Props) => {
  const { user } = useAuth();
  const [category, setCategory] = useState<string>('bug');
  const [details, setDetails] = useState('');
  const [sending, setSending] = useState(false);

  const reset = () => {
    setCategory('bug');
    setDetails('');
  };

  const handleSubmit = async () => {
    if (!user) {
      toast.error('Sign in to send a report');
      return;
    }
    const trimmed = details.trim();
    if (trimmed.length < 10) {
      toast.error('Please describe the issue in at least 10 characters');
      return;
    }
    if (trimmed.length > 1000) {
      toast.error('Please keep it under 1000 characters');
      return;
    }
    setSending(true);
    try {
      const label = CATEGORIES.find(c => c.id === category)?.label ?? 'Other';
      const { error } = await supabase.from('content_reports').insert({
        reporter_id: user.id,
        content_type: category,
        content_id: user.id,
        reason: label,
        details: trimmed,
        status: 'pending',
      });
      if (error) throw error;
      toast.success('Report sent — thank you!');
      reset();
      onClose();
    } catch (e) {
      console.error('Report submit failed:', e);
      toast.error('Could not send the report. Try again later.');
    } finally {
      setSending(false);
    }
  };

  return createPortal(
    <AnimatePresence>
      {isOpen && (
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          className="fixed inset-0 z-[200] flex items-end sm:items-center justify-center bg-black/60"
          onClick={onClose}
        >
          <motion.div
            initial={{ y: 60, opacity: 0 }}
            animate={{ y: 0, opacity: 1 }}
            exit={{ y: 60, opacity: 0 }}
            transition={{ type: 'spring', damping: 26, stiffness: 300 }}
            className="w-full sm:max-w-md bg-card border border-border rounded-t-3xl sm:rounded-3xl p-5 pb-8 max-h-[85dvh] overflow-y-auto"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between mb-4">
              <div className="flex items-center gap-2">
                <Flag className="w-5 h-5 text-primary" />
                <h2 className="text-lg font-bold">Report a Problem</h2>
              </div>
              <button onClick={onClose} className="p-2 rounded-full hover:bg-muted" aria-label="Close">
                <X className="w-5 h-5" />
              </button>
            </div>

            <p className="text-sm text-muted-foreground mb-3">What's this about?</p>
            <div className="grid grid-cols-2 gap-2 mb-4">
              {CATEGORIES.map(({ id, label, icon: Icon }) => (
                <button
                  key={id}
                  onClick={() => setCategory(id)}
                  className={`flex items-center gap-2 px-3 py-2.5 rounded-xl border text-sm transition-colors ${
                    category === id
                      ? 'border-primary bg-primary/10 text-foreground'
                      : 'border-border bg-muted/40 text-muted-foreground'
                  }`}
                >
                  <Icon className="w-4 h-4 shrink-0" />
                  {label}
                </button>
              ))}
            </div>

            <p className="text-sm text-muted-foreground mb-2">Tell us more</p>
            <textarea
              value={details}
              onChange={(e) => setDetails(e.target.value)}
              placeholder="Describe what happened, which page you were on, and what you expected…"
              rows={4}
              maxLength={1000}
              className="w-full rounded-xl border border-border bg-muted/40 px-3 py-2.5 text-sm outline-none focus:border-primary resize-none"
            />
            <p className="text-xs text-muted-foreground text-right mb-4">{details.length}/1000</p>

            <button
              onClick={handleSubmit}
              disabled={sending}
              className="w-full py-3 rounded-xl bg-primary text-primary-foreground font-semibold disabled:opacity-50 flex items-center justify-center gap-2"
            >
              {sending && <Loader2 className="w-4 h-4 animate-spin" />}
              Send Report
            </button>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>,
    document.body
  );
};

export default ReportProblemModal;
