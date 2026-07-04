import { useEffect, useMemo, useRef, useState } from 'react';
import { useOutletContext } from 'react-router-dom';
import {
  Link as LinkIcon, QrCode, Image as ImageIcon, Megaphone, Copy, Check,
  Download, Share2, Music2, Loader2, ExternalLink, Flame, AlertCircle,
} from 'lucide-react';
import QRCode from 'qrcode';
import { supabase } from '@/integrations/supabase/client';
import { ArtistProfile, ArtistSong, fmt } from './_shared';
import BentoCard from '@/components/artist/BentoCard';
import { useToast } from '@/hooks/use-toast';
import { triggerHaptic } from '@/hooks/useHaptics';
import { drawUniversFlowWatermark } from '@/lib/shareWatermark';

type Ctx = { profile: ArtistProfile | null; songs: ArtistSong[]; followers: number };

const SITE_ORIGIN =
  (typeof window !== 'undefined' && window.location?.origin) || 'https://universflow.in';

const PUBLIC_ORIGIN = 'https://universflow.in';

function publicArtistUrl(slug: string) {
  return `${PUBLIC_ORIGIN}/a/${slug}`;
}
function publicSongUrl(slug: string, songId: string) {
  return `${PUBLIC_ORIGIN}/a/${slug}?song=${songId}`;
}

