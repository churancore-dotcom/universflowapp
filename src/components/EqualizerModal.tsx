import { memo, useCallback, useEffect, useMemo, useState, type ComponentType } from 'react';
import { createPortal } from 'react-dom';
import { AnimatePresence, motion } from 'framer-motion';
import {
  AudioLines,
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
  Landmark,
  Loader2,
  Lock,
  Mic2,
  MicOff,
  Moon,
  Mountain,
  Music2,
  Piano,
  Podcast,
  Radio,
  RotateCcw,
  Sparkles,
  SlidersHorizontal,
  Speaker,
  Theater,
  Trophy,
  Wand2,
  Waves,
  X,
  Zap,
} from 'lucide-react';
import { Link } from '@tanstack/react-router';
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
  { id: 'off', name: 'Off', icon: X, desc: 'No room — pure track' },
  { id: 'vinyl', name: 'Vinyl booth', icon: Disc3, desc: 'Dark, dry lacquer cut' },
  { id: 'studio', name: 'Studio', icon: Mic2, desc: 'Tight control room' },
  { id: 'bedroom', name: 'Bedroom', icon: Home, desc: 'Soft close walls' },
  { id: 'club', name: 'Night club', icon: Speaker, desc: 'Low room, thick bass' },
  { id: 'chapel', name: 'Chapel', icon: Church, desc: 'Bright stone, medium tail' },
  { id: 'hall', name: 'Concert hall', icon: Building2, desc: 'Wide orchestral bloom' },
  { id: 'opera', name: 'Opera house', icon: Theater, desc: 'Warm wood, very wide' },
  { id: 'arena', name: 'Arena', icon: Trophy, desc: 'Indoor crowd roar' },
  { id: 'stadium', name: 'Stadium', icon: Landmark, desc: 'Open-air slapback' },
  { id: 'cathedral', name: 'Cathedral', icon: Church, desc: 'Longest stone wash' },
  { id: 'canyon', name: 'Canyon', icon: Mountain, desc: 'Far echo, huge sky' },
];

const VIEWS: Array<{ id: EqView; label: string; icon: ComponentType<{ className?: string }> }> = [
  { id: 'smart', label: 'Smart', icon: Wand2 },
  { id: 'stems', label: 'Master', icon: SlidersHorizontal },
  { id: 'manual', label: 'Bands', icon: SlidersHorizontal },
  { id: 'space', label: 'Space', icon: Waves },
];

const NEUTRAL_PATCH: Partial<EQSettings> = {
  bands: BAND_DEFS.map(() => 0),
  bassBoost: 0,
  reverb: 0,
  playbackSpeed: 1,
  spatialAudio: false,
  studioSpace: 'off',
  lateNight: false,
  headphoneSurround: false,
  harmonicExciter: 0,
  stereoWidth: 50,
};

type StemMode = 'normal' | 'karaoke' | 'acappella' | 'custom';

const STEM_MODES: Array<{
  id: Exclude<StemMode, 'custom'>;
  name: string;
  desc: string;
  icon: ComponentType<{ className?: string }>;
  harmonicExciter: number;
  stereoWidth: number;
}> = [
  { id: 'normal', name: 'Pure', desc: 'Full mix, untouched', icon: AudioLines, harmonicExciter: 0, stereoWidth: 50 },
  { id: 'karaoke', name: 'Open Air', desc: 'Wider stage, gentle sparkle', icon: Mic2, harmonicExciter: 30, stereoWidth: 75 },
  { id: 'acappella', name: 'Mastered', desc: 'Rich presence, big stereo', icon: MicOff, harmonicExciter: 65, stereoWidth: 90 },
];

