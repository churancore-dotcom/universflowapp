// Initializes native Capacitor plugins (splash + status bar) on app start.
// Safe no-op on web — every call is wrapped so missing native bridge never throws.
import { Capacitor } from '@capacitor/core';

let splashHidden = false;
/** Called after the app shell has committed: two paints, then one fade. */
export function hideNativeSplash() {
  if (splashHidden || !Capacitor.isNativePlatform()) return;
  splashHidden = true;
  void import('@capacitor/splash-screen')
    .then(({ SplashScreen }) => {
      requestAnimationFrame(() => requestAnimationFrame(() => {
        void SplashScreen.hide({ fadeOutDuration: 180 }).catch(() => {});
      }));
    })
    .catch(() => {});
}

export async function initCapacitorNative() {
  if (!Capacitor.isNativePlatform()) return;

  // The native splash is released by hideNativeSplash() once the shell mounts.
  // Safety net only if the shell never mounts (crash): never an endless splash.
  window.setTimeout(hideNativeSplash, 5000);

  // Streaming Quality tier → on-device InnerTube resolver. Applied at boot and
  // re-applied whenever Settings changes the tier, so Saver/Normal/High/Ultra
  // genuinely change which stream the APK requests.
  try {
    const [{ setNativeStreamBitrateCap }, { getStreamBitrateCap }] = await Promise.all([
      import('@/lib/nativePlayer'),
      import('@/lib/userPrefs'),
    ]);
    const push = () => { void setNativeStreamBitrateCap(getStreamBitrateCap()); };
    push();
    window.addEventListener('uf-prefs-changed', push);
  } catch (e) {
    console.warn('[capacitor] stream quality cap init failed:', e);
  }

  // Status bar — dark/transparent so it blends with the dark UI.
  try {
    const { StatusBar, Style } = await import('@capacitor/status-bar');
    await StatusBar.setStyle({ style: Style.Dark });
    if (Capacitor.getPlatform() === 'android') {
      await StatusBar.setBackgroundColor({ color: '#00000000' });
      await StatusBar.setOverlaysWebView({ overlay: true });
    }
  } catch (e) {
    console.warn('[capacitor] StatusBar init failed:', e);
  }

}
