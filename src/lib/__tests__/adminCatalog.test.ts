import { describe, expect, it } from 'vitest';
import { csvCell, filterCatalog } from '../adminCatalog';

const rows = [
  { title: 'Real Song', artist: 'Artist', album: 'New Album', is_visible: true, show_in_trending: true, show_in_new_releases: false },
  { title: 'AI-generated music', artist: 'Uploader', is_visible: false, show_in_trending: false, show_in_new_releases: true },
];
describe('admin catalog review', () => {
  it('finds missing audio without marking a populated URL missing', () => expect(filterCatalog([{ ...rows[0], audio_url: ' ' }, { ...rows[1], audio_url: 'https://example.com/audio.mp3' }], '', 'missing-audio').map(r => r.title)).toEqual(['Real Song']));
  it('finds missing covers without marking a populated URL missing', () => expect(filterCatalog([{ ...rows[0], cover_url: null }, { ...rows[1], cover_url: 'https://example.com/cover.jpg' }], '', 'missing-cover').map(r => r.title)).toEqual(['Real Song']));
  it('finds disclosed synthetic tracks for review', () => expect(filterCatalog(rows, '', 'ai-review').map(r => r.title)).toEqual(['AI-generated music']));
  it('filters hidden songs', () => expect(filterCatalog(rows, '', 'hidden').length).toBe(1));
  it('filters trending placements', () => expect(filterCatalog(rows, '', 'trending').map(r => r.title)).toEqual(['Real Song']));
  it('filters release placements', () => expect(filterCatalog(rows, '', 'releases').map(r => r.title)).toEqual(['AI-generated music']));
  it('searches album metadata case-insensitively', () => expect(filterCatalog(rows, 'NEW ALBUM', 'all').length).toBe(1));
  it('neutralizes spreadsheet formulas', () => expect(csvCell('=1+1')).toBe('"\'=1+1"'));
  it('escapes embedded quotes', () => expect(csvCell('A "song"')).toBe('"A ""song"""'));
});