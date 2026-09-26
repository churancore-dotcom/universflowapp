import { useEffect, useMemo, useRef, useState } from 'react';
import { motion } from 'framer-motion';
import { ChevronLeft, ChevronRight, Share2, X, Loader2 } from 'lucide-react';
import { toast } from 'sonner';
import type { Song } from '@/contexts/PlayerContext';
import { fetchLyrics, findActiveLine, type LyricLine } from '@/lib/lyrics';
import { renderStory, shareStory, storyBlob } from '@/lib/songStory';
import { getActiveStemMix, getPresetForMix, isDefaultMix } from '@/lib/stemLab';
import { triggerHaptic } from '@/hooks/useHaptics';

interface Props {
  song: Song;
  positionSec: number;
  onClose: () => void;
}

function accentColor(): string {
  if (typeof window === 'undefined') return '#FF2D55';
  const v = getComputedStyle(document.documentElement).getPropertyValue('--primary').trim();
  return v ? (v.startsWith('#') || v.includes('(') ? v : `hsl(${v})`) : '#FF2D55';
}

export default function SongStorySheet({ song, positionSec, onClose }: Props) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [lines, setLines] = useState<string[]>([]);
  const [index, setIndex] = useState(-1); // -1 = no lyric
  const [rendering, setRendering] = useState(true);
  const [sharing, setSharing] = useState(false);

  const mixLabel = useMemo(() => {
    const mix = getActiveStemMix();
    if (isDefaultMix(mix)) return undefined;
    const p = getPresetForMix(mix);
    return p ? `${p.emoji} ${p.name} mix` : '🎛️ Custom Stem Lab mix';
  }, []);

  useEffect(() => {
    let alive = true;
    fetchLyrics(song.artist, song.title, song.duration, song.id).then((r) => {
      if (!alive) return;
      const synced: LyricLine[] = r.synced || [];
      const texts = synced.length
        ? synced.map((l) => l.text.trim())
        : (r.plain || '').split('\n').map((t) => t.trim());
      const clean = texts.filter((t) => t && !/^[\[(].*[\])]$/.test(t));
      setLines(clean);
      if (!clean.length) { setIndex(-1); return; }
      if (synced.length) {
        const i = findActiveLine(synced, positionSec);
        const txt = synced[Math.max(0, i)]?.text.trim();
        const at = clean.indexOf(txt || '');
        setIndex(at >= 0 ? at : 0);
      } else setIndex(0);
    }).catch(() => alive && setIndex(-1));
    return () => { alive = false; };
  }, [song.id, song.artist, song.title, song.duration, positionSec]);

  useEffect(() => {
    const c = canvasRef.current;
    if (!c) return;
    setRendering(true);
    renderStory(c, {
      title: song.title,
      artist: song.artist,
      coverUrl: song.cover_url,
      lyric: index >= 0 ? lines[index] : undefined,
      mixLabel,
      accent: accentColor(),
    }).finally(() => setRendering(false));
  }, [song.title, song.artist, song.cover_url, index, lines, mixLabel]);

  const step = (d: number) => {
    if (!lines.length) return;
    triggerHaptic('selection');
    setIndex((i) => (i + d + lines.length) % lines.length);
  };

  const handleShare = async () => {
    const c = canvasRef.current;
    if (!c) return;
    setSharing(true);
    try {
      const blob = await storyBlob(c);
      if (!blob) throw new Error('render');
      const res = await shareStory(blob, `${song.title} — ${song.artist}`,
        `Listening to ${song.title} by ${song.artist} on UniversFlow 🎧 universflow.in`);
      if (res === 'downloaded') toast.success('Story saved to your device');
    } catch (e) {
      if ((e as Error)?.name !== 'AbortError' && !/cancel/i.test(String((e as Error)?.message))) {
        toast.error("Couldn't share this story. Try again.");
      }
    } finally {
      setSharing(false);
    }
  };

  return (
    <motion.div
      className="fixed inset-0 z-[80] bg-background/95 backdrop-blur-xl flex flex-col"
      initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
    >
      <div className="flex items-center justify-between px-4 pt-[max(env(safe-area-inset-top),12px)] pb-2">
        <button onClick={onClose} aria-label="Close" className="w-10 h-10 flex items-center justify-center rounded-full bg-muted">
          <X className="w-5 h-5 text-foreground" />
        </button>
        <p className="text-sm font-semibold text-foreground">Song Story</p>
        <div className="w-10" />
      </div>

      <div className="flex-1 min-h-0 flex items-center justify-center px-6">
        <div className="relative h-full max-h-[62dvh] aspect-[9/16] rounded-3xl overflow-hidden shadow-2xl bg-muted">
          <canvas ref={canvasRef} className="w-full h-full" />
          {rendering && (
            <div className="absolute inset-0 flex items-center justify-center bg-background/40">
              <Loader2 className="w-6 h-6 animate-spin text-primary" />
            </div>
          )}
        </div>
      </div>

      <div className="px-5 pt-4 pb-[max(env(safe-area-inset-bottom),16px)] space-y-3">
        {lines.length > 1 ? (
          <div className="flex items-center gap-2">
            <button onClick={() => step(-1)} aria-label="Previous lyric" className="w-11 h-11 rounded-full bg-muted flex items-center justify-center">
              <ChevronLeft className="w-5 h-5 text-foreground" />
            </button>
            <p className="flex-1 text-center text-xs text-muted-foreground truncate">
              Pick your line · {index + 1}/{lines.length}
            </p>
            <button onClick={() => step(1)} aria-label="Next lyric" className="w-11 h-11 rounded-full bg-muted flex items-center justify-center">
              <ChevronRight className="w-5 h-5 text-foreground" />
            </button>
          </div>
        ) : (
          <p className="text-center text-xs text-muted-foreground">No lyrics for this song — your story shows the cover and title.</p>
        )}
        <button
          onClick={handleShare}
          disabled={sharing || rendering}
          className="w-full h-12 rounded-full bg-primary text-primary-foreground font-semibold flex items-center justify-center gap-2 active:scale-[0.98] transition-transform disabled:opacity-60"
        >
          {sharing ? <Loader2 className="w-5 h-5 animate-spin" /> : <Share2 className="w-5 h-5" />}
          Share to Instagram, WhatsApp & more
        </button>
      </div>
    </motion.div>
  );
}
