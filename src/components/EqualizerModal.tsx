import { useState, useCallback, useEffect, memo } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { X, Disc3, RotateCcw, Volume2, Zap, Waves, Music2, Headphones, Globe, Radio, Mic2, Home, Building2, Church, Trophy, Moon, Crown } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import { Slider } from '@/components/ui/slider';
import { Switch } from '@/components/ui/switch';
import { iosSpring } from '@/lib/animations';
import { usePlayer } from '@/contexts/PlayerContext';
import { usePremium } from '@/hooks/usePremium';
import { toast } from 'sonner';
import { resume as engineResume, type StudioSpaceId } from '@/lib/audioEngine';
import { useEngineState } from '@/hooks/useGlobalAudioEngine';
import { isNativePlayerAvailable } from '@/lib/nativePlayer';
import { getEQSettings, isEqActive, setEQSettings, useEQSettings } from '@/lib/eqSettings';

interface StudioSpace {
  id: StudioSpaceId;
  name: string;
  icon: React.ComponentType<{ className?: string }>;
  desc: string;
}

const STUDIO_SPACES: StudioSpace[] = [
  { id: 'off',       name: 'Off',         icon: X,         desc: 'No space' },
  { id: 'vinyl',     name: 'Vinyl Booth', icon: Disc3,     desc: 'Warm & intimate' },
  { id: 'studio',    name: 'Studio',      icon: Mic2,      desc: 'Dry & precise' },
  { id: 'bedroom',   name: 'Bedroom',     icon: Home,      desc: 'Cozy & close' },
  { id: 'hall',      name: 'Concert Hall',icon: Building2, desc: 'Spacious & lush' },
  { id: 'cathedral', name: 'Cathedral',   icon: Church,    desc: 'Vast & ethereal' },
  { id: 'stadium',   name: 'Stadium',     icon: Trophy,    desc: 'Huge & roaring' },
];

interface EqualizerModalProps {
  isOpen: boolean;
  onClose: () => void;
}

interface EQBand {
  frequency: number;
  gain: number;
  label: string;
}

interface Preset {
  id: string;
  name: string;
  icon: React.ComponentType<{ className?: string }>;
  bands: number[];
  bassBoost: number;
  reverb?: number;
  spatialAudio?: boolean;
  studioSpace?: StudioSpaceId;
  lateNight?: boolean;
  headphoneSurround?: boolean;
}

// Full sound-mode presets — each preset controls the WHOLE engine, not only EQ sliders.
const presets: Preset[] = [
  { id: 'flat',         name: 'Flat',         icon: Music2,     bands: [0, 0, 0, 0, 0, 0, 0, 0, 0, 0], bassBoost: 0 },
  { id: 'bass-boost',   name: 'Bass Boost',   icon: Zap,        bands: [4, 3, 2, 0, 0, 0, 0, 0, 0, 0], bassBoost: 35 },
  { id: 'deep-bass',    name: 'Deep Bass',    icon: Waves,      bands: [7, 6, 4, 2, 0, 0, 0, -1, -1, -1], bassBoost: 70 },
  { id: 'treble-boost', name: 'Treble',       icon: Disc3,      bands: [0, 0, 0, 0, 0, 0, 1, 2, 3, 3], bassBoost: 0 },
  { id: 'vocal',        name: 'Vocal',        icon: Volume2,    bands: [-2, -1, 0, 1, 3, 4, 3, 1, 0, -1], bassBoost: 0 },
  { id: 'late-night',   name: 'Late Night',   icon: Moon,       bands: [-3, -2, -1, 0, 2, 3, 2, 1, -1, -2], bassBoost: 8, lateNight: true },
  { id: '8d-audio',     name: '8D Audio',     icon: Globe,      bands: [2, 1, 0, -1, 0, 0, 1, 2, 1, 1], bassBoost: 10, spatialAudio: true, reverb: 12 },
  { id: 'headphones',   name: 'Headphones',   icon: Headphones, bands: [1, 1, 0, -1, 0, 1, 2, 2, 1, 0], bassBoost: 18, headphoneSurround: true },
  { id: 'phonk',        name: 'Phonk',        icon: Radio,      bands: [6, 5, 3, 1, 0, -1, 0, 1, 2, 2], bassBoost: 55 },
  { id: 'pop',          name: 'Pop',          icon: Music2,     bands: [1, 2, 1, 0, 0, 1, 2, 3, 2, 1], bassBoost: 18 },
  { id: 'concert',      name: 'Concert',      icon: Trophy,     bands: [3, 2, 1, 0, 1, 1, 2, 2, 2, 1], bassBoost: 15, studioSpace: 'hall' },
  { id: 'studio',       name: 'Studio',       icon: Mic2,       bands: [0, 0, 0, -1, 0, 2, 2, 1, 0, -1], bassBoost: 5, studioSpace: 'studio' },
];

