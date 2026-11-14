export interface RemotePlaybackRow {
  song: { id?: string; title?: string; artist?: string; audio_url?: string } | null;
  position_seconds: number | string | null;
  device_id: string | null;
  device_label: string | null;
  updated_at: string;
}

export const REMOTE_RESUME_MAX_AGE_MS = 3 * 86_400_000;

/** Offer "continue from your other device" only when it's genuinely useful. */
export function shouldOfferRemoteResume(row: RemotePlaybackRow | null, myDeviceId: string, now: number, localSongId: string | null, dismissedAt: string | null): boolean {
  if (!row?.song?.id || !row.song.title) return false;
  if (!row.device_id || row.device_id === myDeviceId) return false;
  if (dismissedAt === row.updated_at) return false;
  const age = now - new Date(row.updated_at).getTime();
  if (!Number.isFinite(age) || age < 0 || age > REMOTE_RESUME_MAX_AGE_MS) return false;
  if (localSongId && localSongId === row.song.id) return false;
  return true;
}

export function resumePosition(row: RemotePlaybackRow): number {
  const n = Number(row.position_seconds);
  return Number.isFinite(n) && n > 5 ? Math.floor(n) : 0;
}
