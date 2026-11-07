import { useEffect } from 'react';
import { toast } from 'sonner';
import { useAuth } from '@/contexts/AuthContext';
import { supabase } from '@/integrations/supabase/client';

/** Durable, owner-scoped notices: polling also works when realtime is unavailable. */
export default function AccountNoticeDelivery() {
  const { user } = useAuth();
  useEffect(() => {
    if (!user) return;
    let cancelled = false;
    let busy = false;
    const delivered = new Set<string>();
    const read = async () => {
      if (busy || document.visibilityState !== 'visible') return;
      busy = true;
      try {
        const { data, error } = await supabase.from('account_notices').select('id,kind,title,message').eq('user_id', user.id).is('read_at', null).order('created_at', { ascending: true }).limit(10);
        if (error || cancelled) return;
        for (const notice of data || []) {
          if (cancelled) return;
          if (!delivered.has(notice.id)) {
            delivered.add(notice.id);
            toast[notice.kind === 'activated' ? 'success' : 'warning'](notice.title, { id: notice.id, description: notice.message });
          }
          await supabase.from('account_notices').update({ read_at: new Date().toISOString() }).eq('id', notice.id).eq('user_id', user.id);
        }
      } finally { busy = false; }
    };
    void read();
    const interval = window.setInterval(() => void read(), 30000);
    const onVisible = () => void read();
    document.addEventListener('visibilitychange', onVisible);
    return () => { cancelled = true; window.clearInterval(interval); document.removeEventListener('visibilitychange', onVisible); };
  }, [user?.id]);
  return null;
}