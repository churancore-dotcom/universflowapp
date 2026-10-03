import { useEffect, useMemo, useRef, useState } from 'react';
import { motion } from 'framer-motion';
import { Instagram, Link2, X, Loader2, Image as ImageIcon } from 'lucide-react';
import { toast } from 'sonner';
import type { Song } from '@/contexts/PlayerContext';
import { fetchLyrics, findActiveLine, type LyricLine } from '@/lib/lyrics';
import {
  drawStoryFrame, loadCover, recordStoryVideo, shareStoryFile, stillBlob, canRecordVideo,
  STORY_STYLES, STORY_SECONDS, STORY_W, STORY_H, type StoryAssets, type StoryStyle,
} from '@/lib/songStory';
import { getActiveStemMix, getPresetForMix, isDefaultMix } from '@/lib/stemLab';
import { triggerHaptic } from '@/hooks/useHaptics';

interface Props {
  song: Song;
  positionSec: number;
  onClose: () => void;
  onMoreOptions?: () => void;
}

function accentColor(): string {
  if (typeof window === 'undefined') return '#FF2D55';
  const v = getComputedStyle(document.documentElement).getPropertyValue('--primary').trim();
  return v ? (v.startsWith('#') || v.includes('(') ? v : `hsl(${v})`) : '#FF2D55';
}

const MAX_LINES = 8;

