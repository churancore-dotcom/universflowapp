// Static 1080x1920 "Now Spinning" share card (no animation, no video).
// Background tint is sampled from the cover so every card matches its song.
const W = 1080;
const H = 1920;

function loadImg(src: string): Promise<HTMLImageElement | null> {
  return new Promise((resolve) => {
    const img = new Image();
    img.crossOrigin = 'anonymous';
    img.onload = () => resolve(img);
    img.onerror = () => resolve(null);
    img.src = src;
  });
}

async function loadCover(url?: string): Promise<HTMLImageElement | null> {
  if (!url) return null;
  const hi = url.replace(/=w\d+-h\d+[^&]*/, '=w1200-h1200').replace(/\d{2,4}x\d{2,4}(bb)?/, '1200x1200bb');
  try {
    const res = await fetch(hi, { mode: 'cors' });
    if (res.ok) {
      const img = await loadImg(URL.createObjectURL(await res.blob()));
      if (img) return img;
    }
  } catch { /* fall through */ }
  return (await loadImg(hi)) || (hi !== url ? await loadImg(url) : null);
}

type RGB = [number, number, number];

function sampleTint(img: HTMLImageElement | null): RGB {
  const fallback: RGB = [104, 120, 196];
  if (!img) return fallback;
  try {
    const c = document.createElement('canvas');
    c.width = c.height = 24;
    const x = c.getContext('2d')!;
    x.drawImage(img, 0, 0, 24, 24);
    const d = x.getImageData(0, 0, 24, 24).data;
    let r = 0, g = 0, b = 0, n = 0;
    for (let i = 0; i < d.length; i += 4) {
      const mx = Math.max(d[i], d[i + 1], d[i + 2]), mn = Math.min(d[i], d[i + 1], d[i + 2]);
      const w = 1 + (mx - mn) / 32; // favour colourful pixels
      r += d[i] * w; g += d[i + 1] * w; b += d[i + 2] * w; n += w;
    }
    let t: RGB = [r / n, g / n, b / n];
    if (Math.max(...t) - Math.min(...t) < 18) return fallback; // grey cover -> reference blue
    // normalise brightness so the card is never muddy or washed out
    const l = (t[0] + t[1] + t[2]) / 3 || 1;
    t = t.map((v) => Math.min(235, (v / l) * 140)) as RGB;
    return t;
  } catch { return fallback; }
}

const rgba = (c: RGB, a: number, k = 1) => `rgba(${Math.round(c[0] * k)},${Math.round(c[1] * k)},${Math.round(c[2] * k)},${a})`;

function roundRect(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}

function wrap(ctx: CanvasRenderingContext2D, text: string, max: number, maxLines: number) {
  const words = text.split(/\s+/);
  const lines: string[] = [];
  let line = '';
  for (const w of words) {
    const t = line ? `${line} ${w}` : w;
    if (ctx.measureText(t).width > max && line) { lines.push(line); line = w; } else line = t;
  }
  if (line) lines.push(line);
  if (lines.length > maxLines) {
    lines.length = maxLines;
    let last = lines[maxLines - 1];
    while (ctx.measureText(`${last}…`).width > max && last.length) last = last.slice(0, -1);
    lines[maxLines - 1] = `${last}…`;
  }
  return lines;
}

