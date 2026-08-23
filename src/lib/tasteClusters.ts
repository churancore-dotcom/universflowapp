import type { TasteProfile } from '@/lib/feedPersonalizer';
import { topTasteArtists, topTasteKeywords } from '@/lib/feedPersonalizer';

/**
 * Taste clusters → real, named shelves.
 *
 * A shelf only exists when there is a concrete reason for it, and that reason
 * IS the title ("More Arijit Singh"), the way YouTube Music
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
 *  1. Most-played artists ("More …") — the strongest,
 *     most legible reason a recommendation exists.
 *  2. Artists the listener explicitly followed ("New from …") — a commitment
 *     signal, so fresh material from them is always welcome.
 *  3. Recurring title keywords ("<keyword> Picks") — weakest, used to widen
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
      title: `More ${name}`,
      subtitle: 'Songs and artists in this lane',
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
      title: `${titleCase(artist)} — Latest`,
      subtitle: 'Fresh from an artist you follow',
      queries: [`${artist} new songs`, `${artist} latest songs`],
      anchorArtist: artist,
    });
  }

  // 4. Genre clusters — derived from genre words that actually appear in the
  //    titles/keywords the listener plays, so the shelf is grounded in real
  //    signal rather than an invented category.
  const keywords = topTasteKeywords(profile, 12);
  const genres = keywords.filter((k) => GENRE_LEXICON.has(k.toLowerCase()));
  for (const genre of genres) {
    if (shelves.length >= max) break;
    const key = genre.toLowerCase();
    shelves.push({
      id: `genre:${key}`,
      title: `${titleCase(genre)} Mix`,
      subtitle: 'Built from what you play most',
      queries: [`best ${genre} songs`, `${genre} playlist`],
    });
  }

  // 5. Time-of-day mood cluster, anchored to the listener's own top artist so
  //    it stays personal instead of a generic mood playlist.
  const anchor = topTasteArtists(profile, 1)[0];
  if (shelves.length < max && anchor && profile.signalCount >= 4) {
    const mood = currentMood();
    shelves.push({
      id: `mood:${mood.id}`,
      title: mood.title,
      subtitle: `${mood.subtitle} · around ${titleCase(anchor)}`,
      queries: [`${anchor} ${mood.seed} songs`, `${mood.seed} songs`],
    });
  }

  // 6. Decade cluster — only when a year/decade token shows up in play history.
  if (shelves.length < max) {
    const decade = keywords.map(decadeFromToken).find(Boolean);
    if (decade) {
      shelves.push({
        id: `decade:${decade}`,
        title: `${decade} Rewind`,
        subtitle: 'The era you keep coming back to',
        queries: [`best ${decade} songs`, `${decade} hits`],
      });
    }
  }

  // 7. Weakest fallback: a plain recurring keyword shelf to widen the page.
  for (const keyword of keywords.slice(0, 3)) {
    if (shelves.length >= max) break;
    const key = keyword.trim().toLowerCase();
    if (key.length < 3 || GENRE_LEXICON.has(key)) continue;
    if (shelves.some((s) => s.id === `keyword:${key}`)) continue;
    shelves.push({
      id: `keyword:${key}`,
      title: `${titleCase(keyword)} Picks`,
      subtitle: 'Recurring in your rotation',
      queries: [`${keyword} songs`],
    });
  }

  return shelves;
}

const GENRE_LEXICON = new Set([
  'pop','rock','metal','punk','indie','folk','jazz','blues','soul','funk','disco',
  'house','techno','trance','edm','dubstep','lofi','ambient','classical','opera',
  'rap','hiphop','trap','drill','reggae','reggaeton','afrobeats','amapiano','kpop',
  'bollywood','punjabi','bhojpuri','ghazal','qawwali','sufi','bhangra','desi',
  'country','latin','salsa','emo','grunge','synthwave','phonk','garage','gospel',
]);

function decadeFromToken(token: string): string | null {
  const m = token.match(/^(19[5-9]0|20[0-2]0)s?$/) || token.match(/^([5-9]0|[0-2]0)s$/);
  if (!m) return null;
  const raw = m[1];
  if (raw.length === 4) return `${raw}s`;
  const n = Number(raw);
  return n >= 50 ? `19${raw}s` : `20${raw}s`;
}

function currentMood() {
  const h = new Date().getHours();
  if (h < 6) return { id: 'latenight', title: 'Late Night', subtitle: 'Quieter picks for right now', seed: 'late night chill' };
  if (h < 11) return { id: 'morning', title: 'Morning Mix', subtitle: 'An easy start', seed: 'morning feel good' };
  if (h < 17) return { id: 'afternoon', title: 'Focus Flow', subtitle: 'Steady background energy', seed: 'focus' };
  if (h < 22) return { id: 'evening', title: 'Evening Rotation', subtitle: 'Bigger sound for tonight', seed: 'evening hits' };
  return { id: 'night', title: 'Night Drive', subtitle: 'For the end of the day', seed: 'night drive' };
}
