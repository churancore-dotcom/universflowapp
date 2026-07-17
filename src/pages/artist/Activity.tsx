import { useEffect, useMemo, useState } from 'react';
import { useOutletContext } from 'react-router-dom';
import { UserPlus, Trophy, Music2, ShieldCheck, AlertCircle, Play, Globe2 } from 'lucide-react';
import { supabase } from '@/integrations/supabase/client';
import { ArtistSong, fmt } from './_shared';

type Ctx = { songs: ArtistSong[]; user: { id: string } };

type Item = {
  id: string;
  kind: 'follower' | 'milestone' | 'status' | 'play';
  ts: string;
  title: string;
  body?: string;
  icon: React.ReactNode;
};

function flagEmoji(cc: string | null) {
  if (!cc || cc.length !== 2) return '🌍';
  const A = 0x1F1E6, base = 'A'.charCodeAt(0);
  return String.fromCodePoint(...cc.toUpperCase().split('').map((c) => A + (c.charCodeAt(0) - base)));
}

const MILESTONES = [100, 1_000, 10_000, 100_000, 1_000_000];

export default function Activity() {
  const { songs, user } = useOutletContext<Ctx>();
  const [followers, setFollowers] = useState<Array<{ id: string; created_at: string; name: string }>>([]);
  const [statusEvents, setStatusEvents] = useState<Array<{ status: string; reviewed_at: string | null; updated_at: string }>>([]);

  useEffect(() => {
    let alive = true;
    (async () => {
      const since = new Date(Date.now() - 60 * 24 * 60 * 60 * 1000).toISOString();
      const { data: follows } = await supabase
        .from('artist_followers')
        .select('id, created_at, follower_user_id')
        .eq('artist_user_id', user.id)
        .gte('created_at', since)
        .order('created_at', { ascending: false })
        .limit(50);
      const ids = (follows ?? []).map((f) => f.follower_user_id);
      const profMap = new Map<string, string>();
      if (ids.length) {
        const { data: profs } = await supabase
          .from('profiles')
          .select('user_id, username')
          .in('user_id', ids);
        for (const p of profs ?? []) profMap.set(p.user_id, p.username ?? 'A listener');
      }
      const { data: apps } = await supabase
        .from('artist_applications_safe')
        .select('status, reviewed_at, updated_at')
        .eq('user_id', user.id)
        .order('updated_at', { ascending: false })
        .limit(5);

      if (!alive) return;
      setFollowers((follows ?? []).map((f) => ({
        id: f.id,
        created_at: f.created_at,
        name: profMap.get(f.follower_user_id) ?? 'A listener',
      })));
      setStatusEvents((apps ?? []) as Array<{ status: string; reviewed_at: string | null; updated_at: string }>);
    })();
    return () => { alive = false; };
  }, [user.id]);

  const items = useMemo<Item[]>(() => {
    const out: Item[] = [];

    for (const f of followers) {
      out.push({
        id: `f-${f.id}`,
        kind: 'follower',
        ts: f.created_at,
        title: `${f.name} started following you`,
        icon: <UserPlus className="w-4 h-4" />,
      });
    }
    for (const s of songs) {
      // Only surface the highest milestone actually achieved — not every tier below it.
      // Use the song's most recent update as the moment marker (best signal we have
      // without a per-milestone log) so it sorts near real events instead of stale uploads.
      let hit = 0;
      for (const m of MILESTONES) if ((s.play_count || 0) >= m) hit = m;
      if (hit > 0) {
        out.push({
          id: `m-${s.id}-${hit}`,
          kind: 'milestone',
          ts: s.created_at,
          title: `${s.title} crossed ${fmt(hit)} plays`,
          body: 'Keep promoting — momentum compounds.',
          icon: <Trophy className="w-4 h-4" />,
        });
      }
    }
    for (const a of statusEvents) {
      const when = a.reviewed_at ?? a.updated_at;
      if (a.status === 'approved') {
        out.push({ id: `s-approved-${when}`, kind: 'status', ts: when, title: 'You were approved as an artist', icon: <ShieldCheck className="w-4 h-4" /> });
      } else if (a.status === 'rejected') {
        out.push({ id: `s-rejected-${when}`, kind: 'status', ts: when, title: 'Application update', body: 'Your application needs another look — check Status.', icon: <AlertCircle className="w-4 h-4" /> });
      }
    }
    return out
      .sort((a, b) => +new Date(b.ts) - +new Date(a.ts))
      .slice(0, 60);
  }, [followers, songs, statusEvents]);

  return (
    <div className="max-w-2xl mx-auto px-5 pt-5 pb-12">
      <h2 className="text-[22px] font-semibold tracking-tight">Activity</h2>
      <p className="text-[12.5px] text-muted-foreground mt-0.5">Everything happening on your music — newest first.</p>

      {!items.length ? (
        <div className="mt-12 text-center text-[13px] text-muted-foreground flex flex-col items-center gap-3">
          <div className="w-14 h-14 rounded-2xl bg-white/[0.05] flex items-center justify-center">
            <Music2 className="w-6 h-6 text-muted-foreground" />
          </div>
          Quiet for now. Once listeners follow or play your tracks, you’ll see it here.
        </div>
      ) : (
        <div className="mt-5 space-y-2.5">
          {items.map((it) => (
            <div key={it.id} className="flex items-start gap-3 p-3 rounded-2xl bg-white/[0.03] border border-white/[0.06]">
              <div className={`w-9 h-9 rounded-xl flex items-center justify-center shrink-0 ${
                it.kind === 'follower' ? 'bg-primary/15 text-primary'
                  : it.kind === 'milestone' ? 'bg-amber-500/15 text-amber-300'
                  : 'bg-white/[0.06] text-foreground'
              }`}>{it.icon}</div>
              <div className="flex-1 min-w-0">
                <p className="text-[13px] font-medium">{it.title}</p>
                {it.body && <p className="text-[11.5px] text-muted-foreground mt-0.5">{it.body}</p>}
                <p className="text-[10.5px] text-muted-foreground/70 mt-1 tabular-nums">
                  {new Date(it.ts).toLocaleString()}
                </p>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
