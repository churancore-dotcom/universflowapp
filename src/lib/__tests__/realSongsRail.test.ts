import { describe, it, expect } from 'vitest';
import { isJunkRailTrack } from '@/lib/railQuality';

describe('Home rails keep only real releases', () => {
  it('drops "Trending Version" re-uploads', () => {
    expect(isJunkRailTrack({ title: 'Nee Paartha Vizhigal (Trending Version)', artist: 'Anirudh Ravichander', duration: 200 })).toBe(true);
  });
  it('drops lofi/female re-versions and bass boosted uploads', () => {
    expect(isJunkRailTrack({ title: 'Kesariya (Lofi Version)', artist: 'X', duration: 200 })).toBe(true);
    expect(isJunkRailTrack({ title: 'Tum Hi Ho Female Version', artist: 'Y', duration: 200 })).toBe(true);
    expect(isJunkRailTrack({ title: 'Song Bass Boosted', artist: 'Z', duration: 200 })).toBe(true);
  });
  it('drops AI-made tracks', () => {
    expect(isJunkRailTrack({ title: 'Love Song (AI Cover)', artist: 'Someone', duration: 200 })).toBe(true);
  });
  it('keeps an original release', () => {
    expect(isJunkRailTrack({ title: 'Guzarish', artist: 'Satinder Sartaaj', duration: 220 })).toBe(false);
  });
});
