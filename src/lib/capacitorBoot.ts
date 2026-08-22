// Initializes native Capacitor plugins (splash + status bar) on app start.
// Safe no-op on web — every call is wrapped so missing native bridge never throws.
import { Capacitor } from '@capacitor/core';

export async function initCapacitorNative() {
  if (!Capacitor.isNativePlatform()) return;

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

  // Splash — config.ts already sets a 2s launchShowDuration with the
  // brand background. We just guarantee it hides after the web shell loads.
  try {
    const { SplashScreen } = await import('@capacitor/splash-screen');
    // Give the React shell ~1.6s to paint, then fade out.
    setTimeout(() => {
      SplashScreen.hide({ fadeOutDuration: 350 }).catch(() => {});
    }, 1600);
  } catch (e) {
    console.warn('[capacitor] SplashScreen init failed:', e);
  }
}
