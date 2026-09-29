// Song Stories — animated 9:16 story cards (auto-scrolling lyrics on ONE card),
// rendered on a canvas and recorded to a video for Instagram / WhatsApp.
import { artworkCandidates } from '@/lib/artworkUrl';

export type StoryStyle = 'aurora' | 'vinyl' | 'minimal' | 'neon';
export const STORY_STYLES: { id: StoryStyle; name: string }[] = [
  { id: 'aurora', name: 'Aurora' },
  { id: 'vinyl', name: 'Vinyl' },
  { id: 'neon', name: 'Neon' },
  { id: 'minimal', name: 'Minimal' },
];

export interface StoryAssets {
  title: string;
  artist: string;
  cover: HTMLImageElement | null;
  lines: string[];     // lyric lines to scroll through (may be empty)
  mixLabel?: string;
  accent: string;
}

export const STORY_W = 1080;
export const STORY_H = 1920;
export const STORY_SECONDS = 12;
const LINE_SECONDS = 2.4;
const SITE = 'universflow.in';

function loadImage(src: string): Promise<HTMLImageElement | null> {
  return new Promise((resolve) => {
    const img = new Image();
    img.crossOrigin = 'anonymous';
    img.onload = () => resolve(img);
    img.onerror = () => resolve(null);
    img.src = src;
  });
}

export async function loadCover(url?: string): Promise<HTMLImageElement | null> {
  if (!url) return null;
  for (const u of artworkCandidates(url, 600)) { const img = await loadImage(u); if (img) return img; }
  return null;
}

function wrap(ctx: CanvasRenderingContext2D, text: string, maxW: number, maxLines: number): string[] {
  const words = text.split(/\s+/).filter(Boolean);
  const out: string[] = [];
  let line = '';
  for (const w of words) {
    const test = line ? `${line} ${w}` : w;
    if (ctx.measureText(test).width > maxW && line) {
      out.push(line); line = w;
      if (out.length === maxLines) return out;
    } else line = test;
  }
  if (line && out.length < maxLines) out.push(line);
  return out;
}

function roundRect(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}

const ease = (x: number) => 1 - Math.pow(1 - Math.min(1, Math.max(0, x)), 3);

function drawBackground(ctx: CanvasRenderingContext2D, a: StoryAssets, style: StoryStyle, t: number) {
  ctx.fillStyle = style === 'minimal' ? '#f4f1ec' : '#07070a';
  ctx.fillRect(0, 0, STORY_W, STORY_H);
  if (style === 'minimal') return;
  if (a.cover) {
    ctx.save();
    const zoom = 1.25 + Math.sin(t * 0.35) * 0.06;
    const w = STORY_W * zoom * 1.6, h = STORY_H * zoom;
    ctx.filter = 'blur(70px) saturate(1.5)';
    ctx.globalAlpha = style === 'neon' ? 0.45 : 0.9;
    ctx.drawImage(a.cover, (STORY_W - w) / 2 + Math.sin(t * 0.5) * 60, (STORY_H - h) / 2, w, h);
    ctx.restore();
  }
  // Moving light blobs
  const blobs = style === 'neon' ? 3 : 2;
  for (let i = 0; i < blobs; i++) {
    const x = STORY_W * (0.5 + 0.4 * Math.sin(t * 0.6 + i * 2.1));
    const y = STORY_H * (0.35 + 0.3 * Math.cos(t * 0.45 + i * 1.7));
    const g = ctx.createRadialGradient(x, y, 0, x, y, 700);
    g.addColorStop(0, style === 'neon' ? (i % 2 ? '#00e5ffaa' : `${a.accent}`) : 'rgba(255,255,255,0.18)');
    g.addColorStop(1, 'rgba(0,0,0,0)');
    ctx.globalAlpha = style === 'neon' ? 0.35 : 0.6;
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, STORY_W, STORY_H);
  }
  ctx.globalAlpha = 1;
  const shade = ctx.createLinearGradient(0, 0, 0, STORY_H);
  shade.addColorStop(0, 'rgba(0,0,0,0.25)');
  shade.addColorStop(1, 'rgba(0,0,0,0.75)');
  ctx.fillStyle = shade;
  ctx.fillRect(0, 0, STORY_W, STORY_H);
}

