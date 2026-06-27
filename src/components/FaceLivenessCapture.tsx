import { useEffect, useRef, useState, useCallback } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import {
  Camera, Loader2, AlertTriangle, RotateCcw, Check,
  ArrowLeft, ArrowRight, ArrowUp, ArrowDown, Eye, Smile, X,
} from 'lucide-react';
import confetti from 'canvas-confetti';

// ─────────────────────────────────────────────────────────────────────────────
// Meta-style live face verification.
//
// • Off-main-thread MediaPipe inference (faceWorker.ts) — UI stays at 60fps.
// • 3 randomized challenges per session from a pool of 6 (LEFT, RIGHT, UP,
//   DOWN, BLINK, SMILE). Order changes every run; the challenge state machine
//   only advances on real, smoothed, held detection.
// • 5-frame moving average over yaw/pitch/roll kills landmark jitter.
// • Quality preflight: face size, centering, lighting, single-face, presence.
// • Single 720×720 JPEG capture at the end — no more 4-blob waste.
// • 30s per-challenge timeout + 3-fail global cap with graceful exit.
//
// Public contract: `onComplete({ capture })` fires once on success.
// `onFail(reason)` fires if the user blows past the global fail cap.
// ─────────────────────────────────────────────────────────────────────────────

export interface LivenessShots {
  capture: Blob;
}

type ChallengeKind = 'LEFT' | 'RIGHT' | 'UP' | 'DOWN' | 'BLINK' | 'SMILE';

