/**
 * "Your Artists" — the listener's real artists, ranked by real play counts from
 * device history, with real portraits when the enrichment cache has one and the
 * track's own artwork otherwise. No global listener counts, no invented rows.
 */
import { memo, useMemo } from 'react';
import { motion } from 'framer-motion';
import { useQuery } from '@tanstack/react-query';
import { usePlayer } from '@/contexts/PlayerContext';
import { useLocalRecents } from '@/hooks/useLocalRecents';
import { useTasteProfile } from '@/hooks/useTasteProfile';
import { topArtistRows } from '@/lib/personalHome';
import { cachedArtistPortrait, enrichArtistImages } from '@/lib/musicIndexer';
import { triggerHaptic } from '@/hooks/useHaptics';
import OptimizedImage from './OptimizedImage';

const YourArtistsSection = () => {
  const { playSong } = usePlayer();
  const recents = useLocalRecents(100);
  const taste = useTasteProfile();

  const rows = useMemo(() => topArtistRows(recents, taste, 12), [recents, taste]);
  const names = useMemo(() => rows.map((r) => r.name), [rows]);

  const { data: portraits } = useQuery({
    queryKey: ['artist-portraits', 'your-artists', names.join('|')],
    enabled: names.length > 0,
    staleTime: 24 * 60 * 60 * 1000,
    queryFn: () => enrichArtistImages(names),
  });

  if (rows.length === 0) return null;

  return (
    <section>
      <h2 className="font-display text-[32px] leading-none uppercase text-foreground mb-1">
        Your Artists
      </h2>
      <p className="text-[12px] text-muted-foreground mb-4">Ranked by what you play most</p>

      <div className="divide-y divide-border/40">
        {rows.map((row, i) => {
          const image = portraits?.[row.name] ?? cachedArtistPortrait(row.name) ?? row.cover_url;
          return (
            <motion.button
              key={row.name.toLowerCase()}
              type="button"
              initial={{ opacity: 0, y: 8 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: Math.min(0.2, i * 0.03) }}
              onClick={() => {
                triggerHaptic('selection');
                playSong(row.songs[0], null, row.songs.slice(0, 50));
              }}
              className="flex items-center gap-3.5 w-full text-left py-2.5 active:opacity-60 transition-opacity"
            >
              <div className="w-12 h-12 shrink-0 rounded-full overflow-hidden bg-muted">
                <OptimizedImage src={image} alt={row.name} className="w-full h-full" />
              </div>
              <div className="min-w-0 flex-1">
                <p className="text-[14px] font-semibold text-foreground truncate">{row.name}</p>
                <p className="text-[12px] text-muted-foreground truncate mt-0.5">
                  You played {row.plays} song{row.plays === 1 ? '' : 's'}
                </p>
              </div>
            </motion.button>
          );
        })}
      </div>
    </section>
  );
};

export default memo(YourArtistsSection);
