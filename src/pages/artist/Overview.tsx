import { useEffect, useMemo, useState } from 'react';
import { useOutletContext, Link } from 'react-router-dom';
import { motion } from 'framer-motion';
import { ResponsiveContainer, AreaChart, Area, XAxis, YAxis, Tooltip } from 'recharts';
import {
  Music2, Heart, Eye, Users, TrendingUp, TrendingDown, Upload, BarChart3,
  UserCog, Bell, ExternalLink, Headphones, ArrowUpRight, Globe2,
  Play, BadgeCheck, Share2,
} from 'lucide-react';
import { supabase } from '@/integrations/supabase/client';
import { ArtistProfile, ArtistSong, fmt } from './_shared';
import BentoCard from '@/components/artist/BentoCard';
import ArtistShareCard from '@/components/artist/ArtistShareCard';


type Ctx = { profile: ArtistProfile; songs: ArtistSong[]; followers: number; user: { id: string } };

type PlayRow = { created_at: string; country_code: string | null; country_name: string | null };

function flagEmoji(cc: string | null) {
  if (!cc || cc.length !== 2) return '🌍';
  const A = 0x1F1E6, base = 'A'.charCodeAt(0);
  return String.fromCodePoint(...cc.toUpperCase().split('').map((c) => A + (c.charCodeAt(0) - base)));
}

function greeting() {
  const h = new Date().getHours();
  if (h < 5) return 'Up late';
  if (h < 12) return 'Good morning';
  if (h < 17) return 'Good afternoon';
  if (h < 22) return 'Good evening';
  return 'Good night';
}

