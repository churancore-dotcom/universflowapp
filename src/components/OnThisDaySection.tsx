import { useEffect, useState } from 'react';
import { motion } from 'framer-motion';
import { Search, Clock3 } from 'lucide-react';
import { useNavigate } from '@/lib/router-compat';
import { useAuth } from '@/contexts/AuthContext';
import { findMemory, loadPlayRecords, type Memory } from '@/lib/listeningInsights';
import OptimizedImage from '@/components/OptimizedImage';
import { triggerHaptic } from '@/hooks/useHaptics';

/**
 * "On this day" — a real track the listener was genuinely playing a month or a
 * year ago. Renders nothing when that window has no history.
 */
const OnThisDaySection = () => {
  const { user } = useAuth();
  const navigate = useNavigate();
  const [memory, setMemory] = useState<Memory | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const records = await loadPlayRecords(user?.id ?? null);
        if (!cancelled) setMemory(findMemory(records));
      } catch {
        /* silent — this is an enhancement, never a blocker */
      }
    })();
    return () => { cancelled = true; };
  }, [user?.id]);

  if (!memory) return null;

  const { record, plays, scale, headline } = memory;
  const line =
    plays >= 4
      ? `You were obsessed with this ${scale === 'year' ? 'a year ago' : 'last month'} — ${plays} plays.`
      : `This was on repeat ${scale === 'year' ? 'a year ago' : 'last month'}.`;

  const open = () => {
    triggerHaptic('selection');
    navigate(`/search?q=${encodeURIComponent(`${record.title} ${record.artist}`.trim())}`);
  };

  return (
    <motion.section
      initial={{ opacity: 0, y: 16 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ type: 'spring', stiffness: 130, damping: 20 }}
    >
      <h3 className="text-[13px] font-bold uppercase tracking-[0.18em] text-muted-foreground/70 mb-4 flex items-center gap-2">
        <Clock3 className="w-3.5 h-3.5" /> {headline}
      </h3>
      <button
        onClick={open}
        className="w-full text-left rounded-[28px] overflow-hidden bg-card border border-border/50 active:opacity-80 transition-opacity"
      >
        <div className="flex items-center gap-4 p-4">
          <div className="w-[76px] h-[76px] shrink-0 rounded-[14px] overflow-hidden bg-muted">
            <OptimizedImage src={record.cover || undefined} alt={record.title} className="w-full h-full object-cover" />
          </div>
          <div className="min-w-0 flex-1">
            <p className="text-[10.5px] font-bold uppercase tracking-[0.2em] text-primary">Memory</p>
            <p className="font-display text-[20px] leading-tight uppercase text-foreground line-clamp-2 mt-1">
              {record.title}
            </p>
            <p className="text-[12px] text-muted-foreground truncate mt-0.5">{record.artist}</p>
            <p className="text-[11.5px] text-muted-foreground/80 mt-1.5">{line}</p>
          </div>
          <Search className="w-4 h-4 shrink-0 text-muted-foreground" />
        </div>
      </button>
    </motion.section>
  );
};

export default OnThisDaySection;
