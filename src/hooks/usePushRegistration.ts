// Registers the device with FCM (Capacitor Push Notifications) and stores the
// token in `device_tokens`. Also wires deep-link tap handling.
//
// Design notes:
//   - We DO NOT permanently disable push after a single failure. Earlier
//     builds set a "sticky disabled" flag on any pending-flag carry-over;
//     that ended up muting the permission prompt forever on devices where
//     the user had simply force-closed the app during the first launch.
//   - We retry register() on every cold start. Firebase + google-services
//     are now wired into the APK build, so register() is safe.
//   - The token may arrive BEFORE the user signs in. We cache the latest
//     token in-memory and re-upsert it whenever auth state becomes
//     authenticated.
import { useEffect } from 'react';
import { Capacitor } from '@capacitor/core';
import { supabase } from '@/integrations/supabase/client';

const isNative = () =>
  Capacitor.isNativePlatform?.() === true;

// Module-level so other callers (e.g. a "Re-register device" button) can
// trigger a manual retry without needing to remount the hook.
let lastToken: string | null = null;
let lastDeviceMeta: Record<string, unknown> = {};
let listenersReady = false;
type PushRegisterResult = 'granted' | 'denied' | 'unsupported';

async function upsertToken(token: string, meta: Record<string, unknown>) {
  const { data } = await supabase.auth.getUser();
  const uid = data?.user?.id;
  if (!uid) return; // will retry on next auth change
  const { error } = await supabase.rpc('register_device_token', {
    _token: token,
    _platform: 'android',
    _device_info: { ...meta, last_seen_at: new Date().toISOString() },
  });
  if (error) throw error;
}

async function collectDeviceMeta() {
  let deviceMeta: Record<string, unknown> = { ua: navigator.userAgent };
  try {
    const { Device } = await import('@capacitor/device');
    const [info, langCode] = await Promise.all([
      Device.getInfo(),
      Device.getLanguageCode().catch(() => ({ value: '' })),
    ]);
    deviceMeta = {
      ...deviceMeta,
      model: info.model,
      manufacturer: info.manufacturer,
      os: info.operatingSystem,
      os_version: info.osVersion,
      platform: info.platform,
      web_view_version: info.webViewVersion,
      is_virtual: info.isVirtual,
      language: langCode?.value,
    };
  } catch (metaErr) {
    console.warn('[Push] device meta unavailable', metaErr);
  }
  lastDeviceMeta = deviceMeta;
  return deviceMeta;
}

async function setupPushListeners(
  PushNotifications: typeof import('@capacitor/push-notifications').PushNotifications,
  deviceMeta: Record<string, unknown>,
) {
  if (listenersReady) return;
  listenersReady = true;

  await PushNotifications.addListener('registration', async (t) => {
    lastToken = t.value;
    try {
      await upsertToken(t.value, deviceMeta);
    } catch (err) {
      console.warn('[Push] token registration save failed', err);
    }
  });

  await PushNotifications.addListener('registrationError', (e) => {
    console.warn('[Push] registrationError', e);
  });

  await PushNotifications.addListener('pushNotificationReceived', async (notification) => {
    // Do NOT mirror remote FCM into LocalNotifications. Several Android builds
    // already surface foreground FCM, and mirroring it creates the ugly "two
    // notifications for one send" bug. While the app is open we show exactly
    // one lightweight in-app toast; background delivery is handled by Android.
    try {
      const title = notification.title ?? 'Universflow';
      const body = notification.body ?? '';
      if (!body) return;
      const { toast } = await import('@/hooks/use-toast');
      toast({ title, description: body });
    } catch (err) {
      console.warn('[Push] foreground notification toast failed', err);
    }
  });

  await PushNotifications.addListener('pushNotificationActionPerformed', async (action) => {
    const data = (action.notification.data ?? {}) as Record<string, unknown>;
    const dl = typeof data.deep_link === 'string' ? data.deep_link : '';
    const title = action.notification.title ?? 'Notification opened';
    const { toast } = await import('@/hooks/use-toast');

    if (dl.length === 0) {
      toast({ title, description: 'No deep link attached' });
      return;
    }
    try {
      if (dl.startsWith('http')) {
        window.location.href = dl;
      } else {
        window.history.pushState({}, '', dl);
        window.dispatchEvent(new PopStateEvent('popstate'));
      }
    } catch (e) {
      console.warn('deep link nav failed', e);
    }
  });
}

