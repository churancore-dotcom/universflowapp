/**
 * Stem Lab — live stem control: vocals, backing, shine, width.
 * Premium-gated; per-song remixes are remembered and re-applied automatically.
 */
import { useEffect, useMemo } from 'react';
import { motion } from 'framer-motion';
import { ArrowLeft, Crown, RotateCcw, BookmarkCheck, BookmarkPlus, AudioLines } from 'lucide-react';
import { useNavigate } from '@/lib/router-compat';
import { usePremium } from '@/hooks/usePremium';
import { usePlayer } from '@/contexts/PlayerContext';
import { useStemLab } from '@/hooks/useStemLab';
import {
  STEM_PRESETS,
  STEM_LIMITS,
  StemPreset,
  describeMix,
  isDefaultMix,
  mixEquals,
  getRemixForSong,
} from '@/lib/stemLab';
import { triggerHaptic } from '@/hooks/useHaptics';
import { toast } from 'sonner';
import OptimizedImage from '@/components/OptimizedImage';

interface FaderProps {
  label: string;
  emoji: string;
  value: number;
  min: number;
  max: number;
  neutral: number;
  onChange: (v: number) => void;
}

const Fader = ({ label, emoji, value, min, max, neutral, onChange }: FaderProps) => (
  <div className="rounded-2xl bg-card/70 p-3 ring-1 ring-border/40">
    <div className="mb-2 flex items-center justify-between">
      <span className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
        {emoji} {label}
      </span>
      <span className={`text-[11px] font-bold tabular-nums ${value === neutral ? 'text-muted-foreground' : 'text-primary'}`}>
        {value}%
      </span>
    </div>
    <input
      type="range"
      min={min}
      max={max}
      value={value}
      aria-label={label}
      onChange={(e) => onChange(Number(e.target.value))}
      onDoubleClick={() => onChange(neutral)}
      className="w-full accent-primary"
    />
  </div>
);

