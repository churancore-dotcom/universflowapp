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
// Stored per account so one listener's taste never leaks into another's feed.
let activeAccount = 'anon';
let current: Set<Scene> | null = null;
const storeKey = (account: string) => `uf:wanted-scenes:${account}`;

export function setSceneAccount(account: string | null | undefined) {
  const next = account || 'anon';
  if (next !== activeAccount) { activeAccount = next; current = null; }
}

function load(): Set<Scene> {
  if (current) return current;
  try {
    const raw = typeof window !== 'undefined' ? window.localStorage.getItem(storeKey(activeAccount)) : null;
    const list = raw ? (JSON.parse(raw) as string[]) : [];
    current = new Set(list.filter((s): s is Scene => (ALL as string[]).includes(s)));
  } catch { current = new Set(); }
  return current;
}

export function setWantedScenes(next: Set<Scene>) {
  current = new Set(next);
  try { window.localStorage.setItem(storeKey(activeAccount), JSON.stringify([...current])); } catch { /* private mode */ }
}

export function feedAllows(item: { title?: string | null; artist?: string | null; album?: string | null }): boolean {
  return allowedForListener(item, load());
}

// ---- Broad listening styles: used to RANK (boost/penalise), never to hide ----
export type Style = 'punjabi' | 'tamil' | 'telugu' | 'malayalam' | 'kannada' | 'marathi' | 'bengali' | 'gujarati' | 'bollywood' | 'kpop' | 'lofi' | 'remix' | 'english' | 'rap' | 'romantic' | 'sad' | 'party';

const STYLE_RULES: [Style, RegExp][] = [
  ['punjabi', /\b(punjabi|bhangra)\b|karan aujla|sidhu moose|diljit|ap dhillon|shubh\b|guru randhawa|amrit maan|jassa dhillon|babbu maan|garry sandhu|ammy virk|gurnam bhullar|harrdy sandhu|b praak|jass manak|parmish verma|nimrat khaira|shehnaaz gill|r nait|sultaan|imran khan|tegi pannu|cheema y|gur sidhu/i],
  ['tamil', /\btamil\b|anirudh|a\.?\s?r\.?\s?rahman|sid sriram|yuvan|harris jayaraj|g\.?v\.? prakash|dhanush|santhosh narayanan|hiphop tamizha|vijay antony|ilaiyaraaja/i],
  ['telugu', /\btelugu\b|tollywood|devi sri prasad|thaman|mangli|anurag kulkarni|ram miriyala|sid sriram.*telugu|kaala bhairava|m\.?\s?m\.? keeravani/i],
  ['malayalam', /\bmalayalam\b|mollywood|sushin shyam|vineeth sreenivasan|k\.?s\.? chithra|jakes bejoy|dabzee/i],
  ['kannada', /\bkannada\b|sandalwood|arjun janya|vijay prakash|ravi basrur|sanjith hegde/i],
  ['marathi', /\bmarathi\b|ajay[- ]atul|lavani/i],
  ['bengali', /\b(bengali|bangla)\b|anupam roy|arijit.*bangla|rabindra/i],
  ['gujarati', /\b(gujarati|garba)\b|kinjal dave|geeta rabari|jignesh/i],
  ['bollywood', /bollywood|arijit singh|shreya ghoshal|atif aslam|jubin nautiyal|sachet tandon|vishal mishra|neha kakkar|darshan raval|armaan malik|pritam|sonu nigam|kishore kumar|lata mangeshkar|mohammed rafi|kumar sanu|udit narayan|alka yagnik|k\.?k\.?\b|mithoon|tanishk bagchi|shilpa rao|sunidhi chauhan|papon|amit trivedi|vishal[- ]shekhar|shankar mahadevan/i],
  ['kpop', /\b(k-?pop|bts|blackpink|stray kids|twice|newjeans|seventeen|aespa|jungkook|jimin|le sserafim|ive|txt|enhypen|ateez|itzy)\b/i],
  ['lofi', /\b(lo-?fi|slowed|reverb|chill(hop)?)\b/i],
  ['remix', /\b(remix|dj|mashup|edm|bass boosted|nonstop)\b/i],
  ['rap', /\b(rap|hip ?hop|drill|trap)\b|divine|emiway|raftaar|badshah|honey singh|mc stan|kr\$na|seedhe maut|king\b|drake|kendrick|travis scott|eminem|21 savage|lil /i],
  ['english', /taylor swift|the weeknd|ed sheeran|billie eilish|dua lipa|justin bieber|ariana grande|olivia rodrigo|sabrina carpenter|bruno mars|coldplay|imagine dragons|post malone|sza|doja cat|harry styles|charlie puth|selena gomez|shawn mendes|rihanna|beyonc|lady gaga|adele|maroon 5|one direction|chainsmokers|alan walker|marshmello/i],
  ['romantic', /\b(love|ishq|pyaar|pyar|mohabbat|dil|romantic|jaan|sanam|kadhal|prema)\b/i],
  ['sad', /\b(sad|broken|bewafa|judaai|tanha|dard|alone|heartbreak|tears|rona)\b/i],
  ['party', /\b(party|dance|club|nachna|naach|disco|thumka)\b/i],
];

export function detectStyles(item: { title?: string | null; artist?: string | null; album?: string | null; genre?: string | null }): Style[] {
  const text = `${item.title || ''} | ${item.artist || ''} | ${item.album || ''} | ${item.genre || ''}`;
  const out: Style[] = [];
  for (const [style, re] of STYLE_RULES) if (re.test(text)) out.push(style);
  return out;
}
