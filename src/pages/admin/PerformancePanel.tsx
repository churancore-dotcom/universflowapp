import { useEffect, useMemo, useState } from 'react';
import ResolverHealth from '@/components/admin/ResolverHealth';
import { supabase } from '@/integrations/supabase/client';
import { Activity, AlertTriangle, Gauge, RefreshCw, Trash2, Zap } from 'lucide-react';
import { motion } from 'framer-motion';

interface PerfEvent {
  id: string;
  event_type: string;
  severity: string;
  track_id: string | null;
  source: string | null;
  latency_ms: number | null;
  message: string | null;
  route: string | null;
  user_id: string | null;
  created_at: string;
}

const SEVERITY_STYLES: Record<string, string> = {
  info: 'bg-sky-500/10 text-sky-300 border-sky-500/20',
  warn: 'bg-amber-500/10 text-amber-300 border-amber-500/20',
  error: 'bg-rose-500/10 text-rose-300 border-rose-500/20',
};

export default function PerformancePanel() {
  const [events, setEvents] = useState<PerfEvent[]>([]);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState<'all' | 'error' | 'warn' | 'info'>('all');
  const [paused, setPaused] = useState(false);

  const load = async () => {
    setLoading(true);
    const { data } = await supabase
      .from('perf_events')
      .select('*')
      .order('created_at', { ascending: false })
      .limit(300);
    setEvents((data || []) as PerfEvent[]);
    setLoading(false);
  };

  useEffect(() => {
    load();
    const channel = supabase
      .channel('admin-perf-events')
      .on(
        'postgres_changes',
        { event: 'INSERT', schema: 'public', table: 'perf_events' },
        (payload) => {
          if (paused) return;
          setEvents((prev) => [payload.new as PerfEvent, ...prev].slice(0, 300));
        },
      )
      .subscribe();
    return () => {
      supabase.removeChannel(channel);
    };
  }, [paused]);

  const filtered = useMemo(
    () => (filter === 'all' ? events : events.filter((e) => e.severity === filter)),
    [events, filter],
  );

  const metrics = useMemo(() => {
    const since = Date.now() - 60 * 60 * 1000;
    const recent = events.filter((e) => new Date(e.created_at).getTime() > since);
    const errors = recent.filter((e) => e.severity === 'error').length;
    const starts = recent.filter((e) => e.event_type === 'playback_start' && e.latency_ms != null);
    const avgStart = starts.length
      ? Math.round(starts.reduce((s, e) => s + (e.latency_ms || 0), 0) / starts.length)
      : 0;
    const p95Start = starts.length
      ? Math.round(
          [...starts.map((e) => e.latency_ms || 0)].sort((a, b) => a - b)[
            Math.floor(starts.length * 0.95)
          ] || 0,
        )
      : 0;
    const stalls = recent.filter((e) => e.event_type === 'playback_stall').length;
    const errorRate = recent.length ? Math.round((errors / recent.length) * 1000) / 10 : 0;
    return { total: recent.length, errors, errorRate, avgStart, p95Start, stalls };
  }, [events]);

  return (
    <div className="p-4 md:p-8 space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl md:text-3xl font-display font-bold flex items-center gap-2">
            <Gauge className="w-6 h-6 text-primary" />
            Performance Monitor
          </h1>
          <p className="text-sm text-muted-foreground mt-1">
            Live playback latency, errors and client telemetry · last 60 min
          </p>
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={() => setPaused((p) => !p)}
            className={`px-3 py-2 rounded-xl text-sm font-medium border transition ${
              paused
                ? 'bg-amber-500/15 border-amber-500/30 text-amber-300'
                : 'bg-white/5 border-white/10 hover:bg-white/10'
            }`}
          >
            {paused ? 'Resume live' : 'Pause live'}
          </button>
          <button
            onClick={load}
            className="px-3 py-2 rounded-xl text-sm font-medium bg-white/5 border border-white/10 hover:bg-white/10 flex items-center gap-2"
          >
            <RefreshCw className="w-4 h-4" /> Refresh
          </button>
        </div>
      </div>

      <ResolverHealth />

      {/* Metric tiles */}
      <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
        <MetricCard label="Events / hr" value={metrics.total} icon={<Activity className="w-4 h-4" />} />
        <MetricCard
          label="Errors / hr"
          value={metrics.errors}
          tone={metrics.errors > 0 ? 'bad' : 'good'}
          icon={<AlertTriangle className="w-4 h-4" />}
        />
        <MetricCard
          label="Error rate"
          value={`${metrics.errorRate}%`}
          tone={metrics.errorRate > 2 ? 'bad' : 'good'}
        />
        <MetricCard
          label="Avg start"
          value={`${metrics.avgStart} ms`}
          tone={metrics.avgStart > 1500 ? 'bad' : 'good'}
          icon={<Zap className="w-4 h-4" />}
        />
        <MetricCard label="p95 start" value={`${metrics.p95Start} ms`} />
      </div>

      {/* Filter chips */}
      <div className="flex flex-wrap gap-2">
        {(['all', 'error', 'warn', 'info'] as const).map((f) => (
          <button
            key={f}
            onClick={() => setFilter(f)}
            className={`px-3 py-1.5 rounded-full text-xs font-semibold uppercase tracking-wide border transition ${
              filter === f
                ? 'bg-primary text-primary-foreground border-primary'
                : 'bg-white/5 text-muted-foreground border-white/10 hover:bg-white/10'
            }`}
          >
            {f}
          </button>
        ))}
        <div className="ml-auto text-xs text-muted-foreground self-center">
          Showing {filtered.length} of {events.length}
        </div>
      </div>

      {/* Real-time log stream */}
      <div className="rounded-2xl border border-white/10 bg-black/30 backdrop-blur overflow-hidden">
        <div className="px-4 py-3 border-b border-white/10 flex items-center justify-between">
          <span className="text-sm font-semibold flex items-center gap-2">
            <span className={`w-2 h-2 rounded-full ${paused ? 'bg-amber-500' : 'bg-emerald-500 animate-pulse'}`} />
            {paused ? 'Live stream paused' : 'Live stream'}
          </span>
          <button
            onClick={() => setEvents([])}
            className="text-xs text-muted-foreground hover:text-foreground flex items-center gap-1"
          >
            <Trash2 className="w-3 h-3" /> Clear view
          </button>
        </div>
        <div className="max-h-[60vh] overflow-y-auto divide-y divide-white/5 font-mono text-[12px]">
          {loading && <div className="p-6 text-center text-muted-foreground">Loading…</div>}
          {!loading && filtered.length === 0 && (
            <div className="p-6 text-center text-muted-foreground">No events yet.</div>
          )}
          {filtered.map((e) => (
            <motion.div
              key={e.id}
              initial={{ opacity: 0, x: -8 }}
              animate={{ opacity: 1, x: 0 }}
              transition={{ duration: 0.18 }}
              className="px-4 py-2 grid grid-cols-[88px_70px_1fr_auto] gap-3 items-center hover:bg-white/[0.02]"
            >
              <span className="text-muted-foreground tabular-nums">
                {new Date(e.created_at).toLocaleTimeString()}
              </span>
              <span
                className={`text-center px-2 py-0.5 rounded text-[10px] font-bold uppercase border ${
                  SEVERITY_STYLES[e.severity] || SEVERITY_STYLES.info
                }`}
              >
                {e.severity}
              </span>
              <span className="truncate">
                <span className="text-primary">{e.event_type}</span>
                {e.message ? <span className="text-foreground/80"> · {e.message}</span> : null}
                {e.source ? <span className="text-muted-foreground"> [{e.source}]</span> : null}
              </span>
              <span className="text-muted-foreground tabular-nums text-right">
                {e.latency_ms != null ? `${e.latency_ms}ms` : ''}
              </span>
            </motion.div>
          ))}
        </div>
      </div>
    </div>
  );
}

function MetricCard({
  label,
  value,
  tone,
  icon,
}: {
  label: string;
  value: string | number;
  tone?: 'good' | 'bad';
  icon?: React.ReactNode;
}) {
  const toneClass =
    tone === 'bad'
      ? 'text-rose-300'
      : tone === 'good'
      ? 'text-emerald-300'
      : 'text-foreground';
  return (
    <div className="rounded-2xl border border-white/10 bg-white/[0.03] p-4">
      <div className="flex items-center gap-1.5 text-[11px] uppercase tracking-wider text-muted-foreground font-semibold">
        {icon}
        {label}
      </div>
      <div className={`mt-1.5 text-2xl font-bold tabular-nums ${toneClass}`}>{value}</div>
    </div>
  );
}
