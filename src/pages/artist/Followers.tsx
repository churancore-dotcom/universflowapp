import { useEffect, useState } from 'react';
import { useOutletContext } from '@/lib/router-compat';
import { Users } from 'lucide-react';
import { supabase } from '@/integrations/supabase/client';
import { fmt } from './_shared';

type Ctx = { user: { id: string }; followers: number };

type Follower = {
  user_id: string;
  created_at: string;
  username: string | null;
  avatar_url: string | null;
};

export default function ArtistFollowers() {
  const { user, followers } = useOutletContext<Ctx>();
  const [rows, setRows] = useState<Follower[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let alive = true;
    (async () => {
      const { data: follows } = await supabase
        .from('artist_followers')
        .select("follower_user_id, created_at")
        .eq('artist_user_id', user.id)
        .order('created_at', { ascending: false })
        .limit(200);
      if (!alive) return;
      const ids = (follows ?? []).map((f) => f.follower_user_id);
      const profilesMap: Record<string, { username: string | null; avatar_url: string | null }> = {};
      if (ids.length) {
        const { data: profs } = await supabase
          .from('profiles')
          .select('user_id, username, avatar_url')
          .in('user_id', ids);
        for (const p of profs ?? []) {
          profilesMap[p.user_id] = { username: p.username, avatar_url: p.avatar_url };
        }
      }
      setRows(
        (follows ?? []).map((f) => ({
          user_id: f.follower_user_id,
          created_at: f.created_at,
          username: profilesMap[f.follower_user_id]?.username ?? null,
          avatar_url: profilesMap[f.follower_user_id]?.avatar_url ?? null,
        })),
      );
      setLoading(false);
    })();
    return () => { alive = false; };
  }, [user.id]);

  return (
    <div className="max-w-2xl mx-auto px-5 pt-5">
      <div className="flex items-center gap-3">
        <div>
          <h2 className="text-[20px] font-semibold tracking-tight">Followers</h2>
          <p className="text-[12.5px] text-muted-foreground mt-0.5 tabular-nums">{fmt(followers)} total</p>
        </div>
      </div>

      {loading ? (
        <div className="mt-10 text-center text-[13px] text-muted-foreground">Loading…</div>
      ) : !rows.length ? (
        <div className="mt-10 text-center text-[13px] text-muted-foreground flex flex-col items-center gap-3">
          <div className="w-14 h-14 rounded-2xl bg-white/[0.05] flex items-center justify-center">
            <Users className="w-6 h-6 text-muted-foreground" />
          </div>
          No followers yet. Share your public page to grow your audience.
        </div>
      ) : (
        <div className="mt-5 space-y-2">
          {rows.map((r) => (
            <div key={r.user_id} className="flex items-center gap-3 p-3 rounded-2xl bg-white/[0.03] border border-white/[0.06]">
              <div className="w-10 h-10 rounded-full overflow-hidden bg-black/40 shrink-0">
                {r.avatar_url
                  ? <img src={r.avatar_url} alt="" className="w-full h-full object-cover" />
                  : <div className="w-full h-full flex items-center justify-center text-muted-foreground text-[12px] uppercase">
                      {(r.username ?? 'u').slice(0, 1)}
                    </div>}
              </div>
              <div className="flex-1 min-w-0">
                <p className="text-[13.5px] font-medium truncate">{r.username ?? 'Listener'}</p>
                <p className="text-[11.5px] text-muted-foreground">
                  Followed {new Date(r.created_at).toLocaleDateString()}
                </p>
              </div>
            </div>
          ))}
          {followers > rows.length && (
            <p className="text-center text-[11.5px] text-muted-foreground pt-2">
              Showing newest {rows.length} of {fmt(followers)}.
            </p>
          )}
        </div>
      )}
    </div>
  );
}
