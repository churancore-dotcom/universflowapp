/**
 * Stem Lab — live vocal/backing/stage control and per-song "remix" memory.
 *
 * A StemMix is four faders, all in percent where 100 (or 50 for width) is
 * untouched:
 *   vocals  0..140 — mid-channel level (lead vocal + center kick/bass)
 *   backing 0..140 — side-channel level (the stage around the vocal)
 *   shine   0..100 — harmonic exciter (presence + air on the vocal band)
 *   width   0..100 — stereo width (50 = normal)
 *
 * Presets and the current mix persist in localStorage; per-song remixes are
 * remembered so a song you mixed once reloads its mix when it plays again.
 */

export interface StemMix {
  vocals: number;
  backing: number;
  shine: number;
  width: number;
}

export const DEFAULT_MIX: StemMix = { vocals: 100, backing: 100, shine: 0, width: 50 };

export const STEM_LIMITS = {
  vocals: { min: 0, max: 140 },
  backing: { min: 0, max: 140 },
  shine: { min: 0, max: 100 },
  width: { min: 0, max: 100 },
} as const;

export interface StemPreset {
  id: string;
  name: string;
  emoji: string;
  blurb: string;
  mix: StemMix;
}

export const STEM_PRESETS: StemPreset[] = [
  { id: 'original',  name: 'Original',    emoji: '🎧', blurb: 'Exactly as the artist mixed it.',            mix: { ...DEFAULT_MIX } },
  { id: 'karaoke',   name: 'Karaoke',     emoji: '🎤', blurb: 'Lead vocal gone — sing it yourself.',       mix: { vocals: 0,   backing: 105, shine: 10, width: 55 } },
  { id: 'acapella',  name: 'A Cappella',  emoji: '🗣️', blurb: 'Voice alone, stage stripped away.',         mix: { vocals: 118, backing: 0,   shine: 35, width: 0 } },
  { id: 'beats',     name: 'Bass & Beats',emoji: '🥁', blurb: 'Vocal tucked back, groove up front.',       mix: { vocals: 55,  backing: 110, shine: 0,  width: 45 } },
  { id: 'stagelive', name: 'Stage Live',  emoji: '🎸', blurb: 'Wide crowd feel, band pushed around you.',  mix: { vocals: 100, backing: 130, shine: 20, width: 85 } },
  { id: 'nightdrive',name: 'Night Drive', emoji: '🌙', blurb: 'Close, warm, narrow — vocals near you.',    mix: { vocals: 82,  backing: 70,  shine: 0,  width: 30 } },
];

const MIX_KEY = 'uf-stemlab-mix';
const REMIX_KEY = 'uf-stemlab-remixes';
let activeMix: StemMix | null = null;

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, Math.round(value)));
}

export function clampMix(mix: Partial<StemMix>): StemMix {
  return {
    vocals: clamp(mix.vocals ?? DEFAULT_MIX.vocals, STEM_LIMITS.vocals.min, STEM_LIMITS.vocals.max),
    backing: clamp(mix.backing ?? DEFAULT_MIX.backing, STEM_LIMITS.backing.min, STEM_LIMITS.backing.max),
    shine: clamp(mix.shine ?? DEFAULT_MIX.shine, STEM_LIMITS.shine.min, STEM_LIMITS.shine.max),
    width: clamp(mix.width ?? DEFAULT_MIX.width, STEM_LIMITS.width.min, STEM_LIMITS.width.max),
  };
}

export function isDefaultMix(mix: StemMix): boolean {
  return mix.vocals === DEFAULT_MIX.vocals && mix.backing === DEFAULT_MIX.backing
    && mix.shine === DEFAULT_MIX.shine && mix.width === DEFAULT_MIX.width;
}

export function mixEquals(a: StemMix, b: StemMix): boolean {
  return a.vocals === b.vocals && a.backing === b.backing && a.shine === b.shine && a.width === b.width;
}

export function getPresetForMix(mix: StemMix): StemPreset | null {
  return STEM_PRESETS.find((p) => mixEquals(p.mix, mix)) ?? null;
}

/** One-line summary for badges, e.g. "Vocals 0% · Backing 105%". */
export function describeMix(mix: StemMix): string {
  if (isDefaultMix(mix)) return 'Original mix';
  const preset = getPresetForMix(mix);
  if (preset) return preset.name;
  return `Vocals ${mix.vocals}% · Backing ${mix.backing}%`;
}

function storage(): Storage | null {
  try { return globalThis.localStorage ?? null; } catch { return null; }
}

export function loadMix(): StemMix {
  const s = storage();
  if (!s) return { ...DEFAULT_MIX };
  try {
    const raw = s.getItem(MIX_KEY);
    if (!raw) return { ...DEFAULT_MIX };
    return clampMix(JSON.parse(raw) as Partial<StemMix>);
  } catch {
    return { ...DEFAULT_MIX };
  }
}

export function saveMix(mix: StemMix): void {
  const s = storage();
  if (!s) return;
  try { s.setItem(MIX_KEY, JSON.stringify(clampMix(mix))); } catch { /* full */ }
}

/** The mix currently driving playback (base mix or a song-specific remix). */
export function getActiveStemMix(): StemMix {
  return activeMix ? { ...activeMix } : loadMix();
}

export function setActiveStemMix(mix: StemMix): StemMix {
  activeMix = clampMix(mix);
  return { ...activeMix };
}

type RemixMap = Record<string, StemMix>;

export function loadRemixes(): RemixMap {
  const s = storage();
  if (!s) return {};
  try {
    const raw = s.getItem(REMIX_KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw) as RemixMap;
    const out: RemixMap = {};
    for (const [k, v] of Object.entries(parsed)) out[k] = clampMix(v);
    return out;
  } catch {
    return {};
  }
}

export function getRemixForSong(songId: string): StemMix | null {
  if (!songId) return null;
  return loadRemixes()[songId] ?? null;
}

export function saveRemixForSong(songId: string, mix: StemMix): void {
  const s = storage();
  if (!s || !songId) return;
  const remixes = loadRemixes();
  remixes[songId] = clampMix(mix);
  // Cap the memory at 200 songs — drop the oldest keys beyond that.
  const keys = Object.keys(remixes);
  if (keys.length > 200) {
    for (const k of keys.slice(0, keys.length - 200)) delete remixes[k];
  }
  try { s.setItem(REMIX_KEY, JSON.stringify(remixes)); } catch { /* full */ }
}

export function removeRemixForSong(songId: string): void {
  const s = storage();
  if (!s || !songId) return;
  const remixes = loadRemixes();
  if (!(songId in remixes)) return;
  delete remixes[songId];
  try { s.setItem(REMIX_KEY, JSON.stringify(remixes)); } catch { /* full */ }
}

export function countRemixes(): number {
  return Object.keys(loadRemixes()).length;
}