// Labels mirror engine's BAND_DEFS (32Hz → 16kHz)
const defaultBands: EQBand[] = [
  { frequency: 32,    gain: 0, label: '32' },
  { frequency: 64,    gain: 0, label: '64' },
  { frequency: 125,   gain: 0, label: '125' },
  { frequency: 250,   gain: 0, label: '250' },
  { frequency: 500,   gain: 0, label: '500' },
  { frequency: 1000,  gain: 0, label: '1k' },
  { frequency: 2000,  gain: 0, label: '2k' },
  { frequency: 4000,  gain: 0, label: '4k' },
  { frequency: 8000,  gain: 0, label: '8k' },
  { frequency: 16000, gain: 0, label: '16k' },
];

const EqualizerModal = ({ isOpen, onClose }: EqualizerModalProps) => {
  const navigate = useNavigate();
  const { isPremium, isLoading } = usePremium();
  const { currentSong } = usePlayer();
  const engineMode = useEngineState();
  const isConnected = engineMode === 'processed';
  const settings = useEQSettings();
  const bands = defaultBands.map((b, i) => ({ ...b, gain: settings.bands[i] ?? 0 }));
  const { bassBoost, reverb, playbackSpeed, spatialAudio, studioSpace, lateNight, headphoneSurround, activePreset } = settings;
  const effectsActive = isEqActive(settings);
  const connectionLabel = !currentSong
    ? 'Play a song to connect'
    : isConnected
      ? 'Connected'
      : effectsActive
        ? engineMode === 'unsupported'
          ? 'Unavailable on this stream'
          : engineMode === 'direct'
            ? 'Reloading stream for effects…'
            : 'Connecting…'
        : 'Ready — choose a preset';

  // Resume the AudioContext on open (user-gesture window) so the global engine
  // can apply EQ immediately. All actual graph work — connect, setBands,
  // setReverb, setStudioSpace, setSpatial, setLateNight, playbackRate — is
  // handled by useGlobalAudioEngine listening for the `uf-eq-changed` event
  // that setEQSettings dispatches. The modal is purely a state surface.
  useEffect(() => {
    if (!isOpen || !isPremium) return;
    engineResume();
    window.dispatchEvent(new CustomEvent('uf-eq-changed', { detail: getEQSettings() }));
  }, [isOpen, isPremium]);

  const handleBandChange = useCallback((index: number, value: number) => {
    setEQSettings((prev) => ({ bands: prev.bands.map((gain, i) => i === index ? value : gain), activePreset: 'custom' }));
  }, []);


  const handlePresetSelect = useCallback((preset: Preset) => {
    setEQSettings({
      bands: preset.bands,
      bassBoost: preset.bassBoost,
      reverb: preset.reverb ?? 0,
      spatialAudio: !!preset.spatialAudio,
      studioSpace: preset.studioSpace ?? 'off',
      lateNight: !!preset.lateNight,
      headphoneSurround: !!preset.headphoneSurround,
      playbackSpeed: 1,
      activePreset: preset.id,
    });
    toast.success(`${preset.name} preset applied`);
  }, []);

  const handleReset = useCallback(() => {
    setEQSettings({
      bands: defaultBands.map((b) => b.gain),
      bassBoost: 0,
      reverb: 0,
      playbackSpeed: 1,
      spatialAudio: false,
      studioSpace: 'off',
      lateNight: false,
      headphoneSurround: false,
      activePreset: 'flat',
    });
    toast.success('Equalizer reset');
  }, []);


  const handleSpaceSelect = useCallback((id: StudioSpaceId) => {
    setEQSettings({ studioSpace: id, activePreset: 'custom' });
    if (id !== 'off') {
      const name = STUDIO_SPACES.find(s => s.id === id)?.name;
      if (name) toast.success(`Now playing in ${name}`);
    }
  }, []);

  if (!isOpen) return null;

  if (!isPremium) {
    return (
      <AnimatePresence>
        <motion.div
          className="fixed inset-0 z-[100] flex items-end justify-center"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
        >
          <motion.div className="absolute inset-0 bg-black/70 backdrop-blur-xl" onClick={onClose} />
          <motion.div
            className="relative w-full max-w-lg mx-4 mb-4 rounded-3xl overflow-hidden bg-background border border-white/10 p-5"
            initial={{ y: '100%', opacity: 0 }}
            animate={{ y: 0, opacity: 1 }}
            exit={{ y: '100%', opacity: 0 }}
            transition={iosSpring}
          >
            <div className="flex items-start justify-between gap-4">
              <div className="flex items-center gap-3 min-w-0">
                <div className="w-11 h-11 rounded-2xl flex items-center justify-center bg-primary/15 shrink-0">
                  <Crown className="w-5 h-5 text-primary" fill="currentColor" />
                </div>
                <div className="min-w-0">
                  <p className="text-[10px] font-extrabold uppercase tracking-[0.18em] text-primary">Premium audio</p>
                  <h2 className="text-xl font-semibold leading-tight">Equalizer is locked</h2>
                  <p className="text-xs text-muted-foreground mt-1">
                    {isLoading ? 'Checking your Premium status…' : 'Studio EQ, bass boost, reverb, spatial audio, and surround effects require Premium.'}
                  </p>
                </div>
              </div>
              <button onClick={onClose} className="w-10 h-10 rounded-full flex items-center justify-center bg-muted/60 shrink-0">
                <X className="w-5 h-5" />
              </button>
            </div>
            <button
              onClick={() => { onClose(); navigate('/premium'); }}
              className="mt-5 w-full h-12 rounded-2xl bg-primary text-primary-foreground text-sm font-semibold"
            >
              Upgrade to Premium
            </button>
          </motion.div>
        </motion.div>
      </AnimatePresence>
    );
  }

  const speedMarks = [0.5, 1, 1.5, 2];

  return (
    <AnimatePresence>
      <motion.div
        className="fixed inset-0 z-[100] flex items-end justify-center"
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0 }}
      >
        <motion.div
          className="absolute inset-0 bg-black/60 backdrop-blur-xl"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          onClick={onClose}
        />

        <motion.div
          className="relative w-full max-w-lg mx-4 mb-4 rounded-3xl overflow-hidden bg-background border border-white/10"
          initial={{ y: '100%', opacity: 0 }}
          animate={{ y: 0, opacity: 1 }}
          exit={{ y: '100%', opacity: 0 }}
          transition={iosSpring}
        >
          {/* Header */}
          <div className="relative overflow-hidden p-5 uf-rose-gradient">
            {currentSong?.cover_url && (
              <img
                src={currentSong.cover_url}
                alt=""
                aria-hidden
                className="absolute inset-y-0 right-0 h-full w-2/3 object-cover pointer-events-none"
                style={{ filter: 'blur(18px) saturate(140%)', opacity: 0.45, WebkitMaskImage: 'linear-gradient(to left, #000 30%, transparent 100%)', maskImage: 'linear-gradient(to left, #000 30%, transparent 100%)' }}
              />
            )}
            <div className="relative z-10 flex items-center justify-between">
            <div className="flex items-center gap-3 min-w-0">
              <div className="w-11 h-11 rounded-2xl flex items-center justify-center bg-black shadow-lg shrink-0">
                <Waves className="w-5 h-5 text-white" />
              </div>
              <div className="min-w-0">
                <p className="text-black/60 text-[10px] font-extrabold uppercase tracking-[0.18em]">Studio sound</p>
                <h2 className="text-black text-[30px] leading-none font-display tracking-wide">EQUALIZER</h2>
                <p className="text-xs text-black/70 font-semibold truncate flex items-center gap-1">
                  <span className={`w-1.5 h-1.5 rounded-full ${isConnected ? 'bg-black' : effectsActive ? 'bg-black/50 animate-pulse' : 'bg-black/30'}`} />
                  {connectionLabel}
                </p>
              </div>
            </div>
            <div className="flex items-center gap-2">
              <motion.button onClick={handleReset} className="w-10 h-10 rounded-full flex items-center justify-center bg-black/15" whileTap={{ scale: 0.95 }}>
                <RotateCcw className="w-4 h-4 text-black/70" />
              </motion.button>
              <motion.button onClick={onClose} className="w-10 h-10 rounded-full flex items-center justify-center bg-black text-white" whileTap={{ scale: 0.95 }}>
                <X className="w-5 h-5" />
              </motion.button>
            </div>
            </div>
          </div>

          <div className="p-5 space-y-5 max-h-[70vh] overflow-y-auto">
              {!isConnected && currentSong && engineMode === 'unsupported' && (
                <div
                  className="rounded-2xl px-4 py-3 text-xs text-muted-foreground"
                  style={{
                    background: 'rgba(28, 28, 30, 0.8)',
                    border: '1px solid rgba(255, 255, 255, 0.06)',
                  }}
                >
                  Equalizer settings are saved. This device/browser could not open WebAudio processing for the current stream.
                </div>
              )}

            {/* Full sound-mode presets */}
            <div>
              <h3 className="text-[11px] font-extrabold uppercase tracking-[0.18em] text-primary mb-3">Sound modes</h3>
              <div className="grid grid-cols-3 gap-2">
                {presets.map((preset) => {
                  const Icon = preset.icon;
                  const isSelected = activePreset === preset.id;
                  return (
                    <motion.button
                      key={preset.id}
                      onClick={() => handlePresetSelect(preset)}
                      className="relative flex min-h-[76px] flex-col items-center justify-center gap-2 py-3 px-2 rounded-xl overflow-hidden transition-all"
                      style={{
                        background: isSelected
                          ? 'linear-gradient(135deg, hsl(var(--primary)), hsl(18 100% 82%))'
                          : 'hsl(var(--card))',
                        border: isSelected
                          ? '1px solid hsl(var(--primary) / 0.6)'
                          : '1px solid rgba(255, 255, 255, 0.06)',
                      }}
                      whileTap={{ scale: 0.96 }}
                    >
                      <Icon className={`w-5 h-5 ${isSelected ? 'text-primary-foreground' : 'text-muted-foreground'}`} />
                      <span className={`text-[11px] font-medium leading-tight text-center ${isSelected ? 'text-primary-foreground' : 'text-muted-foreground'}`}>
                        {preset.name}
                      </span>
                    </motion.button>
                  );
                })}
              </div>
            </div>

            {/* 10-Band Equalizer */}
            <div>
              <h3 className="text-sm font-medium text-muted-foreground mb-3">10-Band Equalizer</h3>
              <div
                className="rounded-2xl p-3"
                style={{
                  background: 'rgba(28, 28, 30, 0.8)',
                  border: '1px solid rgba(255, 255, 255, 0.06)',
                }}
              >
                <div className="flex justify-between mb-2 px-0.5">
                  {bands.map((band) => (
                    <span key={band.frequency} className="text-[9px] text-muted-foreground font-mono flex-1 text-center">
                      {band.gain > 0 ? '+' : ''}{band.gain}
                    </span>
                  ))}
                </div>

                <div className="flex justify-between gap-0.5 mb-2">
                  {bands.map((band, index) => (
                    <div key={band.frequency} className="flex-1 flex items-center h-28">
                      <Slider
                        orientation="vertical"
                        value={[band.gain]}
                        min={-12}
                        max={12}
                        step={1}
                        onValueChange={([value]) => handleBandChange(index, value)}
                        className="h-full [&_[role=slider]]:w-4 [&_[role=slider]]:h-4 [&_[role=slider]]:bg-rose-500 [&_[role=slider]]:border-2 [&_[role=slider]]:border-rose-400 [&_[data-radix-slider-track]]:bg-white/10 [&_[data-radix-slider-range]]:bg-rose-500/40"
                      />
                    </div>
                  ))}
                </div>

                <div className="flex justify-between px-0.5">
                  {bands.map((band) => (
                    <span key={band.frequency} className="text-[8px] text-muted-foreground/60 flex-1 text-center">
                      {band.label}
                    </span>
                  ))}
                </div>
              </div>
            </div>

            {/* Effects */}
            <div>
              <h3 className="text-sm font-medium text-muted-foreground mb-3">Effects</h3>
              <div className="space-y-4">
                {/* Bass Boost */}
                <div>
                  <div className="flex items-center justify-between mb-2">
                    <div className="flex items-center gap-2">
                      <Zap className="w-4 h-4 text-orange-400" />
                      <span className="text-sm font-medium">Bass Boost</span>
                    </div>
                    <span className="text-xs text-muted-foreground">{bassBoost}%</span>
                  </div>
                  <Slider
                    value={[bassBoost]}
                    min={0}
                    max={100}
                    step={5}
                        onValueChange={([value]) => setEQSettings({ bassBoost: value, activePreset: 'custom' })}
                    className="w-full [&_[role=slider]]:bg-rose-500 [&_[role=slider]]:border-rose-400 [&_[data-radix-slider-range]]:bg-rose-500/60"
                  />
                </div>

                {/* Reverb */}
                <div>
                  <div className="flex items-center justify-between mb-2">
                    <div className="flex items-center gap-2">
                      <Waves className="w-4 h-4 text-blue-400" />
                      <span className="text-sm font-medium">Reverb</span>
                    </div>
                    <span className="text-xs text-muted-foreground">{reverb}%</span>
                  </div>
                  <Slider
                    value={[reverb]}
                    min={0}
                    max={45}
                    step={5}
                    onValueChange={([value]) => setEQSettings({ reverb: value, studioSpace: 'off', activePreset: 'custom' })}
                    className="w-full [&_[role=slider]]:bg-rose-500 [&_[role=slider]]:border-rose-400 [&_[data-radix-slider-range]]:bg-rose-500/60"
                  />
                </div>

                {/* Playback Speed */}
                <div>
                  <div className="flex items-center justify-between mb-2">
                    <div className="flex items-center gap-2">
                      <Radio className="w-4 h-4 text-rose-400" />
                      <span className="text-sm font-medium">Playback Speed</span>
                    </div>
                    <span className="text-xs text-muted-foreground">{playbackSpeed}x</span>
                  </div>
                  <Slider
                    value={[playbackSpeed * 100]}
                    min={50}
                    max={200}
                    step={25}
                    onValueChange={([value]) => setEQSettings({ playbackSpeed: value / 100, activePreset: 'custom' })}
                    className="w-full [&_[role=slider]]:bg-rose-500 [&_[role=slider]]:border-rose-400 [&_[data-radix-slider-range]]:bg-rose-500"
                  />
                  <div className="flex justify-between mt-1">
                    {speedMarks.map(s => (
                      <span key={s} className="text-[10px] text-muted-foreground/50">{s}x</span>
                    ))}
                  </div>
                </div>
              </div>
            </div>

            {/* Studio Spaces — Premium-exclusive acoustic environments */}
            <div>
              <div className="flex items-center justify-between mb-3">
                <div>
                  <h3 className="text-sm font-medium flex items-center gap-2">
                    Studio Spaces
                    <span className="text-[9px] font-bold px-1.5 py-0.5 rounded bg-primary text-primary-foreground">EXCLUSIVE</span>
                  </h3>
                  <p className="text-[11px] text-muted-foreground mt-0.5">Hear songs in real acoustic environments</p>
                </div>
              </div>
              <div className="flex gap-2 overflow-x-auto pb-2 -mx-1 px-1 scrollbar-none">
                {STUDIO_SPACES.map((space) => {
                  const Icon = space.icon;
                  const isSelected = studioSpace === space.id;
                  return (
                    <motion.button
                      key={space.id}
                      onClick={() => handleSpaceSelect(space.id)}
                      className="relative flex-shrink-0 flex flex-col items-center gap-1.5 py-3 px-3 rounded-xl min-w-[88px] transition-all"
                      style={{
                        background: isSelected
                          ? 'linear-gradient(135deg, hsl(var(--primary)), hsl(330 80% 55%))'
                          : 'rgba(28, 28, 30, 0.8)',
                        border: isSelected
                          ? '1px solid hsl(var(--primary) / 0.6)'
                          : '1px solid rgba(255, 255, 255, 0.06)',
                      }}
                      whileTap={{ scale: 0.95 }}
                    >
                      <Icon className={`w-5 h-5 ${isSelected ? 'text-white' : 'text-muted-foreground'}`} />
                      <span className={`text-[11px] font-medium ${isSelected ? 'text-white' : 'text-foreground'}`}>
                        {space.name}
                      </span>
                      <span className={`text-[9px] leading-tight ${isSelected ? 'text-white/80' : 'text-muted-foreground/70'}`}>
                        {space.desc}
                      </span>
                    </motion.button>
                  );
                })}
              </div>
              {studioSpace !== 'off' && (
                <p className="text-[10px] text-muted-foreground/70 mt-1 px-1">
                  Reverb slider is overridden while a Studio Space is active.
                </p>
              )}
            </div>

            {/* 8D Spatial Audio */}
            <div
              className="flex items-center justify-between p-4 rounded-2xl"
              style={{
                background: 'rgba(28, 28, 30, 0.8)',
                border: '1px solid rgba(255, 255, 255, 0.06)',
              }}
            >
              <div className="flex items-center gap-3">
                <div
                  className="w-10 h-10 rounded-xl flex items-center justify-center"
                  style={{
                    background: spatialAudio
                      ? 'linear-gradient(135deg, hsl(var(--primary) / 0.4), hsl(280 80% 55% / 0.3))'
                      : 'rgba(255,255,255,0.05)',
                  }}
                >
                  <Globe className={`w-5 h-5 ${spatialAudio ? 'text-primary' : 'text-muted-foreground'}`} />
                </div>
                <div>
                  <span className="text-sm font-medium">8D Audio</span>
                  <p className="text-[11px] text-muted-foreground">Auto-rotating immersive spatial sound</p>
                </div>
              </div>
              <Switch
                checked={spatialAudio}
                onCheckedChange={(value) => setEQSettings({ spatialAudio: value, activePreset: 'custom' })}
                className="data-[state=checked]:bg-primary"
              />
            </div>

            {/* Late Night Mode */}
            <div
              className="flex items-center justify-between p-4 rounded-2xl"
              style={{
                background: 'rgba(28, 28, 30, 0.8)',
                border: '1px solid rgba(255, 255, 255, 0.06)',
              }}
            >
              <div className="flex items-center gap-3">
                <div
                  className="w-10 h-10 rounded-xl flex items-center justify-center"
                  style={{
                    background: lateNight
                      ? 'linear-gradient(135deg, hsl(var(--primary) / 0.4), hsl(220 70% 45% / 0.3))'
                      : 'rgba(255,255,255,0.05)',
                  }}
                >
                  <Moon className={`w-5 h-5 ${lateNight ? 'text-primary' : 'text-muted-foreground'}`} />
                </div>
                <div>
                  <span className="text-sm font-medium">Late Night Mode</span>
                  <p className="text-[11px] text-muted-foreground">Lifts whispers, tames peaks for quiet listening</p>
                </div>
              </div>
              <Switch
                checked={lateNight}
                onCheckedChange={(value) => setEQSettings({ lateNight: value, activePreset: 'custom' })}
                className="data-[state=checked]:bg-primary"
              />
            </div>

            {/* Headphone 3D Surround — premium binaural crossfeed */}
            <div
              className="flex items-center justify-between p-4 rounded-2xl"
              style={{
                background: 'rgba(28, 28, 30, 0.8)',
                border: '1px solid rgba(255, 255, 255, 0.06)',
              }}
            >
              <div className="flex items-center gap-3">
                <div
                  className="w-10 h-10 rounded-xl flex items-center justify-center"
                  style={{
                    background: headphoneSurround
                      ? 'linear-gradient(135deg, hsl(var(--primary) / 0.4), hsl(280 80% 55% / 0.3))'
                      : 'rgba(255,255,255,0.05)',
                  }}
                >
                  <Headphones className={`w-5 h-5 ${headphoneSurround ? 'text-primary' : 'text-muted-foreground'}`} />
                </div>
                <div>
                  <div className="flex items-center gap-2">
                    <span className="text-sm font-medium">Headphone 3D Surround</span>
                    <span className="text-[9px] font-bold px-1.5 py-0.5 rounded bg-primary text-primary-foreground">EXCLUSIVE</span>
                  </div>
                  <p className="text-[11px] text-muted-foreground">Binaural crossfeed — sound out of your head, not inside it</p>
                </div>
              </div>
              <Switch
                checked={headphoneSurround}
                onCheckedChange={(value) => setEQSettings({ headphoneSurround: value, activePreset: 'custom' })}
                className="data-[state=checked]:bg-primary"
              />
            </div>
          </div>
        </motion.div>
      </motion.div>
    </AnimatePresence>
  );
};

export default EqualizerModal;
