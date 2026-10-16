import { isAiGeneratedTrack } from './aiSlopFilter';
import { duplicateIds } from './catalogQuality';

export type CatalogFilter = 'all' | 'visible' | 'hidden' | 'ai-review' | 'trending' | 'releases' | 'missing-audio' | 'missing-cover' | 'duplicates';
type CatalogRow = { id?: string; title: string; artist: string; album?: string | null; audio_url?: string | null; cover_url?: string | null; is_visible: boolean; show_in_trending?: boolean; show_in_new_releases?: boolean };

export function filterCatalog<T extends CatalogRow>(rows: T[], query: string, filter: CatalogFilter): T[] {
  const search = query.trim().toLowerCase();
  const duplicates = filter === 'duplicates' ? duplicateIds(rows.map((row, i) => ({ ...row, id: row.id || String(i) }))) : new Set<string>();
  return rows.filter((row, i) => {
    if (search && !`${row.title} ${row.artist} ${row.album || ''}`.toLowerCase().includes(search)) return false;
    if (filter === 'visible') return row.is_visible;
    if (filter === 'hidden') return !row.is_visible;
    if (filter === 'ai-review') return isAiGeneratedTrack(row);
    if (filter === 'missing-audio') return !row.audio_url?.trim();
    if (filter === 'missing-cover') return !row.cover_url?.trim();
    if (filter === 'duplicates') return duplicates.has(row.id || String(i));
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