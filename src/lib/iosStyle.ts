// Optional iOS look. Pure presentation: toggles classes on <html> that
// styles.css uses for fonts, tab bar, grouped lists, glass and motion.
//
// Modes:
//   off      — Univers Flow default dark look
//   classic  — iPhone fonts, full-width translucent tab bar, grouped lists
//   glass    — latest iOS liquid-glass look: floating glass pill tab bar,
//              deeper refraction, vivid ambient colour field, springier motion
export type IosStyleMode = 'off' | 'classic' | 'glass';

const KEY = 'uf_ios_style';
const TINT_KEY = 'uf_ios_glass_tint';
export const IOS_STYLE_EVENT = 'uf-ios-style-changed';

export const getIosStyleMode = (): IosStyleMode => {
  try {
    const raw = localStorage.getItem(KEY);
    if (raw === 'glass' || raw === 'classic') return raw;
    if (raw === 'true') return 'classic'; // legacy boolean toggle
    return 'off';
  } catch {
    return 'off';
  }
};

// Back-compat boolean used by older callers: true when any iOS look is on.
export const getIosStyle = (): boolean => getIosStyleMode() !== 'off';

export const getIosGlassTint = (): number => {
  try {
    const raw = Number(localStorage.getItem(TINT_KEY));
    if (Number.isFinite(raw)) return Math.min(100, Math.max(0, raw));
  } catch { /* ignore */ }
  return 50;
};

// Low-end phones stutter on stacked backdrop blurs + SVG displacement, so the
// glass mode degrades to a lighter preset there (and under reduced motion).
const isLowEndDevice = (): boolean => {
  try {
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return true;
    const nav = navigator as Navigator & { deviceMemory?: number };
    if (typeof nav.deviceMemory === 'number' && nav.deviceMemory <= 4) return true;
    if (typeof nav.hardwareConcurrency === 'number' && nav.hardwareConcurrency <= 4) return true;
  } catch { /* ignore */ }
  return false;
};

const applyTint = (tint: number) => {
  const root = document.documentElement;
  // Clear (0)  → barely-there fill, maximum blur so content shines through.
  // Tinted (100) → denser milky fill, less blur, stronger rim.
  const t = tint / 100;
  const baseAlpha = (0.04 + t * 0.12).toFixed(3);
  const rimAlpha = (0.14 + t * 0.14).toFixed(3);
  const blur = Math.round(52 - t * 26);
  root.style.setProperty('--lg-base', `hsl(0 0% 100% / ${baseAlpha})`);
  root.style.setProperty('--lg-rim', `hsl(0 0% 100% / ${rimAlpha})`);
  root.style.setProperty('--lg-blur', `${blur}px`);
};

const clearTint = () => {
  const root = document.documentElement;
  root.style.removeProperty('--lg-base');
  root.style.removeProperty('--lg-rim');
  root.style.removeProperty('--lg-blur');
};

export const applyIosStyle = (mode: IosStyleMode, tint: number = getIosGlassTint()) => {
  if (typeof document === 'undefined') return;
  const root = document.documentElement;
  const on = mode !== 'off';
  root.classList.toggle('ios-style', on);
  root.classList.toggle('ios-glass', mode === 'glass');
  root.classList.toggle('ios-glass-lite', mode === 'glass' && isLowEndDevice());
  if (mode === 'glass') applyTint(tint);
  else clearTint();
};

export const setIosStyleMode = (mode: IosStyleMode) => {
  try { localStorage.setItem(KEY, mode); } catch { /* ignore */ }
  applyIosStyle(mode);
  try { window.dispatchEvent(new CustomEvent(IOS_STYLE_EVENT, { detail: mode })); } catch { /* ignore */ }
};

// Back-compat setter for older callers.
export const setIosStyle = (on: boolean) => setIosStyleMode(on ? 'classic' : 'off');

export const setIosGlassTint = (tint: number) => {
  const clamped = Math.min(100, Math.max(0, Math.round(tint)));
  try { localStorage.setItem(TINT_KEY, String(clamped)); } catch { /* ignore */ }
  if (getIosStyleMode() === 'glass') applyTint(clamped);
};

if (typeof window !== 'undefined') applyIosStyle(getIosStyleMode());
