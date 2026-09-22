/**
 * Moment capture sheet — bookmark the exact second that hit, tag how it felt.
 */
import { useState } from 'react';
import { motion } from 'framer-motion';
import { X, Sparkles } from 'lucide-react';
import { toast } from 'sonner';
import { useNavigate } from '@/lib/router-compat';
import type { Song } from '@/contexts/PlayerContext';
import { FEELINGS, formatMomentStamp, type MomentInput } from '@/lib/moments';
import { triggerHaptic } from '@/hooks/useHaptics';

interface MomentCaptureSheetProps {
  song: Song;
  positionMs: number;
  onClose: () => void;
  onSave: (input: MomentInput) => Promise<unknown>;
}

const MomentCaptureSheet = ({ song, positionMs, onClose, onSave }: MomentCaptureSheetProps) => {
  const [feeling, setFeeling] = useState<string | null>(null);
  const [note, setNote] = useState('');
  const [saving, setSaving] = useState(false);
  const navigate = useNavigate();

  const handleSave = async () => {
    setSaving(true);
    try {
      await onSave({ song, positionMs, feeling, note });
      triggerHaptic('success');
      toast.success('Moment saved', {
        description: `${song.title} at ${formatMomentStamp(positionMs)} is on your tape.`,
        action: { label: 'Open tape', onClick: () => navigate('/moments') },
      });
      onClose();
    } catch {
      toast.error('Could not save that moment', { description: 'Check your connection and try again.' });
    } finally {
      setSaving(false);
    }
  };

  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      className="fixed inset-0 z-[210] flex items-end bg-black/70"
      onClick={onClose}
    >
      <motion.div
        initial={{ y: '100%' }}
        animate={{ y: 0 }}
        exit={{ y: '100%' }}
        transition={{ type: 'spring', stiffness: 320, damping: 32 }}
        onClick={(e) => e.stopPropagation()}
        className="w-full rounded-t-3xl border-t border-primary/30 bg-card p-6 pb-8"
      >
        <div className="mb-5 flex items-start justify-between gap-3">
          <div>
            <p className="mb-1 flex items-center gap-1.5 text-[10px] font-bold uppercase tracking-[0.2em] text-primary">
              <Sparkles className="h-3 w-3" /> Save this moment
            </p>
            <h2 className="text-[19px] font-bold leading-tight">{song.title}</h2>
            <p className="text-[12px] text-muted-foreground">
              {song.artist} · at {formatMomentStamp(positionMs)}
            </p>
          </div>
          <button onClick={onClose} aria-label="Close" className="rounded-full bg-foreground/10 p-2">
            <X className="h-4 w-4" />
          </button>
        </div>

        <p className="mb-2 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">How did it feel?</p>
        <div className="mb-5 flex flex-wrap gap-2">
          {FEELINGS.map((f) => (
            <button
              key={f.id}
              type="button"
              onClick={() => { triggerHaptic('selection'); setFeeling(feeling === f.id ? null : f.id); }}
              className={`rounded-full border px-3 py-1.5 text-[12px] font-medium transition-colors ${
                feeling === f.id
                  ? 'border-primary bg-primary/15 text-primary'
                  : 'border-border bg-foreground/5 text-muted-foreground'
              }`}
            >
              <span className="mr-1">{f.emoji}</span>{f.label}
            </button>
          ))}
        </div>

        <textarea
          value={note}
          onChange={(e) => setNote(e.target.value.slice(0, 180))}
          placeholder="Where were you? What happened? (optional)"
          rows={2}
          className="mb-5 w-full resize-none rounded-2xl border border-border bg-background/60 p-3 text-[13px] outline-none focus:border-primary/60"
        />

        <button
          type="button"
          onClick={handleSave}
          disabled={saving}
          className="w-full rounded-full bg-primary py-3.5 text-[14px] font-bold text-primary-foreground active:scale-[0.98] disabled:opacity-60"
        >
          {saving ? 'Saving…' : 'Add to my tape'}
        </button>
      </motion.div>
    </motion.div>
  );
};

export default MomentCaptureSheet;
