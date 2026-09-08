/**
 * Home surface, simplified: Continue Listening + Jump Back In.
 *
 * Every value comes from data the app already has:
 *  - Continue Listening: the live player, or the persisted player snapshot
 *    (`player_queue_state`), or the newest device play-history entry.
 *  - Jump Back In: device play history (localStorage snapshots).
 * Nothing is fabricated — a card self-hides when its signal is missing, and no
 * chart/editorial cards live here any more.
 */
import { memo, useEffect, useMemo, useState } from 'react';
import { motion } from 'framer-motion';
import { Play, Pause, Sparkle } from 'lucide-react';
import { Song, usePlayer } from '@/contexts/PlayerContext';
import { usePlayerProgress } from '@/lib/playerProgressStore';
import { useLocalRecents } from '@/hooks/useLocalRecents';
import { recentSongs, jumpBackInGroups } from '@/lib/personalHome';
import { triggerHaptic } from '@/hooks/useHaptics';
import { cleanRail, songFingerprint } from '@/lib/railQuality';
import { useYtmNewReleases } from '@/lib/ytmRails';
import { useUserCountry } from '@/hooks/useUserCountry';
import { isSpamSong } from '@/pages/Search';
import OptimizedImage from './OptimizedImage';

const PLAYER_SNAPSHOT_KEY = 'player_queue_state';

const fmt = (s?: number) => {
  if (!s || !Number.isFinite(s) || s <= 0) return '0:00';
  const m = Math.floor(s / 60);
  const sec = Math.floor(s % 60);
  return `${m}:${sec.toString().padStart(2, '0')}`;
};

type Snapshot = { song?: Song; progress?: number; duration?: number };

