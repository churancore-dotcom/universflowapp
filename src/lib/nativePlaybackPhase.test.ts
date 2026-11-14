import { describe, it, expect } from 'vitest';
import { confirmsNativeStart, showsPlayIntent } from './nativePlaybackPhase';

describe('native starting vs playing', () => {
  it('starting shows intent but does not confirm audio', () => {
    expect(showsPlayIntent('starting')).toBe(true);
    expect(confirmsNativeStart('starting')).toBe(false);
  });
  it('only playing confirms start', () => {
    expect(confirmsNativeStart('playing')).toBe(true);
    expect(confirmsNativeStart('buffering')).toBe(false);
    expect(showsPlayIntent('paused')).toBe(false);
  });
});
