import { useCallback, useEffect, useState } from 'react';
import { RefreshCw, Radio } from 'lucide-react';
import { Capacitor } from '@capacitor/core';
import { InnerTubePlugin } from '@/lib/nativePlayer';

/**
 * Per-track resolver telemetry straight from the Android shell
 * (`MasterResolver.recentLog()` via `InnerTube.resolveLog`): which client
 * actually served each track, how long it took, and why YouTube lost when it
 * did. Read-only, on-device, nothing uploaded.
 */

type Entry = {
  videoId?: string;
  label?: string;
  winner?: string;
  latencyMs?: number;
  ytFailure?: string;
  at?: number;
};

const isAndroidShell = () =>
  Capacitor.isNativePlatform() && Capacitor.getPlatform() === 'android';

function toneFor(winner: string): string {
  const w = winner.toLowerCase();
  if (w.includes('po')) return 'bg-emerald-500/15 text-emerald-300';
  if (w.includes('yt') || w.includes('inner') || w.includes('android') || w.includes('ios') || w.includes('web'))
    return 'bg-primary/15 text-primary';
  if (w.includes('saavn') || w.includes('jio')) return 'bg-amber-500/15 text-amber-300';
  return 'bg-muted text-muted-foreground';
}

export default function ResolverLogPanel() {
  const [entries, setEntries] = useState<Entry[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    if (!isAndroidShell()) return;
    setBusy(true);
    try {
      const res = await (
        InnerTubePlugin as unknown as {
          resolveLog: (o: { limit: number }) => Promise<{ entries?: Entry[] }>;
        }
      ).resolveLog({ limit: 40 });
      setEntries(res?.entries ?? []);
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'resolveLog unavailable in this build');
    } finally {
      setBusy(false);
    }
  }, []);

  useEffect(() => {
    void load();
    const id = window.setInterval(() => void load(), 4000);
    return () => window.clearInterval(id);
  }, [load]);

  if (!isAndroidShell()) {
    return (
      <div className="rounded-2xl border border-border/60 bg-card/60 p-4">
        <p className="text-[13px] font-semibold text-foreground">Resolver log · Android only</p>
        <p className="text-[11px] text-muted-foreground mt-1">
          Open this screen inside the APK to see which client served each track.
        </p>
      </div>
    );
  }

  const yt = (entries ?? []).filter((e) => !/saavn|jio/i.test(e.winner || '')).length;
  const total = entries?.length ?? 0;

  return (
    <div className="rounded-2xl border border-border/60 bg-card/60 overflow-hidden">
      <div className="flex items-center justify-between px-4 py-3 border-b border-border/40">
        <div className="flex items-center gap-2">
          <Radio className="w-4 h-4 text-primary" />
          <div>
            <p className="text-[13px] font-semibold text-foreground">Who served each track</p>
            <p className="text-[11px] text-muted-foreground tabular-nums">
              {total ? `${yt}/${total} from YouTube` : 'Play a song to fill this log'}
            </p>
          </div>
        </div>
        <button
          type="button"
          onClick={() => void load()}
          className="w-8 h-8 rounded-xl border border-border/60 grid place-items-center active:opacity-60"
          aria-label="Refresh resolver log"
        >
          <RefreshCw className={`w-3.5 h-3.5 ${busy ? 'animate-spin' : ''}`} />
        </button>
      </div>

      {error && <p className="px-4 py-3 text-[11px] text-amber-300">{error}</p>}

      {entries?.map((e, i) => (
        <div key={`${e.videoId}-${e.at}-${i}`} className="px-4 py-3 border-b border-border/40 last:border-b-0">
          <div className="flex items-center gap-2">
            <span className={`px-2 py-0.5 rounded-lg text-[10px] font-bold uppercase tracking-wider ${toneFor(e.winner || '')}`}>
              {e.winner || 'unknown'}
            </span>
            <span className="text-[11px] tabular-nums text-muted-foreground">{e.latencyMs ?? '?'} ms</span>
            <span className="text-[10px] text-muted-foreground/70 ml-auto tabular-nums">
              {e.at ? new Date(e.at).toLocaleTimeString([], { hour12: false }) : ''}
            </span>
          </div>
          <p className="text-[12px] text-foreground truncate mt-1.5">{e.label || e.videoId}</p>
          {e.ytFailure && (
            <p className="text-[10px] text-rose-300 mt-0.5 break-words">YouTube lost: {e.ytFailure}</p>
          )}
        </div>
      ))}
    </div>
  );
}
