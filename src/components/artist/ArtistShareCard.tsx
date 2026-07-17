import { useCallback, useEffect, useRef, useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { X, Download, Copy, Check, Share2, Square, RectangleVertical, Loader2 } from 'lucide-react';
import { toast } from 'sonner';
import type { ArtistProfile, ArtistSong } from '@/pages/artist/artistShared';
import { fmt } from '@/pages/artist/artistShared';

type Mode = 'story' | 'square';

interface Props {
  isOpen: boolean;
  onClose: () => void;
  profile: ArtistProfile;
  followers?: number;
  song?: ArtistSong | null; // if provided, renders a song-share card
}

const APP_URL = 'https://universflow.in';

async function loadImage(url: string): Promise<HTMLImageElement | null> {
  try {
    const img = new Image();
    img.crossOrigin = 'anonymous';
    await new Promise<void>((res, rej) => {
      img.onload = () => res();
      img.onerror = () => rej(new Error('img fail'));
      img.src = url;
    });
    return img;
  } catch { return null; }
}

function hexToRgb(hex: string) {
  const m = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(hex || '');
  return m ? { r: parseInt(m[1], 16), g: parseInt(m[2], 16), b: parseInt(m[3], 16) } : { r: 255, g: 45, b: 85 };
}

function drawRoundedRect(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}

export default function ArtistShareCard({ isOpen, onClose, profile, followers = 0, song }: Props) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [mode, setMode] = useState<Mode>('story');
  const [url, setUrl] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [copied, setCopied] = useState(false);

  const shareUrl = song
    ? `${APP_URL}/a/${profile.slug}?s=${encodeURIComponent(song.id)}`
    : `${APP_URL}/a/${profile.slug}`;

  const generate = useCallback(async () => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    setBusy(true);
    try {
      const W = mode === 'story' ? 1080 : 1080;
      const H = mode === 'story' ? 1920 : 1080;
      canvas.width = W;
      canvas.height = H;

      const accent = hexToRgb(profile.accent_color || '#FF2D55');
      const artUrl = song?.cover_url || profile.avatar_url || profile.banner_url;
      const art = artUrl ? await loadImage(artUrl) : null;

      // Background — obsidian base
      ctx.fillStyle = '#08080A';
      ctx.fillRect(0, 0, W, H);

      // Blurred artwork fill (drawn scaled up + blur)
      if (art) {
        ctx.save();
        ctx.filter = 'blur(80px) saturate(1.4) brightness(0.55)';
        const s = Math.max(W, H) * 1.25;
        const ax = (W - s) / 2;
        const ay = (H - s) / 2;
        ctx.drawImage(art, ax, ay, s, s);
        ctx.restore();
      }

      // Accent glow top-left
      const g1 = ctx.createRadialGradient(W * 0.15, H * 0.1, 0, W * 0.15, H * 0.1, W * 0.9);
      g1.addColorStop(0, `rgba(${accent.r},${accent.g},${accent.b},0.55)`);
      g1.addColorStop(1, 'rgba(0,0,0,0)');
      ctx.fillStyle = g1;
      ctx.fillRect(0, 0, W, H);

      // Bottom fade
      const g2 = ctx.createLinearGradient(0, H * 0.4, 0, H);
      g2.addColorStop(0, 'rgba(0,0,0,0)');
      g2.addColorStop(1, 'rgba(0,0,0,0.85)');
      ctx.fillStyle = g2;
      ctx.fillRect(0, 0, W, H);

      // Layout metrics
      const isStory = mode === 'story';
      const padX = 80;
      const artSize = isStory ? 720 : 520;
      const artX = (W - artSize) / 2;
      const artY = isStory ? 260 : 130;

      // Artwork card
      ctx.save();
      drawRoundedRect(ctx, artX, artY, artSize, artSize, 56);
      ctx.shadowColor = `rgba(${accent.r},${accent.g},${accent.b},0.6)`;
      ctx.shadowBlur = 80;
      ctx.shadowOffsetY = 30;
      ctx.fillStyle = '#0a0a0c';
      ctx.fill();
      ctx.restore();

      ctx.save();
      drawRoundedRect(ctx, artX, artY, artSize, artSize, 56);
      ctx.clip();
      if (art) {
        ctx.drawImage(art, artX, artY, artSize, artSize);
      } else {
        const g = ctx.createLinearGradient(artX, artY, artX + artSize, artY + artSize);
        g.addColorStop(0, `rgba(${accent.r},${accent.g},${accent.b},0.9)`);
        g.addColorStop(1, '#111');
        ctx.fillStyle = g;
        ctx.fillRect(artX, artY, artSize, artSize);
        ctx.fillStyle = 'rgba(255,255,255,0.95)';
        ctx.font = `800 ${artSize * 0.35}px "Inter", system-ui, sans-serif`;
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText(profile.stage_name.charAt(0).toUpperCase(), artX + artSize / 2, artY + artSize / 2);
      }
      ctx.restore();

      // Inner ring
      ctx.save();
      drawRoundedRect(ctx, artX, artY, artSize, artSize, 56);
      ctx.strokeStyle = 'rgba(255,255,255,0.12)';
      ctx.lineWidth = 2;
      ctx.stroke();
      ctx.restore();

      // Top brand chip
      ctx.save();
      const chipY = isStory ? 120 : 60;
      drawRoundedRect(ctx, padX, chipY, 380, 66, 33);
      ctx.fillStyle = 'rgba(0,0,0,0.55)';
      ctx.fill();
      ctx.strokeStyle = 'rgba(255,255,255,0.14)';
      ctx.lineWidth = 1;
      ctx.stroke();
      ctx.fillStyle = `rgb(${accent.r},${accent.g},${accent.b})`;
      ctx.beginPath();
      ctx.arc(padX + 40, chipY + 33, 10, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = 'rgba(255,255,255,0.95)';
      ctx.font = '600 22px "Inter", system-ui, sans-serif';
      ctx.textAlign = 'left';
      ctx.textBaseline = 'middle';
      ctx.fillText('UNIVERSFLOW · ARTIST', padX + 62, chipY + 34);
      ctx.restore();

      // Text block
      const textY = artY + artSize + (isStory ? 80 : 60);
      ctx.textAlign = 'left';
      ctx.textBaseline = 'top';

      // Small label
      ctx.fillStyle = `rgba(${accent.r},${accent.g},${accent.b},0.95)`;
      ctx.font = '700 22px "Inter", system-ui, sans-serif';
      ctx.fillText(song ? 'NOW STREAMING' : 'VERIFIED ARTIST', padX, textY);

      // Big title
      ctx.fillStyle = '#fff';
      const titleSize = isStory ? 78 : 62;
      ctx.font = `800 ${titleSize}px "Inter", system-ui, sans-serif`;
      const title = song ? song.title : profile.stage_name;
      // truncate long titles
      let displayTitle = title;
      const maxWidth = W - padX * 2;
      while (ctx.measureText(displayTitle).width > maxWidth && displayTitle.length > 4) {
        displayTitle = displayTitle.slice(0, -2);
      }
      if (displayTitle !== title) displayTitle = displayTitle + '…';
      ctx.fillText(displayTitle, padX, textY + 38);

      // Subtitle: stage name (for song) or tagline (for artist)
      ctx.fillStyle = 'rgba(255,255,255,0.75)';
      ctx.font = '500 30px "Inter", system-ui, sans-serif';
      const sub = song
        ? `by ${profile.stage_name}`
        : (profile.tagline || (profile.genres?.slice(0, 3).join(' · ') ?? 'New music, on Universflow'));
      let displaySub = sub;
      while (ctx.measureText(displaySub).width > maxWidth && displaySub.length > 4) {
        displaySub = displaySub.slice(0, -2);
      }
      if (displaySub !== sub) displaySub = displaySub + '…';
      ctx.fillText(displaySub, padX, textY + 38 + titleSize + 20);

      // Bottom row — CTA + handle
      const ctaY = H - (isStory ? 200 : 120);
      // Handle
      ctx.fillStyle = 'rgba(255,255,255,0.9)';
      ctx.font = '600 28px "Inter", system-ui, sans-serif';
      ctx.textAlign = 'left';
      ctx.fillText(`universflow.in/a/${profile.slug}`, padX, ctaY);

      // CTA pill
      ctx.save();
      const pillW = 260, pillH = 76;
      const pillX = W - padX - pillW;
      const pillY = ctaY - 22;
      const grad = ctx.createLinearGradient(pillX, pillY, pillX + pillW, pillY + pillH);
      grad.addColorStop(0, `rgb(${accent.r},${accent.g},${accent.b})`);
      grad.addColorStop(1, `rgba(${accent.r},${accent.g},${accent.b},0.7)`);
      drawRoundedRect(ctx, pillX, pillY, pillW, pillH, 38);
      ctx.shadowColor = `rgba(${accent.r},${accent.g},${accent.b},0.6)`;
      ctx.shadowBlur = 40;
      ctx.fillStyle = grad;
      ctx.fill();
      ctx.shadowBlur = 0;
      ctx.fillStyle = '#fff';
      ctx.font = '800 26px "Inter", system-ui, sans-serif';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText('LISTEN NOW ▸', pillX + pillW / 2, pillY + pillH / 2 + 1);
      ctx.restore();

      // Stats row (only on story, only for artist card)
      if (isStory && !song && followers > 0) {
        ctx.textAlign = 'left';
        ctx.textBaseline = 'top';
        ctx.fillStyle = 'rgba(255,255,255,0.55)';
        ctx.font = '500 22px "Inter", system-ui, sans-serif';
        ctx.fillText(`${fmt(followers)} followers`, padX, ctaY - 60);
      }

      // Song stats
      if (song) {
        ctx.textAlign = 'left';
        ctx.textBaseline = 'top';
        ctx.fillStyle = 'rgba(255,255,255,0.55)';
        ctx.font = '500 22px "Inter", system-ui, sans-serif';
        const bits = [`${fmt(song.play_count)} plays`, `${fmt(song.like_count)} likes`];
        ctx.fillText(bits.join('  ·  '), padX, ctaY - 60);
      }

      const dataUrl = canvas.toDataURL('image/png', 0.95);
      setUrl(dataUrl);
    } finally {
      setBusy(false);
    }
  }, [mode, profile, followers, song]);

  useEffect(() => {
    if (isOpen) {
      setUrl(null);
      generate();
    }
  }, [isOpen, generate]);

  const download = () => {
    if (!url) return;
    const a = document.createElement('a');
    a.href = url;
    a.download = `universflow-${profile.slug}${song ? '-' + song.title.slice(0, 20) : ''}-${mode}.png`;
    a.click();
    toast.success('Card saved');
  };

  const nativeShare = async () => {
    if (!url) return;
    try {
      const blob = await (await fetch(url)).blob();
      const file = new File([blob], 'universflow-card.png', { type: 'image/png' });
      const nav = navigator as Navigator & { canShare?: (data: ShareData) => boolean };
      if (nav.canShare && nav.canShare({ files: [file] })) {
        await navigator.share({
          files: [file],
          title: song ? `${song.title} — ${profile.stage_name}` : profile.stage_name,
          text: `Listen on Universflow: ${shareUrl}`,
          url: shareUrl,
        });
      } else {
        await navigator.clipboard.writeText(shareUrl);
        toast.success('Link copied — share it anywhere');
      }
    } catch { /* user cancelled */ }
  };

  const copyLink = async () => {
    await navigator.clipboard.writeText(shareUrl);
    setCopied(true);
    setTimeout(() => setCopied(false), 1600);
  };

  return (
    <AnimatePresence>
      {isOpen && (
        <motion.div
          className="fixed inset-0 z-[100] flex items-end sm:items-center justify-center"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
        >
          <motion.div
            className="absolute inset-0 bg-black/80 backdrop-blur-xl"
            onClick={onClose}
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
          />
          <motion.div
            initial={{ y: 40, opacity: 0, scale: 0.98 }}
            animate={{ y: 0, opacity: 1, scale: 1 }}
            exit={{ y: 40, opacity: 0, scale: 0.98 }}
            transition={{ type: 'spring', stiffness: 320, damping: 32 }}
            className="relative w-full max-w-md rounded-t-[32px] sm:rounded-[32px] p-5 pb-8"
            style={{
              background: 'linear-gradient(180deg, rgba(20,20,24,0.95), rgba(10,10,12,0.98))',
              border: '0.5px solid rgba(255,255,255,0.08)',
              boxShadow: '0 40px 100px rgba(0,0,0,0.6)',
            }}
          >
            <div className="flex items-center justify-between mb-4">
              <div>
                <p className="text-[10px] uppercase tracking-[0.22em] text-muted-foreground/70 font-semibold">
                  Share card
                </p>
                <h3 className="font-display text-[18px] mt-0.5 tracking-tight">
                  {song ? song.title : profile.stage_name}
                </h3>
              </div>
              <button
                onClick={onClose}
                className="w-9 h-9 rounded-full bg-white/[0.06] hover:bg-white/[0.1] grid place-items-center transition"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            {/* Mode toggle */}
            <div className="relative grid grid-cols-2 p-1 rounded-full mb-4 bg-white/[0.04] border border-white/[0.06]">
              <motion.div
                layout
                transition={{ type: 'spring', stiffness: 420, damping: 34 }}
                className="absolute top-1 bottom-1 rounded-full"
                style={{
                  width: 'calc(50% - 4px)',
                  left: mode === 'story' ? 4 : 'calc(50%)',
                  background: `linear-gradient(180deg, ${profile.accent_color || '#FF3B5C'}, rgba(0,0,0,0.2))`,
                  boxShadow: `0 6px 18px ${profile.accent_color || '#FF2D55'}55`,
                }}
              />
              <button
                onClick={() => setMode('story')}
                className="relative z-10 h-9 text-[12px] font-semibold inline-flex items-center justify-center gap-1.5"
                style={{ color: mode === 'story' ? '#fff' : 'hsl(var(--muted-foreground))' }}
              >
                <RectangleVertical className="w-3.5 h-3.5" /> Story 9:16
              </button>
              <button
                onClick={() => setMode('square')}
                className="relative z-10 h-9 text-[12px] font-semibold inline-flex items-center justify-center gap-1.5"
                style={{ color: mode === 'square' ? '#fff' : 'hsl(var(--muted-foreground))' }}
              >
                <Square className="w-3.5 h-3.5" /> Square 1:1
              </button>
            </div>

            {/* Preview */}
            <div
              className="relative w-full rounded-2xl overflow-hidden bg-black/60 grid place-items-center"
              style={{ aspectRatio: mode === 'story' ? '9 / 16' : '1 / 1' }}
            >
              <AnimatePresence mode="wait">
                {busy || !url ? (
                  <motion.div
                    key="load"
                    initial={{ opacity: 0 }}
                    animate={{ opacity: 1 }}
                    exit={{ opacity: 0 }}
                    className="flex flex-col items-center gap-2 text-muted-foreground"
                  >
                    <Loader2 className="w-5 h-5 animate-spin" />
                    <span className="text-[11px]">Composing…</span>
                  </motion.div>
                ) : (
                  <motion.img
                    key={url}
                    src={url}
                    alt="Share preview"
                    className="w-full h-full object-cover"
                    initial={{ opacity: 0, scale: 1.02 }}
                    animate={{ opacity: 1, scale: 1 }}
                    exit={{ opacity: 0 }}
                    transition={{ duration: 0.35, ease: [0.22, 1, 0.36, 1] }}
                  />
                )}
              </AnimatePresence>
            </div>

            {/* Actions */}
            <div className="grid grid-cols-3 gap-2 mt-4">
              <button
                onClick={nativeShare}
                disabled={!url}
                className="h-12 rounded-2xl font-semibold text-[12.5px] inline-flex items-center justify-center gap-1.5 text-white disabled:opacity-40 active:scale-[0.97] transition"
                style={{
                  background: `linear-gradient(135deg, ${profile.accent_color || '#FF2D55'}, rgba(0,0,0,0.15))`,
                  boxShadow: `0 12px 30px -10px ${profile.accent_color || '#FF2D55'}80`,
                }}
              >
                <Share2 className="w-4 h-4" /> Share
              </button>
              <button
                onClick={download}
                disabled={!url}
                className="h-12 rounded-2xl font-semibold text-[12.5px] bg-white/[0.06] hover:bg-white/[0.1] border border-white/[0.06] inline-flex items-center justify-center gap-1.5 disabled:opacity-40 active:scale-[0.97] transition"
              >
                <Download className="w-4 h-4" /> Save
              </button>
              <button
                onClick={copyLink}
                className="h-12 rounded-2xl font-semibold text-[12.5px] bg-white/[0.06] hover:bg-white/[0.1] border border-white/[0.06] inline-flex items-center justify-center gap-1.5 active:scale-[0.97] transition"
              >
                {copied ? <Check className="w-4 h-4 text-emerald-400" /> : <Copy className="w-4 h-4" />}
                {copied ? 'Copied' : 'Link'}
              </button>
            </div>

            <p className="mt-3 text-center text-[10.5px] text-muted-foreground/60">
              High-res 1080px · Ready for Instagram, WhatsApp, Snap & X
            </p>

            <canvas ref={canvasRef} className="hidden" />
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
