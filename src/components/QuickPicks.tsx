import { memo, useMemo } from 'react';
import { Play, Pause } from 'lucide-react';
import { Song, usePlayer } from '@/contexts/PlayerContext';
import { triggerHaptic } from '@/hooks/useHaptics';
import { songFingerprint } from '@/lib/railQuality';
import OptimizedImage from './OptimizedImage';

/** Swipeable 4-row columns of the listener's own picks (no extra fetches). */
const QuickPicks = ({ songs, title = 'Quick picks', subtitle }: { songs: Song[]; title?: string; subtitle?: string }) => {
  const { currentSong, isPlaying, playSong, togglePlay } = usePlayer();
  const picks = useMemo(() => songs.slice(1, 17), [songs]);
  const columns = useMemo(() => {
    const out: Song[][] = [];
    for (let i = 0; i < picks.length; i += 4) out.push(picks.slice(i, i + 4));
    return out;
  }, [picks]);
  if (picks.length < 4) return null;

  return (
    <section className="mt-8">
      <div className="px-6 flex items-end justify-between">
        <div>
          <p className="text-[10px] font-bold uppercase tracking-[0.24em] text-primary">For you</p>
          <h2 className="font-display text-[24px] leading-none uppercase mt-1">{title}</h2>
          {subtitle && <p className="text-[12px] text-muted-foreground mt-1">{subtitle}</p>}
        </div>
        <button
          onClick={() => { triggerHaptic('selection'); playSong(picks[0], null, picks); }}
          className="rounded-full border border-border/70 px-3.5 py-1.5 text-[12px] font-semibold active:scale-95 transition-transform"
        >
          Play all
        </button>
      </div>
      <div className="mt-4 overflow-x-auto hide-scrollbar snap-x snap-mandatory" style={{ WebkitOverflowScrolling: 'touch' }}>
        <div className="flex gap-4 px-6">
          {columns.map((col, c) => (
            <div key={c} className="snap-start shrink-0 w-[82%] space-y-1">
              {col.map((song, r) => {
                const active = currentSong?.id === song.id;
                const idx = c * 4 + r;
                return (
                  <button
                    key={songFingerprint(song)}
                    onClick={() => {
                      triggerHaptic('selection');
                      if (active) togglePlay();
                      else playSong(song, null, [...picks.slice(idx), ...picks.slice(0, idx)]);
                    }}
                    className={`group flex items-center gap-3 w-full text-left rounded-[14px] p-1.5 transition-colors active:bg-muted/40 ${active ? 'bg-primary/10' : ''}`}
                  >
                    <div className="relative w-[52px] h-[52px] shrink-0 rounded-[10px] overflow-hidden bg-muted">
                      <OptimizedImage src={song.cover_url} alt={song.title} className="w-full h-full" />
                      {active && (
                        <span className="absolute inset-0 grid place-items-center bg-background/50">
                          {isPlaying ? <Pause className="w-4 h-4 text-primary fill-current" /> : <Play className="w-4 h-4 text-primary fill-current" />}
                        </span>
                      )}
                    </div>
                    <div className="min-w-0 flex-1">
                      <p className={`text-[14px] font-semibold truncate leading-tight ${active ? 'text-primary' : 'text-foreground'}`}>{song.title}</p>
                      <p className="text-[12px] text-muted-foreground truncate mt-0.5">{song.artist}</p>
                    </div>
                  </button>
                );
              })}
            </div>
          ))}
        </div>
      </div>
    </section>
  );
};

export default memo(QuickPicks);
