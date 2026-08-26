// Measured listening log (device-local, per user).
//
// Play *events* live server-side in `song_play_events`, but those rows carry no
// duration, so "minutes listened" can only ever be an estimate from them. This
// log records the seconds a track was ACTUALLY audible, sampled from the
// player, plus the calendar days the listener really used the app. Everything
// here is real measured data — nothing is inferred or padded.

const KEY = (userId: string | null | undefined) => `uf_listen_log_v1.${userId || 'anon'}`;
const MAX_DAYS = 400; // enough for "on this day, a year ago"

export interface ListenDay {
  /** YYYY-MM-DD in the listener's local timezone. */
  day: string;
  /** Measured audible seconds for that day. */
  seconds: number;
  /** Number of track starts counted that day. */
  plays: number;
}

export interface ListenLog {
  days: ListenDay[];
  /** Measured seconds per track fingerprint, all-time. */
  tracks: Record<string, number>;
}

const EMPTY: ListenLog = { days: [], tracks: {} };

export const localDayKey = (d: Date | number = new Date()) => {
  const date = typeof d === 'number' ? new Date(d) : d;
  const y = date.getFullYear();
  const m = `${date.getMonth() + 1}`.padStart(2, '0');
  const day = `${date.getDate()}`.padStart(2, '0');
  return `${y}-${m}-${day}`;
};

export function readListenLog(userId: string | null | undefined): ListenLog {
  if (typeof localStorage === 'undefined') return EMPTY;
  try {
    const raw = localStorage.getItem(KEY(userId));
    if (!raw) return EMPTY;
    const parsed = JSON.parse(raw) as ListenLog;
    if (!parsed || !Array.isArray(parsed.days)) return EMPTY;
    return { days: parsed.days, tracks: parsed.tracks || {} };
  } catch {
    return EMPTY;
  }
}

function write(userId: string | null | undefined, log: ListenLog) {
  try {
    const days = log.days.slice(-MAX_DAYS);
    localStorage.setItem(KEY(userId), JSON.stringify({ days, tracks: log.tracks }));
  } catch {
    /* quota / private mode */
  }
}

/** Record measured audible seconds. Called from the playback sampler. */
export function recordListenSeconds(
  userId: string | null | undefined,
  seconds: number,
  fingerprint?: string | null,
) {
  if (!Number.isFinite(seconds) || seconds <= 0) return;
  const log = readListenLog(userId);
  const day = localDayKey();
  const days = [...log.days];
  const idx = days.findIndex((d) => d.day === day);
  if (idx >= 0) days[idx] = { ...days[idx], seconds: days[idx].seconds + seconds };
  else days.push({ day, seconds, plays: 0 });
  const tracks = { ...log.tracks };
  if (fingerprint) tracks[fingerprint] = (tracks[fingerprint] || 0) + seconds;
  write(userId, { days, tracks });
}

/** Record a track start (used for play counts + streak days). */
export function recordListenPlay(userId: string | null | undefined) {
  const log = readListenLog(userId);
  const day = localDayKey();
  const days = [...log.days];
  const idx = days.findIndex((d) => d.day === day);
  if (idx >= 0) days[idx] = { ...days[idx], plays: days[idx].plays + 1 };
  else days.push({ day, seconds: 0, plays: 1 });
  write(userId, { days, tracks: log.tracks });
  try {
    window.dispatchEvent(new CustomEvent('uf:listen-log-changed'));
  } catch {
    /* ignore */
  }
}

/** Mark today as an active day (app opened with playback intent). */
export function touchListenDay(userId: string | null | undefined) {
  const log = readListenLog(userId);
  const day = localDayKey();
  if (log.days.some((d) => d.day === day)) return;
  write(userId, { days: [...log.days, { day, seconds: 0, plays: 0 }], tracks: log.tracks });
}
