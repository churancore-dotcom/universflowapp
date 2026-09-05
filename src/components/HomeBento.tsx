/**
 * Bento-style Home surface: Continue Listening hero + two 2-up rows
 * (Artist of the Week / Jump Back In, Moods / New Release).
 *
 * Every value shown here comes from data the app already has:
 *  - Continue Listening: the live player, or the persisted player snapshot
 *    (`player_queue_state`), or the newest device play-history entry.
 *  - Artist of the Week / Featured artists: the live regional chart pool,
 *    with portraits resolved through the existing artist-image enrichment.
 *  - Jump Back In: device play history (localStorage snapshots).
 *  - New Release: the existing YT Music new-releases rail.
 * Nothing is fabricated — a card self-hides (or falls back to a prompt) when
 * its signal is missing, and listener counts are never invented.
 */
import { memo, useMemo } from 'react';
import { motion } from 'framer-motion';
import { useQuery } from '@tanstack/react-query';
import { Play, Pause, Music, Sparkles } from 'lucide-react';
import { useNavigate } from '@/lib/router-compat';
import { Song, usePlayer } from '@/contexts/PlayerContext';
import { usePlayerProgress } from '@/lib/playerProgressStore';
import { useLocalRecents } from '@/hooks/useLocalRecents';
import { recentSongs } from '@/lib/personalHome';
import { useYtmNewReleases } from '@/lib/ytmRails';
import { useUserCountry } from '@/hooks/useUserCountry';
import { cachedArtistPortrait, enrichArtistImages } from '@/lib/musicIndexer';
import { triggerHaptic } from '@/hooks/useHaptics';
import { cleanRail } from '@/lib/railQuality';

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

const MOODS = ['Focus', 'Hype', 'Chill', 'Late Night', 'Relax', 'Love'] as const;

const Card = ({ className = '', children }: { className?: string; children: React.ReactNode }) => (
  <div className={`rounded-[28px] border border-border/60 bg-card/70 overflow-hidden ${className}`}>{children}</div>
);

