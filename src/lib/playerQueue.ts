export type QueueSongIdentity = {
  id?: string | null;
  title?: string | null;
  artist?: string | null;
};

const cleanIdentityPart = (value?: string | null) =>
  (value || '')
    .toLowerCase()
    .replace(/\([^)]*\)|\[[^\]]*\]/g, ' ')
    .replace(/\b(official|video|audio|lyrics?|lyrical|full song|hd|4k|remaster(?:ed)?|visualizer|mv)\b/g, ' ')
    .replace(/[^a-z0-9]+/g, '');

/** Stable content identity across providers (catalog, Audius, and JioSaavn). */
export const getQueueFingerprint = (song: QueueSongIdentity) => {
  const title = cleanIdentityPart(song.title);
  const primaryArtist = cleanIdentityPart((song.artist || '').split(/[,&/]|feat|ft\./i)[0]);
  if (title || primaryArtist) return `${title}~${primaryArtist}`;
  return cleanIdentityPart(song.id) || 'unknown';
};

/** Keep the first occurrence so a selected track's queue position remains stable. */
export const dedupePlayerQueue = <T extends QueueSongIdentity>(songs: T[]): T[] => {
  const seen = new Set<string>();
  return songs.filter((song) => {
    const fingerprint = getQueueFingerprint(song);
    if (seen.has(fingerprint)) return false;
    seen.add(fingerprint);
    return true;
  });
};

export const getNativeQueueMediaId = (song: QueueSongIdentity, index: number) =>
  `q${index}::${getQueueFingerprint(song)}`;

export const findNativeQueueIndex = <T extends QueueSongIdentity>(songs: T[], mediaId: string) =>
  songs.findIndex((song, index) => getNativeQueueMediaId(song, index) === mediaId);