/**
 * Sanitizes user-submitted URLs before they are rendered as anchor hrefs.
 * Only absolute http(s) URLs are allowed; anything else (javascript:, data:,
 * vbscript:, file:, relative junk) is rejected so admin review pages cannot be
 * used to run attacker code in an admin session.
 */
export function safeHref(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const raw = value.trim();
  if (!raw) return null;
  let parsed: URL;
  try {
    parsed = new URL(raw);
  } catch {
    return null;
  }
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') return null;
  if (!parsed.hostname) return null;
  return parsed.toString();
}
