import type { TasteProfile } from '@/lib/feedPersonalizer';
import { topTasteArtists, topTasteKeywords } from '@/lib/feedPersonalizer';

/**
 * Taste clusters → real, named shelves.
 *
 * A shelf only exists when there is a concrete reason for it, and that reason
 * IS the title ("Because you listened to Arijit Singh"), the way YouTube Music
 * and Spotify structure a personalised home page. We never invent a cluster to
 * fill a slot: with thin signals the caller simply gets fewer shelves.
 */
export interface ShelfSpec {
  /** Stable key for react-query + list keys. */
  id: string;
  /** Shown as the shelf heading — the specific reason it exists. */
  title: string;
  /** Secondary line explaining the signal behind it. */
  subtitle: string;
  /** Search seeds used to build the shelf. */
  queries: string[];
  /** Artist name to exclude-match against, when the cluster is artist-based. */
  anchorArtist?: string;
}

const titleCase = (v: string) =>
  v.replace(/\S+/g, (w) => w.charAt(0).toUpperCase() + w.slice(1));

/**
 * Build up to `max` distinct shelves from signals we actually have.
 *
 * Priority order reflects signal strength:
 *  1. Most-played artists ("Because you listened to …") — the strongest,
 *     most legible reason a recommendation exists.
 *  2. Artists the listener explicitly followed ("New from …") — a commitment
 *     signal, so fresh material from them is always welcome.
 *  3. Recurring title keywords ("More <keyword>") — weakest, used to widen
 *     the page only when the stronger clusters can't fill it.
 */
export function buildTasteShelves(
  profile: TasteProfile,
  followedArtists: string[],
  max = 3,
): ShelfSpec[] {
  const shelves: ShelfSpec[] = [];
  const usedArtists = new Set<string>();

  for (const artist of topTasteArtists(profile, 4)) {
    if (shelves.length >= max) break;
    const key = artist.trim().toLowerCase();
    if (!key || usedArtists.has(key)) continue;
    usedArtists.add(key);
    const name = titleCase(artist);
    shelves.push({
      id: `listened:${key}`,
      title: `Because you listened to ${name}`,
      subtitle: 'Similar artists and songs',
      queries: [`${artist} songs`, `artists similar to ${artist}`],
      anchorArtist: artist,
    });
  }

  for (const artist of followedArtists.slice(0, 3)) {
    if (shelves.length >= max) break;
    const key = artist.trim().toLowerCase();
    if (!key || usedArtists.has(key)) continue;
    usedArtists.add(key);
    shelves.push({
      id: `following:${key}`,
      title: `New from ${titleCase(artist)}`,
      subtitle: 'From an artist you follow',
      queries: [`${artist} new songs`, `${artist} latest songs`],
      anchorArtist: artist,
    });
  }

  for (const keyword of topTasteKeywords(profile, 3)) {
    if (shelves.length >= max) break;
    const key = keyword.trim().toLowerCase();
    if (key.length < 3) continue;
    shelves.push({
      id: `keyword:${key}`,
      title: `More ${titleCase(keyword)}`,
      subtitle: 'Keeps showing up in what you play',
      queries: [`${keyword} songs`],
    });
  }

  return shelves;
}
