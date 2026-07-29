import { useEffect, useMemo, useState } from 'react';
import { useOutletContext, Link } from '@/lib/router-compat';
import {
  Music2, Heart, Download, Eye, Play, Globe2, Loader2, TrendingUp, TrendingDown,
  Users, Bookmark, Share2, ChevronRight, MapPin,
} from 'lucide-react';
import {
  ResponsiveContainer, LineChart, Line, XAxis, YAxis, Tooltip, CartesianGrid, Area, AreaChart,
} from 'recharts';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/contexts/AuthContext';
import { ArtistSong, fmt } from './_shared';
import BentoCard from '@/components/artist/BentoCard';

type Ctx = { songs: ArtistSong[]; followers: number };
type Range = '24h' | '7d' | '28d' | '90d' | '12mo' | 'lifetime';

const RANGES: Array<{ key: Range; label: string; days: number | null; bucket: 'hour' | 'day' | 'week' | 'month' }> = [
  { key: '24h',     label: '24h',     days: 1,    bucket: 'hour' },
  { key: '7d',      label: '7d',      days: 7,    bucket: 'day' },
  { key: '28d',     label: '28d',     days: 28,   bucket: 'day' },
  { key: '90d',     label: '90d',     days: 90,   bucket: 'week' },
  { key: '12mo',    label: '12mo',    days: 365,  bucket: 'month' },
  { key: 'lifetime',label: 'Lifetime',days: null, bucket: 'month' },
];

function flagEmoji(cc: string | null | undefined) {
  if (!cc || cc.length !== 2) return '🌍';
  const A = 0x1F1E6, base = 'A'.charCodeAt(0);
  return String.fromCodePoint(...cc.toUpperCase().split('').map((c) => A + (c.charCodeAt(0) - base)));
}

type Totals = {
  streams: number; listeners: number; saves: number;
  shares: number; skips: number; followers_gained: number;
};
type SeriesPoint = { t: string; streams: number; listeners: number; saves: number };
type CityRow = { city: string; country_code: string | null; country_name: string | null; count: number };
type CountryRow = { country_code: string | null; country_name: string | null; count: number };
type TopSong = { id: string; title: string; cover_url: string | null; streams: number; saves: number; listeners: number };

