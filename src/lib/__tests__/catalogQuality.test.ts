import { describe, expect, it } from 'vitest';
import { duplicateIds, sortCatalog, bulkVisibilityTargets } from '../catalogQuality';
const rows = [
  { id: 'a', title: 'Song', artist: 'Artist', is_visible: true, play_count: 2, created_at: '2026-10-01' },
  { id: 'b', title: ' song ', artist: 'ARTIST', is_visible: false, play_count: 10, created_at: '2026-10-03' },
  { id: 'c', title: 'Other', artist: 'Artist', is_visible: true, play_count: 5, created_at: '2026-10-02' },
];
describe('catalog quality and bulk targeting', () => {
  it('flags all potential duplicates ignoring case and outer spaces', () => expect([...duplicateIds(rows)]).toEqual(['a', 'b']));
  it('does not flag different artists as duplicates', () => expect(duplicateIds([rows[0], { ...rows[1], artist: 'Different' }]).size).toBe(0));
  it('sorts newest first without mutating the catalog', () => { expect(sortCatalog(rows, 'newest').map(r => r.id)).toEqual(['b', 'c', 'a']); expect(rows[0].id).toBe('a'); });
  it('sorts recorded plays descending', () => expect(sortCatalog(rows, 'plays').map(r => r.id)).toEqual(['b', 'c', 'a']));
  it('hides only selected visible rows, never unselected rows', () => expect(bulkVisibilityTargets(rows, ['a', 'b', 'missing'], false).map(r => r.id)).toEqual(['a']));
  it('shows only selected hidden rows', () => expect(bulkVisibilityTargets(rows, ['a', 'b'], true).map(r => r.id)).toEqual(['b']));
});