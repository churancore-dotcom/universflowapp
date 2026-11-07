import { useEffect, useState } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import { Trash2, HelpCircle } from 'lucide-react';
import { iosSpring } from '@/lib/animations';
import { triggerHaptic } from '@/hooks/useHaptics';
import { subscribeConfirm, type ConfirmRequest } from '@/lib/confirmDialog';

/** Renders confirmAction() requests as the app's own bottom sheet. */
export default function ConfirmDialogHost() {
  const [req, setReq] = useState<ConfirmRequest | null>(null);

  useEffect(() => subscribeConfirm(setReq), []);

  useEffect(() => {
    if (!req) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') req.resolve(false);
      if (e.key === 'Enter') req.resolve(true);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [req]);

  const Icon = req?.destructive ? Trash2 : HelpCircle;

  return (
    <AnimatePresence>
      {req && (
        <motion.div
          key={req.id}
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.16 }}
          className="fixed inset-0 z-[300] flex items-end justify-center bg-background/75 backdrop-blur-[2px]"
          onClick={() => req.resolve(false)}
        >
          <motion.div
            role="alertdialog"
            aria-modal="true"
            aria-labelledby="uf-confirm-title"
            initial={{ y: 48, opacity: 0 }}
            animate={{ y: 0, opacity: 1 }}
            exit={{ y: 48, opacity: 0 }}
            transition={iosSpring}
            onClick={(e) => e.stopPropagation()}
            className="w-full max-w-md rounded-t-[24px] bg-card border-t border-border/60 px-6 pt-3 pb-[calc(env(safe-area-inset-bottom)+18px)]"
          >
            <div className="w-9 h-1 rounded-full bg-muted mx-auto mb-5" />
            <div className="flex items-start gap-3.5">
              <span
                className={`w-10 h-10 shrink-0 rounded-full grid place-items-center ${
                  req.destructive ? 'bg-destructive/12 text-destructive' : 'bg-primary/12 text-primary'
                }`}
              >
                <Icon className="w-[18px] h-[18px]" />
              </span>
              <div className="min-w-0 pt-0.5">
                <h2 id="uf-confirm-title" className="text-[18px] font-semibold leading-snug text-foreground break-words">
                  {req.title}
                </h2>
                {req.body && (
                  <p className="text-[14px] text-muted-foreground mt-1 leading-relaxed whitespace-pre-line">{req.body}</p>
                )}
              </div>
            </div>

            <div className="grid grid-cols-2 gap-2.5 mt-6">
              <button
                type="button"
                onClick={() => req.resolve(false)}
                className="py-3.5 rounded-xl bg-muted text-foreground font-semibold text-[15px] active:opacity-70 transition-opacity"
              >
                {req.cancelLabel}
              </button>
              <button
                type="button"
                autoFocus
                onClick={() => { triggerHaptic(req.destructive ? 'warning' : 'selection'); req.resolve(true); }}
                className={`py-3.5 rounded-xl font-semibold text-[15px] active:opacity-80 transition-opacity ${
                  req.destructive ? 'bg-destructive text-destructive-foreground' : 'bg-primary text-primary-foreground'
                }`}
              >
                {req.confirmLabel}
              </button>
            </div>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
