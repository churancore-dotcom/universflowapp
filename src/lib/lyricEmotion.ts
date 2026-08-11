/**
 * Lyric emotion detection — instant, offline, zero cost.
 *
 * v2 (accuracy pass). The old version scored a line as "emotional" the moment a
 * single loose keyword matched, so almost every song cycled through all six
 * moods line by line. Three changes fix that:
 *
 *  1. WEIGHTED lexicon. Strong, unambiguous words ("heartbroken", "revenge")
 *     carry weight 3; ordinary mood words carry 2; weak/ambiguous ones ("night",
 *     "eyes", "high") are either weight 1 or removed entirely.
 *  2. CONFIDENCE THRESHOLD. A line must clear a minimum weight AND beat the
 *     runner-up emotion by a margin before it is allowed to have its own mood.
 *     Otherwise it inherits the song's mood.
 *  3. SONG ANCHOR + HYSTERESIS. The song's dominant emotion is computed first
 *     from the total weight across all lines. Individual lines only deviate from
 *     that anchor when they're confident, and a deviation has to persist (or be
 *     very strong) to actually switch the visuals. Result: one coherent mood per
 *     song with genuine moments of contrast, not a strobe.
 */

export type Emotion = 'sad' | 'angry' | 'happy' | 'romantic' | 'intense' | 'neutral';
type RealEmotion = Exclude<Emotion, 'neutral'>;

/** word -> weight. 3 = decisive, 2 = clear, 1 = weak hint. */
const LEXICON: Record<RealEmotion, Record<string, number>> = {
  sad: {
    heartbroken: 3, heartbreak: 3, crying: 3, cried: 3, tears: 3, weeping: 3,
    goodbye: 3, lonely: 3, loneliness: 3, grieve: 3, grief: 3, mourn: 3,
    cry: 2, broken: 2, hurts: 2, hurting: 2, aching: 2, ache: 2, sorrow: 2,
    empty: 2, regret: 2, apart: 2, leaving: 2, gone: 2, lost: 2, hollow: 2,
    numb: 2, drowning: 2, alone: 2,
    hurt: 1, sorry: 1, rain: 1, miss: 1, fading: 1,
    // Hindi / Urdu
    judai: 3, tanha: 3, rula: 3, bewafa: 3, dard: 2, aansu: 2, yaad: 1, akela: 2,
  },
  angry: {
    revenge: 3, hate: 3, hatred: 3, rage: 3, furious: 3, betrayed: 3, betray: 3,
    liar: 3, enemy: 3, screaming: 3,
    fight: 2, fighting: 2, scream: 2, shout: 2, burn: 2, burning: 2, blood: 2,
    war: 2, savage: 2, ruthless: 2, bitter: 2, poison: 2, kill: 2,
    fire: 1, blame: 1,
    nafrat: 3, gussa: 3, badla: 3, jung: 2, dushman: 2,
  },
  happy: {
    celebrate: 3, celebration: 3, laughing: 3, sunshine: 3, euphoria: 3,
    joyful: 3, happiness: 3, happier: 3,
    dance: 2, dancing: 2, smile: 2, smiling: 2, laugh: 2, joy: 2, party: 2,
    shine: 2, shining: 2, alive: 2, bright: 2, sweet: 2, glow: 2, sunny: 2,
    happy: 2, together: 1, sun: 1, free: 1, good: 0,
    khushi: 3, jhoom: 3, nach: 2, mast: 2, masti: 2,
  },
  romantic: {
    love: 3, loving: 3, lover: 3, beloved: 3, kiss: 3, kisses: 3, forever: 3,
    romance: 3, darling: 3, sweetheart: 3, adore: 3,
    heart: 2, baby: 2, mine: 2, hold: 2, embrace: 2, tender: 2, beautiful: 2,
    yours: 2, desire: 2, closer: 2,
    touch: 1, eyes: 1, close: 1,
    pyaar: 3, ishq: 3, mohabbat: 3, sanam: 3, dil: 2, jaan: 2, deewana: 2,
  },
  intense: {
    unstoppable: 3, thunder: 3, adrenaline: 3, explode: 3, exploding: 3,
    breakthrough: 3, relentless: 3, chaos: 3,
    storm: 2, wild: 2, faster: 2, racing: 2, crash: 2, rise: 2, rising: 2,
    higher: 2, edge: 2, danger: 2, chase: 2, running: 2, blazing: 2, power: 2,
    run: 1, fall: 1, never: 0, night: 0,
    toofan: 3, taakat: 2, tezz: 2,
  },
};

