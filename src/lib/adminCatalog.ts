import { isAiGeneratedTrack } from './aiSlopFilter';

export type CatalogFilter = 'all' | 'visible' | 'hidden' | 'ai-review' | 'trending' | 'releases';
type CatalogRow = { title: string; artist: string; album?: string | null; is_visible: boolean; show_in_trending?: boolean; show_in_new_releases?: boolean };

export function filterCatalog<T extends CatalogRow>(rows: T[], query: string, filter: CatalogFilter): T[] {
  const search = query.trim().toLowerCase();
  return rows.filter(row => {
    if (search && !`${row.title} ${row.artist} ${row.album || ''}`.toLowerCase().includes(search)) return false;
    if (filter === 'visible') return row.is_visible;
    if (filter === 'hidden') return !row.is_visible;
    if (filter === 'ai-review') return isAiGeneratedTrack(row);
    if (filter === 'trending') return row.show_in_trending === true;
    if (filter === 'releases') return row.show_in_new_releases === true;
    return true;
  });
}

export function csvCell(value: unknown): string {
  const text = String(value ?? '');
  const safe = /^[\s]*[=+@-]/.test(text) ? `'${text}` : text;
  return `"${safe.replace(/"/g, '""')}"`;
}