import { useEffect, useState } from 'react';
import { bypassAudioElement, connectAudioElement, getState, setBands, setReverb, setSpatial, setLateNight, setHeadphoneSurround, setStudioSpace as engineSetStudioSpace, setVocalMix, setInstrumentalMix, resume, subscribe } from '@/lib/audioEngine';
import { getEQSettings, hasWebAudioEffects } from '@/lib/eqSettings';
import { getRuntimePremium } from '@/lib/premiumState';
import {
  isNativePlayerAvailable,
  pushNativeEQFromWebBands,
  setNativeBassBoost,
  setNativeEQEnabled,
  setNativeLoudnessEnhancer,
  setNativePlaybackSpeed,
  setNativeReverb,
  setNativeVirtualizer,
} from '@/lib/nativePlayer';
// nativeMirror removed — on Android, ExoPlayer always owns audio when available.

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

    // Per-space NATIVE profile — Studio Spaces on APK can't use WebAudio
    // convolution, so we simulate each acoustic environment via the
    // AudioEffect chain: virtualizer width, bass shelf, loudness makeup,
    // and 5-band EQ coloration offsets (in millibels, matches FALLBACK_NATIVE_BANDS).
    //                                          60Hz  230Hz 910Hz 3.6k  14k
    const NATIVE_SPACES: Record<string, { virt: number; bass: number; loud: number; eqMb: number[] }> = {
      off:       { virt: 0,    bass: 0,   loud: 0,   eqMb: [0, 0, 0, 0, 0] },
      vinyl:     { virt: 400,  bass: 250, loud: 150, eqMb: [300, 150, 0, -300, -600] },
      studio:    { virt: 250,  bass: 0,   loud: 100, eqMb: [0, 0, 150, 200, 100] },
      bedroom:   { virt: 550,  bass: 150, loud: 250, eqMb: [200, 50, 0, -100, -250] },
      hall:      { virt: 900,  bass: 250, loud: 400, eqMb: [350, 150, 0, 200, 400] },
      cathedral: { virt: 1000, bass: 350, loud: 550, eqMb: [500, 250, -100, 250, 550] },
      stadium:   { virt: 1000, bass: 450, loud: 650, eqMb: [600, 350, 0, 200, 350] },
    };

    let native8DTimer: number | null = null;
    let native8DPhase = 0;
    const stop8D = () => {
      if (native8DTimer != null) { window.clearInterval(native8DTimer); native8DTimer = null; }
    };

    const pushNative = (s: ReturnType<typeof getEQSettings>) => {
      if (!isNativePlayerAvailable()) return;
      if (!getRuntimePremium() || !hasWebAudioEffects(s)) {
        stop8D();
        setNativeEQEnabled(false);
        setNativeBassBoost(0);
        setNativeVirtualizer(0);
        setNativeLoudnessEnhancer(0);
        setNativeReverb(0);
        return;
      }
      const space = NATIVE_SPACES[s.studioSpace] || NATIVE_SPACES.off;

      // 10-band EQ → native 5 bands, WITH per-space coloration offsets baked in
      // so Cathedral/Hall/Vinyl etc. actually change how the song sounds on APK.
      pushNativeEQFromWebBands(s.bands, WEB_BAND_FREQS_HZ, space.eqMb);

      // Bass boost: user slider OR space profile — whichever is stronger.
      const userBass = Math.round((s.bassBoost / 100) * 1000);
      setNativeBassBoost(Math.max(userBass, space.bass));

      // Late Night: real +14 dB loudness compression makeup, not the old +6 dB
      // that was inaudible on phone speakers. Combine with space loudness.
      const lateNightMb = s.lateNight ? 1400 : 0;
      setNativeLoudnessEnhancer(Math.max(lateNightMb, space.loud));

      // Android ExoPlayer cannot hear the WebAudio convolver. Attach a native
      // EnvironmentalReverb as an aux effect so the Reverb control is real.
      setNativeReverb(s.reverb);

      // Virtualizer: headphone surround / space width baseline.
      const baseVirt = Math.max(s.headphoneSurround ? 1000 : 0, space.virt);

      // 8D: oscillating virtualizer strength gives perceptible stereo movement
      // on APK (the WebAudio pan LFO can't drive ExoPlayer's audio session).
      if (s.spatialAudio) {
        if (native8DTimer == null) {
          native8DPhase = 0;
          native8DTimer = window.setInterval(() => {
            native8DPhase += 0.22;
            const cur = getEQSettings();
            if (!cur.spatialAudio) { stop8D(); return; }
            const sp = NATIVE_SPACES[cur.studioSpace] || NATIVE_SPACES.off;
            const bv = Math.max(cur.headphoneSurround ? 1000 : 0, sp.virt);
            const osc = 600 + Math.round(400 * Math.sin(native8DPhase));
            setNativeVirtualizer(Math.max(osc, bv));
          }, 220);
        }
        setNativeVirtualizer(Math.max(800, baseVirt));
      } else {
        stop8D();
        setNativeVirtualizer(baseVirt);
      }
    };


    const doReapply = () => {
      const s = getEQSettings();

      // Always honor playback rate — native <audio> property, no graph needed.
      audioElement.playbackRate = s.playbackSpeed;

      // Always push the native AudioEffect chain on Android — that path is
      // what's actually audible while ExoPlayer is active. Cheap no-op on web.
      pushNative(s);
      setNativePlaybackSpeed(s.playbackSpeed);

      const needsWebAudio = getRuntimePremium() && hasWebAudioEffects(s);

      // Android APK audible playback is ExoPlayer. Attaching WebAudio to the
      // muted WebView shadow cannot affect what users hear, and it can also
      // taint/steal the element during startup. Keep EQ on the native
      // AudioEffect path while ExoPlayer is active; use WebAudio only after the
      // native mirror has genuinely fallen back to audible WebView playback.
      if (isNativePlayerAvailable()) {
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
        setVocalMix(100);
        setInstrumentalMix(100);
        return;
      }

      const ok = connectAudioElement(audioElement);
      if (ok) isAttached = true;

      if (getState() !== 'processed') return;

      setBands(s.bands, s.bassBoost);
      setReverb(s.reverb);
      engineSetStudioSpace(s.studioSpace);
      setSpatial(s.spatialAudio);
      setLateNight(s.lateNight);
      setHeadphoneSurround(s.headphoneSurround);
      setVocalMix(s.vocalMix);
      setInstrumentalMix(s.instrumentalMix);
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
      scheduleRecoveryBurst();
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
      scheduleRecoveryBurst();
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
      stop8D();

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
