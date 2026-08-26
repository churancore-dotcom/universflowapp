// Milestone celebrations + the single earned premium moment.
//
// Every milestone is derived from real counters and is celebrated at most once
// per user, per device. There is no nagging loop: once seen, it is recorded and
// never shown again.

const SEEN_KEY = (userId: string | null | undefined) => `uf_milestones_seen_v1.${userId || 'anon'}`;

export interface Milestone {
  id: string;
  title: string;
  line: string;
  /** Emoji-free glyph hint the UI maps to an icon. */
  kind: 'streak' | 'plays' | 'time' | 'genre' | 'playlist';
  /** Real number behind the moment, shown big. */
  value: string;
}

export function readSeen(userId: string | null | undefined): string[] {
  try {
    const raw = localStorage.getItem(SEEN_KEY(userId));
    const parsed = raw ? JSON.parse(raw) : [];
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

export function markSeen(userId: string | null | undefined, id: string) {
  try {
    const list = readSeen(userId);
    if (list.includes(id)) return;
    localStorage.setItem(SEEN_KEY(userId), JSON.stringify([...list, id].slice(-60)));
  } catch {
    /* ignore */
  }
}

export interface MilestoneInputs {
  streak: number;
  totalPlays: number;
  playlists: number;
  topGenre: string | null;
  monthsOnApp: number;
}

const PLAY_MILESTONES = [100, 500, 1000, 5000];
const STREAK_MILESTONES = [7, 30, 100, 365];

/** The highest un-celebrated milestone the listener has genuinely reached. */
export function nextMilestone(
  userId: string | null | undefined,
  input: MilestoneInputs,
): Milestone | null {
  const seen = new Set(readSeen(userId));
  const candidates: Milestone[] = [];

  for (const n of STREAK_MILESTONES) {
    if (input.streak >= n)
      candidates.push({
        id: `streak-${n}`,
        kind: 'streak',
        value: `${n}`,
        title: `${n}-day streak`,
        line:
          n >= 100
            ? `${n} days in a row. That is not a habit any more — that is who you are.`
            : `You have played music ${n} days in a row. Keep the flame alive.`,
      });
  }
  for (const n of PLAY_MILESTONES) {
    if (input.totalPlays >= n)
      candidates.push({
        id: `plays-${n}`,
        kind: 'plays',
        value: `${n}`,
        title: `${n} songs played`,
        line: `${n} plays logged on Universflow. Every one of them was your choice.`,
      });
  }
  if (input.playlists >= 1)
    candidates.push({
      id: 'first-playlist',
      kind: 'playlist',
      value: '1',
      title: 'First playlist',
      line: 'You built your first playlist. That is where a library really starts.',
    });
  if (input.monthsOnApp >= 1)
    candidates.push({
      id: `member-${Math.min(12, input.monthsOnApp)}m`,
      kind: 'time',
      value: `${Math.min(12, input.monthsOnApp)}mo`,
      title:
        input.monthsOnApp === 1 ? 'One month together' : `${Math.min(12, input.monthsOnApp)} months together`,
      line: 'Thanks for sticking around. Your taste profile keeps getting sharper.',
    });
  if (input.topGenre)
    candidates.push({
      id: `genre-${input.topGenre.toLowerCase()}`,
      kind: 'genre',
      value: input.topGenre,
      title: `Your sound: ${input.topGenre}`,
      line: `${input.topGenre} came out on top of everything you played. Now we know where to dig.`,
    });

  const unseen = candidates.filter((c) => !seen.has(c.id));
  return unseen.length ? unseen[unseen.length - 1] : null;
}

/* ------------------------------------------------------------ premium moment */

const PREMIUM_MOMENT_KEY = (userId: string | null | undefined) =>
  `uf_premium_moment_v1.${userId || 'anon'}`;

/**
 * A premium prompt is only earned after a genuine milestone, and only once per
 * milestone id — never on a timer, never on app open.
 */
export function canShowPremiumMoment(userId: string | null | undefined, milestoneId: string) {
  try {
    const raw = localStorage.getItem(PREMIUM_MOMENT_KEY(userId));
    const list: string[] = raw ? JSON.parse(raw) : [];
    return !Array.isArray(list) || !list.includes(milestoneId);
  } catch {
    return true;
  }
}

export function markPremiumMomentShown(userId: string | null | undefined, milestoneId: string) {
  try {
    const raw = localStorage.getItem(PREMIUM_MOMENT_KEY(userId));
    const list: string[] = raw ? JSON.parse(raw) : [];
    const next = Array.isArray(list) ? [...list, milestoneId] : [milestoneId];
    localStorage.setItem(PREMIUM_MOMENT_KEY(userId), JSON.stringify(next.slice(-20)));
  } catch {
    /* ignore */
  }
}
