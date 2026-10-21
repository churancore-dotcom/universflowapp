import { describe, expect, it } from 'vitest';
import { nativeSpatialSettings } from '../nativeSpatialSettings';

describe('independent native spatial controls', () => {
  it('8D enables rotation without enabling headphone crossfeed', () => {
    expect(nativeSpatialSettings({ spatialAudio: true, headphoneSurround: false }))
      .toEqual({ spatialStrength: 1000, surroundStrength: 0 });
  });
  it('3D enables headphone crossfeed without enabling rotation', () => {
    expect(nativeSpatialSettings({ spatialAudio: false, headphoneSurround: true }))
      .toEqual({ spatialStrength: 0, surroundStrength: 1000 });
  });
  it('both controls survive a repeated track snapshot unchanged', () => {
    const snapshot = { spatialAudio: true, headphoneSurround: true };
    expect(nativeSpatialSettings(snapshot)).toEqual({ spatialStrength: 1000, surroundStrength: 1000 });
    expect(nativeSpatialSettings({ ...snapshot })).toEqual(nativeSpatialSettings(snapshot));
  });
});