export async function renderShareCard(song: { title: string; artist: string; cover_url?: string }): Promise<Blob> {
  try { await document.fonts?.load('48px "Bebas Neue"'); } catch { /* optional */ }
  const [cover, logo] = await Promise.all([loadCover(song.cover_url), loadImg('/app-logo.webp')]);
  const tint = sampleTint(cover);

  const canvas = document.createElement('canvas');
  canvas.width = W; canvas.height = H;
  const ctx = canvas.getContext('2d')!;
  const DISPLAY = '"Bebas Neue", "Barlow", sans-serif';

  // Background: cover-tinted vertical gradient + soft glows + vignette
  const bg = ctx.createLinearGradient(0, 0, 0, H);
  bg.addColorStop(0, rgba(tint, 1, 0.42));
  bg.addColorStop(0.45, rgba(tint, 1, 0.62));
  bg.addColorStop(1, rgba(tint, 1, 0.16));
  ctx.fillStyle = bg; ctx.fillRect(0, 0, W, H);
  for (const [x, y, r, a] of [[80, 760, 640, 0.45], [760, 1380, 620, 0.35], [540, 300, 560, 0.18]] as const) {
    const g = ctx.createRadialGradient(x, y, 0, x, y, r);
    g.addColorStop(0, rgba(tint, a)); g.addColorStop(1, rgba(tint, 0));
    ctx.fillStyle = g; ctx.fillRect(0, 0, W, H);
  }
  const vg = ctx.createRadialGradient(W / 2, H / 2, H * 0.3, W / 2, H / 2, H * 0.75);
  vg.addColorStop(0, 'rgba(0,0,0,0)'); vg.addColorStop(1, 'rgba(0,0,0,0.45)');
  ctx.fillStyle = vg; ctx.fillRect(0, 0, W, H);

  const light = rgba(tint, 1, 1.25);

  // Header
  ctx.textBaseline = 'alphabetic';
  ctx.font = `44px ${DISPLAY}`;
  ctx.fillStyle = '#f2f3f8'; ctx.fillText('UNIVERS', 72, 112);
  const uw = ctx.measureText('UNIVERS ').width;
  ctx.fillStyle = light; ctx.fillText('FLOW', 72 + uw, 112);
  ctx.font = `30px ${DISPLAY}`; ctx.fillStyle = 'rgba(255,255,255,0.7)'; ctx.textAlign = 'right';
  ctx.fillText('NOW SPINNING', W - 72, 112); ctx.textAlign = 'left';
  ctx.fillStyle = 'rgba(255,255,255,0.14)'; ctx.fillRect(72, 136, W - 144, 2);

  // Vinyl peeking out to the right
  const S = 760, CX = 160, CY = 230;
  const vx = CX + S + 30, vy = CY + S / 2, vr = 420;
  ctx.save();
  ctx.shadowColor = 'rgba(0,0,0,0.5)'; ctx.shadowBlur = 50;
  ctx.fillStyle = '#0c0c10'; ctx.beginPath(); ctx.arc(vx, vy, vr, 0, Math.PI * 2); ctx.fill();
  ctx.restore();
  ctx.strokeStyle = 'rgba(255,255,255,0.05)'; ctx.lineWidth = 2;
  for (let r = 140; r < vr; r += 14) { ctx.beginPath(); ctx.arc(vx, vy, r, 0, Math.PI * 2); ctx.stroke(); }
  ctx.fillStyle = light; ctx.beginPath(); ctx.arc(vx, vy, 92, 0, Math.PI * 2); ctx.fill();
  ctx.fillStyle = '#0c0c10'; ctx.beginPath(); ctx.arc(vx, vy, 13, 0, Math.PI * 2); ctx.fill();

  // Cover
  ctx.save();
  ctx.shadowColor = 'rgba(0,0,0,0.55)'; ctx.shadowBlur = 60; ctx.shadowOffsetY = 20;
  roundRect(ctx, CX, CY, S, S, 30); ctx.fillStyle = rgba(tint, 1, 0.5); ctx.fill();
  ctx.restore();
  ctx.save(); roundRect(ctx, CX, CY, S, S, 30); ctx.clip();
  if (cover) {
    const s = Math.min(cover.width, cover.height);
    ctx.drawImage(cover, (cover.width - s) / 2, (cover.height - s) / 2, s, s, CX, CY, S, S);
  }
  ctx.restore();

  // Waveform (deterministic per title)
  let seed = 0; for (const ch of song.title) seed = (seed * 31 + ch.charCodeAt(0)) >>> 0;
  const rand = () => ((seed = (seed * 1664525 + 1013904223) >>> 0) / 4294967296);
  const bars = 56, bx = 72, bw = W - 144, step = bw / bars, mid = 1105;
  for (let i = 0; i < bars; i++) {
    const p = i / (bars - 1), env = Math.sin(Math.PI * p);
    const h = Math.max(10, (10 + rand() * 60) * (0.25 + env));
    ctx.fillStyle = rgba(tint, 0.35 + env * 0.55, 1.15);
    roundRect(ctx, bx + i * step, mid - h / 2, Math.max(6, step * 0.5), h, 5); ctx.fill();
  }

  // Track label + title + artist
  ctx.font = `30px ${DISPLAY}`; ctx.fillStyle = light; ctx.fillText('▸ TRACK', 72, 1232);
  let size = 112; ctx.font = `700 ${size}px Georgia, "Times New Roman", serif`;
  let lines = wrap(ctx, song.title.toUpperCase(), W - 144, 3);
  if (lines.length === 3) { size = 92; ctx.font = `700 ${size}px Georgia, "Times New Roman", serif`; lines = wrap(ctx, song.title.toUpperCase(), W - 144, 3); }
  ctx.fillStyle = '#ffffff';
  ctx.shadowColor = 'rgba(0,0,0,0.3)'; ctx.shadowBlur = 16;
  let ty = 1335;
  for (const l of lines) { ctx.fillText(l, 72, ty); ty += size * 0.9; }
  ctx.shadowBlur = 0;
  const ay = ty - size * 0.9 + 85;
  ctx.font = `30px ${DISPLAY}`; ctx.fillStyle = 'rgba(255,255,255,0.6)'; ctx.fillText('BY', 72, ay);
  ctx.font = `52px ${DISPLAY}`; ctx.fillStyle = '#ffffff';
  ctx.fillText(wrap(ctx, song.artist.toUpperCase(), W - 260, 1)[0] ?? '', 122, ay + 2);

  // Footer left
  ctx.fillStyle = light; ctx.fillRect(72, 1778, 80, 5);
  ctx.font = `36px ${DISPLAY}`; ctx.fillStyle = '#f2f3f8'; ctx.fillText('STREAM FREE', 72, 1835);
  ctx.font = '500 25px "Barlow", sans-serif'; ctx.fillStyle = 'rgba(255,255,255,0.6)';
  ctx.fillText('universflow.in   ·   no ads   ·   lossless', 72, 1864);

  // Footer brand pill
  const pw = 400, ph = 84, px = W - 48 - pw, py = 1728;
  roundRect(ctx, px, py, pw, ph, 42); ctx.fillStyle = 'rgba(8,8,12,0.88)'; ctx.fill();
  ctx.strokeStyle = 'rgba(255,255,255,0.1)'; ctx.lineWidth = 2; ctx.stroke();
  const lcx = px + 54, lcy = py + ph / 2;
  ctx.save(); ctx.beginPath(); ctx.arc(lcx, lcy, 27, 0, Math.PI * 2); ctx.fillStyle = '#000'; ctx.fill(); ctx.clip();
  if (logo) ctx.drawImage(logo, lcx - 27, lcy - 27, 54, 54);
  ctx.restore();
  ctx.font = '700 32px "Barlow", sans-serif'; ctx.fillStyle = '#ffffff'; ctx.fillText('UniversFlow', px + 96, lcy + 11);
  const bwid = ctx.measureText('UniversFlow').width;
  ctx.font = '500 20px "Barlow", sans-serif'; ctx.fillStyle = 'rgba(255,255,255,0.7)';
  ctx.fillText('·  universflow.in', px + 96 + bwid + 14, lcy + 8);

  return new Promise((res, rej) => canvas.toBlob((b) => (b ? res(b) : rej(new Error('render'))), 'image/png'));
}
