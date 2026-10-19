import { describe, expect, it } from 'vitest';
import { canExtendQueue, overlapSeconds, transitionGains } from '../playbackTransitions';

describe('playback transitions', () => {
  for (const curve of ['linear', 'equal-power', 'smooth', 'exponential'] as const) {
    it(`${curve} fades the outgoing down and incoming up`, () => {
      expect(transitionGains(curve, 0)).toEqual({ outgoing: 1, incoming: 0 });
      expect(transitionGains(curve, 1).outgoing).toBeCloseTo(0);
      expect(transitionGains(curve, 1).incoming).toBeCloseTo(1);
      let prior = transitionGains(curve, 0);
      for (let step = 1; step <= 100; step++) {
        const gains = transitionGains(curve, step / 100);
        expect(gains.outgoing).toBeLessThanOrEqual(prior.outgoing);
        expect(gains.incoming).toBeGreaterThanOrEqual(prior.incoming);
        prior = gains;
      }
    });
  }
  it('autoplay off prevents recommendations at queue end', () => {
    expect(canExtendQueue(false, false, 'off')).toBe(false);
    expect(canExtendQueue(true, false, 'off')).toBe(true);
  });
  it('curated collections never extend automatically', () => {
    expect(canExtendQueue(true, true, 'off')).toBe(false);
  });
  it('Gapless Pro overlaps 0.45 seconds and crossfade takes precedence', () => {
    expect(overlapSeconds(false, 6, true, 'off')).toBe(0.45);
    expect(overlapSeconds(true, 6, true, 'off')).toBe(6);
    expect(overlapSeconds(false, 6, false, 'off')).toBe(0);
  });
  it('repeat one never overlaps into another song', () => {
    expect(overlapSeconds(true, 6, true, 'one')).toBe(0);
  });
});