function detectStemMode(harmonicExciter: number, stereoWidth: number): StemMode {
  const match = STEM_MODES.find((m) => m.harmonicExciter === harmonicExciter && m.stereoWidth === stereoWidth);
  return match ? match.id : 'custom';
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

  const engineMode = useEngineState();
  const { isPremium, isLoading: premiumLoading } = usePremium();
  // Entitlement resolves asynchronously. While it is in flight we must NOT
  // render the locked state — that flashed a false "Premium only" wall at
  // paying users on every cold open.
  const entitlementChecking = premiumLoading;
  const locked = !premiumLoading && !isPremium;
  const settings = useEQSettings();
  const [view, setView] = useState<EqView>('smart');
  const [mounted, setMounted] = useState(false);
  const nativeAudio = isNativePlayerAvailable();
  const effectsActive = isEqActive(settings);
  const isConnected = engineMode === 'processed' || nativeAudio;
  const stemMode = detectStemMode(settings.harmonicExciter, settings.stereoWidth);

  useEffect(() => setMounted(true), []);

  const bands = useMemo<EQBand[]>(
    () => BAND_DEFS.map((band, index) => ({ ...band, gain: settings.bands[index] ?? 0 })),
    [settings.bands],
  );

  const activePreset = useMemo(
    () => PRESETS.find((preset) => preset.id === settings.activePreset),
    [settings.activePreset],
  );

  const connectionLabel = entitlementChecking
    ? 'Checking your plan…'
    : locked
      ? 'Premium required'
      : !currentSong
    ? 'Play a song to hear changes'
    : isConnected
      ? nativeAudio ? 'Native studio engine live' : 'Studio engine live'
      : effectsActive
        ? engineMode === 'unsupported' ? 'Saved — this stream blocks effects' : 'Linking audio…'
        : 'Ready';

  // Studio effects are Premium. Only poke the engine when the user is entitled.
  useEffect(() => {
    if (!isOpen || !isPremium) return;
    engineResume();
    window.dispatchEvent(new CustomEvent('uf-eq-changed', { detail: getEQSettings() }));
  }, [isOpen, isPremium]);


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
      harmonicExciter: mode.harmonicExciter,
      stereoWidth: mode.stereoWidth,
      activePreset: 'custom',
    });
  }, []);

  if (!mounted || !isOpen) return null;

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
          className="relative mx-auto flex h-[100dvh] w-full max-w-[520px] flex-col overflow-hidden border-x border-border bg-background sm:my-3 sm:h-[calc(100dvh-1.5rem)] sm:rounded-lg sm:border"
          initial={{ y: '100%' }}
          animate={{ y: 0 }}
          exit={{ y: '100%' }}
          transition={iosSpring}
        >
          {/* ---------- Header ---------- */}
          <header className="border-b border-border px-4 pb-3 pt-[max(12px,env(safe-area-inset-top))]">
            <div>
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <h2 className="text-xl font-semibold text-foreground">Equalizer</h2>
                  <p className="mt-1 truncate text-xs text-muted-foreground">{currentSong?.title || 'No track playing'}</p>
                </div>
                <div className="flex shrink-0 items-center gap-2">
                  <button
                    type="button"
                    onClick={reset}
                    disabled={locked || entitlementChecking}
                    aria-label="Reset sound"
                    className="grid h-9 w-9 place-items-center rounded-xl border border-border bg-secondary text-foreground transition active:scale-95 disabled:opacity-40"
                  >
                    <RotateCcw className="h-4 w-4" />
                  </button>
                  <button
                    type="button"
                    onClick={onClose}
                    aria-label="Close equalizer"
                    className="grid h-9 w-9 place-items-center rounded-xl bg-primary text-primary-foreground transition active:scale-95"
                  >
                    <X className="h-5 w-5" />
                  </button>
                </div>
              </div>

              <div className="mt-3 flex h-9 items-center justify-between border-t border-border pt-3 text-xs">
                <span className="text-muted-foreground">Audio engine</span>
                <span className={cn('font-medium', isConnected ? 'text-primary' : 'text-muted-foreground')}>{connectionLabel}</span>
              </div>
            </div>
          </header>

          {/* ---------- Tabs ---------- */}
          <div className="border-b border-border px-4 py-2.5">
            <div className="grid grid-cols-4 gap-1 rounded-xl border border-border/60 bg-secondary/60 p-1 backdrop-blur-xl">
              {VIEWS.map((item) => {
                const Icon = item.icon;
                const selected = view === item.id;
                return (
                  <button
                    key={item.id}
                    type="button"
                    onClick={() => setView(item.id)}
                    className={cn(
                      'relative flex h-9 items-center justify-center gap-1.5 rounded-lg text-[11px] font-semibold transition',
                      selected ? 'text-primary-foreground' : 'text-muted-foreground active:scale-95',
                    )}
                  >
                    {selected && (
                      <motion.span
                        layoutId="eq-tab"
                        className="absolute inset-0 rounded-lg bg-primary shadow-[0_6px_20px_-8px_hsl(var(--primary))]"
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


          {/* ---------- Entitlement state ---------- */}
          {entitlementChecking && (
            <div className="flex items-center gap-2 border-b border-border bg-secondary/40 px-4 py-3 text-xs text-muted-foreground">
              <Loader2 className="h-3.5 w-3.5 animate-spin text-primary" />
              Checking your Premium status…
            </div>
          )}
          {locked && (
            <div className="border-b border-border bg-secondary/40 px-4 py-4">
              <div className="flex items-start gap-3">
                <div className="grid h-9 w-9 shrink-0 place-items-center rounded-xl bg-primary text-primary-foreground">
                  <Lock className="h-4 w-4" />
                </div>
                <div className="min-w-0">
                  <p className="text-sm font-bold text-foreground">Studio EQ is a Premium feature</p>
                  <p className="mt-1 text-xs leading-snug text-muted-foreground">
                    Bands, spaces, master chain and speed stay off on the free plan — playback runs clean and
                    untouched. Upgrade to unlock the full studio engine.
                  </p>
                  <Link
                    to="/premium"
                    onClick={onClose}
                    className="mt-3 inline-flex items-center gap-1.5 rounded-xl bg-primary px-3 py-2 text-xs font-bold text-primary-foreground transition active:scale-95"
                  >
                    <Sparkles className="h-3.5 w-3.5" />
                    Upgrade to Premium
                  </Link>
                </div>
              </div>
            </div>
          )}

          {/* ---------- Body ---------- */}
          <div
            aria-disabled={locked || entitlementChecking}
            className={cn(
              'hide-scrollbar flex-1 overflow-y-auto px-4 pb-[max(24px,env(safe-area-inset-bottom))] pt-4',
              (locked || entitlementChecking) && 'pointer-events-none select-none opacity-40 grayscale',
            )}
          >
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
                          'flex h-[68px] flex-col items-center justify-center gap-1.5 rounded-xl border px-1.5 text-[11px] font-semibold transition active:scale-95',
                          selected
                            ? 'border-primary bg-primary text-primary-foreground shadow-[0_8px_24px_-10px_hsl(var(--primary))]'
                            : 'border-border/60 bg-secondary/40 text-foreground backdrop-blur-xl',
                        )}
                      >
                        <Icon className={cn('h-4.5 w-4.5 shrink-0', selected ? '' : 'text-primary')} />
                        <span className="w-full truncate text-center leading-none">{preset.name}</span>
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
                  title="Master Chain"
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
                          'flex h-[88px] flex-col items-center justify-center gap-1.5 rounded-xl border px-2 text-center transition active:scale-95',
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
                  label="Harmonic exciter"
                  value={settings.harmonicExciter}
                  min={0}
                  max={100}
                  step={1}
                  display={settings.harmonicExciter === 0 ? 'Pure' : `${settings.harmonicExciter}%`}
                  onChange={(value) => setEQSettings({ harmonicExciter: value, activePreset: 'custom' })}
                />
                <ControlSlider
                  icon={Drum}
                  label="Stereo width"
                  value={settings.stereoWidth}
                  min={0}
                  max={100}
                  step={1}
                  display={`${settings.stereoWidth}%`}
                  onChange={(value) => setEQSettings({ stereoWidth: value, activePreset: 'custom' })}
                />

                <p className="border-l-2 border-primary bg-secondary/40 px-3 py-2.5 text-[11px] leading-relaxed text-muted-foreground">
                  The Master Chain adds harmonic richness and stereo depth.
                  Exciter adds high-end sparkle and "air", while Width expands the stage beyond your speakers.
                </p>
              </div>
            )}

            {view === 'manual' && (
              <div className="space-y-4">
                <SectionLabel title="10-band EQ" value="±12 dB" />
                <div className="rounded-2xl border border-border/60 bg-secondary/40 p-3 backdrop-blur-xl">
                  <div className="hide-scrollbar -mx-1 overflow-x-auto px-1">
                    <div className="flex min-w-max items-end gap-2.5">
                      {bands.map((band, index) => (
                        <div key={band.frequency} className="flex w-11 shrink-0 flex-col items-center gap-2">
                          <span className="text-[10px] font-bold text-primary">
                            {band.gain > 0 ? '+' : ''}{band.gain}
                          </span>
                          <div className="flex h-48 items-center justify-center">
                            <Slider
                              orientation="vertical"
                              value={[band.gain]}
                              min={-12}
                              max={12}
                              step={1}
                              onValueChange={([value]) => setBand(index, value)}
                              aria-label={`${band.label} hertz`}
                              className="h-full [&_[role=slider]]:h-5 [&_[role=slider]]:w-5"
                            />
                          </div>
                          <span className="text-[10px] font-medium text-muted-foreground">{band.label}</span>
                        </div>
                      ))}
                    </div>
                  </div>
                </div>

                <div className="grid grid-cols-2 gap-2">
                  <button
                    type="button"
                    className="h-11 rounded-xl border border-border/60 bg-secondary/50 text-sm font-semibold text-foreground transition active:scale-95"
                    onClick={() => setEQSettings({ bands: BAND_DEFS.map(() => 0), bassBoost: 0, activePreset: 'custom' })}
                  >
                    Flatten
                  </button>
                  <button
                    type="button"
                    className="h-11 rounded-xl bg-primary text-sm font-semibold text-primary-foreground transition active:scale-95"
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
                          'flex h-[60px] items-center gap-3 rounded-xl border px-3 text-left transition active:scale-95',
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
  <div className="rounded-2xl border border-border/60 bg-secondary/40 p-4 backdrop-blur-xl">
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
  <div className="flex items-center justify-between gap-4 rounded-2xl border border-border/60 bg-secondary/40 p-4 backdrop-blur-xl">
    <div className="flex min-w-0 items-center gap-3">
      <div className={cn('grid h-9 w-9 shrink-0 place-items-center rounded-xl', checked ? 'bg-primary text-primary-foreground' : 'bg-muted text-muted-foreground')}>
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
