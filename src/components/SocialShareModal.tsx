import { useCallback, useState, useRef, useEffect } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { X, Download, Copy, Check, Link2 } from 'lucide-react';
import { Song } from '@/contexts/PlayerContext';
import { toast } from 'sonner';
import { iosSpring, iosBounce } from '@/lib/animations';
import { drawUniversFlowWatermark } from '@/lib/shareWatermark';

// Social platform icons as SVG components
const InstagramIcon = () => (
  <svg viewBox="0 0 24 24" className="w-6 h-6" fill="currentColor">
    <path d="M12 2.163c3.204 0 3.584.012 4.85.07 3.252.148 4.771 1.691 4.919 4.919.058 1.265.069 1.645.069 4.849 0 3.205-.012 3.584-.069 4.849-.149 3.225-1.664 4.771-4.919 4.919-1.266.058-1.644.07-4.85.07-3.204 0-3.584-.012-4.849-.07-3.26-.149-4.771-1.699-4.919-4.92-.058-1.265-.07-1.644-.07-4.849 0-3.204.013-3.583.07-4.849.149-3.227 1.664-4.771 4.919-4.919 1.266-.057 1.645-.069 4.849-.069zm0-2.163c-3.259 0-3.667.014-4.947.072-4.358.2-6.78 2.618-6.98 6.98-.059 1.281-.073 1.689-.073 4.948 0 3.259.014 3.668.072 4.948.2 4.358 2.618 6.78 6.98 6.98 1.281.058 1.689.072 4.948.072 3.259 0 3.668-.014 4.948-.072 4.354-.2 6.782-2.618 6.979-6.98.059-1.28.073-1.689.073-4.948 0-3.259-.014-3.667-.072-4.947-.196-4.354-2.617-6.78-6.979-6.98-1.281-.059-1.69-.073-4.949-.073zm0 5.838c-3.403 0-6.162 2.759-6.162 6.162s2.759 6.163 6.162 6.163 6.162-2.759 6.162-6.163c0-3.403-2.759-6.162-6.162-6.162zm0 10.162c-2.209 0-4-1.79-4-4 0-2.209 1.791-4 4-4s4 1.791 4 4c0 2.21-1.791 4-4 4zm6.406-11.845c-.796 0-1.441.645-1.441 1.44s.645 1.44 1.441 1.44c.795 0 1.439-.645 1.439-1.44s-.644-1.44-1.439-1.44z"/>
  </svg>
);

const WhatsAppIcon = () => (
  <svg viewBox="0 0 24 24" className="w-6 h-6" fill="currentColor">
    <path d="M17.472 14.382c-.297-.149-1.758-.867-2.03-.967-.273-.099-.471-.148-.67.15-.197.297-.767.966-.94 1.164-.173.199-.347.223-.644.075-.297-.15-1.255-.463-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.298-.347.446-.52.149-.174.198-.298.298-.497.099-.198.05-.371-.025-.52-.075-.149-.669-1.612-.916-2.207-.242-.579-.487-.5-.669-.51-.173-.008-.371-.01-.57-.01-.198 0-.52.074-.792.372-.272.297-1.04 1.016-1.04 2.479 0 1.462 1.065 2.875 1.213 3.074.149.198 2.096 3.2 5.077 4.487.709.306 1.262.489 1.694.625.712.227 1.36.195 1.871.118.571-.085 1.758-.719 2.006-1.413.248-.694.248-1.289.173-1.413-.074-.124-.272-.198-.57-.347m-5.421 7.403h-.004a9.87 9.87 0 01-5.031-1.378l-.361-.214-3.741.982.998-3.648-.235-.374a9.86 9.86 0 01-1.51-5.26c.001-5.45 4.436-9.884 9.888-9.884 2.64 0 5.122 1.03 6.988 2.898a9.825 9.825 0 012.893 6.994c-.003 5.45-4.437 9.884-9.885 9.884m8.413-18.297A11.815 11.815 0 0012.05 0C5.495 0 .16 5.335.157 11.892c0 2.096.547 4.142 1.588 5.945L.057 24l6.305-1.654a11.882 11.882 0 005.683 1.448h.005c6.554 0 11.89-5.335 11.893-11.893a11.821 11.821 0 00-3.48-8.413z"/>
  </svg>
);

