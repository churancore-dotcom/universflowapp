// Per-device "Jump Back In" history. Lives in localStorage so it is NEVER
// synced across devices, even when the same account is signed in elsewhere.
// Keyed per user so multiple accounts on the same device stay separate.

const MAX_ENTRIES = 24;

export type LocalRecentEntry = {
  song_id: string;
  played_at: number; // epoch ms
  title?: string;
  artist?: string;
  album?: string;
  cover_url?: string;
  audio_url?: string;
  duration?: number;
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
  song: { id: string; title?: string; artist?: string; album?: string; cover_url?: string; audio_url?: string; duration?: number },
) {
  if (!song.id || !song.title || !song.artist) return;
  try {
    const list = readLocalRecent(userId).filter((e) => e.song_id !== song.id);
    list.unshift({
      song_id: song.id,
      played_at: Date.now(),
      title: song.title,
      artist: song.artist,
      album: song.album,
      cover_url: song.cover_url,
      audio_url: song.audio_url,
      duration: song.duration,
    });
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
