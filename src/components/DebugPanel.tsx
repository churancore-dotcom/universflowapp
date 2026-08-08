import { useEffect, useMemo, useState } from 'react';
import { AlertTriangle, CheckCircle2, RotateCcw, Trash2, WifiOff } from 'lucide-react';
import { clearLiveEvents, subscribeLiveEvents, type LiveEvent } from '@/lib/perfMonitor';

const FAIL_TYPES = ['resolve_fail', 'resolve_failed', 'resolve_error', 'resolve_miss', 'playback_error', 'audio_error', 'edge_call_error'];

type Filter = 'failures' | 'all';

function timeOf(at: number): string {
  const d = new Date(at);
  return `${d.toLocaleTimeString([], { hour12: false })}.${String(d.getMilliseconds()).padStart(3, '0')}`;
}

function isFailure(e: LiveEvent): boolean {
  const msg = (e.message || '').toLowerCase();
  return (
    FAIL_TYPES.includes(e.event_type) ||
    e.severity === 'error' ||
    msg.includes('failed to fetch') ||
    msg.includes('load failed')
  );
}

function retryOutcome(e: LiveEvent): { label: string; tone: string } | null {
  const d = (e.details ?? {}) as Record<string, unknown>;
  const attempt = typeof d['attempt'] === 'number' ? (d['attempt'] as number) : null;
  const retried = d['retried'] === true || (attempt != null && attempt > 1);
  if (['resolve_hit', 'resolve_complete', 'edge_call_ok'].includes(e.event_type)) {
    return retried ? { label: 'recovered after retry', tone: 'text-emerald-300' } : { label: 'first try', tone: 'text-muted-foreground' };
  }
  if (isFailure(e)) {
    return retried
      ? { label: 'retry exhausted', tone: 'text-rose-300' }
      : { label: 'no retry left', tone: 'text-amber-300' };
  }
  return null;
}

/**
 * In-app live diagnostics. Reads a client-side ring buffer only — no network,
 * no database reads, so it is free to run and never expires.
 */
export default function DebugPanel() {
  const [events, setEvents] = useState<LiveEvent[]>([]);
  const [filter, setFilter] = useState<Filter>('failures');

  useEffect(() => subscribeLiveEvents(setEvents), []);

  const shown = useMemo(
    () => (filter === 'all' ? events : events.filter(isFailure)).slice(0, 200),
    [events, filter],
  );

  const stats = useMemo(() => {
    const fails = events.filter(isFailure).length;
    const fetchFails = events.filter((e) => (e.message || '').toLowerCase().includes('failed to fetch')).length;
    const recovered = events.filter((e) => retryOutcome(e)?.label === 'recovered after retry').length;
    return { total: events.length, fails, fetchFails, recovered };
  }, [events]);

  return (
    <div className="space-y-3">
      <div className="grid grid-cols-4 gap-2">
        {[
          { label: 'Events', value: stats.total, tone: '' },
          { label: 'Failures', value: stats.fails, tone: stats.fails ? 'text-rose-300' : 'text-emerald-300' },
          { label: 'Failed to fetch', value: stats.fetchFails, tone: stats.fetchFails ? 'text-amber-300' : '' },
          { label: 'Retry saves', value: stats.recovered, tone: 'text-emerald-300' },
        ].map((t) => (
          <div key={t.label} className="rounded-2xl border border-white/10 bg-white/[0.02] p-3">
            <div className="text-[10px] text-muted-foreground truncate">{t.label}</div>
            <div className={`text-lg font-bold tabular-nums ${t.tone}`}>{t.value}</div>
          </div>
        ))}
      </div>

      <div className="flex items-center gap-2">
        {(['failures', 'all'] as Filter[]).map((f) => (
          <button
            key={f}
            onClick={() => setFilter(f)}
            className={`px-3 py-1.5 rounded-xl text-xs font-semibold border ${
              filter === f ? 'bg-primary text-primary-foreground border-transparent' : 'bg-white/5 border-white/10'
            }`}
          >
            {f === 'failures' ? 'Failures only' : 'All events'}
          </button>
        ))}
        <button
          onClick={clearLiveEvents}
          className="ml-auto px-3 py-1.5 rounded-xl text-xs font-semibold bg-white/5 border border-white/10 flex items-center gap-1.5"
        >
          <Trash2 className="w-3.5 h-3.5" /> Clear
        </button>
      </div>

      <div className="rounded-2xl border border-white/10 bg-white/[0.02] overflow-hidden">
        {shown.length === 0 ? (
          <div className="p-6 text-center text-sm text-muted-foreground">
            Nothing captured yet. Play a song and failures will stream in here live.
          </div>
        ) : (
          <div className="divide-y divide-white/5 max-h-[60vh] overflow-y-auto">
            {shown.map((e, i) => {
              const fail = isFailure(e);
              const outcome = retryOutcome(e);
              return (
                <div key={`${e.at}-${i}`} className="px-3 py-2.5 flex items-start gap-2.5 text-xs">
                  <div className="mt-0.5 shrink-0">
                    {fail ? (
                      (e.message || '').toLowerCase().includes('failed to fetch') ? (
                        <WifiOff className="w-4 h-4 text-amber-300" />
                      ) : (
                        <AlertTriangle className="w-4 h-4 text-rose-300" />
                      )
                    ) : (
                      <CheckCircle2 className="w-4 h-4 text-emerald-300" />
                    )}
                  </div>
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2">
                      <span className="font-bold truncate">{e.event_type}</span>
                      {e.source && <span className="text-muted-foreground truncate">· {e.source}</span>}
                      {e.latency_ms != null && <span className="text-muted-foreground tabular-nums">· {e.latency_ms}ms</span>}
                    </div>
                    {e.message && <div className="text-muted-foreground mt-0.5 break-words">{e.message}</div>}
                    {outcome && (
                      <div className={`mt-0.5 flex items-center gap-1 ${outcome.tone}`}>
                        <RotateCcw className="w-3 h-3" /> {outcome.label}
                      </div>
                    )}
                  </div>
                  <div className="text-muted-foreground tabular-nums shrink-0">{timeOf(e.at)}</div>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
