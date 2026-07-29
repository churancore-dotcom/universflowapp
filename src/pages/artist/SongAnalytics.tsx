import { useEffect, useMemo, useState } from 'react';
import { useParams, Link, useNavigate } from '@/lib/router-compat';
import {
  ArrowLeft, Play, Users, Bookmark, Share2, SkipForward, Loader2, Globe2, MapPin, Music2,
} from 'lucide-react';
import {
  ResponsiveContainer, AreaChart, Area, XAxis, YAxis, Tooltip, CartesianGrid, Line,
} from 'recharts';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/contexts/AuthContext';
import { fmt } from './_shared';
import BentoCard from '@/components/artist/BentoCard';

type Range = '24h' | '7d' | '28d' | '90d' | '12mo' | 'lifetime';
const RANGES: Array<{ key: Range; label: string; days: number | null; bucket: 'hour' | 'day' | 'week' | 'month' }> = [
  { key: '24h',     label: '24h',    days: 1,    bucket: 'hour' },
  { key: '7d',      label: '7d',     days: 7,    bucket: 'day' },
  { key: '28d',     label: '28d',    days: 28,   bucket: 'day' },
  { key: '90d',     label: '90d',    days: 90,   bucket: 'week' },
  { key: '12mo',    label: '12mo',   days: 365,  bucket: 'month' },
  { key: 'lifetime',label: 'Lifetime',days: null,bucket: 'month' },
];

function flagEmoji(cc: string | null | undefined) {
  if (!cc || cc.length !== 2) return '🌍';
  const A = 0x1F1E6, base = 'A'.charCodeAt(0);
  return String.fromCodePoint(...cc.toUpperCase().split('').map((c) => A + (c.charCodeAt(0) - base)));
}

type Totals = { streams: number; listeners: number; saves: number; shares: number; skips: number };
type SongMeta = { id: string; title: string; cover_url: string | null };

