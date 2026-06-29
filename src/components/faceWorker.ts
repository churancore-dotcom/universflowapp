/// <reference lib="webworker" />
// Face-liveness Web Worker. Runs MediaPipe FaceLandmarker off the main thread
// so React rendering, the camera <video> element, and the animation ring stay
// at 60fps on mid-range Androids. The main thread only ships ImageBitmaps in
// and receives compact pose/expression numbers out.
//
// Inference uses the CPU delegate — the GPU delegate needs a canvas/WebGL
// context that is unreliable inside DedicatedWorkers across Android WebViews.
// CPU is plenty fast for 320×240 grayscale-ish bitmaps at ~20Hz.

import {
  FaceLandmarker,
  FilesetResolver,
  type FaceLandmarkerResult,
} from '@mediapipe/tasks-vision';
import modelAsset from '@/assets/models/face_landmarker.task.asset.json';

type InMsg =
  | { type: 'init' }
  | { type: 'frame'; bitmap: ImageBitmap; t: number };

type OutMsg =
  | { type: 'ready' }
  | { type: 'error'; message: string }
  | {
      type: 'result';
      t: number;
      hasFace: boolean;
      faceCount: number;
      // pose in degrees
      yaw: number;
      pitch: number;
      roll: number;
      // normalized 0..1 inside the frame
      bboxW: number;
      bboxH: number;
      cx: number;
      cy: number;
      // expressions 0..1
      blinkLeft: number;
      blinkRight: number;
      smileLeft: number;
      smileRight: number;
    };

let landmarker: FaceLandmarker | null = null;

function post(msg: OutMsg, transfer: Transferable[] = []) {
  (self as unknown as DedicatedWorkerGlobalScope).postMessage(msg, transfer);
}

// Standard rotation-matrix → Euler decomposition (Tait-Bryan, Y-X-Z order)
// using ALL columns of the 4×4 transformation matrix MediaPipe returns. This
// gives us yaw (Y), pitch (X), and roll (Z) without the singularities the
// previous 2-column hack produced.
function matrixToEuler(m: ArrayLike<number>): { yaw: number; pitch: number; roll: number } {
  // Column-major 4×4: m[col*4 + row]
  const r00 = m[0],  r10 = m[1],  r20 = m[2];
  const r01 = m[4],  r11 = m[5],  r21 = m[6];
  const r22 = m[10];
  const sy = Math.sqrt(r00 * r00 + r10 * r10);
  const singular = sy < 1e-6;
  let pitch: number, yaw: number, roll: number;
  if (!singular) {
    pitch = Math.atan2(r21, r22);
    yaw   = Math.atan2(-r20, sy);
    roll  = Math.atan2(r10, r00);
  } else {
    pitch = Math.atan2(-r01, r11);
    yaw   = Math.atan2(-r20, sy);
    roll  = 0;
  }
  const RAD = 180 / Math.PI;
  return { yaw: yaw * RAD, pitch: pitch * RAD, roll: roll * RAD };
}

function pickBlend(arr: { categoryName?: string; displayName?: string; score: number }[] | undefined, name: string): number {
  if (!arr) return 0;
  for (const b of arr) {
    if (b.categoryName === name || b.displayName === name) return b.score;
  }
  return 0;
}

// Multiple CDN mirrors. Android WebView occasionally drops the first
// jsdelivr request; we cycle through fastly + unpkg + gcore before giving up.
const WASM_CDNS = [
  'https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.35/wasm',
  'https://fastly.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.35/wasm',
  'https://unpkg.com/@mediapipe/tasks-vision@0.10.35/wasm',
  'https://gcore.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.35/wasm',
  'https://testingcf.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.35/wasm',
];

function withTimeout<T>(p: Promise<T>, ms: number): Promise<T> {
  return new Promise((resolve, reject) => {
    const t = setTimeout(() => reject(new Error('timeout')), ms);
    p.then(v => { clearTimeout(t); resolve(v); }, e => { clearTimeout(t); reject(e); });
  });
}

async function loadFilesetWithFallback() {
  let lastErr: unknown = null;
  // 3 full passes over the CDN list so flaky mobile networks have plenty of
  // chances to succeed before we surface an error to the user.
  for (let pass = 0; pass < 3; pass++) {
    for (const url of WASM_CDNS) {
      try {
        return await withTimeout(FilesetResolver.forVisionTasks(url), 12_000);
      } catch (e) {
        lastErr = e;
        await new Promise((r) => setTimeout(r, 300 + pass * 400));
      }
    }
  }
  throw lastErr instanceof Error ? lastErr : new Error('All WASM CDNs failed');
}

async function init() {
  try {
    const fileset = await loadFilesetWithFallback();
    landmarker = await FaceLandmarker.createFromOptions(fileset, {
      baseOptions: {
        modelAssetPath: modelAsset.url, // bundled via Lovable Asset CDN, same-origin
        delegate: 'CPU',
      },
      runningMode: 'VIDEO',
      numFaces: 2, // detect "multiple faces" warning
      outputFaceBlendshapes: true,
      outputFacialTransformationMatrixes: true,
    });
    post({ type: 'ready' });
  } catch (e) {
    post({ type: 'error', message: (e as Error)?.message || String(e) });
  }
}

self.onmessage = async (ev: MessageEvent<InMsg>) => {
  const data = ev.data;
  if (data.type === 'init') {
    await init();
    return;
  }
  if (data.type === 'frame') {
    const { bitmap, t } = data;
    if (!landmarker) { bitmap.close(); return; }
    let result: FaceLandmarkerResult | null = null;
    try {
      result = landmarker.detectForVideo(bitmap, t);
    } catch {
      result = null;
    }
    const faceCount = result?.faceLandmarks?.length ?? 0;
    const matrix = result?.facialTransformationMatrixes?.[0]?.data;
    const lm = result?.faceLandmarks?.[0];
    const blend = result?.faceBlendshapes?.[0]?.categories;

    if (!matrix || !lm) {
      post({
        type: 'result', t,
        hasFace: false, faceCount,
        yaw: 0, pitch: 0, roll: 0,
        bboxW: 0, bboxH: 0, cx: 0, cy: 0,
        blinkLeft: 0, blinkRight: 0, smileLeft: 0, smileRight: 0,
      });
      bitmap.close();
      return;
    }

    const { yaw, pitch, roll } = matrixToEuler(matrix as unknown as ArrayLike<number>);

    // bbox from landmarks (already normalized 0..1)
    let minX = 1, minY = 1, maxX = 0, maxY = 0;
    for (let i = 0; i < lm.length; i++) {
      const p = lm[i];
      if (p.x < minX) minX = p.x;
      if (p.x > maxX) maxX = p.x;
      if (p.y < minY) minY = p.y;
      if (p.y > maxY) maxY = p.y;
    }
    const bboxW = Math.max(0, maxX - minX);
    const bboxH = Math.max(0, maxY - minY);
    const cx = (minX + maxX) / 2;
    const cy = (minY + maxY) / 2;

    post({
      type: 'result', t,
      hasFace: true, faceCount,
      yaw, pitch, roll,
      bboxW, bboxH, cx, cy,
      blinkLeft:  pickBlend(blend, 'eyeBlinkLeft'),
      blinkRight: pickBlend(blend, 'eyeBlinkRight'),
      smileLeft:  pickBlend(blend, 'mouthSmileLeft'),
      smileRight: pickBlend(blend, 'mouthSmileRight'),
    });
    bitmap.close();
  }
};

export {};