function drawCover(ctx: CanvasRenderingContext2D, a: StoryAssets, style: StoryStyle, t: number, size: number, y: number) {
  const x = (STORY_W - size) / 2;
  const intro = ease(t / 0.8);
  ctx.save();
  ctx.globalAlpha = intro;
  if (style === 'vinyl') {
    const cx = STORY_W / 2, cy = y + size / 2, r = size / 2;
    ctx.translate(cx, cy);
    ctx.rotate(t * 0.9);
    ctx.fillStyle = '#111';
    ctx.beginPath(); ctx.arc(0, 0, r, 0, Math.PI * 2); ctx.fill();
    ctx.strokeStyle = 'rgba(255,255,255,0.06)'; ctx.lineWidth = 2;
    for (let k = r - 20; k > r * 0.45; k -= 14) { ctx.beginPath(); ctx.arc(0, 0, k, 0, Math.PI * 2); ctx.stroke(); }
    ctx.save();
    ctx.beginPath(); ctx.arc(0, 0, r * 0.42, 0, Math.PI * 2); ctx.clip();
    if (a.cover) ctx.drawImage(a.cover, -r * 0.42, -r * 0.42, r * 0.84, r * 0.84);
    else { ctx.fillStyle = a.accent; ctx.fill(); }
    ctx.restore();
    ctx.fillStyle = '#07070a'; ctx.beginPath(); ctx.arc(0, 0, 14, 0, Math.PI * 2); ctx.fill();
    ctx.restore();
    return;
  }
  const pulse = 1 + Math.sin(t * 2.2) * 0.012;
  ctx.translate(STORY_W / 2, y + size / 2);
  ctx.scale(pulse * (0.9 + 0.1 * intro), pulse * (0.9 + 0.1 * intro));
  ctx.translate(-STORY_W / 2, -(y + size / 2));
  ctx.shadowColor = style === 'neon' ? a.accent : 'rgba(0,0,0,0.5)';
  ctx.shadowBlur = style === 'neon' ? 80 : 60;
  roundRect(ctx, x, y, size, size, style === 'minimal' ? 12 : 44);
  ctx.save(); ctx.clip();
  if (a.cover) ctx.drawImage(a.cover, x, y, size, size);
  else {
    const g = ctx.createLinearGradient(x, y, x + size, y + size);
    g.addColorStop(0, a.accent); g.addColorStop(1, '#222');
    ctx.fillStyle = g; ctx.fillRect(x, y, size, size);
  }
  ctx.restore();
  ctx.restore();
}

function drawLyrics(ctx: CanvasRenderingContext2D, a: StoryAssets, style: StoryStyle, t: number, top: number, bottom: number) {
  if (!a.lines.length) return;
  const dark = style === 'minimal';
  const lineH = 118;
  const pos = t / LINE_SECONDS; // continuous scroll position in lines
  const current = Math.min(Math.floor(pos), a.lines.length - 1);
  const phase = pos - Math.floor(pos);
  // Hold the current lyric in the center, then transition near the end of its
  // display period. Highlight whichever line is closest to the center.
  const frac = current < a.lines.length - 1 ? ease((phase - 0.65) / 0.35) : 0;
  const scroll = (current + frac) * lineH;
  const active = Math.min(current + (frac >= 0.5 ? 1 : 0), a.lines.length - 1);
  const centerY = top + (bottom - top) * 0.38;
  ctx.save();
  ctx.beginPath(); ctx.rect(0, top, STORY_W, bottom - top); ctx.clip();
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  for (let i = 0; i < a.lines.length; i++) {
    const y = centerY + i * lineH - scroll;
    if (y < top - lineH || y > bottom + lineH) continue;
    const isActive = i === active;
    const dist = Math.abs(y - centerY) / (bottom - top);
    ctx.globalAlpha = Math.max(0.12, 1 - dist * 2.2) * (isActive ? 1 : 0.45);
    ctx.font = `${isActive ? 800 : 700} ${isActive ? 64 : 54}px system-ui, -apple-system, sans-serif`;
    if (isActive && style === 'neon') { ctx.shadowColor = a.accent; ctx.shadowBlur = 40; } else ctx.shadowBlur = 0;
    ctx.fillStyle = dark ? '#111' : '#fff';
    const parts = wrap(ctx, a.lines[i], STORY_W - 160, 1);
    ctx.fillText(parts[0] ?? '', STORY_W / 2, y);
  }
  ctx.restore();
  ctx.globalAlpha = 1;
  ctx.shadowBlur = 0;
}

/** Draws one animation frame at time t (seconds). */
export function drawStoryFrame(ctx: CanvasRenderingContext2D, a: StoryAssets, style: StoryStyle, t: number) {
  const dark = style === 'minimal';
  const fg = dark ? '#111' : '#fff';
  const sub = dark ? 'rgba(0,0,0,0.55)' : 'rgba(255,255,255,0.72)';
  drawBackground(ctx, a, style, t);

  const hasLyrics = a.lines.length > 0;
  const coverSize = hasLyrics ? 520 : 780;
  const coverY = hasLyrics ? 190 : 330;
  drawCover(ctx, a, style, t, coverSize, coverY);

  ctx.textAlign = 'center';
  ctx.textBaseline = 'alphabetic';
  let y = coverY + coverSize + 110;
  ctx.globalAlpha = ease((t - 0.2) / 0.8);
  ctx.fillStyle = fg;
  ctx.font = '800 66px system-ui, -apple-system, sans-serif';
  for (const l of wrap(ctx, a.title, STORY_W - 160, 2)) { ctx.fillText(l, STORY_W / 2, y); y += 78; }
  ctx.fillStyle = sub;
  ctx.font = '600 44px system-ui, -apple-system, sans-serif';
  ctx.fillText(wrap(ctx, a.artist, STORY_W - 160, 1)[0] ?? '', STORY_W / 2, y); y += 40;
  ctx.globalAlpha = 1;

  if (hasLyrics) drawLyrics(ctx, a, style, t, y + 30, STORY_H - 300);

  // Progress bar + equalizer bars
  const barY = STORY_H - 230;
  ctx.fillStyle = dark ? 'rgba(0,0,0,0.12)' : 'rgba(255,255,255,0.2)';
  roundRect(ctx, 140, barY, STORY_W - 280, 8, 4); ctx.fill();
  ctx.fillStyle = a.accent;
  roundRect(ctx, 140, barY, (STORY_W - 280) * ((t % STORY_SECONDS) / STORY_SECONDS), 8, 4); ctx.fill();

  if (a.mixLabel) {
    ctx.font = '600 34px system-ui, sans-serif';
    ctx.fillStyle = sub;
    ctx.fillText(a.mixLabel, STORY_W / 2, barY - 30);
  }
  ctx.font = '800 40px system-ui, sans-serif';
  ctx.fillStyle = fg;
  ctx.fillText('UniversFlow', STORY_W / 2, STORY_H - 140);
  ctx.font = '500 30px system-ui, sans-serif';
  ctx.fillStyle = sub;
  ctx.fillText(`Listen free · ${SITE}`, STORY_W / 2, STORY_H - 92);
}

