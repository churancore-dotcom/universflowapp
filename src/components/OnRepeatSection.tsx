import { memo, useCallback, useEffect, useMemo, useState } from 'react';
import { motion } from 'framer-motion';
import { Play, Repeat2 } from 'lucide-react';
import { useAuth } from '@/contexts/AuthContext';
import { usePlayer, type Song } from '@/contexts/PlayerContext';
import { loadPlayRecords, trackFingerprint, type PlayRecord } from '@/lib/listeningInsights';
import { readLocalRecent } from '@/lib/localRecentlyPlayed';
import { prewarmSongs, prewarmIntentProps } from '@/lib/instantPlay';
import { triggerHaptic } from '@/hooks/useHaptics';
import OptimizedImage from './OptimizedImage';
import { RailSkeleton } from './PageSkeletons';

/**
 * ON REPEAT — the listener's own top tracks, counted from their real play
 * history (`song_play_events` + local snapshots). Every number on screen is a
 * measured play count; nothing is invented, and tapping a row plays that exact
 * track with the whole top list as the queue.
 */

type Row = { record: PlayRecord; plays: number; song: Song | null };

const MAX_ROWS = 5;

function songFor(record: PlayRecord, byFingerprint: Map<string, Song>): Song | null {
  const local = byFingerprint.get(record.fingerprint);
  if (local) return local;
  // Play events store the videoId inside external ids like `ytm-<id>`.
  const id = record.songId || '';
  const videoId = /^(ytm?|yt)-(.+)$/.exec(id)?.[2];
  if (!videoId) return null;
  return {
    id,
    title: record.title,
    artist: record.artist || 'Unknown Artist',
    cover_url: record.cover || '',
    audio_url: `yt-video:${videoId}`,
    duration: record.duration || 0,
    videoId,
  } as Song;
}

const OnRepeatSection = memo(() => {
  const { user } = useAuth();
  const { playSong } = usePlayer();
  const [rows, setRows] = useState<Row[] | null>(null);

  const load = useCallback(async () => {
    const records = await loadPlayRecords(user?.id ?? null);

    // Local snapshots carry a playable audio_url + artwork for external tracks.
    const byFingerprint = new Map<string, Song>();
    for (const entry of readLocalRecent(user?.id ?? null)) {
      const snap = entry.song;
      if (!snap?.title) continue;
      const fp = trackFingerprint(snap.title, snap.artist);
      if (byFingerprint.has(fp)) continue;
      const videoId = /^(ytm?|yt)-(.+)$/.exec(entry.song_id)?.[2];
      byFingerprint.set(fp, {
        id: entry.song_id,
        title: snap.title,
        artist: snap.artist || 'Unknown Artist',
        cover_url: snap.cover_url || '',
        audio_url: snap.audio_url || (videoId ? `yt-video:${videoId}` : ''),
        duration: snap.duration || 0,
        ...(videoId ? { videoId } : {}),
      } as Song);
    }

    const counts = new Map<string, { record: PlayRecord; plays: number }>();
    for (const record of records) {
      if (!record.title) continue;
      const hit = counts.get(record.fingerprint);
      if (hit) {
        hit.plays += 1;
        if (!hit.record.cover && record.cover) hit.record = record;
      } else {
        counts.set(record.fingerprint, { record, plays: 1 });
      }
    }

    const all = [...counts.values()];
    // "On repeat" prefers genuinely repeated tracks, but a listener with real
    // history and no repeats yet still sees their real most-played list.
    const repeated = all.filter((c) => c.plays >= 2);
    const ranked = (repeated.length >= 3 ? repeated : all)
      .sort((a, b) => b.plays - a.plays || b.record.at - a.record.at)
      .slice(0, MAX_ROWS)
      .map<Row>((c) => ({ ...c, song: songFor(c.record, byFingerprint) }))
      .filter((r) => r.song && r.song.audio_url);

    setRows(ranked);
  }, [user?.id]);

  useEffect(() => {
    void load();
    const refresh = () => void load();
    window.addEventListener('universflow:recently-played-changed', refresh);
    return () => window.removeEventListener('universflow:recently-played-changed', refresh);
  }, [load]);

  const queue = useMemo(
    () => (rows ?? []).map((r) => r.song).filter((s): s is Song => Boolean(s)),
    [rows],
  );

  useEffect(() => {
    if (queue.length) prewarmSongs(queue, 2);
  }, [queue]);

  if (rows === null) return <RailSkeleton />;
  // Too new to have anything on repeat — stay out of the way entirely.
  if (!rows.length) return null;

  const start = (index: number) => {
    triggerHaptic('impactLight');
    const song = queue[index];
    if (song) playSong(song, null, queue.slice(index).concat(queue.slice(0, index)));
  };

  return (
    <section>
      <div className="flex items-baseline justify-between mb-1">
        <h2 className="font-display text-[32px] leading-none font-black uppercase tracking-tight text-foreground">
          On Repeat
        </h2>
        <span className="flex items-center gap-1 text-[11px] font-semibold uppercase tracking-widest text-muted-foreground">
          <Repeat2 className="w-3.5 h-3.5" /> yours
        </span>
      </div>
      <p className="text-[12px] text-muted-foreground mb-4">
        Counted from what you actually played.
      </p>

      <div className="rounded-[28px] border border-border/60 bg-card/60 backdrop-blur-xl overflow-hidden">
        {rows.map((row, i) => (
          <motion.button
            key={row.record.fingerprint}
            type="button"
            onClick={() => start(i)}
            {...prewarmIntentProps(row.song ?? null)}
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ type: 'spring', stiffness: 180, damping: 22, delay: 0.04 * i }}
            whileTap={{ scale: 0.985 }}
            className="flex items-center gap-3.5 w-full text-left px-4 py-3 border-b border-border/40 last:border-b-0 active:bg-muted/40 transition-colors"
          >
            <span className="w-5 shrink-0 text-[15px] font-black tabular-nums text-muted-foreground">
              {i + 1}
            </span>
            <div className="w-12 h-12 shrink-0 rounded-[14px] overflow-hidden bg-muted">
              <OptimizedImage
                src={row.record.cover || row.song?.cover_url || ''}
                alt={row.record.title}
                className="w-full h-full object-cover"
              />
            </div>
            <div className="min-w-0 flex-1">
              <p className="text-[14px] font-semibold text-foreground truncate">{row.record.title}</p>
              <p className="text-[12px] text-muted-foreground truncate mt-0.5">
                {row.record.artist} · {row.plays} plays
              </p>
            </div>
            <Play className="w-4 h-4 shrink-0 text-primary fill-current" />
          </motion.button>
        ))}
      </div>
    </section>
  );
});

OnRepeatSection.displayName = 'OnRepeatSection';

export default OnRepeatSection;
