import { useEffect, useState } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import { X, Copy, Check, Share2, Link2 } from 'lucide-react';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/contexts/AuthContext';
import { toast } from 'sonner';

interface Props {
  isOpen: boolean;
  onClose: () => void;
}

const ShareProfileSheet = ({ isOpen, onClose }: Props) => {
  const { user } = useAuth();
  const [shareUrl, setShareUrl] = useState<string>('');
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    if (!isOpen || !user) return;
    (async () => {
      let { data } = await supabase.from('profiles').select('share_code').eq('user_id', user.id).single();
      let code = data?.share_code;
      if (!code) {
        code = Math.random().toString(36).slice(2, 10);
        await supabase.from('profiles').update({ share_code: code }).eq('user_id', user.id);
      }
      const origin = typeof window !== 'undefined' ? window.location.origin : 'https://universflow.in';
      setShareUrl(`${origin}/u/${code}`);
    })();
  }, [isOpen, user]);

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(shareUrl);
      setCopied(true);
      toast.success('Link copied');
      setTimeout(() => setCopied(false), 1500);
    } catch { toast.error('Copy failed'); }
  };

  const nativeShare = async () => {
    if (navigator.share) {
      try { await navigator.share({ title: 'My Univers Flow profile', url: shareUrl }); } catch { /* cancelled */ }
    } else {
      copy();
    }
  };

  return (
    <AnimatePresence>
      {isOpen && (
        <>
          <motion.div
            initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
            onClick={onClose}
            className="fixed inset-0 z-[80] bg-black/70 backdrop-blur-md"
          />
          <motion.div
            initial={{ y: '100%' }} animate={{ y: 0 }} exit={{ y: '100%' }}
            transition={{ type: 'spring', damping: 30, stiffness: 300 }}
            className="fixed left-0 right-0 bottom-0 z-[81] rounded-t-[28px] bg-card/95 backdrop-blur-xl border-t border-white/10 p-5 pb-8"
          >
            <div className="flex items-center justify-between mb-4">
              <h2 className="font-display text-2xl tracking-tight">Share Profile</h2>
              <button onClick={onClose} aria-label="Close" className="w-9 h-9 rounded-full bg-white/10 flex items-center justify-center active:scale-90">
                <X className="w-4 h-4" />
              </button>
            </div>
            <p className="text-[10px] font-black uppercase tracking-[0.24em] text-white/40 mb-2">Your Link</p>
            <div className="flex items-center gap-2 rounded-2xl bg-white/[0.06] border border-white/10 px-3 py-3 mb-4">
              <Link2 className="w-4 h-4 text-white/40 shrink-0" />
              <p className="text-sm truncate flex-1">{shareUrl || '…'}</p>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <button onClick={copy} className="rounded-2xl bg-white/[0.06] border border-white/10 py-3 flex items-center justify-center gap-2 text-sm font-semibold active:scale-[0.98]">
                {copied ? <Check className="w-4 h-4 text-green-400" /> : <Copy className="w-4 h-4" />}
                {copied ? 'Copied' : 'Copy link'}
              </button>
              <button onClick={nativeShare} className="rounded-2xl bg-primary text-primary-foreground py-3 flex items-center justify-center gap-2 text-sm font-semibold active:scale-[0.98]">
                <Share2 className="w-4 h-4" /> Share
              </button>
            </div>
          </motion.div>
        </>
      )}
    </AnimatePresence>
  );
};

export default ShareProfileSheet;