export default function SongAnalytics() {
  const { user } = useAuth();
  const { id } = useParams<{ id: string }>();
  const nav = useNavigate();
  const [range, setRange] = useState<Range>('28d');
  const [song, setSong] = useState<SongMeta | null>(null);
  const [totals, setTotals] = useState<Totals | null>(null);
  const [series, setSeries] = useState<Array<{ t: string; streams: number; listeners: number; label: string }>>([]);
  const [cities, setCities] = useState<Array<{ city: string; country_code: string | null; country_name: string | null; count: number }>>([]);
  const [countries, setCountries] = useState<Array<{ country_code: string | null; country_name: string | null; count: number }>>([]);
  const [loading, setLoading] = useState(true);

  const cfg = useMemo(() => RANGES.find(r => r.key === range)!, [range]);

  useEffect(() => {
    if (!id || !user) return;
    let alive = true;
    (async () => {
      setLoading(true);
      const { data: s } = await supabase
        .from('artist_songs')
        .select('id, title, cover_url, artist_user_id')
        .eq('id', id)
        .maybeSingle();
      if (!alive) return;
      if (!s || s.artist_user_id !== user.id) { setSong(null); setLoading(false); return; }
      setSong({ id: s.id, title: s.title, cover_url: s.cover_url });

      const now = new Date();
      const since = cfg.days == null ? new Date('2020-01-01T00:00:00Z') : new Date(now.getTime() - cfg.days * 86400000);
      const { data, error } = await supabase.rpc('get_song_analytics', {
        _song_id: id,
        _since: since.toISOString(),
        _until: now.toISOString(),
        _bucket: cfg.bucket,
      });
      if (!alive) return;
      if (error) { console.error(error); setLoading(false); return; }
      const d = data as {
        totals: Totals;
        series: Array<{ t: string; streams: number; listeners: number }>;
        top_cities: typeof cities;
        top_countries: typeof countries;
      };
      setTotals(d?.totals ?? null);
      setSeries((d?.series ?? []).map(p => {
        const dt = new Date(p.t);
        const label = cfg.bucket === 'hour'
          ? `${dt.getHours().toString().padStart(2, '0')}:00`
          : cfg.bucket === 'month'
            ? dt.toLocaleString(undefined, { month: 'short' })
            : `${dt.getMonth() + 1}/${dt.getDate()}`;
        return { ...p, label };
      }));
      setCities(d?.top_cities ?? []);
      setCountries(d?.top_countries ?? []);
      setLoading(false);
    })();
    return () => { alive = false; };
  }, [id, user, cfg]);

  if (loading && !song) {
    return <div className="h-[70vh] grid place-items-center"><Loader2 className="w-5 h-5 animate-spin text-muted-foreground" /></div>;
  }
  if (!song) {
    return (
      <div className="max-w-3xl mx-auto px-5 pt-8 text-center">
        <p className="text-[14px] text-muted-foreground">Song not found or not owned by you.</p>
        <Link to="/artist/studio/analytics" className="mt-4 inline-block text-primary text-[13px] font-semibold">Back to analytics</Link>
      </div>
    );
  }

  return (
    <div className="max-w-3xl mx-auto px-5 pt-4 pb-16">
      {/* Header */}
      <button
        onClick={() => nav(-1)}
        className="inline-flex items-center gap-1.5 text-[12px] text-muted-foreground hover:text-white transition"
      >
        <ArrowLeft className="w-4 h-4" /> Back
      </button>

      <div className="mt-4 flex items-center gap-4">
        <div className="w-16 h-16 rounded-xl overflow-hidden bg-black/40 ring-1 ring-white/10 shrink-0">
          {song.cover_url
            ? <img src={song.cover_url} alt="" className="w-full h-full object-cover" />
            : <div className="w-full h-full grid place-items-center"><Music2 className="w-6 h-6 text-muted-foreground" /></div>}
        </div>
        <div className="min-w-0">
          <p className="text-[10px] uppercase tracking-[0.22em] text-muted-foreground/80 font-semibold">Song insights</p>
          <h2 className="font-display text-[22px] leading-tight tracking-tight truncate">{song.title}</h2>
        </div>
      </div>

      {/* Range */}
      <div className="mt-5 flex items-center gap-1.5 overflow-x-auto -mx-1 px-1 scrollbar-none">
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

      {/* KPIs */}
      <section className="grid grid-cols-2 gap-3 mt-4">
        <Kpi label="Streams" value={fmt(totals?.streams ?? 0)} icon={<Play className="w-3.5 h-3.5" />} accent />
        <Kpi label="Listeners" value={fmt(totals?.listeners ?? 0)} icon={<Users className="w-3.5 h-3.5" />} />
        <Kpi label="Saves" value={fmt(totals?.saves ?? 0)} icon={<Bookmark className="w-3.5 h-3.5" />} />
        <Kpi label="Shares" value={fmt(totals?.shares ?? 0)} icon={<Share2 className="w-3.5 h-3.5" />} />
        <Kpi label="Skips" value={fmt(totals?.skips ?? 0)} icon={<SkipForward className="w-3.5 h-3.5" />} />
        <Kpi
          label="Skip rate"
          value={
            (totals?.streams ?? 0) > 0
              ? `${Math.round(((totals!.skips || 0) / totals!.streams) * 100)}%`
              : '—'
          }
          icon={<SkipForward className="w-3.5 h-3.5" />}
        />
      </section>

      {/* Chart */}
      <BentoCard className="mt-4 p-5">
        <p className="text-[10.5px] uppercase tracking-[0.22em] text-muted-foreground/80 font-semibold">Streams over time</p>
        <div className="h-[220px] mt-3">
          {loading ? (
            <div className="h-full grid place-items-center text-muted-foreground"><Loader2 className="w-4 h-4 animate-spin" /></div>
          ) : !series.length || series.every(p => p.streams === 0) ? (
            <div className="h-full grid place-items-center text-[12.5px] text-muted-foreground">No streams in this window yet.</div>
          ) : (
            <ResponsiveContainer width="100%" height="100%">
              <AreaChart data={series} margin={{ top: 6, right: 6, bottom: 0, left: -18 }}>
                <defs>
                  <linearGradient id="gSong" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stopColor="#FF2D55" stopOpacity={0.35} />
                    <stop offset="100%" stopColor="#FF2D55" stopOpacity={0} />
                  </linearGradient>
                </defs>
                <CartesianGrid stroke="rgba(255,255,255,0.05)" vertical={false} />
                <XAxis dataKey="label" tick={{ fill: 'rgba(255,255,255,0.45)', fontSize: 10 }} axisLine={false} tickLine={false} interval="preserveStartEnd" />
                <YAxis tick={{ fill: 'rgba(255,255,255,0.45)', fontSize: 10 }} axisLine={false} tickLine={false} allowDecimals={false} width={28} />
                <Tooltip contentStyle={{ background: 'rgba(10,10,12,0.95)', border: '1px solid rgba(255,255,255,0.08)', borderRadius: 12, fontSize: 12 }} />
                <Area type="monotone" dataKey="streams" stroke="#FF2D55" strokeWidth={2.25} fill="url(#gSong)" name="Streams" />
                <Line type="monotone" dataKey="listeners" stroke="rgba(255,255,255,0.55)" strokeWidth={1.5} dot={false} name="Listeners" />
              </AreaChart>
            </ResponsiveContainer>
          )}
        </div>
      </BentoCard>

      {/* Top cities */}
      <BentoCard className="mt-5 p-5">
        <div className="flex items-center gap-2 mb-3"><MapPin className="w-4 h-4 text-muted-foreground" /><p className="text-[13px] font-semibold tracking-tight">Top cities</p></div>
        {!cities.length ? <p className="text-[12.5px] text-muted-foreground py-6 text-center">No city data yet.</p> : (
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
                      <div className="h-full rounded-full" style={{ width: `${pct}%`, background: 'linear-gradient(90deg, #FF2D55, #FF8A9E)' }} />
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
        <div className="flex items-center gap-2 mb-3"><Globe2 className="w-4 h-4 text-muted-foreground" /><p className="text-[13px] font-semibold tracking-tight">Top countries</p></div>
        {!countries.length ? <p className="text-[12.5px] text-muted-foreground py-6 text-center">No country data yet.</p> : (
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
                      <div className="h-full rounded-full" style={{ width: `${pct}%`, background: 'linear-gradient(90deg, #FF2D55, #FF8A9E)' }} />
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </BentoCard>
    </div>
  );
}

function Kpi({ label, value, icon, accent }: { label: string; value: string; icon: React.ReactNode; accent?: boolean }) {
  return (
    <BentoCard glow={accent} className="p-4">
      <div className="flex items-center gap-1.5 text-[10px] uppercase tracking-[0.18em] text-muted-foreground/80 font-semibold">
        {icon}{label}
      </div>
      <p className="mt-2 font-display text-[24px] tabular-nums leading-none">{value}</p>
    </BentoCard>
  );
}
