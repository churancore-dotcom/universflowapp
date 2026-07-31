import { memo, useCallback, useEffect, useMemo, useState, type ComponentType } from 'react';
import { createPortal } from 'react-dom';
import { AnimatePresence, motion } from 'framer-motion';
import {
  AudioLines,
  BadgeCheck,
  Building2,
  Car,
  Church,
  Disc3,
  Drum,
  Dumbbell,
  Flame,
  Gamepad2,
  Guitar,
  Headphones,
  Home,
  Mic2,
  MicOff,
  Moon,
  Music2,
  Piano,
  Podcast,
  Radio,
  RotateCcw,
  SlidersHorizontal,
  Speaker,
  Trophy,
  VolumeX,
  Wand2,
  Waves,
  X,
  Zap,
} from 'lucide-react';
import { toast } from 'sonner';

import { Slider } from '@/components/ui/slider';
import { Switch } from '@/components/ui/switch';
import { usePlayer } from '@/contexts/PlayerContext';
import { iosSpring } from '@/lib/animations';
import { resume as engineResume, type StudioSpaceId } from '@/lib/audioEngine';
import { getEQSettings, isEqActive, setEQSettings, useEQSettings, type EQSettings } from '@/lib/eqSettings';
import { isNativePlayerAvailable } from '@/lib/nativePlayer';
import { cn } from '@/lib/utils';
import { useEngineState } from '@/hooks/useGlobalAudioEngine';
import { usePremium } from '@/hooks/usePremium';

interface EqualizerModalProps {
  isOpen: boolean;
  onClose: () => void;
}

type EqView = 'smart' | 'stems' | 'manual' | 'space';

interface EQBand {
  frequency: number;
  label: string;
  gain: number;
}

interface Preset {
  id: string;
  name: string;
  icon: ComponentType<{ className?: string }>;
  bands: number[];
  bassBoost: number;
  reverb?: number;
  spatialAudio?: boolean;
  studioSpace?: StudioSpaceId;
  lateNight?: boolean;
  headphoneSurround?: boolean;
}

interface StudioSpace {
  id: StudioSpaceId;
  name: string;
  icon: ComponentType<{ className?: string }>;
  desc: string;
}

const BAND_DEFS: Array<Omit<EQBand, 'gain'>> = [
  { frequency: 32, label: '32' },
  { frequency: 64, label: '64' },
  { frequency: 125, label: '125' },
  { frequency: 250, label: '250' },
  { frequency: 500, label: '500' },
  { frequency: 1000, label: '1k' },
  { frequency: 2000, label: '2k' },
  { frequency: 4000, label: '4k' },
  { frequency: 8000, label: '8k' },
  { frequency: 16000, label: '16k' },
];

