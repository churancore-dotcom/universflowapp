import { useEffect, useState } from 'react';
import { bypassAudioElement, connectAudioElement, getState, setBands, setReverb, setSpatial, setLateNight, setHeadphoneSurround, setStudioSpace as engineSetStudioSpace, resume, subscribe } from '@/lib/audioEngine';
import { getEQSettings, hasWebAudioEffects } from '@/lib/eqSettings';
import { getRuntimePremium } from '@/lib/premiumState';
import {
  isNativePlayerAvailable,
  pushNativeEQFromWebBands,
  setNativeBassBoost,
  setNativeEQEnabled,
  setNativeLoudnessEnhancer,
  setNativeVirtualizer,
} from '@/lib/nativePlayer';
import { isNativeMirrorActive } from '@/lib/nativeMirror';

// Web EQ band center frequencies — must mirror BAND_DEFS in audioEngine.ts.
const WEB_BAND_FREQS_HZ = [32, 64, 125, 250, 500, 1000, 2000, 4000, 8000, 16000];

const RETRY_DELAYS_MS = [0, 50, 140, 320, 700];


/**
 * Mount once at app root.
 *
 * Critical Android background-audio rule:
 *   - When EQ is FLAT (default state), do NOT create a MediaElementSource
 *     or touch the WebAudio graph at all. The <audio> element plays directly
 *     through Android's native MediaPlayer, which the foreground music
 *     notification service keeps alive on lock screen / in background with
 *     ZERO gaps.
 *   - When the user actually enables an EQ effect (slider, reverb, spatial,
 *     studio space, late-night, playback speed), THEN we attach WebAudio.
 *     Once attached the element is tainted forever (Web Audio limitation),
 *     but that's an acceptable trade because the user explicitly chose the
 *     effect.
 *
 * This single change eliminates the 2-4s lock-screen gap and the
 * background glitchiness that the WebAudio graph caused on Android WebView
 * (the AudioContext suspends when the WebView backgrounds).
 */
