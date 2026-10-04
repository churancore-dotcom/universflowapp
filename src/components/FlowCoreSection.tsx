import { memo, useMemo } from 'react';
import { Play, Sparkles, Vault, Link2 } from 'lucide-react';
import { usePlayer, type Song } from '@/contexts/PlayerContext';
import { useLocalRecents } from '@/hooks/useLocalRecents';
import { recentSongs } from '@/lib/personalHome';
import { songFingerprint, isJunkRailTrack } from '@/lib/railQuality';
import type { LocalRecentEntry } from '@/lib/localRecentlyPlayed';
import { triggerHaptic } from '@/hooks/useHaptics';
import OptimizedImage from './OptimizedImage';

/**
 * FLOW CORE — built only from real signals: the listener's own play history
 * and the live official-chart pool Home already loaded. Every sub-block hides
 * itself when its signal is missing; nothing is invented.
 */

const DAY = 24 * 60 * 60 * 1000;

function vibeFor(hour: number) {
  if (hour < 5) return { label: 'Late Night Drift', hint: 'Low-light picks' };
  if (hour < 12) return { label: 'Morning Lift', hint: 'Easy start' };
  if (hour < 17) return { label: 'Daytime Focus', hint: 'Steady energy' };
  if (hour < 22) return { label: 'Evening Glow', hint: 'Wind-up hour' };
  return { label: 'Midnight Mode', hint: 'After-hours' };
}

/** Songs played 2+ times but not in the last 3 days — real favourites to bring back. */
function rotationVault(entries: LocalRecentEntry[]): Song[] {
  const now = Date.now();
  const stats = new Map<string, { count: number; last: number; entry: LocalRecentEntry }>();
  for (const e of entries) {
    if (!e.song?.title) continue;
    const fp = songFingerprint(e.song);
    const s = stats.get(fp);
    if (s) { s.count += 1; s.last = Math.max(s.last, e.played_at); }
    else stats.set(fp, { count: 1, last: e.played_at, entry: e });
  }
  const picks = [...stats.values()]
    .filter((s) => s.count >= 2 && now - s.last > 3 * DAY)
    .sort((a, b) => b.count - a.count)
    .map((s) => s.entry);
  return recentSongs(picks).slice(0, 10);
}

/** Two different artists played back-to-back within 30 minutes. */
function sonicPairings(entries: LocalRecentEntry[]): { a: Song; b: Song }[] {
  const sorted = [...entries].sort((x, y) => x.played_at - y.played_at);
  const out: { a: Song; b: Song }[] = [];
  const seen = new Set<string>();
  for (let i = 1; i < sorted.length; i++) {
    const p = sorted[i - 1], c = sorted[i];
    if (!p.song?.artist || !c.song?.artist) continue;
    if (c.played_at - p.played_at > 30 * 60 * 1000) continue;
    if (p.song.artist.toLowerCase() === c.song.artist.toLowerCase()) continue;
    const key = [p.song.artist, c.song.artist].map((v) => v.toLowerCase()).sort().join('|');
    if (seen.has(key)) continue;
    const [a] = recentSongs([p]);
    const [b] = recentSongs([c]);
    if (!a || !b) continue;
    seen.add(key);
    out.push({ a, b });
  }
  return out.reverse().slice(0, 6);
}

