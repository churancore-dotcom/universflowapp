import { describe, expect, it, vi } from 'vitest';
import { monitorOfflineConnectivity } from '../offlineConnectivity';

const browser = (onLine: boolean) => Object.assign(new EventTarget(), { navigator: { onLine } });
const tick = async () => { for (let i = 0; i < 8; i += 1) await Promise.resolve(); };

describe('offline startup connectivity', () => {
  it('opens offline immediately without waiting for any request', () => {
    const change = vi.fn();
    const stop = monitorOfflineConnectivity(change, browser(false));
    expect(change.mock.calls).toEqual([[true]]);
    stop();
  });

  it('uses native disconnected status even when bundled localhost reports online', async () => {
    const change = vi.fn();
    const remove = vi.fn(async () => {});
    const stop = monitorOfflineConnectivity(change, browser(true), async () => ({
      getStatus: async () => ({ connected: false }),
      addListener: async () => ({ remove }),
    }));
    await tick();
    expect(change.mock.calls).toEqual([[false], [true]]);
    stop();
    expect(remove).toHaveBeenCalledTimes(1);
  });

  it('does not overwrite a reconnect event with a stale startup status', async () => {
    let emit: ((status: { connected: boolean }) => void) | undefined;
    let finish: ((status: { connected: boolean }) => void) | undefined;
    const status = new Promise<{ connected: boolean }>(resolve => { finish = resolve; });
    const change = vi.fn();
    const stop = monitorOfflineConnectivity(change, browser(false), async () => ({
      getStatus: () => status,
      addListener: async (_, callback) => { emit = callback; return { remove: async () => {} }; },
    }));
    await tick();
    emit?.({ connected: true });
    finish?.({ connected: false });
    await tick();
    expect(change.mock.calls).toEqual([[true], [false]]);
    stop();
  });

  it('responds to browser reconnect and stops listening on teardown', () => {
    const device = browser(false);
    const change = vi.fn();
    const stop = monitorOfflineConnectivity(change, device);
    device.dispatchEvent(new Event('online'));
    stop();
    device.dispatchEvent(new Event('offline'));
    expect(change.mock.calls).toEqual([[true], [false]]);
  });
});