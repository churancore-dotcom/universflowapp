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
  // 3 plays is where guessing stops and a pattern starts.
  const isReturning = s.recentCount >= 3;

  const eveningPeak = s.hour >= 18 && s.hour <= 23;
  const releaseWindow = s.weekday === 5 || s.weekday === 6 || s.weekday === 0;

  return {
    // Fixed house order: New releases → Trending now → Trending artists →
    // Made for you. Both lead rails are
    // taste-reranked per listener, so "what's new / what's hot" is already
    // filtered to the music this person actually plays.
    fresh: 100 + (releaseWindow ? 4 : 0),
    trending: 90 + (eveningPeak ? 3 : 0),
    artists: 60 + (isReturning ? 0 : 4),
    mix: isReturning ? 40 : 0,
  };
}

const TIE_BREAK: HomeRail[] = ['fresh', 'trending', 'artists', 'mix'];

export function getHomeRailOrder(s: HomeFeedSignals): HomeRail[] {
  const scores = scoreHomeRails(s);
  return TIE_BREAK.filter((r) => scores[r] > 0).sort(
    (a, b) => scores[b] - scores[a] || TIE_BREAK.indexOf(a) - TIE_BREAK.indexOf(b),
  );
}


/** Contextual hero label — matches what the listener is actually about to do. */
export function heroContextLabel(s: HomeFeedSignals, isPlaying: boolean): string {
  if (isPlaying) return 'Now playing';
  return 'Trending for you';
}
