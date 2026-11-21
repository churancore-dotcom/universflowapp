/**
 * Original-recording preference for search.
 *
 * YouTube Music's Songs shelf returns the original first, then many studio
 * "audio" uploads of the same title by other people (soundalike covers, afro /
 * techno / salsa versions). Those are tagged exactly like the original, so the
 * ranker must recognise them from the title and artist instead of trusting
 * the song tag alone. Pure helpers so the rules stay testable.
 */

export interface RankableTrack {
  id?: string;
  title?: string | null;
  artist?: string | null;
  kind?: 'song' | 'video';
  source?: string;
  listeners?: number;
}

const normalize = (value = '') =>
  value.toLowerCase().normalize('NFKD').replace(/[\u0300-\u036f]/g, '').replace(/[^\p{L}\p{N}]+/gu, ' ').trim();

/** Version words that mark a re-recording/edit when the listener didn't ask for one. */
const VERSION_WORD = /\b(version|edit|mix|remix|cover|afro|techno|house|salsa|violin|piano|guitar|acoustic|unplugged|reprise|vocal|female|male|edition|instrumental|karaoke|lofi|lo fi|slowed|sped|reverb|8d|bass|flip|rework|bootleg|tribute|dance|lullaby|orchestral)\b/;

/** Song name without brackets, featuring credits or " - " suffixes. */
export function baseTitle(title = ''): string {
  return normalize(
    title
      .replace(/\([^)]*\)|\[[^\]]*\]/g, ' ')
      .replace(/\s(feat|ft)\.?\s.*$/i, ' ')
      .split(/\s+[-–—|]\s+/)[0] || '',
  );
}

/** The decorated part of a title: bracket contents and anything after " - ". */
function titleDecorations(title = ''): string {
  const brackets = (title.match(/\([^)]*\)|\[[^\]]*\]/g) || []).join(' ');
  const suffix = title.split(/\s+[-–—|]\s+/).slice(1).join(' ');
  return normalize(`${brackets} ${suffix}`);
}

/** True when the title is a remix/cover/edit version the query did not ask for. */
export function isUnrequestedVersion(title: string | null | undefined, query: string): boolean {
  const decorations = titleDecorations(title || '');
  const match = decorations.match(VERSION_WORD);
  if (!match) return false;
  return !normalize(query).includes(match[1]);
}

/** Studio recordings: YouTube Music songs, JioSaavn catalogue and artist uploads. */
export function isStudioRecording(track: RankableTrack): boolean {
  return track.kind === 'song' || String(track.id || '').startsWith('saavn-') || track.source === 'artist_upload';
}

const primaryArtist = (artist = '') => normalize(artist.split(/,|&|\bx\b|\bfeat\.?|\bft\.?|\band\b/i)[0] || '');

function sameArtist(a = '', b = ''): boolean {
  const pa = primaryArtist(a);
  const full = normalize(b);
  const pb = primaryArtist(b);
  return !!pa && !!pb && (full.includes(pa) || normalize(a).includes(pb));
}

/**
 * The artists of the first un-decorated studio recording for each song name,
 * in provider order (YouTube Music already puts the original first). Each
 * catalogue gets one vote because they credit the same song differently.
 */
export function buildOriginalIndex(tracks: RankableTrack[], query: string): Map<string, string[]> {
  const index = new Map<string, string[]>();
  const voted = new Set<string>();
  for (const track of tracks) {
    if (!isStudioRecording(track) || isUnrequestedVersion(track.title, query)) continue;
    const key = baseTitle(track.title || '');
    const catalogue = String(track.id || '').startsWith('saavn-') ? 'saavn' : 'youtube';
    if (!key || voted.has(`${catalogue}:${key}`)) continue;
    voted.add(`${catalogue}:${key}`);
    index.set(key, [...(index.get(key) || []), track.artist || '']);
  }
  return index;
}

export const ORIGINAL_BONUS = 600;
export const SOUNDALIKE_PENALTY = 650;
export const VERSION_PENALTY = 600;
/** Listening counts above this prove a recording is widely heard, not a soundalike. */
export const PROVEN_LISTENERS = 100_000;

/** Score change that lifts the original and pushes covers/versions below it. */
export function originalAdjustment(track: RankableTrack, query: string, originals: Map<string, string[]>): number {
  let score = 0;
  if (isUnrequestedVersion(track.title, query)) score -= VERSION_PENALTY;
  const artists = originals.get(baseTitle(track.title || ''));
  if (!artists) return score;
  if (artists.some((original) => sameArtist(track.artist || '', original))) return score + ORIGINAL_BONUS;
  if (Number(track.listeners || 0) >= PROVEN_LISTENERS) return score;
  // A different artist for the same song name is a cover/soundalike unless the
  // listener searched for that artist.
  const query_ = normalize(query);
  const artist = primaryArtist(track.artist || '');
  if (artist && query_.includes(artist)) return score;
  return score - SOUNDALIKE_PENALTY;
}