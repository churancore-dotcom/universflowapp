/**
 * Global audio engine — single AudioContext, single source per <audio>.
 *
 * Graph:
 *   <audio> -> MediaElementSource -> [8x BiquadFilter EQ] -> preGain
 *           -> dryGain ─────────────────────┐
 *           -> convolver -> wetGain ────────┤-> stereoPanner -> limiter -> destination
 *
 * 8D audio = a slow sine LFO driving stereoPanner.pan, plus a touch of reverb
 * to simulate room cues. Works on every stream (CORS-safe or not, because
 * StereoPanner is a regular AudioNode after MediaElementSource has been built).
 *
 * All parameter changes use setTargetAtTime() for click-free transitions.
 */

// Smoothing — small enough to feel instant (one audio render quantum at 48k
// ≈ 2.7ms), large enough to prevent zipper/click artifacts on gain ramps.
const SMOOTH = 0.008;       // 8ms — sub-frame, click-free
const SNAP   = 0.003;       // 3ms — used for binary on/off toggles (8D, surround)
const SPATIAL_RATE_HZ = 0.18; // ~5.5s per full L↔R orbit
const SPATIAL_DEPTH = 0.92;  // 0..1 — how far the LFO swings the pan

type Mode = 'idle' | 'processed' | 'direct' | 'unsupported';

type SourceBackedAudioElement = HTMLAudioElement & {
  __ufMediaElementSource?: MediaElementAudioSourceNode;
};

interface Engine {
  ctx: AudioContext | null;
  source: MediaElementAudioSourceNode | null;
  // Frequency-aware Mid/Side stems stage (vocal remove / instrument remove)
  stemsSplitter: ChannelSplitterNode | null;
  stemsMerger: ChannelMergerNode | null;
  stemsMidL: GainNode | null;
  stemsMidR: GainNode | null;
  stemsMidSum: GainNode | null;
  stemsMidLowFilter: BiquadFilterNode | null;
  stemsMidBandHigh: BiquadFilterNode | null;
  stemsMidBandLow: BiquadFilterNode | null;
  stemsMidHighFilter: BiquadFilterNode | null;
  stemsMidLowGain: GainNode | null;
  stemsMidBandGain: GainNode | null;
  stemsMidHighGain: GainNode | null;
  stemsSideL: GainNode | null;
  stemsSideR: GainNode | null;
  stemsSideSum: GainNode | null;
  stemsSidePos: GainNode | null;
  stemsSideNeg: GainNode | null;
  stemsDirectGain: GainNode | null;
  stemsMatrixGain: GainNode | null;
  filters: BiquadFilterNode[];
  preGain: GainNode | null;
  dryGain: GainNode | null;
  wetGain: GainNode | null;
  convolver: ConvolverNode | null;
  stereoPanner: StereoPannerNode | null;
  panLfo: OscillatorNode | null;
  panLfoGain: GainNode | null;
  // Headphone 3D Surround (crossfeed + inter-aural delay)
  surroundSplitter: ChannelSplitterNode | null;
  surroundMerger: ChannelMergerNode | null;
  surroundDirectL: GainNode | null;
  surroundDirectR: GainNode | null;
  surroundDelayLR: DelayNode | null;
  surroundDelayRL: DelayNode | null;
  surroundLpLR: BiquadFilterNode | null;
  surroundLpRL: BiquadFilterNode | null;
  surroundXfeedLR: GainNode | null;
  surroundXfeedRL: GainNode | null;
  limiter: DynamicsCompressorNode | null;
  el: HTMLAudioElement | null;
  signature: string | null;
  mode: Mode;
  spatialEnabled: boolean;
  lateNightEnabled: boolean;
  surroundEnabled: boolean;
  vocalMix: number;
  instrumentalMix: number;
  listeners: Set<(m: Mode) => void>;
  cachedIR: AudioBuffer | null;
}

/** Log the "chain active" line once per session instead of on every reapply. */
let loggedChainActive = false;

const engine: Engine = {

  ctx: null,
  source: null,
  stemsSplitter: null,
  stemsMerger: null,
  stemsMidL: null,
  stemsMidR: null,
  stemsMidSum: null,
  stemsMidLowFilter: null,
  stemsMidBandHigh: null,
  stemsMidBandLow: null,
  stemsMidHighFilter: null,
  stemsMidLowGain: null,
  stemsMidBandGain: null,
  stemsMidHighGain: null,
  stemsSideL: null,
  stemsSideR: null,
  stemsSideSum: null,
  stemsSidePos: null,
  stemsSideNeg: null,
  stemsDirectGain: null,
  stemsMatrixGain: null,
  filters: [],
  preGain: null,
  dryGain: null,
  wetGain: null,
  convolver: null,
  stereoPanner: null,
  panLfo: null,
  panLfoGain: null,
  surroundSplitter: null,
  surroundMerger: null,
  surroundDirectL: null,
  surroundDirectR: null,
  surroundDelayLR: null,
  surroundDelayRL: null,
  surroundLpLR: null,
  surroundLpRL: null,
  surroundXfeedLR: null,
  surroundXfeedRL: null,
  limiter: null,
  el: null,
  signature: null,
  mode: 'idle',
  spatialEnabled: false,
  lateNightEnabled: false,
  surroundEnabled: false,
  harmonicExciter: 0,
  stereoWidth: 50,
  listeners: new Set(),
  cachedIR: null,
};

const sourceCache = new WeakMap<HTMLAudioElement, MediaElementAudioSourceNode>();

function getSourceAudioContext(source?: MediaElementAudioSourceNode | null): AudioContext | null {
  if (!source) return null;
  const ctx = source.context as AudioContext | undefined;
  if (!ctx || ctx.state === 'closed') return null;
  return ctx;
}

function ensureCtxForElement(el: HTMLAudioElement): AudioContext | null {
  // A MediaElementSource is permanently bound to the AudioContext that created
  // it. During Vite HMR / soft reloads this module can be recreated while the
  // singleton <audio> element survives with an old source attached. If we build
  // new filters in a fresh AudioContext and connect the old source to them,
  // WebAudio throws and the EQ stays stuck in direct/unsupported. Reuse the
  // source's original context whenever it exists.
  const existingCtx = getSourceAudioContext(getCachedSource(el));
  if (existingCtx) {
    engine.ctx = existingCtx;
    return existingCtx;
  }
  return ensureCtx();
}

