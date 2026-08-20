import { useEffect, useRef, useState } from 'react';
import { Check, Copy, ExternalLink, Loader2, Youtube } from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import {
  isNativePlayerAvailable,
  getYouTubeAccountStatus,
  startYouTubeAccountAuth,
  pollYouTubeAccountAuth,
  disconnectYouTubeAccount,
  type YouTubeDeviceAuth,
} from '@/lib/nativePlayer';

/**
 * Optional account pairing, rendered only inside the Android app.
 *
 * Playback resolves on the device, so an account is the one thing that removes
 * the remaining "refused without a session" failures (age-gated and
 * region-locked tracks). Nothing about the pairing leaves the phone.
 */
export function YouTubeAccountSection() {
  const [connected, setConnected] = useState(false);
  const [pairing, setPairing] = useState<YouTubeDeviceAuth | null>(null);
  const [busy, setBusy] = useState(false);
  const pollTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    void getYouTubeAccountStatus().then(setConnected);
    return () => {
      if (pollTimer.current) clearTimeout(pollTimer.current);
    };
  }, []);

  if (!isNativePlayerAvailable()) return null;

  const beginPairing = async () => {
    setBusy(true);
    const auth = await startYouTubeAccountAuth();
    setBusy(false);
    if (!auth) {
      toast.error("Couldn't start pairing — check your connection");
      return;
    }
    setPairing(auth);
    // Poll on the interval Google asked for; widening it on slow_down keeps the
    // grant alive instead of getting the device code rejected for hammering.
    let intervalMs = Math.max(auth.interval, 5) * 1000;
    const deadline = Date.now() + auth.expiresIn * 1000;

    const tick = async () => {
      if (Date.now() > deadline) {
        setPairing(null);
        toast.error('Pairing code expired — try again');
        return;
      }
      const res = await pollYouTubeAccountAuth(auth.deviceCode);
      if (res.status === 'connected') {
        setPairing(null);
        setConnected(true);
        toast.success('YouTube account connected');
        return;
      }
      if (res.status === 'error') {
        setPairing(null);
        const message = res.error === 'access_denied'
          ? 'Pairing was declined'
          : res.error === 'secure_exchange_required'
            ? 'Account connection needs a secure app update'
            : "Pairing didn't complete";
        toast.error(message);
        return;
      }
      if (res.status === 'slow_down') intervalMs += 5000;
      pollTimer.current = setTimeout(() => { void tick(); }, intervalMs);
    };
    pollTimer.current = setTimeout(() => { void tick(); }, intervalMs);
  };

  const disconnect = async () => {
    await disconnectYouTubeAccount();
    setConnected(false);
    toast.success('YouTube account disconnected');
  };

  return (
    <div className="px-4 py-3 space-y-3">
      <div className="flex items-start gap-3">
        <Youtube className="w-4 h-4 mt-0.5 text-primary shrink-0" />
        <div className="min-w-0 flex-1">
          <p className="text-sm text-foreground">Connect YouTube account</p>
          <p className="text-xs text-muted-foreground mt-0.5">
            {connected
              ? 'Connected — restricted and age-gated tracks now play.'
              : 'Optional. Fixes tracks that refuse to play without a signed-in session. Stays on this device.'}
          </p>
        </div>
      </div>

      {pairing ? (
        <div className="rounded-[14px] border border-border bg-muted/40 p-3 space-y-2">
          <p className="text-xs text-muted-foreground">
            Open the link, then enter this code:
          </p>
          <div className="flex items-center gap-2">
            <code className="font-display text-lg tracking-[0.2em] text-foreground">{pairing.userCode}</code>
            <button
              type="button"
              aria-label="Copy pairing code"
              className="p-1.5 rounded-md hover:bg-muted"
              onClick={() => {
                void navigator.clipboard?.writeText(pairing.userCode);
                toast.success('Code copied');
              }}
            >
              <Copy className="w-3.5 h-3.5 text-muted-foreground" />
            </button>
          </div>
          <a
            href={pairing.verificationUrl}
            target="_blank"
            rel="noreferrer"
            className="inline-flex items-center gap-1.5 text-xs text-primary"
          >
            {pairing.verificationUrl.replace(/^https?:\/\//, '')}
            <ExternalLink className="w-3 h-3" />
          </a>
          <p className="text-[11px] text-muted-foreground flex items-center gap-1.5">
            <Loader2 className="w-3 h-3 animate-spin" /> Waiting for you to approve…
          </p>
        </div>
      ) : connected ? (
        <div className="flex items-center gap-2">
          <span className="inline-flex items-center gap-1 text-xs text-primary">
            <Check className="w-3.5 h-3.5" /> Connected
          </span>
          <Button variant="ghost" size="sm" className="ml-auto text-xs" onClick={() => void disconnect()}>
            Disconnect
          </Button>
        </div>
      ) : (
        <Button size="sm" className="w-full text-xs" disabled={busy} onClick={() => void beginPairing()}>
          {busy ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : 'Connect account'}
        </Button>
      )}
    </div>
  );
}
