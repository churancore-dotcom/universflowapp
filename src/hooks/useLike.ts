import { useState, useEffect, useCallback, useRef } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/contexts/AuthContext';
import { toast } from 'sonner';
import { isCatalogSongId } from '@/lib/songSupport';
import { persistStreamSong, flushStreamSongsNow, getTrackSource } from '@/lib/streamSongs';
import { invalidateTasteProfile } from '@/lib/feedPersonalizer';
import type { Song } from '@/contexts/PlayerContext';

// ============================================================
// Batch Like Cache — single query loads ALL user likes
// For catalog songs: uses Supabase user_library
// For stream songs: uses localStorage
// ============================================================

let likeCache = new Set<string>();
let likeCacheLoaded = false;
let likeCacheUserId: string | null = null;
let likeCachePromise: Promise<void> | null = null;
let likeCacheGeneration = 0;
let likeRealtimeUserId: string | null = null;
let likeRealtimeChannel: ReturnType<typeof supabase.channel> | null = null;

// Subscribers — every mounted useLike hook registers here so a like toggle on
// one card instantly re-renders every other LikeButton + Library list for the
// same songId, without waiting for a Supabase round-trip or query refetch.
const likeSubscribers = new Set<() => void>();
const notifyLikeSubscribers = () => {
  for (const cb of likeSubscribers) {
    try { cb(); } catch { /* ignore */ }
  }
  // A like is a strong taste signal — the feed should reflect it immediately.
  invalidateTasteProfile();
  // Also let Library / Profile invalidate their react-query cache
  try { window.dispatchEvent(new Event('uf:likes-changed')); } catch { /* ignore */ }
};

const STREAM_LIKES_KEY = 'uf_stream_likes';

// Scoped per account so one person's likes never show for another account on
// the same device. The old unscoped key is ignored (its owner is unknown).
const streamLikesKey = (userId: string) => `${STREAM_LIKES_KEY}:${userId}`;

const getStreamLikes = (userId: string): Set<string> => {
  try {
    const raw = localStorage.getItem(streamLikesKey(userId));
    return raw ? new Set(JSON.parse(raw)) : new Set();
  } catch { return new Set(); }
};

const saveStreamLikes = (userId: string, likes: Set<string>) => {
  try {
    localStorage.setItem(streamLikesKey(userId), JSON.stringify([...likes]));
  } catch { /* ignore */ }
};

export const resetLikeCache = () => {
  likeCacheGeneration++;
  if (likeRealtimeChannel) {
    supabase.removeChannel(likeRealtimeChannel);
    likeRealtimeChannel = null;
    likeRealtimeUserId = null;
  }
  likeCache = new Set();
  likeCacheLoaded = false;
  likeCacheUserId = null;
  likeCachePromise = null;
};

const loadLikeCache = async (userId: string, force = false): Promise<void> => {
  if (likeCacheUserId !== userId) {
    resetLikeCache();
    likeCacheUserId = userId;
  }
  if (!force && likeCacheLoaded && likeCacheUserId === userId) return;
  if (likeCachePromise && likeCacheUserId === userId) {
    if (!force) return likeCachePromise;
    // Serialize a realtime refresh behind an in-flight initial read so an
    // older response can never overwrite the newer committed library state.
    await likeCachePromise;
    if (likeCacheUserId !== userId) return;
  }

  const generation = ++likeCacheGeneration;
  const request = (async () => {
    const { data, error } = await supabase
      .from('user_library')
      .select('song_id')
      .eq('user_id', userId);

    if (generation !== likeCacheGeneration || likeCacheUserId !== userId) return;
    if (error) return; // Keep the last known state; a failed read is not an empty library.
    likeCache = new Set(data?.map(d => d.song_id) || []);
    // Merge stream likes
    const streamLikes = getStreamLikes(userId);
    for (const id of streamLikes) likeCache.add(id);
    likeCacheLoaded = true;
  })();
  likeCachePromise = request;
  try { await request; }
  finally { if (likeCachePromise === request) likeCachePromise = null; }
};

const ensureLikeRealtime = (userId: string) => {
  if (likeRealtimeUserId === userId && likeRealtimeChannel) return;
  if (likeRealtimeChannel) supabase.removeChannel(likeRealtimeChannel);
  likeRealtimeUserId = userId;
  likeRealtimeChannel = supabase
    .channel(`library-live-${userId}`)
    .on(
      'postgres_changes',
      { event: '*', schema: 'public', table: 'user_library', filter: `user_id=eq.${userId}` },
      () => {
        likeCacheLoaded = false;
        loadLikeCache(userId, true).then(notifyLikeSubscribers).catch(() => {});
      },
    )
    .subscribe();
};

