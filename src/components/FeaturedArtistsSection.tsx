import React, { memo, useMemo } from 'react';
import { motion } from 'framer-motion';
import { useNavigate } from '@/lib/router-compat';
import { ChevronRight } from 'lucide-react';
import { triggerHaptic } from '@/hooks/useHaptics';
import { cachedArtistPortrait, enrichArtistImages } from '@/lib/musicIndexer';
import { useQuery } from '@tanstack/react-query';
import FollowArtistButton from './FollowArtistButton';
import type { Song } from '@/contexts/PlayerContext';

interface DisplayArtist {
  key: string;
  name: string;
  image: string | null;
}

const isPortraitUrl = (url: string | null) => {
  if (!url) return false;
  // Only accept known artist-image CDN endpoints — never channel thumbnails or
  // song covers. Deezer is the backend's exact-name fallback for Spotify gaps.
  try {
    const parsed = new URL(url, 'https://universflow.invalid');
    const spotify = parsed.hostname === 'i.scdn.co' && /^\/image\/[a-z0-9]+$/i.test(parsed.pathname);
    const deezer = parsed.hostname === 'e-cdns-images.dzcdn.net'
      && /^\/images\/artist\/[a-z0-9]+\/[a-z0-9-]+\.jpg$/i.test(parsed.pathname);
    return spotify || deezer;
  } catch {
    return false;
  }
};

// Channel/aggregate names that are not real artists. These are what made the
// rail look fake: "Various Artists", auto-generated "- Topic" channels, label
// or lyric-mill uploads harvested from chart playlists.
const NOT_AN_ARTIST = /^(various artists|unknown artist|va|dj|topic|music|lyrics?|audio|official|soundtrack|cast|karaoke|instrumental|cover|remix)$/i;
const JUNK_SUFFIX = /\s*[-–]\s*topic$|\s*vevo$|\s*official$|\s*music$/i;

/** Split "A, B & C feat. D" into the individual credited artists. */
const splitCredits = (raw: string): string[] =>
  raw
    .replace(/\s*\((?:feat|ft|with)[^)]*\)/gi, ',')
    .split(/,|&|\bfeat\.?\b|\bft\.?\b|\bwith\b|\bx\b|\bvs\.?\b/i)
    .map((part) => part.replace(JUNK_SUFFIX, '').trim())
    .filter((part) => part.length > 1 && part.length < 40 && !NOT_AN_ARTIST.test(part));

/**
 * Trending Artists — real chart artists resolved to portrait-only imagery.
 * Ranked by how often they appear across the live regional/global charts, which
 * is the actual "who is trending right now" signal (Spotify does the same).
 */
const FeaturedArtistsSection = ({ songs }: { songs: Song[] }) => {
  const navigate = useNavigate();

  const baseArtists = useMemo<DisplayArtist[]>(() => {
    const counts = new Map<string, { name: string; hits: number; first: number }>();
    songs.forEach((song, index) => {
      for (const name of splitCredits(song.artist || '')) {
        const key = name.toLowerCase();
        const existing = counts.get(key);
        if (existing) existing.hits += 1;
        else counts.set(key, { name, hits: 1, first: index });
      }
    });
    return [...counts.values()]
      // More chart entries = genuinely bigger right now; ties keep chart order.
      .sort((a, b) => b.hits - a.hits || a.first - b.first)
      .slice(0, 12)
      .map((a) => ({ key: `trending-${a.name.toLowerCase()}`, name: a.name, image: null }));
  }, [songs]);


  // Resolve every artist by name. Older follows may contain a song cover in
  // artist_image, so only known portrait hosts are allowed as an instant cache.
  const artistNames = useMemo(
    () => baseArtists.map((a) => a.name),
    [baseArtists],
  );
  const { data: portraits } = useQuery({
    queryKey: ['artist-portraits', artistNames.join('|')],
    enabled: artistNames.length > 0,
    staleTime: 24 * 60 * 60 * 1000,
    gcTime: 24 * 60 * 60 * 1000,
    queryFn: () => enrichArtistImages(artistNames),
  });

  const artists = useMemo<DisplayArtist[]>(() => {
    const resolved = baseArtists.map((a) => {
      // Locally cached portrait paints instantly; the query result refines it.
      const url = portraits?.[a.name] ?? cachedArtistPortrait(a.name);
      return { ...a, image: isPortraitUrl(url) ? url : null };
    });
    const withPortrait = resolved.filter((a) => a.image);
    // Prefer real portraits. If a region's chart artists have no portrait yet,
    // still show the genuinely trending names with a monogram tile rather than
    // hiding the rail or pasting a song cover onto an artist card.
    return (withPortrait.length >= 4 ? withPortrait : resolved).slice(0, 10);
  }, [baseArtists, portraits]);


  if (artists.length === 0) return null;

  return (
    <section className="mb-2 pt-4">
      <div className="flex items-end justify-between mb-3 px-1">
        <div>
          <h2 className="font-display text-2xl tracking-[0.06em] uppercase text-foreground">Trending Artists</h2>
          <p className="text-[10px] text-muted-foreground/55 font-semibold mt-0.5">Artists leading the charts right now</p>
        </div>
        <motion.button
          className="flex items-center gap-0.5 text-[11px] font-semibold text-primary"
          onClick={() => { triggerHaptic('selection'); navigate('/artists'); }}
          whileTap={{ scale: 0.95 }}
        >
          All <ChevronRight className="w-3.5 h-3.5" />
        </motion.button>
      </div>

      <div className="flex gap-3 overflow-x-auto hide-scrollbar snap-x snap-mandatory -mx-1 px-1 pb-1">
        {artists.map((artist, i) => (
          <motion.div
            key={artist.key}
            initial={{ opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: i * 0.04, duration: 0.3 }}
            className="snap-start shrink-0 w-[148px]"
          >
            <button
              onClick={() => { triggerHaptic('selection'); navigate(`/artists?focus=${encodeURIComponent(artist.name)}`); }}
              className="relative block w-[148px] h-[196px] rounded-[28px] overflow-hidden neu text-left"
            >
              {artist.image ? (
                <img src={artist.image} alt={`${artist.name} artist profile`} className="absolute inset-0 w-full h-full object-cover" loading="eager" decoding="async" referrerPolicy="no-referrer" />
              ) : (
                <div className="absolute inset-0 bg-gradient-to-br from-primary/25 to-background flex items-center justify-center">
                  <span className="font-display text-4xl tracking-[0.06em] text-foreground/70 uppercase">
                    {artist.name.slice(0, 2)}
                  </span>
                </div>
              )}

              <div className="absolute inset-0 bg-gradient-to-t from-black/90 via-black/25 to-transparent" />
              <div className="absolute bottom-3 left-3 right-3">
                <p className="text-[13.5px] font-extrabold text-white leading-tight line-clamp-2">{artist.name}</p>
                <p className="text-[9.5px] text-white/55 uppercase tracking-[0.16em] mt-0.5">
                  Trending now
                </p>
              </div>
            </button>
            <div className="mt-2 flex justify-center">
              <FollowArtistButton artistName={artist.name} artistImage={artist.image} />
            </div>
          </motion.div>
        ))}
      </div>
    </section>
  );
};

export default memo(FeaturedArtistsSection);
