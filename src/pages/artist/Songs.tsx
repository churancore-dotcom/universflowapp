import { useMemo, useState } from 'react';
import { useOutletContext, Link } from 'react-router-dom';
import { motion, AnimatePresence } from 'framer-motion';
import { Music2, Trash2, Plus, Pencil, Cloud, HardDrive, Loader2, ExternalLink, Share2 } from 'lucide-react';
import { toast } from 'sonner';
import { supabase } from '@/integrations/supabase/client';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { ArtistProfile, ArtistSong, fmt } from './_shared';
import { detectSource } from '@/lib/artistUploadLinks';
import ArtistShareCard from '@/components/artist/ArtistShareCard';

type Ctx = { songs: ArtistSong[]; profile: ArtistProfile; followers: number };
type SortKey = 'recent' | 'plays' | 'likes' | 'views' | 'downloads';

export default function ArtistSongs() {
  const { songs, profile, followers } = useOutletContext<Ctx>();
  const [sort, setSort] = useState<SortKey>('recent');
  const [editing, setEditing] = useState<ArtistSong | null>(null);
  const [sharing, setSharing] = useState<ArtistSong | null>(null);


  const sorted = useMemo(() => {
    const arr = [...songs];
    switch (sort) {
      case 'plays': return arr.sort((a, b) => b.play_count - a.play_count);
      case 'likes': return arr.sort((a, b) => b.like_count - a.like_count);
      case 'views': return arr.sort((a, b) => (b.view_count || 0) - (a.view_count || 0));
      case 'downloads': return arr.sort((a, b) => b.download_count - a.download_count);
      default: return arr.sort((a, b) => +new Date(b.created_at) - +new Date(a.created_at));
    }
  }, [songs, sort]);

  const opts: Array<[SortKey, string]> = [
    ['recent', 'Recent'], ['plays', 'Plays'], ['likes', 'Likes'], ['views', 'Views'], ['downloads', 'Downloads'],
  ];

  return (
    <div className="max-w-3xl mx-auto px-5 pt-5">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-[22px] font-semibold tracking-tight">My music</h2>
          <p className="text-[12.5px] text-muted-foreground mt-0.5 tabular-nums">{songs.length} total</p>
        </div>
        <Button asChild className="h-10 rounded-xl text-[12.5px] font-semibold text-white" style={{ background: '#FF2D55' }}>
          <Link to="/artist/studio/upload"><Plus className="w-4 h-4 mr-1" /> Upload</Link>
        </Button>
      </div>

      {!songs.length ? (
        <div className="mt-12 text-center text-[13px] text-muted-foreground">
          No songs yet.{' '}
          <Link to="/artist/studio/upload" className="text-primary underline underline-offset-2">
            Upload your first track
          </Link>.
        </div>
      ) : (
        <>
          <div className="flex items-center gap-1.5 overflow-x-auto pb-1 -mx-1 px-1 scrollbar-none mt-5">
            {opts.map(([k, label]) => (
              <button
                key={k}
                onClick={() => setSort(k)}
                className={`shrink-0 px-3 h-8 rounded-full text-[11.5px] font-medium transition ${
                  sort === k ? 'bg-white text-black' : 'bg-white/[0.05] text-muted-foreground active:scale-95'
                }`}
              >
                {label}
              </button>
            ))}
          </div>

          <div className="mt-3 space-y-2.5">
            <AnimatePresence initial={false}>
              {sorted.map((s) => (
                <SongRow key={s.id} song={s} onEdit={() => setEditing(s)} />
              ))}
            </AnimatePresence>
          </div>
        </>
      )}

      <EditSongModal song={editing} onClose={() => setEditing(null)} />
    </div>
  );
}

function StatusPill({ status }: { status: ArtistSong['status'] }) {
  const map: Record<string, { label: string; cls: string }> = {
    live: { label: 'Live', cls: 'bg-emerald-500/15 text-emerald-300' },
    taken_down: { label: 'Rejected', cls: 'bg-rose-500/15 text-rose-300' },
  };
  const s = map[status] ?? { label: status, cls: 'bg-white/[0.06] text-muted-foreground' };
  return (
    <span className={`inline-flex items-center px-2 h-[18px] rounded-full text-[9.5px] font-semibold uppercase tracking-[0.08em] ${s.cls}`}>
      {s.label}
    </span>
  );
}

