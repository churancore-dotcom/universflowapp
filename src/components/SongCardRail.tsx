import { memo } from 'react';
import { Play } from 'lucide-react';
import { Song, usePlayer } from '@/contexts/PlayerContext';
import { triggerHaptic } from '@/hooks/useHaptics';
import { songFingerprint } from '@/lib/railQuality';
import OptimizedImage from './OptimizedImage';

/** Horizontal rail of square song cards. Hides itself when it has too few songs. */
const SongCardRail = ({ title, eyebrow, songs, size = 'md' }: { title: string; eyebrow?: string; songs: Song[]; size?: 'md' | 'lg' }) => {
  const { playSong } = usePlayer();
  if (songs.length < 4) return null;
  const w = size === 'lg' ? 'w-[200px]' : 'w-[148px]';
  return (
    <section className="mt-10 relative z-10">
      <div className="px-6 flex items-end justify-between">
        <div className="min-w-0">
          {eyebrow && <p className="text-[10px] font-bold uppercase tracking-[0.24em] text-primary">{eyebrow}</p>}
          <h2 className="font-display text-[22px] leading-none uppercase mt-1 truncate">{title}</h2>
        </div>
        <button
          onClick={() => { triggerHaptic('selection'); playSong(songs[0], null, songs); }}
          className="shrink-0 rounded-full border border-border/70 px-3.5 py-1.5 text-[12px] font-semibold active:scale-95 transition-transform"
        >
          Play all
        </button>
      </div>
      <div className="mt-4 overflow-x-auto hide-scrollbar" style={{ WebkitOverflowScrolling: 'touch' }}>
        <div className="flex gap-3.5 px-6">
          {songs.slice(0, 12).map((song, i) => (
            <button
              key={songFingerprint(song)}
              onClick={() => { triggerHaptic('selection'); playSong(song, null, [...songs.slice(i), ...songs.slice(0, i)]); }}
              className={`${w} shrink-0 text-left active:scale-[0.97] transition-transform`}
            >
              <div className="relative aspect-square rounded-[18px] overflow-hidden bg-muted">
                <OptimizedImage src={song.cover_url} alt={song.title} className="w-full h-full" />
                <span className="absolute right-2 bottom-2 w-8 h-8 rounded-full bg-primary text-primary-foreground grid place-items-center shadow-lg">
                  <Play className="w-3.5 h-3.5 ml-0.5" fill="currentColor" />
                </span>
              </div>
              <p className="mt-2 text-[13px] font-semibold truncate">{song.title}</p>
              <p className="text-[12px] text-muted-foreground truncate">{song.artist}</p>
            </button>
          ))}
        </div>
      </div>
    </section>
  );
};
export default memo(SongCardRail);