export default function ArtistPromote() {
  const { profile, songs, followers } = useOutletContext<Ctx>();
  const { toast } = useToast();

  const liveSongs = useMemo(() => songs.filter((s) => s.status === 'live'), [songs]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  useEffect(() => {
    if (!selectedId && liveSongs.length) setSelectedId(liveSongs[0].id);
  }, [liveSongs, selectedId]);
  const selected = liveSongs.find((s) => s.id === selectedId) ?? null;

  if (!profile) {
    return (
      <div className="max-w-3xl mx-auto px-5 pt-10 text-center text-muted-foreground text-[13px]">
        <Loader2 className="w-4 h-4 animate-spin mx-auto" />
      </div>
    );
  }

  const bioUrl = publicArtistUrl(profile.slug);
  const songUrl = selected ? publicSongUrl(profile.slug, selected.id) : bioUrl;

  return (
    <div className="max-w-3xl mx-auto px-5 pt-5 pb-16 space-y-5">
      {/* Header */}
      <div>
        <p className="text-[10px] uppercase tracking-[0.22em] text-muted-foreground/80 font-semibold">
          Grow your audience
        </p>
        <h2 className="font-display text-[28px] leading-none tracking-tight mt-1">Promote</h2>
        <p className="text-[12.5px] text-muted-foreground mt-1.5">
          Share-ready cards, QR codes and a one-tap announcement to your {fmt(followers)} follower{followers === 1 ? '' : 's'}.
        </p>
      </div>

      {/* Smart bio link */}
      <BentoCard className="p-5">
        <div className="flex items-center gap-2 mb-3">
          <LinkIcon className="w-4 h-4 text-muted-foreground" />
          <p className="text-[13px] font-semibold tracking-tight">Smart bio link</p>
        </div>
        <p className="text-[12px] text-muted-foreground -mt-1 mb-3">
          Put this single link in your Instagram, TikTok, YouTube and X bios — it always points to your latest music.
        </p>
        <CopyRow value={bioUrl} />
        <div className="mt-2 flex gap-2">
          <a
            href={bioUrl}
            target="_blank"
            rel="noreferrer"
            className="inline-flex items-center gap-1.5 h-8 px-3 rounded-full text-[11.5px] font-semibold bg-white/[0.05] text-white hover:bg-white/10 active:scale-95 transition"
          >
            <ExternalLink className="w-3.5 h-3.5" /> Open public page
          </a>
          <ShareNativeButton url={bioUrl} title={`${profile.stage_name} on Universflow`} />
        </div>
      </BentoCard>

      {/* Song picker for downstream tools */}
      <BentoCard className="p-5">
        <div className="flex items-center gap-2 mb-3">
          <Music2 className="w-4 h-4 text-muted-foreground" />
          <p className="text-[13px] font-semibold tracking-tight">Pick a song to promote</p>
        </div>
        {liveSongs.length === 0 ? (
          <p className="text-[12.5px] text-muted-foreground py-3">
            Upload a song first and it'll show up here.
          </p>
        ) : (
          <div className="flex gap-2 overflow-x-auto -mx-1 px-1 pb-1 scrollbar-none">
            {liveSongs.map((s) => {
              const active = s.id === selectedId;
              return (
                <button
                  key={s.id}
                  type="button"
                  onClick={() => { triggerHaptic('selection'); setSelectedId(s.id); }}
                  className={`shrink-0 flex items-center gap-2 pl-1 pr-3 h-10 rounded-full transition ${
                    active ? 'bg-white text-black' : 'bg-white/[0.04] text-white hover:bg-white/[0.07]'
                  }`}
                >
                  <span className="w-8 h-8 rounded-full overflow-hidden bg-black/40 ring-1 ring-white/10">
                    {s.cover_url
                      ? <img src={s.cover_url} alt="" className="w-full h-full object-cover" />
                      : <span className="w-full h-full grid place-items-center"><Music2 className="w-3.5 h-3.5 text-muted-foreground" /></span>}
                  </span>
                  <span className="text-[12px] font-medium max-w-[140px] truncate">{s.title}</span>
                </button>
              );
            })}
          </div>
        )}
      </BentoCard>

      {/* Share link for chosen song */}
      {selected && (
        <BentoCard className="p-5">
          <div className="flex items-center gap-2 mb-3">
            <Share2 className="w-4 h-4 text-muted-foreground" />
            <p className="text-[13px] font-semibold tracking-tight">Share link</p>
          </div>
          <CopyRow value={songUrl} />
          <div className="mt-2 flex gap-2 flex-wrap">
            <a
              href={`https://wa.me/?text=${encodeURIComponent(`🎧 ${selected.title} — ${profile.stage_name}\n${songUrl}`)}`}
              target="_blank" rel="noreferrer"
              className="inline-flex items-center gap-1.5 h-8 px-3 rounded-full text-[11.5px] font-semibold bg-[#25D366]/15 text-[#25D366] hover:bg-[#25D366]/20 active:scale-95 transition"
            >
              WhatsApp
            </a>
            <a
              href={`https://twitter.com/intent/tweet?text=${encodeURIComponent(`🎧 ${selected.title} — ${profile.stage_name}`)}&url=${encodeURIComponent(songUrl)}`}
              target="_blank" rel="noreferrer"
              className="inline-flex items-center gap-1.5 h-8 px-3 rounded-full text-[11.5px] font-semibold bg-white/[0.05] text-white hover:bg-white/10 active:scale-95 transition"
            >
              X / Twitter
            </a>
            <a
              href={`https://t.me/share/url?url=${encodeURIComponent(songUrl)}&text=${encodeURIComponent(`🎧 ${selected.title} — ${profile.stage_name}`)}`}
              target="_blank" rel="noreferrer"
              className="inline-flex items-center gap-1.5 h-8 px-3 rounded-full text-[11.5px] font-semibold bg-white/[0.05] text-white hover:bg-white/10 active:scale-95 transition"
            >
              Telegram
            </a>
            <ShareNativeButton url={songUrl} title={`${selected.title} — ${profile.stage_name}`} />
          </div>
        </BentoCard>
      )}

      {/* QR code */}
      <BentoCard className="p-5">
        <div className="flex items-center gap-2 mb-3">
          <QrCode className="w-4 h-4 text-muted-foreground" />
          <p className="text-[13px] font-semibold tracking-tight">QR code</p>
        </div>
        <QrPanel url={selected ? songUrl : bioUrl} filename={`universflow-${profile.slug}${selected ? `-${selected.id.slice(0, 6)}` : ''}.png`} />
        <p className="text-[11px] text-muted-foreground mt-3">
          Print on posters, stickers or merch — scanning opens {selected ? 'this song' : 'your artist page'} instantly.
        </p>
      </BentoCard>

      {/* Story / share card */}
      {selected && (
        <BentoCard className="p-5">
          <div className="flex items-center gap-2 mb-3">
            <ImageIcon className="w-4 h-4 text-muted-foreground" />
            <p className="text-[13px] font-semibold tracking-tight">Instagram / WhatsApp story card</p>
          </div>
          <ShareCardGenerator song={selected} profile={profile} />
        </BentoCard>
      )}

      {/* Notify followers */}
      <BentoCard className="p-5">
        <div className="flex items-center gap-2 mb-3">
          <Megaphone className="w-4 h-4 text-muted-foreground" />
          <p className="text-[13px] font-semibold tracking-tight">Notify your followers</p>
        </div>
        <NotifyFollowers
          slug={profile.slug}
          stageName={profile.stage_name}
          followerCount={followers}
          selected={selected}
        />
      </BentoCard>
    </div>
  );
}

/* ---------------- helpers ---------------- */

function CopyRow({ value }: { value: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <div className="flex items-stretch gap-2">
      <div className="flex-1 min-w-0 h-10 px-3 rounded-xl bg-black/40 ring-1 ring-white/10 flex items-center text-[12.5px] font-mono truncate">
        {value}
      </div>
      <button
        type="button"
        onClick={async () => {
          try {
            await navigator.clipboard.writeText(value);
            triggerHaptic('selection');
            setCopied(true);
            setTimeout(() => setCopied(false), 1400);
          } catch {/* noop */}
        }}
        className="h-10 px-3 rounded-xl bg-white text-black text-[12px] font-semibold inline-flex items-center gap-1.5 active:scale-95 transition"
      >
        {copied ? <Check className="w-3.5 h-3.5" /> : <Copy className="w-3.5 h-3.5" />}
        {copied ? 'Copied' : 'Copy'}
      </button>
    </div>
  );
}

function ShareNativeButton({ url, title }: { url: string; title: string }) {
  const canShare = typeof navigator !== 'undefined' && typeof (navigator as any).share === 'function';
  if (!canShare) return null;
  return (
    <button
      type="button"
      onClick={async () => {
        try {
          triggerHaptic('selection');
          await (navigator as any).share({ title, url, text: title });
        } catch {/* user cancelled */}
      }}
      className="inline-flex items-center gap-1.5 h-8 px-3 rounded-full text-[11.5px] font-semibold bg-white text-black hover:opacity-90 active:scale-95 transition"
    >
      <Share2 className="w-3.5 h-3.5" /> Share…
    </button>
  );
}

function QrPanel({ url, filename }: { url: string; filename: string }) {
  const [src, setSrc] = useState<string>('');
  useEffect(() => {
    let alive = true;
    QRCode.toDataURL(url, {
      width: 520,
      margin: 1,
      color: { dark: '#0A0A0C', light: '#FFFFFF' },
      errorCorrectionLevel: 'H',
    }).then((d) => { if (alive) setSrc(d); }).catch(() => {});
    return () => { alive = false; };
  }, [url]);
  return (
    <div className="flex items-start gap-4">
      <div className="w-32 h-32 rounded-2xl overflow-hidden bg-white grid place-items-center ring-1 ring-white/10 shrink-0">
        {src ? <img src={src} alt="QR" className="w-full h-full" />
          : <Loader2 className="w-4 h-4 animate-spin text-black/50" />}
      </div>
      <div className="min-w-0 flex-1">
        <p className="text-[12px] text-muted-foreground truncate">{url}</p>
        <a
          href={src || '#'}
          download={filename}
          onClick={(e) => { if (!src) e.preventDefault(); else triggerHaptic('selection'); }}
          className={`mt-3 inline-flex items-center gap-1.5 h-9 px-3.5 rounded-full text-[12px] font-semibold transition ${
            src ? 'bg-white text-black hover:opacity-90 active:scale-95' : 'bg-white/10 text-white/40 cursor-not-allowed'
          }`}
        >
          <Download className="w-3.5 h-3.5" /> Download PNG
        </a>
      </div>
    </div>
  );
}

/* ---------- Story Card generator (Canvas, no deps) ---------- */

function ShareCardGenerator({
  song, profile,
}: { song: ArtistSong; profile: ArtistProfile }) {
  const [previewUrl, setPreviewUrl] = useState<string>('');
  const [busy, setBusy] = useState(false);
  const [variant, setVariant] = useState<'crimson' | 'mono' | 'ocean'>('crimson');

  useEffect(() => {
    let cancelled = false;
    setBusy(true);
    renderCard(song, profile, variant).then((d) => {
      if (!cancelled) { setPreviewUrl(d); setBusy(false); }
    }).catch(() => setBusy(false));
    return () => { cancelled = true; };
  }, [song.id, profile.slug, variant]);

  return (
    <div className="space-y-3">
      <div className="flex gap-1.5">
        {(['crimson', 'mono', 'ocean'] as const).map((v) => (
          <button
            key={v}
            type="button"
            onClick={() => { triggerHaptic('selection'); setVariant(v); }}
            className={`h-7 px-3 rounded-full text-[11px] font-semibold capitalize transition ${
              variant === v ? 'bg-white text-black' : 'bg-white/[0.05] text-muted-foreground'
            }`}
          >
            {v}
          </button>
        ))}
      </div>
      <div className="rounded-2xl overflow-hidden bg-black/40 ring-1 ring-white/10 aspect-[9/16] max-w-[260px] mx-auto grid place-items-center">
        {busy || !previewUrl
          ? <Loader2 className="w-4 h-4 animate-spin text-muted-foreground" />
          : <img src={previewUrl} alt="Story preview" className="w-full h-full object-cover" />}
      </div>
      <a
        href={previewUrl || '#'}
        download={`${profile.slug}-${song.id.slice(0, 6)}-story.png`}
        onClick={(e) => { if (!previewUrl) e.preventDefault(); else triggerHaptic('selection'); }}
        className={`w-full inline-flex justify-center items-center gap-1.5 h-10 rounded-full text-[12.5px] font-semibold transition ${
          previewUrl ? 'bg-white text-black hover:opacity-90 active:scale-[0.98]' : 'bg-white/10 text-white/40 cursor-not-allowed'
        }`}
      >
        <Download className="w-4 h-4" /> Download 1080×1920 PNG
      </a>
      <p className="text-[11px] text-muted-foreground text-center">
        Tap to download, then upload it to your Instagram or WhatsApp story.
      </p>
    </div>
  );
}

const VARIANTS: Record<string, { from: string; to: string; chip: string }> = {
  crimson: { from: '#1A0610', to: '#FF2D55', chip: '#FF2D55' },
  mono:    { from: '#0A0A0C', to: '#2A2A30', chip: '#FFFFFF' },
  ocean:   { from: '#04111F', to: '#0E63B0', chip: '#3AB6FF' },
};

async function renderCard(
  song: ArtistSong,
  profile: ArtistProfile,
  variant: 'crimson' | 'mono' | 'ocean',
): Promise<string> {
  const W = 1080, H = 1920;
  const canvas = document.createElement('canvas');
  canvas.width = W; canvas.height = H;
  const ctx = canvas.getContext('2d')!;
  const v = VARIANTS[variant];

  // 1. Base
  ctx.fillStyle = '#0A0A0C';
  ctx.fillRect(0, 0, W, H);

  // 2. Full-bleed blurred artwork backdrop
  if (song.cover_url) {
    try {
      const img = await loadImage(song.cover_url);
      ctx.save();
      (ctx as any).filter = 'blur(70px) saturate(140%) brightness(0.5)';
      const s = Math.max(W / img.width, H / img.height);
      const dw = img.width * s, dh = img.height * s;
      ctx.drawImage(img, (W - dw) / 2, (H - dh) / 2, dw, dh);
      ctx.restore();
    } catch { /* ignore */ }
  } else {
    const g = ctx.createLinearGradient(0, 0, 0, H);
    g.addColorStop(0, v.from); g.addColorStop(1, v.to);
    ctx.fillStyle = g; ctx.fillRect(0, 0, W, H);
  }

  // 3. Top + bottom shading
  const topShade = ctx.createLinearGradient(0, 0, 0, H * 0.35);
  topShade.addColorStop(0, 'rgba(0,0,0,0.7)');
  topShade.addColorStop(1, 'rgba(0,0,0,0)');
  ctx.fillStyle = topShade; ctx.fillRect(0, 0, W, H * 0.35);
  const dim = ctx.createLinearGradient(0, H * 0.45, 0, H);
  dim.addColorStop(0, 'rgba(0,0,0,0)');
  dim.addColorStop(0.55, 'rgba(0,0,0,0.75)');
  dim.addColorStop(1, 'rgba(0,0,0,0.97)');
  ctx.fillStyle = dim; ctx.fillRect(0, H * 0.45, W, H * 0.55);

  // 4. Masthead
  const margin = 80;
  ctx.fillStyle = '#FFFFFF';
  ctx.font = '700 30px "Helvetica Neue", system-ui, sans-serif';
  ctx.textBaseline = 'alphabetic';
  ctx.textAlign = 'left';
  ctx.fillText('UNIVERS FLOW', margin, 130);
  ctx.fillStyle = v.chip;
  ctx.textAlign = 'right';
  ctx.fillText('NEW RELEASE / VOL. 01', W - margin, 130);
  ctx.textAlign = 'left';
  ctx.strokeStyle = 'rgba(255,255,255,0.35)';
  ctx.lineWidth = 2;
  ctx.beginPath(); ctx.moveTo(margin, 155); ctx.lineTo(W - margin, 155); ctx.stroke();

  // 5. Centered artwork tile (sharp)
  const coverSize = 760;
  const cx = (W - coverSize) / 2;
  const cy = 260;
  ctx.save();
  ctx.shadowColor = 'rgba(0,0,0,0.65)';
  ctx.shadowBlur = 60; ctx.shadowOffsetY = 30;
  drawRoundedRect(ctx, cx, cy, coverSize, coverSize, 40);
  ctx.fillStyle = '#15151A'; ctx.fill();
  ctx.restore();
  if (song.cover_url) {
    try {
      const img = await loadImage(song.cover_url);
      drawRoundedImage(ctx, img, cx, cy, coverSize, coverSize, 40);
    } catch { /* placeholder */ }
  }
  ctx.strokeStyle = 'rgba(255,255,255,0.12)';
  ctx.lineWidth = 1;
  drawRoundedRect(ctx, cx + 0.5, cy + 0.5, coverSize - 1, coverSize - 1, 40);
  ctx.stroke();

  // 6. Serif editorial headline
  ctx.fillStyle = '#FFFFFF';
  ctx.textAlign = 'center';
  ctx.font = '900 92px Georgia, "Times New Roman", serif';
  const titleY = cy + coverSize + 140;
  const titleLines = wrapMagText(ctx, song.title, W - margin * 2, 2);
  titleLines.forEach((line, i) => ctx.fillText(line, W / 2, titleY + i * 100));

  // 7. Accent rule
  const ruleY = titleY + titleLines.length * 100 + 30;
  ctx.strokeStyle = v.chip;
  ctx.lineWidth = 4;
  ctx.beginPath();
  ctx.moveTo(W / 2 - 50, ruleY); ctx.lineTo(W / 2 + 50, ruleY); ctx.stroke();

  // 8. Artist
  ctx.fillStyle = 'rgba(255,255,255,0.9)';
  ctx.font = '500 44px "Helvetica Neue", system-ui, sans-serif';
  ctx.fillText(profile.stage_name, W / 2, ruleY + 70);

  // 9. CTA pill
  const ctaY = H - 280;
  drawRoundedRect(ctx, margin, ctaY, W - margin * 2, 120, 60);
  ctx.fillStyle = '#fff'; ctx.fill();
  ctx.fillStyle = '#000';
  ctx.textBaseline = 'middle';
  ctx.textAlign = 'center';
  ctx.font = '700 38px "Helvetica Neue", system-ui, sans-serif';
  const cta = `▶  LISTEN · universflow.in/a/${profile.slug}`;
  ctx.fillText(ellipsize(ctx, cta, W - margin * 2 - 80), W / 2, ctaY + 60);
  ctx.textBaseline = 'alphabetic';
  ctx.textAlign = 'left';

  // 10. Footer ticker
  ctx.fillStyle = 'rgba(255,255,255,0.6)';
  ctx.font = '600 22px "Helvetica Neue", system-ui, sans-serif';
  ctx.fillText('FREE · NO ADS · LOSSLESS', margin, H - 70);
  ctx.textAlign = 'right';
  ctx.fillText('SHARE / TAG @UNIVERSFLOW', W - margin, H - 70);
  ctx.textAlign = 'left';

  // 11. Watermark — top-right safe zone
  await drawUniversFlowWatermark(ctx, W, H - 160, { position: 'top-right', theme: 'light' });

  return canvas.toDataURL('image/png');
}

function wrapMagText(ctx: CanvasRenderingContext2D, text: string, maxWidth: number, maxLines: number): string[] {
  const words = (text || '').split(/\s+/).filter(Boolean);
  const lines: string[] = [];
  let cur = '';
  for (const w of words) {
    const test = cur ? cur + ' ' + w : w;
    if (ctx.measureText(test).width > maxWidth) {
      if (cur) lines.push(cur);
      cur = w;
      if (lines.length === maxLines) break;
    } else cur = test;
  }
  if (cur && lines.length < maxLines) lines.push(cur);
  if (lines.length === maxLines) {
    let last = lines[maxLines - 1];
    while (ctx.measureText(last + '…').width > maxWidth && last.length > 0) last = last.slice(0, -1);
    if (last !== lines[maxLines - 1]) lines[maxLines - 1] = last + '…';
  }
  return lines;
}

function loadImage(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.crossOrigin = 'anonymous';
    img.onload = () => resolve(img);
    img.onerror = reject;
    img.src = src;
  });
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
function drawRoundedImage(ctx: CanvasRenderingContext2D, img: HTMLImageElement, x: number, y: number, w: number, h: number, r: number) {
  ctx.save();
  drawRoundedRect(ctx, x, y, w, h, r); ctx.clip();
  const s = Math.max(w / img.width, h / img.height);
  const dw = img.width * s, dh = img.height * s;
  ctx.drawImage(img, x + (w - dw) / 2, y + (h - dh) / 2, dw, dh);
  ctx.restore();
}
function wrapText(
  ctx: CanvasRenderingContext2D, text: string, x: number, y: number, maxWidth: number, lineHeight: number, maxLines = 2,
) {
  const words = text.split(' ');
  let line = ''; const lines: string[] = [];
  for (const w of words) {
    const test = line ? line + ' ' + w : w;
    if (ctx.measureText(test).width > maxWidth && line) { lines.push(line); line = w; }
    else line = test;
    if (lines.length >= maxLines) break;
  }
  if (line && lines.length < maxLines) lines.push(line);
  if (lines.length >= maxLines && words.length > lines.join(' ').split(' ').length) {
    lines[maxLines - 1] = ellipsize(ctx, lines[maxLines - 1] + '…', maxWidth);
  }
  lines.forEach((ln, i) => ctx.fillText(ln, x, y + i * lineHeight));
}
function ellipsize(ctx: CanvasRenderingContext2D, text: string, maxWidth: number) {
  if (ctx.measureText(text).width <= maxWidth) return text;
  let lo = 0, hi = text.length;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (ctx.measureText(text.slice(0, mid) + '…').width > maxWidth) hi = mid;
    else lo = mid + 1;
  }
  return text.slice(0, Math.max(0, lo - 1)) + '…';
}

