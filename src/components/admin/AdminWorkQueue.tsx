import { useCallback, useEffect, useState } from 'react';
import { ArrowUpRight, Crown, ShieldCheck, Shield, MessageCircle, RefreshCw } from 'lucide-react';
import { supabase } from '@/integrations/supabase/client';
import { Button } from '@/components/ui/button';
import { useNavigate } from '@/lib/router-compat';

const queues = [
  { key: 'payments', label: 'Payment reviews', path: '/admin/payments', icon: Crown },
  { key: 'artists', label: 'Artist applications', path: '/admin/artist-applications', icon: ShieldCheck },
  { key: 'reports', label: 'Content reports', path: '/admin/moderation', icon: Shield },
  { key: 'support', label: 'Unread conversations', path: '/admin/support', icon: MessageCircle },
] as const;
type QueueKey = typeof queues[number]['key'];

export default function AdminWorkQueue() {
  const navigate = useNavigate();
  const [counts, setCounts] = useState<Partial<Record<QueueKey, number>>>({});
  const [loading, setLoading] = useState(true);
  const [failed, setFailed] = useState(false);
  const refresh = useCallback(async () => {
    setLoading(true);
    try {
      const results = await Promise.all([
        supabase.from('payment_requests').select('id', { count: 'exact', head: true }).eq('status', 'pending'),
        supabase.from('artist_applications').select('id', { count: 'exact', head: true }).eq('status', 'pending'),
        supabase.from('content_reports').select('id', { count: 'exact', head: true }).eq('status', 'pending'),
        supabase.from('support_chats').select('id', { count: 'exact', head: true }).gt('unread_for_admin', 0),
      ]);
      const next: Partial<Record<QueueKey, number>> = {};
      results.forEach((result, i) => { if (!result.error) next[queues[i].key] = result.count ?? 0; });
      setCounts(next);
      setFailed(results.some(result => result.error));
    } catch {
      setFailed(true);
      setCounts({});
    } finally { setLoading(false); }
  }, []);
  useEffect(() => {
    let debounce: ReturnType<typeof setTimeout> | undefined;
    const channel = supabase.channel('admin-work-queue');
    for (const table of ['payment_requests', 'artist_applications', 'content_reports', 'support_chats']) {
      channel.on('postgres_changes', { event: '*', schema: 'public', table }, () => {
        clearTimeout(debounce);
        debounce = setTimeout(() => { void refresh(); }, 500);
      });
    }
    channel.subscribe();
    void refresh();
    return () => { clearTimeout(debounce); void supabase.removeChannel(channel); };
  }, [refresh]);
  return (
    <section className="mb-8 border-y border-border py-5">
      <div className="flex items-center justify-between gap-3 mb-4">
        <h2 className="font-display font-bold text-lg">Needs attention</h2>
        <Button variant="ghost" size="icon" title="Refresh pending work" aria-label="Refresh pending work" disabled={loading} onClick={refresh}>
          <RefreshCw className={loading ? 'animate-spin' : ''} />
        </Button>
      </div>
      {failed && <p role="status" className="text-sm text-destructive mb-3">Some counts are unavailable. Refresh to try again.</p>}
      <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-3">
        {queues.map(({ key, label, path, icon: Icon }) => (
          <Button key={key} variant="outline" onClick={() => navigate(path)} className="h-auto min-h-20 p-4 justify-start whitespace-normal text-left">
            <Icon className="text-primary" />
            <span className="min-w-0 flex-1"><span className="block text-xs text-muted-foreground">{label}</span><span className="block text-xl font-bold tabular-nums">{loading ? '…' : counts[key] ?? '—'}</span></span>
            <ArrowUpRight className="text-muted-foreground" />
          </Button>
        ))}
      </div>
    </section>
  );
}