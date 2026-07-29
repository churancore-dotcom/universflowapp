import { useEffect, useState, useCallback } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Bell, X, AlertTriangle, CheckCircle2, Info } from 'lucide-react';
import { useNavigate } from '@/lib/router-compat';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/contexts/AuthContext';
import { usePremium } from '@/hooks/usePremium';
import { triggerHaptic } from '@/hooks/useHaptics';

interface Announcement {
  id: string;
  title: string;
  message: string;
  type: 'info' | 'success' | 'warning';
  target_audience: 'all' | 'premium' | 'free' | 'specific';
  deep_link?: string | null;
  starts_at: string;
  ends_at: string | null;
}

const DISMISSED_KEY = 'uf_dismissed_announcements_v1';
const DELIVERED_KEY = 'uf_delivered_announcements_v1';

const readSet = (key: string): Set<string> => {
  try {
    const raw = localStorage.getItem(key);
    if (!raw) return new Set();
    return new Set(JSON.parse(raw) as string[]);
  } catch (e) {
    console.warn('AnnouncementBanner readSet error:', e);
    return new Set();
  }
};

const writeSet = (key: string, set: Set<string>) => {
  try {
    // Keep only last 200 entries to avoid unbounded growth
    const arr = Array.from(set).slice(-200);
    localStorage.setItem(key, JSON.stringify(arr));
  } catch (e) { console.warn('AnnouncementBanner writeSet error:', e); }
};

const styleFor = (type: Announcement['type']) => {
  switch (type) {
    case 'success':
      return { icon: CheckCircle2, grad: 'linear-gradient(135deg,#10B981,#059669)' };
    case 'warning':
      return { icon: AlertTriangle, grad: 'linear-gradient(135deg,#F59E0B,#D97706)' };
    default:
      return { icon: Info, grad: 'linear-gradient(135deg,#FF2D55,#FF6482)' };
  }
};

const AnnouncementBanner = () => {
  const { user } = useAuth();
  const { isPremium } = usePremium();
  const navigate = useNavigate();
  const [items, setItems] = useState<Announcement[]>([]);
  const [dismissed, setDismissed] = useState<Set<string>>(() => readSet(DISMISSED_KEY));

  const fetchActive = useCallback(async () => {
    if (!user) return;
    const audienceFilter = isPremium
      ? ['all', 'premium']
      : ['all', 'free'];

    const { data, error } = await supabase
      .from('announcements')
      .select('id, title, message, type, target_audience, deep_link, starts_at, ends_at')
      .eq('is_active', true)
      .lte('starts_at', new Date().toISOString())
      .in('target_audience', audienceFilter)
      .order('created_at', { ascending: false })
      .limit(5);
    if (error) return;
    const now = Date.now();
    const fresh = (data ?? []).filter((a) => !a.ends_at || new Date(a.ends_at).getTime() > now);
    setItems(fresh as unknown as Announcement[]);
  }, [user, isPremium]);

  useEffect(() => {
    fetchActive();
    const ch = supabase
      .channel('announcement_banners')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'announcements' }, fetchActive)
      .subscribe();
    return () => {
      supabase.removeChannel(ch);
    };
  }, [fetchActive]);

  // Log delivery once per announcement per device
  useEffect(() => {
    if (!user || items.length === 0) return;
    const delivered = readSet(DELIVERED_KEY);
    const fresh = items.filter((a) => !delivered.has(a.id));
    if (!fresh.length) return;
    (async () => {
      for (const a of fresh) {
        try {
          await supabase.from('announcement_events').insert({
            announcement_id: a.id,
            user_id: user.id,
            event_type: 'delivered',
          });
          delivered.add(a.id);
        } catch (e) { console.warn('AnnouncementBanner deliver insert error:', e); }
      }
      writeSet(DELIVERED_KEY, delivered);
    })();
  }, [items, user]);

  const visible = items.filter((a) => !dismissed.has(a.id));
  if (!visible.length) return null;

  const top = visible[0];
  const { icon: Icon, grad } = styleFor(top.type);

  const dismiss = () => {
    triggerHaptic('selection');
    const next = new Set(dismissed);
    next.add(top.id);
    setDismissed(next);
    writeSet(DISMISSED_KEY, next);
  };

  const handleClick = async () => {
    triggerHaptic('impactLight');
    if (user) {
      try {
        await supabase.from('announcement_events').insert({
          announcement_id: top.id,
          user_id: user.id,
          event_type: 'clicked',
        });
      } catch (e) { console.warn('AnnouncementBanner click insert error:', e); }
    }
    const dl = top.deep_link?.trim();
    if (dl) {
      if (dl.startsWith('http')) window.location.href = dl;
      else navigate(dl);
    }
  };

  return (
    <AnimatePresence>
      <motion.div
        key={top.id}
        initial={{ opacity: 0, y: -8, scale: 0.98 }}
        animate={{ opacity: 1, y: 0, scale: 1 }}
        exit={{ opacity: 0, y: -8, scale: 0.98 }}
        transition={{ duration: 0.25, ease: [0.22, 1, 0.36, 1] }}
        className="relative rounded-2xl overflow-hidden"
        style={{
          background: 'rgba(255,255,255,0.04)',
          border: '0.5px solid rgba(255,255,255,0.10)',
          boxShadow: '0 8px 24px -12px rgba(0,0,0,0.5)',
        }}
      >
        <button
          type="button"
          onClick={handleClick}
          className="w-full text-left px-3.5 py-3 flex items-start gap-3"
        >
          <div
            className="w-9 h-9 rounded-xl flex items-center justify-center flex-shrink-0"
            style={{ background: grad, boxShadow: '0 6px 18px -8px rgba(255,45,85,0.5)' }}
          >
            <Icon className="w-[18px] h-[18px] text-white" />
          </div>
          <div className="flex-1 min-w-0 pr-6">
            <p className="text-[13.5px] font-bold text-foreground leading-tight tracking-tight">
              {top.title}
            </p>
            <p className="text-[11.5px] text-muted-foreground/80 leading-snug mt-0.5 line-clamp-2">
              {top.message}
            </p>
            {visible.length > 1 && (
              <p className="text-[10px] font-semibold mt-1 opacity-60 flex items-center gap-1">
                <Bell className="w-3 h-3" /> +{visible.length - 1} more
              </p>
            )}
          </div>
        </button>
        <button
          type="button"
          aria-label="Dismiss"
          onClick={dismiss}
          className="absolute top-2 right-2 w-6 h-6 rounded-full flex items-center justify-center"
          style={{ background: 'rgba(255,255,255,0.06)' }}
        >
          <X className="w-3 h-3 text-foreground/60" />
        </button>
      </motion.div>
    </AnimatePresence>
  );
};

export default AnnouncementBanner;