/* ---------- Notify followers ---------- */

function NotifyFollowers({
  slug, stageName, followerCount, selected,
}: {
  slug: string;
  stageName: string;
  followerCount: number;
  selected: ArtistSong | null;
}) {
  const { toast } = useToast();
  const [busy, setBusy] = useState(false);
  const [cooldownUntil, setCooldownUntil] = useState<number | null>(null);
  const COOLDOWN_KEY = 'uf_artist_promo_push_at';

  useEffect(() => {
    try {
      const raw = localStorage.getItem(COOLDOWN_KEY);
      if (raw) {
        const ts = Number(raw);
        if (ts && Date.now() - ts < 24 * 3600_000) setCooldownUntil(ts + 24 * 3600_000);
      }
    } catch {/* ignore */}
  }, []);

  const remainingMs = cooldownUntil ? cooldownUntil - Date.now() : 0;
  const onCooldown = remainingMs > 0;

  const send = async () => {
    if (followerCount === 0) {
      toast({ title: 'No followers yet', description: 'Share your bio link first to grow your audience.' });
      return;
    }
    triggerHaptic('impactMedium');
    setBusy(true);
    try {
      const { data, error } = await supabase.functions.invoke('artist-notify-followers', {
        body: {
          slug,
          song_id: selected?.id ?? null,
          title: selected ? `${stageName} dropped “${selected.title}”` : `${stageName} has an update`,
          body: selected ? 'Tap to listen — fresh from the studio.' : 'Open the artist page to see what\'s new.',
        },
      });
      if (error) throw error;
      if ((data as any)?.error) throw new Error((data as any).error);
      const until = Date.now() + 24 * 3600_000;
      try { localStorage.setItem(COOLDOWN_KEY, String(Date.now())); } catch {/* ignore */}
      setCooldownUntil(until);
      toast({
        title: '✓ Announcement sent',
        description: `Pinged ${(data as any)?.notified ?? followerCount} follower${followerCount === 1 ? '' : 's'}.`,
      });
    } catch (e: any) {
      const msg = e?.message ?? 'Could not send announcement.';
      if (/throttl|cooldown|429/i.test(msg)) {
        const until = Date.now() + 24 * 3600_000;
        try { localStorage.setItem(COOLDOWN_KEY, String(Date.now())); } catch {/* ignore */}
        setCooldownUntil(until);
        toast({ title: 'On cooldown', description: 'You can announce once every 24 hours. Try again tomorrow.', variant: 'destructive' });
      } else {
        toast({ title: 'Send failed', description: msg, variant: 'destructive' });
      }
    } finally {
      setBusy(false);
    }
  };

  return (
    <div>
      <p className="text-[12px] text-muted-foreground -mt-1 mb-3">
        Push a notification to every one of your followers. To respect their inbox, you can do this <strong className="text-white/85">once every 24 hours</strong>.
      </p>
      <div className="rounded-xl bg-black/30 ring-1 ring-white/10 p-3 mb-3 flex items-start gap-2.5">
        <Flame className="w-4 h-4 text-rose-400 mt-0.5 shrink-0" />
        <div className="text-[12px] leading-snug text-white/80">
          {selected
            ? <>Will be sent as: <span className="text-white">“{stageName} dropped <em>{selected.title}</em>”</span> → opens your artist page.</>
            : <>Will be sent as: <span className="text-white">“{stageName} has an update”</span> → opens your artist page.</>}
        </div>
      </div>
      <button
        type="button"
        onClick={send}
        disabled={busy || onCooldown}
        className={`w-full h-11 rounded-full inline-flex items-center justify-center gap-2 text-[13px] font-semibold transition ${
          onCooldown
            ? 'bg-white/[0.06] text-white/40 cursor-not-allowed'
            : busy
              ? 'bg-rose-500/40 text-white cursor-wait'
              : 'bg-rose-500 text-white hover:bg-rose-500/90 active:scale-[0.98]'
        }`}
      >
        {busy ? <Loader2 className="w-4 h-4 animate-spin" /> : <Megaphone className="w-4 h-4" />}
        {onCooldown
          ? `Available in ${formatRemaining(remainingMs)}`
          : `Notify ${fmt(followerCount)} follower${followerCount === 1 ? '' : 's'}`}
      </button>
      {followerCount === 0 && (
        <p className="text-[11px] text-amber-300/80 mt-2 inline-flex items-center gap-1.5">
          <AlertCircle className="w-3 h-3" /> You have no followers yet. Share your bio link to start growing.
        </p>
      )}
    </div>
  );
}

function formatRemaining(ms: number) {
  const totalMin = Math.max(1, Math.ceil(ms / 60000));
  const h = Math.floor(totalMin / 60);
  const m = totalMin % 60;
  if (h <= 0) return `${m}m`;
  return `${h}h ${m}m`;
}
