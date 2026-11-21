import { describe, expect, it } from 'vitest';
import { baseTitle, buildOriginalIndex, isUnrequestedVersion, originalAdjustment, ORIGINAL_BONUS, SOUNDALIKE_PENALTY, VERSION_PENALTY } from '../searchOriginals';

const song = (title: string, artist: string, id = `${title}-${artist}`) => ({ id, title, artist, kind: 'song' as const });

describe('search prefers original recordings', () => {
  const results = [
    song('Blinding Lights', 'The Weeknd'),
    song('Blinding Lights (Afro Soul)', 'Ruvé'),
    song('Blinding Lights', 'Tony Production'),
  ];
  const originals = buildOriginalIndex(results, 'blinding lights');

  it('lifts the original artist recording', () => {
    expect(originalAdjustment(results[0]!, 'blinding lights', originals)).toBe(ORIGINAL_BONUS);
  });

  it('pushes a same-title soundalike by another artist down', () => {
    expect(originalAdjustment(results[2]!, 'blinding lights', originals)).toBe(-SOUNDALIKE_PENALTY);
  });

  it('pushes an unrequested afro version down', () => {
    expect(originalAdjustment(results[1]!, 'blinding lights', originals)).toBe(-VERSION_PENALTY - SOUNDALIKE_PENALTY);
  });

  it('keeps a version the listener asked for', () => {
    expect(isUnrequestedVersion('Blinding Lights (Afro Soul)', 'blinding lights afro')).toBe(false);
  });

  it('does not treat film credits or featuring as a version', () => {
    expect(isUnrequestedVersion('Kesariya (From "Brahmastra")', 'kesariya')).toBe(false);
    expect(baseTitle('Kesariya (From "Brahmastra")')).toBe('kesariya');
  });

  it('treats JioSaavn catalogue songs as studio recordings', () => {
    const index = buildOriginalIndex([{ id: 'saavn-1', title: 'Tum Hi Ho', artist: 'Arijit Singh' }], 'tum hi ho');
    expect(index.get('tum hi ho')).toEqual(['Arijit Singh']);
  });

  it('accepts the singer credit from a second catalogue as original', () => {
    const tracks = [song('Tum Hi Ho', 'Mithoon'), { id: 'saavn-2', title: 'Tum Hi Ho', artist: 'Arijit Singh' }];
    const index = buildOriginalIndex(tracks, 'tum hi ho');
    expect(originalAdjustment(tracks[1]!, 'tum hi ho', index)).toBe(ORIGINAL_BONUS);
  });

  it('does not penalise a widely played same-title song', () => {
    const popular = { ...song('Blinding Lights', 'Other Singer'), listeners: 2_000_000 };
    expect(originalAdjustment(popular, 'blinding lights', originals)).toBe(0);
  });

  it('does not penalise a cover artist the listener searched for', () => {
    expect(originalAdjustment(results[2]!, 'blinding lights tony production', originals)).toBe(0);
  });
});