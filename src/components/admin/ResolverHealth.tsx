import { useCallback, useEffect, useMemo, useState } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { Activity, Loader2, Music4, RefreshCw } from 'lucide-react';

type Evt = {
  event_type: string;
  source: string | null;
  latency_ms: number | null;
  created_at: string;
};

type SourceStat = {
  source: string;
  hits: number;
  misses: number;
  errors: number;
  p50: number;
  p95: number;
};

const RESOLVE_TYPES = ['resolve_hit', 'resolve_miss', 'resolve_error', 'resolve_complete', 'resolve_failed'];
const LYRICS_TYPES = ['lyrics_hit', 'lyrics_miss'];

function percentile(values: number[], p: number): number {
  if (!values.length) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const idx = Math.min(sorted.length - 1, Math.floor((p / 100) * sorted.length));
  return Math.round(sorted[idx]);
}

function buildStats(events: Evt[], hitType: string, missTypes: string[]): SourceStat[] {
  const bySource = new Map<string, { hit: number[]; miss: number; err: number }>();
  for (const e of events) {
    const key = e.source || 'unknown';
    const entry = bySource.get(key) ?? { hit: [], miss: 0, err: 0 };
    if (e.event_type === hitType) entry.hit.push(e.latency_ms ?? 0);
    else if (e.event_type.endsWith('_error')) entry.err += 1;
    else if (missTypes.includes(e.event_type)) entry.miss += 1;
    bySource.set(key, entry);
  }
  return [...bySource.entries()]
    .map(([source, v]) => ({
      source,
      hits: v.hit.length,
      misses: v.miss,
      errors: v.err,
      p50: percentile(v.hit, 50),
      p95: percentile(v.hit, 95),
    }))
    .sort((a, b) => b.hits + b.misses + b.errors - (a.hits + a.misses + a.errors));
}

function rate(stat: SourceStat): number {
  const total = stat.hits + stat.misses + stat.errors;
  return total === 0 ? 0 : Math.round((stat.hits / total) * 100);
}

function rateColor(pct: number): string {
  if (pct >= 85) return 'text-emerald-300';
  if (pct >= 55) return 'text-amber-300';
  return 'text-rose-300';
}

function StatTable({ title, icon, stats, empty }: { title: string; icon: React.ReactNode; stats: SourceStat[]; empty: string }) {
  return (
    <div className="rounded-2xl border border-white/10 bg-white/[0.02] overflow-hidden">
      <div className="px-4 py-3 border-b border-white/10 flex items-center gap-2 text-sm font-semibold">
        {icon} {title}
      </div>
      {stats.length === 0 ? (
        <div className="p-6 text-center text-sm text-muted-foreground">{empty}</div>
      ) : (
        <div className="divide-y divide-white/5">
          {stats.map((s) => {
            const pct = rate(s);
            return (
              <div key={s.source} className="px-4 py-3 flex items-center gap-3 text-sm">
                <div className="flex-1 min-w-0">
                  <div className="font-medium truncate">{s.source}</div>
                  <div className="text-xs text-muted-foreground">
                    {s.hits} ok · {s.misses} miss · {s.errors} err
                  </div>
                </div>
                <div className="text-xs text-muted-foreground whitespace-nowrap tabular-nums">
                  p50 {s.p50}ms · p95 {s.p95}ms
                </div>
                <div className={`w-14 text-right font-bold tabular-nums ${rateColor(pct)}`}>{pct}%</div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

/**
 * Resolver + lyrics health, aggregated from client telemetry in `perf_events`.
 * Makes "song won't play" and "no lyrics" visible per source instead of guessed.
 */
export default function ResolverHealth({ hours = 24 }: { hours?: number }) {
  const [events, setEvents] = useState<Evt[]>([]);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    setLoading(true);
    const since = new Date(Date.now() - hours * 60 * 60 * 1000).toISOString();
    const { data } = await supabase
      .from('perf_events')
      .select('event_type, source, latency_ms, created_at')
      .in('event_type', [...RESOLVE_TYPES, ...LYRICS_TYPES])
      .gte('created_at', since)
      .order('created_at', { ascending: false })
      .limit(5000);
    setEvents((data ?? []) as Evt[]);
    setLoading(false);
  }, [hours]);

  useEffect(() => { void load(); }, [load]);

  const resolverStats = useMemo(
    () => buildStats(events.filter((e) => ['resolve_hit', 'resolve_miss', 'resolve_error'].includes(e.event_type)), 'resolve_hit', ['resolve_miss']),
    [events],
  );

  const lyricsStats = useMemo(
    () => buildStats(events.filter((e) => LYRICS_TYPES.includes(e.event_type)), 'lyrics_hit', ['lyrics_miss']),
    [events],
  );

  const overall = useMemo(() => {
    const completes = events.filter((e) => e.event_type === 'resolve_complete');
    const failures = events.filter((e) => e.event_type === 'resolve_failed');
    const total = completes.length + failures.length;
    const lyricsHits = events.filter((e) => e.event_type === 'lyrics_hit').length;
    const lyricsTotal = lyricsHits + events.filter((e) => e.event_type === 'lyrics_miss').length;
    return {
      playbackRate: total ? Math.round((completes.length / total) * 100) : 0,
      failures: failures.length,
      p50: percentile(completes.map((c) => c.latency_ms ?? 0), 50),
      p95: percentile(completes.map((c) => c.latency_ms ?? 0), 95),
      lyricsRate: lyricsTotal ? Math.round((lyricsHits / lyricsTotal) * 100) : 0,
    };
  }, [events]);

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between gap-3">
        <h2 className="text-lg font-semibold">Resolver &amp; lyrics health · last {hours}h</h2>
        <button
          onClick={load}
          className="px-3 py-1.5 rounded-xl text-xs font-medium bg-white/5 border border-white/10 hover:bg-white/10 flex items-center gap-2"
        >
          {loading ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <RefreshCw className="w-3.5 h-3.5" />} Refresh
        </button>
      </div>

      <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
        {[
          { label: 'Playback success', value: `${overall.playbackRate}%`, tone: rateColor(overall.playbackRate) },
          { label: 'Failed resolutions', value: overall.failures, tone: overall.failures > 0 ? 'text-rose-300' : 'text-emerald-300' },
          { label: 'Resolve p50', value: `${overall.p50}ms`, tone: '' },
          { label: 'Resolve p95', value: `${overall.p95}ms`, tone: '' },
          { label: 'Lyrics hit-rate', value: `${overall.lyricsRate}%`, tone: rateColor(overall.lyricsRate) },
        ].map((t) => (
          <div key={t.label} className="rounded-2xl border border-white/10 bg-white/[0.02] p-4">
            <div className="text-xs text-muted-foreground">{t.label}</div>
            <div className={`text-xl font-bold mt-1 tabular-nums ${t.tone}`}>{t.value}</div>
          </div>
        ))}
      </div>

      <div className="grid md:grid-cols-2 gap-3">
        <StatTable
          title="Stream sources"
          icon={<Activity className="w-4 h-4 text-primary" />}
          stats={resolverStats}
          empty={loading ? 'Loading…' : 'No resolution telemetry yet.'}
        />
        <StatTable
          title="Lyrics providers"
          icon={<Music4 className="w-4 h-4 text-primary" />}
          stats={lyricsStats}
          empty={loading ? 'Loading…' : 'No lyrics telemetry yet.'}
        />
      </div>
    </div>
  );
}
