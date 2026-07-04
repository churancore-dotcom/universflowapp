import { useEffect, useMemo, useState } from 'react';
import { supabase } from '@/integrations/supabase/client';
import {
  IndianRupee, TrendingUp, CheckCircle2, Clock, XCircle, Crown,
  Users, Repeat, BarChart3, DollarSign,
} from 'lucide-react';

type Row = {
  amount_paise: number;
  plan: string | null;
  status: string;
  created_at: string;
  user_id: string;
};

const fmtINR = (paise: number) =>
  new Intl.NumberFormat('en-IN', { style: 'currency', currency: 'INR', maximumFractionDigits: 0 }).format(paise / 100);

const compact = (n: number) =>
  new Intl.NumberFormat('en', { notation: 'compact', maximumFractionDigits: 1 }).format(n);

const PLAN_DAYS: Record<string, number> = { monthly: 30, bimonthly: 60, quarterly: 90, lifetime: 365 * 10 };

const RevenueInsights = () => {
  const [rows, setRows] = useState<Row[]>([]);
  const [activeSubs, setActiveSubs] = useState(0);
  const [totalUsers, setTotalUsers] = useState(0);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    (async () => {
      setLoading(true);
      const since = new Date(Date.now() - 1000 * 60 * 60 * 24 * 365).toISOString();
      const [{ data, error }, { count: subCount }, { count: userCount }] = await Promise.all([
        supabase.from('payment_requests')
          .select('amount_paise, plan, status, created_at, user_id')
          .gte('created_at', since)
          .order('created_at', { ascending: false })
          .limit(5000),
        supabase.from('user_subscriptions')
          .select('*', { count: 'exact', head: true })
          .eq('status', 'active')
          .in('subscription_type', ['premium_monthly', 'premium_yearly']),
        supabase.from('profiles').select('*', { count: 'exact', head: true }),
      ]);
      if (!active) return;
      if (error) setErr(error.message);
      else setRows((data ?? []) as Row[]);
      setActiveSubs(subCount ?? 0);
      setTotalUsers(userCount ?? 0);
      setLoading(false);
    })();
    return () => { active = false; };
  }, []);

  const m = useMemo(() => {
    const approved = rows.filter((r) => r.status === 'approved' || r.status === 'auto_approved');
    const pending = rows.filter((r) => r.status === 'pending');
    const rejected = rows.filter((r) => r.status === 'rejected');

    const sum = (arr: Row[]) => arr.reduce((s, r) => s + (r.amount_paise || 0), 0);
    const since = (days: number) => approved.filter((r) => new Date(r.created_at).getTime() > Date.now() - days * 86400000);

    const total = sum(approved);
    const r30 = sum(since(30));
    const r7 = sum(since(7));
    const r1 = sum(since(1));

    // Monthly Recurring Revenue: normalize each approved payment to a per-month value
    const mrr = approved.reduce((s, r) => {
      const days = PLAN_DAYS[r.plan || 'monthly'] || 30;
      return s + (r.amount_paise || 0) * (30 / days);
    }, 0);

    const uniqueBuyers = new Set(approved.map((r) => r.user_id)).size;
    const arpu = uniqueBuyers > 0 ? total / uniqueBuyers : 0;
    const conversion = totalUsers > 0 ? (activeSubs / totalUsers) * 100 : 0;
    const successRate = (approved.length + rejected.length) > 0
      ? (approved.length / (approved.length + rejected.length)) * 100 : 0;

    const byPlan = approved.reduce<Record<string, { count: number; sum: number }>>((acc, r) => {
      const k = r.plan || 'unknown';
      acc[k] = acc[k] || { count: 0, sum: 0 };
      acc[k].count += 1; acc[k].sum += r.amount_paise || 0;
      return acc;
    }, {});

    const days: { label: string; sum: number; count: number }[] = [];
    for (let i = 29; i >= 0; i--) {
      const d = new Date(Date.now() - i * 86400000);
      const key = d.toISOString().slice(0, 10);
      const dayRows = approved.filter((r) => r.created_at.startsWith(key));
      days.push({ label: key.slice(5), sum: sum(dayRows), count: dayRows.length });
    }

    return { approved, pending, rejected, total, r30, r7, r1, mrr, arpu, conversion, successRate, uniqueBuyers, byPlan, days };
  }, [rows, activeSubs, totalUsers]);

  const maxDay = Math.max(1, ...m.days.map((d) => d.sum));

  const headline = [
    { icon: DollarSign, label: 'MRR (normalized)', value: fmtINR(m.mrr), sub: 'Monthly run-rate', tone: 'from-emerald-500 to-teal-400' },
    { icon: IndianRupee, label: 'Lifetime Revenue', value: fmtINR(m.total), sub: `${m.approved.length} payments`, tone: 'from-primary to-accent' },
    { icon: TrendingUp, label: 'Last 30 days', value: fmtINR(m.r30), sub: fmtINR(m.r7) + ' last 7d', tone: 'from-blue-500 to-cyan-400' },
    { icon: Users, label: 'Active Premium', value: compact(activeSubs), sub: `${m.conversion.toFixed(1)}% of ${compact(totalUsers)} users`, tone: 'from-fuchsia-500 to-pink-400' },
  ];

  const secondary = [
    { icon: Repeat, label: 'ARPU', value: fmtINR(m.arpu), sub: `${m.uniqueBuyers} unique buyers` },
    { icon: BarChart3, label: 'Today', value: fmtINR(m.r1), sub: 'Revenue today' },
    { icon: CheckCircle2, label: 'Approval rate', value: `${m.successRate.toFixed(0)}%`, sub: `${m.approved.length} ok / ${m.rejected.length} rejected` },
    { icon: Clock, label: 'Pending review', value: compact(m.pending.length), sub: 'Awaiting admin' },
  ];

  return (
    <div className="p-4 md:p-8">
      <div className="mb-6 flex items-end justify-between flex-wrap gap-2">
        <div>
          <h1 className="text-2xl md:text-3xl font-display font-bold">Revenue Insights</h1>
          <p className="text-muted-foreground mt-1 text-sm">Live from approved payments · last 12 months</p>
        </div>
        {loading && <Clock className="w-4 h-4 animate-spin text-muted-foreground" />}
      </div>

      {err && <div className="mb-4 p-3 rounded-lg bg-destructive/10 text-destructive text-sm">{err}</div>}

      {/* Headline cards */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3 md:gap-4 mb-4">
        {headline.map((s) => (
          <div key={s.label} className="glass-strong rounded-2xl p-5 relative overflow-hidden">
            <div className={`absolute -top-6 -right-6 w-24 h-24 rounded-full bg-gradient-to-br ${s.tone} opacity-20 blur-2xl`} />
            <div className={`w-10 h-10 rounded-xl bg-gradient-to-br ${s.tone} flex items-center justify-center mb-3`}>
              <s.icon className="w-5 h-5 text-white" />
            </div>
            <div className="text-xs text-muted-foreground">{s.label}</div>
            <div className="text-2xl font-bold mt-1">{s.value}</div>
            <div className="text-[11px] text-muted-foreground mt-1">{s.sub}</div>
          </div>
        ))}
      </div>

      {/* Secondary metrics */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 mb-8">
        {secondary.map((s) => (
          <div key={s.label} className="glass rounded-2xl p-4">
            <div className="flex items-center gap-2 text-xs text-muted-foreground mb-1">
              <s.icon className="w-3.5 h-3.5" /> {s.label}
            </div>
            <div className="text-lg font-bold">{s.value}</div>
            <div className="text-[10px] text-muted-foreground">{s.sub}</div>
          </div>
        ))}
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        {/* Plan breakdown */}
        <div className="glass-strong rounded-2xl p-5 lg:col-span-1">
          <h2 className="font-semibold mb-4 flex items-center gap-2"><Crown className="w-4 h-4 text-primary" /> Revenue by Plan</h2>
          <div className="space-y-3">
            {Object.entries(m.byPlan).length === 0 && (
              <div className="text-sm text-muted-foreground">No approved payments yet.</div>
            )}
            {Object.entries(m.byPlan).sort((a, b) => b[1].sum - a[1].sum).map(([plan, v]) => {
              const pct = m.total > 0 ? (v.sum / m.total) * 100 : 0;
              return (
                <div key={plan}>
                  <div className="flex items-center justify-between text-sm mb-1">
                    <span className="font-medium capitalize">{plan}</span>
                    <span className="font-semibold">{fmtINR(v.sum)}</span>
                  </div>
                  <div className="h-1.5 rounded-full bg-muted/40 overflow-hidden">
                    <div className="h-full bg-gradient-to-r from-primary to-accent rounded-full" style={{ width: `${pct}%` }} />
                  </div>
                  <div className="text-[10px] text-muted-foreground mt-1">{v.count} payments · {pct.toFixed(1)}%</div>
                </div>
              );
            })}
          </div>
        </div>

        {/* Daily revenue chart */}
        <div className="glass-strong rounded-2xl p-5 lg:col-span-2">
          <div className="flex items-center justify-between mb-4">
            <h2 className="font-semibold flex items-center gap-2"><BarChart3 className="w-4 h-4 text-primary" /> Daily Revenue (30d)</h2>
            <span className="text-xs text-muted-foreground">Peak: {fmtINR(maxDay)}</span>
          </div>
          <div className="flex items-end gap-1 h-44">
            {m.days.map((d) => (
              <div key={d.label} className="flex-1 group relative flex flex-col items-center justify-end">
                <div
                  className="w-full bg-gradient-to-t from-primary to-accent rounded-t opacity-70 group-hover:opacity-100 transition-opacity"
                  style={{ height: `${(d.sum / maxDay) * 100}%`, minHeight: d.sum > 0 ? 3 : 0 }}
                  title={`${d.label}: ${fmtINR(d.sum)} (${d.count})`}
                />
              </div>
            ))}
          </div>
          <div className="mt-2 text-xs text-muted-foreground flex justify-between">
            <span>{m.days[0]?.label}</span>
            <span>{m.days[m.days.length - 1]?.label}</span>
          </div>
        </div>
      </div>

      {/* Status counters */}
      <div className="grid grid-cols-3 gap-3 mt-4">
        <div className="glass rounded-2xl p-4 flex items-center gap-3">
          <CheckCircle2 className="w-5 h-5 text-emerald-400" />
          <div><div className="text-xs text-muted-foreground">Approved</div><div className="font-bold">{m.approved.length}</div></div>
        </div>
        <div className="glass rounded-2xl p-4 flex items-center gap-3">
          <Clock className="w-5 h-5 text-amber-400" />
          <div><div className="text-xs text-muted-foreground">Pending</div><div className="font-bold">{m.pending.length}</div></div>
        </div>
        <div className="glass rounded-2xl p-4 flex items-center gap-3">
          <XCircle className="w-5 h-5 text-rose-400" />
          <div><div className="text-xs text-muted-foreground">Rejected</div><div className="font-bold">{m.rejected.length}</div></div>
        </div>
      </div>
    </div>
  );
};

export default RevenueInsights;
