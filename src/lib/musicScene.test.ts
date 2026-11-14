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

import { rerank, type TasteProfile } from './feedPersonalizer';
import { detectStyles, setSceneAccount, setWantedScenes, feedAllows } from './musicScene';

const profile = (p: Partial<TasteProfile>): TasteProfile => ({ artists: new Map(), keywords: new Map(), skips: new Map(), signalCount: 20, ...p });

describe('taste ranking beyond genres', () => {
  it('detects languages and styles', () => {
    expect(detectStyles({ title: 'Softly', artist: 'Karan Aujla' })).toContain('punjabi');
    expect(detectStyles({ title: 'Chuttamalle', artist: 'Anirudh Ravichander' })).toContain('tamil');
  });
  it('a Punjabi listener gets Punjabi songs ranked first', () => {
    const songs = [{ title: 'Song A', artist: 'Taylor Swift' }, { title: 'Song B', artist: 'Arijit Singh' }, { title: 'Song C', artist: 'Karan Aujla' }];
    const out = rerank(songs, profile({ styles: new Map([['punjabi', 40]]), positiveTotal: 50 }));
    expect(out[0].artist).toBe('Karan Aujla');
  });
  it('liked artists outrank, skipped artists sink', () => {
    const songs = [{ title: 'One', artist: 'Skipped Guy' }, { title: 'Two', artist: 'Other' }, { title: 'Three', artist: 'Fav' }];
    const out = rerank(songs, profile({ artists: new Map([['fav', 30]]), skips: new Map([['skipped guy', 2]]) }));
    expect(out[0].artist).toBe('Fav');
    expect(out[out.length - 1].artist).toBe('Skipped Guy');
  });
  it('keeps preferences separate per account', () => {
    setSceneAccount('user-a'); setWantedScenes(new Set(['bhojpuri']));
    expect(feedAllows({ title: 'x', artist: 'Pawan Singh' })).toBe(true);
    setSceneAccount('user-b');
    expect(feedAllows({ title: 'x', artist: 'Pawan Singh' })).toBe(false);
  });
});

import { detectScene as detect2 } from './musicScene';
import { isJunkRailTrack } from './railQuality';
describe('India chart noise', () => {
  it('recognises devotional and regional chart uploads', () => {
    expect(detect2({ title: 'के सुनतै दुख छठी मैया', artist: 'Amit Aashik' })).not.toBeNull();
    expect(detect2({ title: 'Kuber Mantra, Kubera Ashta Lakshmi', artist: 'DRC Bhakti Music' })).toBe('devotional');
    expect(detect2({ title: 'KOOD KOOD NACHIYE Masoom Sharma', artist: 'Kabootar Records' })).toBe('haryanvi');
    expect(detect2({ title: 'Tu Mil Jaaye (From "KING")', artist: 'Arijit Singh' })).toBeNull();
  });
  it('drops film teasers from song rails', () => {
    expect(isJunkRailTrack({ title: "Vetri Maaran's Arasan 'FIRE' Glimpse", artist: 'Kalaippuli S Thanu', duration: 120 })).toBe(true);
  });
});
