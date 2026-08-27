import { useEffect, useMemo, useState } from 'react';
import { Star, Loader2, MessageSquare, RefreshCw } from 'lucide-react';
import { supabase } from '@/integrations/supabase/client';
import { toast } from 'sonner';

interface Review {
  id: string;
  rating: number;
  comment: string | null;
  display_name: string;
  created_at: string;
}

const Stars = ({ value, size = 14 }: { value: number; size?: number }) => (
  <span className="inline-flex items-center gap-0.5">
    {[1, 2, 3, 4, 5].map((n) => (
      <Star
        key={n}
        style={{ width: size, height: size }}
        className={n <= value ? 'fill-amber-400 text-amber-400' : 'text-muted-foreground/35'}
      />
    ))}
  </span>
);

const AdminReviews = () => {
  const [reviews, setReviews] = useState<Review[]>([]);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState<number | null>(null);

  const load = async () => {
    setLoading(true);
    const { data, error } = await supabase
      .from('app_reviews')
      .select('id, rating, comment, display_name, created_at')
      .order('created_at', { ascending: false })
      .limit(500);
    if (error) toast.error(error.message);
    setReviews((data as Review[]) || []);
    setLoading(false);
  };

  useEffect(() => { void load(); }, []);

  const stats = useMemo(() => {
    const total = reviews.length;
    const avg = total ? reviews.reduce((s, r) => s + r.rating, 0) / total : 0;
    const buckets = [5, 4, 3, 2, 1].map((n) => ({
      n,
      count: reviews.filter((r) => r.rating === n).length,
    }));
    return { total, avg, buckets };
  }, [reviews]);

  const shown = filter ? reviews.filter((r) => r.rating === filter) : reviews;

  return (
    <div className="p-5 space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold">App Ratings</h1>
          <p className="text-sm text-muted-foreground mt-1">
            Real user reviews of Universflow, newest first.
          </p>
        </div>
        <button
          onClick={() => void load()}
          className="inline-flex items-center gap-2 h-10 px-4 rounded-xl bg-muted/50 text-sm font-semibold"
        >
          <RefreshCw className={`w-4 h-4 ${loading ? 'animate-spin' : ''}`} /> Refresh
        </button>
      </div>

      {/* Summary */}
      <div className="rounded-2xl border border-border/60 bg-card p-5">
        <div className="flex flex-wrap items-end gap-8">
          <div>
            <p className="text-5xl font-black tabular-nums leading-none">
              {stats.total ? stats.avg.toFixed(2) : '—'}
            </p>
            <div className="mt-2"><Stars value={Math.round(stats.avg)} size={16} /></div>
            <p className="text-xs text-muted-foreground mt-2">
              {stats.total} review{stats.total === 1 ? '' : 's'}
            </p>
          </div>
          <div className="flex-1 min-w-[220px] space-y-1.5">
            {stats.buckets.map((b) => {
              const pct = stats.total ? (b.count / stats.total) * 100 : 0;
              return (
                <button
                  key={b.n}
                  onClick={() => setFilter(filter === b.n ? null : b.n)}
                  className={`flex items-center gap-3 w-full text-left ${filter === b.n ? 'opacity-100' : 'opacity-80 hover:opacity-100'}`}
                >
                  <span className="w-4 text-xs tabular-nums text-muted-foreground">{b.n}</span>
                  <span className="flex-1 h-2 rounded-full bg-muted overflow-hidden">
                    <span className="block h-full bg-amber-400" style={{ width: `${pct}%` }} />
                  </span>
                  <span className="w-10 text-right text-xs tabular-nums text-muted-foreground">{b.count}</span>
                </button>
              );
            })}
          </div>
        </div>
        {filter && (
          <button onClick={() => setFilter(null)} className="mt-4 text-xs font-semibold text-primary">
            Clear {filter}-star filter
          </button>
        )}
      </div>

      {/* List */}
      {loading ? (
        <div className="flex justify-center py-16"><Loader2 className="w-6 h-6 animate-spin text-muted-foreground" /></div>
      ) : shown.length === 0 ? (
        <div className="rounded-2xl border border-border/60 bg-card p-10 text-center">
          <MessageSquare className="w-6 h-6 mx-auto text-muted-foreground mb-3" />
          <p className="text-sm text-muted-foreground">No reviews to show yet.</p>
        </div>
      ) : (
        <div className="space-y-3">
          {shown.map((r) => (
            <div key={r.id} className="rounded-2xl border border-border/60 bg-card p-4">
              <div className="flex items-center justify-between gap-3">
                <div className="min-w-0">
                  <p className="text-sm font-semibold truncate">{r.display_name}</p>
                  <div className="mt-1"><Stars value={r.rating} /></div>
                </div>
                <span className="text-[11px] text-muted-foreground shrink-0">
                  {new Date(r.created_at).toLocaleDateString()}
                </span>
              </div>
              {r.comment && (
                <p className="text-sm text-muted-foreground mt-3 leading-relaxed whitespace-pre-line">
                  {r.comment}
                </p>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
};

export default AdminReviews;
