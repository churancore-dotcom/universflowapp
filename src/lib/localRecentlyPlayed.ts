// Per-device "Jump Back In" history. Lives in localStorage so it is NEVER
// synced across devices, even when the same account is signed in elsewhere.
// Keyed per user so multiple accounts on the same device stay separate.
//
// Stores a lightweight snapshot alongside the id so YouTube-sourced tracks
// (ids like `yt-…` / `ytm-…`) — which don't exist in the catalog `songs`
// table — can still be rehydrated for the Home "Jump Back In" tile and the
// "For You" seed pool.

const MAX_ENTRIES = 24;

export type LocalRecentSnapshot = {
  id: string;
  title?: string | null;
  artist?: string | null;
  album?: string | null;
  cover_url?: string | null;
  audio_url?: string | null;
  duration?: number | null;
};

export type LocalRecentEntry = {
  song_id: string; // catalog UUID or external id (yt-…, ytm-…, audius-…)
  played_at: number; // epoch ms
  song?: LocalRecentSnapshot;
};

const keyFor = (userId: string | null | undefined) =>
  `universflow.recentlyPlayed.v1.${userId || "anon"}`;

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

export function pushLocalRecent(
  userId: string | null | undefined,
  songId: string,
  snapshot?: LocalRecentSnapshot,
) {
  if (!songId) return;
  try {
    const list = readLocalRecent(userId).filter((e) => e.song_id !== songId);
    const entry: LocalRecentEntry = { song_id: songId, played_at: Date.now() };
    if (snapshot) entry.song = { ...snapshot, id: songId };
    list.unshift(entry);
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
