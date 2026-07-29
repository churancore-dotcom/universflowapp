import { useEffect, useMemo, useState } from 'react';
import { useOutletContext } from '@/lib/router-compat';
import { Bell, UserPlus, Trophy, ShieldCheck, AlertCircle, Check } from 'lucide-react';
import { supabase } from '@/integrations/supabase/client';
import { ArtistSong, fmt } from './_shared';

type Ctx = { songs: ArtistSong[]; user: { id: string } };

type Note = {
  id: string;
  kind: 'follower' | 'milestone' | 'status';
  ts: string;
  title: string;
  body?: string;
};

const MILESTONES = [100, 1_000, 10_000, 100_000, 1_000_000];
const READ_KEY = 'uf_artist_notifs_read_at';

export default function Notifications() {
  const { songs, user } = useOutletContext<Ctx>();
  const [follows, setFollows] = useState<Array<{ id: string; created_at: string; name: string }>>([]);
  const [statusEvents, setStatusEvents] = useState<Array<{ status: string; reviewed_at: string | null; updated_at: string }>>([]);
  const [readAt, setReadAt] = useState<number>(() => +(localStorage.getItem(READ_KEY) ?? '0'));

  useEffect(() => {
    let alive = true;
    (async () => {
      const since = new Date(Date.now() - 90 * 24 * 60 * 60 * 1000).toISOString();
      const { data: follow } = await supabase
        .from('artist_followers')
        .select('id, created_at, follower_user_id')
        .eq('artist_user_id', user.id)
        .gte('created_at', since)
        .order('created_at', { ascending: false })
        .limit(100);
      const ids = (follow ?? []).map((f) => f.follower_user_id);
      const map = new Map<string, string>();
      if (ids.length) {
        const { data: profs } = await supabase
          .from('profiles').select('user_id, username').in('user_id', ids);
        for (const p of profs ?? []) map.set(p.user_id, p.username ?? 'A listener');
      }
      const { data: apps } = await supabase
        .from('artist_applications_safe')
        .select('status, reviewed_at, updated_at')
        .eq('user_id', user.id)
        .order('updated_at', { ascending: false }).limit(5);
      if (!alive) return;
      setFollows((follow ?? []).map((f) => ({
        id: f.id,
        created_at: f.created_at,
        name: map.get(f.follower_user_id) ?? 'A listener',
      })));
      setStatusEvents((apps ?? []) as Array<{ status: string; reviewed_at: string | null; updated_at: string }>);
    })();
    return () => { alive = false; };
  }, [user.id]);

  const notes = useMemo<Note[]>(() => {
    const out: Note[] = [];
    for (const f of follows) out.push({ id: `f-${f.id}`, kind: 'follower', ts: f.created_at, title: `${f.name} followed you` });
    for (const s of songs) {
      let hit = 0;
      for (const m of MILESTONES) if ((s.play_count || 0) >= m) hit = m;
      if (hit > 0) out.push({
        id: `m-${s.id}-${hit}`, kind: 'milestone', ts: s.created_at,
        title: `${s.title} hit ${fmt(hit)} plays`,
      });
    }
    for (const a of statusEvents) {
      const when = a.reviewed_at ?? a.updated_at;
      if (a.status === 'approved') out.push({ id: `s-a-${when}`, kind: 'status', ts: when, title: 'You were approved as an artist' });
      else if (a.status === 'rejected') out.push({ id: `s-r-${when}`, kind: 'status', ts: when, title: 'Your application needs another look' });
    }
    return out.sort((a, b) => +new Date(b.ts) - +new Date(a.ts)).slice(0, 60);
  }, [follows, songs, statusEvents]);

  const unread = notes.filter((n) => +new Date(n.ts) > readAt).length;

  const markAllRead = () => {
    const now = Date.now();
    localStorage.setItem(READ_KEY, String(now));
    setReadAt(now);
  };

  const iconFor = (k: Note['kind']) =>
    k === 'follower' ? <UserPlus className="w-4 h-4" /> :
    k === 'milestone' ? <Trophy className="w-4 h-4" /> :
    <ShieldCheck className="w-4 h-4" />;

  return (
    <div className="max-w-2xl mx-auto px-5 pt-5 pb-12">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-[22px] font-semibold tracking-tight">Notifications</h2>
          <p className="text-[12.5px] text-muted-foreground mt-0.5 tabular-nums">
            {unread ? `${unread} new` : 'You’re all caught up'}
          </p>
        </div>
        {unread > 0 && (
          <button
            onClick={markAllRead}
            className="inline-flex items-center gap-1.5 px-3 h-8 rounded-full text-[11.5px] font-semibold bg-white/[0.06] active:scale-95"
          >
            <Check className="w-3.5 h-3.5" /> Mark all read
          </button>
        )}
      </div>

      {!notes.length ? (
        <div className="mt-12 text-center text-[13px] text-muted-foreground flex flex-col items-center gap-3">
          <div className="w-14 h-14 rounded-2xl bg-white/[0.05] flex items-center justify-center">
            <Bell className="w-6 h-6 text-muted-foreground" />
          </div>
          No notifications yet.
        </div>
      ) : (
        <div className="mt-5 space-y-2.5">
          {notes.map((n) => {
            const isUnread = +new Date(n.ts) > readAt;
            return (
              <div
                key={n.id}
                className={`flex items-start gap-3 p-3 rounded-2xl border ${
                  isUnread ? 'bg-primary/[0.06] border-primary/20' : 'bg-white/[0.03] border-white/[0.06]'
                }`}
              >
                <div className="w-9 h-9 rounded-xl bg-white/[0.06] flex items-center justify-center text-foreground shrink-0">
                  {iconFor(n.kind)}
                </div>
                <div className="flex-1 min-w-0">
                  <p className="text-[13px] font-medium">{n.title}</p>
                  <p className="text-[10.5px] text-muted-foreground/70 mt-1 tabular-nums">
                    {new Date(n.ts).toLocaleString()}
                  </p>
                </div>
                {isUnread && <span className="w-2 h-2 rounded-full bg-primary mt-2" />}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
