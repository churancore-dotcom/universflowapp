// Tiny client-side performance + error logger. Batches writes so we never
// stall the UI. Anyone (even anonymous listeners) can insert; only admins
// can read them. RLS enforces this server-side.
import { supabase } from '@/integrations/supabase/client';

export type PerfSeverity = 'info' | 'warn' | 'error';

export interface PerfEventInput {
  event_type: string;          // 'playback_start' | 'playback_stall' | 'playback_error' | 'audio_load' | 'custom'
  severity?: PerfSeverity;
  track_id?: string | null;
  source?: string | null;
  latency_ms?: number | null;
  message?: string | null;
  details?: Record<string, unknown>;
}

interface QueuedEvent extends PerfEventInput {
  user_id: string | null;
  user_agent: string;
  route: string;
  created_at: string;
}

const queue: QueuedEvent[] = [];
let flushTimer: number | null = null;
const MAX_QUEUE = 50;

async function flush() {
  flushTimer = null;
  if (queue.length === 0) return;
  const batch = queue.splice(0, queue.length);
  try {
    await supabase.from('perf_events').insert(
      batch.map((e) => ({
        user_id: e.user_id,
        event_type: e.event_type,
        severity: e.severity ?? 'info',
        track_id: e.track_id ?? null,
        source: e.source ?? null,
        latency_ms: e.latency_ms ?? null,
        message: e.message ?? null,
        details: (e.details ?? {}) as Record<string, unknown> as never,
        user_agent: e.user_agent,
        route: e.route,
      })),
    );
  } catch {
    // best-effort — silently drop if offline
  }
}

function scheduleFlush() {
  if (flushTimer != null) return;
  flushTimer = window.setTimeout(flush, 1500);
}

export function recordPerfEvent(evt: PerfEventInput) {
  try {
    let uid: string | null = null;
    try {
      // Pull cached session synchronously when available
      const raw = localStorage.getItem('sb-' + (location.host.split('.')[0]) + '-auth-token');
      if (raw) uid = JSON.parse(raw)?.user?.id ?? null;
    } catch {}

    queue.push({
      ...evt,
      user_id: uid,
      user_agent: navigator.userAgent.slice(0, 240),
      route: location.pathname,
      created_at: new Date().toISOString(),
    });
    if (queue.length >= MAX_QUEUE) {
      void flush();
    } else {
      scheduleFlush();
    }
  } catch {
    // never throw from a logger
  }
}

// Flush on tab hide so events aren't lost
if (typeof document !== 'undefined') {
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'hidden' && queue.length > 0) void flush();
  });
}