function SourceBadge({ url }: { url: string }) {
  const src = detectSource(url);
  if (!src) return null;
  const Icon = src === 'drive' ? HardDrive : Cloud;
  return (
    <span className="inline-flex items-center gap-1 text-[9.5px] uppercase tracking-[0.08em] text-muted-foreground">
      <Icon className="w-3 h-3" /> {src === 'drive' ? 'Drive' : 'Dropbox'}
    </span>
  );
}

function SongRow({ song, onEdit }: { song: ArtistSong; onEdit: () => void }) {
  const onDelete = async () => {
    if (!confirm(`Delete "${song.title}"? This cannot be undone.`)) return;
    const { error } = await supabase.from('artist_songs').delete().eq('id', song.id);
    if (error) toast.error(error.message);
    else toast.success('Deleted');
  };

  return (
    <motion.div
      layout
      initial={{ opacity: 0, y: 6 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0 }}
      className="flex items-center gap-3 p-3 rounded-2xl bg-white/[0.03] border border-white/[0.06]"
    >
      <div className="w-12 h-12 rounded-xl overflow-hidden bg-black/40 shrink-0">
        {song.cover_url
          ? <img src={song.cover_url} alt={song.title} className="w-full h-full object-cover" />
          : <div className="w-full h-full flex items-center justify-center"><Music2 className="w-5 h-5 text-muted-foreground" /></div>}
      </div>
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2">
          <p className="text-[13.5px] font-medium truncate">{song.title}</p>
          <StatusPill status={song.status} />
        </div>
        <p className="text-[11.5px] text-muted-foreground tabular-nums mt-0.5">
          {fmt(song.play_count)} plays · {fmt(song.view_count || 0)} views · {fmt(song.like_count)} likes · {fmt(song.download_count)} dl
        </p>
        <div className="mt-1"><SourceBadge url={song.stream_url} /></div>
        {song.status === 'taken_down' && song.takedown_reason && (
          <p className="text-[11px] text-rose-400 mt-1">Reason: {song.takedown_reason}</p>
        )}
      </div>
      <div className="flex flex-col gap-1.5">
        <button
          onClick={onEdit}
          className="w-9 h-9 rounded-full bg-white/[0.05] flex items-center justify-center text-foreground active:scale-95"
          aria-label="Edit song"
        >
          <Pencil className="w-4 h-4" />
        </button>
        <button
          onClick={onDelete}
          className="w-9 h-9 rounded-full bg-white/[0.04] flex items-center justify-center text-rose-400 active:scale-95"
          aria-label="Delete song"
        >
          <Trash2 className="w-4 h-4" />
        </button>
      </div>
    </motion.div>
  );
}

function EditSongModal({ song, onClose }: { song: ArtistSong | null; onClose: () => void }) {
  const [title, setTitle] = useState('');
  const [cover, setCover] = useState('');
  const [saving, setSaving] = useState(false);

  // Reset on open
  useMemo(() => {
    if (song) { setTitle(song.title); setCover(song.cover_url ?? ''); }
  }, [song?.id]);

  if (!song) return null;

  const save = async () => {
    if (!title.trim()) return;
    setSaving(true);
    try {
      const { error } = await supabase
        .from('artist_songs')
        .update({
          title: title.trim(),
          cover_url: cover.trim() || null,
        })
        .eq('id', song.id);
      if (error) throw error;
      toast.success('Saved');
      onClose();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Save failed');
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open={!!song} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle className="text-[16px]">Edit song</DialogTitle>
        </DialogHeader>
        <div className="space-y-3 pt-1">
          <label className="block">
            <span className="block text-[11px] uppercase tracking-[0.16em] text-muted-foreground/70 mb-2">Title</span>
            <Input value={title} onChange={(e) => setTitle(e.target.value)} maxLength={80} />
          </label>
          <label className="block">
            <span className="block text-[11px] uppercase tracking-[0.16em] text-muted-foreground/70 mb-2">Cover art URL</span>
            <Input value={cover} onChange={(e) => setCover(e.target.value)} placeholder="https://…" />
          </label>
          <a
            href={song.stream_url}
            target="_blank"
            rel="noreferrer"
            className="inline-flex items-center gap-1.5 text-[11.5px] text-muted-foreground hover:text-foreground"
          >
            <ExternalLink className="w-3.5 h-3.5" /> Open source file
          </a>
          <Button
            className="w-full h-11 rounded-xl font-semibold text-white"
            style={{ background: '#FF2D55' }}
            disabled={saving || !title.trim()}
            onClick={save}
          >
            {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : 'Save changes'}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
