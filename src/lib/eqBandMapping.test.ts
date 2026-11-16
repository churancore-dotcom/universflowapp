import { describe, it, expect } from 'vitest';
import { blendWebBandsForNativeBand } from './nativePlayer';
const F = [32, 64, 125, 250, 500, 1000, 2000, 4000, 8000, 16000];
describe('APK EQ slider mapping', () => {
  it('a +12 dB 1 kHz slider reaches the 1 kHz band at full +12 dB', () => {
    expect(blendWebBandsForNativeBand([0, 0, 0, 0, 0, 12, 0, 0, 0, 0], F, 1000)).toBe(12);
  });
  it('does not leak into neighbouring bands', () => {
    expect(blendWebBandsForNativeBand([0, 0, 0, 0, 0, 12, 0, 0, 0, 0], F, 2000)).toBe(0);
  });
  it('the 32 Hz slider maps to the 31 Hz band', () => {
    expect(blendWebBandsForNativeBand([9, 0, 0, 0, 0, 0, 0, 0, 0, 0], F, 31)).toBe(9);
  });
});
