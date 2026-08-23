import { memo, useMemo } from 'react';
import { motion } from 'framer-motion';
import { usePlayer } from '@/contexts/PlayerContext';
import OptimizedImage from './OptimizedImage';
import RailHeader from './RailHeader';
import { triggerHaptic } from '@/hooks/useHaptics';
import { useLocalRecents } from '@/hooks/useLocalRecents';
import { jumpBackInGroups } from '@/lib/personalHome';

/** Albums/artist sets the listener was actually working through — resume them. */
const JumpBackInSection = memo(() => {
  const { playSong } = usePlayer();
  const entries = useLocalRecents(60);
  const groups = useMemo(() => jumpBackInGroups(entries).slice(0, 12), [entries]);

  if (groups.length < 2) return null;

  return (
    <section>
      <RailHeader title="Jump Back In" subtitle="Pick up where you left off" />
      <div className="flex gap-3 overflow-x-auto hide-scrollbar -mx-5 px-5 pb-1">
        {groups.map((group) => (
          <motion.button
            key={group.id}
            onClick={() => { triggerHaptic('selection'); playSong(group.songs[0], null, group.songs); }}
            whileTap={{ scale: 0.95 }}
            className="w-[152px] shrink-0 text-left"
          >
            <div className="w-[152px] h-[152px] rounded-[14px] overflow-hidden bg-muted border border-border/40">
              <OptimizedImage src={group.cover_url} alt={group.title} className="w-full h-full object-cover" />
            </div>
            <p className="mt-2 text-[13px] font-semibold text-foreground truncate">{group.title}</p>
            <p className="text-[11.5px] text-muted-foreground truncate">
              {group.subtitle} · {group.songs.length} tracks
            </p>
          </motion.button>
        ))}
      </div>
    </section>
  );
});

JumpBackInSection.displayName = 'JumpBackInSection';
export default JumpBackInSection;
