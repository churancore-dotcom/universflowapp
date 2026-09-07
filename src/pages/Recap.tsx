/**
 * Month Recap — a real screen (not a teaser) built from the listener's own
 * played tracks: measured/estimated minutes, top artist, personality, and the
 * full ranked list of tracks they played this month, each playable.
 */
import { useEffect, useMemo, useState } from 'react';
import { motion } from 'framer-motion';
import { ArrowLeft, Play, Share2, Sparkles } from 'lucide-react';
import { toast } from 'sonner';
import { useNavigate } from '@/lib/router-compat';
import { useAuth } from '@/contexts/AuthContext';
import { usePlayer, type Song } from '@/contexts/PlayerContext';
import { buildRecap, loadPlayRecords, type PlayRecord, type RecapSlideData } from '@/lib/listeningInsights';
import { isBlockedTrack } from '@/lib/blockedTracks';
import { triggerHaptic } from '@/hooks/useHaptics';
import BottomNav from '@/components/BottomNav';
import OptimizedImage from '@/components/OptimizedImage';
import { TabTransition } from '@/components/PageTransition';
import SEOHead from '@/components/SEOHead';

const fmt = (n: number) => n.toLocaleString();

const toSong = (record: PlayRecord): Song =>
  ({
    id: record.songId || record.fingerprint,
    title: record.title,
    artist: record.artist,
    cover_url: record.cover ?? undefined,
    audio_url: 'resolving',
    duration: record.duration ?? undefined,
  } as Song);

const Stat = ({ label, value }: { label: string; value: string }) => (
  <div className="rounded-[28px] border border-border/60 bg-card/70 px-4 py-3.5">
    <p className="font-display text-[26px] leading-none uppercase text-foreground tabular-nums">{value}</p>
    <p className="text-[11px] font-semibold uppercase tracking-[0.16em] text-muted-foreground mt-1.5">{label}</p>
  </div>
);

