/**
 * Tracks blocked app-wide by request. Matched on title (and optional artist)
 * so they never appear in history, feeds, queues or search results.
 */
const BLOCKED_TITLE_PATTERNS = [/\bbarba+d+i\b/i];

export function isBlockedTrack(title?: string | null, artist?: string | null): boolean {
  const haystack = `${title ?? ''} ${artist ?? ''}`;
  if (!haystack.trim()) return false;
  return BLOCKED_TITLE_PATTERNS.some((re) => re.test(haystack));
}

export function dropBlockedTracks<T extends { title?: string | null; artist?: string | null }>(
  items: T[],
): T[] {
  return items.filter((item) => !isBlockedTrack(item?.title, item?.artist));
}
