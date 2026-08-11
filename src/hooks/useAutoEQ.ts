import { useEffect } from 'react';
import { usePlayer } from '@/contexts/PlayerContext';
import { getEQSettings, setEQSettings } from '@/lib/eqSettings';

// Same catalog as EqualizerModal — kept small so the hook is standalone.
// If the modal preset list changes, mirror the ids/bands here.
type AutoPreset = {
  id: string;
  bands: number[];
  bassBoost: number;
  reverb?: number;
  spatialAudio?: boolean;
  studioSpace?: 'off' | 'vinyl' | 'studio' | 'bedroom' | 'hall' | 'cathedral' | 'stadium';
  lateNight?: boolean;
  headphoneSurround?: boolean;
};

const CATALOG: Record<string, AutoPreset> = {
  flat:       { id: 'flat',       bands: [0, 0, 0, 0, 0, 0, 0, 0, 0, 0], bassBoost: 0 },
  pop:        { id: 'pop',        bands: [1, 2, 1, 0, 0, 1, 2, 3, 2, 1], bassBoost: 18 },
  rock:       { id: 'rock',       bands: [5, 4, 3, 1, -1, -1, 1, 3, 4, 4], bassBoost: 20 },
  hiphop:     { id: 'hiphop',     bands: [6, 5, 2, 1, -1, -1, 1, 2, 3, 3], bassBoost: 45 },
  rnb:        { id: 'rnb',        bands: [3, 3, 2, 2, -1, -1, 1, 2, 3, 3], bassBoost: 28 },
  edm:        { id: 'edm',        bands: [6, 5, 2, 0, -2, 1, 1, 3, 5, 6], bassBoost: 42 },
  phonk:      { id: 'phonk',      bands: [6, 5, 3, 1, 0, -1, 0, 1, 2, 2], bassBoost: 55 },
  dance:      { id: 'dance',      bands: [5, 6, 3, 0, 0, -1, -1, 0, 4, 5], bassBoost: 38 },
  jazz:       { id: 'jazz',       bands: [3, 2, 1, 2, -1, -1, 0, 1, 2, 3], bassBoost: 10 },
  classical:  { id: 'classical',  bands: [4, 3, 2, 0, 0, 0, -1, 0, 2, 3], bassBoost: 5, studioSpace: 'hall' },
  acoustic:   { id: 'acoustic',   bands: [4, 4, 3, 1, 2, 2, 3, 3, 2, 1], bassBoost: 8 },
  country:    { id: 'country',    bands: [2, 3, 1, 0, 0, 2, 2, 3, 3, 2], bassBoost: 10 },
  reggae:     { id: 'reggae',     bands: [3, 2, 0, -2, -1, 1, 3, 4, 3, 2], bassBoost: 22 },
  latin:      { id: 'latin',      bands: [4, 3, 0, 0, -1, -1, -1, 0, 3, 4], bassBoost: 20 },
  lofi:       { id: 'lofi',       bands: [4, 3, 2, 1, 0, -1, -3, -4, -5, -6], bassBoost: 25, reverb: 18 },
  kpop:       { id: 'kpop',       bands: [3, 4, 2, 0, 0, 1, 2, 4, 4, 3], bassBoost: 28 },
  bollywood:  { id: 'bollywood',  bands: [3, 3, 2, 1, 1, 2, 3, 3, 2, 1], bassBoost: 22 },
  punjabi:    { id: 'punjabi',    bands: [6, 5, 3, 1, 0, 0, 1, 2, 3, 3], bassBoost: 50 },
  workout:    { id: 'workout',    bands: [5, 5, 3, 1, 0, 1, 2, 3, 4, 4], bassBoost: 40 },
  chill:      { id: 'chill',      bands: [2, 2, 1, 1, 0, 0, 1, 2, 2, 1], bassBoost: 12, reverb: 10 },
  focus:      { id: 'focus',      bands: [-1, -1, 0, 1, 2, 2, 1, 0, -1, -2], bassBoost: 0 },
  podcast:    { id: 'podcast',    bands: [-4, -3, -1, 1, 3, 4, 3, 2, 0, -2], bassBoost: 0 },
};

function pickAutoPresetId(song: { title?: string; artist?: string; album?: string } | null): string {
  if (!song) return 'flat';
  const hay = `${song.title || ''} ${song.artist || ''} ${song.album || ''}`.toLowerCase();
  const has = (...w: string[]) => w.some((word) => hay.includes(word));
  if (has('punjabi', 'jatt', 'sidhu', 'diljit', 'karan aujla', 'ap dhillon', 'shubh')) return 'punjabi';
  if (has('lofi', 'lo-fi', 'lo fi', 'chillhop')) return 'lofi';
  if (has('phonk', 'drift')) return 'phonk';
  if (has('edm', 'house', 'trance', 'techno', 'dubstep', 'dnb', 'martin garrix', 'calvin harris', 'david guetta', 'marshmello', 'skrillex')) return 'edm';
  if (has('rock', 'metal', 'metallica', 'linkin park', 'nirvana', 'foo fighters')) return 'rock';
  if (has('hip hop', 'hip-hop', ' rap', 'drake', 'kendrick', 'travis scott', 'kanye', 'eminem', '21 savage', 'future')) return 'hiphop';
  if (has('r&b', 'weeknd', 'sza', 'frank ocean', 'bryson tiller')) return 'rnb';
  if (has('jazz', 'blues', 'coltrane', 'miles davis', 'norah jones')) return 'jazz';
  if (has('classical', 'symphony', 'sonata', 'concerto', 'orchestra', 'bach', 'mozart', 'beethoven', 'chopin')) return 'classical';
  if (has('acoustic', 'unplugged')) return 'acoustic';
  if (has('country', 'morgan wallen', 'luke combs')) return 'country';
  if (has('reggae', 'bob marley', 'dancehall')) return 'reggae';
  if (has('reggaeton', 'bad bunny', 'j balvin', 'shakira', 'karol g')) return 'latin';
  if (has('k-pop', 'kpop', 'bts', 'blackpink', 'twice', 'stray kids', 'newjeans')) return 'kpop';
  if (has('bollywood', 'arijit', 'shreya', 'pritam', 'a.r. rahman', 'atif aslam', 'neha kakkar')) return 'bollywood';
  if (has('party', 'club')) return 'dance';
  if (has('workout', 'gym', 'pump')) return 'workout';
  if (has('chill', 'sleep', 'calm', 'relax', 'ambient')) return 'chill';
  if (has('focus', 'study')) return 'focus';
  if (has('podcast', 'interview')) return 'podcast';
  return 'pop';
}

/**
 * Auto-EQ: whenever the current song changes AND user is in 'auto' mode,
 * re-apply the best-fit preset. Runs at app root so it works even when
 * the equalizer modal is closed.
 */
export function useAutoEQ() {
  const { currentSong } = usePlayer();

  useEffect(() => {
    // Auto EQ follows the same Premium entitlement as the studio equalizer.
    if (!getRuntimePremium()) return;
    const settings = getEQSettings();
    if (settings.activePreset !== 'auto') return;
    const id = pickAutoPresetId(currentSong);
    const p = CATALOG[id] || CATALOG.flat;
    setEQSettings({
      bands: p.bands,
      bassBoost: p.bassBoost,
      reverb: p.reverb ?? 0,
      spatialAudio: !!p.spatialAudio,
      studioSpace: p.studioSpace ?? 'off',
      lateNight: !!p.lateNight,
      headphoneSurround: !!p.headphoneSurround,
      playbackSpeed: 1,
      activePreset: 'auto',
    });
  }, [currentSong?.id]);
}

