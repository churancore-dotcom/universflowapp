import { describe, it, expect } from 'vitest';
import { shouldOfferRemoteResume, resumePosition, type RemotePlaybackRow } from './remoteResume';

const now = Date.parse('2026-11-14T12:00:00Z');
const row = (p: Partial<RemotePlaybackRow> = {}): RemotePlaybackRow => ({
  song: { id: 's1', title: 'Song' }, position_seconds: 95, device_id: 'phone', device_label: 'Phone',
  updated_at: '2026-11-14T11:00:00Z', ...p,
});

describe('cross-device resume', () => {
  it('offers a song started on another device', () => {
    expect(shouldOfferRemoteResume(row(), 'laptop', now, null, null)).toBe(true);
  });
  it('never offers this device’s own playback', () => {
    expect(shouldOfferRemoteResume(row(), 'phone', now, null, null)).toBe(false);
  });
  it('skips stale (older than 3 days), dismissed, or already-playing songs', () => {
    expect(shouldOfferRemoteResume(row({ updated_at: '2026-11-10T11:00:00Z' }), 'laptop', now, null, null)).toBe(false);
    expect(shouldOfferRemoteResume(row(), 'laptop', now, null, '2026-11-14T11:00:00Z')).toBe(false);
    expect(shouldOfferRemoteResume(row(), 'laptop', now, 's1', null)).toBe(false);
  });
  it('resumes at the saved second, from the start if under 5s', () => {
    expect(resumePosition(row())).toBe(95);
    expect(resumePosition(row({ position_seconds: 3 }))).toBe(0);
  });
});