interface ChallengeDef {
  kind: ChallengeKind;
  title: string;
  hint: string;
  holdMs: number;
  Icon: React.FC<{ className?: string }>;
  // returns true when the smoothed sample currently satisfies the challenge
  test: (s: SmoothedSample) => boolean;
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

interface SmoothedSample extends WorkerResult {
  // moving averages over last N frames
  yawAvg: number; pitchAvg: number; rollAvg: number;
  blinkAvg: number; smileAvg: number;
}

// ── Detection thresholds (per spec) ──────────────────────────────────────────
const TH = {
  yawLeft: -18, yawRight: 18,
  pitchUp: 15, pitchDown: -15,
  // MediaPipe blendshapes: eyeBlink score rises toward 1.0 as eye closes.
  // Spec asks "close ratio < 0.2" — using blendshape, that maps to > 0.5.
  blinkClosed: 0.5,
  // Smile blendshape > ~0.55 is a clear, natural smile.
  smileOn: 0.55,
  // Hold durations
  holdPose: 600,
  holdBlink: 200,
  holdSmile: 400,
  // Quality
  minFaceFrac: 0.30,    // face bbox short-side >= 30% of frame
  centerTol: 0.18,      // center within 18% of frame center
  minBrightness: 55,    // 0..255
} as const;

const POOL: ChallengeDef[] = [
  { kind: 'LEFT',  title: 'Turn head LEFT',   hint: 'Slowly turn your head to the left',  holdMs: TH.holdPose,  Icon: ArrowLeft,
    test: (s) => s.yawAvg < TH.yawLeft },
  { kind: 'RIGHT', title: 'Turn head RIGHT',  hint: 'Slowly turn your head to the right', holdMs: TH.holdPose,  Icon: ArrowRight,
    test: (s) => s.yawAvg > TH.yawRight },
  { kind: 'UP',    title: 'Look UP',          hint: 'Tilt your head up',                  holdMs: TH.holdPose,  Icon: ArrowUp,
    test: (s) => s.pitchAvg > TH.pitchUp },
  { kind: 'DOWN',  title: 'Look DOWN',        hint: 'Tilt your head down',                holdMs: TH.holdPose,  Icon: ArrowDown,
    test: (s) => s.pitchAvg < TH.pitchDown },
  { kind: 'BLINK', title: 'BLINK twice',      hint: 'Close your eyes, then open',         holdMs: TH.holdBlink, Icon: Eye,
    test: (s) => s.blinkAvg > TH.blinkClosed },
  { kind: 'SMILE', title: 'SMILE',            hint: 'Give a natural smile',               holdMs: TH.holdSmile, Icon: Smile,
    test: (s) => s.smileAvg > TH.smileOn },
];

function pickThree(): ChallengeDef[] {
  const arr = [...POOL];
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr.slice(0, 3);
}

class RingBuf {
  private buf: number[] = [];
  constructor(private size: number) {}
  push(v: number) {
    this.buf.push(v);
    if (this.buf.length > this.size) this.buf.shift();
  }
  avg(): number {
    if (!this.buf.length) return 0;
    let s = 0; for (const v of this.buf) s += v;
    return s / this.buf.length;
  }
  reset() { this.buf = []; }
}

type QualityFail = 'none' | 'small' | 'offcenter' | 'dark' | 'multi' | 'noface';
const QUALITY_MSG: Record<QualityFail, string> = {
  none:       'Hold still…',
  small:      'Move closer to camera',
  offcenter:  'Center your face in the circle',
  dark:       'Move to better lighting',
  multi:      'Only one face allowed',
  noface:     'No face detected',
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
  const sampleCanvasRef = useRef<HTMLCanvasElement>(null); // small offscreen for ImageBitmap + brightness
  const streamRef = useRef<MediaStream | null>(null);
  const workerRef = useRef<Worker | null>(null);
  const rafRef = useRef<number | null>(null);
  const inFlightRef = useRef(false);
  const lastFrameAtRef = useRef(0);

  // hot-path refs — do NOT trigger React renders
  const yawBuf = useRef(new RingBuf(5));
  const pitchBuf = useRef(new RingBuf(5));
  const rollBuf = useRef(new RingBuf(5));
  const blinkBuf = useRef(new RingBuf(5));
  const smileBuf = useRef(new RingBuf(5));
  const lastSampleRef = useRef<SmoothedSample | null>(null);
  const challengeHoldStartRef = useRef<number | null>(null);
  const challengeProgressRef = useRef(0);
  const qualityFailRef = useRef<QualityFail>('noface');
  const ringElRef = useRef<SVGEllipseElement>(null);
  const progressRingRef = useRef<SVGEllipseElement>(null);
  const statusElRef = useRef<HTMLDivElement>(null);
  const failCountRef = useRef(0);
  const challengeStartedAtRef = useRef<number>(0);

  // React state — updated <= 10Hz
  const [phase, setPhase] = useState<'idle' | 'starting' | 'preflight' | 'challenge' | 'capturing' | 'done' | 'error'>('idle');
  const [err, setErr] = useState<string | null>(null);
  const [challenges, setChallenges] = useState<ChallengeDef[]>([]);
  const [activeIdx, setActiveIdx] = useState(0);
  const [progress10Hz, setProgress10Hz] = useState(0);
  const [quality10Hz, setQuality10Hz] = useState<QualityFail>('noface');
  const [showTimeoutHelp, setShowTimeoutHelp] = useState(false);
  const [flash, setFlash] = useState(false);
  const [videoReady, setVideoReady] = useState(false);

  // ── Teardown ────────────────────────────────────────────────────────────
  const teardown = useCallback(() => {
    if (rafRef.current) cancelAnimationFrame(rafRef.current);
    rafRef.current = null;
    streamRef.current?.getTracks().forEach((t) => t.stop());
    streamRef.current = null;
    workerRef.current?.terminate();
    workerRef.current = null;
  }, []);

  useEffect(() => () => teardown(), [teardown]);

  // ── Throttled React mirror of refs (~10Hz) ──────────────────────────────
  useEffect(() => {
    if (phase !== 'preflight' && phase !== 'challenge') return;
    const id = setInterval(() => {
      setProgress10Hz(challengeProgressRef.current);
      setQuality10Hz(qualityFailRef.current);
    }, 100);
    return () => clearInterval(id);
  }, [phase]);

  // ── Per-challenge 30s timeout ──────────────────────────────────────────
  useEffect(() => {
    if (phase !== 'challenge') { setShowTimeoutHelp(false); return; }
    setShowTimeoutHelp(false);
    challengeStartedAtRef.current = performance.now();
    const id = setTimeout(() => setShowTimeoutHelp(true), 30_000);
    return () => clearTimeout(id);
  }, [phase, activeIdx]);

  // ── Imperative UI ring updates at 60fps from refs ───────────────────────
  useEffect(() => {
    if (phase !== 'preflight' && phase !== 'challenge') return;
    let id = 0;
    const RX = 108, RY = 132;
    const CIRC = 2 * Math.PI * ((RX + RY) / 2 + 8);
    const tick = () => {
      const p = challengeProgressRef.current;
      if (progressRingRef.current) {
        progressRingRef.current.style.strokeDashoffset = String((1 - p) * CIRC);
      }
      if (ringElRef.current) {
        const q = qualityFailRef.current;
        const color = phase === 'challenge'
          ? (p > 0.05 ? '#FACC15' : 'rgba(255,255,255,0.55)') // yellow during active
          : (q === 'none' ? '#34D399' : 'rgba(255,255,255,0.55)');
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
    return 'none';
  }

  // ── Worker message handler ─────────────────────────────────────────────
  const onWorkerMessage = useCallback((ev: MessageEvent) => {
    const data = ev.data;
    if (data.type === 'ready') {
      setPhase('preflight');
      return;
    }
    if (data.type === 'error') {
      setErr('Could not load the face model. Check your internet and tap Retry.');
      setPhase('error');
      return;
    }
    if (data.type !== 'result') return;
    inFlightRef.current = false;

    const r = data as WorkerResult;
    if (!r.hasFace) {
      yawBuf.current.reset(); pitchBuf.current.reset(); rollBuf.current.reset();
      blinkBuf.current.reset(); smileBuf.current.reset();
      challengeHoldStartRef.current = null;
      challengeProgressRef.current = 0;
      qualityFailRef.current = r.faceCount > 1 ? 'multi' : 'noface';
      return;
    }
    yawBuf.current.push(r.yaw);
    pitchBuf.current.push(r.pitch);
    rollBuf.current.push(r.roll);
    blinkBuf.current.push(Math.max(r.blinkLeft, r.blinkRight));
    smileBuf.current.push((r.smileLeft + r.smileRight) / 2);

    const sample: SmoothedSample = {
      ...r,
      yawAvg: yawBuf.current.avg(),
      pitchAvg: pitchBuf.current.avg(),
      rollAvg: rollBuf.current.avg(),
      blinkAvg: blinkBuf.current.avg(),
      smileAvg: smileBuf.current.avg(),
    };
    lastSampleRef.current = sample;

    // Brightness already measured in sendFrame and stashed on the worker bitmap;
    // we approximate here using the most recent value.
    const q = evaluateQuality(r, lastBrightnessRef.current);
    qualityFailRef.current = q;

    // Phase transitions
    if (phase === 'preflight') {
      if (q === 'none') {
        // Quality is good — start the challenges
        const picks = pickThree();
        setChallenges(picks);
        setActiveIdx(0);
        setPhase('challenge');
      }
      return;
    }

    if (phase === 'challenge') {
      const ch = challenges[activeIdx];
      if (!ch) return;
      if (q !== 'none' && ch.kind !== 'BLINK' && ch.kind !== 'SMILE') {
        // quality must hold for pose challenges
        challengeHoldStartRef.current = null;
        challengeProgressRef.current = 0;
        return;
      }
      const passes = ch.test(sample);
      if (passes) {
        if (challengeHoldStartRef.current == null) challengeHoldStartRef.current = performance.now();
        const held = performance.now() - challengeHoldStartRef.current;
        const prog = Math.min(1, held / ch.holdMs);
        challengeProgressRef.current = prog;
        if (prog >= 1) {
          // advance
          challengeHoldStartRef.current = null;
          challengeProgressRef.current = 0;
          if (activeIdx + 1 >= challenges.length) {
            void doCapture();
          } else {
            setActiveIdx((i) => i + 1);
          }
        }
      } else {
        challengeHoldStartRef.current = null;
        challengeProgressRef.current = 0;
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [phase, challenges, activeIdx]);

  // brightness ref (avg luminance of last sampled bitmap)
  const lastBrightnessRef = useRef(0);

  // ── Frame pump: capture ImageBitmap from <video> and ship to worker ────
  const FRAME_INTERVAL = 50; // ~20fps to the worker; main thread stays free
  const sendFrame = useCallback(async () => {
    const video = videoRef.current;
    const worker = workerRef.current;
    if (!video || !worker || video.readyState < 2) return;
    if (inFlightRef.current) return;
    const now = performance.now();
    if (now - lastFrameAtRef.current < FRAME_INTERVAL) return;
    lastFrameAtRef.current = now;

    // Downscale to 320×320 for the worker — landmarks are still accurate and
    // CPU inference flies. Also sample brightness in the same pass.
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
      // sparse sample for speed
      for (let i = 0; i < img.data.length; i += 4 * 32) {
        lum += 0.299 * img.data[i] + 0.587 * img.data[i + 1] + 0.114 * img.data[i + 2];
      }
      lastBrightnessRef.current = lum / (img.data.length / (4 * 32));
    } catch { /* tainted? extremely unlikely for getUserMedia */ }

    try {
      const bitmap = await createImageBitmap(c);
      inFlightRef.current = true;
      worker.postMessage({ type: 'frame', bitmap, t: now }, [bitmap]);
    } catch {
      inFlightRef.current = false;
    }
  }, []);

  useEffect(() => {
    if (phase !== 'preflight' && phase !== 'challenge') return;
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
        videoRef.current.srcObject = stream;
        await videoRef.current.play();
      }
      // spin up the worker
      const worker = new Worker(new URL('./faceWorker.ts', import.meta.url), { type: 'module' });
      worker.onmessage = onWorkerMessage;
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

  // ── Final capture ───────────────────────────────────────────────────────
  const doCapture = async () => {
    if (phase === 'capturing' || phase === 'done') return;
    setPhase('capturing');
    setFlash(true);
    setTimeout(() => setFlash(false), 160);

    // Confetti — light, fast, mobile-friendly
    try {
      confetti({ particleCount: 60, spread: 70, origin: { y: 0.4 }, scalar: 0.8 });
    } catch { /* noop */ }

    const video = videoRef.current;
    const canvas = captureCanvasRef.current;
    if (!video || !canvas) { setPhase('error'); setErr('Capture failed. Tap Retry.'); return; }
    const SIZE = 720;
    canvas.width = SIZE; canvas.height = SIZE;
    const ctx = canvas.getContext('2d');
    if (!ctx) { setPhase('error'); setErr('Capture failed. Tap Retry.'); return; }
    // Center-crop square from the (likely landscape) video frame.
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
        setTimeout(() => onComplete({ capture: blob }), 360);
      },
      'image/jpeg',
      0.92,
    );
  };

  // ── Retry helpers ───────────────────────────────────────────────────────
  const retryChallenge = () => {
    challengeHoldStartRef.current = null;
    challengeProgressRef.current = 0;
    setShowTimeoutHelp(false);
    failCountRef.current += 1;
    if (failCountRef.current >= 3) {
      teardown();
      setPhase('error');
      const m = 'Verification failed. Please try in better lighting.';
      setErr(m);
      onFail?.(m);
      return;
    }
    // re-pick fresh trio so it's not the same exact challenge
    setChallenges(pickThree());
    setActiveIdx(0);
    setPhase('preflight');
  };

  const restart = () => {
    teardown();
    yawBuf.current.reset(); pitchBuf.current.reset(); rollBuf.current.reset();
    blinkBuf.current.reset(); smileBuf.current.reset();
    challengeHoldStartRef.current = null;
    challengeProgressRef.current = 0;
    failCountRef.current = 0;
    setErr(null);
    setPhase('idle');
    setChallenges([]);
    setActiveIdx(0);
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
          <p className="text-[14px] font-semibold">Live face verification</p>
          <p className="text-[12px] text-muted-foreground mt-1 leading-relaxed">
            We'll ask you to do 3 quick random actions to prove you're real.
            Takes about 10 seconds.
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

  // SVG oval geometry
  const VB = 300, CX = 150, CY = 150, RX = 108, RY = 132;
  const CIRC = 2 * Math.PI * ((RX + RY) / 2 + 8);

  const active = challenges[activeIdx];
  const ActiveIcon = active?.Icon;

  return (
    <div className="space-y-4">
      {/* Progress dots */}
      {(phase === 'challenge' || phase === 'capturing' || phase === 'done') && challenges.length > 0 && (
        <div className="flex items-center justify-center gap-2">
          {challenges.map((c, i) => {
            const state = i < activeIdx || phase === 'done' || phase === 'capturing' ? 'done'
              : i === activeIdx ? 'active' : 'pending';
            return (
              <div key={i} className="flex items-center gap-2">
                <div
                  className="flex items-center gap-1.5 px-2.5 py-1 rounded-full text-[11px] font-medium border tabular-nums transition"
                  style={{
                    background: state === 'done' ? 'rgba(52,211,153,0.18)'
                      : state === 'active' ? 'rgba(250,204,21,0.18)'
                      : 'rgba(255,255,255,0.04)',
                    color: state === 'done' ? '#34D399'
                      : state === 'active' ? '#FACC15'
                      : 'rgba(255,255,255,0.55)',
                    borderColor: state === 'done' ? 'rgba(52,211,153,0.45)'
                      : state === 'active' ? 'rgba(250,204,21,0.45)'
                      : 'rgba(255,255,255,0.10)',
                  }}
                >
                  {state === 'done' ? <Check className="w-3 h-3" /> : <span>{i + 1}</span>}
                  <span>{c.kind}</span>
                </div>
              </div>
            );
          })}
        </div>
      )}

      <div
        className="relative aspect-square rounded-3xl overflow-hidden border border-white/10"
        style={{ background: 'radial-gradient(ellipse at center, #0a0a0a 0%, #000 100%)' }}
      >
        <video
          ref={videoRef}
          playsInline
          muted
          className="absolute inset-0 w-full h-full object-cover"
          style={{ transform: 'scaleX(-1)' }}
        />

        {/* Dark vignette + oval cutout */}
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
            stroke="#FACC15"
            strokeWidth={3.5}
            strokeLinecap="round"
            strokeDasharray={CIRC}
            strokeDashoffset={CIRC}
            transform={`rotate(-90 ${CX} ${CY})`}
          />
        </svg>

        {/* Big challenge instruction — Meta-style */}
        <AnimatePresence mode="wait">
          {phase === 'challenge' && active && (
            <motion.div
              key={`${activeIdx}-${active.kind}`}
              initial={{ opacity: 0, y: -8, scale: 0.96 }}
              animate={{ opacity: 1, y: 0, scale: 1 }}
              exit={{ opacity: 0, y: -8, scale: 0.96 }}
              transition={{ duration: 0.22 }}
              className="absolute top-4 left-0 right-0 flex flex-col items-center pointer-events-none px-4"
            >
              <div className="text-white text-[22px] font-bold tracking-wide drop-shadow-[0_2px_10px_rgba(0,0,0,0.6)] uppercase">
                {active.title}
              </div>
              <div className="text-white/75 text-[12px] mt-0.5 drop-shadow">
                {active.hint}
              </div>
            </motion.div>
          )}
        </AnimatePresence>

        {/* Animated directional / action icon */}
        <AnimatePresence>
          {phase === 'challenge' && ActiveIcon && (
            <motion.div
              key={`icon-${activeIdx}`}
              initial={{ opacity: 0, scale: 0.7 }}
              animate={{
                opacity: 1, scale: 1,
                x: active.kind === 'LEFT' ? [-6, -18, -6] : active.kind === 'RIGHT' ? [6, 18, 6] : 0,
                y: active.kind === 'UP' ? [-6, -18, -6] : active.kind === 'DOWN' ? [6, 18, 6] : 0,
              }}
              exit={{ opacity: 0, scale: 0.7 }}
              transition={{
                opacity: { duration: 0.2 },
                scale: { duration: 0.2 },
                x: { duration: 1.2, repeat: Infinity, ease: 'easeInOut' },
                y: { duration: 1.2, repeat: Infinity, ease: 'easeInOut' },
              }}
              className="absolute inset-0 flex items-center justify-center pointer-events-none"
            >
              <div className="w-20 h-20 rounded-full bg-black/55 backdrop-blur-md flex items-center justify-center border border-white/15">
                <ActiveIcon className="w-10 h-10 text-yellow-300" />
              </div>
            </motion.div>
          )}
        </AnimatePresence>

        {/* Quality / status pill */}
        <div className="absolute bottom-3 left-3 right-3 flex justify-center pointer-events-none">
          <div
            ref={statusElRef}
            className="px-3.5 py-1.5 rounded-full text-[12px] font-medium backdrop-blur-md bg-black/45 border tabular-nums"
            style={{
              color: phase === 'done' ? '#34D399'
                : quality10Hz === 'none' ? '#34D399'
                : '#FECACA',
              borderColor: phase === 'done' ? 'rgba(52,211,153,0.7)'
                : quality10Hz === 'none' ? 'rgba(52,211,153,0.55)'
                : 'rgba(244,114,114,0.45)',
            }}
          >
            {phase === 'starting' && (<><Loader2 className="inline w-3 h-3 mr-1.5 animate-spin" />Starting camera…</>)}
            {phase === 'preflight' && QUALITY_MSG[quality10Hz]}
            {phase === 'challenge' && (
              quality10Hz !== 'none' && active && active.kind !== 'BLINK' && active.kind !== 'SMILE'
                ? QUALITY_MSG[quality10Hz]
                : `${Math.round(progress10Hz * 100)}%`
            )}
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

      {/* Per-challenge timeout helper */}
      {showTimeoutHelp && phase === 'challenge' && (
        <div className="rounded-2xl p-3.5 bg-yellow-500/10 border border-yellow-500/30 text-yellow-100 flex items-center justify-between gap-3">
          <div className="text-[12.5px] leading-snug">
            Having trouble? You can retry this step.
          </div>
          <button
            type="button"
            onClick={retryChallenge}
            className="shrink-0 h-9 px-3 rounded-lg text-[12px] font-semibold bg-yellow-400/90 text-black"
          >
            <RotateCcw className="inline w-3.5 h-3.5 mr-1" /> Retry
          </button>
        </div>
      )}

      {(phase === 'preflight' || phase === 'challenge') && (
        <button
          type="button"
          onClick={restart}
          className="w-full h-10 rounded-xl text-[12.5px] text-muted-foreground hover:text-white border border-white/10 hover:border-white/25 transition"
        >
          <X className="inline w-3.5 h-3.5 mr-1.5" /> Cancel & restart
        </button>
      )}
    </div>
  );
}