const HomeBento = ({ songs, personalArtist = null }: { songs: Song[]; personalArtist?: string | null }) => {
  const navigate = useNavigate();
  const country = useUserCountry();
  const { currentSong, isPlaying, playSong, togglePlay } = usePlayer();
  const { progress, duration } = usePlayerProgress();
  const recents = useLocalRecents(30);

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

  const playResume = () => {
    if (!resume) return;
    triggerHaptic('selection');
    if (resumeIsCurrent) { togglePlay(); return; }
    playSong(resume.song, null, [resume.song, ...songs.slice(0, 30)]);
  };

  const startListening = () => {
    const pool = cleanRail(songs, { requireCover: true });
    if (!pool.length) return;
    triggerHaptic('selection');
    playSong(pool[0], null, pool.slice(0, 40));
  };

  const pct = resume && resume.total > 0 ? Math.min(100, (resume.at / resume.total) * 100) : 0;

  // ── Artist of the Week — most-charting artist in the live pool ─────────
  const topArtist = useMemo(() => {
    if (personalArtist && personalArtist.trim().length > 1) return personalArtist.trim();
    const counts = new Map<string, { name: string; hits: number }>();
    for (const s of songs) {
      const name = (s.artist || '').split(/,|&|feat\.?|ft\.?/i)[0].trim();
      if (name.length < 2) continue;
      const key = name.toLowerCase();
      const row = counts.get(key);
      if (row) row.hits += 1; else counts.set(key, { name, hits: 1 });
    }
    return [...counts.values()].sort((a, b) => b.hits - a.hits)[0]?.name || null;
  }, [songs]);

  const { data: portraits } = useQuery({
    queryKey: ['artist-portraits', 'aotw', topArtist],
    enabled: !!topArtist,
    staleTime: 24 * 60 * 60 * 1000,
    queryFn: () => enrichArtistImages([topArtist as string]),
  });
  const artistImage = topArtist ? (portraits?.[topArtist] ?? cachedArtistPortrait(topArtist)) : null;

  // ── New Release — existing rail, first clean entry ─────────────────────
  const { data: releases = [] } = useYtmNewReleases(country, 12, songs.length > 0);
  const newRelease = useMemo(
    () => cleanRail(releases as Song[], { requireCover: true })[0] || null,
    [releases],
  );

  const jumpBackIn = history.slice(0, 3);

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
                {resume.song.cover_url ? (
                  <img src={resume.song.cover_url} alt="" className="w-full h-full object-cover" loading="eager" />
                ) : (
                  <div className="w-full h-full flex items-center justify-center"><Music className="w-7 h-7 text-primary-foreground/70" /></div>
                )}
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

      {/* ROW — Artist of the Week / Jump Back In */}
      {(topArtist || jumpBackIn.length > 0) && (
        <div className="grid grid-cols-2 gap-3">
          {topArtist && (
            <Card className="relative aspect-[3/4]">
              <button
                onClick={() => { triggerHaptic('selection'); navigate(`/artists?focus=${encodeURIComponent(topArtist)}`); }}
                className="absolute inset-0 text-left"
              >
                {artistImage ? (
                  <img src={artistImage} alt={`${topArtist} portrait`} className="absolute inset-0 w-full h-full object-cover" referrerPolicy="no-referrer" />
                ) : (
                  <div className="absolute inset-0 bg-gradient-to-br from-primary/30 to-background flex items-center justify-center">
                    <span className="font-display text-4xl uppercase text-foreground/60">{topArtist.slice(0, 2)}</span>
                  </div>
                )}
                <div className="absolute inset-0 bg-gradient-to-t from-background via-background/40 to-background/10" />
                <p className="absolute top-4 left-4 right-4 text-[10px] font-bold uppercase tracking-[0.18em] text-primary">Artist of the Week</p>
                <p className="absolute bottom-4 left-4 right-4 font-display text-[20px] leading-tight uppercase text-foreground line-clamp-2">
                  {topArtist}
                </p>
              </button>
            </Card>
          )}

          {jumpBackIn.length > 0 && (
            <Card className="p-4 flex flex-col">
              <p className="text-[10px] font-bold uppercase tracking-[0.18em] text-primary">Jump Back In</p>
              <div className="mt-3 space-y-3">
                {jumpBackIn.map((song) => (
                  <button
                    key={song.id}
                    onClick={() => { triggerHaptic('selection'); playSong(song, null, [song, ...history.slice(0, 20)]); }}
                    className="flex items-center gap-2.5 w-full text-left"
                  >
                    <div className="w-10 h-10 shrink-0 rounded-[14px] overflow-hidden bg-muted">
                      {song.cover_url ? (
                        <img src={song.cover_url} alt="" className="w-full h-full object-cover" loading="lazy" />
                      ) : (
                        <div className="w-full h-full flex items-center justify-center"><Music className="w-4 h-4 text-muted-foreground" /></div>
                      )}
                    </div>
                    <div className="min-w-0">
                      <p className="text-[12.5px] font-bold text-foreground truncate leading-tight">{song.title}</p>
                      <p className="text-[11px] text-muted-foreground truncate">{song.artist}</p>
                    </div>
                  </button>
                ))}
              </div>
            </Card>
          )}
        </div>
      )}

      {/* ROW — Moods / New Release */}
      <div className="grid grid-cols-2 gap-3">
        <Card className="p-4">
          <p className="text-[10px] font-bold uppercase tracking-[0.18em] text-primary">Moods</p>
          <div className="mt-3 flex flex-wrap gap-2">
            {MOODS.map((mood) => (
              <button
                key={mood}
                onClick={() => { triggerHaptic('selection'); navigate(`/search?q=${encodeURIComponent(`${mood} mix`)}`); }}
                className="rounded-full border border-border/70 bg-muted/40 px-3 py-1.5 text-[11px] font-bold uppercase tracking-wide text-foreground active:bg-primary active:text-primary-foreground transition-colors"
              >
                {mood}
              </button>
            ))}
          </div>
        </Card>

        {newRelease ? (
          <Card className="p-4 flex flex-col justify-between">
            <p className="text-[10px] font-bold uppercase tracking-[0.18em] text-primary">New Release</p>
            <div className="flex items-center gap-3 mt-3">
              <div className="w-14 h-14 shrink-0 rounded-[14px] overflow-hidden bg-muted">
                {newRelease.cover_url && <img src={newRelease.cover_url} alt="" className="w-full h-full object-cover" loading="lazy" />}
              </div>
              <div className="min-w-0">
                <p className="text-[12.5px] font-bold text-foreground line-clamp-2 leading-tight">{newRelease.title}</p>
                <p className="text-[11px] text-muted-foreground truncate">{newRelease.artist}</p>
              </div>
            </div>
            <button
              onClick={() => { triggerHaptic('selection'); playSong(newRelease, null, cleanRail(releases as Song[], { requireCover: true }).slice(0, 30)); }}
              aria-label={`Play ${newRelease.title}`}
              className="mt-3 self-end w-10 h-10 rounded-full bg-primary text-primary-foreground flex items-center justify-center active:scale-95 transition-transform"
            >
              <Play className="w-4 h-4 fill-current ml-0.5" />
            </button>
          </Card>
        ) : (
          <Card className="p-4 flex flex-col items-center justify-center text-center">
            <Sparkles className="w-5 h-5 text-primary mb-2" />
            <p className="text-[11px] font-semibold text-muted-foreground">New releases load in a moment</p>
          </Card>
        )}
      </div>
    </div>
  );
};

export default memo(HomeBento);
