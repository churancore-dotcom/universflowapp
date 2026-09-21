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

/**
 * Words that mark a genuinely different recording of the same song. These stay
 * part of the identity so a Reprise, Live or Unplugged cut is never collapsed
 * into the studio version.
 */
const VARIANT_WORDS =
  /\b(reprise|live|unplugged|acoustic|instrumental|karaoke|remix|mix|version|edit|slowed|reverb|lofi|lo-fi|cover|mashup|medley|extended|radio|club|female|male|duet|title track|theme|sped up|bass boosted)\b/g;

/** Extract version markers (from anywhere in the title, including brackets). */
const getVariantTag = (title?: string | null) => {
  const matches = (title || '').toLowerCase().match(VARIANT_WORDS);
  if (!matches) return '';
  return Array.from(new Set(matches.map((m) => m.replace(/[^a-z0-9]+/g, '')))).sort().join('.');
};

/** Stable content identity across providers (catalog, Audius, and JioSaavn). */
export const getQueueFingerprint = (song: QueueSongIdentity) => {
  const title = cleanIdentityPart(song.title);
  const primaryArtist = cleanIdentityPart((song.artist || '').split(/[,&/]|feat|ft\./i)[0]);
  const variant = getVariantTag(song.title);
  if (title || primaryArtist) return `${title}~${primaryArtist}${variant ? `~${variant}` : ''}`;
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

export const findNativeQueueIndex = <T extends QueueSongIdentity>(songs: T[], mediaId: string) => {
  const exact = songs.findIndex((song, index) => getNativeQueueMediaId(song, index) === mediaId);
  if (exact >= 0) return exact;
  const separator = mediaId.indexOf('::');
  const fingerprint = separator >= 0 ? mediaId.slice(separator + 2) : mediaId;
  if (!fingerprint) return -1;
  return songs.findIndex((song) => getQueueFingerprint(song) === fingerprint);
};