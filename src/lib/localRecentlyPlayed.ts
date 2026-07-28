// Per-device "Jump Back In" history. Lives in localStorage so it is NEVER
// synced across devices, even when the same account is signed in elsewhere.
// Keyed per user so multiple accounts on the same device stay separate.

const MAX_ENTRIES = 24;

export type LocalRecentEntry = {
  song_id: string; // catalog UUID
  played_at: number; // epoch ms
};

const keyFor = (userId: string | null | undefined) =>
  `universflow.recentlyPlayed.v1.${userId || "anon"}`;

const isUuid = (s: string) =>
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(s);

export function readLocalRecent(userId: string | null | undefined): LocalRecentEntry[] {
  try {
    const raw = localStorage.getItem(keyFor(userId));
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter(
      (e) => e && typeof e.song_id === "string" && typeof e.played_at === "number"
    );
  } catch {
    return [];
  }
}

export function pushLocalRecent(userId: string | null | undefined, songId: string) {
  if (!songId || !isUuid(songId)) return;
  try {
    const list = readLocalRecent(userId).filter((e) => e.song_id !== songId);
    list.unshift({ song_id: songId, played_at: Date.now() });
    localStorage.setItem(keyFor(userId), JSON.stringify(list.slice(0, MAX_ENTRIES)));
    window.dispatchEvent(new CustomEvent("universflow:recently-played-changed"));
  } catch {
    /* quota / private mode — ignore */
  }
}

export function clearLocalRecent(userId: string | null | undefined) {
  try {
    localStorage.removeItem(keyFor(userId));
    window.dispatchEvent(new CustomEvent("universflow:recently-played-changed"));
  } catch {
    /* ignore */
  }
}