function getCachedSource(el: HTMLAudioElement): MediaElementAudioSourceNode | undefined {
  return sourceCache.get(el) || (el as SourceBackedAudioElement).__ufMediaElementSource;
}

function rememberSource(el: HTMLAudioElement, source: MediaElementAudioSourceNode) {
  sourceCache.set(el, source);
  // Keep the source on the element itself as well as in the module WeakMap.
  // Vite/HMR or a soft app reload can recreate this module while the singleton
  // <audio> element survives. Without this, createMediaElementSource() throws
  // "HTMLMediaElement already connected previously" and the EQ stays stuck.
  (el as SourceBackedAudioElement).__ufMediaElementSource = source;
}

// 10-band semi-graphic EQ — wider range, finer control over the spectrum.
const BAND_DEFS: Array<{ freq: number; type: BiquadFilterType; q: number }> = [
  { freq: 32,    type: 'lowshelf',  q: 0.7 },
  { freq: 64,    type: 'peaking',   q: 1.0 },
  { freq: 125,   type: 'peaking',   q: 1.0 },
  { freq: 250,   type: 'peaking',   q: 1.0 },
  { freq: 500,   type: 'peaking',   q: 1.0 },
  { freq: 1000,  type: 'peaking',   q: 1.0 },
  { freq: 2000,  type: 'peaking',   q: 1.0 },
  { freq: 4000,  type: 'peaking',   q: 1.0 },
  { freq: 8000,  type: 'peaking',   q: 1.0 },
  { freq: 16000, type: 'highshelf', q: 0.7 },
];