const PRESETS: Preset[] = [
  { id: 'auto', name: 'Auto', icon: Wand2, bands: [0, 0, 0, 0, 0, 0, 0, 0, 0, 0], bassBoost: 0 },
  { id: 'flat', name: 'Clean', icon: Music2, bands: [0, 0, 0, 0, 0, 0, 0, 0, 0, 0], bassBoost: 0 },
  { id: 'punch', name: 'Punch', icon: Zap, bands: [4, 4, 2, 0, -1, -1, 0, 1, 2, 2], bassBoost: 44 },
  { id: 'deep-bass', name: 'Deep Bass', icon: Flame, bands: [7, 6, 4, 2, 0, -1, -1, -1, -2, -2], bassBoost: 72 },
  { id: 'vocal', name: 'Vocal', icon: Mic2, bands: [-3, -2, -1, 1, 3, 5, 4, 2, 0, -1], bassBoost: 0 },
  { id: 'crystal', name: 'Crystal', icon: Disc3, bands: [-2, -1, 0, 0, 1, 2, 4, 5, 4, 3], bassBoost: 0 },
  { id: 'bollywood', name: 'Bollywood', icon: Flame, bands: [3, 3, 2, 1, 1, 2, 3, 3, 2, 1], bassBoost: 24 },
  { id: 'punjabi', name: 'Punjabi', icon: Drum, bands: [6, 5, 3, 1, 0, 0, 1, 2, 3, 3], bassBoost: 52 },
  { id: 'hiphop', name: 'Hip-Hop', icon: Drum, bands: [6, 5, 2, 1, -1, -1, 1, 2, 3, 3], bassBoost: 48 },
  { id: 'edm', name: 'EDM', icon: Radio, bands: [6, 5, 2, 0, -2, 1, 1, 3, 5, 6], bassBoost: 44, spatialAudio: true },
  { id: 'rock', name: 'Rock', icon: Guitar, bands: [5, 4, 3, 1, -1, -1, 1, 3, 4, 4], bassBoost: 22 },
  { id: 'acoustic', name: 'Acoustic', icon: Guitar, bands: [4, 4, 3, 1, 2, 2, 3, 3, 2, 1], bassBoost: 8 },
  { id: 'lofi', name: 'Lo-Fi', icon: Disc3, bands: [4, 3, 2, 1, 0, -1, -3, -4, -5, -6], bassBoost: 24, reverb: 18 },
  { id: 'classical', name: 'Classical', icon: Piano, bands: [4, 3, 2, 0, 0, 0, -1, 0, 2, 3], bassBoost: 5, studioSpace: 'hall' },
  { id: 'workout', name: 'Workout', icon: Dumbbell, bands: [5, 5, 3, 1, 0, 1, 2, 3, 4, 4], bassBoost: 42 },
  { id: 'late-night', name: 'Late Night', icon: Moon, bands: [-3, -2, -1, 0, 2, 3, 2, 1, -1, -2], bassBoost: 8, lateNight: true },
  { id: 'car', name: 'Car', icon: Car, bands: [4, 3, 1, 0, -1, 1, 2, 3, 3, 2], bassBoost: 32 },
  { id: 'earbuds', name: 'Earbuds', icon: Headphones, bands: [3, 3, 1, 0, 0, 1, 2, 3, 2, 1], bassBoost: 24, headphoneSurround: true },
  { id: 'small-spkr', name: 'Speaker', icon: Speaker, bands: [-2, -1, 0, 2, 3, 3, 2, 1, 0, -1], bassBoost: 0 },
  { id: 'gaming', name: 'Gaming', icon: Gamepad2, bands: [3, 3, 1, 0, 1, 2, 3, 3, 3, 2], bassBoost: 26, spatialAudio: true, headphoneSurround: true },
  { id: 'podcast', name: 'Podcast', icon: Podcast, bands: [-4, -3, -1, 1, 3, 4, 3, 2, 0, -2], bassBoost: 0 },
];

const STUDIO_SPACES: StudioSpace[] = [
  { id: 'off', name: 'Off', icon: X, desc: 'Dry signal' },
  { id: 'vinyl', name: 'Vinyl', icon: Disc3, desc: 'Warm booth' },
  { id: 'studio', name: 'Studio', icon: Mic2, desc: 'Tight room' },
  { id: 'bedroom', name: 'Bedroom', icon: Home, desc: 'Close space' },
  { id: 'hall', name: 'Hall', icon: Building2, desc: 'Wide tails' },
  { id: 'cathedral', name: 'Cathedral', icon: Church, desc: 'Huge wash' },
  { id: 'stadium', name: 'Stadium', icon: Trophy, desc: 'Live scale' },
];

const VIEWS: Array<{ id: EqView; label: string; icon: ComponentType<{ className?: string }> }> = [
  { id: 'smart', label: 'Smart', icon: Wand2 },
  { id: 'stems', label: 'Stems', icon: MicOff },
  { id: 'manual', label: 'Bands', icon: SlidersHorizontal },
  { id: 'space', label: 'Space', icon: Waves },
];

const SPECTRUM_BARS = Array.from({ length: 22 }, (_, i) => i);

const NEUTRAL_PATCH: Partial<EQSettings> = {
  bands: BAND_DEFS.map(() => 0),
  bassBoost: 0,
  reverb: 0,
  playbackSpeed: 1,
  spatialAudio: false,
  studioSpace: 'off',
  lateNight: false,
  headphoneSurround: false,
  vocalMix: 100,
  instrumentalMix: 100,
};

type StemMode = 'normal' | 'karaoke' | 'acappella' | 'custom';

const STEM_MODES: Array<{
  id: Exclude<StemMode, 'custom'>;
  name: string;
  desc: string;
  icon: ComponentType<{ className?: string }>;
  vocalMix: number;
  instrumentalMix: number;
}> = [
  { id: 'normal', name: 'Original', desc: 'Full mix, untouched', icon: AudioLines, vocalMix: 100, instrumentalMix: 100 },
  { id: 'karaoke', name: 'No vocals', desc: 'Beat stays, voice out', icon: MicOff, vocalMix: 0, instrumentalMix: 100 },
  { id: 'acappella', name: 'No beat', desc: 'Voice stays, music out', icon: Mic2, vocalMix: 100, instrumentalMix: 0 },
];