export default function ArtistAnalytics() {
  const { user } = useAuth();
  const { songs, followers } = useOutletContext<Ctx>();
  const [range, setRange] = useState<Range>('28d');
  const [totals, setTotals] = useState<Totals | null>(null);
  const [prevStreams, setPrevStreams] = useState<number>(0);
  const [series, setSeries] = useState<SeriesPoint[]>([]);
  const [cities, setCities] = useState<CityRow[]>([]);
  const [countries, setCountries] = useState<CountryRow[]>([]);
  const [topSongs, setTopSongs] = useState<TopSong[]>([]);
  const [loading, setLoading] = useState(true);
  const [tick, setTick] = useState(0);

  const cfg = useMemo(() => RANGES.find(r => r.key === range)!, [range]);

  useEffect(() => {
    if (!user) return;
    let alive = true;
    (async () => {
      setLoading(true);
      const now = new Date();
      const until = now;
      const since = cfg.days == null
        ? new Date('2020-01-01T00:00:00Z')
        : new Date(now.getTime() - cfg.days * 86400000);
      const prevSince = cfg.days == null
        ? new Date('2020-01-01T00:00:00Z')
        : new Date(now.getTime() - 2 * cfg.days * 86400000);
      const prevUntil = since;

      const [{ data: curData, error: e1 }, { data: prevData }] = await Promise.all([
        supabase.rpc('get_artist_analytics', {
          _artist_user_id: user.id,
          _since: since.toISOString(),
          _until: until.toISOString(),
          _bucket: cfg.bucket,
        }),
        cfg.days == null
          ? Promise.resolve({ data: null })
          : supabase.rpc('get_artist_analytics', {
              _artist_user_id: user.id,
              _since: prevSince.toISOString(),
              _until: prevUntil.toISOString(),
              _bucket: cfg.bucket,
            }),
      ]);
      if (!alive) return;
      if (e1) {
        console.error('get_artist_analytics failed', e1);
        setLoading(false);
        return;
      }
      const cur = (curData as { totals: Totals; series: SeriesPoint[]; top_cities: CityRow[]; top_countries: CountryRow[]; top_songs: TopSong[] }) ?? null;
      setTotals(cur?.totals ?? null);
      setSeries(cur?.series ?? []);
      setCities(cur?.top_cities ?? []);
      setCountries(cur?.top_countries ?? []);
      setTopSongs(cur?.top_songs ?? []);
      const prev = (prevData as { totals?: Totals } | null)?.totals;
      setPrevStreams(prev?.streams ?? 0);
      setLoading(false);
    })();
    return () => { alive = false; };
  }, [user, range, cfg, tick]);

  // Realtime: re-fetch when new play events land on any of this artist's songs.
  useEffect(() => {
    if (!user || !songs.length) return;
    const ch = supabase
      .channel(`artist-analytics-${user.id}`)
      .on('postgres_changes',
        { event: 'INSERT', schema: 'public', table: 'song_play_events' },
        () => { setTick(t => t + 1); })
      .subscribe();
    return () => { supabase.removeChannel(ch); };
  }, [user, songs.length]);

  const streamsInRange = totals?.streams ?? 0;
  const delta = prevStreams === 0
    ? (streamsInRange === 0 ? 0 : 100)
    : ((streamsInRange - prevStreams) / prevStreams) * 100;

  const lifetimeTotals = useMemo(() => ({
    plays: songs.reduce((a, s) => a + (s.play_count || 0), 0),
    views: songs.reduce((a, s) => a + (s.view_count || 0), 0),
    likes: songs.reduce((a, s) => a + (s.like_count || 0), 0),
    downloads: songs.reduce((a, s) => a + (s.download_count || 0), 0),
  }), [songs]);

  const seriesForChart = useMemo(() => series.map(p => {
    const d = new Date(p.t);
    const label = cfg.bucket === 'hour'
      ? `${d.getHours().toString().padStart(2, '0')}:00`
      : cfg.bucket === 'month'
        ? d.toLocaleString(undefined, { month: 'short' })
        : `${d.getMonth() + 1}/${d.getDate()}`;
    return { ...p, label };
  }), [series, cfg]);

  return (
    <div className="max-w-3xl mx-auto px-5 pt-5 pb-16">
      {/* Header */}
      <div className="flex items-end justify-between">
        <div>
          <p className="text-[10px] uppercase tracking-[0.22em] text-muted-foreground/80 font-semibold">
            Insights
          </p>
          <h2 className="font-display text-[28px] leading-none tracking-tight mt-1">Analytics</h2>
          <p className="text-[12px] text-muted-foreground mt-1.5">
            Realtime — refreshes as new plays come in.
          </p>
        </div>
        <div className="flex items-center gap-1.5 text-[10px] font-semibold tracking-wider uppercase text-emerald-300/90">
          <span className="relative flex w-1.5 h-1.5">
            <span className="absolute inset-0 rounded-full bg-emerald-400 animate-ping opacity-75" />
            <span className="relative inline-flex w-1.5 h-1.5 rounded-full bg-emerald-400" />
          </span>
          Live
        </div>
      </div>

      {/* Range switch */}
      <div className="mt-4 flex items-center gap-1.5 overflow-x-auto -mx-1 px-1 scrollbar-none">
        {RANGES.map(r => (
          <button
            key={r.key}
            onClick={() => setRange(r.key)}
            className={`shrink-0 px-3 h-8 rounded-full text-[11.5px] font-semibold transition ${
              range === r.key ? 'bg-white text-black' : 'bg-white/[0.05] text-muted-foreground active:scale-95'
            }`}
          >
            {r.label}
          </button>
        ))}
      </div>

      {/* KPI grid */}
      <section className="grid grid-cols-2 gap-3 mt-4">
        <Kpi label="Streams" value={fmt(streamsInRange)} icon={<Play className="w-3.5 h-3.5" />} accent delta={cfg.days == null ? null : delta} />
        <Kpi label="Listeners" value={fmt(totals?.listeners ?? 0)} icon={<Users className="w-3.5 h-3.5" />} />
        <Kpi label="Saves" value={fmt(totals?.saves ?? 0)} icon={<Bookmark className="w-3.5 h-3.5" />} />
        <Kpi label="Shares" value={fmt(totals?.shares ?? 0)} icon={<Share2 className="w-3.5 h-3.5" />} />
        <Kpi label="Followers gained" value={fmt(totals?.followers_gained ?? 0)} icon={<Heart className="w-3.5 h-3.5" />} />
        <Kpi label="Followers total" value={fmt(followers)} icon={<Users className="w-3.5 h-3.5" />} />
      </section>

      {/* Chart */}
      <BentoCard className="mt-4 p-5">
        <div className="flex items-center justify-between mb-1">
          <div>
            <p className="text-[10.5px] uppercase tracking-[0.22em] text-muted-foreground/80 font-semibold">
              Streams & listeners
            </p>
            <div className="flex items-center gap-2 mt-1">
              <p className="font-display text-[24px] leading-none tabular-nums">
                {fmt(streamsInRange)}
              </p>
              {cfg.days != null && <DeltaPill value={delta} />}
            </div>
          </div>
        </div>
        <div className="h-[220px] mt-3">
          {loading ? (
            <div className="h-full grid place-items-center text-muted-foreground">
              <Loader2 className="w-4 h-4 animate-spin" />
            </div>
          ) : !seriesForChart.length || seriesForChart.every(p => p.streams === 0 && p.listeners === 0) ? (
            <div className="h-full grid place-items-center text-[12.5px] text-muted-foreground">
              No plays in this window yet.
            </div>
          ) : (
            <ResponsiveContainer width="100%" height="100%">
              <AreaChart data={seriesForChart} margin={{ top: 6, right: 6, bottom: 0, left: -18 }}>
                <defs>
                  <linearGradient id="gStreams" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stopColor="#FF2D55" stopOpacity={0.35} />
                    <stop offset="100%" stopColor="#FF2D55" stopOpacity={0} />
                  </linearGradient>
                </defs>
                <CartesianGrid stroke="rgba(255,255,255,0.05)" vertical={false} />
                <XAxis dataKey="label" tick={{ fill: 'rgba(255,255,255,0.45)', fontSize: 10 }} axisLine={false} tickLine={false} interval="preserveStartEnd" />
                <YAxis tick={{ fill: 'rgba(255,255,255,0.45)', fontSize: 10 }} axisLine={false} tickLine={false} allowDecimals={false} width={28} />
                <Tooltip
                  contentStyle={{ background: 'rgba(10,10,12,0.95)', border: '1px solid rgba(255,255,255,0.08)', borderRadius: 12, fontSize: 12 }}
                  labelStyle={{ color: 'rgba(255,255,255,0.6)' }}
                />
                <Area type="monotone" dataKey="streams" stroke="#FF2D55" strokeWidth={2.25} fill="url(#gStreams)" name="Streams" />
                <Line type="monotone" dataKey="listeners" stroke="rgba(255,255,255,0.55)" strokeWidth={1.5} dot={false} name="Listeners" />
              </AreaChart>
            </ResponsiveContainer>
          )}
        </div>
      </BentoCard>

      {/* Top songs — with per-song drill-down */}
      <div className="mt-6 flex items-baseline justify-between">
        <div>
          <p className="text-[10px] uppercase tracking-[0.22em] text-muted-foreground/80 font-semibold">Top songs</p>
          <h3 className="font-display text-[20px] leading-none tracking-tight mt-1.5">Your biggest tracks</h3>
        </div>
        <p className="text-[11px] text-muted-foreground">Tap for details</p>
      </div>
      <BentoCard className="mt-3 overflow-hidden">
        {!topSongs.length ? (
          <div className="p-8 text-center text-[13px] text-muted-foreground">
            {songs.length === 0 ? 'Upload a song to start tracking analytics.' : 'No streams in this window yet.'}
          </div>
        ) : topSongs.map((s, i) => {
          const max = Math.max(1, topSongs[0].streams);
          const pct = Math.max(2, (s.streams / max) * 100);
          return (
            <Link
              key={s.id}
              to={`/artist/studio/songs/${s.id}/analytics`}
              className={`flex items-center gap-3 p-3.5 hover:bg-white/[0.03] transition ${i !== 0 ? 'border-t border-white/[0.05]' : ''}`}
            >
              <span className="w-5 text-[11px] font-semibold tabular-nums text-muted-foreground/70 text-right">{i + 1}</span>
              <div className="w-10 h-10 rounded-lg overflow-hidden bg-black/40 shrink-0 ring-1 ring-white/10">
                {s.cover_url
                  ? <img src={s.cover_url} alt="" className="w-full h-full object-cover" />
                  : <div className="w-full h-full grid place-items-center"><Music2 className="w-4 h-4 text-muted-foreground" /></div>}
              </div>
              <div className="flex-1 min-w-0">
                <p className="text-[13px] font-medium truncate">{s.title}</p>
                <div className="mt-1.5 h-1.5 rounded-full bg-white/[0.05] overflow-hidden">
                  <div className="h-full rounded-full transition-[width] duration-500"
                       style={{ width: `${pct}%`, background: 'linear-gradient(90deg, #FF2D55, #FF5A77)' }} />
                </div>
                <div className="mt-1 flex items-center gap-3 text-[10.5px] text-muted-foreground tabular-nums">
                  <span>{fmt(s.listeners)} listeners</span>
                  <span>{fmt(s.saves)} saves</span>
                </div>
              </div>
              <div className="flex items-center gap-1">
                <p className="text-[12px] font-semibold tabular-nums w-14 text-right">{fmt(s.streams)}</p>
                <ChevronRight className="w-4 h-4 text-muted-foreground/60" />
              </div>
            </Link>
          );
        })}
      </BentoCard>

      {/* Top cities */}
      <BentoCard className="mt-5 p-5">
        <div className="flex items-center gap-2 mb-3">
          <MapPin className="w-4 h-4 text-muted-foreground" />
          <p className="text-[13px] font-semibold tracking-tight">Top cities</p>
        </div>
        {!cities.length ? (
          <p className="text-[12.5px] text-muted-foreground py-6 text-center">
            City data appears as your songs get plays.
          </p>
        ) : (
          <div className="space-y-2.5">
            {cities.map((c, i) => {
              const max = cities[0].count;
              const pct = Math.max(4, (c.count / max) * 100);
              return (
                <div key={`${c.city}-${i}`} className="flex items-center gap-3">
                  <span className="text-[16px] leading-none w-6">{flagEmoji(c.country_code)}</span>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center justify-between text-[12px]">
                      <span className="truncate font-medium">{c.city}<span className="text-muted-foreground/70">, {c.country_name || c.country_code || '—'}</span></span>
                      <span className="tabular-nums text-muted-foreground">{fmt(c.count)}</span>
                    </div>
                    <div className="mt-1 h-1 rounded-full bg-white/[0.05] overflow-hidden">
                      <div className="h-full rounded-full"
                           style={{ width: `${pct}%`, background: 'linear-gradient(90deg, #FF2D55, #FF8A9E)' }} />
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </BentoCard>

      {/* Top countries */}
      <BentoCard className="mt-5 p-5">
        <div className="flex items-center gap-2 mb-3">
          <Globe2 className="w-4 h-4 text-muted-foreground" />
          <p className="text-[13px] font-semibold tracking-tight">Top listener countries</p>
        </div>
        {!countries.length ? (
          <p className="text-[12.5px] text-muted-foreground py-6 text-center">
            Location data appears once your songs start getting plays.
          </p>
        ) : (
          <div className="space-y-2.5">
            {countries.map((c, i) => {
              const max = countries[0].count;
              const pct = Math.max(4, (c.count / max) * 100);
              return (
                <div key={`${c.country_code ?? c.country_name}-${i}`} className="flex items-center gap-3">
                  <span className="text-[18px] leading-none w-6">{flagEmoji(c.country_code)}</span>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center justify-between text-[12px]">
                      <span className="truncate font-medium">{c.country_name || c.country_code || 'Unknown'}</span>
                      <span className="tabular-nums text-muted-foreground">{fmt(c.count)}</span>
                    </div>
                    <div className="mt-1 h-1 rounded-full bg-white/[0.05] overflow-hidden">
                      <div className="h-full rounded-full"
                           style={{ width: `${pct}%`, background: 'linear-gradient(90deg, #FF2D55, #FF8A9E)' }} />
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </BentoCard>

      {/* Lifetime totals footer */}
      <div className="mt-6 grid grid-cols-4 gap-3">
        <MiniStat label="Plays" value={fmt(lifetimeTotals.plays)} icon={<Play className="w-3 h-3" />} />
        <MiniStat label="Views" value={fmt(lifetimeTotals.views)} icon={<Eye className="w-3 h-3" />} />
        <MiniStat label="Likes" value={fmt(lifetimeTotals.likes)} icon={<Heart className="w-3 h-3" />} />
        <MiniStat label="Downloads" value={fmt(lifetimeTotals.downloads)} icon={<Download className="w-3 h-3" />} />
      </div>
      <p className="text-center text-[10.5px] text-muted-foreground/70 mt-2 uppercase tracking-[0.22em]">
        Lifetime totals · all-time
      </p>
    </div>
  );
}

function Kpi({
  label, value, icon, accent, delta,
}: { label: string; value: string; icon: React.ReactNode; accent?: boolean; delta?: number | null }) {
  return (
    <BentoCard glow={accent} className="p-4">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-1.5 text-[10px] uppercase tracking-[0.18em] text-muted-foreground/80 font-semibold">
          {icon}{label}
        </div>
        {delta != null && <DeltaPill value={delta} compact />}
      </div>
      <p className="mt-2 font-display text-[24px] tabular-nums leading-none">{value}</p>
    </BentoCard>
  );
}

function MiniStat({ label, value, icon }: { label: string; value: string; icon: React.ReactNode }) {
  return (
    <div className="rounded-xl bg-white/[0.03] border border-white/[0.05] p-2.5 text-center">
      <div className="flex items-center justify-center gap-1 text-[9.5px] uppercase tracking-[0.16em] text-muted-foreground/70">
        {icon}{label}
      </div>
      <p className="mt-1 font-display text-[15px] tabular-nums leading-none">{value}</p>
    </div>
  );
}

function DeltaPill({ value, compact }: { value: number; compact?: boolean }) {
  const up = value >= 0;
  const Icon = up ? TrendingUp : TrendingDown;
  const rounded = Math.abs(value) >= 100 ? Math.round(value) : Math.round(value * 10) / 10;
  return (
    <span
      className={`inline-flex items-center gap-1 rounded-full font-semibold tabular-nums ${compact ? 'px-1.5 py-0.5 text-[9.5px]' : 'px-2 py-0.5 text-[10px]'}`}
      style={{
        background: up ? 'rgba(16,185,129,0.12)' : 'rgba(244,63,94,0.12)',
        color: up ? '#34D399' : '#FB7185',
        border: up ? '1px solid rgba(16,185,129,0.25)' : '1px solid rgba(244,63,94,0.25)',
      }}
    >
      <Icon className={compact ? 'w-2.5 h-2.5' : 'w-3 h-3'} />
      {up ? '+' : ''}{rounded}%{compact ? '' : ' vs prev'}
    </span>
  );
}
