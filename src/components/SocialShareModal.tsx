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

    // Magazine-cover portrait format (Instagram/WhatsApp story friendly)
    const W = 1080;
    const H = 1350;
    canvas.width = W;
    canvas.height = H;

    ctx.fillStyle = '#0A0A0C';
    ctx.fillRect(0, 0, W, H);

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

    // Full-bleed blurred backdrop
    if (art) {
      ctx.save();
      ctx.filter = 'blur(60px) saturate(140%) brightness(0.55)';
      const ratio = Math.max(W / art.width, H / art.height);
      const dw = art.width * ratio;
      const dh = art.height * ratio;
      ctx.drawImage(art, (W - dw) / 2, (H - dh) / 2, dw, dh);
      ctx.restore();
    } else {
      const g = ctx.createLinearGradient(0, 0, W, H);
      g.addColorStop(0, '#1a1320');
      g.addColorStop(1, '#0A0A0C');
      ctx.fillStyle = g; ctx.fillRect(0, 0, W, H);
    }

    // Darkening top & bottom
    const topShade = ctx.createLinearGradient(0, 0, 0, H * 0.45);
    topShade.addColorStop(0, 'rgba(0,0,0,0.7)');
    topShade.addColorStop(1, 'rgba(0,0,0,0)');
    ctx.fillStyle = topShade; ctx.fillRect(0, 0, W, H * 0.45);

    const botShade = ctx.createLinearGradient(0, H * 0.45, 0, H);
    botShade.addColorStop(0, 'rgba(0,0,0,0)');
    botShade.addColorStop(0.6, 'rgba(0,0,0,0.75)');
    botShade.addColorStop(1, 'rgba(0,0,0,0.95)');
    ctx.fillStyle = botShade; ctx.fillRect(0, H * 0.45, W, H * 0.55);

    // Masthead
    const margin = 64;
    ctx.fillStyle = '#FFFFFF';
    ctx.font = '700 22px "Helvetica Neue", system-ui, sans-serif';
    ctx.textAlign = 'left';
    ctx.fillText('UNIVERS FLOW', margin, 90);
    ctx.fillStyle = '#FF2D55';
    ctx.textAlign = 'right';
    ctx.fillText('NOW PLAYING / VOL. 01', W - margin, 90);
    ctx.textAlign = 'left';

    ctx.strokeStyle = 'rgba(255,255,255,0.35)';
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.moveTo(margin, 110);
    ctx.lineTo(W - margin, 110);
    ctx.stroke();

    // Centered artwork tile (sharp)
    const tile = 640;
    const tx = (W - tile) / 2;
    const ty = 175;
    ctx.save();
    ctx.shadowColor = 'rgba(0,0,0,0.6)';
    ctx.shadowBlur = 50;
    ctx.shadowOffsetY = 25;
    roundRect(ctx, tx, ty, tile, tile, 28);
    ctx.fillStyle = '#15151A';
    ctx.fill();
    ctx.restore();

    if (art) {
      ctx.save();
      roundRect(ctx, tx, ty, tile, tile, 28);
      ctx.clip();
      const ratio = Math.max(tile / art.width, tile / art.height);
      const dw = art.width * ratio;
      const dh = art.height * ratio;
      ctx.drawImage(art, tx + (tile - dw) / 2, ty + (tile - dh) / 2, dw, dh);
      ctx.restore();
    }
    ctx.strokeStyle = 'rgba(255,255,255,0.12)';
    ctx.lineWidth = 1;
    roundRect(ctx, tx + 0.5, ty + 0.5, tile - 1, tile - 1, 28);
    ctx.stroke();

    // Editorial headline
    const headlineY = ty + tile + 95;
    ctx.fillStyle = '#FFFFFF';
    ctx.textAlign = 'center';
    ctx.font = '900 76px Georgia, "Times New Roman", serif';
    const titleLines = wrapText(ctx, song.title || 'Untitled', W - margin * 2, 2);
    titleLines.forEach((line, i) => {
      ctx.fillText(line, W / 2, headlineY + i * 82);
    });

    // Accent rule
    const ruleY = headlineY + titleLines.length * 82 + 20;
    ctx.strokeStyle = '#FF2D55';
    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.moveTo(W / 2 - 40, ruleY);
    ctx.lineTo(W / 2 + 40, ruleY);
    ctx.stroke();

    // Artist meta
    ctx.fillStyle = 'rgba(255,255,255,0.88)';
    ctx.font = '500 30px "Helvetica Neue", system-ui, sans-serif';
    const meta = song.album ? `${song.artist}  ·  ${song.album}` : song.artist;
    ctx.fillText(truncateText(ctx, meta, W - margin * 2), W / 2, ruleY + 50);

    // Footer ticker
    ctx.fillStyle = 'rgba(255,255,255,0.55)';
    ctx.font = '600 18px "Helvetica Neue", system-ui, sans-serif';
    ctx.textAlign = 'left';
    ctx.fillText('STREAM · UNIVERSFLOW.IN', margin, H - 50);
    ctx.textAlign = 'right';
    ctx.fillText('FREE · NO ADS · LOSSLESS', W - margin, H - 50);
    ctx.textAlign = 'left';

    // Watermark pill
    await drawUniversFlowWatermark(ctx, W, H - 90, {
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
  const getShareText = () => `🎵 Check out "${song?.title}" by ${song?.artist} on UniversFlow!`;

  const handleDownload = async () => {
    if (!cardUrl || !song) return;

    const link = document.createElement('a');
    link.download = `${song.title} - ${song.artist}.png`;
    link.href = cardUrl;
    link.click();
    toast.success('Card downloaded! 🎵');
  };

  const shareToInstagram = async () => {
    // Instagram doesn't have direct web share, download card and copy link
    if (cardUrl) {
      await handleDownload();
      navigator.clipboard.writeText(getShareText() + '\n' + getSongLink());
      toast.success('Card downloaded! Link copied - paste in Instagram 📸');
    }
  };

  const shareToWhatsApp = () => {
    const text = encodeURIComponent(getShareText() + '\n\n' + getSongLink());
    window.open(`https://wa.me/?text=${text}`, '_blank');
    toast.success('Opening WhatsApp... 💬');
  };

  const shareToTwitter = () => {
    const text = encodeURIComponent(getShareText());
    const url = encodeURIComponent(getSongLink());
    window.open(`https://twitter.com/intent/tweet?text=${text}&url=${url}`, '_blank');
    toast.success('Opening Twitter... 🐦');
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
                <div className="relative aspect-[1200/630] rounded-2xl overflow-hidden bg-black/50 mb-5">
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