function detectStemMode(vocalMix: number, instrumentalMix: number): StemMode {
  if (vocalMix >= 100 && instrumentalMix >= 100) return 'normal';
  if (vocalMix === 0 && instrumentalMix >= 100) return 'karaoke';
  if (vocalMix >= 100 && instrumentalMix === 0) return 'acappella';
  return 'custom';
}

function pickAutoPreset(song: { title?: string; artist?: string; album?: string } | null): string {
  if (!song) return 'flat';
  const hay = `${song.title || ''} ${song.artist || ''} ${song.album || ''}`.toLowerCase();
  const has = (...words: string[]) => words.some((word) => hay.includes(word));
  if (has('punjabi', 'jatt', 'sidhu', 'diljit', 'karan aujla', 'ap dhillon', 'shubh')) return 'punjabi';
  if (has('bollywood', 'arijit', 'shreya', 'pritam', 'rahman', 'atif aslam')) return 'bollywood';
  if (has('edm', 'house', 'trance', 'techno', 'dubstep', 'dnb', 'martin garrix', 'calvin harris')) return 'edm';
  if (has('hip hop', 'hip-hop', 'rap', 'drake', 'kendrick', 'travis scott', 'eminem')) return 'hiphop';
  if (has('rock', 'metal', 'guitar', 'nirvana', 'linkin park')) return 'rock';
  if (has('lofi', 'lo-fi', 'chillhop')) return 'lofi';
  if (has('classical', 'orchestra', 'symphony', 'bach', 'mozart')) return 'classical';
  if (has('podcast', 'interview', 'talk')) return 'podcast';
  if (has('workout', 'gym', 'pump')) return 'workout';
  if (has('acoustic', 'unplugged')) return 'acoustic';
  return 'punch';
}

function formatSpeed(speed: number) {
  return `${Number(speed.toFixed(2))}×`;
}

