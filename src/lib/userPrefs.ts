// Central store for user-facing preferences from the Settings screen.
// Every setting written from Settings.tsx should have a matching reader here
// so consumers (player, downloader, i18n) never have to know the raw
// localStorage key. Emits a `uf-prefs-changed` DOM event so live components
// can react instantly.

export type QualityTier = 'saver' | 'normal' | 'high' | 'very_high';

/** Approx. max audio bitrate (bps) per tier — used to cap adaptive streams. */
export const QUALITY_BITRATE_CAP: Record<QualityTier, number> = {
  saver: 96_000,
  normal: 160_000,
  high: 256_000,
  very_high: 400_000, // 320 kbps + headroom
};

const KEYS = {
  streamQuality: 'uf_stream_quality',
  downloadQuality: 'uf_download_quality',
  wifiOnly: 'uf_download_wifi_only',
  language: 'uf_language',
} as const;

const readQ = (key: string, fallback: QualityTier): QualityTier => {
  try {
    const v = localStorage.getItem(key) as QualityTier | null;
    if (v && ['saver', 'normal', 'high', 'very_high'].includes(v)) return v;
  } catch { /* ignore */ }
  return fallback;
};

export function getStreamQuality(): QualityTier { return readQ(KEYS.streamQuality, 'high'); }
export function getDownloadQuality(): QualityTier { return readQ(KEYS.downloadQuality, 'very_high'); }
export function getStreamBitrateCap(): number { return QUALITY_BITRATE_CAP[getStreamQuality()]; }
export function getDownloadBitrateCap(): number { return QUALITY_BITRATE_CAP[getDownloadQuality()]; }

export function getWifiOnlyDownload(): boolean {
  try { return localStorage.getItem(KEYS.wifiOnly) === 'true'; } catch { return false; }
}

export type LanguagePref = 'en' | 'hi' | 'pa';
export function getLanguage(): LanguagePref {
  try {
    const v = localStorage.getItem(KEYS.language) as LanguagePref | null;
    if (v && ['en', 'hi', 'pa'].includes(v)) return v;
  } catch { /* ignore */ }
  return 'en';
}

/** Apply the current language pref to <html lang>. Safe on SSR. */
export function applyLanguageToDocument(lang: LanguagePref = getLanguage()): void {
  if (typeof document === 'undefined') return;
  try { document.documentElement.lang = lang; } catch { /* ignore */ }
}

export function emitPrefsChanged(): void {
  try { window.dispatchEvent(new CustomEvent('uf-prefs-changed')); } catch { /* ignore */ }
}

// ---------- Wi-Fi-only download guard ----------
// Returns true when downloading is currently ALLOWED under the user's
// preferences. On native, uses @capacitor/network for a real reading; on web
// falls back to navigator.connection heuristics. When the answer is unknown
// we let the download proceed rather than blocking users incorrectly.
export async function isDownloadAllowedNow(): Promise<{ allowed: boolean; reason?: string }> {
  if (!getWifiOnlyDownload()) return { allowed: true };
  try {
    const { Capacitor } = await import('@capacitor/core');
    if (Capacitor.isNativePlatform()) {
      try {
        const { Network } = await import('@capacitor/network');
        const status = await Network.getStatus();
        if (!status.connected) return { allowed: false, reason: 'Offline — connect to Wi-Fi to download.' };
        if (status.connectionType && status.connectionType !== 'wifi' && status.connectionType !== 'unknown') {
          return { allowed: false, reason: 'Wi-Fi only downloads are on. Connect to Wi-Fi to continue.' };
        }
        return { allowed: true };
      } catch {
        // @capacitor/network not installed — fall through to web heuristic.
      }
    }
  } catch { /* ignore */ }

  try {
    const conn = (navigator as unknown as { connection?: { type?: string; effectiveType?: string } }).connection;
    const type = conn?.type;
    if (type && type !== 'wifi' && type !== 'ethernet') {
      return { allowed: false, reason: 'Wi-Fi only downloads are on. Connect to Wi-Fi to continue.' };
    }
  } catch { /* ignore */ }
  return { allowed: true };
}