const StemLab = () => {
  const navigate = useNavigate();
  const { isPremium, isLoading: premiumLoading } = usePremium();
  const { currentSong } = usePlayer();
  const { mix, setMix, reset, handleSongChange, saveRemix, removeRemix } = useStemLab();

  const songId = currentSong?.id ?? null;
  const songHasRemix = useMemo(() => (songId ? getRemixForSong(songId) !== null : false), [songId, mix]);

  // Auto-apply a saved remix whenever the playing song changes.
  useEffect(() => {
    handleSongChange(songId);
  }, [songId, handleSongChange]);

  const applyPreset = (preset: StemPreset) => {
    triggerHaptic();
    setMix(preset.mix);
  };

  const toggleRemix = () => {
    if (!songId) return;
    triggerHaptic();
    if (songHasRemix) {
      removeRemix(songId);
      toast.success('Remix removed — this song plays original again');
    } else {
      saveRemix(songId);
      toast.success('Remix saved — this song always plays your mix');
    }
    // Force memo refresh
    setMix({});
  };

  return (
    <div className="min-h-[100dvh] pb-36">
      <header className="sticky top-0 z-20 flex items-center gap-3 bg-background/85 px-5 py-4 backdrop-blur-xl">
        <button onClick={() => navigate(-1)} aria-label="Back" className="rounded-full bg-foreground/10 p-2">
          <ArrowLeft className="h-4 w-4" />
        </button>
        <h1 className="text-[17px] font-bold">Stem Lab</h1>
        {!isDefaultMix(mix) && (
          <span className="ml-auto rounded-full bg-primary/15 px-2.5 py-1 text-[10px] font-bold text-primary">
            {describeMix(mix)}
          </span>
        )}
      </header>

      <div className="px-5">
        <div
          className="mb-5 rounded-3xl border border-primary/30 p-5"
          style={{
            background:
              'linear-gradient(150deg, hsl(var(--primary) / 0.22), hsl(var(--card)) 60%, hsl(var(--accent) / 0.16))',
          }}
        >
          <p className="mb-1 flex items-center gap-1.5 text-[10px] font-bold uppercase tracking-[0.2em] text-primary">
            <AudioLines className="h-3 w-3" /> Premium
          </p>
          <h2 className="text-[22px] font-bold leading-tight">One song. Your mix.</h2>
          <p className="mt-1 text-[12.5px] text-muted-foreground">
            Pull the vocal down and it's karaoke. Strip the band and it's a cappella.
            Save your mix per song and it plays that way forever.
          </p>

          {premiumLoading ? null : !isPremium ? (
            <button
              onClick={() => navigate('/premium')}
              className="mt-4 flex w-full items-center justify-center gap-2 rounded-2xl bg-primary py-3 text-sm font-semibold text-primary-foreground"
            >
              <Crown className="h-4 w-4" /> Unlock Stem Lab
            </button>
          ) : null}
        </div>

        {isPremium && (
          <motion.div initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }}>
            {currentSong && (
              <div className="mb-4 flex items-center gap-3 rounded-2xl bg-card/70 p-3 ring-1 ring-border/40">
                <OptimizedImage
                  src={currentSong.cover_url || '/placeholder.svg'}
                  alt={currentSong.title}
                  className="h-11 w-11 rounded-xl object-cover"
                />
                <div className="min-w-0 flex-1">
                  <p className="truncate text-[13px] font-semibold">{currentSong.title}</p>
                  <p className="truncate text-[11px] text-muted-foreground">{currentSong.artist}</p>
                </div>
                <button
                  onClick={toggleRemix}
                  className={`flex items-center gap-1.5 rounded-full px-3 py-1.5 text-[11px] font-semibold ${
                    songHasRemix ? 'bg-primary/15 text-primary' : 'bg-foreground/10'
                  }`}
                >
                  {songHasRemix ? <BookmarkCheck className="h-3.5 w-3.5" /> : <BookmarkPlus className="h-3.5 w-3.5" />}
                  {songHasRemix ? 'Remixed' : 'Save remix'}
                </button>
              </div>
            )}

            <p className="mb-2 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">Presets</p>
            <div className="mb-5 grid grid-cols-2 gap-2">
              {STEM_PRESETS.map((p) => {
                const active = mixEquals(p.mix, mix);
                return (
                  <button
                    key={p.id}
                    onClick={() => applyPreset(p)}
                    className={`rounded-2xl p-3 text-left ring-1 transition ${
                      active ? 'bg-primary/15 ring-primary/50' : 'bg-card/70 ring-border/40'
                    }`}
                  >
                    <p className="text-[13px] font-semibold">
                      {p.emoji} {p.name}
                    </p>
                    <p className="mt-0.5 text-[10.5px] leading-snug text-muted-foreground">{p.blurb}</p>
                  </button>
                );
              })}
            </div>

            <div className="mb-4 flex items-center justify-between">
              <p className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">Faders</p>
              <button
                onClick={() => { triggerHaptic(); reset(); }}
                className="flex items-center gap-1 rounded-full bg-foreground/10 px-2.5 py-1 text-[10.5px] font-semibold"
              >
                <RotateCcw className="h-3 w-3" /> Reset
              </button>
            </div>
            <div className="grid grid-cols-1 gap-2">
              <Fader label="Vocals" emoji="🎤" value={mix.vocals} min={STEM_LIMITS.vocals.min} max={STEM_LIMITS.vocals.max} neutral={100}
                onChange={(v) => setMix({ vocals: v })} />
              <Fader label="Backing" emoji="🎹" value={mix.backing} min={STEM_LIMITS.backing.min} max={STEM_LIMITS.backing.max} neutral={100}
                onChange={(v) => setMix({ backing: v })} />
              <Fader label="Shine" emoji="✨" value={mix.shine} min={STEM_LIMITS.shine.min} max={STEM_LIMITS.shine.max} neutral={0}
                onChange={(v) => setMix({ shine: v })} />
              <Fader label="Width" emoji="🎚️" value={mix.width} min={STEM_LIMITS.width.min} max={STEM_LIMITS.width.max} neutral={50}
                onChange={(v) => setMix({ width: v })} />
            </div>
            <p className="mt-3 text-center text-[10.5px] text-muted-foreground">
              Double-tap a fader to snap it back. Everything applies live to what's playing.
            </p>
          </motion.div>
        )}
      </div>
    </div>
  );
};

export default StemLab;
