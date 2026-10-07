// Initializes native Capacitor plugins (splash + status bar) on app start.
// Safe no-op on web — every call is wrapped so missing native bridge never throws.
import { Capacitor } from '@capacitor/core';

export async function initCapacitorNative() {
  if (!Capacitor.isNativePlatform()) return;

  // Release the native cover after the shell has had two paint opportunities.
  // Never put this behind audio/status-bar initialization or a fixed sleep.
  void import('@capacitor/splash-screen').then(({ SplashScreen }) => {
    let hidden = false;
    const hide = () => {
      if (hidden) return;
      hidden = true;
      window.clearTimeout(fallback);
      void SplashScreen.hide({ fadeOutDuration: 180 }).catch(() => {});
    };
    const fallback = window.setTimeout(hide, 800);
    window.requestAnimationFrame(() => window.requestAnimationFrame(hide));
  }).catch((error) => console.warn('[capacitor] SplashScreen init failed:', error));

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
