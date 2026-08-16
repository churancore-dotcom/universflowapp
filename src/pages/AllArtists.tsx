import { useState, useEffect, useCallback, memo, useMemo, useRef } from 'react';
import { motion } from 'framer-motion';
import { useNavigate, useSearchParams } from '@/lib/router-compat';
import { ArrowLeft, User, Music, Loader2, Radio, Heart, Search as SearchIcon, X } from 'lucide-react';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/contexts/AuthContext';
import { usePlayer, Song } from '@/contexts/PlayerContext';
import {
  searchIndexedTracks,
  resolveIndexedTrack,
  searchArtistDirectory,
  getTopArtistsByTag,
  enrichArtistImages,
  type IndexedTrack,
} from '@/lib/musicIndexer';
import { followArtist, unfollowArtist, getUserArtistPrefs } from '@/lib/userArtistPrefs';
import { CURATED_ARTISTS, ARTIST_CATEGORIES, type ArtistCategory } from '@/lib/curatedArtists';
import BottomNav from '@/components/BottomNav';
import SEOHead from '@/components/SEOHead';
import { toast } from 'sonner';
import { triggerHaptic } from '@/hooks/useHaptics';

interface ArtistEntry {
  name: string;
  image_url?: string;
  listeners?: number;
  category: string;
  source: 'catalog' | 'lastfm' | 'platform';
  catalogId?: string;
  platformSlug?: string;
}

const ArtistRow = memo(({ artist, isFollowed, onFollow, onPlay, onOpen }: {
  artist: ArtistEntry;
  isFollowed: boolean;
  onFollow: (artist: ArtistEntry) => void;
  onPlay: (artist: ArtistEntry) => void;
  onOpen: (artist: ArtistEntry) => void;
}) => (
  <motion.div
    className="flex items-center gap-3 p-3 rounded-2xl"
    style={{ background: 'rgba(255,255,255,0.04)', border: '0.5px solid rgba(255,255,255,0.08)' }}
    initial={{ opacity: 0, y: 8 }}
    animate={{ opacity: 1, y: 0 }}
  >
    <button
      onClick={() => { triggerHaptic('selection'); onOpen(artist); }}
      className="flex items-center gap-3 flex-1 min-w-0 text-left active:opacity-70"
    >
      <div className="w-14 h-14 rounded-full overflow-hidden flex-shrink-0 bg-muted">
        {artist.image_url ? (
          <img src={artist.image_url} alt={artist.name} className="w-full h-full object-cover" loading="lazy" referrerPolicy="no-referrer" />
        ) : (
          <div className="w-full h-full flex items-center justify-center bg-gradient-to-br from-primary/20 to-accent/20">
            <User className="w-6 h-6 text-muted-foreground" />
          </div>
        )}
      </div>
      <div className="flex-1 min-w-0">
        <p className="font-semibold text-sm truncate text-foreground">{artist.name}</p>
        <p className="text-xs text-muted-foreground mt-0.5 truncate">
          {artist.category} · <span className="text-primary">{artist.source === 'platform' ? 'Universflow Artist' : artist.source === 'catalog' ? 'Catalog' : 'Web Stream'}</span>
        </p>
      </div>
    </button>
    <motion.button
      whileTap={{ scale: 0.85 }}
      onClick={() => { triggerHaptic('impactLight'); onFollow(artist); }}
      className="w-9 h-9 rounded-full flex items-center justify-center flex-shrink-0"
      style={{
        background: isFollowed ? 'hsl(var(--primary) / 0.18)' : 'rgba(255,255,255,0.06)',
        border: `0.5px solid ${isFollowed ? 'hsl(var(--primary) / 0.4)' : 'rgba(255,255,255,0.10)'}`,
      }}
      aria-label={isFollowed ? 'Unfollow' : 'Follow'}
    >
      <Heart className={`w-4 h-4 ${isFollowed ? 'text-primary fill-primary' : 'text-muted-foreground'}`} />
    </motion.button>
  </motion.div>
));
ArtistRow.displayName = 'ArtistRow';