function ensureCtx(): AudioContext | null {
  if (engine.ctx && engine.ctx.state !== 'closed') return engine.ctx;
  const AC = window.AudioContext || (window as Window & typeof globalThis & { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
  if (!AC) return null;
  try {
    const ctx = new AC({ latencyHint: 'playback' });
    // Auto-resume on suspension. Try unconditionally so background tabs that
    // are still permitted to play audio (e.g. PWA with MediaSession active)
    // recover instantly. Browsers that block resume while hidden just reject.
    ctx.addEventListener?.('statechange', () => {
      if (ctx.state === 'suspended') {
        ctx.resume().catch(() => {});
      }
    });
    engine.ctx = ctx;
    return engine.ctx;
  } catch {
    return null;
  }
}

function isCorsSafe(el: HTMLAudioElement): boolean {
  const src = el.currentSrc || el.src;
  if (!src) return false;
  if (src.startsWith('blob:') || src.startsWith('data:')) return true;
  try {
    const u = new URL(src, window.location.href);
    if (u.origin === window.location.origin) return true;
    // A cross-origin media resource is only usable by WebAudio when the element
    // itself requested it with CORS. Without crossorigin="anonymous" the graph
    // still builds but outputs SILENCE — that is exactly the "EQ is dead on web"
    // symptom. Treat it as unsafe so we keep direct, audible playback instead.
    if (el.crossOrigin !== 'anonymous' && el.crossOrigin !== 'use-credentials') return false;
    if (u.pathname.includes('/functions/v1/stream-proxy')) return true;
    if (u.pathname.includes('/functions/v1/music-indexer') && u.searchParams.has('audio')) return true;
    if (u.hostname.endsWith('supabase.co')) return true;
  } catch { /* ignore */ }
  return false;
}

function signature(el: HTMLAudioElement): string | null {
  const src = el.currentSrc || el.src;
  if (!src) return null;
  return `${src}::${el.crossOrigin || 'none'}`;
}

/** Studio Space presets — each defines an acoustic environment. */
export type StudioSpaceId =
  | 'off' | 'vinyl' | 'studio' | 'bedroom' | 'hall' | 'cathedral' | 'stadium'
  | 'club' | 'arena' | 'chapel' | 'opera' | 'canyon';

interface SpaceProfile {
  duration: number;   // IR length in seconds
  decay: number;      // exponential decay curve (higher = faster fade)
  predelay: number;   // initial silence in seconds (room size cue)
  density: number;    // 0..1 — early reflection density
  damping: number;    // 0..1 — high-frequency damping (0 = bright, 1 = dark)
  wet: number;        // recommended wet mix 0..1
  dry: number;        // recommended dry gain
}

// Wet is a PARALLEL send now, so dry stays near unity. The old profiles cut
// dry to 0.70–0.88, which is why every space sounded like the song was being
// faded down instead of placed in a room.
const SPACE_PROFILES: Record<Exclude<StudioSpaceId, 'off'>, SpaceProfile> = {
  vinyl:     { duration: 0.5,  decay: 3.6, predelay: 0.002, density: 0.95, damping: 0.75, wet: 0.30, dry: 0.98 },
  studio:    { duration: 0.9,  decay: 2.8, predelay: 0.006, density: 0.9,  damping: 0.35, wet: 0.34, dry: 0.98 },
  bedroom:   { duration: 1.3,  decay: 2.4, predelay: 0.011, density: 0.75, damping: 0.60, wet: 0.42, dry: 0.97 },
  hall:      { duration: 3.2,  decay: 1.5, predelay: 0.032, density: 0.55, damping: 0.28, wet: 0.62, dry: 0.95 },
  cathedral: { duration: 5.6,  decay: 1.0, predelay: 0.055, density: 0.40, damping: 0.14, wet: 0.72, dry: 0.94 },
  stadium:   { duration: 4.2,  decay: 1.3, predelay: 0.105, density: 0.32, damping: 0.40, wet: 0.68, dry: 0.94 },
  // Real, distinct venues — each one is a different geometry, not a wetness step.
  club:      { duration: 1.7,  decay: 2.0, predelay: 0.018, density: 0.68, damping: 0.55, wet: 0.48, dry: 0.96 },
  arena:     { duration: 3.6,  decay: 1.4, predelay: 0.072, density: 0.36, damping: 0.38, wet: 0.64, dry: 0.95 },
  chapel:    { duration: 2.6,  decay: 1.7, predelay: 0.026, density: 0.50, damping: 0.22, wet: 0.56, dry: 0.95 },
  opera:     { duration: 4.4,  decay: 1.2, predelay: 0.042, density: 0.46, damping: 0.20, wet: 0.66, dry: 0.95 },
  canyon:    { duration: 6.5,  decay: 0.9, predelay: 0.180, density: 0.22, damping: 0.30, wet: 0.70, dry: 0.94 },
};




let currentSpaceId: StudioSpaceId = 'off';
let currentReverbPercent = 0;

// IR cache — keyed by sampleRate. Building an IR allocates and fills up to
// 220k float samples and runs synchronously on the main thread; doing it on
// every Studio Space toggle would glitch playback for 5-30ms. Pre-build all
// six profiles on first chain construction so switching is a pointer swap.
const irCache = new Map<string, AudioBuffer>();

function irKey(spaceId: Exclude<StudioSpaceId, 'off'>, sampleRate: number) {
  return `${spaceId}@${sampleRate}`;
}

function getCachedSpaceIR(ctx: AudioContext, spaceId: Exclude<StudioSpaceId, 'off'>): AudioBuffer {
  const key = irKey(spaceId, ctx.sampleRate);
  const cached = irCache.get(key);
  if (cached) return cached;
  const built = buildSpaceIR(ctx, SPACE_PROFILES[spaceId]);
  irCache.set(key, built);
  return built;
}

function prebuildAllSpaceIRs(ctx: AudioContext) {
  // Idle-time warm-up so the first toggle is instant.
  const ids = Object.keys(SPACE_PROFILES) as Array<Exclude<StudioSpaceId, 'off'>>;
  const run = () => { for (const id of ids) { try { getCachedSpaceIR(ctx, id); } catch { /* ignore */ } } };
  if (typeof (window as Window & { requestIdleCallback?: (cb: () => void) => void }).requestIdleCallback === 'function') {
    (window as Window & { requestIdleCallback: (cb: () => void) => void }).requestIdleCallback(run);
  } else {
    setTimeout(run, 50);
  }
}

function applyReverbMix(percent: number) {
  if (engine.mode !== 'processed' || !engine.ctx || !engine.dryGain || !engine.wetGain) return;
  const ctx = engine.ctx;
  const now = ctx.currentTime;
  // Old code clamped wet to 0.35 and barely dropped dry — slider felt dead.
  // Now: 0..100 % maps linearly up to 0.85 wet, dry drops to 0.55 at full.
  const p = Math.max(0, Math.min(100, percent)) / 100;
  const wet = p * 0.85;
  const dry = 1 - p * 0.45;
  engine.dryGain.gain.cancelScheduledValues(now);
  engine.wetGain.gain.cancelScheduledValues(now);
  engine.dryGain.gain.setTargetAtTime(dry, now, SMOOTH);
  engine.wetGain.gain.setTargetAtTime(wet, now, SMOOTH);
}

/**
 * Build a stereo IR from a SpaceProfile.
 *
 * Two stages, because a bare noise decay reads as "the track got quieter and
 * blurry", not as a room:
 *   1. discrete early reflections — the taps your ear uses to size the room,
 *      spread slightly differently per channel so the space feels wide;
 *   2. a damped diffuse tail with exponential decay.
 */
function buildSpaceIR(ctx: AudioContext, p: SpaceProfile): AudioBuffer {
  const sr = ctx.sampleRate;
  const length = Math.floor(sr * p.duration);
  const predelaySamples = Math.floor(sr * p.predelay);
  const buf = ctx.createBuffer(2, length, sr);
  // Bigger rooms => later, sparser early reflections.
  const spread = Math.max(0.004, p.predelay * 1.9 + 0.012);
  const reflectionCount = Math.round(6 + (1 - p.density) * 10);
  for (let ch = 0; ch < 2; ch++) {
    const data = buf.getChannelData(ch);
    let seed = (ch + 1) * 9301;
    const rand = () => {
      seed = (seed * 9301 + 49297) % 233280;
      return seed / 233280;
    };
    // --- diffuse tail ---
    let lpState = 0;
    const lpCoef = 1 - p.damping * 0.75;
    for (let i = predelaySamples; i < length; i++) {
      const t = (i - predelaySamples) / Math.max(1, length - predelaySamples);
      const decay = Math.pow(1 - t, p.decay);
      const sample = rand() < p.density ? (rand() * 2 - 1) : 0;
      lpState = lpState + lpCoef * (sample - lpState);
      data[i] = lpState * decay * 0.5;
    }
    // --- early reflections on top ---
    let offset = predelaySamples + Math.floor(sr * spread * (0.6 + ch * 0.35));
    let amp = 0.85;
    for (let r = 0; r < reflectionCount && offset < length - 2; r++) {
      const polarity = rand() < 0.5 ? -1 : 1;
      data[offset] += polarity * amp * (0.65 + rand() * 0.35);
      // Slight smear so a tap is a reflection, not a click.
      data[offset + 1] += polarity * amp * 0.35;
      amp *= 0.68 + p.density * 0.18;
      offset += Math.floor(sr * spread * (0.55 + rand() * 0.9));
    }
  }
  return buf;
}


/** Default fallback IR (used when no Studio Space is selected). */
function getReverbIR(ctx: AudioContext): AudioBuffer {
  if (engine.cachedIR && engine.cachedIR.sampleRate === ctx.sampleRate) return engine.cachedIR;
  const duration = 1.6;
  const length = Math.floor(ctx.sampleRate * duration);
  const buf = ctx.createBuffer(2, length, ctx.sampleRate);
  for (let ch = 0; ch < 2; ch++) {
    const data = buf.getChannelData(ch);
    let seed = (ch + 1) * 9301;
    const rand = () => {
      seed = (seed * 9301 + 49297) % 233280;
      return seed / 233280;
    };
    for (let i = 0; i < length; i++) {
      const decay = Math.pow(1 - i / length, 2.2);
      data[i] = (rand() * 2 - 1) * decay * 0.5;
    }
  }
  engine.cachedIR = buf;
  return buf;
}

/**
 * Apply a Studio Space — pointer-swap the convolver IR (pre-built & cached)
 * and crossfade wet/dry. The IR build is amortized to app idle time, so this
 * call is a few microseconds and never glitches audio.
 */
export function setStudioSpace(spaceId: StudioSpaceId) {
  currentSpaceId = spaceId;
  if (engine.mode !== 'processed' || !engine.ctx || !engine.convolver || !engine.dryGain || !engine.wetGain) return;
  const ctx = engine.ctx;
  const now = ctx.currentTime;
  if (spaceId === 'off') {
    engine.convolver.buffer = getReverbIR(ctx);
    applyReverbMix(currentReverbPercent);
    return;
  }
  const profile = SPACE_PROFILES[spaceId];
  engine.convolver.buffer = getCachedSpaceIR(ctx, spaceId);
  engine.wetGain.gain.cancelScheduledValues(now);
  engine.dryGain.gain.cancelScheduledValues(now);
  engine.wetGain.gain.setTargetAtTime(profile.wet, now, SMOOTH);
  engine.dryGain.gain.setTargetAtTime(profile.dry, now, SMOOTH);
}

export function getStudioSpace(): StudioSpaceId {
  return currentSpaceId;
}

function disconnectAll() {
  const nodes: (AudioNode | null)[] = [
    engine.source, ...engine.filters, engine.preGain,
    engine.dryGain, engine.wetGain, engine.convolver,
    engine.stereoPanner, engine.panLfoGain,
    engine.stemsSplitter, engine.stemsMerger,
    engine.stemsDirectGain, engine.stemsMatrixGain,
    engine.stemsMidL, engine.stemsMidR, engine.stemsMidSum,
    engine.stemsMidLowFilter, engine.stemsMidBandHigh, engine.stemsMidBandLow,
    engine.stemsMidLowGain, engine.stemsMidBandGain,
    engine.stemsSideL, engine.stemsSideR, engine.stemsSideSum,
    engine.stemsSidePos, engine.stemsSideNeg,
    engine.surroundSplitter, engine.surroundMerger,
    engine.surroundDirectL, engine.surroundDirectR,
    engine.surroundDelayLR, engine.surroundDelayRL,
    engine.surroundLpLR, engine.surroundLpRL,
    engine.surroundXfeedLR, engine.surroundXfeedRL,
    engine.limiter,
  ];
  for (const n of nodes) {
    if (!n) continue;
    try { n.disconnect(); } catch { /* ignore */ }
  }
  if (engine.panLfo) {
    try { engine.panLfo.stop(); } catch { /* ignore */ }
    try { engine.panLfo.disconnect(); } catch { /* ignore */ }
    engine.panLfo = null;
  }
}

function setMode(m: Mode) {
  if (engine.mode === m) return;
  engine.mode = m;
  for (const cb of engine.listeners) {
    try { cb(m); } catch { /* ignore */ }
  }
}

function buildProcessedChain(ctx: AudioContext, source: MediaElementAudioSourceNode) {
  disconnectAll();

  // EQ bands
  const filters = BAND_DEFS.map((def) => {
    const f = ctx.createBiquadFilter();
    f.type = def.type;
    f.frequency.value = def.freq;
    f.Q.value = def.q;
    f.gain.value = 0;
    return f;
  });

  const preGain = ctx.createGain();
  preGain.gain.value = 0.92;

  const dryGain = ctx.createGain();
  dryGain.gain.value = 1;

  const wetGain = ctx.createGain();
  wetGain.gain.value = 0;

  const convolver = ctx.createConvolver();
  convolver.buffer = getReverbIR(ctx);

  const stereoPanner = ctx.createStereoPanner();
  stereoPanner.pan.value = 0;

  // Transparent peak control — soft-knee, gentle ratio. Avoids the harsh
  // "pumping/warble" Android DSP exhibited with the previous brick-wall
  // settings (-1 / knee 0 / ratio 20), especially with bass boost engaged.
  const limiter = ctx.createDynamicsCompressor();
  limiter.threshold.value = -6;
  limiter.knee.value = 12;
  limiter.ratio.value = 4;
  limiter.attack.value = 0.01;
  limiter.release.value = 0.18;

  // --- Headphone 3D Surround crossfeed stage ---
  // Real binaural-style crossfeed: each ear receives the opposite ear's
  // signal, delayed ~0.3ms (inter-aural time difference) and low-passed
  // ~700Hz (head shadow filter). Mimics what speakers do naturally and
  // pulls the stereo image OUT of the head. Off = direct = bit-perfect.
  const surroundSplitter = ctx.createChannelSplitter(2);
  const surroundMerger = ctx.createChannelMerger(2);
  const surroundDirectL = ctx.createGain(); surroundDirectL.gain.value = 1;
  const surroundDirectR = ctx.createGain(); surroundDirectR.gain.value = 1;
  const surroundDelayLR = ctx.createDelay(0.01); surroundDelayLR.delayTime.value = 0.00033;
  const surroundDelayRL = ctx.createDelay(0.01); surroundDelayRL.delayTime.value = 0.00033;
  const surroundLpLR = ctx.createBiquadFilter(); surroundLpLR.type = 'lowpass'; surroundLpLR.frequency.value = 700; surroundLpLR.Q.value = 0.7;
  const surroundLpRL = ctx.createBiquadFilter(); surroundLpRL.type = 'lowpass'; surroundLpRL.frequency.value = 700; surroundLpRL.Q.value = 0.7;
  const surroundXfeedLR = ctx.createGain(); surroundXfeedLR.gain.value = 0; // off until enabled
  const surroundXfeedRL = ctx.createGain(); surroundXfeedRL.gain.value = 0;

  // --- Stems stage: frequency-aware Mid/Side isolation ---
  // Mid = 0.5*(L+R) holds centered content (lead vocal AND kick/bass).
  // Side = 0.5*(L-R) holds the stereo instrument bed.
  // A flat mid/side cut kills the bass along with the vocal, which is why
  // karaoke used to sound hollow. So the mid is split in two:
  //   midLow  (< 180 Hz)  -> kick + bass, follows the INSTRUMENT slider
  //   midBand (180Hz-9kHz)-> lead vocal,  follows the VOCAL slider
  // Karaoke keeps the groove; a-cappella strips the low end and the stereo
  // bed, leaving the voice. Zero latency, works on every stereo song.
  const stemsSplitter = ctx.createChannelSplitter(2);
  const stemsMerger   = ctx.createChannelMerger(2);
  const stemsDirectGain = ctx.createGain(); stemsDirectGain.gain.value = 1;
  const stemsMatrixGain = ctx.createGain(); stemsMatrixGain.gain.value = 0;

  const stemsMidL = ctx.createGain(); stemsMidL.gain.value = 0.5;
  const stemsMidR = ctx.createGain(); stemsMidR.gain.value = 0.5;
  const stemsMidSum = ctx.createGain(); stemsMidSum.gain.value = 1;
  const stemsMidLowFilter = ctx.createBiquadFilter();
  stemsMidLowFilter.type = 'lowpass'; stemsMidLowFilter.frequency.value = 180; stemsMidLowFilter.Q.value = 0.7;
  const stemsMidBandHigh = ctx.createBiquadFilter();
  stemsMidBandHigh.type = 'highpass'; stemsMidBandHigh.frequency.value = 180; stemsMidBandHigh.Q.value = 0.7;
  const stemsMidBandLow = ctx.createBiquadFilter();
  stemsMidBandLow.type = 'lowpass'; stemsMidBandLow.frequency.value = 9000; stemsMidBandLow.Q.value = 0.7;
  // Mid content above 9 kHz (cymbals, air, hi-hats) is instrument bed, not
  // voice. It used to be discarded entirely, which is why karaoke sounded
  // hollow and "not really working" — the mix lost all its top end.
  const stemsMidHighFilter = ctx.createBiquadFilter();
  stemsMidHighFilter.type = 'highpass'; stemsMidHighFilter.frequency.value = 9000; stemsMidHighFilter.Q.value = 0.7;
  const stemsMidLowGain = ctx.createGain(); stemsMidLowGain.gain.value = 1;
  const stemsMidBandGain = ctx.createGain(); stemsMidBandGain.gain.value = 1;
  const stemsMidHighGain = ctx.createGain(); stemsMidHighGain.gain.value = 1;

  const stemsSideL = ctx.createGain(); stemsSideL.gain.value = 0.5;
  const stemsSideR = ctx.createGain(); stemsSideR.gain.value = -0.5;
  const stemsSideSum = ctx.createGain(); stemsSideSum.gain.value = 1;
  const stemsSidePos = ctx.createGain(); stemsSidePos.gain.value = 1;
  const stemsSideNeg = ctx.createGain(); stemsSideNeg.gain.value = -1;

  // Neutral playback uses a direct path so mono songs stay centered and the
  // normal path is bit-transparent. Isolation crossfades into the mid/side
  // matrix only when a stem slider moves below 100%.
  source.connect(stemsDirectGain);
  stemsDirectGain.connect(filters[0]);

  // source -> splitter -> mid/side extraction -> band split -> merger
  source.connect(stemsSplitter);
  stemsSplitter.connect(stemsMidL, 0); stemsMidL.connect(stemsMidSum);
  stemsSplitter.connect(stemsMidR, 1); stemsMidR.connect(stemsMidSum);
  stemsSplitter.connect(stemsSideL, 0); stemsSideL.connect(stemsSideSum);
  stemsSplitter.connect(stemsSideR, 1); stemsSideR.connect(stemsSideSum);

  stemsMidSum.connect(stemsMidLowFilter);
  stemsMidLowFilter.connect(stemsMidLowGain);
  stemsMidSum.connect(stemsMidBandHigh);
  stemsMidBandHigh.connect(stemsMidBandLow);
  stemsMidBandLow.connect(stemsMidBandGain);
  stemsMidSum.connect(stemsMidHighFilter);
  stemsMidHighFilter.connect(stemsMidHighGain);

  // Mid content is identical in both output channels.
  stemsMidLowGain.connect(stemsMerger, 0, 0);
  stemsMidLowGain.connect(stemsMerger, 0, 1);
  stemsMidBandGain.connect(stemsMerger, 0, 0);
  stemsMidBandGain.connect(stemsMerger, 0, 1);
  stemsMidHighGain.connect(stemsMerger, 0, 0);
  stemsMidHighGain.connect(stemsMerger, 0, 1);

  // Side content is added to L and subtracted from R to rebuild stereo.
  stemsSideSum.connect(stemsSidePos); stemsSidePos.connect(stemsMerger, 0, 0);
  stemsSideSum.connect(stemsSideNeg); stemsSideNeg.connect(stemsMerger, 0, 1);

  stemsMerger.connect(stemsMatrixGain);
  stemsMatrixGain.connect(filters[0]);
  for (let i = 0; i < filters.length - 1; i++) filters[i].connect(filters[i + 1]);
  filters[filters.length - 1].connect(preGain);

  preGain.connect(dryGain);
  preGain.connect(convolver);
  convolver.connect(wetGain);

  dryGain.connect(stereoPanner);
  wetGain.connect(stereoPanner);

  // stereoPanner -> [splitter L/R] -> direct + crossfeed -> [merger] -> limiter
  stereoPanner.connect(surroundSplitter);
  surroundSplitter.connect(surroundDirectL, 0); surroundDirectL.connect(surroundMerger, 0, 0);
  surroundSplitter.connect(surroundDirectR, 1); surroundDirectR.connect(surroundMerger, 0, 1);
  // L -> delay -> lp -> xfeed -> R (right ear hears delayed/dulled left)
  surroundSplitter.connect(surroundDelayLR, 0);
  surroundDelayLR.connect(surroundLpLR);
  surroundLpLR.connect(surroundXfeedLR);
  surroundXfeedLR.connect(surroundMerger, 0, 1);
  // R -> delay -> lp -> xfeed -> L
  surroundSplitter.connect(surroundDelayRL, 1);
  surroundDelayRL.connect(surroundLpRL);
  surroundLpRL.connect(surroundXfeedRL);
  surroundXfeedRL.connect(surroundMerger, 0, 0);

  surroundMerger.connect(limiter);
  limiter.connect(ctx.destination);

  engine.source = source;
  engine.filters = filters;
  engine.preGain = preGain;
  engine.dryGain = dryGain;
  engine.wetGain = wetGain;
  engine.convolver = convolver;
  engine.stereoPanner = stereoPanner;
  engine.surroundSplitter = surroundSplitter;
  engine.surroundMerger = surroundMerger;
  engine.surroundDirectL = surroundDirectL;
  engine.surroundDirectR = surroundDirectR;
  engine.surroundDelayLR = surroundDelayLR;
  engine.surroundDelayRL = surroundDelayRL;
  engine.surroundLpLR = surroundLpLR;
  engine.surroundLpRL = surroundLpRL;
  engine.surroundXfeedLR = surroundXfeedLR;
  engine.surroundXfeedRL = surroundXfeedRL;
  engine.limiter = limiter;
  engine.stemsSplitter = stemsSplitter;
  engine.stemsMerger = stemsMerger;
  engine.stemsMidL = stemsMidL;
  engine.stemsMidR = stemsMidR;
  engine.stemsMidSum = stemsMidSum;
  engine.stemsMidLowFilter = stemsMidLowFilter;
  engine.stemsMidBandHigh = stemsMidBandHigh;
  engine.stemsMidBandLow = stemsMidBandLow;
  engine.stemsMidHighFilter = stemsMidHighFilter;
  engine.stemsMidLowGain = stemsMidLowGain;
  engine.stemsMidBandGain = stemsMidBandGain;
  engine.stemsMidHighGain = stemsMidHighGain;
  engine.stemsSideL = stemsSideL;
  engine.stemsSideR = stemsSideR;
  engine.stemsSideSum = stemsSideSum;
  engine.stemsSidePos = stemsSidePos;
  engine.stemsSideNeg = stemsSideNeg;
  engine.stemsDirectGain = stemsDirectGain;
  engine.stemsMatrixGain = stemsMatrixGain;

  // Persistent 8D LFO — built ONCE with the chain and left running forever.
  // Toggling 8D just ramps lfoGain between 0 (off) and SPATIAL_DEPTH (on).
  // No oscillator restart, no node creation, no click. Single-frame on/off.
  const panLfo = ctx.createOscillator();
  panLfo.type = 'sine';
  panLfo.frequency.value = SPATIAL_RATE_HZ;
  const panLfoGain = ctx.createGain();
  panLfoGain.gain.value = 0; // off by default
  panLfo.connect(panLfoGain);
  panLfoGain.connect(stereoPanner.pan);
  try { panLfo.start(); } catch { /* already started */ }
  engine.panLfo = panLfo;
  engine.panLfoGain = panLfoGain;

  // Warm IR cache for instant Studio Space switching.
  prebuildAllSpaceIRs(ctx);

  // Re-apply the persisted spatial state on the fresh chain
  applySpatial();
  // Re-apply the persisted Studio Space on the fresh chain
  if (currentSpaceId !== 'off') setStudioSpace(currentSpaceId);
  // Re-apply Late Night compression on the fresh chain
  applyLateNightToLimiter();
  // Re-apply Headphone 3D Surround on the fresh chain
  applySurround();
  // Re-apply persisted stems (vocal/instrumental mix)
  applyStems();
}

function applyStems() {
  if (!engine.ctx || !engine.stemsMidSum) return;
  const now = engine.ctx.currentTime;
  const vocal = Math.max(0, Math.min(1, engine.vocalMix / 100));
  const instrument = Math.max(0, Math.min(1, engine.instrumentalMix / 100));
  const neutral = vocal >= 0.995 && instrument >= 0.995;
  const power = Math.sqrt((vocal * vocal + instrument * instrument) / 2);
  const makeup = power > 0.04 ? Math.min(1.9, Math.max(1, 1 / power)) : 1;

  const setGain = (n: GainNode | null, v: number, smooth = SMOOTH) => {
    if (!n) return;
    n.gain.cancelScheduledValues(now);
    n.gain.setTargetAtTime(v, now, smooth);
  };

  // Crossfade direct → matrix so neutral playback stays bit-transparent.
  setGain(engine.stemsDirectGain, neutral ? 1 : 0, SNAP);
  setGain(engine.stemsMatrixGain, neutral ? 0 : makeup, SNAP);

  // Centered low end (kick/bass) belongs to the instrument bed, so karaoke
  // keeps the groove instead of sounding thin. Full a-cappella still strips
  // it, leaving the isolated voice band.
  setGain(engine.stemsMidLowGain, instrument);
  // Centered vocal band follows the vocal slider.
  setGain(engine.stemsMidBandGain, vocal);
  // Centered air/cymbals stay with the instruments.
  setGain(engine.stemsMidHighGain, instrument);
  // Stereo instrument bed follows the instrument slider.
  setGain(engine.stemsSidePos, instrument);
  setGain(engine.stemsSideNeg, -instrument);
}

/** Vocal mix (0..100). 100 = normal, 0 = karaoke (vocals removed). */
export function setVocalMix(percent: number) {
  engine.vocalMix = Math.max(0, Math.min(100, percent));
  if (engine.mode !== 'processed') return;
  applyStems();
}

/** Instrumental mix (0..100). 100 = normal, 0 = a-cappella (music removed). */
export function setInstrumentalMix(percent: number) {
  engine.instrumentalMix = Math.max(0, Math.min(100, percent));
  if (engine.mode !== 'processed') return;
  applyStems();
}

function applySurround() {
  if (!engine.ctx || !engine.surroundXfeedLR || !engine.surroundXfeedRL
      || !engine.surroundDirectL || !engine.surroundDirectR) return;
  const now = engine.ctx.currentTime;
  if (engine.surroundEnabled) {
    // Crossfeed at -10 dB (gain 0.316) is the classic Linkwitz / Meier headphone
    // amp setting. Pulls vocals to center-front, opens stereo width.
    engine.surroundXfeedLR.gain.setTargetAtTime(0.32, now, SMOOTH);
    engine.surroundXfeedRL.gain.setTargetAtTime(0.32, now, SMOOTH);
    // Slight direct attenuation keeps the sum from clipping the limiter.
    engine.surroundDirectL.gain.setTargetAtTime(0.85, now, SMOOTH);
    engine.surroundDirectR.gain.setTargetAtTime(0.85, now, SMOOTH);
  } else {
    engine.surroundXfeedLR.gain.setTargetAtTime(0, now, SMOOTH);
    engine.surroundXfeedRL.gain.setTargetAtTime(0, now, SMOOTH);
    engine.surroundDirectL.gain.setTargetAtTime(1, now, SMOOTH);
    engine.surroundDirectR.gain.setTargetAtTime(1, now, SMOOTH);
  }
}

export function setHeadphoneSurround(enabled: boolean) {
  engine.surroundEnabled = enabled;
  if (engine.mode !== 'processed') return;
  applySurround();
}

export function getHeadphoneSurround(): boolean {
  return engine.surroundEnabled;
}

/**
 * Late Night Mode — heavy dynamic range compression so quiet listening
 * keeps quiet vocals/details audible without loud peaks waking anyone.
 * Re-tunes the always-on limiter into a transparent night compressor +
 * makeup gain. Off restores brick-wall protection only.
 */
function applyLateNightToLimiter() {
  if (!engine.ctx || !engine.limiter || !engine.preGain) return;
  const ctx = engine.ctx;
  const now = ctx.currentTime;
  const c = engine.limiter;
  if (engine.lateNightEnabled) {
    // Aggressive night compressor — squashes peaks hard, lifts whispers loud.
    // Threshold -38 dB + ratio 14:1 means almost everything above a whisper
    // gets pulled into a tight band, then makeup gain (×2.4 ≈ +7.6 dB) brings
    // the quiet stuff up to comfortable nighttime listening level.
    c.threshold.setTargetAtTime(-38, now, SMOOTH);
    c.knee.setTargetAtTime(24, now, SMOOTH);
    c.ratio.setTargetAtTime(14, now, SMOOTH);
    c.attack.setTargetAtTime(0.006, now, SMOOTH);
    c.release.setTargetAtTime(0.22, now, SMOOTH);
    engine.preGain.gain.setTargetAtTime(2.4, now, SMOOTH);
  } else {
    c.threshold.setTargetAtTime(-6, now, SMOOTH);
    c.knee.setTargetAtTime(12, now, SMOOTH);
    c.ratio.setTargetAtTime(4, now, SMOOTH);
    c.attack.setTargetAtTime(0.01, now, SMOOTH);
    c.release.setTargetAtTime(0.18, now, SMOOTH);
    engine.preGain.gain.setTargetAtTime(0.92, now, SMOOTH);
  }
}

export function setLateNight(enabled: boolean) {
  engine.lateNightEnabled = enabled;
  if (engine.mode !== 'processed') return;
  applyLateNightToLimiter();
}

export function getLateNight(): boolean {
  return engine.lateNightEnabled;
}

function buildDirectChain(source: MediaElementAudioSourceNode, ctx: AudioContext) {
  source.connect(ctx.destination);
  engine.source = source;
  engine.filters = [];
  engine.preGain = null;
  engine.dryGain = null;
  engine.wetGain = null;
  engine.convolver = null;
  engine.stereoPanner = null;
  engine.surroundSplitter = null;
  engine.surroundMerger = null;
  engine.surroundDirectL = null;
  engine.surroundDirectR = null;
  engine.surroundDelayLR = null;
  engine.surroundDelayRL = null;
  engine.surroundLpLR = null;
  engine.surroundLpRL = null;
  engine.surroundXfeedLR = null;
  engine.surroundXfeedRL = null;
  engine.stemsSplitter = null;
  engine.stemsMerger = null;
  engine.stemsMidL = null;
  engine.stemsMidR = null;
  engine.stemsMidSum = null;
  engine.stemsMidLowFilter = null;
  engine.stemsMidBandHigh = null;
  engine.stemsMidBandLow = null;
  engine.stemsMidLowGain = null;
  engine.stemsMidBandGain = null;
  engine.stemsSideL = null;
  engine.stemsSideR = null;
  engine.stemsSideSum = null;
  engine.stemsSidePos = null;
  engine.stemsSideNeg = null;
  engine.stemsDirectGain = null;
  engine.stemsMatrixGain = null;
  engine.limiter = null;
  if (engine.panLfo) {
    try { engine.panLfo.stop(); } catch { /* ignore */ }
    engine.panLfo = null;
  }
  engine.panLfoGain = null;
}

function getOrCreateSource(ctx: AudioContext, el: HTMLAudioElement): MediaElementAudioSourceNode | null {
  let source = getCachedSource(el);
  if (source) {
    try { source.disconnect(); } catch { /* source may already be clean */ }
    rememberSource(el, source);
    return source;
  }
  try {
    source = ctx.createMediaElementSource(el);
    rememberSource(el, source);
    return source;
  } catch (e) {
    console.warn('[audioEngine] createMediaElementSource failed', e);
    setMode('unsupported');
    return null;
  }
}

/** Connect (or reconnect) the global engine to this audio element. */
export function connectAudioElement(el: HTMLAudioElement): boolean {
  let ctx = ensureCtxForElement(el);
  if (!ctx) { setMode('unsupported'); return false; }

  const sig = signature(el);
  if (!sig) {
    setMode('idle');
    return false;
  }
  if (engine.el === el && engine.signature === sig && sig !== null) {
    if (ctx.state === 'suspended') ctx.resume().catch(() => { });
    if (engine.mode === 'processed') {
      // A source URL may change while the same HTMLAudioElement survives. The
      // graph remains valid; re-assert every persisted parameter immediately so
      // the first render quantum of the new song cannot fall back to flat.
      applySpatial();
      applyLateNightToLimiter();
      applySurround();
      applyStems();
      return true;
    }
    if ((engine.mode === 'direct' || engine.mode === 'idle') && isCorsSafe(el)) {
      const existingSource = getCachedSource(el);
      if (existingSource) {
        ctx = getSourceAudioContext(existingSource) || ctx;
        engine.ctx = ctx;
        try { existingSource.disconnect(); } catch { /* source may already be clean */ }
        buildProcessedChain(ctx, existingSource);
        setMode('processed');
        return true;
      }
    }
  }

  disconnectAll();
  engine.el = el;
  engine.signature = sig;

  if (!isCorsSafe(el)) {
    // Critical for Android background playback: do NOT create a
    // MediaElementSource for unsafe remote streams. Once created, audio is
    // routed through AudioContext; Android often suspends that in background,
    // causing lag/pause. Leave the <audio> element on its native direct path.
    const existingSource = getCachedSource(el);
    if (existingSource) {
      // If this element was already connected before, disconnectAll() has just
      // detached it from destination. Reconnect direct so audio never goes mute.
      try { existingSource.disconnect(); } catch { /* source may already be clean */ }
      const sourceCtx = getSourceAudioContext(existingSource) || ctx;
      engine.ctx = sourceCtx;
      buildDirectChain(existingSource, sourceCtx);
    }
    setMode('direct');
    return false;
  }

  const source = getOrCreateSource(ctx, el);
  if (!source) return false;
  ctx = getSourceAudioContext(source) || ctx;
  engine.ctx = ctx;

  try {
    buildProcessedChain(ctx, source);
    setMode('processed');
    if (!loggedChainActive) {
      loggedChainActive = true;
      console.log('WebAudio EQ chain active');
    }

    if (ctx.state === 'suspended') ctx.resume().catch(() => { });
    return true;
  } catch (e) {
    // CORS / tainted source slipped past the check — fall back to direct
    console.warn('[audioEngine] Failed to build processed chain, falling back to direct', e);
    disconnectAll();
    buildDirectChain(source, ctx);
    setMode('direct');
    return false;
  }
}

/** Direct path — no EQ/effects. Used when EQ is off to save CPU. */
export function bypassAudioElement(el: HTMLAudioElement): boolean {
  if (engine.el !== el && !getCachedSource(el)) {
    setMode('idle');
    return true;
  }
  let ctx = ensureCtxForElement(el);
  if (!ctx) return false;
  const source = getOrCreateSource(ctx, el);
  if (!source) return false;
  ctx = getSourceAudioContext(source) || ctx;
  engine.ctx = ctx;

  if (engine.el === el && engine.mode === 'direct') return true;
  disconnectAll();
  engine.el = el;
  engine.signature = signature(el);
  buildDirectChain(source, ctx);
  setMode('direct');
  if (ctx.state === 'suspended' && document.visibilityState === 'visible') {
    ctx.resume().catch(() => { });
  }
  return true;
}

/** Apply N band gains in dB. Smoothed via setTargetAtTime. Clamped ±15dB.
 *  Bass boost now drives the dedicated sub-bass shelf (32Hz) + 64Hz peak ONLY
 *  — so you feel real low-end punch without muddying vocals (250-2kHz untouched).
 *  The brick-wall limiter at the end of the graph protects against clipping. */
export function setBands(gainsDb: number[], bassBoostPercent = 0) {
  if (engine.mode !== 'processed' || !engine.ctx || !engine.filters.length) return;
  const ctx = engine.ctx;
  const now = ctx.currentTime;
  // Bass boost — reined in so high settings don't drive the limiter into pumping.
  const pct = Math.min(100, Math.max(0, bassBoostPercent)) / 100;
  const subBoost = pct * 10;   // 32Hz sub — felt as physical thump
  const punchBoost = pct * 7;  // 64Hz — the "thump" frequency
  const kickBoost  = pct * 3;  // 125Hz — slight body, no vocal muddiness

  for (let i = 0; i < engine.filters.length; i++) {
    let g = gainsDb[i] ?? 0;
    if (i === 0) g += subBoost;
    else if (i === 1) g += punchBoost;
    else if (i === 2) g += kickBoost;
    g = Math.max(-15, Math.min(15, g));
    const param = engine.filters[i].gain;
    param.cancelScheduledValues(now);
    param.setTargetAtTime(g, now, SMOOTH);
  }
}

/** 0..100 wet mix. Capped at 35% wet so vocals stay intelligible. */
export function setReverb(percent: number) {
  currentReverbPercent = Math.max(0, Math.min(100, percent));
  if (currentSpaceId !== 'off') return;
  applyReverbMix(currentReverbPercent);
}

/**
 * Apply the persisted 8D state to the always-running LFO. Toggling is just
 * a gain ramp (3-8ms) — no oscillator restart, no node creation, no click.
 * Single audio-frame on/off.
 */
function applySpatial() {
  if (!engine.ctx || !engine.panLfoGain || !engine.stereoPanner) return;
  const ctx = engine.ctx;
  const now = ctx.currentTime;
  const target = engine.spatialEnabled ? SPATIAL_DEPTH : 0;
  engine.panLfoGain.gain.cancelScheduledValues(now);
  engine.panLfoGain.gain.setTargetAtTime(target, now, SNAP);
  if (!engine.spatialEnabled) {
    // When fading out, pull the pan back toward center alongside the LFO fade.
    engine.stereoPanner.pan.cancelScheduledValues(now);
    engine.stereoPanner.pan.setTargetAtTime(0, now, SMOOTH);
  }
  // 8D "room" cue — small reverb wash when on, restore user reverb when off.
  if (currentSpaceId === 'off' && engine.dryGain && engine.wetGain) {
    if (engine.spatialEnabled) {
      engine.wetGain.gain.cancelScheduledValues(now);
      engine.dryGain.gain.cancelScheduledValues(now);
      engine.wetGain.gain.setTargetAtTime(0.22, now, SMOOTH);
      engine.dryGain.gain.setTargetAtTime(0.85, now, SMOOTH);
    } else {
      applyReverbMix(currentReverbPercent);
    }
  }
}

/** Toggle 8D auto-rotating spatial mode. Single boolean — no extra knobs. */
export function setSpatial(enabled: boolean) {
  engine.spatialEnabled = enabled;
  if (engine.mode !== 'processed') return;
  applySpatial();
}

export function resume() {
  if (engine.ctx?.state === 'suspended') {
    engine.ctx.resume().catch(() => { });
  }
}

export function getState(): Mode {
  return engine.mode;
}

export function subscribe(cb: (m: Mode) => void): () => void {
  engine.listeners.add(cb);
  cb(engine.mode);
  return () => { engine.listeners.delete(cb); };
}

/**
 * Read-only spectrum tap for visualizers. Connected as a side-branch off the
 * live source (never to destination), so audio routing/output is untouched.
 * Returns null when no WebAudio graph exists (e.g. native ExoPlayer path).
 */
let visualAnalyser: AnalyserNode | null = null;
let visualAnalyserCtx: AudioContext | null = null;

export function getAnalyser(): AnalyserNode | null {
  const ctx = engine.ctx;
  const source = engine.source;
  if (!ctx || !source) return null;
  try {
    if (visualAnalyser && visualAnalyserCtx === ctx) return visualAnalyser;
    const analyser = ctx.createAnalyser();
    analyser.fftSize = 512;
    analyser.smoothingTimeConstant = 0.72;
    source.connect(analyser);
    visualAnalyser = analyser;
    visualAnalyserCtx = ctx;
    return analyser;
  } catch {
    return null;
  }
}
