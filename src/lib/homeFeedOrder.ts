/**
 * Home feed ordering — behavioural, not decorative.
 *
 * Rails are not a fixed list. Each rail earns its slot from a score built out
 * of the only signals we actually have (real listening history, the clock, the
 * weekday), and the ranking maps to how listeners really decide what to play:
 *
 * • Open loops win (Zeigarnik effect). A session interrupted mid-listen is the
 *   strongest intent on the page, so "Continue listening" outranks everything
 *   while it is still warm, then decays as the memory of it fades.
 * • Familiarity beats novelty for a returning listener (mere-exposure effect).
 *   Their followed artists and personal mix come before broad discovery.
 * • Social proof leads for a stranger. With no history there is nothing to
 *   personalise, so charts — "what everyone is playing" — is the safest,
 *   highest-converting first row, and it peaks in the evening co-listening
 *   window.
 * • Novelty is time-boxed. New music lands on Friday; the craving for "what's
 *   new" is real that day and near-zero on a Tuesday morning, so the release
 *   rail is boosted for the Friday–Sunday window instead of sitting in a
 *   permanent slot it hasn't earned.
 * • Identity/discovery closes the page. Following an artist is a commitment,
 *   and commitment asks come after the listener has been given something.
 *
 * Rails still self-hide when they have no real data, so a high score never
 * renders an empty heading.
 */

export type HomeRail =
  | 'continue'
  | 'followed'
  | 'mix'
  | 'trending'
  | 'fresh'
  | 'artists';

export interface HomeFeedSignals {
  /** Number of real plays in local history. */
  recentCount: number;
  /** Ms since the most recent play, or null when there is no history. */
  msSinceLastPlay: number | null;
  /** 0–23 local hour. */
  hour: number;
  /** 0 = Sunday … 6 = Saturday. */
  weekday: number;
}

const HOUR = 60 * 60 * 1000;

export function scoreHomeRails(s: HomeFeedSignals): Record<HomeRail, number> {
  const hasHistory = s.recentCount > 0;
  // 3 plays is where guessing stops and a pattern starts.
  const isReturning = s.recentCount >= 3;
  const since = s.msSinceLastPlay;

  // Warm loop: same-session-ish. Cooling: today-ish. Cold: old history.
  const warmLoop = since !== null && since < 6 * HOUR;
  const coolingLoop = since !== null && since < 48 * HOUR;

  const eveningPeak = s.hour >= 18 && s.hour <= 23;
  const lateNight = s.hour >= 0 && s.hour < 6;
  const releaseWindow = s.weekday === 5 || s.weekday === 6 || s.weekday === 0;

  return {
    // Unfinished session — the strongest signal on the page while warm.
    continue: !hasHistory ? 0 : warmLoop ? 100 : coolingLoop ? 78 : 58,

    // Familiar, chosen artists: high for a returning listener, a weak
    // discovery row for a stranger.
    followed: (isReturning ? 88 : 42) + (lateNight ? 4 : 0),

    // Personal mix needs taste data to mean anything.
    mix: isReturning ? 82 : 28,

    // Social proof: the default first row for a stranger, and it climbs in the
    // evening when people listen along with everyone else.
    trending: (isReturning ? 54 : 94) + (eveningPeak ? 10 : 0),

    // Novelty is only urgent inside the new-release window.
    fresh: (isReturning ? 48 : 70) + (releaseWindow ? 24 : 0),

    // Commitment ask — always last-ish, slightly stronger for newcomers who
    // have no artists yet.
    artists: isReturning ? 34 : 60,
  };
}

const TIE_BREAK: HomeRail[] = ['continue', 'followed', 'mix', 'trending', 'fresh', 'artists'];

export function getHomeRailOrder(s: HomeFeedSignals): HomeRail[] {
  const scores = scoreHomeRails(s);
  return TIE_BREAK.filter((r) => scores[r] > 0).sort(
    (a, b) => scores[b] - scores[a] || TIE_BREAK.indexOf(a) - TIE_BREAK.indexOf(b),
  );
}

/** Contextual hero label — matches what the listener is actually about to do. */
export function heroContextLabel(s: HomeFeedSignals, isPlaying: boolean): string {
  if (isPlaying) return 'Now playing';
  if (s.msSinceLastPlay !== null && s.msSinceLastPlay < 6 * HOUR) return 'Pick up where you left off';
  if (s.hour < 6) return 'Late night';
  if (s.hour < 12) return 'Start your morning';
  if (s.hour < 18) return 'Afternoon pick';
  return 'Tonight';
}