const TwitterIcon = () => (
  <svg viewBox="0 0 24 24" className="w-6 h-6" fill="currentColor">
    <path d="M18.244 2.25h3.308l-7.227 8.26 8.502 11.24H16.17l-5.214-6.817L4.99 21.75H1.68l7.73-8.835L1.254 2.25H8.08l4.713 6.231zm-1.161 17.52h1.833L7.084 4.126H5.117z"/>
  </svg>
);

interface SocialShareModalProps {
  isOpen: boolean;
  onClose: () => void;
  song: Song | null;
}

const SocialShareModal = ({ isOpen, onClose, song }: SocialShareModalProps) => {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [cardUrl, setCardUrl] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [copiedApp, setCopiedApp] = useState(false);
  const [generating, setGenerating] = useState(false);
  const appUrl = 'https://universflow.in';

  const generateCard = useCallback(async () => {
    if (!song || !canvasRef.current) return;

    setGenerating(true);
    const canvas = canvasRef.current;
    const ctx = canvas.getContext('2d');
    if (!ctx) { setGenerating(false); return; }

    // Story portrait 1080x1920 (IG/WA story native)
    const W = 1080;
    const H = 1920;
    canvas.width = W;
    canvas.height = H;

    // Load artwork
    let art: HTMLImageElement | null = null;
    if (song.cover_url) {
      try {
        const img = new Image();
        img.crossOrigin = 'anonymous';
        await new Promise((res, rej) => {
          img.onload = res; img.onerror = rej; img.src = song.cover_url!;
        });
        art = img;
      } catch { art = null; }
    }

    // Extract dominant color from artwork for accent
    let accent = { r: 255, g: 45, b: 85 };
    if (art) {
      try {
        const tmp = document.createElement('canvas');
        tmp.width = 32; tmp.height = 32;
        const tctx = tmp.getContext('2d')!;
        tctx.drawImage(art, 0, 0, 32, 32);
        const data = tctx.getImageData(0, 0, 32, 32).data;
        let r = 0, g = 0, b = 0, n = 0;
        for (let i = 0; i < data.length; i += 16) {
          // bias to saturated pixels
          const cr = data[i], cg = data[i + 1], cb = data[i + 2];
          const max = Math.max(cr, cg, cb), min = Math.min(cr, cg, cb);
          if (max - min < 40) continue;
          r += cr; g += cg; b += cb; n++;
        }
        if (n > 0) {
          accent = { r: Math.round(r / n), g: Math.round(g / n), b: Math.round(b / n) };
          // boost saturation/brightness
          const maxC = Math.max(accent.r, accent.g, accent.b);
          if (maxC < 200) {
            const k = 200 / Math.max(maxC, 1);
            accent.r = Math.min(255, Math.round(accent.r * k));
            accent.g = Math.min(255, Math.round(accent.g * k));
            accent.b = Math.min(255, Math.round(accent.b * k));
          }
        }
      } catch {}
    }
    const accentRgb = `${accent.r}, ${accent.g}, ${accent.b}`;

    // Duotone backdrop: deep black → accent radial glow
    const bgGrad = ctx.createRadialGradient(W * 0.5, H * 0.35, 50, W * 0.5, H * 0.5, H);
    bgGrad.addColorStop(0, `rgba(${accentRgb}, 0.55)`);
    bgGrad.addColorStop(0.5, `rgba(${Math.round(accent.r * 0.3)}, ${Math.round(accent.g * 0.3)}, ${Math.round(accent.b * 0.3)}, 1)`);
    bgGrad.addColorStop(1, '#050507');
    ctx.fillStyle = bgGrad; ctx.fillRect(0, 0, W, H);

    // Heavy blurred artwork wash (subtle, behind everything)
    if (art) {
      ctx.save();
      ctx.globalAlpha = 0.35;
      ctx.filter = 'blur(80px) saturate(180%)';
      const ratio = Math.max(W / art.width, H / art.height);
      const dw = art.width * ratio;
      const dh = art.height * ratio;
      ctx.drawImage(art, (W - dw) / 2, (H - dh) / 2, dw, dh);
      ctx.restore();
    }

    // Film grain (sparse)
    ctx.save();
    ctx.globalAlpha = 0.08;
    for (let i = 0; i < 1200; i++) {
      ctx.fillStyle = Math.random() > 0.5 ? '#fff' : '#000';
      ctx.fillRect(Math.random() * W, Math.random() * H, 1, 1);
    }
    ctx.restore();

    // Vignette
    const vg = ctx.createRadialGradient(W / 2, H / 2, H * 0.3, W / 2, H / 2, H * 0.75);
    vg.addColorStop(0, 'rgba(0,0,0,0)');
    vg.addColorStop(1, 'rgba(0,0,0,0.7)');
    ctx.fillStyle = vg; ctx.fillRect(0, 0, W, H);

    const margin = 72;

    // ─── TOP BAR — brand + monogram ───────────────────────
    ctx.fillStyle = 'rgba(255,255,255,0.95)';
    ctx.font = '800 26px "Helvetica Neue", system-ui, sans-serif';
    ctx.textAlign = 'left';
    ctx.fillText('UNIVERS', margin, 110);
    ctx.fillStyle = `rgb(${accentRgb})`;
    ctx.fillText('FLOW', margin + ctx.measureText('UNIVERS').width + 12, 110);

    ctx.fillStyle = 'rgba(255,255,255,0.6)';
    ctx.font = '600 18px "Helvetica Neue", system-ui, sans-serif';
    ctx.textAlign = 'right';
    ctx.fillText('NOW SPINNING', W - margin, 110);

    // hair-line rule
    ctx.strokeStyle = 'rgba(255,255,255,0.15)';
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(margin, 138); ctx.lineTo(W - margin, 138);
    ctx.stroke();

    // ─── VINYL + ARTWORK COMPOSITION ──────────────────────
    const tile = 760;
    const tx = (W - tile) / 2;
    const ty = 230;

    // Vinyl disc peeking from right
    const vinylCx = tx + tile + 30;
    const vinylCy = ty + tile / 2;
    const vinylR = tile / 2 + 40;
    ctx.save();
    ctx.shadowColor = 'rgba(0,0,0,0.7)';
    ctx.shadowBlur = 60;
    ctx.shadowOffsetY = 20;
    ctx.fillStyle = '#0a0a0a';
    ctx.beginPath(); ctx.arc(vinylCx, vinylCy, vinylR, 0, Math.PI * 2); ctx.fill();
    ctx.restore();
    // vinyl grooves
    ctx.strokeStyle = 'rgba(255,255,255,0.06)';
    ctx.lineWidth = 1;
    for (let r = vinylR - 20; r > 80; r -= 14) {
      ctx.beginPath(); ctx.arc(vinylCx, vinylCy, r, 0, Math.PI * 2); ctx.stroke();
    }
    // vinyl label
    const labelR = 90;
    ctx.fillStyle = `rgb(${accentRgb})`;
    ctx.beginPath(); ctx.arc(vinylCx, vinylCy, labelR, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = '#050507';
    ctx.beginPath(); ctx.arc(vinylCx, vinylCy, 12, 0, Math.PI * 2); ctx.fill();
    // vinyl shine highlight
    const shine = ctx.createLinearGradient(vinylCx - vinylR, vinylCy - vinylR, vinylCx + vinylR, vinylCy + vinylR);
    shine.addColorStop(0, 'rgba(255,255,255,0.18)');
    shine.addColorStop(0.5, 'rgba(255,255,255,0)');
    shine.addColorStop(1, 'rgba(255,255,255,0.08)');
    ctx.fillStyle = shine;
    ctx.beginPath(); ctx.arc(vinylCx, vinylCy, vinylR, 0, Math.PI * 2); ctx.fill();

    // Artwork tile (sharp, with thick chrome border)
    ctx.save();
    ctx.shadowColor = `rgba(${accentRgb}, 0.45)`;
    ctx.shadowBlur = 90;
    ctx.shadowOffsetY = 30;
    roundRect(ctx, tx, ty, tile, tile, 36);
    ctx.fillStyle = '#0a0a0a';
    ctx.fill();
    ctx.restore();

    if (art) {
      ctx.save();
      roundRect(ctx, tx, ty, tile, tile, 36);
      ctx.clip();
      const ratio = Math.max(tile / art.width, tile / art.height);
      const dw = art.width * ratio;
      const dh = art.height * ratio;
      ctx.drawImage(art, tx + (tile - dw) / 2, ty + (tile - dh) / 2, dw, dh);
      // gloss highlight
      const gloss = ctx.createLinearGradient(tx, ty, tx, ty + tile * 0.5);
      gloss.addColorStop(0, 'rgba(255,255,255,0.18)');
      gloss.addColorStop(1, 'rgba(255,255,255,0)');
      ctx.fillStyle = gloss;
      ctx.fillRect(tx, ty, tile, tile * 0.5);
      ctx.restore();
    }
    // crisp inner border
    ctx.strokeStyle = 'rgba(255,255,255,0.18)';
    ctx.lineWidth = 2;
    roundRect(ctx, tx + 1, ty + 1, tile - 2, tile - 2, 35);
    ctx.stroke();

    // ─── AUDIO WAVEFORM BARS ──────────────────────────────
    const waveY = ty + tile + 80;
    const waveH = 70;
    const barCount = 56;
    const barGap = 6;
    const barW = (W - margin * 2 - barGap * (barCount - 1)) / barCount;
    for (let i = 0; i < barCount; i++) {
      // smooth pseudo-random wave envelope
      const t = i / barCount;
      const env = Math.sin(t * Math.PI) * 0.85 + 0.15;
      const noise = 0.4 + Math.abs(Math.sin(i * 1.7) + Math.cos(i * 0.9)) * 0.3;
      const h = Math.max(8, waveH * env * noise);
      const bx = margin + i * (barW + barGap);
      const by = waveY + (waveH - h) / 2;
      const alpha = 0.4 + env * 0.6;
      ctx.fillStyle = `rgba(${accentRgb}, ${alpha})`;
      roundRect(ctx, bx, by, barW, h, barW / 2);
      ctx.fill();
    }

    // ─── HEADLINE BLOCK ───────────────────────────────────
    let cursor = waveY + waveH + 90;

    // tiny eyebrow
    ctx.fillStyle = `rgb(${accentRgb})`;
    ctx.font = '800 20px "Helvetica Neue", system-ui, sans-serif';
    ctx.textAlign = 'left';
    ctx.fillText('▸ TRACK', margin, cursor);
    cursor += 30;

    // Massive serif title
    ctx.fillStyle = '#FFFFFF';
    ctx.font = '900 96px Georgia, "Times New Roman", serif';
    const titleLines = wrapText(ctx, song.title || 'Untitled', W - margin * 2, 3);
    titleLines.forEach((line) => {
      ctx.fillText(line, margin, cursor + 78);
      cursor += 100;
    });

    cursor += 30;

    // Artist + album on baseline
    ctx.fillStyle = 'rgba(255,255,255,0.55)';
    ctx.font = '700 22px "Helvetica Neue", system-ui, sans-serif';
    ctx.fillText('BY', margin, cursor);
    ctx.fillStyle = '#FFFFFF';
    ctx.font = '700 36px "Helvetica Neue", system-ui, sans-serif';
    ctx.fillText(truncateText(ctx, (song.artist || 'Unknown').toUpperCase(), W - margin * 2 - 60), margin + 50, cursor + 4);
    cursor += 60;

    if (song.album) {
      ctx.fillStyle = 'rgba(255,255,255,0.55)';
      ctx.font = '500 24px Georgia, serif';
      ctx.fillText(truncateText(ctx, `from "${song.album}"`, W - margin * 2), margin, cursor);
      cursor += 40;
    }

    // ─── FOOTER STRIP ─────────────────────────────────────
    const footerY = H - 140;
    // accent rule
    ctx.fillStyle = `rgb(${accentRgb})`;
    ctx.fillRect(margin, footerY, 80, 4);

    ctx.fillStyle = 'rgba(255,255,255,0.85)';
    ctx.font = '700 22px "Helvetica Neue", system-ui, sans-serif';
    ctx.textAlign = 'left';
    ctx.fillText('STREAM FREE', margin, footerY + 50);
    ctx.fillStyle = 'rgba(255,255,255,0.5)';
    ctx.font = '500 18px "Helvetica Neue", system-ui, sans-serif';
    ctx.fillText('universflow.in  ·  no ads  ·  lossless', margin, footerY + 80);

    // Watermark pill bottom-right
    await drawUniversFlowWatermark(ctx, W, H - 60, {
      position: 'bottom-right',
      theme: 'light',
    });

    const url = canvas.toDataURL('image/png');
    setCardUrl(url);
    setGenerating(false);
  }, [song]);

  const wrapText = (ctx: CanvasRenderingContext2D, text: string, maxWidth: number, maxLines: number) => {
    const words = (text || '').split(/\s+/).filter(Boolean);
    const lines: string[] = [];
    let current = '';
    for (const w of words) {
      const test = current ? current + ' ' + w : w;
      if (ctx.measureText(test).width > maxWidth) {
        if (current) lines.push(current);
        current = w;
        if (lines.length === maxLines) break;
      } else {
        current = test;
      }
    }
    if (current && lines.length < maxLines) lines.push(current);
    if (lines.length === maxLines) {
      let last = lines[maxLines - 1];
      while (ctx.measureText(last + '…').width > maxWidth && last.length > 0) {
        last = last.slice(0, -1);
      }
      if (last !== lines[maxLines - 1]) lines[maxLines - 1] = last + '…';
    }
    return lines;
  };

  useEffect(() => {
    if (isOpen && song) {
      generateCard();
    }
  }, [isOpen, song, generateCard]);

  const truncateText = (ctx: CanvasRenderingContext2D, text: string, maxWidth: number) => {
    const metrics = ctx.measureText(text);
    if (metrics.width <= maxWidth) return text;
    
    let truncated = text;
    while (ctx.measureText(truncated + '...').width > maxWidth && truncated.length > 0) {
      truncated = truncated.slice(0, -1);
    }
    return truncated + '...';
  };

  const roundRect = (
    ctx: CanvasRenderingContext2D,
    x: number,
    y: number,
    width: number,
    height: number,
    radius: number
  ) => {
    ctx.beginPath();
    ctx.moveTo(x + radius, y);
    ctx.lineTo(x + width - radius, y);
    ctx.quadraticCurveTo(x + width, y, x + width, y + radius);
    ctx.lineTo(x + width, y + height - radius);
    ctx.quadraticCurveTo(x + width, y + height, x + width - radius, y + height);
    ctx.lineTo(x + radius, y + height);
    ctx.quadraticCurveTo(x, y + height, x, y + height - radius);
    ctx.lineTo(x, y + radius);
    ctx.quadraticCurveTo(x, y, x + radius, y);
    ctx.closePath();
  };

  const getSongLink = () => `${appUrl}/song/${song?.id}`;
  const getShareText = () => `🎵 "${song?.title}" by ${song?.artist} — playing on UniversFlow\n${getSongLink()}`;
  const cardName = () => `${song?.title ?? 'track'} - ${song?.artist ?? ''} · UniversFlow`;

  const handleDownload = async () => {
    if (!cardUrl || !song) return;
    try {
      const how = await saveImageToDevice(cardUrl, cardName());
      toast.success(how === 'saved' ? 'Saved to your device 📸' : 'Card downloaded 🎵');
    } catch {
      toast.error('Could not save the card');
    }
  };

  /** Always shares the IMAGE card, not a bare link. */
  const shareCard = async () => {
    if (!cardUrl) return;
    const ok = await shareImage(cardUrl, cardName(), getShareText());
    if (!ok) {
      await handleDownload();
      try { await navigator.clipboard.writeText(getShareText()); } catch { /* ignore */ }
      toast.success('Card saved & caption copied — paste it in the app 📸');
    }
  };

  const shareToInstagram = shareCard;

  const shareToWhatsApp = async () => {
    if (cardUrl) {
      const ok = await shareImage(cardUrl, cardName(), getShareText());
      if (ok) return;
    }
    const text = encodeURIComponent(getShareText());
    window.open(`https://wa.me/?text=${text}`, '_blank');
  };

  const shareToTwitter = async () => {
    if (cardUrl) {
      const ok = await shareImage(cardUrl, cardName(), getShareText());
      if (ok) return;
    }
    const text = encodeURIComponent(getShareText());
    window.open(`https://twitter.com/intent/tweet?text=${text}`, '_blank');
  };


  const copyLink = () => {
    navigator.clipboard.writeText(getSongLink());
    setCopied(true);
    toast.success('Song link copied! 🔗');
    setTimeout(() => setCopied(false), 2000);
  };

  const copyAppLink = () => {
    navigator.clipboard.writeText(appUrl);
    setCopiedApp(true);
    toast.success('App link copied! Share UniversFlow 🎵');
    setTimeout(() => setCopiedApp(false), 2000);
  };

  const platforms = [
    { 
      name: 'Instagram', 
      icon: InstagramIcon, 
      action: shareToInstagram,
      gradient: 'from-purple-500 via-pink-500 to-orange-500',
      description: 'Download card & copy link'
    },
    { 
      name: 'WhatsApp', 
      icon: WhatsAppIcon, 
      action: shareToWhatsApp,
      gradient: 'from-green-500 to-green-600',
      description: 'Share with contacts'
    },
    { 
      name: 'Twitter', 
      icon: TwitterIcon, 
      action: shareToTwitter,
      gradient: 'from-gray-800 to-black',
      description: 'Tweet this song'
    },
  ];

  return (
    <AnimatePresence>
      {isOpen && (
        <>
          {/* Backdrop */}
          <motion.div
            className="fixed inset-0 bg-black/70 backdrop-blur-sm z-[60]"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            onClick={onClose}
          />

          {/* Modal */}
          <motion.div
            className="fixed inset-4 z-[60] flex items-center justify-center pointer-events-none"
            initial={{ opacity: 0, scale: 0.9 }}
            animate={{ opacity: 1, scale: 1 }}
            exit={{ opacity: 0, scale: 0.9 }}
            transition={iosSpring}
          >
            <div 
              className="w-full max-w-lg max-h-[85vh] overflow-y-auto rounded-3xl pointer-events-auto custom-scrollbar"
              style={{
                background: 'rgba(28, 28, 30, 0.98)',
                backdropFilter: 'blur(40px)',
                border: '1px solid rgba(255, 255, 255, 0.1)',
              }}
            >
              {/* Header */}
              <div className="sticky top-0 z-10 flex items-center justify-between p-5 border-b border-white/10 bg-inherit">
                <div>
                  <h2 className="text-lg font-semibold">Share Song</h2>
                  <p className="text-sm text-muted-foreground">Share to social platforms</p>
                </div>
                <motion.button
                  onClick={onClose}
                  className="p-2 rounded-full hover:bg-white/10 transition-colors"
                  whileTap={{ scale: 0.9 }}
                >
                  <X className="w-5 h-5" />
                </motion.button>
              </div>

              {/* Preview Card */}
              <div className="p-5">
                <div className="relative aspect-[1080/1920] max-h-[55vh] mx-auto rounded-2xl overflow-hidden bg-black/50 mb-5">
                  {generating ? (
                    <div className="absolute inset-0 flex items-center justify-center">
                      <motion.div 
                        className="w-8 h-8 rounded-full border-2 border-primary border-t-transparent"
                        animate={{ rotate: 360 }}
                        transition={{ duration: 1, repeat: Infinity, ease: "linear" }}
                      />
                    </div>
                  ) : cardUrl ? (
                    <img src={cardUrl} alt="Share card" className="w-full h-full object-cover" />
                  ) : null}
                </div>

                {/* Hidden canvas for generation */}
                <canvas ref={canvasRef} className="hidden" />

                {/* Social Platforms */}
                <div className="space-y-3 mb-5">
                  <p className="text-sm font-medium text-muted-foreground">Share to</p>
                  <div className="grid grid-cols-3 gap-3">
                    {platforms.map((platform, index) => (
                      <motion.button
                        key={platform.name}
                        onClick={platform.action}
                        disabled={!cardUrl}
                        className="flex flex-col items-center gap-2 p-4 rounded-2xl bg-white/5 hover:bg-white/10 transition-colors disabled:opacity-50"
                        initial={{ opacity: 0, y: 20 }}
                        animate={{ opacity: 1, y: 0 }}
                        transition={{ ...iosSpring, delay: index * 0.05 }}
                        whileHover={{ scale: 1.02 }}
                        whileTap={{ scale: 0.98 }}
                      >
                        <div className={`w-12 h-12 rounded-xl bg-gradient-to-br ${platform.gradient} flex items-center justify-center text-white`}>
                          <platform.icon />
                        </div>
                        <span className="text-xs font-medium">{platform.name}</span>
                      </motion.button>
                    ))}
                  </div>
                </div>

                {/* Actions */}
                <div className="grid grid-cols-2 gap-3 mb-3">
                  <motion.button
                    onClick={handleDownload}
                    disabled={!cardUrl}
                    className="h-12 rounded-xl bg-white/10 font-semibold flex items-center justify-center gap-2 disabled:opacity-50"
                    whileHover={{ scale: 1.02 }}
                    whileTap={{ scale: 0.98 }}
                    transition={iosBounce}
                  >
                    <Download className="w-5 h-5" />
                    Download
                  </motion.button>
                  
                  <motion.button
                    onClick={copyLink}
                    className="h-12 rounded-xl bg-primary text-primary-foreground font-semibold flex items-center justify-center gap-2"
                    whileHover={{ scale: 1.02 }}
                    whileTap={{ scale: 0.98 }}
                    transition={iosBounce}
                  >
                    {copied ? <Check className="w-5 h-5" /> : <Copy className="w-5 h-5" />}
                    {copied ? 'Copied!' : 'Copy Song Link'}
                  </motion.button>
                </div>

                {/* Copy App Link */}
                <motion.button
                  onClick={copyAppLink}
                  className="w-full h-12 rounded-xl bg-white/5 hover:bg-white/10 font-medium flex items-center justify-center gap-2 transition-colors"
                  whileHover={{ scale: 1.01 }}
                  whileTap={{ scale: 0.98 }}
                  transition={iosBounce}
                >
                  {copiedApp ? <Check className="w-5 h-5 text-green-400" /> : <Link2 className="w-5 h-5" />}
                  {copiedApp ? 'App Link Copied!' : 'Copy App Link to Share'}
                </motion.button>
              </div>
            </div>
          </motion.div>
        </>
      )}
    </AnimatePresence>
  );
};

export default SocialShareModal;
