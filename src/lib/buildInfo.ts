export const BUILD_INFO = {
  name: "Universflow",
  version: "4.1.0",
  refreshedAt: "2026-06-24",
  channel: "github-sync-refresh",
} as const;

/**
 * The shipped app release. Keep in sync with android/app/build.gradle
 * (versionName / versionCode) — Settings shows these to users.
 */
export const APP_RELEASE = {
  versionName: "1.0.2",
  versionCode: 3,
  builtOn: "2026-09-21",
} as const;

/** Real installed version on native; falls back to the compiled constants. */
export async function getInstalledAppVersion(): Promise<{ versionName: string; versionCode: string }> {
  const fallback = { versionName: APP_RELEASE.versionName, versionCode: String(APP_RELEASE.versionCode) };
  try {
    const { Capacitor } = await import('@capacitor/core');
    if (!Capacitor.isNativePlatform()) return fallback;
    const { App } = await import('@capacitor/app');
    const info = await App.getInfo();
    return {
      versionName: info.version || fallback.versionName,
      versionCode: String(info.build || fallback.versionCode),
    };
  } catch {
    return fallback;
  }
}
