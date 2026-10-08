import { Capacitor } from '@capacitor/core';

type Connection = { connected: boolean };
type Listener = { remove: () => Promise<void> };
type NativeNetwork = {
  getStatus: () => Promise<Connection>;
  addListener: (event: 'networkStatusChange', callback: (status: Connection) => void) => Promise<Listener>;
};

/** Bundled localhost assets prove the shell exists, not that internet exists. */
export function monitorOfflineConnectivity(
  onChange: (offline: boolean) => void,
  browser: Pick<Window, 'addEventListener' | 'removeEventListener'> & { navigator: { onLine: boolean } },
  loadNative?: () => Promise<NativeNetwork>,
): () => void {
  let stopped = false;
  let nativeActive = false;
  let listener: Listener | undefined;
  let revision = 0;
  const publish = (connected: boolean) => { if (!stopped) onChange(!connected); };
  const online = () => { if (!nativeActive) publish(true); };
  const offline = () => publish(false);
  publish(browser.navigator.onLine);
  browser.addEventListener('online', online);
  browser.addEventListener('offline', offline);

  if (loadNative) {
    void (async () => {
      try {
        const network = await loadNative();
        if (stopped) return;
        listener = await network.addListener('networkStatusChange', (status) => {
          revision += 1;
          nativeActive = true;
          publish(status.connected);
        });
        if (stopped) { await listener.remove(); return; }
        const beforeRead = revision;
        const status = await network.getStatus();
        if (revision === beforeRead) {
          nativeActive = true;
          publish(status.connected);
        }
      } catch { /* Browser connectivity remains available if the plugin fails. */ }
    })();
  }

  return () => {
    stopped = true;
    browser.removeEventListener('online', online);
    browser.removeEventListener('offline', offline);
    if (listener) void listener.remove().catch(() => {});
  };
}

export function watchOfflineConnectivity(onChange: (offline: boolean) => void) {
  return monitorOfflineConnectivity(
    onChange,
    window,
    Capacitor.isNativePlatform() ? () => import('@capacitor/network').then(({ Network }) => Network) : undefined,
  );
}