const Recap = () => {
  const navigate = useNavigate();
  const { user } = useAuth();
  const { playSong } = usePlayer();
  const [loading, setLoading] = useState(true);
  const [records, setRecords] = useState<PlayRecord[]>([]);
  const [recap, setRecap] = useState<RecapSlideData | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const all = await loadPlayRecords(user?.id ?? null);
        const clean = all.filter((r) => r.title && !isBlockedTrack(r.title, r.artist));
        if (cancelled) return;
        setRecords(clean);
        setRecap(buildRecap(clean, user?.id ?? null, 'month'));
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [user?.id]);

  /** The month's tracks, ranked by how often they were actually played. */
  const tracks = useMemo(() => {
    const monthStart = new Date();
    monthStart.setDate(1);
    monthStart.setHours(0, 0, 0, 0);
    let scoped = records.filter((r) => r.at >= monthStart.getTime());
    if (scoped.length < 10) scoped = records.filter((r) => r.at >= Date.now() - 30 * 86_400_000);

    const grouped = new Map<string, { record: PlayRecord; plays: number }>();
    for (const r of scoped) {
      const hit = grouped.get(r.fingerprint);
      if (hit) hit.plays += 1;
      else grouped.set(r.fingerprint, { record: r, plays: 1 });
    }
    return [...grouped.values()].sort((a, b) => b.plays - a.plays);
  }, [records]);

  const queue = useMemo(() => tracks.map((t) => toSong(t.record)), [tracks]);

  const share = async () => {
    if (!recap) return;
    const lines = [
      `My month in music — ${recap.windowLabel}`,
      recap.minutes !== null ? `${fmt(recap.minutes)} minutes listened` : null,
      recap.topArtist ? `Top artist: ${recap.topArtist.name}` : null,
      recap.topSong ? `Top song: ${recap.topSong.title}` : null,
      `Personality: ${recap.personality.name}`,
      'via Universflow',
    ].filter(Boolean).join('\n');
    try {
      if (navigator.share) await navigator.share({ title: 'My Universflow recap', text: lines });
      else {
        await navigator.clipboard.writeText(lines);
        toast.success('Recap copied — paste it anywhere');
      }
    } catch { /* dismissed */ }
  };

  return (
    <TabTransition>
      <div className="h-[100dvh] bg-background flex flex-col overflow-hidden">
        <SEOHead title="Your Recap — Universflow" description="Your listening recap: minutes, top artists and every track you played this month." path="/recap" noindex />

        <header className="flex-shrink-0 px-6 pt-6 pb-3 safe-area-pt flex items-center gap-3">
          <button onClick={() => navigate(-1)} aria-label="Go back" className="w-9 h-9 rounded-full bg-card border border-border/60 flex items-center justify-center active:scale-90 transition-transform">
            <ArrowLeft className="w-4 h-4" />
          </button>
          <div className="min-w-0 flex-1">
            <p className="text-[11px] font-semibold uppercase tracking-[0.22em] text-primary">
              {recap?.windowLabel ?? 'This month'}
            </p>
            <h1 className="font-display text-[26px] leading-none uppercase text-foreground mt-1">Your Recap</h1>
          </div>
          <button onClick={share} disabled={!recap} aria-label="Share recap" className="w-9 h-9 rounded-full bg-card border border-border/60 flex items-center justify-center disabled:opacity-40">
            <Share2 className="w-4 h-4" />
          </button>
        </header>

        <main className="flex-1 overflow-y-auto px-6 pb-40">
          {loading ? (
            <div className="space-y-3 mt-2">
              {[0, 1, 2, 3].map((i) => (
                <div key={i} className="h-16 rounded-[28px] bg-muted/50 animate-pulse" />
              ))}
            </div>
          ) : !recap ? (
            <div className="text-center py-20">
              <span className="w-14 h-14 rounded-full bg-primary/15 text-primary flex items-center justify-center mx-auto mb-4">
                <Sparkles className="w-6 h-6" />
              </span>
              <h2 className="font-display text-[28px] uppercase leading-tight">No recap yet</h2>
              <p className="text-[13px] text-muted-foreground mt-2">
                Play a few songs — your recap builds itself from your real listening.
              </p>
            </div>
          ) : (
            <>
              <div className="grid grid-cols-2 gap-3 mt-1">
                <Stat label="Plays" value={fmt(recap.totalPlays)} />
                <Stat label={recap.minutesEstimated ? 'Minutes (est.)' : 'Minutes'} value={recap.minutes !== null ? fmt(recap.minutes) : '--'} />
                <Stat label="Artists" value={fmt(recap.uniqueArtists)} />
                <Stat label="Active days" value={fmt(recap.activeDays)} />
              </div>

              {recap.topArtist && (
                <motion.div
                  initial={{ opacity: 0, y: 12 }}
                  animate={{ opacity: 1, y: 0 }}
                  className="mt-3 rounded-[28px] overflow-hidden bg-gradient-to-br from-primary via-primary/80 to-primary/40 p-5 flex items-center gap-4"
                >
                  <div className="w-[84px] h-[84px] shrink-0 rounded-[14px] overflow-hidden bg-background/30">
                    <OptimizedImage src={recap.topArtist.cover ?? undefined} alt={recap.topArtist.name} className="w-full h-full" />
                  </div>
                  <div className="min-w-0">
                    <p className="text-[11px] font-bold uppercase tracking-[0.2em] text-primary-foreground/70">Top artist</p>
                    <h2 className="font-display text-[24px] leading-tight uppercase text-primary-foreground line-clamp-2 mt-1">
                      {recap.topArtist.name}
                    </h2>
                    <p className="text-[12.5px] font-semibold text-primary-foreground/80 mt-0.5">
                      {fmt(recap.topArtist.plays)} plays
                    </p>
                  </div>
                </motion.div>
              )}

              <div className="mt-3 rounded-[28px] border border-border/60 bg-card/70 p-5">
                <p className="text-[11px] font-bold uppercase tracking-[0.2em] text-primary">Your listening personality</p>
                <h3 className="font-display text-[24px] uppercase leading-tight mt-1.5">{recap.personality.name}</h3>
                <p className="text-[13px] text-muted-foreground mt-2 leading-relaxed">{recap.personality.blurb}</p>
                {recap.topGenre && (
                  <p className="text-[11.5px] text-muted-foreground/70 mt-2">Most played sound: {recap.topGenre}</p>
                )}
              </div>

              {tracks.length > 0 && (
                <section className="mt-9">
                  <div className="flex items-end justify-between mb-4">
                    <h2 className="font-display text-[32px] leading-none uppercase text-foreground">Your Tracks</h2>
                    <button
                      onClick={() => { triggerHaptic('selection'); playSong(queue[0], null, queue.slice(0, 60)); }}
                      className="inline-flex items-center gap-1.5 rounded-full bg-primary text-primary-foreground px-4 py-2 text-[12px] font-bold"
                    >
                      <Play className="w-3.5 h-3.5 fill-current" /> Play all
                    </button>
                  </div>
                  <div className="divide-y divide-border/40">
                    {tracks.map(({ record, plays }, i) => (
                      <button
                        key={`${record.fingerprint}-${i}`}
                        onClick={() => {
                          triggerHaptic('selection');
                          playSong(queue[i], null, queue.slice(i).concat(queue.slice(0, i)).slice(0, 60));
                        }}
                        className="flex items-center gap-3.5 w-full text-left py-2.5 active:opacity-60 transition-opacity"
                      >
                        <span className="w-5 text-[12px] font-bold text-muted-foreground tabular-nums">{i + 1}</span>
                        <div className="w-12 h-12 shrink-0 rounded-[14px] overflow-hidden bg-muted">
                          <OptimizedImage src={record.cover ?? undefined} alt={record.title} className="w-full h-full" />
                        </div>
                        <div className="min-w-0 flex-1">
                          <p className="text-[14px] font-semibold text-foreground truncate">{record.title}</p>
                          <p className="text-[12px] text-muted-foreground truncate mt-0.5">{record.artist}</p>
                        </div>
                        <span className="text-[11.5px] text-muted-foreground tabular-nums shrink-0">
                          {plays}×
                        </span>
                      </button>
                    ))}
                  </div>
                </section>
              )}
            </>
          )}
        </main>

        <BottomNav />
      </div>
    </TabTransition>
  );
};

export default Recap;