export default function Overview() {
  const { profile, songs, followers } = useOutletContext<Ctx>();
  const [recent, setRecent] = useState<PlayRow[]>([]);
  const [prevWindow, setPrevWindow] = useState<PlayRow[]>([]);
  const [shareSong, setShareSong] = useState<ArtistSong | null>(null);
  const [shareOpen, setShareOpen] = useState<false | 'profile' | 'song'>(false);


  const songIds = useMemo(() => songs.map((s) => s.id), [songs]);

  useEffect(() => {
    if (!songIds.length) { setRecent([]); setPrevWindow([]); return; }
    let alive = true;
    (async () => {
      const now = Date.now();
      const since7 = new Date(now - 7 * 86400000).toISOString();
      const since14 = new Date(now - 14 * 86400000).toISOString();
      const [{ data: cur }, { data: prev }] = await Promise.all([
        supabase
          .from('song_play_events')
          .select('created_at, country_code, country_name')
          .in('song_id', songIds)
          .gte('created_at', since7)
          .limit(5000),
        supabase
          .from('song_play_events')
          .select('created_at, country_code, country_name')
          .in('song_id', songIds)
          .gte('created_at', since14)
          .lt('created_at', since7)
          .limit(5000),
      ]);
      if (!alive) return;
      setRecent((cur ?? []) as PlayRow[]);
      setPrevWindow((prev ?? []) as PlayRow[]);
    })();
    return () => { alive = false; };
  }, [songIds.join(',')]);

  const spark = useMemo(() => {
    const buckets = new Map<string, number>();
    for (let i = 6; i >= 0; i--) {
      const d = new Date(Date.now() - i * 86400000);
      buckets.set(`${d.getMonth() + 1}/${d.getDate()}`, 0);
    }
    for (const r of recent) {
      const d = new Date(r.created_at);
      const k = `${d.getMonth() + 1}/${d.getDate()}`;
      buckets.set(k, (buckets.get(k) ?? 0) + 1);
    }
    return Array.from(buckets.entries()).map(([t, v]) => ({ t, v }));
  }, [recent]);

  const stats = useMemo(() => ({
    plays: songs.reduce((a, s) => a + (s.play_count || 0), 0),
    views: songs.reduce((a, s) => a + (s.view_count || 0), 0),
    likes: songs.reduce((a, s) => a + (s.like_count || 0), 0),
  }), [songs]);

  const weekTotal = recent.length;
  const prevTotal = prevWindow.length;
  const delta = prevTotal === 0
    ? (weekTotal === 0 ? 0 : 100)
    : ((weekTotal - prevTotal) / prevTotal) * 100;

  const topCountry = useMemo(() => {
    const m = new Map<string, { name: string; count: number; cc: string | null }>();
    for (const r of recent) {
      const key = r.country_code ?? r.country_name ?? 'unknown';
      if (!m.has(key)) m.set(key, { name: r.country_name ?? 'Worldwide', count: 0, cc: r.country_code });
      m.get(key)!.count += 1;
    }
    return Array.from(m.values()).sort((a, b) => b.count - a.count)[0];
  }, [recent]);

  const top = useMemo(() => {
    if (!songs.length) return null;
    const sorted = [...songs].sort((a, b) =>
      (b.play_count + b.like_count * 2 + b.download_count * 3) -
      (a.play_count + a.like_count * 2 + a.download_count * 3));
    return sorted[0];
  }, [songs]);

  return (
    <div className="max-w-3xl mx-auto px-5 pt-5 pb-12">

      {/* ============ HERO ============ */}
      <motion.section
        initial={{ opacity: 0, y: 10 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.5, ease: [0.22, 1, 0.36, 1] }}
        className="relative rounded-[28px] overflow-hidden"
        style={{
          background: 'linear-gradient(155deg, rgba(255,45,85,0.32) 0%, rgba(120,20,40,0.6) 30%, rgba(10,10,12,0.95) 75%)',
          border: '0.5px solid rgba(255,255,255,0.08)',
          boxShadow: '0 30px 80px rgba(0,0,0,0.55), inset 0 1px 0 rgba(255,255,255,0.08)',
        }}
      >
        {profile.banner_url && (
          <img
            src={profile.banner_url}
            alt=""
            className="absolute inset-0 w-full h-full object-cover opacity-25 mix-blend-luminosity"
          />
        )}
        <span
          aria-hidden
          className="pointer-events-none absolute -top-20 -right-16 w-64 h-64 rounded-full"
          style={{ background: 'radial-gradient(closest-side, rgba(255,90,119,0.55), transparent 70%)' }}
        />
        <div className="relative p-5 pt-6">
          <p className="text-[10px] uppercase tracking-[0.24em] text-white/70 font-semibold">
            {greeting()}
          </p>
          <div className="flex items-center gap-1.5 mt-1">
            <h1 className="font-display text-[30px] leading-[1] tracking-tight text-white truncate">
              {profile.stage_name}
            </h1>
            <BadgeCheck className="w-5 h-5 text-white shrink-0" fill="#FF2D55" />
          </div>

          <div className="mt-4 flex items-center gap-3 text-white/80">
            <Link
              to={`/a/${profile.slug}`}
              className="inline-flex items-center gap-1.5 text-[11.5px] font-medium px-2.5 py-1.5 rounded-full bg-black/40 backdrop-blur-sm border border-white/15 active:scale-95 transition"
            >
              <ExternalLink className="w-3 h-3" /> /a/{profile.slug}
            </Link>
            <span className="text-[11.5px] tabular-nums">
              {fmt(followers)} followers · {fmt(stats.plays)} streams
            </span>
          </div>
        </div>
      </motion.section>

      {/* ============ BENTO GRID ============ */}
      <section className="mt-4 grid grid-cols-6 gap-3 auto-rows-[minmax(0,auto)]">

        {/* Big: 7-day streams */}
        <BentoCard glow className="col-span-6 sm:col-span-4 p-5" delay={0.05}>
          <div className="flex items-start justify-between">
            <div>
              <p className="text-[10px] uppercase tracking-[0.22em] text-muted-foreground/80 font-semibold">
                Last 7 days
              </p>
              <p className="mt-1 font-display text-[34px] leading-none tabular-nums">
                {fmt(weekTotal)}
              </p>
              <p className="mt-1 text-[11.5px] text-muted-foreground">streams across your catalog</p>
            </div>
            <DeltaPill value={delta} />
          </div>
          <div className="h-[100px] mt-3 -mx-2">
            <ResponsiveContainer width="100%" height="100%">
              <AreaChart data={spark} margin={{ top: 6, right: 6, bottom: 0, left: -28 }}>
                <defs>
                  <linearGradient id="ovGrad" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stopColor="#FF2D55" stopOpacity={0.6} />
                    <stop offset="100%" stopColor="#FF2D55" stopOpacity={0} />
                  </linearGradient>
                </defs>
                <XAxis
                  dataKey="t"
                  tick={{ fill: 'rgba(255,255,255,0.4)', fontSize: 9 }}
                  axisLine={false}
                  tickLine={false}
                />
                <YAxis hide />
                <Tooltip
                  cursor={{ stroke: 'rgba(255,255,255,0.1)' }}
                  contentStyle={{
                    background: 'rgba(10,10,12,0.95)',
                    border: '1px solid rgba(255,255,255,0.08)',
                    borderRadius: 12,
                    fontSize: 12,
                  }}
                  labelStyle={{ color: 'rgba(255,255,255,0.6)' }}
                />
                <Area
                  type="monotone"
                  dataKey="v"
                  stroke="#FF2D55"
                  strokeWidth={2}
                  fill="url(#ovGrad)"
                />
              </AreaChart>
            </ResponsiveContainer>
          </div>
        </BentoCard>

        {/* Followers tile (tall on desktop) */}
        <BentoCard className="col-span-3 sm:col-span-2 p-4" delay={0.08}>
          <div className="flex items-center gap-1.5 text-muted-foreground text-[10.5px] uppercase tracking-[0.18em] font-semibold">
            <Users className="w-3.5 h-3.5" /> Followers
          </div>
          <p className="mt-2 font-display text-[28px] tabular-nums leading-none">{fmt(followers)}</p>
          <Link
            to="/artist/studio/followers"
            className="mt-3 inline-flex items-center gap-1 text-[11px] font-medium text-primary"
          >
            Manage <ArrowUpRight className="w-3 h-3" />
          </Link>
        </BentoCard>

        {/* Stream / Likes / Views micro tiles */}
        <MicroStat
          label="Total streams"
          value={fmt(stats.plays)}
          icon={<Headphones className="w-3.5 h-3.5" />}
          delay={0.1}
        />
        <MicroStat
          label="Likes"
          value={fmt(stats.likes)}
          icon={<Heart className="w-3.5 h-3.5" />}
          delay={0.12}
        />
        <MicroStat
          label="Views"
          value={fmt(stats.views)}
          icon={<Eye className="w-3.5 h-3.5" />}
          delay={0.14}
        />

        {/* Top track */}
        {top && (top.play_count > 0 || top.like_count > 0) && (
          <BentoCard className="col-span-6 sm:col-span-4 p-4" delay={0.16}>
            <p className="text-[10.5px] uppercase tracking-[0.2em] text-primary/90 font-semibold flex items-center gap-1.5">
              <TrendingUp className="w-3 h-3" /> Top track this period
            </p>
            <div className="mt-3 flex items-center gap-3">
              <div className="w-16 h-16 rounded-2xl overflow-hidden bg-black/40 shrink-0 ring-1 ring-white/10">
                {top.cover_url
                  ? <img src={top.cover_url} alt="" className="w-full h-full object-cover" />
                  : <div className="w-full h-full grid place-items-center"><Music2 className="w-5 h-5 text-muted-foreground" /></div>}
              </div>
              <div className="flex-1 min-w-0">
                <p className="text-[15px] font-semibold truncate font-display">{top.title}</p>
                <div className="mt-1 flex items-center gap-3 text-[11.5px] text-muted-foreground tabular-nums">
                  <span className="inline-flex items-center gap-1"><Play className="w-3 h-3" />{fmt(top.play_count)}</span>
                  <span className="inline-flex items-center gap-1"><Heart className="w-3 h-3" />{fmt(top.like_count)}</span>
                </div>
              </div>
            </div>
          </BentoCard>
        )}

        {/* Top country (compact) */}
        <BentoCard className="col-span-3 sm:col-span-2 p-4" delay={0.18}>
          <p className="text-[10.5px] uppercase tracking-[0.18em] text-muted-foreground/80 font-semibold flex items-center gap-1.5">
            <Globe2 className="w-3.5 h-3.5" /> Top region
          </p>
          {topCountry ? (
            <>
              <div className="mt-2 flex items-center gap-2">
                <span className="text-[24px] leading-none">{flagEmoji(topCountry.cc)}</span>
                <p className="font-display text-[16px] truncate">{topCountry.name}</p>
              </div>
              <p className="mt-1 text-[11.5px] text-muted-foreground tabular-nums">
                {fmt(topCountry.count)} streams · 7d
              </p>
            </>
          ) : (
            <p className="mt-3 text-[12px] text-muted-foreground/80 leading-snug">
              Geo data appears once plays come in.
            </p>
          )}
        </BentoCard>
      </section>

      {/* ============ QUICK ACTIONS ============ */}
      <section className="grid grid-cols-2 gap-3 mt-4">
        <QuickAction to="/artist/studio/upload" icon={<Upload className="w-4 h-4" />} label="Upload song" accent />
        <QuickAction to="/artist/studio/analytics" icon={<BarChart3 className="w-4 h-4" />} label="Analytics" />
        <QuickAction to="/artist/studio/notifications" icon={<Bell className="w-4 h-4" />} label="Notifications" />
        <QuickAction to="/artist/studio/profile" icon={<UserCog className="w-4 h-4" />} label="Edit profile" />
      </section>
    </div>
  );
}

