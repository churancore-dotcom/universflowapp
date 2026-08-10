import { memo, useEffect, useRef, useState } from 'react';
import { usePlayer } from '@/contexts/PlayerContext';

/**
 * Screen-reader announcer for playback state.
 * Renders a visually hidden polite live region so track changes,
 * play/pause and queue updates are spoken without stealing focus.
 */
const PlaybackAnnouncer = memo(function PlaybackAnnouncer() {
  const { currentSong, isPlaying, queue } = usePlayer();
  const [message, setMessage] = useState('');

  const lastSongIdRef = useRef<string | null>(null);
  const lastPlayingRef = useRef<boolean | null>(null);
  const lastQueueLenRef = useRef<number | null>(null);

  // Track change (and initial track) announcement.
  useEffect(() => {
    if (!currentSong) {
      lastSongIdRef.current = null;
      return;
    }
    if (currentSong.id === lastSongIdRef.current) return;
    lastSongIdRef.current = currentSong.id;
    setMessage(
      `Now playing: ${currentSong.title}${currentSong.artist ? ` by ${currentSong.artist}` : ''}`
    );
  }, [currentSong]);

  // Play / pause announcement (skipped on the very first render).
  useEffect(() => {
    if (lastPlayingRef.current === null) {
      lastPlayingRef.current = isPlaying;
      return;
    }
    if (lastPlayingRef.current === isPlaying) return;
    lastPlayingRef.current = isPlaying;
    if (!currentSong) return;
    setMessage(isPlaying ? `Playing ${currentSong.title}` : `Paused ${currentSong.title}`);
  }, [isPlaying, currentSong]);

  // Queue length changes.
  useEffect(() => {
    const len = queue.length;
    if (lastQueueLenRef.current === null) {
      lastQueueLenRef.current = len;
      return;
    }
    const prev = lastQueueLenRef.current;
    if (prev === len) return;
    lastQueueLenRef.current = len;
    if (len === 0) {
      setMessage('Queue cleared');
    } else if (len > prev) {
      const added = len - prev;
      setMessage(`${added} song${added !== 1 ? 's' : ''} added to queue. ${len} song${len !== 1 ? 's' : ''} in queue.`);
    } else {
      const removed = prev - len;
      setMessage(`${removed} song${removed !== 1 ? 's' : ''} removed from queue. ${len} song${len !== 1 ? 's' : ''} in queue.`);
    }
  }, [queue.length]);

  return (
    <div
      aria-live="polite"
      aria-atomic="true"
      role="status"
      className="sr-only"
    >
      {message}
    </div>
  );
});

export default PlaybackAnnouncer;
