import { useEffect, useRef } from 'react';
import { EMOTION_STYLES, type Emotion, type EmotionStyle } from '@/lib/lyricEmotion';
import { getAnalyser } from '@/lib/audioEngine';

interface Props {
  emotion: Emotion;
  playing: boolean;
  className?: string;
}

interface Particle {
  x: number; y: number; vx: number; vy: number; r: number; hueIdx: number; life: number;
}

const lerp = (a: number, b: number, t: number) => a + (b - a) * t;

function hexToRgb(hex: string): [number, number, number] {
  const v = hex.replace('#', '');
  const n = parseInt(v.length === 3 ? v.split('').map((c) => c + c).join('') : v, 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

/** Blended, animatable copy of an EmotionStyle. */
function styleToVector(s: EmotionStyle) {
  return {
    colors: s.colors.map(hexToRgb) as [number, number, number][],
    speed: s.speed, chaos: s.chaos, pulse: s.pulse, amplitude: s.amplitude, size: s.size,
  };
}
type StyleVector = ReturnType<typeof styleToVector>;

function blend(from: StyleVector, to: StyleVector, t: number): StyleVector {
  return {
    colors: from.colors.map((c, i) => [
      Math.round(lerp(c[0], to.colors[i][0], t)),
      Math.round(lerp(c[1], to.colors[i][1], t)),
      Math.round(lerp(c[2], to.colors[i][2], t)),
    ]) as [number, number, number][],
    speed: lerp(from.speed, to.speed, t),
    chaos: lerp(from.chaos, to.chaos, t),
    pulse: lerp(from.pulse, to.pulse, t),
    amplitude: lerp(from.amplitude, to.amplitude, t),
    size: lerp(from.size, to.size, t),
  };
}

const PARTICLE_COUNT = 64;
const TRANSITION_MS = 800;

const EmotionVisualizer = ({ emotion, playing, className = '' }: Props) => {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const targetRef = useRef<Emotion>(emotion);
  const rafRef = useRef<number | null>(null);

  useEffect(() => { targetRef.current = emotion; }, [emotion]);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const reduced = typeof window !== 'undefined'
      && window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;

    let width = 0;
    let height = 0;
    const dpr = Math.min(window.devicePixelRatio || 1, 2);

    const resize = () => {
      const rect = canvas.getBoundingClientRect();
      width = Math.max(1, rect.width);
      height = Math.max(1, rect.height);
      canvas.width = Math.round(width * dpr);
      canvas.height = Math.round(height * dpr);
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    };
    resize();
    const ro = typeof ResizeObserver !== 'undefined' ? new ResizeObserver(resize) : null;
    ro?.observe(canvas);

    const particles: Particle[] = Array.from({ length: PARTICLE_COUNT }, () => ({
      x: Math.random() * width,
      y: Math.random() * height,
      vx: (Math.random() - 0.5) * 0.6,
      vy: (Math.random() - 0.5) * 0.6,
      r: 1 + Math.random() * 2,
      hueIdx: Math.floor(Math.random() * 3),
      life: Math.random(),
    }));

    let current = styleToVector(EMOTION_STYLES[targetRef.current]);
    let from = current;
    let toEmotion: Emotion = targetRef.current;
    let transitionStart = 0;

    // Audio-reactive energy (optional — falls back to a soft synthetic pulse)
    const analyser = getAnalyser();
    const bins = analyser ? new Uint8Array(analyser.frequencyBinCount) : null;
    let energy = 0.4;
    let bass = 0.4;

    let last = performance.now();

    const frame = (now: number) => {
      const dt = Math.min(64, now - last) / 16.67;
      last = now;

      if (targetRef.current !== toEmotion) {
        from = current;
        toEmotion = targetRef.current;
        transitionStart = now;
      }
      if (transitionStart) {
        const t = Math.min(1, (now - transitionStart) / TRANSITION_MS);
        current = blend(from, styleToVector(EMOTION_STYLES[toEmotion]), t);
        if (t >= 1) transitionStart = 0;
      }

      if (analyser && bins) {
        analyser.getByteFrequencyData(bins);
        let low = 0; let all = 0;
        const lowEnd = Math.max(4, Math.floor(bins.length * 0.08));
        for (let i = 0; i < bins.length; i++) {
          all += bins[i];
          if (i < lowEnd) low += bins[i];
        }
        const nextEnergy = all / (bins.length * 255);
        const nextBass = low / (lowEnd * 255);
        energy = lerp(energy, nextEnergy || 0.08, 0.22);
        bass = lerp(bass, nextBass || 0.08, 0.3);
      } else {
        const synth = playing ? 0.42 + 0.3 * Math.abs(Math.sin(now / 420)) : 0.12;
        energy = lerp(energy, synth, 0.08);
        bass = lerp(bass, playing ? 0.35 + 0.35 * Math.abs(Math.sin(now / 300)) : 0.08, 0.12);
      }

      const [c0, c1, c2] = current.colors;
      ctx.clearRect(0, 0, width, height);

      // Ambient mood wash
      const glow = ctx.createRadialGradient(width / 2, height * 0.5, 0, width / 2, height * 0.5, Math.max(width, height) * 0.75);
      const intensity = 0.16 + energy * current.pulse * 0.4;
      glow.addColorStop(0, `rgba(${c0[0]},${c0[1]},${c0[2]},${intensity})`);
      glow.addColorStop(0.55, `rgba(${c1[0]},${c1[1]},${c1[2]},${intensity * 0.5})`);
      glow.addColorStop(1, 'rgba(0,0,0,0)');
      ctx.fillStyle = glow;
      ctx.fillRect(0, 0, width, height);

      // Emotion waves
      const waveCount = 3;
      for (let w = 0; w < waveCount; w++) {
        const c = [c0, c1, c2][w % 3];
        const amp = current.amplitude * (1 + bass * current.pulse) * (1 - w * 0.22);
        const phase = now / (900 - current.speed * 320) + w * 1.4;
        ctx.beginPath();
        for (let x = 0; x <= width; x += 10) {
          const nx = x / Math.max(1, width);
          const jag = current.chaos > 0.5 ? Math.sin(nx * 40 + phase * 3) * current.chaos * 10 : 0;
          const y = height * (0.5 + (w - 1) * 0.11)
            + Math.sin(nx * 6.2 + phase) * amp
            + Math.sin(nx * 13 + phase * 1.7) * amp * 0.32
            + jag;
          if (x === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
        }
        ctx.strokeStyle = `rgba(${c[0]},${c[1]},${c[2]},${0.1 + energy * 0.28})`;
        ctx.lineWidth = 1.1 + bass * 1.8;
        ctx.stroke();
      }

      // Particles
      const speed = current.speed * (0.5 + energy * 1.2);
      for (const p of particles) {
        if (!reduced) {
          const wobble = current.chaos * (Math.random() - 0.5) * 1.6;
          p.vx = lerp(p.vx, (p.vx + wobble) * 0.98, 0.3);
          p.vy = lerp(p.vy, (p.vy + wobble - 0.12 * current.speed) * 0.98, 0.3);
          p.x += p.vx * speed * dt * 2.2;
          p.y += p.vy * speed * dt * 2.2;
          if (p.x < -20) p.x = width + 20;
          if (p.x > width + 20) p.x = -20;
          if (p.y < -20) p.y = height + 20;
          if (p.y > height + 20) p.y = -20;
        }
        const c = current.colors[p.hueIdx];
        const r = p.r * current.size * (0.7 + bass * current.pulse * 0.9);
        ctx.beginPath();
        ctx.arc(p.x, p.y, Math.max(0.4, r), 0, Math.PI * 2);
        ctx.fillStyle = `rgba(${c[0]},${c[1]},${c[2]},${0.14 + energy * 0.42})`;
        ctx.fill();
      }

      rafRef.current = requestAnimationFrame(frame);
    };

    rafRef.current = requestAnimationFrame(frame);

    return () => {
      if (rafRef.current) cancelAnimationFrame(rafRef.current);
      rafRef.current = null;
      ro?.disconnect();
    };
  }, [playing]);

  return (
    <canvas
      ref={canvasRef}
      aria-hidden
      className={`pointer-events-none absolute inset-0 h-full w-full ${className}`}
    />
  );
};

export default EmotionVisualizer;