function MicroStat({
  label, value, icon, delay,
}: { label: string; value: string; icon: React.ReactNode; delay?: number }) {
  return (
    <BentoCard className="col-span-2 p-3.5" delay={delay}>
      <div className="flex items-center gap-1.5 text-muted-foreground text-[10px] uppercase tracking-[0.16em] font-semibold">
        {icon}{label}
      </div>
      <p className="mt-2 font-display text-[20px] tabular-nums leading-none">{value}</p>
    </BentoCard>
  );
}

function DeltaPill({ value }: { value: number }) {
  const up = value >= 0;
  const Icon = up ? TrendingUp : TrendingDown;
  const rounded = Math.abs(value) >= 100 ? Math.round(value) : Math.round(value * 10) / 10;
  return (
    <span
      className="inline-flex items-center gap-1 px-2 py-1 rounded-full text-[10.5px] font-semibold tabular-nums"
      style={{
        background: up ? 'rgba(16,185,129,0.12)' : 'rgba(244,63,94,0.12)',
        color: up ? '#34D399' : '#FB7185',
        border: up ? '1px solid rgba(16,185,129,0.25)' : '1px solid rgba(244,63,94,0.25)',
      }}
    >
      <Icon className="w-3 h-3" />
      {up ? '+' : ''}{rounded}%
    </span>
  );
}

function QuickAction({
  to, icon, label, accent,
}: { to: string; icon: React.ReactNode; label: string; accent?: boolean }) {
  return (
    <Link
      to={to}
      className="rounded-2xl p-4 flex items-center gap-3 transition active:scale-[0.98]"
      style={{
        background: accent
          ? 'linear-gradient(135deg, rgba(255,45,85,0.22), rgba(255,45,85,0.06))'
          : 'rgba(255,255,255,0.03)',
        border: '0.5px solid rgba(255,255,255,0.06)',
        boxShadow: accent
          ? '0 12px 30px -10px rgba(255,45,85,0.45)'
          : '0 6px 20px -8px rgba(0,0,0,0.6)',
      }}
    >
      <div
        className={`w-9 h-9 rounded-xl flex items-center justify-center ${
          accent ? 'bg-white/15 text-white' : 'bg-white/[0.05] text-foreground'
        }`}
      >
        {icon}
      </div>
      <span className="text-[13px] font-medium">{label}</span>
    </Link>
  );
}
