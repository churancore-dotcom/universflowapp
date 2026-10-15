/**
 * AI-generated "slop" music detection.
 *
 * YouTube is flooded with synthetic uploads (Suno / Udio / voice-model covers).
 * Those must never appear at the top of Home rails, search results, or the
 * smart queue — this app only surfaces real releases by real artists.
 */

const AI_TITLE_PATTERNS: RegExp[] = [
  /\bai[\s_-]*(?:assisted|composed|composition|production)\b/i,
  /\b(?:generated|created|produced|written|made|composed)[\s_-]+(?:by[\s_-]+|with[\s_-]+|using[\s_-]+)?(?:ai|suno|udio)\b/i,
  /\b(?:ai|a\s*\.\s*i\s*\.)[\s_-]*(?:generated|made|powered|cover|music|song|voice|remix|vocals?)\b/i,
  /\b(?:song|music|cover|voice|vocals?|track)\s*(?:by|using|with)\s*ai\b/i,
  /(?:\(|\[)\s*(?:ai|a\s*\.\s*i\s*\.)\s*(?:\)|\])/i,
  /\b(?:artificial\s+intelligence|synthetic\s+(?:voice|vocals?|music)|ai\s*music\s*factory)\b/i,
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
  // Normalize full-width letters and separators used to disguise AI labels.
  const normalize = (value?: string | null) => (value || '').normalize('NFKC').replace(/[\u200B-\u200D\uFEFF]/g, '');
  const title = normalize(input.title);
  const artist = normalize(input.artist);
  const album = normalize(input.album);
  if (AI_ARTIST_PATTERNS.some((p) => p.test(artist))) return true;
  const haystack = `${title} ${artist} ${album}`;
  return AI_TITLE_PATTERNS.some((p) => p.test(haystack));
}

export const AI_SLOP_TITLE_PATTERNS = AI_TITLE_PATTERNS;
export const AI_SLOP_ARTIST_PATTERNS = AI_ARTIST_PATTERNS;