export interface EmotionStyle {
  emotion: Emotion;
  /** canvas colour stops */
  colors: [string, string, string];
  /** base particle speed multiplier */
  speed: number;
  /** motion chaos (0 smooth -> 1 chaotic) */
  chaos: number;
  /** pulse depth reacting to audio energy */
  pulse: number;
  /** wave amplitude in px */
  amplitude: number;
  /** particle size in px */
  size: number;
  /** distinct visual behaviour for the canvas engine */
  motion: 'rain' | 'embers' | 'sparkle' | 'bokeh' | 'streaks' | 'drift';
  /** vertical bias: -1 falls, +1 rises, 0 floats */
  gravity: number;
  label: string;
}

export const EMOTION_STYLES: Record<Emotion, EmotionStyle> = {
  sad: { emotion: 'sad', colors: ['#3b82f6', '#6366f1', '#0f172a'], speed: 0.34, chaos: 0.06, pulse: 0.3, amplitude: 22, size: 1.9, motion: 'rain', gravity: -1, label: 'Melancholy' },
  angry: { emotion: 'angry', colors: ['#ef4444', '#f97316', '#7f1d1d'], speed: 1.6, chaos: 0.9, pulse: 1.0, amplitude: 44, size: 2.6, motion: 'embers', gravity: 1, label: 'Fury' },
  happy: { emotion: 'happy', colors: ['#facc15', '#f472b6', '#22d3ee'], speed: 1.05, chaos: 0.38, pulse: 0.85, amplitude: 32, size: 2.8, motion: 'sparkle', gravity: 0.2, label: 'Euphoria' },
  romantic: { emotion: 'romantic', colors: ['#fb7185', '#f43f5e', '#a21caf'], speed: 0.45, chaos: 0.1, pulse: 0.5, amplitude: 20, size: 3.6, motion: 'bokeh', gravity: 0.4, label: 'Romance' },
  intense: { emotion: 'intense', colors: ['#22d3ee', '#a855f7', '#f43f5e'], speed: 1.95, chaos: 1.0, pulse: 1.0, amplitude: 50, size: 2.2, motion: 'streaks', gravity: 0, label: 'Intensity' },
  neutral: { emotion: 'neutral', colors: ['#cbd5e1', '#94a3b8', '#475569'], speed: 0.6, chaos: 0.16, pulse: 0.5, amplitude: 24, size: 2.3, motion: 'drift', gravity: 0, label: 'Ambient' },
};

/** Backwards-compatible plain keyword view (weights dropped). */
export const emotionKeywords = Object.fromEntries(
  (Object.keys(LEXICON) as RealEmotion[]).map((e) => [
    e,
    Object.entries(LEXICON[e]).filter(([, w]) => w > 0).map(([w]) => w),
  ]),
) as Record<RealEmotion, string[]>;

