import { useEffect, useMemo, useState } from 'react';
import { ChevronLeft, Clock, Flame, Music2, Mic2 } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/contexts/AuthContext';
import PageTransition from '@/components/PageTransition';
import SEOHead from '@/components/SEOHead';
import BottomNav from '@/components/BottomNav';

type PlayRow = { title: string | null; artist: string | null; created_at: string };

const SettingsStats = () => {
  const navigate = useNavigate();
  const { user } = useAuth();
  const [rows, setRows] = useState<PlayRow[] | null>(null);

  useEffect(() => {
    let cancel = false;
    if (!user) { setRows([]); return; }
    (async () => {
      const since = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString();
      const { data } = await supabase
        .from('song_play_events')
        .select('title, artist, created_at')
        .eq('user_id', user.id)
        .gte('created_at', since)
        .order('created_at', { ascending: false })
        .limit(2000);
      if (!cancel) setRows((data as PlayRow[]) ?? []);
    })();
    return () => { cancel = true; };
  }, [user]);

  const stats = useMemo(() => {
    if (!rows) return null;
    const totalMinutes = Math.round((rows.length * 3.2)); // ~avg song length proxy
    const week = Date.now() - 7 * 24 * 60 * 60 * 1000;
    const weekRows = rows.filter(r => new Date(r.created_at).getTime() >= week);
    const artistTally = new Map<string, number>();
    const songTally = new Map<string, { title: string; artist: string; n: number }>();
    for (const r of rows) {
      const a = (r.artist || 'Unknown').trim();
      const t = (r.title || 'Unknown').trim();
      artistTally.set(a, (artistTally.get(a) ?? 0) + 1);
      const key = `${t}__${a}`;
      const prev = songTally.get(key);
      if (prev) prev.n += 1; else songTally.set(key, { title: t, artist: a, n: 1 });
    }
    const topArtists = [...artistTally.entries()].sort((a, b) => b[1] - a[1]).slice(0, 5);
    const topSongs = [...songTally.values()].sort((a, b) => b.n - a.n).slice(0, 5);
    // Listening streak (consecutive days with at least one play)
    const days = new Set(rows.map(r => new Date(r.created_at).toDateString()));
    let streak = 0;
    const d = new Date();
    while (days.has(d.toDateString())) { streak += 1; d.setDate(d.getDate() - 1); }
    return { totalMinutes, weekPlays: weekRows.length, topArtists, topSongs, streak };
  }, [rows]);

  return (
    <PageTransition>
      <SEOHead title="Listening Stats — Univers Flow" description="Your private listening insights for the last 30 days." />
      <div className="h-[100dvh] bg-background flex flex-col overflow-hidden">
        <header
          className="flex-shrink-0 z-30 px-2 pt-3 pb-2 flex items-center safe-area-pt"
          style={{ background: 'hsl(var(--background) / 0.85)', backdropFilter: 'blur(40px)' }}
        >
          <button onClick={() => navigate(-1)} className="flex items-center gap-0.5 px-2 py-2 -ml-1 text-primary">
            <ChevronLeft className="w-5 h-5" />
            <span className="text-sm">Back</span>
          </button>
          <h1 className="text-sm font-semibold absolute left-1/2 -translate-x-1/2">Listening Stats</h1>
        </header>

        <main className="flex-1 overflow-y-auto px-4 pt-3 pb-32 space-y-4">
          {!stats ? (
            <div className="text-center text-white/40 text-sm py-12">Loading your insights…</div>
          ) : rows!.length === 0 ? (
            <div className="text-center text-white/40 text-sm py-12">No listening data yet — play a few songs to see your stats here.</div>
          ) : (
            <>
              <section className="grid grid-cols-2 gap-3">
                <StatTile icon={<Clock className="w-4 h-4 text-primary" />} label="Minutes (30d)" value={`${stats.totalMinutes}m`} />
                <StatTile icon={<Flame className="w-4 h-4 text-primary" />} label="Day streak" value={`${stats.streak}d`} />
                <StatTile icon={<Music2 className="w-4 h-4 text-primary" />} label="Plays this week" value={String(stats.weekPlays)} />
                <StatTile icon={<Mic2 className="w-4 h-4 text-primary" />} label="Total plays" value={String(rows!.length)} />
              </section>

              <section>
                <h2 className="text-[10px] font-extrabold text-white/40 uppercase tracking-[0.2em] mb-2.5 px-1">Top Artists</h2>
                <div className="rounded-3xl overflow-hidden bg-card/50 border border-white/5">
                  {stats.topArtists.map(([name, n], i) => (
                    <div key={name} className={`px-4 py-3 flex items-center justify-between ${i < stats.topArtists.length - 1 ? 'border-b border-white/5' : ''}`}>
                      <div className="flex items-center gap-3 min-w-0">
                        <span className="text-xs text-white/40 w-4">{i + 1}</span>
                        <span className="text-sm truncate">{name}</span>
                      </div>
                      <span className="text-xs text-primary font-medium">{n} plays</span>
                    </div>
                  ))}
                </div>
              </section>

              <section>
                <h2 className="text-[10px] font-extrabold text-white/40 uppercase tracking-[0.2em] mb-2.5 px-1">Top Songs</h2>
                <div className="rounded-3xl overflow-hidden bg-card/50 border border-white/5">
                  {stats.topSongs.map((s, i) => (
                    <div key={`${s.title}-${s.artist}`} className={`px-4 py-3 flex items-center justify-between ${i < stats.topSongs.length - 1 ? 'border-b border-white/5' : ''}`}>
                      <div className="flex items-center gap-3 min-w-0">
                        <span className="text-xs text-white/40 w-4">{i + 1}</span>
                        <div className="min-w-0">
                          <div className="text-sm truncate">{s.title}</div>
                          <div className="text-[11px] text-white/40 truncate">{s.artist}</div>
                        </div>
                      </div>
                      <span className="text-xs text-primary font-medium">{s.n}×</span>
                    </div>
                  ))}
                </div>
              </section>
            </>
          )}
        </main>
        <BottomNav />
      </div>
    </PageTransition>
  );
};

const StatTile = ({ icon, label, value }: { icon: React.ReactNode; label: string; value: string }) => (
  <div className="rounded-2xl bg-card/50 border border-white/5 px-4 py-3">
    <div className="flex items-center gap-2 mb-1">{icon}<span className="text-[11px] text-white/50">{label}</span></div>
    <div className="text-xl font-semibold">{value}</div>
  </div>
);

export default SettingsStats;
