import { useEffect, useState } from 'react';
import { Users, Radio } from 'lucide-react';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/contexts/AuthContext';
import { resolveAvatar, isPresetAvatar } from '@/lib/avatars';
import VideoAvatar from '@/components/VideoAvatar';

interface Row {
  user_id: string;
  username: string | null;
  avatar_url: string | null;
  title: string | null;
  artist: string | null;
  played_at: string;
}

interface Props {
  onFindFriends: () => void;
}

const timeAgo = (iso: string) => {
  const diff = (Date.now() - new Date(iso).getTime()) / 1000;
  if (diff < 60) return 'now';
  if (diff < 3600) return `${Math.floor(diff / 60)}m`;
  if (diff < 86400) return `${Math.floor(diff / 3600)}h`;
  return `${Math.floor(diff / 86400)}d`;
};

const FriendActivityCard = ({ onFindFriends }: Props) => {
  const { user } = useAuth();
  const [rows, setRows] = useState<Row[] | null>(null);

  useEffect(() => {
    if (!user) return;
    let cancelled = false;
    (async () => {
      const { data: rels } = await supabase
        .from('friends')
        .select('user_id, friend_id, status')
        .eq('status', 'accepted')
        .or(`user_id.eq.${user.id},friend_id.eq.${user.id}`);
      const friendIds = (rels || []).map((r) => (r.user_id === user.id ? r.friend_id : r.user_id));
      if (friendIds.length === 0) { if (!cancelled) setRows([]); return; }

      const [{ data: plays }, { data: profs }] = await Promise.all([
        supabase
          .from('song_play_events')
          .select('user_id, title, artist, created_at')
          .in('user_id', friendIds)
          .order('created_at', { ascending: false })
          .limit(20),
        supabase
          .from('profiles')
          .select('user_id, username, avatar_url')
          .in('user_id', friendIds),
      ]);
      const profMap = new Map((profs || []).map((p) => [p.user_id, p]));
      // Dedupe by friend user id — one latest track per friend, cap at 3
      const seen = new Set<string>();
      const out: Row[] = [];
      for (const p of (plays || [])) {
        if (seen.has(p.user_id)) continue;
        seen.add(p.user_id);
        const prof = profMap.get(p.user_id);
        if (!prof || !p.title) continue;
        out.push({
          user_id: p.user_id,
          username: prof.username,
          avatar_url: prof.avatar_url,
          title: p.title,
          artist: p.artist,
          played_at: p.created_at,
        });
        if (out.length >= 3) break;
      }
      if (!cancelled) setRows(out);
    })();
    return () => { cancelled = true; };
  }, [user]);

  if (!user || rows === null) return null;

  return (
    <div
      className="relative rounded-[24px] p-4 overflow-hidden"
      style={{
        background: 'linear-gradient(120deg, hsl(0 0% 10%), hsl(0 0% 7%))',
        border: '1px solid hsl(0 0% 100% / 0.06)',
      }}
    >
      <div className="flex items-center justify-between mb-3">
        <p className="text-[9px] font-black uppercase tracking-[0.24em] text-primary/80 inline-flex items-center gap-1.5">
          <Users className="w-2.5 h-2.5" /> Friend Activity
        </p>
      </div>

      {rows.length === 0 ? (
        <div className="flex items-center justify-between gap-3">
          <div>
            <p className="font-display text-lg leading-tight">No friends yet</p>
            <p className="text-xs text-white/50 mt-0.5">Follow people to see what they're spinning.</p>
          </div>
          <button
            onClick={onFindFriends}
            className="px-3.5 py-2 rounded-full bg-primary/20 text-primary text-[11px] font-bold shrink-0 active:scale-95"
          >
            Find Friends
          </button>
        </div>
      ) : (
        <div className="space-y-2.5">
          {rows.map((r) => (
            <div key={r.user_id + r.played_at} className="flex items-center gap-3">
              <div className="w-9 h-9 rounded-full overflow-hidden bg-white/10 shrink-0 flex items-center justify-center">
                {isPresetAvatar(r.avatar_url) ? (
                  <VideoAvatar variant={r.avatar_url} size={36} />
                ) : resolveAvatar(r.avatar_url) ? (
                  <img src={resolveAvatar(r.avatar_url)!} alt="" className="w-full h-full object-cover" />
                ) : (
                  <span className="text-xs font-bold text-white/70">{(r.username || '?').slice(0, 1).toUpperCase()}</span>
                )}
              </div>
              <div className="flex-1 min-w-0">
                <p className="text-[11px] text-white/50 truncate">
                  <span className="text-white/80 font-semibold">{r.username || 'friend'}</span> · {timeAgo(r.played_at)}
                </p>
                <p className="text-sm truncate inline-flex items-center gap-1.5">
                  <Radio className="w-3 h-3 text-primary shrink-0" />
                  <span className="truncate">{r.title}{r.artist ? ` — ${r.artist}` : ''}</span>
                </p>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
};

export default FriendActivityCard;
