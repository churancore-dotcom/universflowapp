import { useState, useCallback, useEffect, memo, useMemo } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { X, Disc3, RotateCcw, Volume2, Zap, Waves, Music2, Headphones, Globe, Radio, Mic2, Home, Building2, Church, Trophy, Moon, Crown, Wand2, Guitar, Drum, Piano, Car, Speaker, Dumbbell, Focus, PartyPopper, Film, Gamepad2, Podcast, Flame, Snowflake, Sun } from 'lucide-react';
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
// Grouped visually: Smart, Genre, Vibe, Space/Device.
const presets: Preset[] = [
  // — Smart —
  { id: 'auto',         name: 'Auto EQ',      icon: Wand2,      bands: [0, 0, 0, 0, 0, 0, 0, 0, 0, 0], bassBoost: 0 },
  { id: 'flat',         name: 'Flat',         icon: Music2,     bands: [0, 0, 0, 0, 0, 0, 0, 0, 0, 0], bassBoost: 0 },

  // — Bass / Treble sculpting —
  { id: 'bass-boost',   name: 'Bass Boost',   icon: Zap,        bands: [4, 3, 2, 0, 0, 0, 0, 0, 0, 0], bassBoost: 35 },
  { id: 'deep-bass',    name: 'Deep Bass',    icon: Waves,      bands: [7, 6, 4, 2, 0, 0, 0, -1, -1, -1], bassBoost: 70 },
  { id: 'super-bass',   name: 'Super Bass',   icon: Flame,      bands: [9, 8, 6, 3, 0, 0, 0, -1, -2, -2], bassBoost: 95 },
  { id: 'treble-boost', name: 'Treble',       icon: Disc3,      bands: [0, 0, 0, 0, 0, 0, 1, 2, 3, 3], bassBoost: 0 },
  { id: 'crystal',      name: 'Crystal Clear',icon: Snowflake,  bands: [-1, -1, 0, 0, 1, 2, 3, 4, 4, 3], bassBoost: 0 },
  { id: 'vocal',        name: 'Vocal',        icon: Volume2,    bands: [-2, -1, 0, 1, 3, 4, 3, 1, 0, -1], bassBoost: 0 },
  { id: 'v-shape',      name: 'V-Shape',      icon: Radio,      bands: [5, 4, 2, 0, -2, -2, 0, 2, 4, 5], bassBoost: 25 },

  // — Genre —
  { id: 'pop',          name: 'Pop',          icon: Music2,     bands: [1, 2, 1, 0, 0, 1, 2, 3, 2, 1], bassBoost: 18 },
  { id: 'rock',         name: 'Rock',         icon: Guitar,     bands: [5, 4, 3, 1, -1, -1, 1, 3, 4, 4], bassBoost: 20 },
  { id: 'metal',        name: 'Metal',        icon: Flame,      bands: [4, 3, 2, 0, -2, 1, 3, 4, 4, 3], bassBoost: 22 },
  { id: 'hiphop',       name: 'Hip-Hop',      icon: Drum,       bands: [6, 5, 2, 1, -1, -1, 1, 2, 3, 3], bassBoost: 45 },
  { id: 'rnb',          name: 'R&B',          icon: Mic2,       bands: [3, 3, 2, 2, -1, -1, 1, 2, 3, 3], bassBoost: 28 },
  { id: 'edm',          name: 'EDM',          icon: Radio,      bands: [6, 5, 2, 0, -2, 1, 1, 3, 5, 6], bassBoost: 42 },
  { id: 'phonk',        name: 'Phonk',        icon: Radio,      bands: [6, 5, 3, 1, 0, -1, 0, 1, 2, 2], bassBoost: 55 },
  { id: 'dance',        name: 'Dance',        icon: PartyPopper,bands: [5, 6, 3, 0, 0, -1, -1, 0, 4, 5], bassBoost: 38 },
  { id: 'jazz',         name: 'Jazz',         icon: Music2,     bands: [3, 2, 1, 2, -1, -1, 0, 1, 2, 3], bassBoost: 10 },
  { id: 'classical',    name: 'Classical',    icon: Piano,      bands: [4, 3, 2, 0, 0, 0, -1, 0, 2, 3], bassBoost: 5, studioSpace: 'hall' },
  { id: 'acoustic',     name: 'Acoustic',     icon: Guitar,     bands: [4, 4, 3, 1, 2, 2, 3, 3, 2, 1], bassBoost: 8 },
  { id: 'country',      name: 'Country',      icon: Guitar,     bands: [2, 3, 1, 0, 0, 2, 2, 3, 3, 2], bassBoost: 10 },
  { id: 'reggae',       name: 'Reggae',       icon: Music2,     bands: [3, 2, 0, -2, -1, 1, 3, 4, 3, 2], bassBoost: 22 },
  { id: 'latin',        name: 'Latin',        icon: Music2,     bands: [4, 3, 0, 0, -1, -1, -1, 0, 3, 4], bassBoost: 20 },
  { id: 'lofi',         name: 'Lo-Fi',        icon: Disc3,      bands: [4, 3, 2, 1, 0, -1, -3, -4, -5, -6], bassBoost: 25, reverb: 18 },
  { id: 'indie',        name: 'Indie',        icon: Guitar,     bands: [2, 2, 1, 1, 1, 1, 2, 2, 2, 1], bassBoost: 12 },
  { id: 'kpop',         name: 'K-Pop',        icon: Crown,   bands: [3, 4, 2, 0, 0, 1, 2, 4, 4, 3], bassBoost: 28 },
  { id: 'bollywood',    name: 'Bollywood',    icon: Flame,   bands: [3, 3, 2, 1, 1, 2, 3, 3, 2, 1], bassBoost: 22 },
  { id: 'punjabi',      name: 'Punjabi',      icon: Drum,       bands: [6, 5, 3, 1, 0, 0, 1, 2, 3, 3], bassBoost: 50 },

  // — Vibe / Mood —
  { id: 'late-night',   name: 'Late Night',   icon: Moon,       bands: [-3, -2, -1, 0, 2, 3, 2, 1, -1, -2], bassBoost: 8, lateNight: true },
  { id: 'chill',        name: 'Chill',        icon: Snowflake,  bands: [2, 2, 1, 1, 0, 0, 1, 2, 2, 1], bassBoost: 12, reverb: 10 },
  { id: 'focus',        name: 'Focus',        icon: Focus,      bands: [-1, -1, 0, 1, 2, 2, 1, 0, -1, -2], bassBoost: 0 },
  { id: 'workout',      name: 'Workout',      icon: Dumbbell,   bands: [5, 5, 3, 1, 0, 1, 2, 3, 4, 4], bassBoost: 40 },
  { id: 'party',        name: 'Party',        icon: PartyPopper,bands: [6, 5, 2, 0, 0, 0, 2, 4, 5, 5], bassBoost: 45 },
  { id: 'sunrise',      name: 'Sunrise',      icon: Sun,        bands: [2, 2, 1, 1, 2, 3, 3, 2, 2, 1], bassBoost: 12 },

  // — Space / Immersive —
  { id: '8d-audio',     name: '8D Audio',     icon: Globe,      bands: [2, 1, 0, -1, 0, 0, 1, 2, 1, 1], bassBoost: 10, spatialAudio: true, reverb: 12 },
  { id: 'surround',     name: 'Surround',     icon: Headphones, bands: [2, 2, 1, 0, 0, 1, 2, 2, 2, 2], bassBoost: 15, spatialAudio: true, headphoneSurround: true, reverb: 8 },
  { id: 'headphones',   name: 'Headphones',   icon: Headphones, bands: [1, 1, 0, -1, 0, 1, 2, 2, 1, 0], bassBoost: 18, headphoneSurround: true },
  { id: 'concert',      name: 'Concert',      icon: Trophy,     bands: [3, 2, 1, 0, 1, 1, 2, 2, 2, 1], bassBoost: 15, studioSpace: 'hall' },
  { id: 'stadium-live', name: 'Stadium',      icon: Trophy,     bands: [4, 3, 2, 1, 0, 1, 2, 3, 3, 2], bassBoost: 20, studioSpace: 'stadium' },
  { id: 'cathedral',    name: 'Cathedral',    icon: Church,     bands: [2, 2, 1, 0, 0, 1, 1, 2, 2, 2], bassBoost: 8, studioSpace: 'cathedral', reverb: 25 },
  { id: 'studio',       name: 'Studio',       icon: Mic2,       bands: [0, 0, 0, -1, 0, 2, 2, 1, 0, -1], bassBoost: 5, studioSpace: 'studio' },
  { id: 'vinyl',        name: 'Vinyl',        icon: Disc3,      bands: [3, 2, 1, 0, 0, -1, -1, -2, -3, -4], bassBoost: 15, studioSpace: 'vinyl' },

  // — Device tuning —
  { id: 'car',          name: 'Car',          icon: Car,        bands: [4, 3, 1, 0, -1, 1, 2, 3, 3, 2], bassBoost: 30 },
  { id: 'small-spkr',   name: 'Small Speaker',icon: Speaker,    bands: [-2, -1, 0, 2, 3, 3, 2, 1, 0, -1], bassBoost: 0 },
  { id: 'earbuds',      name: 'Earbuds',      icon: Headphones, bands: [3, 3, 1, 0, 0, 1, 2, 3, 2, 1], bassBoost: 22 },
  { id: 'tv',           name: 'TV / Film',    icon: Film,       bands: [1, 1, 0, 1, 2, 3, 2, 1, 1, 0], bassBoost: 10, studioSpace: 'hall' },
  { id: 'gaming',       name: 'Gaming',       icon: Gamepad2,   bands: [3, 3, 1, 0, 1, 2, 3, 3, 3, 2], bassBoost: 25, spatialAudio: true },
  { id: 'podcast',      name: 'Podcast',      icon: Podcast,    bands: [-4, -3, -1, 1, 3, 4, 3, 2, 0, -2], bassBoost: 0 },
];

