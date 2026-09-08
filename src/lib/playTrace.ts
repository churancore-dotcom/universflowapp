/**
 * Tap-to-audible timing trace.
 *
 * One trace per play request, so we can see exactly where the delay between a
 * tap and real sound is spent: UI/state commit, stream resolution, or media
 * buffering. Marks are cheap (performance.now + a small array) and the summary
 * is logged once per play, so this can stay on in production.
 *
 * Read the last traces from the console or via `window.__ufPlayTraces`.
 */
export type PlayStage =
  | 'tap'
  | 'ui'
  | 'resolve:start'
  | 'resolve:cache-hit'
  | 'resolve:end'
  | 'src'
  | 'audible';

interface Trace {
  label: string;
  startedAt: number;
  marks: Array<{ stage: PlayStage; at: number }>;
  done: boolean;
}

const MAX_TRACES = 12;
let current: Trace | null = null;
const traces: Array<Record<string, number | string>> = [];

const publish = () => {
  if (typeof window === 'undefined') return;
  (window as unknown as { __ufPlayTraces?: unknown }).__ufPlayTraces = traces;
};

let flushTimer: ReturnType<typeof setTimeout> | null = null;

export function startPlayTrace(label: string): void {
  if (typeof performance === 'undefined') return;
  // Close any previous unfinished trace so its measured stages are not lost.
  if (current && !current.done) finishPlayTrace();
  current = { label, startedAt: performance.now(), marks: [], done: false };
  markPlayStage('tap');
  if (flushTimer) clearTimeout(flushTimer);
  flushTimer = setTimeout(() => finishPlayTrace(), 10_000);
}

export function markPlayStage(stage: PlayStage): void {
  if (!current || current.done) return;
  current.marks.push({ stage, at: performance.now() });
  // Publish a running snapshot so a play that never becomes audible (codec
  // error, dead stream, user skipped) still leaves real stage timings behind.
  publishSnapshot();
  if (stage === 'audible') finishPlayTrace();
}

function summarize(trace: Trace, suffix = ''): Record<string, number | string> {
  const row: Record<string, number | string> = { song: trace.label + suffix };
  let prev = trace.startedAt;
  for (const mark of trace.marks) {
    row[mark.stage] = Math.round(mark.at - prev);
    prev = mark.at;
  }
  row.total = Math.round(prev - trace.startedAt);
  return row;
}

function publishSnapshot(): void {
  if (!current || current.done) return;
  if (typeof window === 'undefined') return;
  (window as unknown as { __ufPlayTraceCurrent?: unknown }).__ufPlayTraceCurrent =
    summarize(current, ' (in progress)');
}

function finishPlayTrace(): void {
  if (!current || current.done) return;
  current.done = true;
  const row = summarize(current);
  traces.unshift(row);
  if (traces.length > MAX_TRACES) traces.pop();
  publish();
  // eslint-disable-next-line no-console
  console.info('[playTrace]', JSON.stringify(row));
}

/** Called on the audio element's `playing` event — closes the open trace. */
export function markAudible(): void {
  markPlayStage('audible');
}
