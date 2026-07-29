import React, { memo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useNavigate } from '@/lib/router-compat';
import { motion } from 'framer-motion';
import { Crown, Disc3, Lock } from 'lucide-react';
import { supabase } from '@/integrations/supabase/client';
import { Song } from '@/contexts/PlayerContext';
import { usePremium } from '@/hooks/usePremium';
import HorizontalSection from './HorizontalSection';
import SongCard from './SongCard';
import { triggerHaptic } from '@/hooks/useHaptics';

const fetchPremiumFirst = async (): Promise<Song[]> => {
  const { data, error } = await supabase
    .from('songs')
    .select('*')
    .eq('is_visible', true)
    .eq('is_premium_only', true)
    .order('created_at', { ascending: false })
    .limit(15);
  if (error) throw error;
  return (data ?? []).map((s) => ({
    id: s.id,
    title: s.title,
    artist: s.artist,
    album: s.album ?? undefined,
    cover_url: s.cover_url ?? undefined,
    audio_url: s.audio_url,
    duration: s.duration ?? 0,
    play_count: s.play_count ?? 0,
    source: 'library',
  })) as Song[];
};

const PremiumFirstSection = memo(() => {
  const { isPremium } = usePremium();
  const navigate = useNavigate();

  const { data: songs = [], isLoading } = useQuery({
    queryKey: ['home', 'premium-first', isPremium],
    queryFn: fetchPremiumFirst,
    staleTime: 5 * 60 * 1000,
  });

  // Hide section entirely when premium and there's no premium-only catalog yet
  if (isPremium && songs.length === 0) return null;
  if (isLoading && songs.length === 0) return null;

  // Free tier teaser
  if (!isPremium) {
    if (songs.length === 0) return null;
    return (
      <section className="mb-2">
        <motion.button
          onClick={() => { triggerHaptic('selection'); navigate('/premium'); }}
          className="w-full text-left rounded-3xl p-4 relative overflow-hidden"
          style={{
            background:
              'linear-gradient(135deg, rgba(255,45,85,0.18) 0%, rgba(255,193,7,0.10) 100%)',
            border: '0.5px solid rgba(255,193,7,0.30)',
          }}
          whileTap={{ scale: 0.98 }}
        >
          <div className="absolute -top-6 -right-6 w-28 h-28 rounded-full opacity-30 blur-2xl"
            style={{ background: 'radial-gradient(circle, #FFC107, transparent 70%)' }} />
          <div className="flex items-center gap-3 relative">
            <div
              className="w-12 h-12 rounded-2xl flex items-center justify-center flex-shrink-0"
              style={{ background: 'linear-gradient(135deg, #FFC107, #FF8C00)' }}
            >
              <Crown className="w-6 h-6 text-black" />
            </div>
            <div className="flex-1 min-w-0">
              <p className="text-[10px] uppercase tracking-[0.15em] font-bold mb-0.5 text-amber-300">
                Premium First
              </p>
              <p className="text-[15px] font-bold text-foreground leading-tight">
                {songs.length} exclusive {songs.length === 1 ? 'song' : 'songs'} waiting
              </p>
              <p className="text-[12px] text-muted-foreground/80 truncate mt-0.5">
                Unlock early releases, only on Premium
              </p>
            </div>
            <Lock className="w-5 h-5 text-amber-300 flex-shrink-0" />
          </div>
        </motion.button>
      </section>
    );
  }

  // Premium user — show the actual shelf
  return (
    <HorizontalSection
      title="Premium First"
      subtitle="Early access · exclusive to you"
      songs={songs}
    >
      <div className="flex gap-3 overflow-x-auto pb-2 -mx-4 px-4 snap-x snap-mandatory"
           style={{ scrollbarWidth: 'none', WebkitOverflowScrolling: 'touch' }}>
        {songs.map((song, i) => (
          <div key={song.id} className="snap-start flex-shrink-0 w-32 relative">
            <div className="absolute top-1 right-1 z-10 w-6 h-6 rounded-full flex items-center justify-center"
                 style={{ background: 'linear-gradient(135deg, #FFC107, #FF8C00)' }}>
              <Disc3 className="w-3 h-3 text-black" />
            </div>
            <SongCard song={song} index={i} sectionSongs={songs} />
          </div>
        ))}
      </div>
    </HorizontalSection>
  );
});

PremiumFirstSection.displayName = 'PremiumFirstSection';
export default PremiumFirstSection;
