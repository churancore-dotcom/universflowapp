import { expect, it, vi } from 'vitest';
import { useAutoEQ } from '../../hooks/useAutoEQ';

const state = vi.hoisted(() => ({ song: { id: 'one', title: 'Pop Song', artist: 'Singer' }, write: vi.fn() }));
// Execute the effect for each simulated track change without a DOM renderer.
vi.mock('react', () => ({ useEffect: (effect: () => void) => effect() }));
vi.mock('@/contexts/PlayerContext', () => ({ usePlayer: () => ({ currentSong: state.song }) }));
vi.mock('@/lib/premiumState', () => ({ getRuntimePremium: () => true }));
vi.mock('@/lib/eqSettings', () => ({
  getEQSettings: () => ({ activePreset: 'auto', spatialAudio: true, headphoneSurround: true, reverb: 20, studioSpace: 'hall', playbackSpeed: 1.25 }),
  setEQSettings: state.write,
}));

it('auto EQ changes tonal bands without resetting spatial or room effects on the next song', () => {
  useAutoEQ();
  state.song = { id: 'two', title: 'Rock Song', artist: 'Singer' };
  useAutoEQ();
  expect(state.write).toHaveBeenLastCalledWith({
    bands: [5, 4, 3, 1, -1, -1, 1, 3, 4, 4], bassBoost: 20, activePreset: 'auto',
  });
  for (const [patch] of state.write.mock.calls) {
    expect(patch).not.toHaveProperty('spatialAudio');
    expect(patch).not.toHaveProperty('headphoneSurround');
    expect(patch).not.toHaveProperty('studioSpace');
    expect(patch).not.toHaveProperty('playbackSpeed');
  }
});