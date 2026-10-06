// Static 1080x1920 "Now Spinning" share card rendered on a canvas (no video, no animation).
const W = 1080;
const H = 1920;
const ACCENT = '#a98bd6';

async function loadCover(url?: string): Promise<HTMLImageElement | null> {
  if (!url) return null;
  const hi = url.replace(/=w\d+-h\d+[^&]*/, '=w1200-h1200').replace(/\d{2,4}x\d{2,4}(bb)?/, '1200x1200bb');
  const tryLoad = (src: string) =>
    new Promise<HTMLImageElement | null>((resolve) => {
      const img = new Image();
      img.crossOrigin = 'anonymous';
      img.onload = () => resolve(img);
      img.onerror = () => resolve(null);
      img.src = src;
    });
  try {
    const res = await fetch(hi, { mode: 'cors' });
    if (res.ok) {
      const obj = URL.createObjectURL(await res.blob());
      const img = await tryLoad(obj);
      if (img) return img;
    }
  } catch { /* fall through */ }
  return (await tryLoad(hi)) || (hi !== url ? await tryLoad(url) : null);
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
  const canvas = document.createElement('canvas');
  canvas.width = W; canvas.height = H;
  const ctx = canvas.getContext('2d')!;

  // Background
  const bg = ctx.createLinearGradient(0, 0, W, H);
  bg.addColorStop(0, '#1d1a2b'); bg.addColorStop(0.5, '#2e2340'); bg.addColorStop(1, '#16131f');
  ctx.fillStyle = bg; ctx.fillRect(0, 0, W, H);
  for (const [x, y, r, c] of [[0, 700, 700, 'rgba(150,80,170,0.35)'], [300, 1550, 600, 'rgba(160,60,130,0.3)'], [1080, 1300, 600, 'rgba(70,80,150,0.3)']] as const) {
    const g = ctx.createRadialGradient(x, y, 0, x, y, r);
    g.addColorStop(0, c); g.addColorStop(1, 'rgba(0,0,0,0)');
    ctx.fillStyle = g; ctx.fillRect(0, 0, W, H);
  }

  const label = (t: string, x: number, y: number, size: number, color: string, align: CanvasTextAlign = 'left') => {
    ctx.font = `${size}px "Bebas Neue", Impact, sans-serif`;
    ctx.fillStyle = color; ctx.textAlign = align;
    ctx.fillText(t, x, y);
  };

  // Header
  label('UNIVERS', 72, 112, 40, '#ffffff');
  const uw = ctx.measureText('UNIVERS ').width;
  label('FLOW', 72 + uw, 112, 40, ACCENT);
  label('NOW SPINNING', 1008, 112, 30, 'rgba(255,255,255,0.65)', 'right');
  ctx.fillStyle = 'rgba(255,255,255,0.12)'; ctx.fillRect(72, 136, 936, 2);

  // Vinyl
  const vx = 950, vy = 610, vr = 420;
  ctx.fillStyle = '#0d0c12'; ctx.beginPath(); ctx.arc(vx, vy, vr, 0, Math.PI * 2); ctx.fill();
  ctx.strokeStyle = 'rgba(255,255,255,0.05)'; ctx.lineWidth = 2;
  for (let r = 140; r < vr; r += 14) { ctx.beginPath(); ctx.arc(vx, vy, r, 0, Math.PI * 2); ctx.stroke(); }
  ctx.fillStyle = ACCENT; ctx.beginPath(); ctx.arc(vx, vy, 90, 0, Math.PI * 2); ctx.fill();
  ctx.fillStyle = '#0d0c12'; ctx.beginPath(); ctx.arc(vx, vy, 12, 0, Math.PI * 2); ctx.fill();

  // Cover
  const cx = 162, cy = 232, cs = 756;
  ctx.save();
  ctx.shadowColor = 'rgba(0,0,0,0.55)'; ctx.shadowBlur = 60; ctx.shadowOffsetY = 20;
  roundRect(ctx, cx, cy, cs, cs, 28); ctx.fillStyle = '#2a2438'; ctx.fill();
  ctx.restore();
  const img = await loadCover(song.cover_url);
  if (img) {
    ctx.save(); roundRect(ctx, cx, cy, cs, cs, 28); ctx.clip();
    const s = Math.max(cs / img.width, cs / img.height);
    ctx.drawImage(img, cx + (cs - img.width * s) / 2, cy + (cs - img.height * s) / 2, img.width * s, img.height * s);
    ctx.restore();
  }
  ctx.strokeStyle = 'rgba(255,255,255,0.12)'; ctx.lineWidth = 2; roundRect(ctx, cx, cy, cs, cs, 28); ctx.stroke();

  // Waveform
  const bars = 60, gap = 936 / bars;
  ctx.fillStyle = ACCENT;
  for (let i = 0; i < bars; i++) {
    const t = i / (bars - 1);
    const env = Math.sin(t * Math.PI);
    const h = 10 + env * (30 + 30 * Math.abs(Math.sin(i * 1.7) * Math.cos(i * 0.6)));
    ctx.globalAlpha = 0.55 + env * 0.45;
    roundRect(ctx, 72 + i * gap + gap / 2 - 5, 1105 - h / 2, 10, h, 5); ctx.fill();
  }
  ctx.globalAlpha = 1;

  // Track text
  label('▸ TRACK', 72, 1232, 30, ACCENT);
  ctx.font = 'bold 104px Georgia, "Noto Serif", serif'; ctx.fillStyle = '#ffffff'; ctx.textAlign = 'left';
  const lines = wrap(ctx, song.title, 936, 3);
  lines.forEach((l, i) => ctx.fillText(l, 72, 1340 + i * 104));
  const by = 1340 + lines.length * 104 - 10;
  label('BY', 72, by, 30, 'rgba(255,255,255,0.55)');
  ctx.font = '50px "Bebas Neue", Impact, sans-serif';
  const artist = wrap(ctx, song.artist.toUpperCase(), 830, 1)[0];
  label(artist, 122, by + 4, 50, '#ffffff');

  // Footer
  ctx.fillStyle = ACCENT; ctx.fillRect(72, 1778, 80, 5);
  label('STREAM FREE', 72, 1832, 34, '#ffffff');
  ctx.font = '22px Barlow, sans-serif'; ctx.fillStyle = 'rgba(255,255,255,0.5)';
  ctx.fillText('universflow.in  ·  music for everyone', 72, 1862);

  // Badge pill
  roundRect(ctx, 684, 1728, 348, 84, 42); ctx.fillStyle = 'rgba(10,9,14,0.92)'; ctx.fill();
  ctx.strokeStyle = 'rgba(255,255,255,0.12)'; ctx.stroke();
  ctx.fillStyle = '#000'; ctx.beginPath(); ctx.arc(738, 1770, 28, 0, Math.PI * 2); ctx.fill();
  ctx.strokeStyle = '#fff'; ctx.lineWidth = 4; ctx.beginPath(); ctx.arc(738, 1772, 14, 0.15 * Math.PI, 0.85 * Math.PI + Math.PI * 0.0, false); ctx.stroke();
  ctx.beginPath(); ctx.arc(738, 1772, 14, Math.PI * 1.1, Math.PI * 1.9 + Math.PI * 1.0, false); ctx.stroke();
  ctx.font = 'bold 30px Barlow, sans-serif'; ctx.fillStyle = '#fff'; ctx.textAlign = 'left';
  ctx.fillText('UniversFlow', 780, 1781);

  return new Promise((resolve, reject) => {
    try {
      canvas.toBlob((b) => (b ? resolve(b) : reject(new Error('render failed'))), 'image/png');
    } catch (e) { reject(e); }
  });
}
