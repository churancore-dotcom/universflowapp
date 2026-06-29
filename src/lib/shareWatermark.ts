// Universal watermark stamped onto every shareable card across the app.
// Renders a compact glassy pill: [logo] UniversFlow • universflow.in
// Position defaults to bottom-right with a safe margin so it never collides
// with bottom CTAs.

import appLogo from '@/assets/app-logo.webp';

let logoPromise: Promise<HTMLImageElement | null> | null = null;

function loadLogo(): Promise<HTMLImageElement | null> {
  if (logoPromise) return logoPromise;
  logoPromise = new Promise((resolve) => {
    const img = new Image();
    img.crossOrigin = 'anonymous';
    img.decoding = 'async';
    img.onload = () => resolve(img);
    img.onerror = () => resolve(null);
    img.src = appLogo as unknown as string;
  });
  return logoPromise;
}

function roundedRect(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  w: number,
  h: number,
  r: number,
) {
  const rr = Math.min(r, h / 2, w / 2);
  ctx.beginPath();
  ctx.moveTo(x + rr, y);
  ctx.arcTo(x + w, y, x + w, y + h, rr);
  ctx.arcTo(x + w, y + h, x, y + h, rr);
  ctx.arcTo(x, y + h, x, y, rr);
  ctx.arcTo(x, y, x + w, y, rr);
  ctx.closePath();
}

export type WatermarkOptions = {
  /** Where to anchor the watermark. Defaults to 'bottom-right'. */
  position?: 'bottom-right' | 'bottom-left' | 'top-right' | 'top-left';
  /** Scale multiplier (1 = auto-scaled to canvas). */
  scale?: number;
  /** Override safe-area inset from the canvas edge in px. */
  margin?: number;
  /** Lighter palette for dark canvases (default) or darker for light ones. */
  theme?: 'light' | 'dark';
};

/**
 * Stamp the Univers Flow watermark onto a canvas. Idempotent — call once at
 * the very end of a card render, after all artwork/CTA layers are painted.
 */
export async function drawUniversFlowWatermark(
  ctx: CanvasRenderingContext2D,
  width: number,
  height: number,
  opts: WatermarkOptions = {},
): Promise<void> {
  const { position = 'bottom-right', theme = 'light' } = opts;
  // Scale relative to the canvas long-edge so the pill reads similar size on
  // both 1080x1920 stories and 1200x630 OG cards.
  const base = Math.max(width, height);
  const scale = (opts.scale ?? 1) * (base / 1920);
  const margin = opts.margin ?? Math.round(48 * scale);

  const logo = await loadLogo();

  const padX = 28 * scale;
  const padY = 16 * scale;
  const logoSize = 56 * scale;
  const gap = 16 * scale;
  const titleSize = 30 * scale;
  const subSize = 18 * scale;
  const sepGap = 12 * scale;

  const title = 'UniversFlow';
  const sub = 'universflow.in';

  ctx.save();
  ctx.textBaseline = 'middle';
  ctx.font = `800 ${titleSize}px ui-sans-serif, system-ui, -apple-system, sans-serif`;
  const titleW = ctx.measureText(title).width;
  ctx.font = `600 ${subSize}px ui-sans-serif, system-ui, -apple-system, sans-serif`;
  const subW = ctx.measureText(sub).width;
  const dotW = ctx.measureText(' • ').width;

  const contentW = (logo ? logoSize + gap : 0) + titleW + sepGap + dotW + subW;
  const pillW = contentW + padX * 2;
  const pillH = Math.max(logoSize, titleSize) + padY * 2;

  let x = margin;
  let y = margin;
  if (position === 'bottom-right') { x = width - margin - pillW; y = height - margin - pillH; }
  else if (position === 'bottom-left') { x = margin; y = height - margin - pillH; }
  else if (position === 'top-right') { x = width - margin - pillW; y = margin; }

  // Glassy pill background
  const isLight = theme === 'light';
  ctx.shadowColor = isLight ? 'rgba(0,0,0,0.35)' : 'rgba(0,0,0,0.18)';
  ctx.shadowBlur = 24 * scale;
  ctx.shadowOffsetY = 6 * scale;
  roundedRect(ctx, x, y, pillW, pillH, pillH / 2);
  ctx.fillStyle = isLight ? 'rgba(0,0,0,0.55)' : 'rgba(255,255,255,0.92)';
  ctx.fill();
  ctx.shadowColor = 'transparent';
  ctx.shadowBlur = 0;
  ctx.shadowOffsetY = 0;

  // Hairline border for the glass edge
  roundedRect(ctx, x + 0.5, y + 0.5, pillW - 1, pillH - 1, pillH / 2);
  ctx.lineWidth = Math.max(1, 1.5 * scale);
  ctx.strokeStyle = isLight ? 'rgba(255,255,255,0.18)' : 'rgba(0,0,0,0.08)';
  ctx.stroke();

  let cursorX = x + padX;
  const midY = y + pillH / 2;

  if (logo) {
    // Round-clipped logo so non-square art still reads as a brand mark
    ctx.save();
    const lx = cursorX;
    const ly = midY - logoSize / 2;
    roundedRect(ctx, lx, ly, logoSize, logoSize, logoSize / 2);
    ctx.clip();
    // White wash behind logo for contrast on either theme
    ctx.fillStyle = isLight ? '#fff' : '#0b0b0f';
    ctx.fillRect(lx, ly, logoSize, logoSize);
    ctx.drawImage(logo, lx, ly, logoSize, logoSize);
    ctx.restore();
    cursorX += logoSize + gap;
  }

  // Wordmark
  ctx.fillStyle = isLight ? '#ffffff' : '#0b0b0f';
  ctx.font = `800 ${titleSize}px ui-sans-serif, system-ui, -apple-system, sans-serif`;
  ctx.fillText(title, cursorX, midY + 1);
  cursorX += titleW;

  // Separator dot
  ctx.fillStyle = isLight ? 'rgba(255,255,255,0.55)' : 'rgba(0,0,0,0.45)';
  ctx.font = `600 ${subSize}px ui-sans-serif, system-ui, -apple-system, sans-serif`;
  ctx.fillText(' • ', cursorX + sepGap / 2, midY + 1);
  cursorX += sepGap + dotW;

  // Domain
  ctx.fillStyle = isLight ? 'rgba(255,255,255,0.78)' : 'rgba(0,0,0,0.65)';
  ctx.fillText(sub, cursorX, midY + 1);

  ctx.restore();
}
