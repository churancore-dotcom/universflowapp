/**
 * Shared registry of playable local URLs for downloaded songs.
 *
 * DownloadContext owns the actual blobs/files; the player needs to find a
 * downloaded song's local URL even when the tap/auto-advance path did not
 * pass one (e.g. queue restore after an app restart, where old blob: URLs
 * are dead). Keeping the lookup in a tiny module avoids coupling
 * PlayerContext to DownloadContext's React tree.
 */

const urls = new Map<string, string>();

export function registerOfflineUrl(songId: string, url: string): void {
  if (songId && url) urls.set(songId, url);
}

export function getOfflineUrl(songId: string | null | undefined): string | null {
  if (!songId) return null;
  return urls.get(songId) ?? null;
}

export function unregisterOfflineUrl(songId: string): void {
  urls.delete(songId);
}

export function clearOfflineUrlRegistry(): void {
  urls.clear();
}
