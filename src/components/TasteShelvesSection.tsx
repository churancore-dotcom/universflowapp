import { memo, useEffect, useMemo } from 'react';
import { motion } from 'framer-motion';
import { useQuery } from '@tanstack/react-query';
import { useAuth } from '@/contexts/AuthContext';
import { Song, usePlayer } from '@/contexts/PlayerContext';
import OptimizedImage from './OptimizedImage';
import RailHeader from './RailHeader';
import { RailSkeleton } from './PageSkeletons';
import { triggerHaptic } from '@/hooks/useHaptics';
import { prewarmSongs, prewarmIntentProps } from '@/lib/instantPlay';
import { feedRotationSalt, searchYouTubeMusicTracks } from '@/lib/musicIndexer';
import { isSpamSong } from '@/pages/Search';
import { useTasteProfile } from '@/hooks/useTasteProfile';
import { useFollowedArtists } from '@/hooks/useFollowedArtists';
import { cleanRail, diversifyByArtist, songFingerprint } from '@/lib/railQuality';
import { isSuppressed, rerank } from '@/lib/feedPersonalizer';
import { buildTasteShelves, type ShelfSpec } from '@/lib/tasteClusters';

const MIN_TRACKS = 4;
const MAX_TRACKS = 12;

interface Shelf extends ShelfSpec {
  songs: Song[];
}

/**
 * Multi-shelf personalisation — several distinct, explained rails instead of one
 * generic "Made For You".
 *
 * Each shelf is a real taste cluster (most-played artist, followed artist,
 * recurring keyword) and its heading states the reason it exists. Shelves that
 * cannot be filled with enough genuine tracks are dropped entirely, so a new
 * listener sees fewer shelves rather than empty or invented ones.
 */
const TasteShelvesSection = memo(() => {
  const { user } = useAuth();
  const { playSong, currentSong } = usePlayer();
  const taste = useTasteProfile();
  const { names: followed } = useFollowedArtists();

  // Recomputed per render but stable within a 30-minute bucket.
  const salt = feedRotationSalt();

  const specs = useMemo(
    () => buildTasteShelves(taste, followed, 5),
    [taste, followed],
  );

  const { data: shelves = [], isLoading } = useQuery({
    queryKey: [
      'taste-shelves-v2',
      user?.id ?? 'anon',
      specs.map((s) => s.id).join('|'),
      Math.floor(taste.signalCount / 5),
      // Rotates every ~30 min / new session so shelves don't stay pinned to
      // one cached result set all day.
      salt,
    ],
    enabled: specs.length > 0,
    staleTime: 10 * 60 * 1000,
    gcTime: 6 * 60 * 60 * 1000,
    queryFn: async (): Promise<Shelf[]> => {
      // One fingerprint set across all shelves: the same song must not show up
      // twice on the page just because two clusters overlap.
      const seen = new Set<string>();
      const out: Shelf[] = [];

      const settled = await Promise.allSettled(
        specs.map((spec) =>
          Promise.allSettled(spec.queries.map((q) => searchYouTubeMusicTracks(q, 14, salt))),
        ),
      );

      specs.forEach((spec, idx) => {
        const group = settled[idx];
        if (group.status !== 'fulfilled') return;
        const raw: Song[] = [];
        for (const res of group.value) {
          if (res.status !== 'fulfilled') continue;
          for (const t of res.value) {
            if (!t.id || !t.title || !t.artist) continue;
            const song = {
              id: t.id,
              title: t.title,
              artist: t.artist,
              album: t.album,
              cover_url: t.cover_url,
              audio_url: t.audio_url || (t.videoId ? `yt-video:${t.videoId}` : 'resolving'),
              duration: t.duration,
            } as Song;
            if (isSpamSong(song)) continue;
            raw.push(song);
          }
        }
        const picked: Song[] = [];
        for (const song of cleanRail(raw, { requireCover: true })) {
          const print = songFingerprint(song);
          if (seen.has(print)) continue;
          // Negative signals apply here too — a disliked/repeatedly skipped
          // artist must not resurface inside a "for you" shelf.
          if (isSuppressed(song, taste)) continue;
          seen.add(print);
          picked.push(song);
          if (picked.length >= MAX_TRACKS) break;
        }
        // A shelf with nothing real behind it simply doesn't exist.
        if (picked.length < MIN_TRACKS) return;
        out.push({ ...spec, songs: diversifyByArtist(rerank(picked, taste)) });
      });

      return out;
    },
  });

  useEffect(() => {
    if (shelves.length) prewarmSongs(shelves[0].songs, 3);
  }, [shelves]);

  if (!specs.length) return null;
  if (!shelves.length) return isLoading ? <RailSkeleton title="w-56" /> : null;

  return (
    <div className="space-y-12">
      {shelves.map((shelf, shelfIdx) => (
        <section key={shelf.id} className="relative">
          <RailHeader title={shelf.title} subtitle={shelf.subtitle} />
          <div className="flex gap-4 overflow-x-auto scrollbar-hide -mx-5 px-5 pb-1 snap-x snap-mandatory">
            {shelf.songs.map((song, idx) => {
              const isPlaying = currentSong?.id === song.id;
              return (
                <motion.button
                  key={song.id}
                  initial={{ opacity: 0, y: 12 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{
                    type: 'spring',
                    stiffness: 140,
                    damping: 20,
                    delay: Math.min(idx, 5) * 0.03 + shelfIdx * 0.02,
                  }}
                  whileTap={{ scale: 0.97 }}
                  onClick={() => {
                    triggerHaptic('selection');
                    playSong(song, undefined, shelf.songs);
                  }}
                  {...prewarmIntentProps(song)}
                  className="shrink-0 w-[132px] text-left snap-start"
                >
                  <div className="relative w-[132px] h-[132px] rounded-[14px] overflow-hidden bg-muted">
                    <OptimizedImage
                      src={song.cover_url || ''}
                      alt={song.title}
                      className="w-full h-full object-cover"
                    />
                  </div>
                  <p
                    className={`mt-2.5 text-[13px] font-bold leading-tight line-clamp-2 ${
                      isPlaying ? 'text-primary' : 'text-foreground'
                    }`}
                  >
                    {song.title}
                  </p>
                  <p className="text-[11px] text-muted-foreground/70 truncate mt-0.5 font-medium">
                    {song.artist}
                  </p>
                </motion.button>
              );
            })}
          </div>
        </section>
      ))}
    </div>
  );
});

TasteShelvesSection.displayName = 'TasteShelvesSection';
export default TasteShelvesSection;
