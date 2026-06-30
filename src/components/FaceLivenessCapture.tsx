import { useCallback, useEffect, useRef, useState } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import { AlertTriangle, Camera, Check, Loader2, RotateCcw, X } from 'lucide-react';
import confetti from 'canvas-confetti';

export interface LivenessShots {
  capture: Blob;
}

type Phase = 'idle' | 'starting' | 'ready' | 'capturing' | 'done' | 'error';

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
  const autoTimerRef = useRef<number | null>(null);
  const capturedRef = useRef(false);
  const readyRef = useRef(false);

  const [phase, setPhase] = useState<Phase>('idle');
  const [err, setErr] = useState<string | null>(null);
  const [videoReady, setVideoReady] = useState(false);
  const [flash, setFlash] = useState(false);
  const [countdown, setCountdown] = useState(2);

  const teardown = useCallback(() => {
    if (autoTimerRef.current) window.clearTimeout(autoTimerRef.current);
    autoTimerRef.current = null;
    streamRef.current?.getTracks().forEach((track) => track.stop());
    streamRef.current = null;
  }, []);

  useEffect(() => () => teardown(), [teardown]);

  const doCapture = useCallback(async () => {
    if (capturedRef.current) return;
    capturedRef.current = true;
    setPhase('capturing');
    setFlash(true);
    window.setTimeout(() => setFlash(false), 140);

    try {
      confetti({ particleCount: 36, spread: 54, origin: { y: 0.42 }, scalar: 0.75 });
    } catch {
      // visual-only
    }

    const video = videoRef.current;
    const canvas = captureCanvasRef.current;
    if (!video || !canvas || video.readyState < 2) {
      setErr('Camera was not ready. Tap Retry.');
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
        window.setTimeout(() => onComplete({ capture: blob }), 240);
      },
      'image/jpeg',
      0.9,
    );
  }, [onComplete, onFail, teardown]);

  const startAutoCapture = useCallback(() => {
    if (autoTimerRef.current) window.clearTimeout(autoTimerRef.current);
    setCountdown(2);

    let remaining = 2;
    const tick = () => {
      remaining -= 1;
      setCountdown(Math.max(remaining, 0));
      if (remaining <= 0) {
        void doCapture();
      } else {
        autoTimerRef.current = window.setTimeout(tick, 850);
      }
    };

    autoTimerRef.current = window.setTimeout(tick, 850);
  }, [doCapture]);

  const startCamera = async () => {
    if (phase !== 'idle' && phase !== 'error') return;
    setErr(null);
    setVideoReady(false);
    capturedRef.current = false;
    readyRef.current = false;
    setPhase('starting');

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
        if (readyRef.current) return;
        readyRef.current = true;
        setVideoReady(true);
        setPhase('ready');
        startAutoCapture();
      };

      video.onloadedmetadata = markReady;
      video.onplaying = markReady;
      await video.play().catch(() => undefined);

      window.setTimeout(() => {
        if (!readyRef.current && video.readyState >= 2) markReady();
      }, 700);
    } catch (e: unknown) {
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
    readyRef.current = false;
    setErr(null);
    setFlash(false);
    setVideoReady(false);
    setCountdown(2);
    setPhase('idle');
  };

  if (phase === 'error' && err) {
    return (
      <div className="rounded-2xl p-5 bg-rose-500/10 border border-rose-500/30 text-rose-100">
        <div className="flex items-center gap-2 font-semibold">
          <AlertTriangle className="w-4 h-4" /> Camera stopped
        </div>
        <p className="text-[12.5px] mt-1 leading-relaxed">{err}</p>
        <button type="button" onClick={restart} className="mt-3 inline-flex items-center gap-1.5 text-[12px] underline">
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
            Look at the camera. We will take one quick photo automatically.
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

  const VB = 300;
  const CX = 150;
  const CY = 150;
  const RX = 108;
  const RY = 132;

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
          {!videoReady && (
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              className="absolute inset-0 z-10 flex flex-col items-center justify-center gap-3 bg-black/80 pointer-events-none"
            >
              <Loader2 className="w-6 h-6 animate-spin text-primary" />
              <p className="text-[12px] font-medium text-white/80">Opening camera…</p>
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
          <ellipse cx={CX} cy={CY} rx={RX} ry={RY} fill="none" stroke="rgba(255,255,255,0.72)" strokeWidth={2.5} />
        </svg>

        {phase === 'ready' && (
          <div className="absolute top-4 left-0 right-0 flex flex-col items-center pointer-events-none px-4">
            <div className="text-white text-[18px] font-bold tracking-wide drop-shadow-[0_2px_10px_rgba(0,0,0,0.6)] uppercase">
              Look at camera
            </div>
            <div className="text-white/75 text-[12px] mt-0.5 drop-shadow">
              Capturing in {countdown || 1}
            </div>
          </div>
        )}

        <div className="absolute bottom-3 left-3 right-3 flex justify-center pointer-events-none">
          <div
            className="px-3.5 py-1.5 rounded-full text-[12px] font-medium backdrop-blur-md bg-black/45 border tabular-nums"
            style={{ color: phase === 'done' ? '#34D399' : '#fff', borderColor: 'rgba(255,255,255,0.22)' }}
          >
            {phase === 'starting' && (<><Loader2 className="inline w-3 h-3 mr-1.5 animate-spin" />Starting camera…</>)}
            {phase === 'ready' && 'Ready'}
            {phase === 'capturing' && 'Capturing…'}
            {phase === 'done' && 'Captured ✓'}
          </div>
        </div>

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

      {phase === 'ready' && (
        <div className="grid grid-cols-[1fr_auto] gap-2">
          <button
            type="button"
            onClick={() => { void doCapture(); }}
            disabled={!videoReady}
            className="h-12 rounded-xl font-semibold text-white inline-flex items-center justify-center gap-2 disabled:opacity-50"
            style={{ background: '#FF2D55' }}
          >
            <Camera className="w-4 h-4" /> Capture now
          </button>
          <button
            type="button"
            onClick={restart}
            aria-label="Cancel camera"
            className="w-12 h-12 rounded-xl text-muted-foreground hover:text-white border border-white/10 hover:border-white/25 transition inline-flex items-center justify-center"
          >
            <X className="w-4 h-4" />
          </button>
        </div>
      )}
    </div>
  );
}