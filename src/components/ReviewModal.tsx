import { useEffect, useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Star, X, Loader2, Heart } from 'lucide-react';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/contexts/AuthContext';
import { useEmailVerified } from '@/hooks/useEmailVerified';
import { triggerHaptic } from '@/hooks/useHaptics';
import { toast } from 'sonner';

interface Props {
  isOpen: boolean;
  onClose: () => void;
  onSubmitted?: () => void;
}

const ReviewModal = ({ isOpen, onClose, onSubmitted }: Props) => {
  const { user } = useAuth();
  const { requireVerified } = useEmailVerified();
  const [rating, setRating] = useState(0);
  const [hover, setHover] = useState(0);
  const [comment, setComment] = useState('');
  const [displayName, setDisplayName] = useState('');
  const [needsName, setNeedsName] = useState(false);
  const [saving, setSaving] = useState(false);
  const [done, setDone] = useState(false);

  useEffect(() => {
    if (!isOpen || !user) return;
    (async () => {
      const { data: profile } = await supabase
        .from('profiles')
        .select('username')
        .eq('user_id', user.id)
        .maybeSingle();
      const name = profile?.username || '';
      if (!name) setNeedsName(true);
      setDisplayName(name);
    })();
  }, [isOpen, user]);

  const handleSubmit = async () => {
    if (!user) return;
    if (!requireVerified('post a review')) return;
    if (rating === 0) {
      toast.error('Please pick a star rating');
      return;
    }
    const finalName = displayName.trim();
    if (!finalName || finalName.length < 2) {
      toast.error('Please enter your name first');
      return;
    }
    setSaving(true);
    try {
      // If user has no username yet, save it on profile too
      if (needsName) {
        await supabase.from('profiles').update({ username: finalName }).eq('user_id', user.id);
      }
      const { error } = await supabase.from('app_reviews').insert({
        user_id: user.id,
        rating,
        comment: comment.trim() || null,
        display_name: finalName,
      });
      if (error) throw error;
      localStorage.setItem('uf_reviewed', '1');
      triggerHaptic('success');
      setDone(true);
      onSubmitted?.();
      setTimeout(() => { onClose(); setDone(false); setRating(0); setComment(''); }, 1800);
    } catch (e: any) {
      const msg = e?.code === '23505' ? 'You have already reviewed — thank you!' : (e?.message || 'Could not save your review');
      toast.error(msg);
      if (e?.code === '23505') {
        localStorage.setItem('uf_reviewed', '1');
        onClose();
      }
    } finally {
      setSaving(false);
    }
  };

  return (
    <AnimatePresence>
      {isOpen && (
        <motion.div
          className="fixed inset-0 z-[210] flex items-end justify-center"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          onClick={onClose}
          style={{ background: 'rgba(0,0,0,0.7)', backdropFilter: 'blur(20px)' }}
        >
          <motion.div
            initial={{ y: '100%' }}
            animate={{ y: 0 }}
            exit={{ y: '100%' }}
            transition={{ type: 'spring', stiffness: 320, damping: 32 }}
            onClick={(e) => e.stopPropagation()}
            className="w-full max-w-md rounded-t-3xl p-5 pb-8 bg-card border-t border-border/50"
          >
            <div className="flex items-center justify-between mb-4">
              <div className="w-9" />
              <div className="w-12 h-1 rounded-full bg-border" />
              <button onClick={onClose} className="w-9 h-9 rounded-full bg-muted/40 flex items-center justify-center">
                <X className="w-4 h-4" />
              </button>
            </div>

            {done ? (
              <motion.div
                initial={{ scale: 0.6, opacity: 0 }}
                animate={{ scale: 1, opacity: 1 }}
                className="text-center py-8"
              >
                <div className="inline-flex w-16 h-16 rounded-full items-center justify-center mb-3" style={{ background: 'linear-gradient(135deg, #FF2D55, #FF6482)' }}>
                  <Heart className="w-8 h-8 text-white fill-white" />
                </div>
                <h3 className="text-xl font-extrabold">Thank you, {displayName.split(' ')[0]}!</h3>
                <p className="text-sm text-muted-foreground mt-1">Your love keeps Universflow alive ❤️</p>
              </motion.div>
            ) : (
              <>
                <h3 className="text-xl font-extrabold text-center">Share your experience</h3>
                <p className="text-xs text-muted-foreground text-center mt-1">Your honest review helps us grow 🚀</p>

                {/* Stars */}
                <div className="flex justify-center gap-1.5 my-5">
                  {[1, 2, 3, 4, 5].map(n => (
                    <button
                      key={n}
                      onClick={() => { triggerHaptic('impactLight'); setRating(n); }}
                      onMouseEnter={() => setHover(n)}
                      onMouseLeave={() => setHover(0)}
                    >
                      <motion.div whileTap={{ scale: 0.85 }}>
                        <Star
                          className={`w-9 h-9 ${(hover || rating) >= n ? 'fill-yellow-400 text-yellow-400' : 'text-muted-foreground/40'}`}
                        />
                      </motion.div>
                    </button>
                  ))}
                </div>

                {needsName && (
                  <input
                    type="text"
                    placeholder="Your name (shown on review)"
                    value={displayName}
                    onChange={(e) => setDisplayName(e.target.value)}
                    maxLength={40}
                    className="w-full h-11 px-4 mb-3 rounded-xl bg-muted/40 border border-border/50 text-sm focus:outline-none focus:border-primary/60"
                  />
                )}

                <textarea
                  placeholder="Tell us what you love (optional)…"
                  value={comment}
                  onChange={(e) => setComment(e.target.value)}
                  maxLength={500}
                  rows={3}
                  className="w-full px-4 py-3 rounded-xl bg-muted/40 border border-border/50 text-sm focus:outline-none focus:border-primary/60 resize-none"
                />

                <button
                  onClick={handleSubmit}
                  disabled={saving || rating === 0}
                  className="w-full h-12 mt-4 rounded-2xl font-semibold text-sm flex items-center justify-center gap-2 disabled:opacity-50"
                  style={{ background: 'linear-gradient(135deg, #FF2D55, #FF6482)', color: '#fff' }}
                >
                  {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : 'Post Review'}
                </button>
              </>
            )}
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
};

export default ReviewModal;