// Auto-EQ heuristic: choose a preset based on song metadata keywords.
// Runs whenever `currentSong` changes AND user is in 'auto' mode.
function pickAutoPreset(song: { title?: string; artist?: string; album?: string } | null): string {
  if (!song) return 'flat';
  const hay = `${song.title || ''} ${song.artist || ''} ${song.album || ''}`.toLowerCase();
  const has = (...words: string[]) => words.some((w) => hay.includes(w));
  if (has('punjabi', 'jatt', 'sidhu', 'diljit', 'karan aujla', 'ap dhillon', 'shubh')) return 'punjabi';
  if (has('lofi', 'lo-fi', 'lo fi', 'chillhop', 'chill beats')) return 'lofi';
  if (has('phonk', 'drift')) return 'phonk';
  if (has('edm', 'house', 'trance', 'techno', 'dubstep', 'drum and bass', 'dnb', 'martin garrix', 'calvin harris', 'david guetta', 'marshmello', 'skrillex', 'zedd')) return 'edm';
  if (has('rock', 'metal', 'metallica', 'linkin park', 'guns n roses', 'ac/dc', 'nirvana', 'foo fighters')) return 'rock';
  if (has('hip hop', 'hip-hop', 'rap', 'drake', 'kendrick', 'travis scott', 'kanye', 'eminem', '21 savage', 'future')) return 'hiphop';
  if (has('r&b', 'rnb', 'weeknd', 'sza', 'frank ocean', 'bryson tiller')) return 'rnb';
  if (has('jazz', 'blues', 'coltrane', 'miles davis', 'ella fitzgerald', 'norah jones')) return 'jazz';
  if (has('classical', 'symphony', 'sonata', 'concerto', 'orchestra', 'bach', 'mozart', 'beethoven', 'chopin')) return 'classical';
  if (has('acoustic', 'unplugged', 'guitar')) return 'acoustic';
  if (has('country', 'nashville', 'morgan wallen', 'luke combs')) return 'country';
  if (has('reggae', 'bob marley', 'dancehall')) return 'reggae';
  if (has('latin', 'reggaeton', 'bad bunny', 'j balvin', 'shakira', 'karol g')) return 'latin';
  if (has('k-pop', 'kpop', 'bts', 'blackpink', 'twice', 'stray kids', 'newjeans')) return 'kpop';
  if (has('bollywood', 'arijit', 'shreya', 'pritam', 'a.r. rahman', 'a r rahman', 'atif aslam', 'neha kakkar')) return 'bollywood';
  if (has('party', 'dance', 'club')) return 'dance';
  if (has('workout', 'gym', 'pump', 'beast')) return 'workout';
  if (has('chill', 'sleep', 'calm', 'relax', 'ambient')) return 'chill';
  if (has('focus', 'study', 'concentration')) return 'focus';
  if (has('podcast', 'interview', 'talk')) return 'podcast';
  return 'pop';
}

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
  // On Android APK, ExoPlayer owns audio and EQ is applied via native
  // AudioEffect chain — WebAudio engine intentionally stays in "direct" mode.
  // Surface that as "Connected" so users don't see a perpetual "Connecting…".
  const nativeAudio = isNativePlayerAvailable();
  const settings = useEQSettings();
  const bands = defaultBands.map((b, i) => ({ ...b, gain: settings.bands[i] ?? 0 }));
  const { bassBoost, reverb, playbackSpeed, spatialAudio, studioSpace, lateNight, headphoneSurround, activePreset } = settings;
  const effectsActive = isEqActive(settings);
  const connectionLabel = !currentSong
    ? 'Play a song to connect'
    : isConnected || nativeAudio
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
    if (preset.id === 'auto') {
      const chosenId = pickAutoPreset(currentSong);
      const target = presets.find((p) => p.id === chosenId) || preset;
      setEQSettings({
        bands: target.bands,
        bassBoost: target.bassBoost,
        reverb: target.reverb ?? 0,
        spatialAudio: !!target.spatialAudio,
        studioSpace: target.studioSpace ?? 'off',
        lateNight: !!target.lateNight,
        headphoneSurround: !!target.headphoneSurround,
        playbackSpeed: 1,
        activePreset: 'auto',
      });
      toast.success(`Auto EQ · ${target.name}`);
      return;
    }
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
  }, [currentSong]);

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

  // Live spectrum bars in header — purely decorative, animates when playing.
  const spectrum = useMemo(() => Array.from({ length: 22 }, (_, i) => i), []);

  const presetGroups: { label: string; ids: string[] }[] = [
    { label: 'Smart',      ids: ['auto', 'flat'] },
    { label: 'Bass · Treble', ids: ['bass-boost','deep-bass','super-bass','treble-boost','crystal','vocal','v-shape'] },
    { label: 'Genre',      ids: ['pop','rock','metal','hiphop','rnb','edm','phonk','dance','jazz','classical','acoustic','country','reggae','latin','lofi','indie','kpop','bollywood','punjabi'] },
    { label: 'Vibe',       ids: ['late-night','chill','focus','workout','party','sunrise'] },
    { label: 'Immersive',  ids: ['8d-audio','surround','headphones','concert','stadium-live','cathedral','studio','vinyl'] },
    { label: 'Device',     ids: ['car','small-spkr','earbuds','tv','gaming','podcast'] },
  ];
  const presetById = new Map(presets.map((p) => [p.id, p]));

  return (
    <AnimatePresence>
      <motion.div
        className="fixed inset-0 z-[100] flex items-end justify-center"
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0 }}
      >
        <motion.div
          className="absolute inset-0 bg-black/70 backdrop-blur-2xl"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          onClick={onClose}
        />

        <motion.div
          className="relative w-full max-w-lg mx-4 mb-4 rounded-[28px] overflow-hidden border border-white/10 shadow-[0_30px_80px_-20px_rgba(0,0,0,0.9)]"
          style={{ background: 'linear-gradient(180deg, #0b0b10 0%, #0f0d14 100%)' }}
          initial={{ y: '100%', opacity: 0 }}
          animate={{ y: 0, opacity: 1 }}
          exit={{ y: '100%', opacity: 0 }}
          transition={iosSpring}
        >
          {/* Exclusive header — obsidian glass + live spectrum */}
          <div className="relative overflow-hidden">
            {currentSong?.cover_url && (
              <img
                src={currentSong.cover_url}
                alt=""
                aria-hidden
                className="absolute inset-0 h-full w-full object-cover pointer-events-none"
                style={{ filter: 'blur(38px) saturate(180%)', opacity: 0.55 }}
              />
            )}
            <div
              aria-hidden
              className="absolute inset-0 pointer-events-none"
              style={{ background: 'linear-gradient(180deg, rgba(10,10,14,0.45) 0%, rgba(10,10,14,0.85) 70%, rgba(10,10,14,0.95) 100%)' }}
            />
            <div
              aria-hidden
              className="absolute -top-20 -left-16 h-64 w-64 rounded-full pointer-events-none"
              style={{ background: 'radial-gradient(circle, hsl(var(--primary) / 0.35), transparent 60%)', filter: 'blur(20px)' }}
            />

            <div className="relative z-10 px-5 pt-5 pb-4">
              <div className="flex items-center justify-between mb-4">
                <div className="flex items-center gap-3 min-w-0">
                  <div className="relative w-11 h-11 rounded-2xl grid place-items-center shrink-0"
                       style={{ background: 'linear-gradient(140deg, hsl(var(--primary)), hsl(340 100% 62%))', boxShadow: '0 10px 30px -8px hsl(var(--primary) / 0.55)' }}>
                    <Waves className="w-5 h-5 text-white" />
                  </div>
                  <div className="min-w-0">
                    <p className="text-[10px] font-bold uppercase tracking-[0.28em] bg-clip-text text-transparent"
                       style={{ backgroundImage: 'linear-gradient(90deg, hsl(var(--primary)), hsl(38 100% 68%))' }}>
                      Exclusive · Studio Sound
                    </p>
                    <h2 className="text-white text-[26px] leading-none font-display tracking-[0.02em] mt-1">EQUALIZER</h2>
                    <p className="text-[11px] text-white/60 font-medium truncate flex items-center gap-1.5 mt-1.5">
                      <span className={`w-1.5 h-1.5 rounded-full ${isConnected ? 'bg-emerald-400 shadow-[0_0_8px_hsl(142_70%_55%)]' : effectsActive ? 'bg-amber-400 animate-pulse' : 'bg-white/30'}`} />
                      {connectionLabel}
                    </p>
                  </div>
                </div>
                <div className="flex items-center gap-2">
                  <motion.button onClick={handleReset} className="w-10 h-10 rounded-full grid place-items-center bg-white/5 border border-white/10 backdrop-blur" whileTap={{ scale: 0.94 }}>
                    <RotateCcw className="w-4 h-4 text-white/70" />
                  </motion.button>
                  <motion.button onClick={onClose} className="w-10 h-10 rounded-full grid place-items-center bg-white text-black" whileTap={{ scale: 0.94 }}>
                    <X className="w-5 h-5" />
                  </motion.button>
                </div>
              </div>

              {/* Live spectrum viz */}
              <div className="h-14 flex items-end justify-between gap-[3px]">
                {spectrum.map((i) => {
                  const gain = bands[Math.min(bands.length - 1, Math.round((i / spectrum.length) * (bands.length - 1)))].gain;
                  const base = 22 + (gain + 12) * 2; // map -12..+12 → 22..70 px
                  return (
                    <motion.span
                      key={i}
                      className="flex-1 rounded-full"
                      style={{ background: 'linear-gradient(180deg, hsl(var(--primary)) 0%, hsl(340 100% 65%) 100%)', minWidth: 3, opacity: 0.85 }}
                      animate={isConnected || nativeAudio ? { height: [base * 0.6, base, base * 0.75, base * 1.05, base * 0.8] } : { height: base * 0.5 }}
                      transition={isConnected || nativeAudio ? { duration: 1.1 + (i % 4) * 0.15, repeat: Infinity, ease: 'easeInOut', delay: i * 0.03 } : {}}
                    />
                  );
                })}
              </div>
            </div>

            <div className="relative z-10 h-px w-full" style={{ background: 'linear-gradient(90deg, transparent, hsl(var(--primary) / 0.5), transparent)' }} />
          </div>

          <div className="p-5 space-y-6 max-h-[68vh] overflow-y-auto">
              {!isConnected && currentSong && engineMode === 'unsupported' && (
                <div
                  className="rounded-2xl px-4 py-3 text-xs text-white/60"
                  style={{ background: 'rgba(255,255,255,0.03)', border: '1px solid rgba(255,255,255,0.06)' }}
                >
                  Equalizer settings are saved. This device/browser could not open WebAudio processing for the current stream.
                </div>
              )}

            {/* Grouped sound-mode presets — exclusive tiles */}
            {presetGroups.map((group) => (
              <div key={group.label}>
                <div className="flex items-center gap-2 mb-3">
                  <span className="text-[10px] font-bold uppercase tracking-[0.28em] text-white/50">{group.label}</span>
                  <span className="flex-1 h-px" style={{ background: 'linear-gradient(90deg, rgba(255,255,255,0.12), transparent)' }} />
                </div>
                <div className="grid grid-cols-4 gap-2">
                  {group.ids.map((id) => {
                    const preset = presetById.get(id);
                    if (!preset) return null;
                    const Icon = preset.icon;
                    const isSelected = activePreset === preset.id;
                    return (
                      <motion.button
                        key={preset.id}
                        onClick={() => handlePresetSelect(preset)}
                        className="relative flex min-h-[74px] flex-col items-center justify-center gap-1.5 py-2.5 px-1 rounded-2xl overflow-hidden"
                        style={{
                          background: isSelected
                            ? 'linear-gradient(160deg, hsl(var(--primary)) 0%, hsl(340 100% 60%) 100%)'
                            : 'linear-gradient(160deg, rgba(255,255,255,0.055) 0%, rgba(255,255,255,0.02) 100%)',
                          border: isSelected
                            ? '1px solid hsl(var(--primary) / 0.9)'
                            : '1px solid rgba(255,255,255,0.06)',
                          boxShadow: isSelected ? '0 10px 30px -10px hsl(var(--primary) / 0.65), inset 0 1px 0 rgba(255,255,255,0.2)' : 'inset 0 1px 0 rgba(255,255,255,0.04)',
                        }}
                        whileTap={{ scale: 0.94 }}
                      >
                        {isSelected && (
                          <motion.span
                            aria-hidden
                            className="absolute inset-0 pointer-events-none"
                            style={{ background: 'radial-gradient(circle at 50% 0%, rgba(255,255,255,0.35), transparent 55%)' }}
                            initial={{ opacity: 0 }} animate={{ opacity: 1 }}
                          />
                        )}
                        <Icon className={`w-[18px] h-[18px] relative z-10 ${isSelected ? 'text-white drop-shadow-[0_1px_6px_rgba(255,255,255,0.6)]' : 'text-white/70'}`} />
                        <span className={`relative z-10 text-[10.5px] font-semibold leading-tight text-center ${isSelected ? 'text-white' : 'text-white/75'}`}>
                          {preset.name}
                        </span>
                      </motion.button>
                    );
                  })}
                </div>
              </div>
            ))}

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
                    {[0.5, 1, 1.5, 2].map(s => (
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