export function useGlobalAudioEngine(audioElement: HTMLAudioElement | null) {
  useEffect(() => {
    if (!audioElement) return;

    let reapplyTimer: number | null = null;
    let reapplyFrame: number | null = null;
    let retryTimers: number[] = [];
    // Once we've attached WebAudio for this element, we can't detach — the
    // MediaElementSource permanently routes audio through the graph. We just
    // keep re-pushing settings on every src/play change.
    let isAttached = false;

    const clearRetries = () => {
      retryTimers.forEach((id) => window.clearTimeout(id));
      retryTimers = [];
    };

    const pushNative = (s: ReturnType<typeof getEQSettings>, isPremium: boolean) => {
      if (!isNativePlayerAvailable()) return;
      // Non-premium or flat → disable all native effects.
      if (!isPremium) {
        setNativeEQEnabled(false);
        setNativeBassBoost(0);
        setNativeVirtualizer(0);
        setNativeLoudnessEnhancer(0);
        return;
      }
      // Per-band EQ → millibels, mapped to native band centers.
      pushNativeEQFromWebBands(s.bands, WEB_BAND_FREQS_HZ);
      // Bass boost 0..100 → 0..1000 strength.
      setNativeBassBoost(Math.round((s.bassBoost / 100) * 1000));
      // Spatial / headphone surround → Virtualizer strength.
      const virtStrength = s.headphoneSurround ? 1000 : s.spatialAudio ? 700 : 0;
      setNativeVirtualizer(virtStrength);
      // Late-night = quiet boost via LoudnessEnhancer (~+6dB).
      setNativeLoudnessEnhancer(s.lateNight ? 600 : 0);
    };

    const doReapply = () => {
      const s = getEQSettings();
      const isPremium = getRuntimePremium();

      // Always honor playback rate — native <audio> property, no graph needed.
      audioElement.playbackRate = s.playbackSpeed;

      // Always push the native AudioEffect chain on Android — that path is
      // what's actually audible while ExoPlayer is active. Cheap no-op on web.
      pushNative(s, isPremium);

      const needsWebAudio = isPremium && hasWebAudioEffects(s);

      // Android APK audible playback is ExoPlayer. Attaching WebAudio to the
      // muted WebView shadow cannot affect what users hear, and it can also
      // taint/steal the element during startup. Keep EQ on the native
      // AudioEffect path while ExoPlayer is active; use WebAudio only after the
      // native mirror has genuinely fallen back to audible WebView playback.
      if (isNativePlayerAvailable() && isNativeMirrorActive()) {
        if (isAttached) bypassAudioElement(audioElement);
        return;
      }

      // Background playback wins over an always-on transparent graph. Android
      // WebView commonly suspends AudioContext after lock/background, so keep
      // flat/default playback on the native <audio> path and only attach the
      // WebAudio chain when the user actually enables EQ/effects.
      if (!needsWebAudio) {
        if (isAttached) bypassAudioElement(audioElement);
        setBands([0, 0, 0, 0, 0, 0, 0, 0, 0, 0], 0);
        setReverb(0);
        engineSetStudioSpace('off');
        setSpatial(false);
        setLateNight(false);
        setHeadphoneSurround(false);
        return;
      }

      const ok = connectAudioElement(audioElement);
      if (ok) isAttached = true;

      if (getState() !== 'processed') return;

      if (!isPremium) {
        // Non-premium: keep graph transparent. Bands flat, no effects.
        setBands([0, 0, 0, 0, 0, 0, 0, 0, 0, 0], 0);
        setReverb(0);
        engineSetStudioSpace('off');
        setSpatial(false);
        setLateNight(false);
        setHeadphoneSurround(false);
        return;
      }

      setBands(s.bands, s.bassBoost);
      setReverb(s.reverb);
      engineSetStudioSpace(s.studioSpace);
      setSpatial(s.spatialAudio);
      setLateNight(s.lateNight);
      setHeadphoneSurround(s.headphoneSurround);
    };


    const scheduleRecoveryBurst = () => {
      clearRetries();
      retryTimers = RETRY_DELAYS_MS.map((delay) => window.setTimeout(() => {
        doReapply();
        if (getState() === 'processed') clearRetries();
      }, delay));
    };

    // Two coalescing paths:
    //   - reapplyFrame: instant (next paint frame) — used for user-driven UI
    //     events like uf-eq-changed. 60 rapid slider moves collapse to 60
    //     frame-aligned applies with zero queued timers.
    //   - reapplyTimer: small delay (30ms) — used for media-readiness bursts
    //     (loadstart + loadedmetadata + canplay fire in quick succession).
    const reapplyNow = () => {
      if (reapplyFrame != null) return;
      reapplyFrame = window.requestAnimationFrame(() => {
        reapplyFrame = null;
        doReapply();
      });
    };
    const reapply = (delay = 30) => {
      if (delay === 0) { reapplyNow(); return; }
      if (reapplyTimer != null) window.clearTimeout(reapplyTimer);
      reapplyTimer = window.setTimeout(() => {
        reapplyTimer = null;
        doReapply();
      }, delay);
    };
    const onMediaReady = () => {
      reapply();
      // Some mobile WebViews briefly report a direct/idle engine while the new
      // proxied source is still committing. Keep trying for <1s so the EQ never
      // gets stuck in the "Reloading stream for effects…" state after a swap.
      if (getRuntimePremium()) scheduleRecoveryBurst();
    };

    const onPlay = () => {
      if (isAttached) resume();
      reapplyNow();
    };
    const onPointer = () => { if (isAttached) resume(); };

    const onVisibility = () => {
      if (document.visibilityState !== 'hidden' && isAttached) resume();
    };

    // User toggled EQ in modal — apply on the very next frame. The graph is
    // already attached, so this is just AudioParam.setTargetAtTime() calls.
    const onEqChanged = () => {
      reapplyNow();
      if (getRuntimePremium()) scheduleRecoveryBurst();
    };

    doReapply();
    audioElement.addEventListener('loadstart', onMediaReady);
    audioElement.addEventListener('loadedmetadata', onMediaReady);
    audioElement.addEventListener('canplay', onMediaReady);
    audioElement.addEventListener('play', onPlay);
    audioElement.addEventListener('playing', onPlay);
    document.addEventListener('pointerdown', onPointer, { once: true });
    document.addEventListener('visibilitychange', onVisibility);
    window.addEventListener('uf-eq-changed', onEqChanged);
    window.addEventListener('uf-eq-source-ready', onEqChanged);
    window.addEventListener('uf-premium-changed', onEqChanged);
    window.addEventListener('uf-eq-force-reattach', onEqChanged);

    return () => {
      if (reapplyTimer != null) clearTimeout(reapplyTimer);
      if (reapplyFrame != null) cancelAnimationFrame(reapplyFrame);
      clearRetries();
      audioElement.removeEventListener('loadstart', onMediaReady);
      audioElement.removeEventListener('loadedmetadata', onMediaReady);
      audioElement.removeEventListener('canplay', onMediaReady);
      audioElement.removeEventListener('play', onPlay);
      audioElement.removeEventListener('playing', onPlay);
      document.removeEventListener('pointerdown', onPointer);
      document.removeEventListener('visibilitychange', onVisibility);
      window.removeEventListener('uf-eq-changed', onEqChanged);
      window.removeEventListener('uf-eq-source-ready', onEqChanged);
      window.removeEventListener('uf-premium-changed', onEqChanged);
      window.removeEventListener('uf-eq-force-reattach', onEqChanged);
    };
  }, [audioElement]);
}

export function useEngineState() {
  const [mode, setMode] = useState(() => getState());
  useEffect(() => {
    setMode(getState());
    return subscribe(setMode);
  }, []);
  return mode;
}
