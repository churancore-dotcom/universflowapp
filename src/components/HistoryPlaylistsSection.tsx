/**
 * "Your Playlists" — real playlists assembled from tracks the listener has
 * already played, grouped by mood (from real titles) and by artist (from real
 * play counts). Nothing is fetched or invented: with no history the section
 * simply does not render.
 */
import { memo, useMemo } from 'react';
import { motion } from 'framer-motion';
import { Play } from 'lucide-react';
import { usePlayer } from '@/contexts/PlayerContext';
import { useLocalRecents } from '@/hooks/useLocalRecents';
import { useTasteProfile } from '@/hooks/useTasteProfile';
import { historyPlaylists } from '@/lib/personalHome';
import { triggerHaptic } from '@/hooks/useHaptics';
import OptimizedImage from './OptimizedImage';

const HistoryPlaylistsSection = () => {
  const { playSong } = usePlayer();
  const recents = useLocalRecents(100);
  const taste = useTasteProfile();

  const playlists = useMemo(() => historyPlaylists(recents, taste), [recents, taste]);
  if (playlists.length === 0) return null;

  return (
    <section>
      <h2 className="font-display text-[32px] leading-none uppercase text-foreground mb-1">
        Your Playlists
      </h2>
      <p className="text-[12px] text-muted-foreground mb-4">
        Built from what you've actually played
      </p>

      <div className="-mx-6 px-6 flex gap-3 overflow-x-auto no-scrollbar snap-x snap-mandatory">
        {playlists.map((list, i) => (
          <motion.button
            key={list.id}
            type="button"
            initial={{ opacity: 0, y: 12 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: Math.min(0.2, i * 0.04) }}
            whileTap={{ scale: 0.97 }}
            onClick={() => {
              triggerHaptic('selection');
              playSong(list.songs[0], null, list.songs.slice(0, 50));
            }}
            className="snap-start shrink-0 w-[150px] text-left"
          >
            <div className="relative w-[150px] h-[150px] rounded-[28px] overflow-hidden bg-muted">
              <OptimizedImage src={list.cover_url} alt={list.title} className="w-full h-full" />
              <span className="absolute bottom-2 right-2 w-9 h-9 rounded-full bg-primary text-primary-foreground flex items-center justify-center shadow-lg">
                <Play className="w-4 h-4 fill-current ml-0.5" />
              </span>
            </div>
            <p className="text-[13.5px] font-bold text-foreground truncate mt-2.5">{list.title}</p>
            <p className="text-[11.5px] text-muted-foreground truncate">
              {list.kind === 'mood' ? `${list.songs.length} tracks · ${list.subtitle}` : list.subtitle}
            </p>
          </motion.button>
        ))}
      </div>
    </section>
  );
};

export default memo(HistoryPlaylistsSection);