export const useLike = (songId: string, song?: Song | null) => {
  const { user } = useAuth();
  const [isLiked, setIsLiked] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const mountedRef = useRef(true);
  const identityRef = useRef('');
  const identity = `${user?.id ?? ''}:${songId}`;
  identityRef.current = identity;
  const pendingRef = useRef<string | null>(null);

  useEffect(() => {
    mountedRef.current = true;
    return () => { mountedRef.current = false; };
  }, []);

  useEffect(() => {
    let cancelled = false;
    setIsLoading(false);
    setIsLiked(Boolean(user && likeCacheUserId === user.id && likeCache.has(songId)));
    if (!songId) { setIsLiked(false); return; }

    const sync = () => {
      if (!mountedRef.current || cancelled) return;
      if (!user) {
        setIsLiked(false);
      } else {
        setIsLiked(likeCacheUserId === user.id && likeCache.has(songId));
      }
    };

    if (!user) {
      sync();
    } else {
      loadLikeCache(user.id).then(() => {
        if (cancelled || likeCacheUserId !== user.id) return;
        ensureLikeRealtime(user.id);
        sync();
      }).catch(() => {});
    }

    likeSubscribers.add(sync);
    return () => { cancelled = true; likeSubscribers.delete(sync); };
  }, [user?.id, songId]);

  const toggleLike = useCallback(async () => {
    if (!songId) return;

    if (!user) {
      toast.error('Please sign in to like songs');
      return;
    }

    if (isLoading || pendingRef.current === identity) return;
    pendingRef.current = identity;
    setIsLoading(true);
    const newLiked = !isLiked;

    setIsLiked(newLiked);
    if (newLiked) { likeCache.add(songId); } else { likeCache.delete(songId); }
    notifyLikeSubscribers();

    const isCatalog = isCatalogSongId(songId);

    try {
      if (newLiked) {
        if (!isCatalog && song) {
          await persistStreamSong(song);
          // Liked Songs reads this metadata row; make sure it exists first.
          await flushStreamSongsNow();
        }
        const { error } = await supabase
          .from('user_library')
          .insert({
            user_id: user.id,
            song_id: songId,
            track_source: song ? getTrackSource(song) : (isCatalog ? 'library' : 'indexed'),
          });
        if (error && error.code !== '23505') throw error;
      } else {
        const { error } = await supabase
          .from('user_library')
          .delete()
          .eq('user_id', user.id)
          .eq('song_id', songId);
        if (error) throw error;
      }

      if (!isCatalog) {
        const streamLikes = getStreamLikes(user.id);
        if (newLiked) streamLikes.add(songId); else streamLikes.delete(songId);
        saveStreamLikes(user.id, streamLikes);
      }

      // The optimistic event above can race the write. Emit again only after
      // persistence so Library/Profile/feed refetch the committed row.
      if (!mountedRef.current || identityRef.current !== identity || likeCacheUserId !== user.id) return;
      notifyLikeSubscribers();
      toast.success(newLiked ? 'Added to favorites ❤️' : 'Removed from favorites');
    } catch (error) {
      console.error('Error toggling like:', error);
      if (!mountedRef.current || identityRef.current !== identity || likeCacheUserId !== user.id) return;
      setIsLiked(!newLiked);
      if (!newLiked) { likeCache.add(songId); } else { likeCache.delete(songId); }
      notifyLikeSubscribers();
      toast.error('Failed to update favorites');
    } finally {
      if (pendingRef.current === identity) pendingRef.current = null;
      if (mountedRef.current && identityRef.current === identity) setIsLoading(false);
    }
  }, [user, songId, song, isLiked, isLoading, identity]);

  return { isLiked, isLoading, toggleLike };
};

export const useRecentlyPlayed = () => {
  const { user } = useAuth();

  const trackPlay = useCallback(async (songId: string) => {
    if (!user || !isCatalogSongId(songId)) return;

    try {
      await supabase
        .from('recently_played')
        .insert({ user_id: user.id, song_id: songId });
    } catch {
      // Silent fail
    }
  }, [user]);

  return { trackPlay };
};
