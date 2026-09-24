// Artwork URL normalisation.
//
// Why this exists: YouTube's `default.jpg`, `hqdefault.jpg` and `sddefault.jpg`
// thumbnails are 4:3 canvases with the real 16:9 frame letterboxed inside them —
// the black bars are baked into the pixels. Rendering those in a square card
// with `object-cover` shows the bars (or crops the subject out), which is the
// "artwork doesn't fit the card" bug. `maxresdefault` / `hq720` / `mqdefault`
// are bar-free, so we always prefer those and never "upgrade" to a bar variant.

const LETTERBOXED = /\/(default|hqdefault|sddefault)\.jpg/i;

/** Ordered, bar-free candidates for one artwork URL (best quality first). */
export function artworkCandidates(url?: string | null, size = 320): string[] {
  const src = (url || '').trim();
  if (!src) return [];

  if (src.includes('googleusercontent.com')) {
    // Square by definition — just ask for a crop that matches the rendered box.
    const dpr = typeof window !== 'undefined' ? Math.min(3, Math.max(1, window.devicePixelRatio || 1)) : 2;
    const px = Math.max(240, Math.min(720, Math.round(size * dpr)));
    return [src.replace(/=w\d+-h\d+[^&]*/i, `=w${px}-h${px}-l90-rj`), src];
  }

  const yt = src.match(/i\.ytimg\.com\/vi\/([A-Za-z0-9_-]{11})\//);
  if (yt) {
    const id = yt[1];
    return [
      `https://i.ytimg.com/vi/${id}/maxresdefault.jpg`,
      `https://i.ytimg.com/vi/${id}/hq720.jpg`,
      `https://i.ytimg.com/vi/${id}/mqdefault.jpg`,
      `https://i.ytimg.com/vi/${id}/hqdefault.jpg`,
      src,
    ];
  }

  // JioSaavn ships tiny 50x50 / 150x150 thumbs by default — upscaling those is
  // the blurry-cover look. The same image exists at 500x500 on its CDN.
  if (/saavncdn\.com|jiosaavn/i.test(src) && /-\d{2,3}x\d{2,3}\.(jpe?g|png|webp)/i.test(src)) {
    return [src.replace(/-\d{2,3}x\d{2,3}\.(jpe?g|png|webp)/i, '-500x500.$1'), src];
  }

  // Apple / iTunes artwork: ask for a sharp size instead of the 100x100 default.
  if (/mzstatic\.com/i.test(src) && /\/\d{2,4}x\d{2,4}(bb)?\.(jpe?g|png|webp)$/i.test(src)) {
    return [src.replace(/\/\d{2,4}x\d{2,4}(bb)?\.(jpe?g|png|webp)$/i, '/600x600bb.jpg'), src];
  }

  // Unknown host: keep the URL, but never a letterboxed YouTube variant.
  return LETTERBOXED.test(src) ? [src.replace(LETTERBOXED, '/mqdefault.jpg'), src] : [src];
}
