import { useEffect, useState } from 'react';
import { Laptop, Play, X } from 'lucide-react';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/contexts/AuthContext';
import { usePlayer, type Song } from '@/contexts/PlayerContext';
import { usePlayerProgress } from '@/lib/playerProgressStore';
import { getDeviceId } from '@/lib/deviceId';
import { shouldOfferRemoteResume, resumePosition, type RemotePlaybackRow } from '@/lib/remoteResume';
import OptimizedImage from '@/components/OptimizedImage';

const DISMISS_KEY = (uid: string) => `uf:remote-resume-dismissed:${uid}`;

export default function CrossDeviceResume() {
  const { user, isOffline } = useAuth();
  const { currentSong, playSong, seek } = usePlayer();
  const { duration } = usePlayerProgress();
  const [row, setRow] = useState<RemotePlaybackRow | null>(null);
  const [pending, setPending] = useState<{ id: string; at: number } | null>(null);

  useEffect(() => {
    if (!user || isOffline) { setRow(null); return; }
    let alive = true;
    void supabase.from('playback_state')
      .select('song, queue, position_seconds, device_id, device_label, updated_at')
      .eq('user_id', user.id).maybeSingle()
      .then(({ data }) => {
        if (!alive || !data) return;
        const r = data as unknown as RemotePlaybackRow & { queue?: Song[] };
        const dismissed = localStorage.getItem(DISMISS_KEY(user.id));
        if (shouldOfferRemoteResume(r, getDeviceId(), Date.now(), currentSong?.id ?? null, dismissed)) setRow(r);
      });
    return () => { alive = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user?.id, isOffline]);

  useEffect(() => {
    if (!pending || currentSong?.id !== pending.id || duration <= 0) return;
    if (pending.at < duration - 5) seek(pending.at);
    setPending(null);
  }, [pending, currentSong?.id, duration, seek]);

  if (!row?.song || !user) return null;
  const song = row.song as unknown as Song;
  const queue = ((row as unknown as { queue?: Song[] }).queue || []).filter((s) => s?.id);

  const dismiss = () => { localStorage.setItem(DISMISS_KEY(user.id), row.updated_at); setRow(null); };
  const resume = () => {
    const at = resumePosition(row);
    if (at) setPending({ id: song.id, at });
    const idx = queue.findIndex((s) => s.id === song.id);
    playSong(song, null, idx >= 0 ? queue.slice(idx) : [song, ...queue]);
    dismiss();
  };

  return (
    <div className="mx-6 mb-4 flex items-center gap-3 rounded-2xl border border-border bg-card p-3">
      <div className="h-12 w-12 shrink-0 overflow-hidden rounded-lg bg-muted">
        <OptimizedImage src={song.cover_url} alt={song.title} className="h-full w-full" />
      </div>
      <div className="min-w-0 flex-1">
        <p className="flex items-center gap-1 text-[11px] font-semibold uppercase tracking-wider text-primary">
          <Laptop className="h-3 w-3" /> Continue from {row.device_label || 'another device'}
        </p>
        <p className="truncate text-sm font-semibold text-foreground">{song.title}</p>
        <p className="truncate text-xs text-muted-foreground">{song.artist}</p>
      </div>
      <button onClick={resume} aria-label="Continue here" className="flex h-10 w-10 items-center justify-center rounded-full bg-primary text-primary-foreground active:scale-95">
        <Play className="h-5 w-5 fill-current ml-0.5" />
      </button>
      <button onClick={dismiss} aria-label="Dismiss" className="p-1 text-muted-foreground"><X className="h-4 w-4" /></button>
    </div>
  );
}
