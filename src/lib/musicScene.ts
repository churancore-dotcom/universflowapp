/**
 * Regional music "scenes" that only some listeners want. A scene is opt-in:
 * its songs stay out of feeds until the listener actually plays, likes or
 * follows it (e.g. no Bhojpuri for someone who never listens to Bhojpuri).
 */
export type Scene = 'bhojpuri' | 'haryanvi' | 'devotional';

const SCENES: Record<Scene, { words: RegExp; artists: string[] }> = {
  bhojpuri: {
    words: /\bbhojpuri\b|भोजपुरी/i,
    artists: ['pawan singh', 'khesari lal yadav', 'khesari lal', 'ritesh pandey', 'arvind akela kallu', 'shilpi raj', 'neelkamal singh', 'pramod premi yadav', 'pramod premi', 'samar singh', 'ankush raja', 'dinesh lal yadav', 'nirahua', 'antra singh priyanka', 'priyanka singh', 'shivani singh', 'gunjan singh', 'tuntun yadav', 'raja ji', 'ankit singh patel', 'golu gold', 'kallu', 'chandan chanchal', 'rakesh mishra', 'abhishek lal yadav', 'arvind akela'],
  },
  haryanvi: {
    words: /\bharyanvi\b|हरियाणवी/i,
    artists: ['sapna choudhary', 'masoom sharma', 'raju punjabi', 'khasa aala chahar', 'renuka panwar', 'ruchika jangid', 'amanraj gill', 'ndee kundu', 'gulzaar chhaniwala', 'pranjal dahiya', 'anjali raghav', 'diler kharkiya', 'vishvajeet choudhary', 'sumit goswami', 'mohit sharma'],
  },
  devotional: {
    words: /\b(bhajan|aarti|chalisa|mantra|bhakti|jagran|kirtan|stuti)\b|भजन|आरती|चालीसा/i,
    artists: ['gulshan kumar', 'anuradha paudwal', 'hariharan bhajan', 'lakhbir singh lakha', 'narendra chanchal'],
  },
};

const ALL = Object.keys(SCENES) as Scene[];

export function detectScene(item: { title?: string | null; artist?: string | null; album?: string | null }): Scene | null {
  const artist = (item.artist || '').toLowerCase();
  const text = `${item.title || ''} ${item.album || ''} ${item.artist || ''}`;
  for (const s of ALL) {
    const def = SCENES[s];
    if (def.words.test(text)) return s;
    if (artist && def.artists.some((a) => artist.includes(a))) return s;
  }
  return null;
}

/** A listener "wants" a scene once it makes up a real share of what they choose. */
export function wantedScenes(sceneWeights: Map<Scene, number>, totalPositive: number): Set<Scene> {
  const out = new Set<Scene>();
  for (const [scene, w] of sceneWeights) {
    if (w >= 2 && (totalPositive <= 0 || w / totalPositive >= 0.04)) out.add(scene);
  }
  return out;
}

export function allowedForListener(item: { title?: string | null; artist?: string | null; album?: string | null }, wanted: Set<Scene>): boolean {
  const scene = detectScene(item);
  return scene === null || wanted.has(scene);
}

// ---- Shared listener filter, applied by every feed rail ----
const STORE_KEY = 'uf:wanted-scenes';
let current: Set<Scene> | null = null;

function load(): Set<Scene> {
  if (current) return current;
  try {
    const raw = typeof window !== 'undefined' ? window.localStorage.getItem(STORE_KEY) : null;
    const list = raw ? (JSON.parse(raw) as string[]) : [];
    current = new Set(list.filter((s): s is Scene => (ALL as string[]).includes(s)));
  } catch { current = new Set(); }
  return current;
}

export function setWantedScenes(next: Set<Scene>) {
  current = new Set(next);
  try { window.localStorage.setItem(STORE_KEY, JSON.stringify([...current])); } catch { /* private mode */ }
}

export function feedAllows(item: { title?: string | null; artist?: string | null; album?: string | null }): boolean {
  return allowedForListener(item, load());
}