const FlowCoreSection = memo(({ pool }: { pool: Song[] }) => {
  const { playSong } = usePlayer();
  const entries = useLocalRecents(200);
  const vibe = vibeFor(new Date().getHours());

  const { flowQueue, vault, pairs, topArtist } = useMemo(() => {
    const recents = recentSongs(entries);
    const counts = new Map<string, number>();
    recents.forEach((s) => counts.set(s.artist.toLowerCase(), (counts.get(s.artist.toLowerCase()) || 0) + 1));
    const liked = new Set([...counts.keys()]);
    const realPool = pool.filter((s) => !isJunkRailTrack(s));
    const matched = realPool.filter((s) => liked.has((s.artist || '').toLowerCase()));
    const fresh = realPool.filter((s) => !liked.has((s.artist || '').toLowerCase()));
    // Interleave: your favourites, chart songs by artists you play, then fresh chart picks.
    const seen = new Set<string>();
    const q: Song[] = [];
    const lists = [recents.slice(0, 15), matched, fresh];
    for (let i = 0; q.length < 30 && i < 40; i++) {
      for (const l of lists) {
        const s = l[i];
        if (!s) continue;
        const fp = songFingerprint(s);
        if (seen.has(fp)) continue;
        seen.add(fp);
        q.push(s);
      }
    }
    const top = [...counts.entries()].sort((a, b) => b[1] - a[1])[0];
    const topName = top ? recents.find((s) => s.artist.toLowerCase() === top[0])?.artist : undefined;
    return { flowQueue: q, vault: rotationVault(entries), pairs: sonicPairings(entries), topArtist: topName };
  }, [entries, pool]);

  if (!flowQueue.length) return null;
  const covers = flowQueue.filter((s) => s.cover_url).slice(0, 3);

  const start = (queue: Song[], i = 0) => {
    if (!queue[i]) return;
    triggerHaptic();
    playSong(queue[i], null, queue);
  };

  return (
    <section className="space-y-6" aria-label="Flow Core">
      <div className="relative overflow-hidden rounded-[28px] border border-border bg-card p-5">
        <div className="pointer-events-none absolute -right-10 -top-10 h-44 w-44 rounded-full bg-primary/25 blur-3xl animate-[pulse_4s_ease-in-out_infinite]" />
        <div className="relative flex items-center gap-4">
          <div className="relative h-20 w-20 shrink-0">
            <span className="absolute inset-0 rounded-full bg-primary/30 animate-ping [animation-duration:2.6s]" />
            <div className="relative h-full w-full overflow-hidden rounded-full ring-2 ring-primary/60">
              {covers[0]?.cover_url ? (
                <OptimizedImage src={covers[0].cover_url} alt="" className="h-full w-full object-cover" />
              ) : <div className="h-full w-full bg-primary/20" />}
            </div>
          </div>
          <div className="min-w-0">
            <p className="flex items-center gap-1 text-[11px] font-semibold uppercase tracking-widest text-primary">
              <Sparkles className="h-3 w-3" /> Flow Core
            </p>
            <h2 className="mt-1 truncate text-xl font-bold text-foreground">{vibe.label}</h2>
            <p className="truncate text-xs text-muted-foreground">
              {topArtist ? `${vibe.hint} · built around ${topArtist}` : `${vibe.hint} · from today's charts`}
            </p>
          </div>
        </div>
        <button
          type="button"
          onClick={() => start(flowQueue)}
          className="relative mt-5 flex w-full items-center justify-center gap-2 rounded-full bg-primary py-3 text-sm font-semibold text-primary-foreground active:scale-[0.98] transition-transform"
        >
          <Play className="h-4 w-4 fill-current" /> Enter Flow · {flowQueue.length} songs
        </button>
      </div>

      {vault.length >= 2 && (
        <div>
          <h3 className="mb-3 flex items-center gap-2 text-lg font-bold text-foreground">
            <Vault className="h-4 w-4 text-primary" /> Rotation Vault
          </h3>
          <p className="-mt-2 mb-3 text-xs text-muted-foreground">Songs you loved but haven't played lately</p>
          <div className="-mx-6 flex gap-3 overflow-x-auto px-6 pb-1 scrollbar-hide">
            {vault.map((s, i) => (
              <button key={s.id} type="button" onClick={() => start(vault, i)} className="w-28 shrink-0 text-left">
                <div className="aspect-square overflow-hidden rounded-2xl bg-muted">
                  {s.cover_url && <OptimizedImage src={s.cover_url} alt={s.title} className="h-full w-full object-cover" />}
                </div>
                <p className="mt-2 truncate text-sm font-medium text-foreground">{s.title}</p>
                <p className="truncate text-xs text-muted-foreground">{s.artist}</p>
              </button>
            ))}
          </div>
        </div>
      )}

      {pairs.length >= 1 && (
        <div>
          <h3 className="mb-3 flex items-center gap-2 text-lg font-bold text-foreground">
            <Link2 className="h-4 w-4 text-primary" /> Sonic Pairings
          </h3>
          <p className="-mt-2 mb-3 text-xs text-muted-foreground">Artists you play back to back</p>
          <div className="-mx-6 flex gap-3 overflow-x-auto px-6 pb-1 scrollbar-hide">
            {pairs.map(({ a, b }) => (
              <button key={`${a.id}-${b.id}`} type="button" onClick={() => start([a, b])} className="w-44 shrink-0 rounded-2xl border border-border bg-card p-3 text-left">
                <div className="flex -space-x-3">
                  {[a, b].map((s) => (
                    <div key={s.id} className="h-12 w-12 overflow-hidden rounded-full ring-2 ring-card bg-muted">
                      {s.cover_url && <OptimizedImage src={s.cover_url} alt="" className="h-full w-full object-cover" />}
                    </div>
                  ))}
                </div>
                <p className="mt-2 truncate text-sm font-semibold text-foreground">{a.artist} + {b.artist}</p>
                <p className="truncate text-xs text-muted-foreground">{a.title} → {b.title}</p>
              </button>
            ))}
          </div>
        </div>
      )}
    </section>
  );
});

FlowCoreSection.displayName = 'FlowCoreSection';
export default FlowCoreSection;