function pickMime(): string | null {
  if (typeof MediaRecorder === 'undefined') return null;
  const opts = ['video/mp4;codecs=avc1', 'video/mp4', 'video/webm;codecs=vp9', 'video/webm;codecs=vp8', 'video/webm'];
  return opts.find((m) => MediaRecorder.isTypeSupported(m)) ?? null;
}

export function canRecordVideo(): boolean {
  return pickMime() !== null && typeof HTMLCanvasElement.prototype.captureStream === 'function';
}

/** Records the animated card to a video blob. Falls back to null if unsupported. */
export async function recordStoryVideo(a: StoryAssets, style: StoryStyle, onProgress?: (p: number) => void): Promise<Blob | null> {
  const mime = pickMime();
  if (!mime) return null;
  const canvas = document.createElement('canvas');
  canvas.width = STORY_W; canvas.height = STORY_H;
  const ctx = canvas.getContext('2d')!;
  drawStoryFrame(ctx, a, style, 0);
  const stream = canvas.captureStream(30);
  const rec = new MediaRecorder(stream, { mimeType: mime, videoBitsPerSecond: 6_000_000 });
  const chunks: Blob[] = [];
  rec.ondataavailable = (e) => { if (e.data.size) chunks.push(e.data); };
  const done = new Promise<void>((r) => { rec.onstop = () => r(); });
  rec.start(250);
  const start = performance.now();
  await new Promise<void>((resolve) => {
    const tick = () => {
      const t = (performance.now() - start) / 1000;
      drawStoryFrame(ctx, a, style, Math.min(t, STORY_SECONDS));
      onProgress?.(Math.min(1, t / STORY_SECONDS));
      if (t >= STORY_SECONDS) return resolve();
      requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
  });
  rec.stop();
  await done;
  stream.getTracks().forEach((tr) => tr.stop());
  return new Blob(chunks, { type: mime.split(';')[0] });
}

export function stillBlob(a: StoryAssets, style: StoryStyle): Promise<Blob | null> {
  const c = document.createElement('canvas');
  c.width = STORY_W; c.height = STORY_H;
  drawStoryFrame(c.getContext('2d')!, a, style, LINE_SECONDS * 0.5);
  return new Promise((res) => { try { c.toBlob((b) => res(b), 'image/png'); } catch { res(null); } });
}

async function blobToBase64(blob: Blob): Promise<string> {
  return new Promise((res, rej) => {
    const r = new FileReader();
    r.onload = () => res(String(r.result).split(',')[1] || '');
    r.onerror = rej;
    r.readAsDataURL(blob);
  });
}

/** Share a story file. On Android the system share sheet lists Instagram (Stories / Reels / DM). */
export async function shareStoryFile(blob: Blob, title: string, text: string): Promise<'shared' | 'downloaded'> {
  const ext = blob.type.includes('mp4') ? 'mp4' : blob.type.includes('webm') ? 'webm' : 'png';
  const name = `universflow-story-${Date.now()}.${ext}`;
  const { Capacitor } = await import('@capacitor/core');
  if (Capacitor.isNativePlatform()) {
    const [{ Filesystem, Directory }, { Share }] = await Promise.all([
      import('@capacitor/filesystem'), import('@capacitor/share'),
    ]);
    const { uri } = await Filesystem.writeFile({ path: name, data: await blobToBase64(blob), directory: Directory.Cache });
    await Share.share({ title, text, files: [uri], dialogTitle: 'Share to Instagram' });
    return 'shared';
  }
  const file = new File([blob], name, { type: blob.type });
  if (navigator.canShare?.({ files: [file] })) {
    await navigator.share({ files: [file], title, text });
    return 'shared';
  }
  const link = document.createElement('a');
  link.href = URL.createObjectURL(blob);
  link.download = name;
  link.click();
  setTimeout(() => URL.revokeObjectURL(link.href), 5000);
  return 'downloaded';
}
