export type QualityRow = { id: string; title: string; artist: string; audio_url?: string | null; cover_url?: string | null; created_at?: string; play_count?: number; is_visible: boolean };
export type CatalogSort = 'newest' | 'oldest' | 'title' | 'plays';
export function duplicateIds(rows: QualityRow[]): Set<string> {
  const groups = new Map<string, string[]>();
  for (const row of rows) {
    const key = `${row.title.trim().toLowerCase()}\u0000${row.artist.trim().toLowerCase()}`;
    groups.set(key, [...(groups.get(key) || []), row.id]);
  }
  return new Set([...groups.values()].filter(ids => ids.length > 1).flat());
}
export function sortCatalog<T extends QualityRow>(rows: T[], sort: CatalogSort): T[] {
  return [...rows].sort((a, b) => {
    if (sort === 'title') return a.title.localeCompare(b.title) || a.id.localeCompare(b.id);
    if (sort === 'plays') return (b.play_count || 0) - (a.play_count || 0) || a.id.localeCompare(b.id);
    const order = (a.created_at || '').localeCompare(b.created_at || '');
    return (sort === 'oldest' ? order : -order) || a.id.localeCompare(b.id);
  });
}
export function bulkVisibilityTargets<T extends QualityRow>(rows: T[], selected: string[], visible: boolean): T[] {
  const ids = new Set(selected);
  return rows.filter(row => ids.has(row.id) && row.is_visible !== visible);
}