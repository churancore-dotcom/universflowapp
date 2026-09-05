import React, { memo, useMemo } from 'react';
import { motion } from 'framer-motion';
import { useNavigate } from '@/lib/router-compat';
import { ChevronRight } from 'lucide-react';
import { triggerHaptic } from '@/hooks/useHaptics';
import { cachedArtistPortrait, enrichArtistImages } from '@/lib/musicIndexer';
import { useQuery } from '@tanstack/react-query';
import FollowArtistButton from './FollowArtistButton';
import type { Song } from '@/contexts/PlayerContext';
import { slice, sliceTransition } from '@/lib/ufMotion';
import RailHeader from './RailHeader';


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
    // Deezer serves artist portraits from several CDN hostnames
    // (cdn-images / e-cdns-images / e-cdn-images). What guarantees it is a real
    // portrait — never a song cover — is the /images/artist/ path segment.
    const deezer = /(^|\.)dzcdn\.net$/i.test(parsed.hostname)
      && /^\/images\/artist\/[a-z0-9]+\//i.test(parsed.pathname);
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
const FeaturedArtistsSection = ({
  songs,
  circle = false,
  playsByArtist,
}: {
  songs: Song[];
  circle?: boolean;
  /** Real per-artist play counts from this listener's history (lowercased key). */
  playsByArtist?: Record<string, number>;
}) => {
  const navigate = useNavigate();
  const relation = (name: string) => {
    const plays = playsByArtist?.[name.toLowerCase()] || 0;
    if (plays <= 0) return null;
    return plays === 1 ? 'You played 1 song' : `You played ${plays} songs`;
  };


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

  if (circle) {
    return (
      <section className="relative">
        <RailHeader
          title="Featured Artists"
          subtitle="Leading the charts right now"
          actionLabel="View all"
          onAction={() => navigate('/artists')}
        />
        <div className="uf-rail -mx-1 px-1 pb-1">
          {artists.map((artist, i) => (
            <motion.button
              key={artist.key}
              initial={slice.initial}
              animate={slice.animate}
              transition={sliceTransition(i * 0.04)}
              onClick={() => { triggerHaptic('selection'); navigate(`/artists?focus=${encodeURIComponent(artist.name)}`); }}
              className="shrink-0 w-[104px] text-center"
            >
              <div className="w-[92px] h-[92px] mx-auto rounded-full overflow-hidden border-2 border-primary/70">
                {artist.image ? (
                  <img src={artist.image} alt={`${artist.name} artist profile`} className="w-full h-full object-cover" loading="lazy" decoding="async" referrerPolicy="no-referrer" />
                ) : (
                  <div className="w-full h-full bg-gradient-to-br from-primary/25 to-background flex items-center justify-center">
                    <span className="text-xl font-black uppercase text-foreground/70">{artist.name.slice(0, 2)}</span>
                  </div>
                )}
              </div>
              <p className="mt-2 text-[12px] font-bold text-foreground truncate">{artist.name}</p>
              {relation(artist.name) && (
                <p className="text-[10.5px] font-semibold text-primary truncate">{relation(artist.name)}</p>
              )}

          ))}
        </div>
      </section>
    );
  }

  return (
    <section className="relative">
      <RailHeader
        title="Trending Artists"
        subtitle="Leading the charts right now"
        actionLabel="All"
        onAction={() => navigate('/artists')}
      />

      <div className="uf-rail -mx-1 px-1 pb-1">
        {artists.map((artist, i) => (
          <motion.div
            key={artist.key}
            initial={slice.initial}
            animate={slice.animate}
            transition={sliceTransition(i * 0.04)}
            className="shrink-0 w-[132px]"
          >
            <button
              onClick={() => { triggerHaptic('selection'); navigate(`/artists?focus=${encodeURIComponent(artist.name)}`); }}
              className="relative block w-[132px] h-[168px] text-left rounded-lg overflow-hidden border border-white/5 group"
            >
              {artist.image ? (
                <img src={artist.image} alt={`${artist.name} artist profile`} className="absolute inset-0 w-full h-full object-cover" loading="eager" decoding="async" referrerPolicy="no-referrer" />
              ) : (

                <div className="absolute inset-0 bg-gradient-to-br from-primary/25 to-background flex items-center justify-center">
                  <span className="text-3xl font-black tracking-tight text-foreground/70 uppercase">
                    {artist.name.slice(0, 2)}
                  </span>
                </div>
              )}

              <div className="absolute inset-0 bg-gradient-to-t from-black/95 via-black/40 to-transparent" />
              <div className="absolute bottom-2.5 left-3 right-3">
                <p className="text-[12.5px] font-bold text-foreground leading-tight line-clamp-2 tracking-tight group-hover:text-primary transition-colors">{artist.name}</p>
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