const AllArtists = () => {
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  const { user } = useAuth();
  const { playSong, currentSong, isPlaying } = usePlayer();
  const [allArtists, setAllArtists] = useState<ArtistEntry[]>([]);
  const [followed, setFollowed] = useState<Set<string>>(new Set());
  const [activeCategory, setActiveCategory] = useState<'All' | 'Following' | 'Universflow' | ArtistCategory>('All');
  const [query, setQuery] = useState('');
  const [debouncedQuery, setDebouncedQuery] = useState('');
  const [loading, setLoading] = useState(true);
  const [searchingArtists, setSearchingArtists] = useState(false);
  const [artistSongs, setArtistSongs] = useState<IndexedTrack[]>([]);
  const [selectedArtist, setSelectedArtist] = useState<ArtistEntry | null>(null);
  const [loadingSongs, setLoadingSongs] = useState(false);
  const [resolvingId, setResolvingId] = useState<string | null>(null);
  const enrichmentTriggered = useRef<Set<string>>(new Set());
  const focusHandledRef = useRef<string | null>(null);

  // Tags used to fetch *real* artist directories from Last.fm with Deezer PFPs.
  // Each category maps to one or more Last.fm tags so we get rich, themed lists.
  const CATEGORY_TAGS: Record<ArtistCategory, string[]> = useMemo(() => ({
    Trending: ['pop', 'hip-hop'],
    Indian: ['indian', 'bollywood'],
    Bollywood: ['bollywood', 'hindi'],
    Punjabi: ['punjabi', 'desi'],
    'Global Pop': ['pop'],
    'Hip-Hop': ['hip-hop', 'rap'],
    Rock: ['rock', 'alternative'],
    'K-Pop': ['k-pop'],
    Latin: ['latin', 'reggaeton'],
    Electronic: ['electronic', 'edm'],
    'R&B': ['rnb', 'soul'],
    Indie: ['indie', 'indie pop'],
  }), []);

  // Initial load: platform artists + catalog + curated + trending live artists + user follows
  useEffect(() => {
    const load = async () => {
      try {
        const [platformRes, catalogRes, trendingRes, prefs] = await Promise.all([
          supabase
            .from('artist_profiles')
            .select('user_id, stage_name, slug, avatar_url, total_followers, total_plays, is_verified')
            .order('total_followers', { ascending: false })
            .limit(200),
          supabase.from('artists').select('id, name, photo_url, genre').limit(200),
          getTopArtistsByTag('pop', 40).catch(() => []),
          user ? getUserArtistPrefs(user.id).catch(() => []) : Promise.resolve([]),
        ]);

        const map = new Map<string, ArtistEntry>();

        // 1) Platform artists (verified Universflow artists — top priority, shown first)
        for (const p of platformRes.data || []) {
          if (!p.stage_name) continue;
          map.set(p.stage_name.toLowerCase(), {
            name: p.stage_name,
            image_url: p.avatar_url || undefined,
            listeners: p.total_followers ?? undefined,
            category: 'Universflow',
            source: 'platform',
            platformSlug: p.slug || undefined,
          });
        }

        // 2) Catalog artists (admin-uploaded)
        for (const a of catalogRes.data || []) {
          const key = a.name.toLowerCase();
          if (map.has(key)) continue;
          map.set(key, {
            name: a.name,
            image_url: a.photo_url || undefined,
            category: a.genre || 'Catalog',
            source: 'catalog',
            catalogId: a.id,
          });
        }

        // 3) Curated artists (well-known names by category)
        for (const c of CURATED_ARTISTS) {
          const key = c.name.toLowerCase();
          if (!map.has(key)) {
            map.set(key, { name: c.name, category: c.category, source: 'lastfm' });
          }
        }

        // 3) Live trending artists with real PFPs
        for (const t of trendingRes) {
          const key = t.name.toLowerCase();
          const existing = map.get(key);
          if (existing) {
            if (!existing.image_url && t.image_url) existing.image_url = t.image_url;
            if (t.listeners) existing.listeners = t.listeners;
          } else {
            map.set(key, {
              name: t.name,
              image_url: t.image_url,
              listeners: t.listeners,
              category: 'Trending',
              source: 'lastfm',
            });
          }
        }

        const initial = Array.from(map.values());
        setAllArtists(initial);
        setFollowed(new Set(prefs.map(p => p.artist_name.toLowerCase())));

        // Background-fill missing PFPs (Deezer) for the curated list — async, no blocking
        // Portraits are fetched in ONE batched request per 60 names (the
        // backend's page size) instead of a request per artist card, which is
        // what showed up as an N+1 on /artists.
        const missing = initial.filter(a => !a.image_url).map(a => a.name);
        if (missing.length) {
          const batches: string[][] = [];
          for (let i = 0; i < missing.length; i += 60) batches.push(missing.slice(i, i + 60));
          Promise.all(batches.map((b) => enrichArtistImages(b).catch(() => ({} as Record<string, string>))))
            .then((parts) => {
              const images = Object.assign({}, ...parts) as Record<string, string>;
              if (!Object.keys(images).length) return;
              setAllArtists((prev) => prev.map((a) => images[a.name] ? { ...a, image_url: images[a.name] } : a));
            })
            .catch(() => {});
        }
      } catch (e) {
        console.error('Failed to load artists:', e);
      } finally {
        setLoading(false);
      }
    };
    load();
    // Depend on the user ID, not the user object: Supabase hands back a new
    // object on every token refresh, which re-ran this whole multi-request load
    // (the repeated identical calls Sentry flagged on /artists).
  }, [userId]);

  // Lazy-load tag-based artists when user picks a category (so list keeps growing)
  useEffect(() => {
    if (activeCategory === 'All' || activeCategory === 'Universflow') return;
    if (enrichmentTriggered.current.has(activeCategory)) return;
    enrichmentTriggered.current.add(activeCategory);
    const tags = CATEGORY_TAGS[activeCategory as ArtistCategory] || [];
    if (!tags.length) return;
    Promise.all(tags.map((tag) => getTopArtistsByTag(tag, 40).catch(() => [])))
      .then((buckets) => {
        const incoming = buckets.flat();
        if (!incoming.length) return;
        setAllArtists((prev) => {
          const map = new Map(prev.map((a) => [a.name.toLowerCase(), a]));
          for (const t of incoming) {
            const key = t.name.toLowerCase();
            const existing = map.get(key);
            if (existing) {
              if (!existing.image_url && t.image_url) existing.image_url = t.image_url;
              if (t.listeners && !existing.listeners) existing.listeners = t.listeners;
            } else {
              map.set(key, {
                name: t.name,
                image_url: t.image_url,
                listeners: t.listeners,
                category: activeCategory,
                source: 'lastfm',
              });
            }
          }
          return Array.from(map.values());
        });
      });
  }, [activeCategory, CATEGORY_TAGS]);

  // Debounce query
  useEffect(() => {
    const id = setTimeout(() => setDebouncedQuery(query.trim()), 300);
    return () => clearTimeout(id);
  }, [query]);

  // When user types a search, also pull live artist matches (so unlimited artists)
  useEffect(() => {
    if (!debouncedQuery || debouncedQuery.length < 2) return;
    setSearchingArtists(true);
    searchArtistDirectory(debouncedQuery, 30)
      .then((found) => {
        if (!found.length) return;
        setAllArtists((prev) => {
          const map = new Map(prev.map((a) => [a.name.toLowerCase(), a]));
          for (const f of found) {
            const key = f.name.toLowerCase();
            const existing = map.get(key);
            if (existing) {
              if (!existing.image_url && f.image_url) existing.image_url = f.image_url;
            } else {
              map.set(key, {
                name: f.name,
                image_url: f.image_url,
                listeners: f.listeners,
                category: 'Search',
                source: 'lastfm',
              });
            }
          }
          return Array.from(map.values());
        });
      })
      .finally(() => setSearchingArtists(false));
  }, [debouncedQuery]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    const list = allArtists.filter(a => {
      const key = a.name.toLowerCase();
      if (activeCategory === 'Following') {
        if (!followed.has(key)) return false;
      } else if (activeCategory === 'Universflow') {
        if (a.source !== 'platform') return false;
      } else if (activeCategory === 'Trending') {
        if (a.category !== 'Trending') return false;
        if (a.source === 'platform') return false;
      } else if (activeCategory === 'All') {
        // Hide platform artists from the default "All" view — they only
        // appear under the dedicated "Universflow" chip until they earn
        // organic listeners.
        if (a.source === 'platform') return false;
      } else {
        if (a.category !== activeCategory) return false;
        if (a.source === 'platform') return false;
      }
      if (q && !key.includes(q)) return false;
      return true;
    });
    return list.sort((a, b) => (b.listeners || 0) - (a.listeners || 0));
  }, [allArtists, activeCategory, query, followed]);



  const handleFollow = useCallback(async (artist: ArtistEntry) => {
    if (!user) {
      toast.error('Sign in to follow artists');
      return;
    }
    const key = artist.name.toLowerCase();
    const isFollowed = followed.has(key);
    // Optimistic
    setFollowed(prev => {
      const next = new Set(prev);
      if (isFollowed) next.delete(key); else next.add(key);
      return next;
    });
    const ok = isFollowed
      ? await unfollowArtist(user.id, artist.name)
      : await followArtist(user.id, artist.name, { image: artist.image_url || null, source: artist.source === 'platform' ? 'catalog' : artist.source });
    if (!ok) {
      // rollback
      setFollowed(prev => {
        const next = new Set(prev);
        if (isFollowed) next.add(key); else next.delete(key);
        return next;
      });
      toast.error('Could not update. Please try again.');
    } else {
      toast.success(isFollowed ? `Unfollowed ${artist.name}` : `Following ${artist.name}`);
    }
  }, [user, followed]);

  const handleOpenArtist = useCallback(async (artist: ArtistEntry) => {
    setSelectedArtist(artist);
    setLoadingSongs(true);
    setArtistSongs([]);
    try {
      const tracks = await searchIndexedTracks(artist.name, 50);
      setArtistSongs(tracks);
    } catch {
      toast.error('Failed to load songs for this artist');
    }
    setLoadingSongs(false);
  }, [navigate]);

  // Auto-open artist from ?focus= query (from Home featured / Library artist click)
  useEffect(() => {
    const focusName = searchParams.get('focus');
    if (!focusName || loading || focusHandledRef.current === focusName) return;
    const match = allArtists.find(a => a.name.toLowerCase() === focusName.toLowerCase());
    if (match) {
      focusHandledRef.current = focusName;
      handleOpenArtist(match);
      const next = new URLSearchParams(searchParams);
      next.delete('focus');
      setSearchParams(next, { replace: true });
    }
  }, [searchParams, allArtists, loading, handleOpenArtist, setSearchParams]);

  const handlePlayTrack = useCallback(async (track: IndexedTrack) => {
    setResolvingId(track.id);
    try {
      const resolved = await resolveIndexedTrack(track.artist, track.title).catch(() => null);
      const song: Song = {
        id: track.id,
        title: resolved?.title || track.title,
        artist: resolved?.artist || track.artist,
        album: track.album,
        cover_url: resolved?.cover_url || track.cover_url,
        audio_url: resolved?.streamUrl || 'resolving',
        duration: resolved?.duration || track.duration,
        source: 'indexed',
      };
      playSong(song, undefined, artistSongs.map(t => ({
        id: t.id, title: t.title, artist: t.artist, album: t.album,
        cover_url: t.cover_url, audio_url: t.id === track.id ? song.audio_url : 'resolving', source: 'indexed' as const,
      })));
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Playback failed');
    } finally {
      setResolvingId(null);
    }
  }, [playSong, artistSongs]);

  const categoriesWithAll = useMemo(() => ['Following', 'All', 'Universflow', ...ARTIST_CATEGORIES] as const, []);

  return (
    <div className="ethereal-page h-[100dvh] flex flex-col overflow-hidden relative">
      <SEOHead
        title="Browse Artists — Discover Music | Univers Flow"
        description="Browse and follow artists across every genre on Univers Flow. Stream songs, explore discographies, and download for offline listening."
        path="/artists"
        jsonLdId="artists-jsonld"
        jsonLd={{
          '@context': 'https://schema.org',
          '@type': 'CollectionPage',
          name: 'Browse Artists — Univers Flow',
          url: 'https://universflow.in/artists',
          isPartOf: { '@type': 'WebSite', name: 'Univers Flow', url: 'https://universflow.in' },
        }}
      />
      <header className="flex-shrink-0 z-30 px-4 pt-3 pb-3 safe-area-pt" style={{
        background: 'rgba(0,0,0,0.7)',
        backdropFilter: 'blur(40px) saturate(180%)',
        borderBottom: '0.5px solid rgba(255,255,255,0.06)',
      }}>
        <div className="flex items-center gap-3">
          <motion.button onClick={() => { triggerHaptic('impactLight'); if (selectedArtist) { setSelectedArtist(null); } else { navigate(-1); } }}
            aria-label="Go back"
            className="w-9 h-9 rounded-xl flex items-center justify-center"
            style={{ background: 'rgba(255,255,255,0.06)', border: '0.5px solid rgba(255,255,255,0.10)' }}
            whileTap={{ scale: 0.85 }}>
            <ArrowLeft className="w-4 h-4" />
          </motion.button>
          <h1 className="ethereal-title text-xl font-bold tracking-tight truncate">
            {selectedArtist ? selectedArtist.name : 'Discover Artists'}
          </h1>
        </div>

        {!selectedArtist && (
          <>
            {/* Search */}
            <div className="mt-3 relative">
              <SearchIcon className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
              <input
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="Search artists..."
                aria-label="Search artists"
                className="w-full h-10 pl-9 pr-9 rounded-xl bg-white/5 border border-white/10 text-sm placeholder:text-muted-foreground focus:outline-none focus:border-primary/40"
              />
              {query && (
                <button onClick={() => setQuery('')} aria-label="Clear search" className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground">
                  <X className="w-4 h-4" />
                </button>
              )}
            </div>

            {/* Category chips */}
            <div className="mt-3 -mx-4 px-4 overflow-x-auto scrollbar-hide">
              <div className="flex gap-2 w-max">
                {categoriesWithAll.map(cat => {
                  const active = activeCategory === cat;
                  return (
                    <button
                      key={cat}
                      onClick={() => { triggerHaptic('selection'); setActiveCategory(cat as ArtistCategory | 'All' | 'Universflow' | 'Following'); }}
                      className="px-3 h-8 rounded-full text-xs font-semibold whitespace-nowrap transition-all"
                      style={{
                        background: active ? 'hsl(var(--primary))' : 'rgba(255,255,255,0.06)',
                        color: active ? 'hsl(var(--primary-foreground))' : 'hsl(var(--foreground))',
                        border: `0.5px solid ${active ? 'hsl(var(--primary))' : 'rgba(255,255,255,0.10)'}`,
                      }}
                    >
                      {cat}
                    </button>
                  );
                })}
              </div>
            </div>
          </>
        )}
      </header>

      <main className="flex-1 overflow-y-auto px-4 pt-4 pb-36" style={{ WebkitOverflowScrolling: 'touch' }}>
        {loading ? (
          <div className="flex justify-center py-12"><Loader2 className="w-6 h-6 animate-spin text-primary" /></div>
        ) : selectedArtist ? (
          <div className="space-y-1">
            {loadingSongs ? (
              <div className="flex justify-center py-12"><Loader2 className="w-6 h-6 animate-spin text-primary" /></div>
            ) : artistSongs.length === 0 ? (
              <p className="text-center text-muted-foreground py-8">No songs found for this artist</p>
            ) : (
              artistSongs.map((track, i) => {
                const isActive = currentSong?.id === track.id;
                const isResolving = resolvingId === track.id;
                return (
                  <motion.button key={track.id}
                    className={`flex items-center gap-3 p-3 rounded-2xl w-full text-left active:scale-[0.98] transition-all ${isActive ? 'bg-primary/10' : ''}`}
                    style={{ background: isActive ? undefined : 'rgba(255,255,255,0.03)' }}
                    onClick={() => !isResolving && handlePlayTrack(track)}
                    initial={{ opacity: 0, y: 6 }}
                    animate={{ opacity: 1, y: 0 }}
                    transition={{ delay: Math.min(i * 0.02, 0.5) }}>
                    <div className="w-12 h-12 rounded-xl overflow-hidden flex-shrink-0 bg-muted">
                      {track.cover_url ? (
                        <img src={track.cover_url} alt="" className="w-full h-full object-cover" loading="lazy" referrerPolicy="no-referrer" />
                      ) : (
                        <div className="w-full h-full flex items-center justify-center"><Music className="w-4 h-4 text-muted-foreground" /></div>
                      )}
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className={`font-semibold text-[13px] truncate ${isActive ? 'text-primary' : ''}`}>
                        {isResolving ? 'Loading...' : track.title}
                      </p>
                      <p className="text-[11px] text-muted-foreground truncate mt-0.5">{track.artist}</p>
                    </div>
                    {isActive && isPlaying ? (
                      <div className="flex items-end gap-[2px] h-4">
                        {[0,1,2].map(j => <div key={j} className="w-[3px] bg-primary rounded-full animate-audio-wave" style={{ animationDelay: `${j*0.12}s` }} />)}
                      </div>
                    ) : isResolving ? (
                      <Loader2 className="w-4 h-4 animate-spin text-primary" />
                    ) : null}
                  </motion.button>
                );
              })
            )}
          </div>
        ) : filtered.length === 0 ? (
          <div className="text-center py-16 px-6">
            {activeCategory === 'Following' ? (
              <>
                <Heart className="w-10 h-10 text-muted-foreground/40 mx-auto mb-3" />
                <p className="text-sm font-semibold text-foreground">No artists followed yet</p>
                <p className="text-xs text-muted-foreground mt-1">Tap the heart on any artist to follow them.</p>
                <button
                  onClick={() => setActiveCategory('All')}
                  className="mt-4 px-4 h-9 rounded-full text-xs font-semibold bg-primary text-primary-foreground"
                >
                  Browse Artists
                </button>
              </>
            ) : (
              <p className="text-muted-foreground text-sm">No artists match your search.</p>
            )}
          </div>
        ) : (
          <div className="space-y-1.5">
            <p className="text-[11px] text-muted-foreground px-1 mb-1">
              {filtered.length} {activeCategory === 'Following' ? 'followed' : 'artists'} · Tap heart to {activeCategory === 'Following' ? 'unfollow' : 'follow'}
            </p>
            {filtered.map(a => (
              <ArtistRow
                key={a.name}
                artist={a}
                isFollowed={followed.has(a.name.toLowerCase())}
                onFollow={handleFollow}
                onPlay={handleOpenArtist}
                onOpen={handleOpenArtist}
              />
            ))}
          </div>
        )}
      </main>

      <BottomNav />
    </div>
  );
};

export default AllArtists;
