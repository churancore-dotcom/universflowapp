import React, { memo } from 'react';
import { motion } from 'framer-motion';
import { useNavigate } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { User, Disc3, ChevronRight } from 'lucide-react';
import { useAuth } from '@/contexts/AuthContext';
import { supabase } from '@/integrations/supabase/client';
import { triggerHaptic } from '@/hooks/useHaptics';
import { getUserArtistPrefs, followArtist, type UserArtistPref } from '@/lib/userArtistPrefs';

interface DisplayArtist {
  key: string;
  name: string;
  image: string | null;
  navigateTo?: string;
}

const slugify = (s: string) =>
  s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');

const ArtistCard = memo(({ artist, index, onClick }: { artist: DisplayArtist; index: number; onClick: () => void }) => (
  <motion.button
    className="flex-shrink-0 w-[84px] snap-start text-center"
    onClick={onClick}
    initial={{ opacity: 0, scale: 0.8, y: 10 }}
    animate={{ opacity: 1, scale: 1, y: 0 }}
    transition={{ delay: index * 0.05, duration: 0.35, ease: [0.22, 1, 0.36, 1] }}
    whileTap={{ scale: 0.9 }}
  >
    <div className="relative w-[72px] h-[72px] mx-auto mb-2.5">
      {/* Rose ring glow */}
      <div
        className="absolute -inset-[3px] rounded-full"
        style={{
          background: '#ff2d55',
          filter: 'blur(6px)',
          opacity: 0.55,
        }}
      />
      <div
        className="absolute inset-0 rounded-full p-[2px]"
        style={{ background: '#ff2d55' }}
      >
        <div className="w-full h-full rounded-full overflow-hidden bg-background">
          {artist.image ? (
            <img src={artist.image} alt={artist.name} className="w-full h-full object-cover" loading="lazy" referrerPolicy="no-referrer" />
          ) : (
            <div className="w-full h-full bg-gradient-to-br from-rose-500/30 to-rose-900/40 flex items-center justify-center">
              <User className="w-5 h-5 text-muted-foreground" />
            </div>
          )}
        </div>
      </div>
    </div>
    <p className="text-[12px] font-bold truncate text-foreground leading-tight">{artist.name}</p>
    <p className="text-[10px] text-white/45 mt-0.5 font-medium">Artist</p>
  </motion.button>
));
ArtistCard.displayName = 'ArtistCard';

const FeaturedArtistsSection = () => {
  const { user } = useAuth();
  const navigate = useNavigate();

  const { data: artists = [], isLoading: loading } = useQuery({
    queryKey: ['featured-artists', user?.id ?? 'anon'],
    staleTime: 10 * 60 * 1000,
    gcTime: 30 * 60 * 1000,
    queryFn: async (): Promise<DisplayArtist[]> => {
      // Only show artists the user has actually followed.
      // We never surface internal platform/demo artist profiles here.
      if (!user) return [];
      const prefs: UserArtistPref[] = await getUserArtistPrefs(user.id);
      return prefs.map(p => ({
        key: p.id,
        name: p.artist_name,
        image: p.artist_image,
      }));
    },
  });

  if (loading || artists.length === 0) return null;

  return (
    <section className="mb-2">
      <div
        className="rounded-3xl p-4 pb-3"
        style={{
          background: 'linear-gradient(180deg, rgba(255,255,255,0.04) 0%, rgba(255,255,255,0.02) 100%)',
          border: '0.5px solid rgba(255,255,255,0.08)',
        }}
      >
        <div className="flex items-center justify-between mb-4">
          <div className="flex items-center gap-2">
            <div
              className="w-6 h-6 rounded-lg flex items-center justify-center"
              style={{ background: 'linear-gradient(135deg, hsl(var(--primary) / 0.2), hsl(var(--primary) / 0.1))' }}
            >
              <Disc3 className="w-3.5 h-3.5 text-primary" />
            </div>
            <h2 className="text-[16px] font-bold tracking-tight text-foreground">Featured Artists</h2>
          </div>
          <motion.button
            className="flex items-center gap-1 text-xs font-medium text-primary"
            onClick={() => { triggerHaptic('selection'); navigate('/artists'); }}
            whileTap={{ scale: 0.95 }}
          >
            View All
            <ChevronRight className="w-3.5 h-3.5" />
          </motion.button>
        </div>

        <div
          className="flex gap-3 overflow-x-auto pb-1 hide-scrollbar snap-x snap-mandatory -mx-4 px-4"
          style={{ WebkitOverflowScrolling: 'touch' }}
        >
          {artists.map((artist, i) => (
            <ArtistCard
              key={artist.key}
              artist={artist}
              index={i}
              onClick={() => {
                triggerHaptic('selection');
                // Auto-follow on first tap so the artist sticks in "Your Artists"
                if (user) {
                  void followArtist(user.id, artist.name, { image: artist.image, source: 'lastfm' });
                }
                navigate(`/artists?focus=${encodeURIComponent(artist.name)}`);
              }}
            />
          ))}
        </div>
      </div>
    </section>
  );
};

export default memo(FeaturedArtistsSection);
