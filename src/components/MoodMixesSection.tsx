import { memo } from 'react';
import { motion } from 'framer-motion';
import { useNavigate } from '@/lib/router-compat';
import { triggerHaptic } from '@/hooks/useHaptics';
import RailHeader from './RailHeader';

const MOODS: { label: string; query: string; hue: number }[] = [
  { label: 'Chill', query: 'chill songs', hue: 200 },
  { label: 'Romantic', query: 'romantic songs', hue: 350 },
  { label: 'Party', query: 'party songs', hue: 300 },
  { label: 'Workout', query: 'workout songs', hue: 25 },
  { label: 'Sad', query: 'sad songs', hue: 240 },
  { label: 'Focus', query: 'focus music', hue: 160 },
  { label: 'Punjabi', query: 'punjabi hits', hue: 45 },
  { label: 'Lo-fi', query: 'lofi songs', hue: 270 },
  { label: 'Bollywood', query: 'bollywood hits', hue: 10 },
  { label: 'Devotional', query: 'devotional songs', hue: 60 },
];

const MoodMixesSection = memo(() => {
  const navigate = useNavigate();
  return (
    <section>
      <RailHeader title="Moods & Genres" subtitle="Tap a vibe, start listening" />
      <div className="-mx-6 px-6 overflow-x-auto hide-scrollbar">
        <div className="grid grid-rows-2 grid-flow-col auto-cols-[38%] gap-2.5 pr-6">
          {MOODS.map((m) => (
            <motion.button
              key={m.label}
              whileTap={{ scale: 0.95 }}
              onClick={() => { triggerHaptic('selection'); navigate(`/search?q=${encodeURIComponent(m.query)}`); }}
              className="h-16 rounded-xl px-3 text-left font-bold text-[15px] text-foreground border border-border/40 overflow-hidden"
              style={{ background: `linear-gradient(135deg, oklch(0.45 0.14 ${m.hue}), oklch(0.22 0.06 ${m.hue}))` }}
            >
              {m.label}
            </motion.button>
          ))}
        </div>
      </div>
    </section>
  );
});

MoodMixesSection.displayName = 'MoodMixesSection';
export default MoodMixesSection;