export default function SongStorySheet({ song, positionSec, onClose, onMoreOptions }: Props) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [assets, setAssets] = useState<StoryAssets | null>(null);
  const [style, setStyle] = useState<StoryStyle>('aurora');
  const [busy, setBusy] = useState<null | 'video' | 'image'>(null);
  const [progress, setProgress] = useState(0);

  const mixLabel = useMemo(() => {
    const mix = getActiveStemMix();
    if (isDefaultMix(mix)) return undefined;
    const p = getPresetForMix(mix);
    return p ? `${p.emoji} ${p.name} mix` : '🎛️ Custom Stem Lab mix';
  }, []);

  // Load cover + lyrics once; lyrics start at the line currently playing.
  useEffect(() => {
    let alive = true;
    const coverP = loadCover(song.cover_url);
    const lyricsP = fetchLyrics(song.artist, song.title, song.duration, song.id).then((r) => {
      const synced: LyricLine[] = r.synced || [];
      const texts = synced.length ? synced.map((l) => l.text.trim()) : (r.plain || '').split('\n').map((t) => t.trim());
      let start = 0;
      if (synced.length) start = Math.max(0, findActiveLine(synced, positionSec));
      return texts.slice(start).filter((t) => t && !/^[[(].*[\])]$/.test(t)).slice(0, MAX_LINES);
    }).catch(() => [] as string[]);
    Promise.all([coverP, lyricsP]).then(([cover, lines]) => {
      if (!alive) return;
      setAssets({ title: song.title, artist: song.artist, cover, lines, mixLabel, accent: accentColor() });
    });
    return () => { alive = false; };
  }, [song.id, song.artist, song.title, song.duration, song.cover_url, positionSec, mixLabel]);

  // Live animated preview.
  useEffect(() => {
    const c = canvasRef.current;
    if (!c || !assets) return;
    c.width = STORY_W; c.height = STORY_H;
    const ctx = c.getContext('2d')!;
    const start = performance.now();
    let raf = 0;
    const tick = () => {
      const t = ((performance.now() - start) / 1000) % STORY_SECONDS;
      drawStoryFrame(ctx, assets, style, t);
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [assets, style]);

  const caption = `Listening to ${song.title} by ${song.artist} on UniversFlow 🎧 universflow.in`;

  const share = async (kind: 'video' | 'image') => {
    if (!assets) return;
    triggerHaptic('impactLight');
    setBusy(kind); setProgress(0);
    try {
      let blob: Blob | null = null;
      if (kind === 'video') blob = await recordStoryVideo(assets, style, setProgress);
      if (!blob) blob = await stillBlob(assets, style);
      if (!blob) throw new Error('render');
      const res = await shareStoryFile(blob, `${song.title} — ${song.artist}`, caption);
      if (res === 'downloaded') toast.success('Story saved — post it from Instagram');
    } catch (e) {
      if ((e as Error)?.name !== 'AbortError' && !/cancel/i.test(String((e as Error)?.message))) {
        toast.error("Couldn't share this story. Try again.");
      }
    } finally {
      setBusy(null);
    }
  };

  const videoOk = typeof window !== 'undefined' && canRecordVideo();

  return (
    <motion.div
      className="fixed inset-0 z-[80] bg-background/95 backdrop-blur-xl flex flex-col"
      initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
    >
      <div className="flex items-center justify-between px-4 pt-[max(env(safe-area-inset-top),12px)] pb-2">
        <button onClick={onClose} aria-label="Close" className="w-10 h-10 flex items-center justify-center rounded-full bg-muted">
          <X className="w-5 h-5 text-foreground" />
        </button>
        <p className="text-sm font-semibold text-foreground">Share</p>
        {onMoreOptions ? (
          <button onClick={onMoreOptions} aria-label="Share link" className="w-10 h-10 flex items-center justify-center rounded-full bg-muted">
            <Link2 className="w-5 h-5 text-foreground" />
          </button>
        ) : <div className="w-10" />}
      </div>

      <div className="flex-1 min-h-0 flex items-center justify-center px-6">
        <div className="relative h-full max-h-[58dvh] aspect-[9/16] rounded-3xl overflow-hidden shadow-2xl bg-muted">
          <canvas ref={canvasRef} className="w-full h-full" />
          {!assets && (
            <div className="absolute inset-0 flex items-center justify-center bg-background/40">
              <Loader2 className="w-6 h-6 animate-spin text-primary" />
            </div>
          )}
          {busy === 'video' && (
            <div className="absolute inset-x-0 bottom-0 h-1 bg-background/40">
              <div className="h-full bg-primary transition-[width]" style={{ width: `${Math.round(progress * 100)}%` }} />
            </div>
          )}
        </div>
      </div>

      <div className="px-5 pt-4 pb-[max(env(safe-area-inset-bottom),16px)] space-y-3">
        <div className="flex gap-2 justify-center">
          {STORY_STYLES.map((s) => (
            <button
              key={s.id}
              onClick={() => { triggerHaptic('selection'); setStyle(s.id); }}
              className={`px-4 h-9 rounded-full text-xs font-semibold transition-colors ${style === s.id ? 'bg-primary text-primary-foreground' : 'bg-muted text-muted-foreground'}`}
            >
              {s.name}
            </button>
          ))}
        </div>
        {assets && !assets.lines.length && (
          <p className="text-center text-xs text-muted-foreground">No lyrics found — the card shows the cover and title.</p>
        )}
        <button
          onClick={() => share(videoOk ? 'video' : 'image')}
          disabled={!!busy || !assets}
          className="w-full h-12 rounded-full bg-primary text-primary-foreground font-semibold flex items-center justify-center gap-2 active:scale-[0.98] transition-transform disabled:opacity-60"
        >
          {busy === 'video' ? <Loader2 className="w-5 h-5 animate-spin" /> : <Instagram className="w-5 h-5" />}
          {busy === 'video' ? `Making your video… ${Math.round(progress * 100)}%` : 'Share to Instagram'}
        </button>
        <button
          onClick={() => share('image')}
          disabled={!!busy || !assets}
          className="w-full h-10 rounded-full bg-muted text-foreground text-sm font-medium flex items-center justify-center gap-2 disabled:opacity-60"
        >
          {busy === 'image' ? <Loader2 className="w-4 h-4 animate-spin" /> : <ImageIcon className="w-4 h-4" />}
          Share as photo instead
        </button>
      </div>
    </motion.div>
  );
}