const readSnapshot = (): Snapshot | null => {
  try {
    const raw = localStorage.getItem(PLAYER_SNAPSHOT_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Snapshot;
    return parsed?.song?.title ? parsed : null;
  } catch {
    return null;
  }
};

const Card = ({ className = '', children }: { className?: string; children: React.ReactNode }) => (
  <div className={`rounded-[28px] border border-border/60 bg-card/70 overflow-hidden ${className}`}>{children}</div>
);

const HomeBento = ({ songs }: { songs: Song[]; personalArtist?: string | null }) => {
  const { currentSong, isPlaying, playSong, togglePlay, seek } = usePlayer();
  const { progress, duration } = usePlayerProgress();
  const recents = useLocalRecents(60);
  const [pendingSeek, setPendingSeek] = useState<{ id: string; at: number } | null>(null);

  const history = useMemo(() => recentSongs(recents), [recents]);

  // ── Continue Listening ─────────────────────────────────────────────────
  const snapshot = useMemo(() => (typeof window === 'undefined' ? null : readSnapshot()), [recents.length]);

  const resume = useMemo(() => {
    if (currentSong) {
      return { song: currentSong, at: progress, total: duration || currentSong.duration || 0, live: true };
    }
    if (snapshot?.song) {
      return { song: snapshot.song, at: snapshot.progress || 0, total: snapshot.duration || snapshot.song.duration || 0, live: false };
    }
    if (history[0]) {
      return { song: history[0], at: 0, total: history[0].duration || 0, live: false };
    }
    return null;
  }, [currentSong, progress, duration, snapshot, history]);

  const resumeIsCurrent = !!resume && !!currentSong && resume.song.id === currentSong.id;

  // Resuming really resumes: once the track we asked for is loaded and its
  // duration is known, jump to the exact saved position.
  useEffect(() => {
    if (!pendingSeek || !currentSong || currentSong.id !== pendingSeek.id) return;
    if (!duration || duration <= 0) return;
    if (pendingSeek.at >= duration - 5) { setPendingSeek(null); return; }
    seek(pendingSeek.at);
    setPendingSeek(null);
  }, [pendingSeek, currentSong?.id, duration, seek]);

  const playResume = () => {
    if (!resume) return;
    triggerHaptic('selection');
    if (resumeIsCurrent) { togglePlay(); return; }
    const at = Math.max(0, Math.floor(resume.at || 0));
    if (at > 5) setPendingSeek({ id: resume.song.id, at });
    playSong(resume.song, null, [resume.song, ...history.slice(0, 20), ...songs.slice(0, 30)]);
  };

  const startListening = () => {
    const pool = cleanRail(songs, { requireCover: true });
    if (!pool.length) return;
    triggerHaptic('selection');
    playSong(pool[0], null, pool.slice(0, 40));
  };

  const pct = resume && resume.total > 0 ? Math.min(100, (resume.at / resume.total) * 100) : 0;

  // ── Jump Back In — real album/artist sets the listener was working through
  const jumpGroups = useMemo(() => jumpBackInGroups(recents, 1).slice(0, 6), [recents]);

  // ── Artist of the Week — the artist the listener actually played most ──
  const artistOfWeek = useMemo(() => {
    const cutoff = Date.now() - 7 * 24 * 60 * 60 * 1000;
    const byArtist = new Map<string, { name: string; plays: number; songs: Song[] }>();
    for (const entry of recents) {
      if (entry.played_at < cutoff) continue;
      const song = entry.song as Song | undefined;
      if (!song?.artist) continue;
      const key = song.artist.trim().toLowerCase();
      const bucket = byArtist.get(key) || { name: song.artist.trim(), plays: 0, songs: [] };
      bucket.plays += 1;
      if (!bucket.songs.some((s) => songFingerprint(s) === songFingerprint(song))) bucket.songs.push(song);
      byArtist.set(key, bucket);
    }
    let best: { name: string; plays: number; songs: Song[] } | null = null;
    for (const bucket of byArtist.values()) {
      if (!best || bucket.plays > best.plays) best = bucket;
    }
    return best && best.plays >= 2 ? best : null;
  }, [recents]);

  // ── New Release — the freshest real single from the live release feed ──
  const country = useUserCountry();
  const { data: releasePool = [] } = useYtmNewReleases(country, 8, true);
  const newRelease = useMemo(
    () => cleanRail(releasePool.filter((s) => !isSpamSong(s)), { requireCover: true })[0] || null,
    [releasePool],
  );

  return (
    <div className="px-5 space-y-3">
      {/* HERO — Continue Listening */}
      <motion.div initial={{ opacity: 0, y: 14 }} animate={{ opacity: 1, y: 0 }} transition={{ type: 'spring', stiffness: 140, damping: 20 }}>
        {resume ? (
          <div className="relative rounded-[28px] overflow-hidden bg-gradient-to-br from-primary via-primary/80 to-primary/40 p-5">
            <div className="grid grid-cols-[minmax(0,1fr)_auto] gap-4 items-center">
              <div className="min-w-0">
                <p className="text-[11px] font-bold uppercase tracking-[0.2em] text-primary-foreground/70">Continue Listening</p>
                <h2 className="font-display text-[28px] leading-[1.05] uppercase text-primary-foreground line-clamp-2 mt-1">
                  {resume.song.title}
                </h2>
                <p className="text-[13px] font-semibold text-primary-foreground/80 truncate mt-0.5">{resume.song.artist}</p>

                <div className="flex items-center gap-3 mt-4">
                  <button
                    onClick={playResume}
                    aria-label={resumeIsCurrent && isPlaying ? 'Pause' : 'Play'}
                    className="w-12 h-12 shrink-0 rounded-full bg-background text-foreground flex items-center justify-center shadow-lg active:scale-95 transition-transform"
                  >
                    {resumeIsCurrent && isPlaying ? <Pause className="w-6 h-6 fill-current" /> : <Play className="w-6 h-6 fill-current ml-0.5" />}
                  </button>
                  <div className="min-w-0 flex-1">
                    <div className="h-1 rounded-full bg-primary-foreground/25 overflow-hidden">
                      <div className="h-full bg-primary-foreground rounded-full" style={{ width: `${pct}%` }} />
                    </div>
                    <div className="flex justify-between text-[11px] font-semibold text-primary-foreground/80 mt-1.5">
                      <span>{fmt(resume.at)}</span>
                      <span>{resume.total > 0 ? fmt(resume.total) : '--:--'}</span>
                    </div>
                  </div>
                </div>
              </div>

              <div className="w-[112px] h-[112px] shrink-0 rounded-[14px] overflow-hidden bg-background/30">
                <OptimizedImage src={resume.song.cover_url} alt={resume.song.title} eager className="w-full h-full" />
              </div>
            </div>
          </div>
        ) : (
          <Card className="p-6 text-center">
            <p className="text-[11px] font-bold uppercase tracking-[0.2em] text-muted-foreground">Nothing playing yet</p>
            <h2 className="font-display text-[26px] uppercase mt-1">Start Listening</h2>
            <button
              onClick={startListening}
              disabled={songs.length === 0}
              className="mt-4 inline-flex items-center gap-2 rounded-full bg-primary text-primary-foreground px-5 py-2.5 text-[13px] font-bold disabled:opacity-50"
            >
              <Play className="w-4 h-4 fill-current" /> Play something
            </button>
          </Card>
        )}
      </motion.div>

      {/* JUMP BACK IN — real album/artist sets from history */}
      {jumpGroups.length > 0 && (
        <Card className="p-4">
          <p className="text-[10px] font-bold uppercase tracking-[0.18em] text-primary">Jump Back In</p>
          <div className="mt-3 grid grid-cols-2 gap-x-4 gap-y-3">
            {jumpGroups.map((group) => (
              <button
                key={group.id}
                onClick={() => {
                  triggerHaptic('selection');
                  playSong(group.songs[0], null, [...group.songs, ...history.slice(0, 20)]);
                }}
                className="flex items-center gap-2.5 w-full text-left active:opacity-60 transition-opacity"
              >
                <div className="w-11 h-11 shrink-0 rounded-[14px] overflow-hidden bg-muted">
                  <OptimizedImage src={group.cover_url} alt={group.title} className="w-full h-full" />
                </div>
                <div className="min-w-0">
                  <p className="text-[12.5px] font-bold text-foreground truncate leading-tight">{group.title}</p>
                  <p className="text-[11px] text-muted-foreground truncate">
                    {group.songs.length > 1 ? `${group.songs.length} tracks` : group.subtitle}
                  </p>
                </div>
              </button>
            ))}
          </div>
        </Card>
      )}
    </div>
  );
};

export default memo(HomeBento);
