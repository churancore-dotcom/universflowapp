/**
 * Keyword-based lyric emotion detection — instant, offline, zero cost.
 * Precomputed once per song so the render loop never does text work.
 */

export type Emotion = 'sad' | 'angry' | 'happy' | 'romantic' | 'intense' | 'neutral';

export const emotionKeywords: Record<Exclude<Emotion, 'neutral'>, string[]> = {
  sad: ['cry', 'cried', 'crying', 'lonely', 'alone', 'broken', 'break', 'goodbye', 'bye', 'tears', 'tear', 'hurt', 'miss', 'empty', 'rain', 'pain', 'gone', 'lost', 'sorry', 'regret', 'judai', 'dard', 'tanha', 'yaad', 'rula'],
  angry: ['fire', 'rage', 'fight', 'hate', 'burn', 'scream', 'shout', 'blood', 'war', 'revenge', 'liar', 'enemy', 'gussa', 'nafrat', 'jung'],
  happy: ['dance', 'dancing', 'smile', 'sun', 'sunshine', 'free', 'alive', 'shine', 'party', 'laugh', 'joy', 'celebrate', 'high', 'good', 'happy', 'nach', 'khushi', 'mast', 'jhoom'],
  romantic: ['love', 'lover', 'kiss', 'heart', 'forever', 'close', 'hold', 'baby', 'darling', 'mine', 'touch', 'eyes', 'beautiful', 'pyaar', 'ishq', 'dil', 'mohabbat', 'jaan', 'sanam'],
  intense: ['run', 'running', 'chase', 'fall', 'falling', 'storm', 'wild', 'faster', 'never', 'edge', 'night', 'crash', 'thunder', 'rise', 'toofan', 'jaan-le'],
};

export interface EmotionStyle {
  emotion: Emotion;
  /** HSL-ish rgba stops used by the canvas engine */
  colors: [string, string, string];
  /** base particle speed multiplier */
  speed: number;
  /** how jagged / chaotic motion is (0 smooth → 1 chaotic) */
  chaos: number;
  /** pulse depth reacting to audio energy */
  pulse: number;
  /** wave amplitude in px */
  amplitude: number;
  /** particle size in px */
  size: number;
  label: string;
}

export const EMOTION_STYLES: Record<Emotion, EmotionStyle> = {
  sad: { emotion: 'sad', colors: ['#3b82f6', '#7c3aed', '#1e293b'], speed: 0.32, chaos: 0.08, pulse: 0.35, amplitude: 26, size: 2.2, label: 'Melancholy' },
  angry: { emotion: 'angry', colors: ['#ef4444', '#f97316', '#7f1d1d'], speed: 1.65, chaos: 0.92, pulse: 1.0, amplitude: 46, size: 2.8, label: 'Fury' },
  happy: { emotion: 'happy', colors: ['#facc15', '#f472b6', '#22d3ee'], speed: 1.1, chaos: 0.42, pulse: 0.85, amplitude: 34, size: 3.0, label: 'Euphoria' },
  romantic: { emotion: 'romantic', colors: ['#fb7185', '#f43f5e', '#a21caf'], speed: 0.5, chaos: 0.14, pulse: 0.55, amplitude: 22, size: 3.4, label: 'Romance' },
  intense: { emotion: 'intense', colors: ['#22d3ee', '#a855f7', '#f43f5e'], speed: 1.9, chaos: 1.0, pulse: 1.0, amplitude: 52, size: 2.4, label: 'Intensity' },
  neutral: { emotion: 'neutral', colors: ['#e2e8f0', '#94a3b8', '#475569'], speed: 0.7, chaos: 0.2, pulse: 0.6, amplitude: 28, size: 2.4, label: 'Ambient' },
};

const WORD_RE = /[a-z']+/g;

/** Score a single lyric line and return its dominant emotion. */
export function detectEmotion(text: string): Emotion {
  if (!text) return 'neutral';
  const words = text.toLowerCase().match(WORD_RE);
  if (!words?.length) return 'neutral';

  const scores: Record<string, number> = {};
  for (const word of words) {
    for (const [emotion, keywords] of Object.entries(emotionKeywords)) {
      for (const kw of keywords) {
        if (word === kw || (kw.length > 4 && word.startsWith(kw))) {
          scores[emotion] = (scores[emotion] || 0) + 1;
        }
      }
    }
  }

  let best: Emotion = 'neutral';
  let bestScore = 0;
  for (const [emotion, score] of Object.entries(scores)) {
    if (score > bestScore) { bestScore = score; best = emotion as Emotion; }
  }
  return bestScore > 0 ? best : 'neutral';
}

export interface EmotionLine {
  time: number;
  text: string;
  emotion: Emotion;
}

/** Precompute emotions for a whole song. Empty/instrumental lines inherit the previous mood. */
export function annotateEmotions(lines: { time: number; text: string }[]): EmotionLine[] {
  let carry: Emotion = 'neutral';
  return lines.map(({ time, text }) => {
    const detected = text.trim() ? detectEmotion(text) : 'neutral';
    const emotion = detected === 'neutral' ? carry : detected;
    if (detected !== 'neutral') carry = detected;
    return { time, text, emotion };
  });
}

/** Dominant emotion across a whole lyric set — used for the idle/plain-lyrics mood. */
export function dominantEmotion(lines: EmotionLine[]): Emotion {
  const tally = new Map<Emotion, number>();
  lines.forEach((l) => tally.set(l.emotion, (tally.get(l.emotion) || 0) + 1));
  let best: Emotion = 'neutral';
  let bestCount = 0;
  tally.forEach((count, emotion) => {
    if (emotion !== 'neutral' && count > bestCount) { bestCount = count; best = emotion; }
  });
  return best;
}
