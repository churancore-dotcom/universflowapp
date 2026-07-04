// Real-human liveness capture built on Google MediaPipe FaceLandmarker.
//
// A static photo (of a photo) cannot pass this — we require live signals
// from the same face over multiple frames:
//   1. Stable face detected inside the oval for ~1.2s
//   2. Two eye blinks (rising edge of eyeBlinkLeft+Right blendshape)
//   3. Smile (mouthSmileLeft+Right blendshape)
// Only after all three pass do we auto-capture a mirrored 720×720 JPEG.
//
// The Universflow Android WebView loads MediaPipe WASM + face landmarker
// model from the public jsdelivr / storage.googleapis.com endpoints.
// Both hosts are already reachable inside the app shell.
import { useCallback, useEffect, useRef, useState } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import { AlertTriangle, Camera, Check, Eye, Loader2, RotateCcw, Smile, X } from 'lucide-react';
import confetti from 'canvas-confetti';
import type { FaceLandmarker, FaceLandmarkerResult } from '@mediapipe/tasks-vision';

export interface LivenessShots {
  capture: Blob;
}

type Phase =
  | 'idle'
  | 'loading-model'
  | 'starting'
  | 'position'      // asking user to fit face in oval
  | 'blink-1'       // waiting for first blink
  | 'blink-2'       // waiting for second blink
  | 'smile'         // waiting for smile
  | 'capturing'
  | 'done'
  | 'error';

const MODEL_URL =
  'https://storage.googleapis.com/mediapipe-models/face_landmarker/face_landmarker/float16/1/face_landmarker.task';
const WASM_ROOT = 'https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.35/wasm';

// Blendshape thresholds tuned on real Universflow test devices.
const BLINK_ON = 0.55;
const BLINK_OFF = 0.20;
const SMILE_ON = 0.52;
const FACE_MIN_SIZE = 0.28; // fraction of frame short side the face bbox must cover

// Cache the loaded FaceLandmarker across mounts so the second time the
// screen opens is instant.
let landmarkerPromise: Promise<FaceLandmarker> | null = null;
async function getLandmarker(): Promise<FaceLandmarker> {
  if (!landmarkerPromise) {
    landmarkerPromise = (async () => {
      const mod = await import('@mediapipe/tasks-vision');
      const fileset = await mod.FilesetResolver.forVisionTasks(WASM_ROOT);
      return mod.FaceLandmarker.createFromOptions(fileset, {
        baseOptions: { modelAssetPath: MODEL_URL, delegate: 'GPU' },
        runningMode: 'VIDEO',
        numFaces: 1,
        outputFaceBlendshapes: true,
        outputFacialTransformationMatrixes: false,
      });
    })().catch((err) => {
      landmarkerPromise = null;
      throw err;
    });
  }
  return landmarkerPromise;
}

function findBlend(result: FaceLandmarkerResult, name: string): number {
  const cat = result.faceBlendshapes?.[0]?.categories?.find((c) => c.categoryName === name);
  return cat?.score ?? 0;
}

function faceBboxCoverage(result: FaceLandmarkerResult): number {
  const lm = result.faceLandmarks?.[0];
  if (!lm || lm.length === 0) return 0;
  let minX = 1, maxX = 0, minY = 1, maxY = 0;
  for (const p of lm) {
    if (p.x < minX) minX = p.x;
    if (p.x > maxX) maxX = p.x;
    if (p.y < minY) minY = p.y;
    if (p.y > maxY) maxY = p.y;
  }
  return Math.min(maxX - minX, maxY - minY);
}

