import { describe, it, expect } from 'vitest';
import { detectScene, wantedScenes, allowedForListener } from './musicScene';

describe('regional scene personalisation', () => {
  it('detects Bhojpuri by artist or title', () => {
    expect(detectScene({ title: 'Lollypop Lagelu', artist: 'Pawan Singh' })).toBe('bhojpuri');
    expect(detectScene({ title: 'New Bhojpuri Song 2026', artist: 'Someone' })).toBe('bhojpuri');
    expect(detectScene({ title: 'Kesariya', artist: 'Arijit Singh' })).toBeNull();
  });
  it('hides Bhojpuri from a listener who never plays it', () => {
    const wanted = wantedScenes(new Map(), 40);
    expect(allowedForListener({ title: 'X', artist: 'Khesari Lal Yadav' }, wanted)).toBe(false);
    expect(allowedForListener({ title: 'Kesariya', artist: 'Arijit Singh' }, wanted)).toBe(true);
  });
  it('shows Bhojpuri to a real Bhojpuri listener', () => {
    const wanted = wantedScenes(new Map([['bhojpuri', 12]]), 40);
    expect(allowedForListener({ title: 'X', artist: 'Pawan Singh' }, wanted)).toBe(true);
  });
  it('one accidental play is not enough', () => {
    expect(wantedScenes(new Map([['bhojpuri', 1]]), 100).has('bhojpuri')).toBe(false);
  });
});
