import { memo, useCallback, useEffect, useMemo, useState, type ComponentType } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import {
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
  Volume2,
  VolumeX,
  Wand2,
  Waves,
  X,
  Zap,
} from 'lucide-react';
import { toast } from 'sonner';

import { Button } from '@/components/ui/button';
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
  { id: 'manual', label: '10-Band', icon: SlidersHorizontal },
  { id: 'space', label: 'Space', icon: Waves },
];

const SPECTRUM_BARS = Array.from({ length: 18 }, (_, i) => i);

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

function pctLabel(value: number, zeroLabel: string) {
  return value <= 0 ? zeroLabel : `${value}%`;
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
  const nativeAudio = isNativePlayerAvailable();
  const effectsActive = isEqActive(settings);
  const isConnected = engineMode === 'processed' || nativeAudio;

  const bands = useMemo<EQBand[]>(
    () => BAND_DEFS.map((band, index) => ({ ...band, gain: settings.bands[index] ?? 0 })),
    [settings.bands],
  );

  const activePreset = useMemo(
    () => PRESETS.find((preset) => preset.id === settings.activePreset),
    [settings.activePreset],
  );

  const connectionLabel = !currentSong
    ? 'Play a song first'
    : isConnected
      ? nativeAudio ? 'APK native EQ live' : 'Web EQ live'
      : effectsActive
        ? engineMode === 'unsupported' ? 'Saved · stream blocks effects' : 'Connecting audio chain'
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
    toast.success(preset.id === 'auto' ? `Auto tuned · ${target.name}` : `${target.name} applied`);
  }, [currentSong]);

  const setBand = useCallback((index: number, value: number) => {
    setEQSettings((previous) => ({
      bands: previous.bands.map((gain, bandIndex) => bandIndex === index ? value : gain),
      activePreset: 'custom',
    }));
  }, []);

  const reset = useCallback(() => {
    setEQSettings({ ...NEUTRAL_PATCH, activePreset: 'flat' });
    toast.success('EQ reset');
  }, []);

  const applyKaraoke = useCallback(() => {
    setEQSettings({ vocalMix: 0, instrumentalMix: 100, activePreset: 'custom' });
    setView('stems');
    toast.success('Vocals removed');
  }, []);

  const applyAcappella = useCallback(() => {
    setEQSettings({ vocalMix: 100, instrumentalMix: 0, activePreset: 'custom' });
    setView('stems');
    toast.success('Beat removed');
  }, []);

  if (!isOpen || premiumLoading || !isPremium) return null;

  return (
    <AnimatePresence>
      <motion.div
        className="fixed inset-0 z-[100] flex items-end justify-center bg-background/80 backdrop-blur-2xl"
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0 }}
      >
        <button className="absolute inset-0 cursor-default" aria-label="Close equalizer" onClick={onClose} />

        <motion.section
          role="dialog"
          aria-modal="true"
          aria-label="Univers Flow Equalizer"
          className="relative mx-3 mb-3 flex max-h-[92dvh] w-full max-w-[520px] flex-col overflow-hidden rounded-[28px] border border-border bg-card shadow-2xl"
          initial={{ y: '100%', opacity: 0 }}
          animate={{ y: 0, opacity: 1 }}
          exit={{ y: '100%', opacity: 0 }}
          transition={iosSpring}
        >
          <div className="relative overflow-hidden border-b border-border bg-secondary/40 px-5 pb-4 pt-5">
            {currentSong?.cover_url && (
              <img
                src={currentSong.cover_url}
                alt=""
                aria-hidden="true"
                className="absolute inset-0 h-full w-full object-cover opacity-25 blur-3xl saturate-150"
              />
            )}
            <div className="relative z-10">
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <div className="mb-2 flex items-center gap-2 text-[10px] font-bold uppercase text-primary">
                    <BadgeCheck className="h-3.5 w-3.5" />
                    Studio Sound
                  </div>
                  <h2 className="font-display text-[34px] leading-none text-foreground">Equalizer</h2>
                  <p className="mt-1 flex items-center gap-2 truncate text-xs text-muted-foreground">
                    <span className={cn('h-2 w-2 rounded-full', isConnected ? 'bg-primary' : effectsActive ? 'bg-primary/60' : 'bg-muted-foreground')} />
                    {connectionLabel}
                  </p>
                </div>
                <div className="flex shrink-0 items-center gap-2">
                  <Button size="icon" variant="secondary" className="h-10 w-10 rounded-full" onClick={reset} aria-label="Reset equalizer">
                    <RotateCcw className="h-4 w-4" />
                  </Button>
                  <Button size="icon" className="h-10 w-10 rounded-full" onClick={onClose} aria-label="Close equalizer">
                    <X className="h-5 w-5" />
                  </Button>
                </div>
              </div>

              <div className="mt-5 grid grid-cols-[88px_1fr] items-end gap-4">
                <div className="aspect-square overflow-hidden rounded-2xl bg-muted">
                  {currentSong?.cover_url ? (
                    <img src={currentSong.cover_url} alt="" aria-hidden="true" className="h-full w-full object-cover" />
                  ) : (
                    <div className="grid h-full w-full place-items-center text-muted-foreground">
                      <Waves className="h-8 w-8" />
                    </div>
                  )}
                </div>
                <div className="min-w-0">
                  <p className="truncate text-sm font-semibold text-foreground">{currentSong?.title || activePreset?.name || 'No song playing'}</p>
                  <p className="mt-0.5 truncate text-xs text-muted-foreground">{currentSong?.artist || 'Choose a track to hear changes live'}</p>
                  <div className="mt-4 flex h-12 items-end gap-1">
                    {SPECTRUM_BARS.map((item) => {
                      const band = bands[Math.min(bands.length - 1, Math.floor((item / SPECTRUM_BARS.length) * bands.length))];
                      const height = 18 + Math.max(0, band.gain + 12) * 1.35 + (settings.bassBoost / 100) * 10;
                      return (
                        <motion.span
                          key={item}
                          className="flex-1 rounded-full bg-primary"
                          animate={isConnected ? { height: [height * 0.65, height, height * 0.78] } : { height: height * 0.5 }}
                          transition={isConnected ? { duration: 0.9 + (item % 4) * 0.12, repeat: Infinity, ease: 'easeInOut' } : undefined}
                        />
                      );
                    })}
                  </div>
                </div>
              </div>

              <div className="mt-5 grid grid-cols-2 gap-2">
                <Button className="h-12 rounded-2xl" onClick={applyKaraoke}>
                  <MicOff className="h-4 w-4" />
                  Karaoke
                </Button>
                <Button className="h-12 rounded-2xl" variant="secondary" onClick={applyAcappella}>
                  <VolumeX className="h-4 w-4" />
                  Remove beat
                </Button>
              </div>
            </div>
          </div>

          <div className="border-b border-border bg-card px-4 py-3">
            <div className="grid grid-cols-4 gap-2 rounded-2xl bg-secondary p-1">
              {VIEWS.map((item) => {
                const Icon = item.icon;
                const selected = view === item.id;
                return (
                  <Button
                    key={item.id}
                    type="button"
                    variant={selected ? 'default' : 'ghost'}
                    className="h-10 rounded-xl px-1 text-[11px]"
                    onClick={() => setView(item.id)}
                  >
                    <Icon className="h-3.5 w-3.5" />
                    <span className="hidden min-[390px]:inline">{item.label}</span>
                  </Button>
                );
              })}
            </div>
          </div>

          <div className="flex-1 overflow-y-auto px-5 py-5 hide-scrollbar">
            {view === 'smart' && (
              <div className="space-y-5">
                <div>
                  <div className="mb-3 flex items-end justify-between gap-3">
                    <div>
                      <h3 className="text-sm font-semibold text-foreground">Sound profiles</h3>
                      <p className="text-xs text-muted-foreground">Fewer buttons, stronger tuning.</p>
                    </div>
                    <span className="text-xs font-semibold text-primary">{activePreset?.name || 'Custom'}</span>
                  </div>
                  <div className="grid grid-cols-3 gap-2">
                    {PRESETS.map((preset) => {
                      const Icon = preset.icon;
                      const selected = settings.activePreset === preset.id;
                      return (
                        <Button
                          key={preset.id}
                          type="button"
                          variant={selected ? 'default' : 'secondary'}
                          className="h-[70px] flex-col rounded-2xl px-2 text-xs"
                          onClick={() => applyPreset(preset)}
                        >
                          <Icon className="h-5 w-5" />
                          <span className="max-w-full truncate">{preset.name}</span>
                        </Button>
                      );
                    })}
                  </div>
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
              <div className="space-y-5">
                <div className="rounded-3xl border border-border bg-secondary/50 p-4">
                  <h3 className="text-sm font-semibold text-foreground">Instant stems</h3>
                  <p className="mt-1 text-xs leading-relaxed text-muted-foreground">Zero-wait mid/side isolation. Best on stereo songs; mono songs stay protected by the direct fallback.</p>
                </div>
                <ControlSlider
                  icon={MicOff}
                  label="Vocals"
                  value={settings.vocalMix}
                  min={0}
                  max={100}
                  step={1}
                  display={pctLabel(settings.vocalMix, 'Karaoke')}
                  onChange={(value) => setEQSettings({ vocalMix: value, activePreset: 'custom' })}
                />
                <ControlSlider
                  icon={VolumeX}
                  label="Instrumental"
                  value={settings.instrumentalMix}
                  min={0}
                  max={100}
                  step={1}
                  display={pctLabel(settings.instrumentalMix, 'A-cappella')}
                  onChange={(value) => setEQSettings({ instrumentalMix: value, activePreset: 'custom' })}
                />
                <div className="grid grid-cols-3 gap-2">
                  <Button className="h-12 rounded-2xl" onClick={applyKaraoke}>Karaoke</Button>
                  <Button className="h-12 rounded-2xl" variant="secondary" onClick={applyAcappella}>A-cappella</Button>
                  <Button
                    className="h-12 rounded-2xl"
                    variant="secondary"
                    onClick={() => setEQSettings({ vocalMix: 100, instrumentalMix: 100, activePreset: 'custom' })}
                  >
                    Normal
                  </Button>
                </div>
              </div>
            )}

            {view === 'manual' && (
              <div className="space-y-5">
                <div className="rounded-3xl border border-border bg-secondary/50 p-4">
                  <div className="mb-3 flex items-center justify-between">
                    <h3 className="text-sm font-semibold text-foreground">10-band EQ</h3>
                    <span className="text-xs text-muted-foreground">±12 dB</span>
                  </div>
                  <div className="mb-2 grid grid-cols-10 gap-1 text-center text-[9px] text-muted-foreground">
                    {bands.map((band) => <span key={band.frequency}>{band.gain > 0 ? '+' : ''}{band.gain}</span>)}
                  </div>
                  <div className="grid h-40 grid-cols-10 gap-1.5">
                    {bands.map((band, index) => (
                      <div key={band.frequency} className="flex h-full items-center justify-center">
                        <Slider
                          orientation="vertical"
                          value={[band.gain]}
                          min={-12}
                          max={12}
                          step={1}
                          onValueChange={([value]) => setBand(index, value)}
                          className="h-full [&_[data-radix-slider-range]]:bg-primary [&_[role=slider]]:h-4 [&_[role=slider]]:w-4"
                        />
                      </div>
                    ))}
                  </div>
                  <div className="mt-2 grid grid-cols-10 gap-1 text-center text-[9px] text-muted-foreground">
                    {bands.map((band) => <span key={band.frequency}>{band.label}</span>)}
                  </div>
                </div>
                <div className="grid grid-cols-2 gap-2">
                  <Button className="h-12 rounded-2xl" variant="secondary" onClick={() => setEQSettings({ bands: BAND_DEFS.map(() => 0), bassBoost: 0, activePreset: 'custom' })}>Flatten bands</Button>
                  <Button className="h-12 rounded-2xl" onClick={() => applyPreset(PRESETS.find((preset) => preset.id === 'auto') || PRESETS[0])}>Auto tune</Button>
                </div>
              </div>
            )}

            {view === 'space' && (
              <div className="space-y-5">
                <div className="grid grid-cols-2 gap-2">
                  {STUDIO_SPACES.map((space) => {
                    const Icon = space.icon;
                    const selected = settings.studioSpace === space.id;
                    return (
                      <Button
                        key={space.id}
                        type="button"
                        variant={selected ? 'default' : 'secondary'}
                        className="h-[74px] justify-start rounded-2xl px-3"
                        onClick={() => {
                          setEQSettings({ studioSpace: space.id, activePreset: 'custom' });
                          if (space.id !== 'off') toast.success(`${space.name} space applied`);
                        }}
                      >
                        <Icon className="h-5 w-5" />
                        <span className="min-w-0 text-left">
                          <span className="block truncate text-xs font-semibold">{space.name}</span>
                          <span className="block truncate text-[10px] opacity-70">{space.desc}</span>
                        </span>
                      </Button>
                    );
                  })}
                </div>

                <ToggleRow
                  icon={Headphones}
                  label="Headphone 3D"
                  desc="Binaural crossfeed for wider headphone sound."
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
                  desc="Lifts quiet detail and tames loud peaks."
                  checked={settings.lateNight}
                  onCheckedChange={(value) => setEQSettings({ lateNight: value, activePreset: 'custom' })}
                />
              </div>
            )}
          </div>
        </motion.section>
      </motion.div>
    </AnimatePresence>
  );
};

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
  <div className="rounded-3xl border border-border bg-secondary/50 p-4">
    <div className="mb-3 flex items-center justify-between gap-3">
      <div className="flex min-w-0 items-center gap-2">
        <Icon className="h-4 w-4 shrink-0 text-primary" />
        <span className="truncate text-sm font-semibold text-foreground">{label}</span>
      </div>
      <span className="shrink-0 text-xs font-semibold text-primary">{display}</span>
    </div>
    <Slider value={[value]} min={min} max={max} step={step} onValueChange={([next]) => onChange(next)} />
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
  <div className="flex items-center justify-between gap-4 rounded-3xl border border-border bg-secondary/50 p-4">
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