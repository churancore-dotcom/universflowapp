import { describe, it, expect, vi } from 'vitest';
import { playerProgressStore as s } from './playerProgressStore';

describe('progress estimate follows playback speed', () => {
  it('advances 2s of song per 1s at 2x', () => {
    vi.useFakeTimers({ toFake: ['performance'] });
    s.reset(); s.setDuration(100); s.setPlaying(true); s.setProgress(10); s.setRate(2);
    vi.advanceTimersByTime(1000);
    expect(s.getEstimatedProgress()).toBeCloseTo(12, 1);
    s.setRate(1);
    vi.useRealTimers();
  });
});
