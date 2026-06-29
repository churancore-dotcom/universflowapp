import { useEffect, useRef, useState, useCallback } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Camera, Loader2, AlertTriangle, RotateCcw, Check, X } from 'lucide-react';
import confetti from 'canvas-confetti';

// ─────────────────────────────────────────────────────────────────────────────
// PASSIVE live face capture.
//
// Why this rewrite:
//   • The old multi-pose challenge flow was broken — `worker.onmessage` was
//     pinned to a stale `useCallback`, so phase transitions (preflight →
//     challenge → advance activeIdx) silently never fired. Users were stuck.
//   • Even when it worked, asking people to hold LEFT / RIGHT / UP / DOWN /
//     BLINK / SMILE poses for 600ms each timed out for most real users.
//
// What this does instead:
//   • Off-main-thread MediaPipe inference (faceWorker.ts) — UI stays smooth.
//   • Wait until: face present, single face, centered (loose tolerance),
//     enough size, decent lighting — held for a brief ~700ms window.
//   • Snap one 720×720 JPEG and exit.
//   • Worker handler is stored on a ref so it always sees fresh state.
// ─────────────────────────────────────────────────────────────────────────────

export interface LivenessShots {
  capture: Blob;
}

interface WorkerResult {
  t: number;
  hasFace: boolean;
  faceCount: number;
  yaw: number; pitch: number; roll: number;
  bboxW: number; bboxH: number; cx: number; cy: number;
  blinkLeft: number; blinkRight: number;
  smileLeft: number; smileRight: number;
}

// Loose, real-world thresholds so we actually capture instead of looping.
const TH = {
  minFaceFrac: 0.18,   // face short-side >= 18% of frame (was 0.30 — way too tight)
  centerTol:   0.28,   // within 28% of frame center (was 0.18)
  minBrightness: 35,   // 0..255 (was 55)
  holdMs:      700,    // hold "good" for 700ms then auto-capture
  maxYawAbs:   28,     // roughly facing the camera
  maxPitchAbs: 24,
} as const;

type QualityFail = 'none' | 'small' | 'offcenter' | 'dark' | 'multi' | 'noface' | 'angle';
const QUALITY_MSG: Record<QualityFail, string> = {
  none:      'Hold still…',
  small:     'Move a little closer',
  offcenter: 'Center your face in the circle',
  dark:      'Move to better lighting',
  multi:     'Only one face in frame',
  noface:    'Look at the camera',
  angle:     'Face the camera straight on',
};