const EqualizerModal = ({ isOpen, onClose }: EqualizerModalProps) => {
  const { currentSong } = usePlayer();
  const { isPremium, isLoading: premiumLoading } = usePremium();
  const engineMode = useEngineState();
  const settings = useEQSettings();
  const [view, setView] = useState<EqView>('smart');
  const [mounted, setMounted] = useState(false);
  const nativeAudio = isNativePlayerAvailable();
  const effectsActive = isEqActive(settings);
  const isConnected = engineMode === 'processed' || nativeAudio;
  const stemMode = detectStemMode(settings.vocalMix, settings.instrumentalMix);

  useEffect(() => setMounted(true), []);

  const bands = useMemo<EQBand[]>(
    () => BAND_DEFS.map((band, index) => ({ ...band, gain: settings.bands[index] ?? 0 })),
    [settings.bands],
  );

  const activePreset = useMemo(
    () => PRESETS.find((preset) => preset.id === settings.activePreset),
    [settings.activePreset],
  );

  const connectionLabel = !currentSong
    ? 'Play a song to hear changes'
    : isConnected
      ? nativeAudio ? 'Native studio engine live' : 'Studio engine live'
      : effectsActive
        ? engineMode === 'unsupported' ? 'Saved — this stream blocks effects' : 'Linking audio…'
        : 'Ready';

  useEffect(() => {
    if (!isOpen || premiumLoading || isPremium) return;
    toast.error('Equalizer is a Premium feature');
    onClose();
  }, [isOpen, premiumLoading, isPremium, onClose]);

  useEffect(() => {
    if (!isOpen || premiumLoading || !isPremium) return;
    engineResume();
    window.dispatchEvent(new CustomEvent('uf-eq-changed', { detail: getEQSettings() }));
  }, [isOpen, premiumLoading, isPremium]);

  const applyPreset = useCallback((preset: Preset) => {
    const target = preset.id === 'auto'
      ? PRESETS.find((item) => item.id === pickAutoPreset(currentSong)) || preset
      : preset;

    setEQSettings({
      bands: target.bands,
      bassBoost: target.bassBoost,
      reverb: target.reverb ?? 0,
      spatialAudio: !!target.spatialAudio,
      studioSpace: target.studioSpace ?? 'off',
      lateNight: !!target.lateNight,
      headphoneSurround: !!target.headphoneSurround,
      playbackSpeed: 1,
      activePreset: preset.id === 'auto' ? 'auto' : target.id,
    });
  }, [currentSong]);

  const setBand = useCallback((index: number, value: number) => {
    setEQSettings((previous) => ({
      bands: previous.bands.map((gain, bandIndex) => bandIndex === index ? value : gain),
      activePreset: 'custom',
    }));
  }, []);

  const reset = useCallback(() => {
    setEQSettings({ ...NEUTRAL_PATCH, activePreset: 'flat' });
    toast.success('Sound reset');
  }, []);

  const applyStemMode = useCallback((mode: typeof STEM_MODES[number]) => {
    setEQSettings({
      vocalMix: mode.vocalMix,
      instrumentalMix: mode.instrumentalMix,
      activePreset: 'custom',
    });
  }, []);

  if (!mounted || !isOpen || premiumLoading || !isPremium) return null;

  return createPortal(
    <AnimatePresence>
      <motion.div
        className="fixed inset-0 z-[120] flex items-end justify-center bg-background/70 backdrop-blur-2xl"
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0 }}
      >
        <button className="absolute inset-0 cursor-default" aria-label="Close equalizer" onClick={onClose} />

        <motion.section
          role="dialog"
          aria-modal="true"
          aria-label="Univers Flow Equalizer"
          className="relative mx-auto mb-0 flex max-h-[94dvh] w-full max-w-[520px] flex-col overflow-hidden rounded-t-[32px] border border-b-0 border-border/60 bg-card shadow-2xl sm:mb-4 sm:rounded-[32px] sm:border-b"
          initial={{ y: '100%' }}
          animate={{ y: 0 }}
          exit={{ y: '100%' }}
          transition={iosSpring}
        >
          {/* ---------- Header ---------- */}
          <header className="relative overflow-hidden px-5 pb-5 pt-4">
            {currentSong?.cover_url && (
              <img
                src={currentSong.cover_url}
                alt=""
                aria-hidden="true"
                className="absolute inset-0 h-full w-full scale-125 object-cover opacity-30 blur-3xl saturate-200"
              />
            )}
            <div className="absolute inset-0 bg-gradient-to-b from-transparent to-card" aria-hidden="true" />

            <div className="relative z-10">
              <div className="mx-auto mb-4 h-1 w-10 rounded-full bg-foreground/25" />

              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <p className="flex items-center gap-1.5 text-[10px] font-bold uppercase tracking-[0.18em] text-primary">
                    <BadgeCheck className="h-3.5 w-3.5" />
                    Studio Sound
                  </p>
                  <h2 className="mt-1 font-display text-[32px] leading-none text-foreground">Equalizer</h2>
                </div>
                <div className="flex shrink-0 items-center gap-2">
                  <button
                    type="button"
                    onClick={reset}
                    aria-label="Reset sound"
                    className="grid h-10 w-10 place-items-center rounded-full bg-foreground/10 text-foreground transition active:scale-90"
                  >
                    <RotateCcw className="h-4 w-4" />
                  </button>
                  <button
                    type="button"
                    onClick={onClose}
                    aria-label="Close equalizer"
                    className="grid h-10 w-10 place-items-center rounded-full bg-primary text-primary-foreground transition active:scale-90"
                  >
                    <X className="h-5 w-5" />
                  </button>
                </div>
              </div>

              {/* now playing + live spectrum */}
              <div className="mt-4 flex items-center gap-3 rounded-3xl border border-border/50 bg-background/40 p-3">
                <div className="h-14 w-14 shrink-0 overflow-hidden rounded-2xl bg-muted">
                  {currentSong?.cover_url ? (
                    <img src={currentSong.cover_url} alt="" aria-hidden="true" className="h-full w-full object-cover" />
                  ) : (
                    <div className="grid h-full w-full place-items-center text-muted-foreground">
                      <Waves className="h-6 w-6" />
                    </div>
                  )}
                </div>
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-semibold text-foreground">
                    {currentSong?.title || 'Nothing playing'}
                  </p>
                  <p className="mt-0.5 flex items-center gap-1.5 truncate text-[11px] text-muted-foreground">
                    <span className={cn('h-1.5 w-1.5 shrink-0 rounded-full', isConnected ? 'bg-primary' : effectsActive ? 'bg-primary/50' : 'bg-muted-foreground')} />
                    {connectionLabel}
                  </p>
                </div>
                <div className="flex h-10 items-end gap-[3px]">
                  {SPECTRUM_BARS.slice(0, 12).map((item) => {
                    const band = bands[Math.min(bands.length - 1, Math.floor((item / 12) * bands.length))];
                    const height = 10 + Math.max(0, band.gain + 12) * 1.1 + (settings.bassBoost / 100) * 8;
                    return (
                      <motion.span
                        key={item}
                        className="w-[3px] rounded-full bg-primary"
                        animate={isConnected ? { height: [height * 0.55, height, height * 0.7] } : { height: height * 0.45 }}
                        transition={isConnected ? { duration: 0.8 + (item % 4) * 0.14, repeat: Infinity, ease: 'easeInOut' } : undefined}
                      />
                    );
                  })}
                </div>
              </div>
            </div>
          </header>

          {/* ---------- Tabs ---------- */}
          <div className="px-5">
            <div className="grid grid-cols-4 gap-1 rounded-2xl bg-secondary/70 p-1">
              {VIEWS.map((item) => {
                const Icon = item.icon;
                const selected = view === item.id;
                return (
                  <button
                    key={item.id}
                    type="button"
                    onClick={() => setView(item.id)}
                    className={cn(
                      'relative flex h-10 items-center justify-center gap-1.5 rounded-xl text-[11px] font-semibold transition',
                      selected ? 'text-primary-foreground' : 'text-muted-foreground active:scale-95',
                    )}
                  >
                    {selected && (
                      <motion.span
                        layoutId="eq-tab"
                        className="absolute inset-0 rounded-xl bg-primary"
                        transition={{ type: 'spring', stiffness: 480, damping: 38 }}
                      />
                    )}
                    <span className="relative flex items-center gap-1.5">
                      <Icon className="h-3.5 w-3.5" />
                      {item.label}
                    </span>
                  </button>
                );
              })}
            </div>
          </div>

          {/* ---------- Body ---------- */}
          <div className="hide-scrollbar flex-1 overflow-y-auto px-5 pb-8 pt-4">
            {view === 'smart' && (
              <div className="space-y-4">
                <SectionLabel title="Sound profile" value={activePreset?.name || 'Custom'} />
                <div className="grid grid-cols-3 gap-2">
                  {PRESETS.map((preset) => {
                    const Icon = preset.icon;
                    const selected = settings.activePreset === preset.id;
                    return (
                      <button
                        key={preset.id}
                        type="button"
                        onClick={() => applyPreset(preset)}
                        className={cn(
                          'flex h-[72px] flex-col items-center justify-center gap-1.5 rounded-2xl border text-[11px] font-semibold transition active:scale-95',
                          selected
                            ? 'border-primary bg-primary text-primary-foreground'
                            : 'border-border/60 bg-secondary/50 text-foreground',
                        )}
                      >
                        <Icon className="h-5 w-5" />
                        <span className="max-w-full truncate px-1">{preset.name}</span>
                      </button>
                    );
                  })}
                </div>

                <ControlSlider
                  icon={Zap}
                  label="Bass impact"
                  value={settings.bassBoost}
                  min={0}
                  max={100}
                  step={1}
                  display={`${settings.bassBoost}%`}
                  onChange={(value) => setEQSettings({ bassBoost: value, activePreset: 'custom' })}
                />
                <ControlSlider
                  icon={Waves}
                  label="Reverb"
                  value={settings.reverb}
                  min={0}
                  max={45}
                  step={1}
                  display={`${settings.reverb}%`}
                  onChange={(value) => setEQSettings({ reverb: value, studioSpace: 'off', activePreset: 'custom' })}
                />
                <ControlSlider
                  icon={Radio}
                  label="Speed"
                  value={Math.round(settings.playbackSpeed * 100)}
                  min={50}
                  max={200}
                  step={5}
                  display={formatSpeed(settings.playbackSpeed)}
                  onChange={(value) => setEQSettings({ playbackSpeed: value / 100, activePreset: 'custom' })}
                />
              </div>
            )}

            {view === 'stems' && (
              <div className="space-y-4">
                <SectionLabel
                  title="Vocal & beat isolation"
                  value={stemMode === 'custom' ? 'Custom' : STEM_MODES.find((m) => m.id === stemMode)?.name || ''}
                />

                <div className="grid grid-cols-3 gap-2">
                  {STEM_MODES.map((mode) => {
                    const Icon = mode.icon;
                    const selected = stemMode === mode.id;
                    return (
                      <button
                        key={mode.id}
                        type="button"
                        onClick={() => applyStemMode(mode)}
                        className={cn(
                          'flex h-[104px] flex-col items-center justify-center gap-2 rounded-3xl border px-2 text-center transition active:scale-95',
                          selected
                            ? 'border-primary bg-primary text-primary-foreground'
                            : 'border-border/60 bg-secondary/50 text-foreground',
                        )}
                      >
                        <Icon className="h-6 w-6" />
                        <span className="text-xs font-bold">{mode.name}</span>
                        <span className={cn('text-[10px] leading-tight', selected ? 'opacity-80' : 'text-muted-foreground')}>
                          {mode.desc}
                        </span>
                      </button>
                    );
                  })}
                </div>

                <ControlSlider
                  icon={Mic2}
                  label="Vocal level"
                  value={settings.vocalMix}
                  min={0}
                  max={100}
                  step={1}
                  display={settings.vocalMix === 0 ? 'Muted' : `${settings.vocalMix}%`}
                  onChange={(value) => setEQSettings({ vocalMix: value, activePreset: 'custom' })}
                />
                <ControlSlider
                  icon={Drum}
                  label="Beat & instruments"
                  value={settings.instrumentalMix}
                  min={0}
                  max={100}
                  step={1}
                  display={settings.instrumentalMix === 0 ? 'Muted' : `${settings.instrumentalMix}%`}
                  onChange={(value) => setEQSettings({ instrumentalMix: value, activePreset: 'custom' })}
                />

                <p className="rounded-2xl bg-secondary/40 px-4 py-3 text-[11px] leading-relaxed text-muted-foreground">
                  Isolation is instant and works on every stereo track. Studio-produced songs separate the
                  cleanest; heavily mono or live recordings keep more bleed.
                </p>
              </div>
            )}

            {view === 'manual' && (
              <div className="space-y-4">
                <SectionLabel title="10-band EQ" value="±12 dB" />
                <div className="rounded-3xl border border-border/60 bg-secondary/40 p-4">
                  <div className="mb-2 grid grid-cols-10 gap-1 text-center text-[9px] font-semibold text-primary">
                    {bands.map((band) => (
                      <span key={band.frequency}>{band.gain > 0 ? '+' : ''}{band.gain}</span>
                    ))}
                  </div>
                  <div className="grid h-44 grid-cols-10 gap-1">
                    {bands.map((band, index) => (
                      <div key={band.frequency} className="flex h-full items-center justify-center">
                        <Slider
                          orientation="vertical"
                          value={[band.gain]}
                          min={-12}
                          max={12}
                          step={1}
                          onValueChange={([value]) => setBand(index, value)}
                          aria-label={`${band.label} hertz`}
                          className="h-full [&_[role=slider]]:h-4 [&_[role=slider]]:w-4"
                        />
                      </div>
                    ))}
                  </div>
                  <div className="mt-2 grid grid-cols-10 gap-1 text-center text-[9px] text-muted-foreground">
                    {bands.map((band) => <span key={band.frequency}>{band.label}</span>)}
                  </div>
                </div>
                <div className="grid grid-cols-2 gap-2">
                  <button
                    type="button"
                    className="h-12 rounded-2xl border border-border/60 bg-secondary/50 text-sm font-semibold text-foreground transition active:scale-95"
                    onClick={() => setEQSettings({ bands: BAND_DEFS.map(() => 0), bassBoost: 0, activePreset: 'custom' })}
                  >
                    Flatten
                  </button>
                  <button
                    type="button"
                    className="h-12 rounded-2xl bg-primary text-sm font-semibold text-primary-foreground transition active:scale-95"
                    onClick={() => {
                      const autoPreset = PRESETS.find((preset) => preset.id === 'auto');
                      if (autoPreset) applyPreset(autoPreset);
                    }}
                  >
                    Auto tune
                  </button>
                </div>
              </div>
            )}

            {view === 'space' && (
              <div className="space-y-4">
                <SectionLabel title="Studio space" value={STUDIO_SPACES.find((s) => s.id === settings.studioSpace)?.name || 'Off'} />
                <div className="grid grid-cols-2 gap-2">
                  {STUDIO_SPACES.map((space) => {
                    const Icon = space.icon;
                    const selected = settings.studioSpace === space.id;
                    return (
                      <button
                        key={space.id}
                        type="button"
                        onClick={() => setEQSettings({ studioSpace: space.id, activePreset: 'custom' })}
                        className={cn(
                          'flex h-[68px] items-center gap-3 rounded-2xl border px-3 text-left transition active:scale-95',
                          selected
                            ? 'border-primary bg-primary text-primary-foreground'
                            : 'border-border/60 bg-secondary/50 text-foreground',
                        )}
                      >
                        <Icon className="h-5 w-5 shrink-0" />
                        <span className="min-w-0">
                          <span className="block truncate text-xs font-bold">{space.name}</span>
                          <span className={cn('block truncate text-[10px]', selected ? 'opacity-80' : 'text-muted-foreground')}>
                            {space.desc}
                          </span>
                        </span>
                      </button>
                    );
                  })}
                </div>

                <ToggleRow
                  icon={Headphones}
                  label="Headphone 3D"
                  desc="Binaural crossfeed for a wider stage."
                  checked={settings.headphoneSurround}
                  onCheckedChange={(value) => setEQSettings({ headphoneSurround: value, activePreset: 'custom' })}
                />
                <ToggleRow
                  icon={Waves}
                  label="8D movement"
                  desc="Slow stereo orbit with room cues."
                  checked={settings.spatialAudio}
                  onCheckedChange={(value) => setEQSettings({ spatialAudio: value, activePreset: 'custom' })}
                />
                <ToggleRow
                  icon={Moon}
                  label="Late night"
                  desc="Lifts quiet detail, tames loud peaks."
                  checked={settings.lateNight}
                  onCheckedChange={(value) => setEQSettings({ lateNight: value, activePreset: 'custom' })}
                />
              </div>
            )}
          </div>
        </motion.section>
      </motion.div>
    </AnimatePresence>,
    document.body,
  );
};

