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
  const { currentSong, isPlaying } = usePlayer();
  const { isLiked, toggleLike } = useLike(currentSong?.id || '', currentSong);

  // Re-push when playback starts too: the phone's player service may not be
  // running yet when the song first loads, which would drop the heart state.
  useEffect(() => {
    if (!currentSong?.id) return;
    void setNativeMiniPlayerState({ liked: isLiked });
    const t = window.setTimeout(() => { void setNativeMiniPlayerState({ liked: isLiked }); }, 1500);
    return () => window.clearTimeout(t);
  }, [isLiked, currentSong?.id, isPlaying]);

  useEffect(() => {
    const handler = () => { void toggleLike(); };
    window.addEventListener('uf:native-like-toggle', handler);
    return () => window.removeEventListener('uf:native-like-toggle', handler);
  }, [toggleLike]);

  return null;
};

export default NativeLikeSync;