export default function FaceLivenessCapture({
  onComplete,
  onFail,
}: {
  onComplete: (shots: LivenessShots) => void;
  onFail?: (reason: string) => void;
}) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const captureCanvasRef = useRef<HTMLCanvasElement>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const rafRef = useRef<number | null>(null);

  const landmarkerRef = useRef<FaceLandmarker | null>(null);
  const capturedRef = useRef(false);
  const stopLoopRef = useRef(false);

  // Blink FSM — count rising edges (closed → open transitions).
  const blinkStateRef = useRef<'open' | 'closed'>('open');
  const blinkCountRef = useRef(0);
  const positionSinceRef = useRef<number | null>(null);

  const [phase, setPhase] = useState<Phase>('idle');
  const [err, setErr] = useState<string | null>(null);
  const [videoReady, setVideoReady] = useState(false);
  const [flash, setFlash] = useState(false);
  const [hint, setHint] = useState<string>('Fit your face in the circle');

  const teardown = useCallback(() => {
    stopLoopRef.current = true;
    if (rafRef.current) cancelAnimationFrame(rafRef.current);
    rafRef.current = null;
    streamRef.current?.getTracks().forEach((t) => t.stop());
    streamRef.current = null;
  }, []);

  useEffect(() => () => teardown(), [teardown]);

  const doCapture = useCallback(async () => {
    if (capturedRef.current) return;
    capturedRef.current = true;
    stopLoopRef.current = true;
    setPhase('capturing');
    setFlash(true);
    window.setTimeout(() => setFlash(false), 150);

    try {
      confetti({ particleCount: 40, spread: 60, origin: { y: 0.42 }, scalar: 0.75 });
    } catch { /* visual only */ }

    const video = videoRef.current;
    const canvas = captureCanvasRef.current;
    if (!video || !canvas || video.readyState < 2) {
      setErr('Camera lost focus at the last second. Tap Retry.');
      setPhase('error');
      capturedRef.current = false;
      onFail?.('camera-not-ready');
      return;
    }

    const size = 720;
    canvas.width = size;
    canvas.height = size;
    const ctx = canvas.getContext('2d');
    if (!ctx) {
      setErr('Capture failed. Tap Retry.');
      setPhase('error');
      capturedRef.current = false;
      onFail?.('canvas-unavailable');
      return;
    }
    const vw = video.videoWidth || size;
    const vh = video.videoHeight || size;
    const side = Math.min(vw, vh);
    const sx = (vw - side) / 2;
    const sy = (vh - side) / 2;
    ctx.save();
    ctx.translate(size, 0);
    ctx.scale(-1, 1);
    ctx.drawImage(video, sx, sy, side, side, 0, 0, size, size);
    ctx.restore();

    canvas.toBlob(
      (blob) => {
        teardown();
        if (!blob) {
          setErr('Capture failed. Tap Retry.');
          setPhase('error');
          capturedRef.current = false;
          onFail?.('blob-empty');
          return;
        }
        setPhase('done');
        window.setTimeout(() => onComplete({ capture: blob }), 260);
      },
      'image/jpeg',
      0.9,
    );
  }, [onComplete, onFail, teardown]);

  // Main detection loop.
  const startLoop = useCallback(() => {
    stopLoopRef.current = false;
    const step = () => {
      if (stopLoopRef.current) return;
      const video = videoRef.current;
      const landmarker = landmarkerRef.current;
      if (!video || !landmarker || video.readyState < 2) {
        rafRef.current = requestAnimationFrame(step);
        return;
      }

      let result: FaceLandmarkerResult | null = null;
      try {
        result = landmarker.detectForVideo(video, performance.now());
      } catch {
        rafRef.current = requestAnimationFrame(step);
        return;
      }
      const hasFace = (result?.faceLandmarks?.length ?? 0) > 0;
      const coverage = result ? faceBboxCoverage(result) : 0;
      const faceInFrame = hasFace && coverage >= FACE_MIN_SIZE;

      // ---------------- Position phase ----------------
      if (phaseRef.current === 'position') {
        if (!faceInFrame) {
          positionSinceRef.current = null;
          setHint(hasFace ? 'Come a little closer' : 'Fit your face in the circle');
        } else {
          if (positionSinceRef.current == null) positionSinceRef.current = performance.now();
          const held = performance.now() - (positionSinceRef.current ?? performance.now());
          if (held > 1000) {
            phaseRef.current = 'blink-1';
            blinkStateRef.current = 'open';
            blinkCountRef.current = 0;
            setPhase('blink-1');
            setHint('Blink twice, slowly');
          } else {
            setHint('Hold still…');
          }
        }
        rafRef.current = requestAnimationFrame(step);
        return;
      }

      // If face leaves the oval mid-flow, reset progress.
      if (!faceInFrame && phaseRef.current !== 'capturing' && phaseRef.current !== 'done') {
        positionSinceRef.current = null;
        blinkStateRef.current = 'open';
        blinkCountRef.current = 0;
        phaseRef.current = 'position';
        setPhase('position');
        setHint('Bring your face back into the circle');
        rafRef.current = requestAnimationFrame(step);
        return;
      }

      const eyeL = result ? findBlend(result, 'eyeBlinkLeft') : 0;
      const eyeR = result ? findBlend(result, 'eyeBlinkRight') : 0;
      const eyeAvg = (eyeL + eyeR) / 2;

      // ---------------- Blink phase ----------------
      if (phaseRef.current === 'blink-1' || phaseRef.current === 'blink-2') {
        if (blinkStateRef.current === 'open' && eyeAvg > BLINK_ON) {
          blinkStateRef.current = 'closed';
        } else if (blinkStateRef.current === 'closed' && eyeAvg < BLINK_OFF) {
          blinkStateRef.current = 'open';
          blinkCountRef.current += 1;
          if (blinkCountRef.current >= 1 && phaseRef.current === 'blink-1') {
            phaseRef.current = 'blink-2';
            setPhase('blink-2');
            setHint('One more blink…');
          } else if (blinkCountRef.current >= 2) {
            phaseRef.current = 'smile';
            setPhase('smile');
            setHint('Now smile 🙂');
          }
        }
        rafRef.current = requestAnimationFrame(step);
        return;
      }

      // ---------------- Smile phase ----------------
      if (phaseRef.current === 'smile') {
        const smileL = result ? findBlend(result, 'mouthSmileLeft') : 0;
        const smileR = result ? findBlend(result, 'mouthSmileRight') : 0;
        if (smileL > SMILE_ON && smileR > SMILE_ON) {
          setHint('Perfect — capturing…');
          void doCapture();
          return;
        }
        rafRef.current = requestAnimationFrame(step);
        return;
      }

      rafRef.current = requestAnimationFrame(step);
    };
    rafRef.current = requestAnimationFrame(step);
  }, [doCapture]);

  // We need a ref mirror of phase so the RAF loop can read it without stale
  // closure issues (setPhase is async).
  const phaseRef = useRef<Phase>('idle');
  useEffect(() => { phaseRef.current = phase; }, [phase]);

  const startCamera = async () => {
    if (phase !== 'idle' && phase !== 'error') return;
    setErr(null);
    setVideoReady(false);
    capturedRef.current = false;
    stopLoopRef.current = false;
    blinkCountRef.current = 0;
    blinkStateRef.current = 'open';
    positionSinceRef.current = null;
    setPhase('loading-model');
    setHint('Loading face model…');

    try {
      landmarkerRef.current = await getLandmarker();
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      setErr(`We could not load the face-check model. Check your connection and tap Retry. (${msg.slice(0, 80)})`);
      setPhase('error');
      onFail?.('model-load-failed');
      return;
    }

    setPhase('starting');
    setHint('Opening camera…');

    try {
      if (!navigator.mediaDevices?.getUserMedia) {
        throw new Error("Your app version can't access the camera. Update Universflow or finish verification in a browser.");
      }
      const stream = await navigator.mediaDevices.getUserMedia({
        video: {
          facingMode: 'user',
          width: { ideal: 1280 },
          height: { ideal: 1280 },
          frameRate: { ideal: 30, max: 30 },
        },
        audio: false,
      });
      streamRef.current = stream;
      const video = videoRef.current;
      if (!video) throw new Error('Camera preview unavailable. Tap Retry.');
      video.srcObject = stream;

      const markReady = () => {
        if (videoReady) return;
        setVideoReady(true);
        setPhase('position');
        phaseRef.current = 'position';
        setHint('Fit your face in the circle');
        startLoop();
      };

      video.onloadedmetadata = markReady;
      video.onplaying = markReady;
      await video.play().catch(() => undefined);
      window.setTimeout(() => {
        if (!videoReady && video.readyState >= 2) markReady();
      }, 700);
    } catch (e) {
      teardown();
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
        friendly = 'Camera unavailable. Make sure Camera permission is allowed for Universflow.';
      }
      setErr(friendly);
      setPhase('error');
      onFail?.(friendly);
    }
  };

  const restart = () => {
    teardown();
    capturedRef.current = false;
    blinkCountRef.current = 0;
    blinkStateRef.current = 'open';
    positionSinceRef.current = null;
    setErr(null);
    setFlash(false);
    setVideoReady(false);
    setPhase('idle');
    setHint('Fit your face in the circle');
  };

  if (phase === 'error' && err) {
    return (
      <div className="rounded-2xl p-5 bg-rose-500/10 border border-rose-500/30 text-rose-100">
        <div className="flex items-center gap-2 font-semibold">
          <AlertTriangle className="w-4 h-4" /> Face check stopped
        </div>
        <p className="text-[12.5px] mt-1 leading-relaxed">{err}</p>
        <button
          type="button"
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
          <p className="text-[14px] font-semibold">Live face check</p>
          <p className="text-[12px] text-muted-foreground mt-1 leading-relaxed">
            We'll ask you to blink twice, then smile. This confirms you're a real person — a photo of a photo can't pass.
          </p>
        </div>
        <button
          type="button"
          onClick={startCamera}
          className="w-full h-12 rounded-xl font-semibold text-white inline-flex items-center justify-center gap-2"
          style={{ background: '#FF2D55' }}
        >
          <Camera className="w-4 h-4" /> Start face check
        </button>
      </div>
    );
  }

  const VB = 300;
  const CX = 150;
  const CY = 150;
  const RX = 108;
  const RY = 132;

  // Progress indicator: position → blink 1 → blink 2 → smile → done
  const stepsDone = (
    phase === 'position' ? 0 :
    phase === 'blink-1' ? 1 :
    phase === 'blink-2' ? 2 :
    phase === 'smile' ? 3 :
    phase === 'capturing' || phase === 'done' ? 4 : 0
  );

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
            transition: 'opacity 160ms ease',
            backgroundColor: '#000',
          }}
        />

        <AnimatePresence>
          {(phase === 'loading-model' || phase === 'starting' || !videoReady) && (
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              className="absolute inset-0 z-10 flex flex-col items-center justify-center gap-3 bg-black/80 pointer-events-none"
            >
              <Loader2 className="w-6 h-6 animate-spin text-primary" />
              <p className="text-[12px] font-medium text-white/80">
                {phase === 'loading-model' ? 'Loading face model…' : 'Opening camera…'}
              </p>
            </motion.div>
          )}
        </AnimatePresence>

        <svg viewBox={`0 0 ${VB} ${VB}`} className="absolute inset-0 w-full h-full pointer-events-none">
          <defs>
            <mask id="face-capture-cutout">
              <rect width={VB} height={VB} fill="white" />
              <ellipse cx={CX} cy={CY} rx={RX} ry={RY} fill="black" />
            </mask>
          </defs>
          <rect width={VB} height={VB} fill="rgba(0,0,0,0.48)" mask="url(#face-capture-cutout)" />
          <ellipse cx={CX} cy={CY} rx={RX} ry={RY} fill="none" stroke="rgba(255,255,255,0.75)" strokeWidth={2.5} />
        </svg>

        {/* Big instruction */}
        {videoReady && (phase === 'position' || phase === 'blink-1' || phase === 'blink-2' || phase === 'smile') && (
          <div className="absolute top-4 left-0 right-0 flex flex-col items-center pointer-events-none px-4">
            <motion.div
              key={phase}
              initial={{ opacity: 0, y: -6 }}
              animate={{ opacity: 1, y: 0 }}
              className="text-white text-[17px] font-bold tracking-wide drop-shadow-[0_2px_10px_rgba(0,0,0,0.6)] uppercase inline-flex items-center gap-2"
            >
              {phase === 'blink-1' || phase === 'blink-2' ? <Eye className="w-4 h-4" /> : null}
              {phase === 'smile' ? <Smile className="w-4 h-4" /> : null}
              {hint}
            </motion.div>
            {(phase === 'blink-1' || phase === 'blink-2') && (
              <div className="text-white/75 text-[12px] mt-1 drop-shadow tabular-nums">
                {blinkCountRef.current}/2 blinks
              </div>
            )}
          </div>
        )}

        {/* Progress dots */}
        {videoReady && (
          <div className="absolute bottom-3 left-3 right-3 flex justify-center pointer-events-none">
            <div className="flex items-center gap-1.5 px-3 py-1.5 rounded-full backdrop-blur-md bg-black/45 border border-white/20">
              {Array.from({ length: 4 }).map((_, i) => (
                <span
                  key={i}
                  className={`h-1.5 rounded-full transition-all ${
                    i < stepsDone ? 'w-4 bg-emerald-400' : 'w-1.5 bg-white/25'
                  }`}
                />
              ))}
              {phase === 'done' && (
                <span className="ml-2 text-[11px] font-semibold text-emerald-300">Captured ✓</span>
              )}
            </div>
          </div>
        )}

        <AnimatePresence>
          {flash && (
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              transition={{ duration: 0.14 }}
              className="absolute inset-0 bg-white pointer-events-none"
            />
          )}
        </AnimatePresence>

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

      {videoReady && phase !== 'capturing' && phase !== 'done' && (
        <div className="flex justify-end">
          <button
            type="button"
            onClick={restart}
            aria-label="Cancel camera"
            className="inline-flex items-center gap-1.5 text-[12px] text-muted-foreground hover:text-white px-3 h-9 rounded-lg border border-white/10 hover:border-white/25 transition"
          >
            <X className="w-3.5 h-3.5" /> Cancel
          </button>
        </div>
      )}
    </div>
  );
}
