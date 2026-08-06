import { useEffect, useState } from 'react';
import { bypassAudioElement, connectAudioElement, getState, setBands, setReverb, setSpatial, setLateNight, setHeadphoneSurround, setStudioSpace as engineSetStudioSpace, setVocalMix, setInstrumentalMix, resume, subscribe } from '@/lib/audioEngine';
import { getEQSettings, hasWebAudioEffects } from '@/lib/eqSettings';
import { getRuntimePremium } from '@/lib/premiumState';
import {
  isNativePlayerAvailable,
  applyNativeAudioEffects,
  setNativeVirtualizer,
} from '@/lib/nativePlayer';
// nativeMirror removed — on Android, ExoPlayer always owns audio when available.

// Web EQ band center frequencies — must mirror BAND_DEFS in audioEngine.ts.
const WEB_BAND_FREQS_HZ = [32, 64, 125, 250, 500, 1000, 2000, 4000, 8000, 16000];

const RETRY_DELAYS_MS = [0, 40, 120, 280, 600];


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
export function useGlobalAudioEngine(
  audioElement: HTMLAudioElement | null,
  options?: { skipNative?: boolean },
) {
  const skipNative = options?.skipNative ?? false;
  useEffect(() => {
    if (!audioElement) return;

    let reapplyTimer: number | null = null;
    let reapplyFrame: number | null = null;
    let retryTimers: number[] = [];
    let nativeApplyRevision = 0;
    let nativeApplyChain: Promise<void> = Promise.resolve();
    let nativeApplyTimer: number | null = null;
    let pendingNativeSnapshot: ReturnType<typeof getEQSettings> | null = null;
    let lastNativeSnapshotJSON = '';

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
    const NATIVE_SPACES: Record<string, { virt: number; bass: number; loud: number; reverb: number; eqMb: number[] }> = {
      off:       { virt: 0,    bass: 0,   loud: 0,   reverb: 0,  eqMb: [0, 0, 0, 0, 0] },
      vinyl:     { virt: 400,  bass: 250, loud: 150, reverb: 8,  eqMb: [300, 150, 0, -300, -600] },
      studio:    { virt: 250,  bass: 0,   loud: 100, reverb: 6,  eqMb: [0, 0, 150, 200, 100] },
      bedroom:   { virt: 550,  bass: 150, loud: 250, reverb: 14, eqMb: [200, 50, 0, -100, -250] },
      hall:      { virt: 900,  bass: 250, loud: 400, reverb: 28, eqMb: [350, 150, 0, 200, 400] },
      cathedral: { virt: 1000, bass: 350, loud: 550, reverb: 42, eqMb: [500, 250, -100, 250, 550] },
      stadium:   { virt: 1000, bass: 450, loud: 650, reverb: 34, eqMb: [600, 350, 0, 200, 350] },
    };

    let native8DTimer: number | null = null;
    const stop8D = () => {
      if (native8DTimer != null) { window.clearInterval(native8DTimer); native8DTimer = null; }
    };

    const applyNativeSnapshot = async (s: ReturnType<typeof getEQSettings>, revision: number) => {
      if (revision !== nativeApplyRevision) return;
      if (!isNativePlayerAvailable()) return;
      if (!getRuntimePremium() || !hasWebAudioEffects(s)) {
        stop8D();
        await applyNativeAudioEffects({
          enabled: false,
          webBands: [0, 0, 0, 0, 0, 0, 0, 0, 0, 0],
          webFrequenciesHz: WEB_BAND_FREQS_HZ,
          bassStrength: 0,
          virtualizerStrength: 0,
          loudnessGainMb: 0,
          reverbAmount: 0,
          vocalMix: 100,
          instrumentalMix: 100,
          playbackSpeed: s.playbackSpeed,
        });
        return;
      }
      const space = NATIVE_SPACES[s.studioSpace] || NATIVE_SPACES.off;
      const vocalCut = 1 - Math.max(0, Math.min(100, s.vocalMix ?? 100)) / 100;
      const instrumentalCut = 1 - Math.max(0, Math.min(100, s.instrumentalMix ?? 100)) / 100;
      // Real Mid/Side isolation runs inside ExoPlayer's PCM pipeline now.
      // The old tonal EQ "simulation" stacked on top of it and made isolated
      // vocals sound hollow/phasey, so the stem curve is gone — the processor
      // is the single source of truth.
      const nativeOffsets = space.eqMb;

      // Bass boost: user slider OR space profile — whichever is stronger.
      const userBass = Math.round((s.bassBoost / 100) * 1000);
      // Late Night: real +14 dB loudness compression makeup, not the old +6 dB
      // that was inaudible on phone speakers. Combine with space loudness.
      const lateNightMb = s.lateNight ? 1400 : 0;
      const stemMakeupMb = Math.round(Math.max(vocalCut, instrumentalCut) * 450);
      // Virtualizer: headphone surround / space width baseline.
      const baseVirt = Math.max(s.headphoneSurround ? 1000 : 0, space.virt);

      // One native bridge call applies one coherent snapshot. The previous
      // sequence of 6–8 calls could be overtaken by a newer slider event and
      // leave a mixture of old/new values on the audio session.
      await applyNativeAudioEffects({
        enabled: true,
        webBands: s.bands,
        webFrequenciesHz: WEB_BAND_FREQS_HZ,
        nativeOffsetsMb: nativeOffsets,
        bassStrength: Math.max(userBass, space.bass),
        virtualizerStrength: s.spatialAudio ? Math.max(800, baseVirt) : baseVirt,
        loudnessGainMb: Math.max(lateNightMb, space.loud, stemMakeupMb),
        reverbAmount: Math.max(s.reverb, space.reverb),
        vocalMix: s.vocalMix ?? 100,
        instrumentalMix: s.instrumentalMix ?? 100,
        playbackSpeed: s.playbackSpeed,
      });
      if (revision !== nativeApplyRevision) return;

      // Android AudioEffect parameter writes can interrupt the hardware DSP on
      // some devices. Keep spatial width static during playback; never animate
      // the Virtualizer over the bridge.
      if (s.spatialAudio) {
        stop8D();
        setNativeVirtualizer(Math.max(800, baseVirt));
      } else {
        stop8D();
        setNativeVirtualizer(baseVirt);
      }
    };

    const pushNative = (s: ReturnType<typeof getEQSettings>) => {
      // The secondary (crossfade) element must not duplicate native AudioEffect
      // writes — ExoPlayer owns a single global effect chain.
      if (skipNative) return;
      if (!isNativePlayerAvailable()) return;
      pendingNativeSnapshot = s;
      // Coalesce continuous slider events so Android hears the newest state
      // instead of draining a backlog of obsolete Capacitor bridge calls.
      if (nativeApplyTimer != null) return;
      nativeApplyTimer = window.setTimeout(() => {
        nativeApplyTimer = null;
        const snapshot = pendingNativeSnapshot;
        pendingNativeSnapshot = null;
        if (!snapshot) return;
        // Media events (loadstart/loadedmetadata/canplay/play/playing) all
        // funnel here on every track change. Re-writing an identical effect
        // snapshot rebuilds the native AudioEffect params mid-stream, which is
        // exactly what users hear as EQ glitching on the APK. Skip no-ops.
        //
        // The dedupe key MUST include the Premium flag: entitlement resolves
        // asynchronously after cold boot, so a false -> true flip with an
        // unchanged EQ snapshot used to be swallowed here and left the whole
        // effect chain disabled until the user nudged a slider.
        const json = `${getRuntimePremium() ? 1 : 0}|${JSON.stringify(snapshot)}`;
        if (json === lastNativeSnapshotJSON) return;
        lastNativeSnapshotJSON = json;
        const revision = ++nativeApplyRevision;
        nativeApplyChain = nativeApplyChain
          .catch(() => undefined)
          .then(() => applyNativeSnapshot(snapshot, revision))
          .catch(() => {
            // Bridge/session error: forget the snapshot so the next media or EQ
            // event genuinely retries instead of being deduped away.
            if (revision === nativeApplyRevision) lastNativeSnapshotJSON = '';
          });
      }, 80);
    };

    // ExoPlayer builds a NEW audio session per track, and a fresh session comes
    // up with no AudioEffect attached. Forget the last pushed snapshot so the
    // very next reapply re-arms EQ/bass/virtualizer on the new session — this
    // is the "EQ works on one song then goes dead" bug.
    const invalidateNativeSnapshot = () => { lastNativeSnapshotJSON = ''; };



    const doReapply = () => {
      const s = getEQSettings();

      // Always honor playback rate — native <audio> property, no graph needed.
      audioElement.playbackRate = s.playbackSpeed;

      // Always push the native AudioEffect chain on Android — that path is
      // what's actually audible while ExoPlayer is active. Cheap no-op on web.
      pushNative(s);

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
      // The burst only exists to recover the WebAudio graph. On Android
      // ExoPlayer owns audio, so bursting there just re-pokes native effects.
      if (isNativePlayerAvailable()) return;
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
      // Apply synchronously. AudioParam smoothing already prevents clicks, and
      // waiting for requestAnimationFrame made controls feel delayed while the
      // modal or WebView was under load/background throttling.
      if (reapplyFrame != null) {
        window.cancelAnimationFrame(reapplyFrame);
        reapplyFrame = null;
      }
      doReapply();
    };
    const reapply = (delay = 30) => {
      if (delay === 0) { reapplyNow(); return; }
      if (reapplyTimer != null) window.clearTimeout(reapplyTimer);
      reapplyTimer = window.setTimeout(() => {
        reapplyTimer = null;
        doReapply();
      }, delay);
    };
    const onMediaReady = (event: Event) => {
      // Only loadstart identifies a new source. loadedmetadata/canplay/playing
      // are the same session and must not repeatedly rewrite live DSP state.
      if (event.type === 'loadstart') invalidateNativeSnapshot();
      reapply();
      // Some mobile WebViews briefly report a direct/idle engine while the new
      // proxied source is still committing. Keep trying for <1s so the EQ never
      // gets stuck in the "Reloading stream for effects…" state after a swap.
      scheduleRecoveryBurst();
    };

    const onPlay = () => {
      if (isAttached) resume();
      // Playback start is the first moment the native session definitely
      // exists, so re-arm rather than trusting the previous push.
      reapplyNow();
    };
    const onPointer = () => { if (isAttached) resume(); };

    const onVisibility = () => {
      if (document.visibilityState !== 'hidden' && isAttached) resume();
    };

    // User toggled EQ in modal — apply in the same event turn. The graph is
    // already attached, so this is only a set of AudioParam updates.
    const onEqChanged = () => {
      reapplyNow();
      scheduleRecoveryBurst();
    };

    // Entitlement resolved (or changed) — force a full re-arm of both the
    // WebAudio graph and the native effect chain.
    const onPremiumChanged = () => {
      invalidateNativeSnapshot();
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
    window.addEventListener('uf-premium-changed', onPremiumChanged);
    window.addEventListener('uf-eq-force-reattach', onEqChanged);

    return () => {
      if (reapplyTimer != null) clearTimeout(reapplyTimer);
      if (reapplyFrame != null) cancelAnimationFrame(reapplyFrame);
      if (nativeApplyTimer != null) clearTimeout(nativeApplyTimer);
      pendingNativeSnapshot = null;
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
      window.removeEventListener('uf-premium-changed', onPremiumChanged);
      window.removeEventListener('uf-eq-force-reattach', onEqChanged);
    };
  }, [audioElement, skipNative]);
}

export function useEngineState() {
  const [mode, setMode] = useState(() => getState());
  useEffect(() => {
    setMode(getState());
    return subscribe(setMode);
  }, []);
  return mode;
}