const WORD_RE = /[a-z']+/g;
const NEGATORS = new Set(['no', 'not', "don't", 'dont', 'never', 'without', 'nothing', 'aint', "ain't", 'cant', "can't", 'nahi', 'na']);

/** Minimum weight for a line to claim its own mood. */
const LINE_MIN_WEIGHT = 3;
/** How far ahead of the runner-up the winner must be. */
const LINE_MARGIN = 2;

interface Scored { emotion: Emotion; weight: number; margin: number }

function scoreLine(text: string): Scored {
  if (!text) return { emotion: 'neutral', weight: 0, margin: 0 };
  const words = text.toLowerCase().match(WORD_RE);
  if (!words?.length) return { emotion: 'neutral', weight: 0, margin: 0 };

  const scores = new Map<RealEmotion, number>();
  for (let i = 0; i < words.length; i++) {
    const word = words[i];
    // "not happy" / "no love" flips a positive claim into its shadow instead of
    // counting it — this alone removes a lot of false "romantic" lines.
    const negated = i > 0 && NEGATORS.has(words[i - 1]);
    for (const emotion of Object.keys(LEXICON) as RealEmotion[]) {
      const w = LEXICON[emotion][word];
      if (!w) continue;
      const target: RealEmotion = negated
        ? (emotion === 'happy' || emotion === 'romantic' ? 'sad' : emotion)
        : emotion;
      const gain = negated ? Math.max(1, w - 1) : w;
      scores.set(target, (scores.get(target) ?? 0) + gain);
    }
  }
  if (!scores.size) return { emotion: 'neutral', weight: 0, margin: 0 };

  let best: RealEmotion | null = null;
  let bestW = 0;
  let secondW = 0;
  scores.forEach((w, e) => {
    if (w > bestW) { secondW = bestW; bestW = w; best = e; }
    else if (w > secondW) { secondW = w; }
  });
  return { emotion: best ?? 'neutral', weight: bestW, margin: bestW - secondW };
}

/**
 * Dominant emotion of a single piece of text. Only returns a real emotion when
 * the evidence is strong enough — otherwise 'neutral'.
 */
export function detectEmotion(text: string): Emotion {
  const s = scoreLine(text);
  if (s.weight < LINE_MIN_WEIGHT || s.margin < LINE_MARGIN) return 'neutral';
  return s.emotion;
}

export interface EmotionLine {
  time: number;
  text: string;
  emotion: Emotion;
  /** 0-1 how sure we are this line owns its mood (drives visual intensity) */
  confidence: number;
}

/**
 * Precompute emotions for a whole song.
 *
 * Pass 1 sums weight per emotion over every line to find the SONG anchor.
 * Pass 2 keeps each line on that anchor unless it is confidently different, and
 * requires two consecutive confident lines (or one very strong one, weight >= 6)
 * before the mood is allowed to switch. Contrast still happens — the bridge of a
 * love song that turns bitter will flip — but a stray "rain" no longer does.
 */
export function annotateEmotions(lines: { time: number; text: string }[]): EmotionLine[] {
  const scored = lines.map((l) => ({ ...l, s: scoreLine(l.text) }));

  const totals = new Map<Emotion, number>();
  for (const { s } of scored) {
    if (s.emotion === 'neutral' || s.weight < 2) continue;
    totals.set(s.emotion, (totals.get(s.emotion) ?? 0) + s.weight);
  }
  let anchor: Emotion = 'neutral';
  let anchorW = 0;
  totals.forEach((w, e) => { if (w > anchorW) { anchorW = w; anchor = e; } });

  let currentMood: Emotion = anchor;
  let pendingMood: Emotion | null = null;

  return scored.map(({ time, text, s }) => {
    const confidentLine = s.weight >= LINE_MIN_WEIGHT && s.margin >= LINE_MARGIN && s.emotion !== 'neutral';

    if (confidentLine && s.emotion !== currentMood) {
      if (s.weight >= 6 || pendingMood === s.emotion) {
        currentMood = s.emotion;
        pendingMood = null;
      } else {
        pendingMood = s.emotion;
      }
    } else if (confidentLine) {
      pendingMood = null;
    }

    const confidence = confidentLine
      ? Math.min(1, 0.55 + s.weight / 12)
      : currentMood === 'neutral' ? 0.25 : 0.45;

    return { time, text, emotion: currentMood, confidence };
  });
}

/** Dominant emotion across a whole lyric set — the song's mood. */
export function dominantEmotion(lines: EmotionLine[]): Emotion {
  const tally = new Map<Emotion, number>();
  lines.forEach((l) => {
    if (l.emotion === 'neutral') return;
    tally.set(l.emotion, (tally.get(l.emotion) ?? 0) + l.confidence);
  });
  let best: Emotion = 'neutral';
  let bestCount = 0;
  tally.forEach((count, emotion) => {
    if (count > bestCount) { bestCount = count; best = emotion; }
  });
  return best;
}