export default function FaceLivenessCapture({
  onComplete,
  onFail,
}: {
  onComplete: (shots: LivenessShots) => void;
  onFail?: (reason: string) => void;
}) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const captureCanvasRef = useRef<HTMLCanvasElement>(null);
  const sampleCanvasRef = useRef<HTMLCanvasElement>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const workerRef = useRef<Worker | null>(null);
  const rafRef = useRef<number | null>(null);
  const inFlightRef = useRef(false);
  const lastFrameAtRef = useRef(0);
  const lastBrightnessRef = useRef(0);
  const holdStartRef = useRef<number | null>(null);
  const progressRef = useRef(0);
  const qualityRef = useRef<QualityFail>('noface');
  const phaseRef = useRef<Phase>('idle');
  const ringElRef = useRef<SVGEllipseElement>(null);
  const progressRingRef = useRef<SVGEllipseElement>(null);
  const capturedRef = useRef(false);

  type Phase = 'idle' | 'starting' | 'preflight' | 'capturing' | 'done' | 'error';
  const [phase, setPhase] = useState<Phase>('idle');
  const [err, setErr] = useState<string | null>(null);
  const [progress10Hz, setProgress10Hz] = useState(0);
  const [quality10Hz, setQuality10Hz] = useState<QualityFail>('noface');
  const [flash, setFlash] = useState(false);
  const [videoReady, setVideoReady] = useState(false);
  const [slowHelp, setSlowHelp] = useState(false);
  const modelRetryRef = useRef(0);

  useEffect(() => { phaseRef.current = phase; }, [phase]);

  // ── Teardown ────────────────────────────────────────────────────────────
  const teardown = useCallback(() => {
    if (rafRef.current) cancelAnimationFrame(rafRef.current);
    rafRef.current = null;
    streamRef.current?.getTracks().forEach((t) => t.stop());
    streamRef.current = null;
    try { workerRef.current?.terminate(); } catch { /* noop */ }
    workerRef.current = null;
  }, []);

  useEffect(() => () => teardown(), [teardown]);

  // ── 10Hz React mirror of refs for status pill / progress ───────────────
  useEffect(() => {
    if (phase !== 'preflight') return;
    const id = setInterval(() => {
      setProgress10Hz(progressRef.current);
      setQuality10Hz(qualityRef.current);
    }, 100);
    return () => clearInterval(id);
  }, [phase]);

  // ── Slow-capture hint after 20s of preflight ───────────────────────────
  useEffect(() => {
    if (phase !== 'preflight') { setSlowHelp(false); return; }
    const id = setTimeout(() => setSlowHelp(true), 20_000);
    return () => clearTimeout(id);
  }, [phase]);

  // ── 60fps ring update from refs ────────────────────────────────────────
  useEffect(() => {
    if (phase !== 'preflight') return;
    let id = 0;
    const RX = 108, RY = 132;
    const CIRC = 2 * Math.PI * ((RX + RY) / 2 + 8);
    const tick = () => {
      const p = progressRef.current;
      if (progressRingRef.current) {
        progressRingRef.current.style.strokeDashoffset = String((1 - p) * CIRC);
      }
      if (ringElRef.current) {
        const q = qualityRef.current;
        const color = q === 'none' ? '#34D399' : 'rgba(255,255,255,0.55)';
        ringElRef.current.setAttribute('stroke', color);
      }
      id = requestAnimationFrame(tick);
    };
    id = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(id);
  }, [phase]);

  // ── Quality evaluation ──────────────────────────────────────────────────
  function evaluateQuality(s: WorkerResult, brightness: number): QualityFail {
    if (!s.hasFace) return 'noface';
    if (s.faceCount > 1) return 'multi';
    const shortSide = Math.min(s.bboxW, s.bboxH);
    if (shortSide < TH.minFaceFrac) return 'small';
    const dx = Math.abs(s.cx - 0.5), dy = Math.abs(s.cy - 0.5);
    if (dx > TH.centerTol || dy > TH.centerTol) return 'offcenter';
    if (brightness < TH.minBrightness) return 'dark';
    if (Math.abs(s.yaw) > TH.maxYawAbs || Math.abs(s.pitch) > TH.maxPitchAbs) return 'angle';
    return 'none';
  }

  // ── Final capture ───────────────────────────────────────────────────────
  const doCapture = useCallback(async () => {
    if (capturedRef.current) return;
    capturedRef.current = true;
    setPhase('capturing');
    setFlash(true);
    setTimeout(() => setFlash(false), 160);
    try { confetti({ particleCount: 50, spread: 60, origin: { y: 0.4 }, scalar: 0.8 }); }
    catch { /* noop */ }

    const video = videoRef.current;
    const canvas = captureCanvasRef.current;
    if (!video || !canvas) { setPhase('error'); setErr('Capture failed. Tap Retry.'); return; }
    const SIZE = 720;
    canvas.width = SIZE; canvas.height = SIZE;
    const ctx = canvas.getContext('2d');
    if (!ctx) { setPhase('error'); setErr('Capture failed. Tap Retry.'); return; }
    const vw = video.videoWidth || SIZE;
    const vh = video.videoHeight || SIZE;
    const side = Math.min(vw, vh);
    const sx = (vw - side) / 2;
    const sy = (vh - side) / 2;
    ctx.drawImage(video, sx, sy, side, side, 0, 0, SIZE, SIZE);
    canvas.toBlob(
      (blob) => {
        teardown();
        if (!blob) { setPhase('error'); setErr('Capture failed. Tap Retry.'); return; }
        setPhase('done');
        setTimeout(() => onComplete({ capture: blob }), 320);
      },
      'image/jpeg',
      0.92,
    );
  }, [onComplete, teardown]);

  // ── Worker message handler (uses refs only — no stale closure) ─────────
  const handleWorkerMessage = useCallback((ev: MessageEvent) => {
    const data = ev.data;
    if (data?.type === 'ready') {
      if (phaseRef.current === 'starting') setPhase('preflight');
      return;
    }
    if (data?.type === 'error') {
      // Auto-retry the model load twice before showing the error UI. Mobile
      // networks frequently drop the first WASM fetch; the user shouldn't
      // have to tap Retry for what is almost always a transient blip.
      if (modelRetryRef.current < 2) {
        modelRetryRef.current += 1;
        try { workerRef.current?.postMessage({ type: 'init' }); } catch { /* noop */ }
        return;
      }
      setErr('Could not load the face model. Check your internet and tap Retry.');
      setPhase('error');
      return;
    }
    if (data?.type !== 'result') return;
    inFlightRef.current = false;
    if (phaseRef.current !== 'preflight') return;

    const r = data as WorkerResult;
    const q = evaluateQuality(r, lastBrightnessRef.current);
    qualityRef.current = q;

    if (q !== 'none') {
      holdStartRef.current = null;
      progressRef.current = 0;
      return;
    }
    if (holdStartRef.current == null) holdStartRef.current = performance.now();
    const held = performance.now() - holdStartRef.current;
    const prog = Math.min(1, held / TH.holdMs);
    progressRef.current = prog;
    if (prog >= 1) {
      progressRef.current = 0;
      holdStartRef.current = null;
      void doCapture();
    }
  }, [doCapture]);

  // Keep onmessage pointed at the latest handler (fixes the stale-closure
  // bug that broke the old multi-pose flow).
  useEffect(() => {
    const w = workerRef.current;
    if (!w) return;
    w.onmessage = handleWorkerMessage;
  }, [handleWorkerMessage]);

  // ── Frame pump ─────────────────────────────────────────────────────────
  const FRAME_INTERVAL = 60; // ~16fps
  const sendFrame = useCallback(async () => {
    const video = videoRef.current;
    const worker = workerRef.current;
    if (!video || !worker || video.readyState < 2) return;
    if (inFlightRef.current) return;
    const now = performance.now();
    if (now - lastFrameAtRef.current < FRAME_INTERVAL) return;
    lastFrameAtRef.current = now;

    const c = sampleCanvasRef.current;
    if (!c) return;
    const W = 320, H = 320;
    c.width = W; c.height = H;
    const ctx = c.getContext('2d', { willReadFrequently: true });
    if (!ctx) return;
    ctx.drawImage(video, 0, 0, W, H);
    try {
      const img = ctx.getImageData(0, 0, W, H);
      let lum = 0;
      let n = 0;
      for (let i = 0; i < img.data.length; i += 4 * 32) {
        lum += 0.299 * img.data[i] + 0.587 * img.data[i + 1] + 0.114 * img.data[i + 2];
        n++;
      }
      lastBrightnessRef.current = n ? lum / n : 0;
    } catch { /* noop */ }

    try {
      const bitmap = await createImageBitmap(c);
      inFlightRef.current = true;
      worker.postMessage({ type: 'frame', bitmap, t: now }, [bitmap]);
    } catch {
      inFlightRef.current = false;
    }
  }, []);

  useEffect(() => {
    if (phase !== 'preflight') return;
    const loop = () => {
      void sendFrame();
      rafRef.current = requestAnimationFrame(loop);
    };
    rafRef.current = requestAnimationFrame(loop);
    return () => { if (rafRef.current) cancelAnimationFrame(rafRef.current); };
  }, [phase, sendFrame]);

  // ── Start camera + worker ──────────────────────────────────────────────
  const startCamera = async () => {
    if (phase !== 'idle' && phase !== 'error') return;
    setErr(null);
    capturedRef.current = false;
    setPhase('starting');
    try {
      if (!navigator.mediaDevices?.getUserMedia) {
        throw new Error("Your app version can't access the camera. Update Universflow to the latest APK, or finish verification in a browser.");
      }
      const stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: 'user', width: { ideal: 1280 }, height: { ideal: 1280 }, frameRate: { ideal: 30 } },
        audio: false,
      });
      streamRef.current = stream;
      if (videoRef.current) {
        const v = videoRef.current;
        v.srcObject = stream;
        const onReady = () => setVideoReady(true);
        v.onloadedmetadata = onReady;
        v.onplaying = onReady;
        await v.play().catch(() => {});
      }
      const worker = new Worker(new URL('./faceWorker.ts', import.meta.url), { type: 'module' });
      worker.onmessage = handleWorkerMessage;
      worker.onerror = (e) => {
        console.error('faceWorker error', e);
        setErr('Face engine failed to start. Tap Retry.');
        setPhase('error');
      };
      workerRef.current = worker;
      worker.postMessage({ type: 'init' });
    } catch (e: unknown) {
      const er = e as { name?: string; message?: string };
      const msg = er?.message || '';
      const name = er?.name || '';
      let friendly = msg;
      if (name === 'NotAllowedError' || /denied|permission/i.test(msg)) {
        friendly = 'Camera permission denied. Open phone Settings → Apps → Universflow → Permissions → allow Camera, then tap Retry.';
      } else if (name === 'NotFoundError') {
        friendly = 'No front camera found on this device.';
      } else if (name === 'NotReadableError') {
        friendly = 'Another app is using the camera. Close it and tap Retry.';
      } else if (!msg) {
        friendly = 'Camera unavailable. Make sure you allowed Camera permission for Universflow.';
      }
      setErr(friendly);
      setPhase('error');
    }
  };

  // ── Retry / restart ─────────────────────────────────────────────────────
  const restart = () => {
    teardown();
    holdStartRef.current = null;
    progressRef.current = 0;
    qualityRef.current = 'noface';
    capturedRef.current = false;
    setErr(null);
    setSlowHelp(false);
    setPhase('idle');
    setVideoReady(false);
  };

  // ── Render ─────────────────────────────────────────────────────────────
  if (phase === 'error' && err) {
    return (
      <div className="rounded-2xl p-5 bg-rose-500/10 border border-rose-500/30 text-rose-100">
        <div className="flex items-center gap-2 font-semibold">
          <AlertTriangle className="w-4 h-4" /> Verification stopped
        </div>
        <p className="text-[12.5px] mt-1 leading-relaxed">{err}</p>
        <button
          onClick={restart}
          className="mt-3 inline-flex items-center gap-1.5 text-[12px] underline"
        >
          <RotateCcw className="w-3.5 h-3.5" /> Retry
        </button>
      </div>
    );
  }

  if (phase === 'idle') {
    return (
      <div className="rounded-3xl p-6 bg-white/[0.03] border border-white/10 text-center space-y-4">
        <div className="mx-auto w-14 h-14 rounded-2xl bg-primary/15 border border-primary/25 flex items-center justify-center">
          <Camera className="w-6 h-6 text-primary" />
        </div>
        <div>
          <p className="text-[14px] font-semibold">Live face capture</p>
          <p className="text-[12px] text-muted-foreground mt-1 leading-relaxed">
            Hold your face inside the oval for about a second. We'll snap one photo automatically.
          </p>
        </div>
        <button
          type="button"
          onClick={startCamera}
          className="w-full h-12 rounded-xl font-semibold text-white inline-flex items-center justify-center gap-2"
          style={{ background: '#FF2D55' }}
        >
          <Camera className="w-4 h-4" /> Start camera
        </button>
      </div>
    );
  }

  const VB = 300, CX = 150, CY = 150, RX = 108, RY = 132;
  const CIRC = 2 * Math.PI * ((RX + RY) / 2 + 8);

  return (
    <div className="space-y-4">
      <div
        className="relative aspect-square rounded-3xl overflow-hidden border border-white/10"
        style={{ background: 'radial-gradient(ellipse at center, #0a0a0a 0%, #000 100%)' }}
      >
        <video
          ref={videoRef}
          playsInline
          muted
          autoPlay
          disablePictureInPicture
          controlsList="nodownload nofullscreen noremoteplayback"
          className="absolute inset-0 w-full h-full object-cover"
          style={{
            transform: 'scaleX(-1)',
            opacity: videoReady ? 1 : 0,
            transition: 'opacity 220ms ease',
            backgroundColor: '#000',
          }}
        />

        {/* Loading overlay until camera + model are warm */}
        {(() => {
          const cameraDone = videoReady;
          const modelDone = phase === 'preflight' || phase === 'capturing' || phase === 'done';
          const showOverlay = !(cameraDone && modelDone);
          const stages = [
            { key: 'cam', label: 'Initializing camera', done: cameraDone, active: !cameraDone },
            { key: 'mdl', label: 'Loading face model',  done: modelDone,  active: cameraDone && !modelDone },
          ];
          return (
            <AnimatePresence>
              {showOverlay && (
                <motion.div
                  initial={{ opacity: 0 }}
                  animate={{ opacity: 1 }}
                  exit={{ opacity: 0, transition: { duration: 0.35, ease: 'easeOut' } }}
                  transition={{ duration: 0.25 }}
                  className="absolute inset-0 z-10 flex items-center justify-center pointer-events-none px-6"
                  style={{
                    background:
                      'radial-gradient(120% 90% at 50% 35%, rgba(255,45,85,0.16) 0%, transparent 55%),' +
                      'linear-gradient(180deg, rgba(8,8,10,0.78) 0%, rgba(0,0,0,0.92) 100%)',
                    backdropFilter: 'blur(10px)',
                    WebkitBackdropFilter: 'blur(10px)',
                  }}
                >
                  <motion.div
                    initial={{ scale: 0.96, opacity: 0, y: 6 }}
                    animate={{ scale: 1, opacity: 1, y: 0 }}
                    transition={{ duration: 0.35, ease: [0.22, 1, 0.36, 1] }}
                    className="w-full max-w-[260px] flex flex-col items-center"
                  >
                    <div className="relative w-14 h-14 mb-5">
                      <motion.span
                        className="absolute inset-0 rounded-full"
                        style={{ background: 'radial-gradient(closest-side, rgba(255,45,85,0.7), transparent 70%)', filter: 'blur(8px)' }}
                        animate={{ scale: [1, 1.18, 1], opacity: [0.55, 0.9, 0.55] }}
                        transition={{ duration: 1.8, repeat: Infinity, ease: 'easeInOut' }}
                      />
                      <motion.span
                        className="absolute inset-2.5 rounded-full border-2 border-transparent"
                        style={{ borderTopColor: '#FF2D55', borderRightColor: 'rgba(255,45,85,0.4)' }}
                        animate={{ rotate: 360 }}
                        transition={{ duration: 1.2, ease: 'linear', repeat: Infinity }}
                      />
                    </div>
                    <div className="w-full space-y-2.5">
                      {stages.map((s, i) => (
                        <motion.div
                          key={s.key}
                          initial={{ opacity: 0, x: -6 }}
                          animate={{ opacity: s.done || s.active ? 1 : 0.45, x: 0 }}
                          transition={{ delay: 0.08 + i * 0.06, duration: 0.32 }}
                          className="flex items-center gap-3"
                        >
                          <div className="relative w-5 h-5 shrink-0 flex items-center justify-center">
                            {s.done ? (
                              <div
                                className="w-5 h-5 rounded-full flex items-center justify-center"
                                style={{ background: 'rgba(52,211,153,0.95)' }}
                              >
                                <Check className="w-3 h-3 text-black" strokeWidth={3.5} />
                              </div>
                            ) : s.active ? (
                              <div className="w-5 h-5 rounded-full border-2 border-white/20">
                                <motion.span
                                  className="block w-full h-full rounded-full border-2 border-transparent"
                                  style={{ borderTopColor: '#FF2D55' }}
                                  animate={{ rotate: 360 }}
                                  transition={{ duration: 0.9, ease: 'linear', repeat: Infinity }}
                                />
                              </div>
                            ) : (
                              <div className="w-2 h-2 rounded-full bg-white/20" />
                            )}
                          </div>
                          <div className="flex-1 min-w-0">
                            <div
                              className="text-[12px] font-semibold tracking-[0.02em] truncate"
                              style={{ color: s.done ? 'rgba(255,255,255,0.95)' : s.active ? '#fff' : 'rgba(255,255,255,0.55)' }}
                            >
                              {s.label}
                            </div>
                          </div>
                        </motion.div>
                      ))}
                    </div>
                  </motion.div>
                </motion.div>
              )}
            </AnimatePresence>
          );
        })()}

        {/* Oval cutout + progress ring */}
        <svg viewBox={`0 0 ${VB} ${VB}`} className="absolute inset-0 w-full h-full pointer-events-none">
          <defs>
            <mask id="cutout">
              <rect width={VB} height={VB} fill="white" />
              <ellipse cx={CX} cy={CY} rx={RX} ry={RY} fill="black" />
            </mask>
          </defs>
          <rect width={VB} height={VB} fill="rgba(0,0,0,0.62)" mask="url(#cutout)" />
          <ellipse
            ref={ringElRef}
            cx={CX} cy={CY} rx={RX} ry={RY}
            fill="none"
            stroke="rgba(255,255,255,0.55)"
            strokeWidth={2.5}
            style={{ transition: 'stroke 200ms ease' }}
          />
          <ellipse
            ref={progressRingRef}
            cx={CX} cy={CY} rx={RX + 8} ry={RY + 8}
            fill="none"
            stroke="#34D399"
            strokeWidth={3.5}
            strokeLinecap="round"
            strokeDasharray={CIRC}
            strokeDashoffset={CIRC}
            transform={`rotate(-90 ${CX} ${CY})`}
          />
        </svg>

        {/* Top hint */}
        {phase === 'preflight' && (
          <div className="absolute top-4 left-0 right-0 flex flex-col items-center pointer-events-none px-4">
            <div className="text-white text-[18px] font-bold tracking-wide drop-shadow-[0_2px_10px_rgba(0,0,0,0.6)] uppercase">
              Look at the camera
            </div>
            <div className="text-white/75 text-[12px] mt-0.5 drop-shadow">
              Stay still — we'll snap automatically
            </div>
          </div>
        )}

        {/* Status pill */}
        <div className="absolute bottom-3 left-3 right-3 flex justify-center pointer-events-none">
          <div
            className="px-3.5 py-1.5 rounded-full text-[12px] font-medium backdrop-blur-md bg-black/45 border tabular-nums"
            style={{
              color: phase === 'done' || quality10Hz === 'none' ? '#34D399' : '#FECACA',
              borderColor: phase === 'done' || quality10Hz === 'none'
                ? 'rgba(52,211,153,0.55)'
                : 'rgba(244,114,114,0.45)',
            }}
          >
            {phase === 'starting' && (<><Loader2 className="inline w-3 h-3 mr-1.5 animate-spin" />Starting camera…</>)}
            {phase === 'preflight' && (quality10Hz === 'none'
              ? `${Math.round(progress10Hz * 100)}%`
              : QUALITY_MSG[quality10Hz])}
            {phase === 'capturing' && 'Capturing…'}
            {phase === 'done' && 'Captured ✓'}
          </div>
        </div>

        {/* Flash */}
        <AnimatePresence>
          {flash && (
            <motion.div
              initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
              transition={{ duration: 0.16 }}
              className="absolute inset-0 bg-white pointer-events-none"
            />
          )}
        </AnimatePresence>

        {/* Success tick */}
        <AnimatePresence>
          {phase === 'done' && (
            <motion.div
              initial={{ scale: 0.6, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              exit={{ opacity: 0 }}
              className="absolute inset-0 flex items-center justify-center pointer-events-none"
            >
              <div className="w-16 h-16 rounded-full bg-emerald-500/90 flex items-center justify-center shadow-2xl">
                <Check className="w-9 h-9 text-white" strokeWidth={3} />
              </div>
            </motion.div>
          )}
        </AnimatePresence>
      </div>

      <canvas ref={captureCanvasRef} className="hidden" />
      <canvas ref={sampleCanvasRef} className="hidden" />

      {slowHelp && phase === 'preflight' && (
        <div className="rounded-2xl p-3.5 bg-yellow-500/10 border border-yellow-500/30 text-yellow-100 flex items-center justify-between gap-3">
          <div className="text-[12.5px] leading-snug">
            Trouble capturing? Try better lighting or move a little closer.
          </div>
          <button
            type="button"
            onClick={() => { setSlowHelp(false); onFail?.('user-gave-up'); restart(); }}
            className="shrink-0 h-9 px-3 rounded-lg text-[12px] font-semibold bg-yellow-400/90 text-black"
          >
            <RotateCcw className="inline w-3.5 h-3.5 mr-1" /> Restart
          </button>
        </div>
      )}

      {phase === 'preflight' && (
        <button
          type="button"
          onClick={restart}
          className="w-full h-10 rounded-xl text-[12.5px] text-muted-foreground hover:text-white border border-white/10 hover:border-white/25 transition"
        >
          <X className="inline w-3.5 h-3.5 mr-1.5" /> Cancel
        </button>
      )}
    </div>
  );
}
