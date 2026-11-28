/**
 * A saved download must be real, complete audio. Error pages (HTML/JSON),
 * tiny bodies and cut-off transfers used to be stored as songs and then
 * failed offline with "unsupported container".
 */
export const MIN_AUDIO_BYTES = 32 * 1024;

export function downloadProblem(size: number, type: string, expectedBytes = 0): string | null {
  const t = (type || '').toLowerCase();
  if (/^text\/|json|xml|html/.test(t)) return 'Server returned a page instead of audio';
  if (size < MIN_AUDIO_BYTES) return 'Download too small to be a song';
  if (expectedBytes > 0 && size < expectedBytes) return 'Download was cut off';
  return null;
}