async function registerAndWaitForSavedToken(
  PushNotifications: typeof import('@capacitor/push-notifications').PushNotifications,
  deviceMeta: Record<string, unknown>,
): Promise<PushRegisterResult> {
  if (lastToken) {
    try {
      await upsertToken(lastToken, deviceMeta);
      return 'granted';
    } catch (err) {
      console.warn('[Push] cached token save failed', err);
    }
  }

  return new Promise((resolve) => {
    let settled = false;
    let registrationHandle: { remove?: () => Promise<void> | void } | null = null;
    let errorHandle: { remove?: () => Promise<void> | void } | null = null;

    const cleanup = () => {
      try { registrationHandle?.remove?.(); } catch { /* ignore */ }
      try { errorHandle?.remove?.(); } catch { /* ignore */ }
    };
    const finish = (result: PushRegisterResult) => {
      if (settled) return;
      settled = true;
      window.clearTimeout(timeoutId);
      cleanup();
      resolve(result);
    };

    const timeoutId = window.setTimeout(() => {
      // The deadline always settles. A token already received keeps saving
      // in the background; permission itself was granted.
      if (lastToken) {
        void upsertToken(lastToken, deviceMeta).catch((err) => console.warn('[Push] late token save failed', err));
        finish('granted');
        return;
      }
      console.warn('[Push] registration timed out before an FCM token arrived');
      finish('denied');
    }, 12000);

    Promise.all([
      PushNotifications.addListener('registration', async (t) => {
        lastToken = t.value;
        try {
          await upsertToken(t.value, deviceMeta);
          finish('granted');
        } catch (err) {
          console.warn('[Push] token save failed during manual register', err);
          finish('denied');
        }
      }),
      PushNotifications.addListener('registrationError', (e) => {
        console.warn('[Push] registrationError during manual register', e);
        finish('denied');
      }),
    ]).then(([reg, err]) => {
      registrationHandle = reg;
      errorHandle = err;
      return PushNotifications.register();
    }).catch((err) => {
      console.warn('[Push] register call failed', err);
      finish('denied');
    });
  });
}

export function usePushRegistration() {
  useEffect(() => {
    if (!isNative()) return;
    if (localStorage.getItem('uf_notifications') === 'false') return;

    // Re-upsert the cached token whenever the user signs in so the device
    // is properly attached to their account even if the FCM token arrived
    // before login.
    const { data: authSub } = supabase.auth.onAuthStateChange((_evt, session) => {
      if (session?.user && lastToken) {
        upsertToken(lastToken, lastDeviceMeta).catch(() => { /* ignore */ });
      }
    });

    (async () => {
      try {
        const { PushNotifications } = await import('@capacitor/push-notifications');

        // 1) Permission — always prompt if not yet granted.
        let perm = await PushNotifications.checkPermissions();
        if (perm.receive === 'prompt' || perm.receive === 'prompt-with-rationale') {
          perm = await PushNotifications.requestPermissions();
        }
        if (perm.receive !== 'granted') {
          console.warn('[Push] permission not granted:', perm.receive);
          return 'denied';
        }

        // Android 8+ requires the notification channel to exist before FCM
        // can display notifications sent with android.notification.channel_id.
        try {
          await PushNotifications.createChannel({
            id: 'universflow_default',
            name: 'UniversFlow Notifications',
            description: 'Messages and updates from UniversFlow',
            importance: 5,
            visibility: 1,
          });
        } catch (channelError) {
          console.warn('[Push] notification channel setup failed', channelError);
        }

        const deviceMeta = await collectDeviceMeta();
        await setupPushListeners(PushNotifications, deviceMeta);

        // 3) Trigger the actual FCM registration and wait until the token is saved.
        return await registerAndWaitForSavedToken(PushNotifications, deviceMeta);
      } catch (e) {
        console.warn('[Push] setup skipped:', e);
        return 'denied';
      }
    })();

    return () => {
      try { authSub.subscription.unsubscribe(); } catch { /* ignore */ }
    };
  }, []);
}

/**
 * Manually re-trigger the push permission prompt + FCM registration.
 * Useful from a "Re-register device" button in Settings when the user
 * denied permission the first time or didn't see the prompt.
 */
export async function requestPushPermissionAndRegister(): Promise<PushRegisterResult> {
  if (!isNative()) return 'unsupported';
  try {
    const { PushNotifications } = await import('@capacitor/push-notifications');
    let perm = await PushNotifications.checkPermissions();
    if (perm.receive !== 'granted') {
      perm = await PushNotifications.requestPermissions();
    }
    if (perm.receive !== 'granted') return 'denied';

    try {
      await PushNotifications.createChannel({
        id: 'universflow_default',
        name: 'UniversFlow Notifications',
        description: 'Messages and updates from UniversFlow',
        importance: 5,
        visibility: 1,
      });
    } catch (channelError) {
      console.warn('[Push] notification channel setup failed', channelError);
    }

    const deviceMeta = await collectDeviceMeta();
    await setupPushListeners(PushNotifications, deviceMeta);
    return await registerAndWaitForSavedToken(PushNotifications, deviceMeta);
  } catch (e) {
    console.warn('[Push] manual register failed', e);
    return 'denied';
  }
}