const SectionLabel = memo(({ title, value }: { title: string; value: string }) => (
  <div className="flex items-baseline justify-between gap-3">
    <h3 className="text-sm font-bold text-foreground">{title}</h3>
    <span className="shrink-0 text-[11px] font-semibold uppercase tracking-wide text-primary">{value}</span>
  </div>
));
SectionLabel.displayName = 'SectionLabel';

interface ControlSliderProps {
  icon: ComponentType<{ className?: string }>;
  label: string;
  value: number;
  min: number;
  max: number;
  step: number;
  display: string;
  onChange: (value: number) => void;
}

const ControlSlider = memo(({ icon: Icon, label, value, min, max, step, display, onChange }: ControlSliderProps) => (
  <div className="rounded-3xl border border-border/60 bg-secondary/40 p-4">
    <div className="mb-3 flex items-center justify-between gap-3">
      <div className="flex min-w-0 items-center gap-2">
        <Icon className="h-4 w-4 shrink-0 text-primary" />
        <span className="truncate text-sm font-semibold text-foreground">{label}</span>
      </div>
      <span className="shrink-0 text-xs font-bold text-primary">{display}</span>
    </div>
    <Slider
      value={[value]}
      min={min}
      max={max}
      step={step}
      aria-label={label}
      onValueChange={([next]) => onChange(next)}
      className="[&_[role=slider]]:h-5 [&_[role=slider]]:w-5"
    />
  </div>
));
ControlSlider.displayName = 'ControlSlider';

interface ToggleRowProps {
  icon: ComponentType<{ className?: string }>;
  label: string;
  desc: string;
  checked: boolean;
  onCheckedChange: (checked: boolean) => void;
}

const ToggleRow = memo(({ icon: Icon, label, desc, checked, onCheckedChange }: ToggleRowProps) => (
  <div className="flex items-center justify-between gap-4 rounded-3xl border border-border/60 bg-secondary/40 p-4">
    <div className="flex min-w-0 items-center gap-3">
      <div className={cn('grid h-11 w-11 shrink-0 place-items-center rounded-2xl', checked ? 'bg-primary text-primary-foreground' : 'bg-muted text-muted-foreground')}>
        <Icon className="h-5 w-5" />
      </div>
      <div className="min-w-0">
        <p className="truncate text-sm font-semibold text-foreground">{label}</p>
        <p className="mt-0.5 line-clamp-2 text-xs leading-snug text-muted-foreground">{desc}</p>
      </div>
    </div>
    <Switch checked={checked} onCheckedChange={onCheckedChange} />
  </div>
));
ToggleRow.displayName = 'ToggleRow';

export default EqualizerModal;
