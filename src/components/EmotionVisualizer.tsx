import { useEffect, useRef } from 'react';
import { EMOTION_STYLES, type Emotion, type EmotionStyle } from '@/lib/lyricEmotion';
import { getAnalyser } from '@/lib/audioEngine';

interface Props {
  emotion: Emotion;
  playing: boolean;
  /** 0-1 confidence of the current lyric line — scales how loud the visuals get */
  confidence?: number;
  className?: string;
}

interface Particle {
  x: number; y: number; vx: number; vy: number; r: number; hueIdx: number;
  /** per-particle phase so motion modes can stagger */
  seed: number;
  life: number;
}

const lerp = (a: number, b: number, t: number) => a + (b - a) * t;
// easeInOutCubic — mood changes glide instead of snapping.
const ease = (t: number) => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2);

function hexToRgb(hex: string): [number, number, number] {
  const v = hex.replace('#', '');
  const n = parseInt(v.length === 3 ? v.split('').map((c) => c + c).join('') : v, 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

/** Blended, animatable copy of an EmotionStyle. */
function styleToVector(s: EmotionStyle) {
  return {
    colors: s.colors.map(hexToRgb) as [number, number, number][],
    speed: s.speed, chaos: s.chaos, pulse: s.pulse, amplitude: s.amplitude,
    size: s.size, gravity: s.gravity,
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
    gravity: lerp(from.gravity, to.gravity, t),
  };
}

// Perf budget: the lyrics view runs on low-end Android phones behind a scrolling
// list, so the canvas renders at ~half resolution, capped to 30fps, with far
// fewer draw calls than a desktop visualizer would use.
const TRANSITION_MS = 1400;

const EmotionVisualizer = ({ emotion, playing, confidence = 0.7, className = '' }: Props) => {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const targetRef = useRef<Emotion>(emotion);
  const playingRef = useRef(playing);
  const confRef = useRef(confidence);
  const rafRef = useRef<number | null>(null);

  useEffect(() => { targetRef.current = emotion; }, [emotion]);
  useEffect(() => { playingRef.current = playing; }, [playing]);
  useEffect(() => { confRef.current = confidence; }, [confidence]);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d', { alpha: true });
    if (!ctx) return;

    const reduced = typeof window !== 'undefined'
      && window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;

    // Half-res backing store (scaled up by CSS) — the visuals are soft blurs and
    // waves, so the resolution loss is invisible but the fill cost drops ~4x.
    const dpr = reduced ? 0.5 : Math.min(window.devicePixelRatio || 1, 2) * 0.5;
    const lowPower = typeof navigator !== 'undefined'
      && ((navigator as { hardwareConcurrency?: number }).hardwareConcurrency ?? 4) <= 4;
    const particleCount = reduced ? 0 : lowPower ? 20 : 34;
    const frameMs = reduced ? 66 : 33; // 15fps reduced-motion, else ~30fps
    const waveStep = 22;

    let width = 0;
    let height = 0;

    const resize = () => {
      const rect = canvas.getBoundingClientRect();
      width = Math.max(1, rect.width);
      height = Math.max(1, rect.height);
      canvas.width = Math.max(1, Math.round(width * dpr));
      canvas.height = Math.max(1, Math.round(height * dpr));
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    };
    resize();
    let resizeTimer: ReturnType<typeof setTimeout> | null = null;
    const ro = typeof ResizeObserver !== 'undefined'
      ? new ResizeObserver(() => {
        if (resizeTimer) clearTimeout(resizeTimer);
        resizeTimer = setTimeout(resize, 120);
      })
      : null;
    ro?.observe(canvas);

    const spawn = (): Particle => ({
      x: Math.random() * width,
      y: Math.random() * height,
      vx: (Math.random() - 0.5) * 0.6,
      vy: (Math.random() - 0.5) * 0.6,
      r: 1 + Math.random() * 2,
      hueIdx: Math.floor(Math.random() * 3),
      seed: Math.random() * Math.PI * 2,
      life: Math.random(),
    });
    const particles: Particle[] = Array.from({ length: particleCount }, spawn);

    let current = styleToVector(EMOTION_STYLES[targetRef.current]);
    let from = current;
    let toEmotion: Emotion = targetRef.current;
    let toVector = current;
    let transitionStart = 0;
    // Motion mode is discrete (you can't half-rain, half-ember), so it swaps at
    // the transition midpoint when the colours have already mostly crossed over.
    let motion = EMOTION_STYLES[toEmotion].motion;
    let pendingMotion = motion;

    // Audio-reactive energy (optional — falls back to a soft synthetic pulse)
    const analyser = getAnalyser();
    const bins = analyser ? new Uint8Array(analyser.frequencyBinCount) : null;
    let energy = 0.4;
    let bass = 0.4;
    let treble = 0.3;

    // Cached mood wash: a radial gradient per frame is one of the most expensive
    // canvas ops, so rebuild it only when the blended colour actually shifts.
    let glow: CanvasGradient | null = null;
    let glowKey = '';

    let last = performance.now();
    let hidden = typeof document !== 'undefined' && document.hidden;
    const onVisibility = () => { hidden = document.hidden; };
    document.addEventListener('visibilitychange', onVisibility);

    const frame = (now: number) => {
      rafRef.current = requestAnimationFrame(frame);
      if (hidden) { last = now; return; }
      const elapsed = now - last;
      if (elapsed < frameMs) return;
      const dt = Math.min(4, elapsed / 16.67);
      last = now;

      if (targetRef.current !== toEmotion) {
        from = current;
        toEmotion = targetRef.current;
        toVector = styleToVector(EMOTION_STYLES[toEmotion]);
        pendingMotion = EMOTION_STYLES[toEmotion].motion;
        transitionStart = now;
      }
      if (transitionStart) {
        const raw = Math.min(1, (now - transitionStart) / TRANSITION_MS);
        const t = ease(raw);
        current = blend(from, toVector, t);
        if (raw >= 0.5) motion = pendingMotion;
        if (raw >= 1) { transitionStart = 0; current = toVector; motion = pendingMotion; }
      }

      if (analyser && bins) {
        analyser.getByteFrequencyData(bins);
        let low = 0; let all = 0; let high = 0;
        const lowEnd = Math.max(4, Math.floor(bins.length * 0.08));
        const highStart = Math.floor(bins.length * 0.55);
        let n = 0;
        let hn = 0;
        for (let i = 0; i < bins.length; i += 4) { all += bins[i]; n++; }
        for (let i = 0; i < lowEnd; i++) low += bins[i];
        for (let i = highStart; i < bins.length; i += 4) { high += bins[i]; hn++; }
        const nextEnergy = all / (Math.max(1, n) * 255);
        const nextBass = low / (lowEnd * 255);
        const nextTreble = high / (Math.max(1, hn) * 255);
        energy = lerp(energy, nextEnergy || 0.08, 0.25);
        bass = lerp(bass, nextBass || 0.08, 0.32);
        treble = lerp(treble, nextTreble || 0.06, 0.28);
      } else {
        const active = playingRef.current;
        const synth = active ? 0.42 + 0.3 * Math.abs(Math.sin(now / 420)) : 0.12;
        energy = lerp(energy, synth, 0.12);
        bass = lerp(bass, active ? 0.35 + 0.35 * Math.abs(Math.sin(now / 300)) : 0.08, 0.16);
        treble = lerp(treble, active ? 0.25 + 0.2 * Math.abs(Math.sin(now / 180)) : 0.06, 0.16);
      }

      // Confident lyric lines push the visuals harder; filler lines stay calm.
      const conf = 0.55 + confRef.current * 0.55;

      const [c0, c1, c2] = current.colors;
      ctx.clearRect(0, 0, width, height);

      const intensity = (0.16 + energy * current.pulse * 0.4) * conf;
      const key = `${c0[0]}|${c0[1]}|${c0[2]}|${c1[0]}|${Math.round(intensity * 20)}|${Math.round(width)}x${Math.round(height)}`;
      if (key !== glowKey || !glow) {
        glow = ctx.createRadialGradient(width / 2, height * 0.5, 0, width / 2, height * 0.5, Math.max(width, height) * 0.75);
        glow.addColorStop(0, `rgba(${c0[0]},${c0[1]},${c0[2]},${intensity})`);
        glow.addColorStop(0.55, `rgba(${c1[0]},${c1[1]},${c1[2]},${intensity * 0.5})`);
        glow.addColorStop(1, 'rgba(0,0,0,0)');
        glowKey = key;
      }
      ctx.fillStyle = glow;
      ctx.fillRect(0, 0, width, height);

      // Emotion waves (2 on low-power devices)
      const waveCount = lowPower || reduced ? 2 : 3;
      for (let w = 0; w < waveCount; w++) {
        const c = [c0, c1, c2][w % 3];
        const amp = current.amplitude * (1 + bass * current.pulse) * (1 - w * 0.22) * conf;
        const phase = now / (900 - current.speed * 320) + w * 1.4;
        ctx.beginPath();
        for (let x = 0; x <= width; x += waveStep) {
          const nx = x / Math.max(1, width);
          const jag = current.chaos > 0.5 ? Math.sin(nx * 40 + phase * 3) * current.chaos * 10 : 0;
          const y = height * (0.5 + (w - 1) * 0.11)
            + Math.sin(nx * 6.2 + phase) * amp
            + Math.sin(nx * 13 + phase * 1.7) * amp * 0.32
            + jag;
          if (x === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
        }
        ctx.strokeStyle = `rgba(${c[0]},${c[1]},${c[2]},${(0.1 + energy * 0.28) * conf})`;
        ctx.lineWidth = 1.1 + bass * 1.8;
        ctx.stroke();
      }

      // ── Particles: one distinct behaviour per emotion ──────────────────────
      // rain (sad)    : slow vertical fall, thin streaks
      // embers (angry): rise + flicker, hot cores
      // sparkle(happy): twinkling dots that pop on treble
      // bokeh (romantic): big soft slow orbs drifting up
      // streaks(intense): fast horizontal light trails
      // drift (neutral): gentle brownian float
      if (particles.length) {
        const speed = current.speed * (0.5 + energy * 1.2);
        const grow = (0.7 + bass * current.pulse * 0.9) * conf;

        if (motion === 'streaks') {
          ctx.lineCap = 'round';
          for (let hue = 0; hue < 3; hue++) {
            const c = current.colors[hue];
            ctx.strokeStyle = `rgba(${c[0]},${c[1]},${c[2]},${(0.16 + energy * 0.45) * conf})`;
            ctx.lineWidth = 1 + bass * 2.2;
            ctx.beginPath();
            for (const p of particles) {
              if (p.hueIdx !== hue) continue;
              p.vx = Math.abs(p.vx) < 0.4 ? 1.6 : p.vx;
              p.x += p.vx * speed * dt * 9;
              p.y += Math.sin(now / 400 + p.seed) * 0.5 * dt;
              if (p.x > width + 40) { p.x = -40; p.y = Math.random() * height; }
              const len = 18 + energy * 46;
              ctx.moveTo(p.x - len, p.y);
              ctx.lineTo(p.x, p.y);
            }
            ctx.stroke();
          }
        } else if (motion === 'rain') {
          for (let hue = 0; hue < 3; hue++) {
            const c = current.colors[hue];
            ctx.strokeStyle = `rgba(${c[0]},${c[1]},${c[2]},${(0.12 + energy * 0.22) * conf})`;
            ctx.lineWidth = 1;
            ctx.beginPath();
            for (const p of particles) {
              if (p.hueIdx !== hue) continue;
              p.y += (1.4 + p.r * 0.5) * speed * dt * 3.2;
              p.x += Math.sin(now / 1600 + p.seed) * 0.3 * dt;
              if (p.y > height + 20) { p.y = -20; p.x = Math.random() * width; }
              const len = 8 + p.r * 5;
              ctx.moveTo(p.x, p.y - len);
              ctx.lineTo(p.x, p.y);
            }
            ctx.stroke();
          }
        } else if (motion === 'embers') {
          for (let hue = 0; hue < 3; hue++) {
            const c = current.colors[hue];
            ctx.fillStyle = `rgba(${c[0]},${c[1]},${c[2]},${(0.18 + energy * 0.5) * conf})`;
            ctx.beginPath();
            for (const p of particles) {
              if (p.hueIdx !== hue) continue;
              p.life += 0.012 * dt;
              if (p.life > 1) { p.life = 0; p.x = Math.random() * width; p.y = height + 10; }
              p.y -= (1.1 + p.r) * speed * dt * 2.6;
              p.x += Math.sin(now / 220 + p.seed) * current.chaos * 1.8 * dt;
              if (p.y < -20) { p.y = height + 20; p.x = Math.random() * width; }
              const flicker = 0.6 + Math.abs(Math.sin(now / 120 + p.seed)) * 0.7;
              const r = Math.max(0.4, p.r * current.size * grow * flicker * (1 - p.life * 0.5));
              ctx.moveTo(p.x + r, p.y);
              ctx.arc(p.x, p.y, r, 0, Math.PI * 2);
            }
            ctx.fill();
          }
        } else if (motion === 'sparkle') {
          for (let hue = 0; hue < 3; hue++) {
            const c = current.colors[hue];
            ctx.fillStyle = `rgba(${c[0]},${c[1]},${c[2]},${(0.2 + treble * 0.6) * conf})`;
            ctx.beginPath();
            for (const p of particles) {
              if (p.hueIdx !== hue) continue;
              p.x += p.vx * speed * dt * 2.4;
              p.y += (p.vy - 0.18 * current.gravity) * speed * dt * 2.4;
              if (p.x < -20) p.x = width + 20; else if (p.x > width + 20) p.x = -20;
              if (p.y < -20) p.y = height + 20; else if (p.y > height + 20) p.y = -20;
              const twinkle = 0.35 + Math.abs(Math.sin(now / 160 + p.seed * 3)) * 1.1;
              const r = Math.max(0.3, p.r * current.size * grow * twinkle * (0.7 + treble));
              ctx.moveTo(p.x + r, p.y);
              ctx.arc(p.x, p.y, r, 0, Math.PI * 2);
            }
            ctx.fill();
          }
        } else if (motion === 'bokeh') {
          for (let hue = 0; hue < 3; hue++) {
            const c = current.colors[hue];
            ctx.fillStyle = `rgba(${c[0]},${c[1]},${c[2]},${(0.08 + energy * 0.18) * conf})`;
            ctx.beginPath();
            for (const p of particles) {
              if (p.hueIdx !== hue) continue;
              p.y -= (0.25 + p.r * 0.12) * speed * dt * 2;
              p.x += Math.sin(now / 2200 + p.seed) * 0.6 * dt;
              if (p.y < -40) { p.y = height + 40; p.x = Math.random() * width; }
              const breathe = 1 + Math.sin(now / 900 + p.seed) * 0.25;
              const r = Math.max(1, p.r * current.size * grow * 2.4 * breathe);
              ctx.moveTo(p.x + r, p.y);
              ctx.arc(p.x, p.y, r, 0, Math.PI * 2);
            }
            ctx.fill();
          }
        } else {
          for (let hue = 0; hue < 3; hue++) {
            const c = current.colors[hue];
            ctx.fillStyle = `rgba(${c[0]},${c[1]},${c[2]},${(0.12 + energy * 0.3) * conf})`;
            ctx.beginPath();
            for (const p of particles) {
              if (p.hueIdx !== hue) continue;
              const wobble = current.chaos * Math.sin(now / 700 + p.seed) * 0.5;
              p.vx = (p.vx + wobble * 0.1) * 0.99;
              p.vy = (p.vy + wobble * 0.1) * 0.99;
              p.x += p.vx * speed * dt * 1.8;
              p.y += p.vy * speed * dt * 1.8;
              if (p.x < -20) p.x = width + 20; else if (p.x > width + 20) p.x = -20;
              if (p.y < -20) p.y = height + 20; else if (p.y > height + 20) p.y = -20;
              const r = Math.max(0.4, p.r * current.size * grow);
              ctx.moveTo(p.x + r, p.y);
              ctx.arc(p.x, p.y, r, 0, Math.PI * 2);
            }
            ctx.fill();
          }
        }
      }
    };

    rafRef.current = requestAnimationFrame(frame);

    return () => {
      if (rafRef.current) cancelAnimationFrame(rafRef.current);
      rafRef.current = null;
      if (resizeTimer) clearTimeout(resizeTimer);
      document.removeEventListener('visibilitychange', onVisibility);
      ro?.disconnect();
    };
  }, []);

  return (
    <canvas
      ref={canvasRef}
      aria-hidden
      className={`pointer-events-none absolute inset-0 h-full w-full ${className}`}
    />
  );
};

export default EmotionVisualizer;
