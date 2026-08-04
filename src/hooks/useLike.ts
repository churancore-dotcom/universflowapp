import { useState, useEffect, useCallback, useRef } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/contexts/AuthContext';
import { toast } from 'sonner';
import { isCatalogSongId } from '@/lib/songSupport';
import { persistStreamSong, getTrackSource } from '@/lib/streamSongs';
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

const getStreamLikes = (): Set<string> => {
  try {
    const raw = localStorage.getItem(STREAM_LIKES_KEY);
    return raw ? new Set(JSON.parse(raw)) : new Set();
  } catch { return new Set(); }
};

const saveStreamLikes = (likes: Set<string>) => {
  try {
    localStorage.setItem(STREAM_LIKES_KEY, JSON.stringify([...likes]));
  } catch { /* ignore */ }
};

export const resetLikeCache = () => {
  likeCache = new Set();
  likeCacheLoaded = false;
  likeCacheUserId = null;
  likeCachePromise = null;
};

const loadLikeCache = async (userId: string): Promise<void> => {
  if (likeCacheUserId !== userId) resetLikeCache();
  if (likeCacheLoaded && likeCacheUserId === userId) return;
  if (likeCachePromise && likeCacheUserId === userId) return likeCachePromise;

  likeCacheUserId = userId;
  likeCachePromise = (async () => {
    const { data } = await supabase
      .from('user_library')
      .select('song_id')
      .eq('user_id', userId);

    likeCache = new Set(data?.map(d => d.song_id) || []);
    // Merge stream likes
    const streamLikes = getStreamLikes();
    for (const id of streamLikes) likeCache.add(id);
    likeCacheLoaded = true;
    likeCachePromise = null;
  })();

  return likeCachePromise;
};

export const useLike = (songId: string, song?: Song | null) => {
  const { user } = useAuth();
  const [isLiked, setIsLiked] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const mountedRef = useRef(true);

  useEffect(() => {
    mountedRef.current = true;
    return () => { mountedRef.current = false; };
  }, []);

  useEffect(() => {
    if (!songId) { setIsLiked(false); return; }

    const sync = () => {
      if (!mountedRef.current) return;
      if (!user) {
        setIsLiked(getStreamLikes().has(songId));
      } else {
        setIsLiked(likeCache.has(songId));
      }
    };

    if (!user) {
      sync();
    } else {
      loadLikeCache(user.id).then(sync);
    }

    likeSubscribers.add(sync);
    return () => { likeSubscribers.delete(sync); };
  }, [user?.id, songId]);

  const toggleLike = useCallback(async () => {
    if (!songId) return;

    if (!user) {
      toast.error('Please sign in to like songs');
      return;
    }

    if (isLoading) return;
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
        const streamLikes = getStreamLikes();
        if (newLiked) streamLikes.add(songId); else streamLikes.delete(songId);
        saveStreamLikes(streamLikes);
      }

      toast.success(newLiked ? 'Added to favorites ❤️' : 'Removed from favorites');
    } catch (error) {
      console.error('Error toggling like:', error);
      setIsLiked(!newLiked);
      if (!newLiked) { likeCache.add(songId); } else { likeCache.delete(songId); }
      notifyLikeSubscribers();
      toast.error('Failed to update favorites');
    } finally {
      if (mountedRef.current) setIsLoading(false);
    }
  }, [user, songId, song, isLiked, isLoading]);

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
