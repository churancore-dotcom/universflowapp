import { useEffect, useMemo, useState } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import { X, Search as SearchIcon, UserPlus, Check, Clock } from 'lucide-react';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/contexts/AuthContext';
import { resolveAvatar, isPresetAvatar } from '@/lib/avatars';
import VideoAvatar from '@/components/VideoAvatar';
import { toast } from 'sonner';

type Mode = 'followers' | 'following' | 'search';

interface Props {
  isOpen: boolean;
  onClose: () => void;
  mode: Mode;
  title?: string;
}

interface ProfileRow {
  user_id: string;
  username: string | null;
  avatar_url: string | null;
}

const FriendsSheet = ({ isOpen, onClose, mode, title }: Props) => {
  const { user } = useAuth();
  const [rows, setRows] = useState<ProfileRow[]>([]);
  const [loading, setLoading] = useState(false);
  const [query, setQuery] = useState('');
  const [pendingIds, setPendingIds] = useState<Set<string>>(new Set());
  const [acceptedIds, setAcceptedIds] = useState<Set<string>>(new Set());

  useEffect(() => {
    if (!isOpen || !user) return;
    let cancelled = false;
    const load = async () => {
      setLoading(true);
      try {
        // Prime relationship maps for badge state
        const { data: rel } = await supabase
          .from('friends')
          .select('user_id, friend_id, status')
          .or(`user_id.eq.${user.id},friend_id.eq.${user.id}`);
        const pending = new Set<string>();
        const accepted = new Set<string>();
        (rel || []).forEach((r) => {
          const other = r.user_id === user.id ? r.friend_id : r.user_id;
          if (r.status === 'accepted') accepted.add(other);
          else if (r.status === 'pending') pending.add(other);
        });
        if (cancelled) return;
        setPendingIds(pending);
        setAcceptedIds(accepted);

        let ids: string[] = [];
        if (mode === 'followers') {
          const { data } = await supabase
            .from('artist_followers')
            .select('follower_user_id')
            .eq('artist_user_id', user.id);
          ids = (data || []).map((r) => r.follower_user_id);
        } else if (mode === 'following') {
          ids = Array.from(accepted);
        } else {
          setRows([]);
          return;
        }
        if (ids.length === 0) { setRows([]); return; }
        const { data: profs } = await supabase
          .from('profiles')
          .select('user_id, username, avatar_url')
          .in('user_id', ids)
          .limit(200);
        if (!cancelled) setRows(profs || []);
      } finally {
        if (!cancelled) setLoading(false);
      }
    };
    load();
    return () => { cancelled = true; };
  }, [isOpen, mode, user]);

  // Live search for the search mode
  useEffect(() => {
    if (!isOpen || mode !== 'search' || !user) return;
    const q = query.trim();
    if (q.length < 2) { setRows([]); return; }
    let cancelled = false;
    const t = setTimeout(async () => {
      const { data } = await supabase
        .from('profiles')
        .select('user_id, username, avatar_url')
        .ilike('username', `%${q}%`)
        .neq('user_id', user.id)
        .limit(30);
      if (!cancelled) setRows(data || []);
    }, 250);
    return () => { cancelled = true; clearTimeout(t); };
  }, [query, mode, isOpen, user]);

  const filtered = useMemo(() => {
    if (mode === 'search') return rows;
    const q = query.trim().toLowerCase();
    if (!q) return rows;
    return rows.filter((r) => (r.username || '').toLowerCase().includes(q));
  }, [rows, query, mode]);

  const sendRequest = async (targetId: string) => {
    if (!user) return;
    const { error } = await supabase.from('friends').insert({ user_id: user.id, friend_id: targetId, status: 'pending' });
    if (error) { toast.error(error.message); return; }
    setPendingIds((p) => new Set(p).add(targetId));
    toast.success('Request sent');
  };

  const label = title ?? (mode === 'followers' ? 'Followers' : mode === 'following' ? 'Friends' : 'Find Friends');

  return (
    <AnimatePresence>
      {isOpen && (
        <>
          <motion.div
            initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
            onClick={onClose}
            className="fixed inset-0 z-[80] bg-black/70 backdrop-blur-md"
          />
          <motion.div
            initial={{ y: '100%' }} animate={{ y: 0 }} exit={{ y: '100%' }}
            transition={{ type: 'spring', damping: 30, stiffness: 300 }}
            className="fixed left-0 right-0 bottom-0 z-[81] rounded-t-[28px] bg-card/95 backdrop-blur-xl border-t border-white/10 max-h-[85dvh] flex flex-col"
          >
            <div className="flex items-center justify-between px-5 pt-4 pb-2">
              <div className="w-10 h-1 rounded-full bg-white/15 mx-auto absolute left-1/2 -translate-x-1/2 top-2" />
              <h2 className="font-display text-2xl tracking-tight">{label}</h2>
              <button onClick={onClose} aria-label="Close" className="w-9 h-9 rounded-full bg-white/10 flex items-center justify-center active:scale-90">
                <X className="w-4 h-4" />
              </button>
            </div>
            <div className="px-5 pb-3">
              <div className="flex items-center gap-2 rounded-2xl bg-white/[0.06] border border-white/10 px-3 py-2.5">
                <SearchIcon className="w-4 h-4 text-white/40" />
                <input
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                  placeholder={mode === 'search' ? 'Search by username…' : 'Filter list…'}
                  className="flex-1 bg-transparent outline-none text-sm placeholder:text-white/30"
                />
              </div>
            </div>
            <div className="flex-1 overflow-y-auto px-3 pb-8" style={{ WebkitOverflowScrolling: 'touch' }}>
              {loading && <p className="text-center text-white/40 text-sm py-8">Loading…</p>}
              {!loading && filtered.length === 0 && (
                <p className="text-center text-white/40 text-sm py-10">
                  {mode === 'search' && query.trim().length < 2 ? 'Type at least 2 characters' : 'Nobody here yet'}
                </p>
              )}
              {filtered.map((p) => {
                const isFriend = acceptedIds.has(p.user_id);
                const isPending = pendingIds.has(p.user_id);
                return (
                  <div key={p.user_id} className="flex items-center gap-3 px-2 py-2.5 rounded-2xl active:bg-white/[0.05]">
                    <div className="w-11 h-11 rounded-full overflow-hidden bg-white/10 shrink-0 flex items-center justify-center">
                      {isPresetAvatar(p.avatar_url) ? (
                        <VideoAvatar variant={p.avatar_url} size={44} />
                      ) : resolveAvatar(p.avatar_url) ? (
                        <img src={resolveAvatar(p.avatar_url)!} alt="" className="w-full h-full object-cover" />
                      ) : (
                        <span className="text-sm font-bold text-white/70">{(p.username || '?').slice(0, 1).toUpperCase()}</span>
                      )}
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-semibold truncate">{p.username || 'anon'}</p>
                    </div>
                    {mode === 'search' && (
                      isFriend ? (
                        <span className="text-[10px] font-black uppercase tracking-wider text-white/40 inline-flex items-center gap-1"><Check className="w-3 h-3" />Friends</span>
                      ) : isPending ? (
                        <span className="text-[10px] font-black uppercase tracking-wider text-white/40 inline-flex items-center gap-1"><Clock className="w-3 h-3" />Sent</span>
                      ) : (
                        <button
                          onClick={() => sendRequest(p.user_id)}
                          className="px-3 py-1.5 rounded-full bg-primary/20 text-primary text-[11px] font-bold inline-flex items-center gap-1 active:scale-95"
                        >
                          <UserPlus className="w-3 h-3" /> Add
                        </button>
                      )
                    )}
                  </div>
                );
              })}
            </div>
          </motion.div>
        </>
      )}
    </AnimatePresence>
  );
};

export default FriendsSheet;
