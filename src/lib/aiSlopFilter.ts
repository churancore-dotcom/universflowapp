/**
 * AI-generated "slop" music detection.
 *
 * YouTube is flooded with synthetic uploads (Suno / Udio / voice-model covers).
 * Those must never appear at the top of Home rails, search results, or the
 * smart queue — this app only surfaces real releases by real artists.
 */

const AI_TITLE_PATTERNS: RegExp[] = [
  /\bai[\s\-_]*(song|songs|music|cover|covers|voice|vocals?|generated|version|remix|mashup|track|beat|band|artist)\b/i,
  /\b(generated|created|produced|written|made)\s*(by|with|using)?\s*(ai|a\.i\.|chatgpt|gpt|suno|udio|riffusion)\b/i,
  /\b(suno|udio|riffusion|musicgen|boomy|soundraw|mubert|aiva)\b/i,
  /\b(a\.i\.)\b/i,
  /\bai\s*(v\d|model|clone|cloned|deepfake)\b/i,
  /\b(voice\s*(model|clone|cloned|swap)|rvc\s*cover|deepfake)\b/i,
];

const AI_ARTIST_PATTERNS: RegExp[] = [
  /\b(ai|a\.i\.)\s*(music|songs?|studio|beats?|covers?|vocals?|band|artist|hub|world|zone|lab|labs|factory)\b/i,
  /\b(suno|udio|riffusion|musicgen|boomy|mubert|aiva)\b/i,
  /\bai[\s\-_]*generated\b/i,
  /\bnot\s*real\s*(artist|voice)\b/i,
];

export function isAiGeneratedTrack(input: {
  title?: string | null;
  artist?: string | null;
  album?: string | null;
}): boolean {
  const title = input.title || '';
  const artist = input.artist || '';
  const album = input.album || '';
  if (AI_ARTIST_PATTERNS.some((p) => p.test(artist))) return true;
  const haystack = `${title} ${artist} ${album}`;
  return AI_TITLE_PATTERNS.some((p) => p.test(haystack));
}

export const AI_SLOP_TITLE_PATTERNS = AI_TITLE_PATTERNS;
export const AI_SLOP_ARTIST_PATTERNS = AI_ARTIST_PATTERNS;
