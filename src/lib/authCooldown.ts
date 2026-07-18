// Client-side cooldown to slow brute-force / accidental spam on auth forms.
// Not a security control (attackers bypass client JS) — Supabase Auth has
// its own server-side throttling. This just protects honest users from
// hammering the form and getting locked out by GoTrue's 429s.

type Action = 'login' | 'signup' | 'reset';

interface Entry {
  count: number;
  firstAt: number;   // ms — start of the current tracking window
  lockUntil: number; // ms — 0 when not locked
}

const WINDOW_MS = 10 * 60 * 1000; // rolling 10-minute window
const THRESHOLDS: Array<{ attempts: number; lockMs: number }> = [
  { attempts: 5,  lockMs: 30 * 1000 },       // 30s after 5 fails
  { attempts: 8,  lockMs: 2 * 60 * 1000 },   // 2m after 8
  { attempts: 12, lockMs: 10 * 60 * 1000 },  // 10m after 12
];

const key = (action: Action, id: string) =>
  `uf_auth_cd_${action}_${id.trim().toLowerCase()}`;

const read = (k: string): Entry => {
  try {
    const raw = localStorage.getItem(k);
    if (!raw) return { count: 0, firstAt: 0, lockUntil: 0 };
    const parsed = JSON.parse(raw) as Entry;
    return {
      count: Number(parsed.count) || 0,
      firstAt: Number(parsed.firstAt) || 0,
      lockUntil: Number(parsed.lockUntil) || 0,
    };
  } catch {
    return { count: 0, firstAt: 0, lockUntil: 0 };
  }
};

const write = (k: string, e: Entry) => {
  try { localStorage.setItem(k, JSON.stringify(e)); } catch { /* quota */ }
};

/** Remaining lock in ms, or 0 if not locked. */
export function getCooldownMs(action: Action, id: string): number {
  if (!id) return 0;
  const e = read(key(action, id));
  const now = Date.now();
  if (e.lockUntil > now) return e.lockUntil - now;
  return 0;
}

/** Register a failed attempt. Returns updated lock duration in ms (0 if no lock yet). */
export function registerFailure(action: Action, id: string): number {
  if (!id) return 0;
  const k = key(action, id);
  const now = Date.now();
  const e = read(k);

  // Reset the window if it's stale
  if (!e.firstAt || now - e.firstAt > WINDOW_MS) {
    e.count = 0;
    e.firstAt = now;
    e.lockUntil = 0;
  }
  e.count += 1;

  // Highest threshold met wins
  let lockMs = 0;
  for (const t of THRESHOLDS) {
    if (e.count >= t.attempts) lockMs = t.lockMs;
  }
  if (lockMs > 0) e.lockUntil = now + lockMs;

  write(k, e);
  return e.lockUntil > now ? e.lockUntil - now : 0;
}

/** Clear counters after a successful auth event. */
export function clearCooldown(action: Action, id: string) {
  if (!id) return;
  try { localStorage.removeItem(key(action, id)); } catch { /* ignore */ }
}

export function formatCooldown(ms: number): string {
  const s = Math.ceil(ms / 1000);
  if (s < 60) return `${s}s`;
  const m = Math.ceil(s / 60);
  return `${m}m`;
}
