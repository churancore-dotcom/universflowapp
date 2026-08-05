import React, { memo, useMemo } from 'react';
import { motion } from 'framer-motion';
import { useNavigate } from '@/lib/router-compat';
import { User, ChevronRight } from 'lucide-react';
import { triggerHaptic } from '@/hooks/useHaptics';
import { enrichArtistImages } from '@/lib/musicIndexer';
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
  return url.includes('yt3.googleusercontent.com')
    || /cdn-images\.dzcdn\.net\/images\/artist\//i.test(url)
    || /\/storage\/v1\/object\//i.test(url);
};

/**
 * Trending Artists — real chart artists resolved to portrait-only imagery.
 */
const FeaturedArtistsSection = ({ songs }: { songs: Song[] }) => {
  const navigate = useNavigate();

  const baseArtists = useMemo<DisplayArtist[]>(() => {
    const out: DisplayArtist[] = [];
    const seen = new Set<string>();
    for (const song of songs) {
      const name = song.artist?.trim();
      const key = name?.toLowerCase();
      if (!name || !key || seen.has(key)) continue;
      seen.add(key);
      out.push({ key: `trending-${key}`, name, image: null });
      if (out.length >= 10) break;
    }
    return out;
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

  const artists = useMemo<DisplayArtist[]>(
    () => baseArtists.map((a) => ({
      ...a,
      image: portraits?.[a.name] ?? null,
    })).filter((artist) => isPortraitUrl(artist.image)),
    [baseArtists, portraits],
  );

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
                  <User className="w-7 h-7 text-muted-foreground" />
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
