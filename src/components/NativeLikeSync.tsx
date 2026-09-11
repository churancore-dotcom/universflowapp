import { useEffect } from 'react';
import { usePlayer } from '@/contexts/PlayerContext';
import { useLike } from '@/hooks/useLike';
import { setNativeMiniPlayerState } from '@/lib/nativePlayer';

/**
 * Keeps the heart button on the Android lock-screen / Control-Center mini
 * player in sync with the real like state of the current song, and handles
 * taps on it (PlayerContext re-broadcasts them as `uf:native-like-toggle`).
 */
const NativeLikeSync = () => {
  const { currentSong } = usePlayer();
  const { isLiked, toggleLike } = useLike(currentSong?.id || '', currentSong);

  useEffect(() => {
    if (!currentSong?.id) return;
    void setNativeMiniPlayerState({ liked: isLiked });
  }, [isLiked, currentSong?.id]);

  useEffect(() => {
    const handler = () => { void toggleLike(); };
    window.addEventListener('uf:native-like-toggle', handler);
    return () => window.removeEventListener('uf:native-like-toggle', handler);
  }, [toggleLike]);

  return null;
};

export default NativeLikeSync;
