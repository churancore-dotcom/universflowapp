// Song Stories — renders a 9:16 shareable story card (lyric + song + mix) on a canvas.
import { upgradeArtworkUrl } from '@/lib/artworkUrl';

export interface StoryInput {
  title: string;
  artist: string;
  coverUrl?: string;
  lyric?: string;
  mixLabel?: string; // e.g. "🎤 Karaoke mix"
  accent: string;    // css color
}

export const STORY_W = 1080;
export const STORY_H = 1920;
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

function wrap(ctx: CanvasRenderingContext2D, text: string, maxW: number, maxLines: number): string[] {
  const words = text.split(/\s+/).filter(Boolean);
  const lines: string[] = [];
  let line = '';
  for (const w of words) {
    const test = line ? `${line} ${w}` : w;
    if (ctx.measureText(test).width > maxW && line) {
      lines.push(line);
      line = w;
      if (lines.length === maxLines) break;
    } else line = test;
  }
  if (lines.length < maxLines && line) lines.push(line);
  if (lines.length === maxLines && words.join(' ').length > lines.join(' ').length) {
    lines[maxLines - 1] = lines[maxLines - 1].replace(/\s*\S*$/, '') + '…';
  }
  return lines;
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

/** Draws the story; returns the canvas. Cover failures degrade to a gradient. */
export async function renderStory(canvas: HTMLCanvasElement, s: StoryInput): Promise<HTMLCanvasElement> {
  canvas.width = STORY_W;
  canvas.height = STORY_H;
  const ctx = canvas.getContext('2d')!;
  const cover = s.coverUrl ? await loadImage(upgradeArtworkUrl(s.coverUrl, 600)) : null;

  // Background: blurred cover or accent gradient.
  ctx.fillStyle = '#0b0b0f';
  ctx.fillRect(0, 0, STORY_W, STORY_H);
  if (cover) {
    ctx.save();
    ctx.filter = 'blur(60px) saturate(1.4)';
    ctx.drawImage(cover, -300, -300, STORY_W + 600, STORY_H + 600);
    ctx.restore();
  } else {
    const g = ctx.createLinearGradient(0, 0, STORY_W, STORY_H);
    g.addColorStop(0, s.accent);
    g.addColorStop(1, '#0b0b0f');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, STORY_W, STORY_H);
  }
  const shade = ctx.createLinearGradient(0, 0, 0, STORY_H);
  shade.addColorStop(0, 'rgba(0,0,0,0.25)');
  shade.addColorStop(0.55, 'rgba(0,0,0,0.45)');
  shade.addColorStop(1, 'rgba(0,0,0,0.85)');
  ctx.fillStyle = shade;
  ctx.fillRect(0, 0, STORY_W, STORY_H);

  // Cover art.
  const size = 640, cx = (STORY_W - size) / 2, cy = 230;
  ctx.save();
  ctx.shadowColor = 'rgba(0,0,0,0.55)';
  ctx.shadowBlur = 80;
  ctx.shadowOffsetY = 30;
  roundRect(ctx, cx, cy, size, size, 44);
  ctx.fillStyle = '#1a1a22';
  ctx.fill();
  ctx.restore();
  if (cover) {
    ctx.save();
    roundRect(ctx, cx, cy, size, size, 44);
    ctx.clip();
    ctx.drawImage(cover, cx, cy, size, size);
    ctx.restore();
  }

  const font = '"SF Pro Display", -apple-system, system-ui, sans-serif';
  ctx.textAlign = 'center';
  ctx.fillStyle = '#ffffff';

  // Title + artist.
  ctx.font = `700 64px ${font}`;
  const titleLines = wrap(ctx, s.title, 900, 2);
  let y = cy + size + 120;
  titleLines.forEach((l) => { ctx.fillText(l, STORY_W / 2, y); y += 76; });
  ctx.font = `500 42px ${font}`;
  ctx.fillStyle = 'rgba(255,255,255,0.72)';
  ctx.fillText(wrap(ctx, s.artist, 900, 1)[0] || '', STORY_W / 2, y + 4);
  y += 120;

  // Lyric line.
  if (s.lyric) {
    ctx.fillStyle = s.accent;
    ctx.fillRect(STORY_W / 2 - 40, y - 40, 80, 6);
    ctx.font = `800 70px ${font}`;
    ctx.fillStyle = '#ffffff';
    const lines = wrap(ctx, `“${s.lyric}”`, 920, 4);
    y += 50;
    lines.forEach((l) => { ctx.fillText(l, STORY_W / 2, y); y += 88; });
  }

  // Mix chip.
  if (s.mixLabel) {
    ctx.font = `600 36px ${font}`;
    const w = ctx.measureText(s.mixLabel).width + 72;
    const top = Math.min(y + 30, STORY_H - 330);
    roundRect(ctx, (STORY_W - w) / 2, top, w, 72, 36);
    ctx.fillStyle = 'rgba(255,255,255,0.14)';
    ctx.fill();
    ctx.fillStyle = '#ffffff';
    ctx.fillText(s.mixLabel, STORY_W / 2, top + 48);
  }

  // Footer brand.
  ctx.font = `700 40px ${font}`;
  ctx.fillStyle = s.accent;
  ctx.fillText('UniversFlow', STORY_W / 2, STORY_H - 150);
  ctx.font = `500 32px ${font}`;
  ctx.fillStyle = 'rgba(255,255,255,0.6)';
  ctx.fillText(`Listen free · ${SITE}`, STORY_W / 2, STORY_H - 100);
  return canvas;
}

export function storyBlob(canvas: HTMLCanvasElement): Promise<Blob | null> {
  return new Promise((resolve) => {
    try { canvas.toBlob((b) => resolve(b), 'image/png'); } catch { resolve(null); }
  });
}
