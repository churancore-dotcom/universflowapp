import { useCallback, useEffect, useState } from 'react';
import { motion } from 'framer-motion';
import {
  Pin, PinOff, Search, Music, RefreshCw, Loader2, Star, Eye, EyeOff, ArrowUp, ArrowDown,
} from 'lucide-react';
import { supabase } from '@/integrations/supabase/client';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { toast } from 'sonner';

interface StreamTrack {
  track_id: string;
  source: string;
  title: string;
  artist: string;
  cover_url: string | null;
  audio_url: string | null;
  duration: number | null;
  last_seen_at: string;
}

interface ViralPick {
  id: string;
  track_id: string;
  title: string;
  artist: string;
  cover_url: string | null;
  audio_url: string | null;
  source: string;
  position: number;
  is_active: boolean;
  pinned_at: string;
}

const ContentControl = () => {
  const [picks, setPicks] = useState<ViralPick[]>([]);
  const [loading, setLoading] = useState(true);
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<StreamTrack[]>([]);
  const [searching, setSearching] = useState(false);
  const [busyId, setBusyId] = useState<string | null>(null);

  const loadPicks = useCallback(async () => {
    const { data, error } = await supabase
      .from('viral_picks')
      .select('id, track_id, title, artist, cover_url, audio_url, source, position, is_active, pinned_at')
      .order('position', { ascending: true });
    if (error) toast.error('Failed to load featured picks');
    setPicks((data as ViralPick[] | null) || []);
    setLoading(false);
  }, []);

  useEffect(() => { loadPicks(); }, [loadPicks]);

  const search = async () => {
    const q = query.trim();
    if (q.length < 2) { toast.error('Type at least 2 characters'); return; }
    setSearching(true);
    const pattern = `%${q.replace(/[%_,]/g, ' ').slice(0, 60)}%`;
    const { data, error } = await supabase
      .from('stream_songs')
      .select('track_id, source, title, artist, cover_url, audio_url, duration, last_seen_at')
      .or(`title.ilike.${pattern},artist.ilike.${pattern}`)
      .order('last_seen_at', { ascending: false })
      .limit(20);
    if (error) toast.error('Search failed');
    setResults((data as StreamTrack[] | null) || []);
    setSearching(false);
  };

  const pinTrack = async (t: StreamTrack) => {
    if (picks.some((p) => p.track_id === t.track_id && p.source === t.source)) {
      toast.error('Already featured');
      return;
    }
    setBusyId(t.track_id);
    const nextPos = picks.length ? Math.max(...picks.map((p) => p.position)) + 1 : 1;
    const { error } = await supabase.from('viral_picks').insert({
      track_id: t.track_id,
      title: t.title,
      artist: t.artist,
      cover_url: t.cover_url,
      audio_url: t.audio_url,
      source: t.source,
      position: nextPos,
      is_active: true,
    });
    if (error) toast.error(error.message);
    else { toast.success(`"${t.title}" featured on home`); await loadPicks(); }
    setBusyId(null);
  };

  const toggleActive = async (p: ViralPick) => {
    setBusyId(p.id);
    const { error } = await supabase.from('viral_picks')
      .update({ is_active: !p.is_active }).eq('id', p.id);
    if (error) toast.error(error.message);
    else setPicks((prev) => prev.map((x) => x.id === p.id ? { ...x, is_active: !x.is_active } : x));
    setBusyId(null);
  };

  const removePick = async (p: ViralPick) => {
    if (!confirm(`Remove "${p.title}" from featured?`)) return;
    setBusyId(p.id);
    const { error } = await supabase.from('viral_picks').delete().eq('id', p.id);
    if (error) toast.error(error.message);
    else { toast.success('Removed from featured'); setPicks((prev) => prev.filter((x) => x.id !== p.id)); }
    setBusyId(null);
  };

  const move = async (p: ViralPick, dir: -1 | 1) => {
    const idx = picks.findIndex((x) => x.id === p.id);
    const swap = picks[idx + dir];
    if (!swap) return;
    setBusyId(p.id);
    const [{ error: e1 }, { error: e2 }] = await Promise.all([
      supabase.from('viral_picks').update({ position: swap.position }).eq('id', p.id),
      supabase.from('viral_picks').update({ position: p.position }).eq('id', swap.id),
    ]);
    if (e1 || e2) toast.error('Failed to reorder');
    else await loadPicks();
    setBusyId(null);
  };

  return (
    <div className="p-4 md:p-8">
      <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }}
        className="mb-6 flex items-start justify-between gap-3 flex-col md:flex-row">
        <div>
          <h1 className="text-2xl md:text-3xl font-display font-bold">Content Control</h1>
          <p className="text-muted-foreground mt-1 text-sm">
            Feature tracks on the home page and control their order
          </p>
        </div>
        <Button size="sm" variant="outline" onClick={loadPicks}>
          <RefreshCw className="w-3.5 h-3.5" />
        </Button>
      </motion.div>

      {/* Search & pin */}
      <div className="glass rounded-2xl p-4 mb-6">
        <h3 className="font-semibold flex items-center gap-2 mb-3">
          <Search className="w-4 h-4 text-primary" /> Feature a track
        </h3>
        <div className="flex gap-2">
          <Input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && search()}
            placeholder="Search streamed tracks by title or artist…"
            className="bg-muted/50 border-white/10"
            maxLength={60}
          />
          <Button onClick={search} disabled={searching}>
            {searching ? <Loader2 className="w-4 h-4 animate-spin" /> : 'Search'}
          </Button>
        </div>
        {results.length > 0 && (
          <div className="mt-3 space-y-1.5 max-h-80 overflow-y-auto">
            {results.map((t) => {
              const already = picks.some((p) => p.track_id === t.track_id && p.source === t.source);
              return (
                <div key={`${t.source}:${t.track_id}`}
                  className="flex items-center gap-3 p-2 rounded-lg hover:bg-white/5">
                  <div className="w-10 h-10 rounded-lg bg-muted overflow-hidden shrink-0">
                    {t.cover_url && <img src={t.cover_url} alt="" className="w-full h-full object-cover" loading="lazy" />}
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-medium truncate">{t.title}</p>
                    <p className="text-xs text-muted-foreground truncate">{t.artist}</p>
                  </div>
                  <Button size="sm" variant={already ? 'ghost' : 'outline'}
                    disabled={already || busyId === t.track_id}
                    onClick={() => pinTrack(t)}>
                    {busyId === t.track_id ? <Loader2 className="w-3.5 h-3.5 animate-spin" />
                      : already ? 'Featured' : <><Pin className="w-3.5 h-3.5 mr-1" /> Feature</>}
                  </Button>
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* Current picks */}
      <div className="glass rounded-2xl p-4">
        <h3 className="font-semibold flex items-center gap-2 mb-3">
          <Star className="w-4 h-4 text-amber-400" /> Featured on home ({picks.filter((p) => p.is_active).length} live)
        </h3>
        {loading ? (
          <div className="p-8 text-center"><Loader2 className="w-6 h-6 animate-spin mx-auto text-primary" /></div>
        ) : picks.length === 0 ? (
          <div className="p-8 text-center text-muted-foreground text-sm">
            <Music className="w-10 h-10 mx-auto mb-2 opacity-40" />
            Nothing featured yet — search above and pin tracks.
          </div>
        ) : (
          <div className="space-y-1.5">
            {picks.map((p, i) => (
              <div key={p.id}
                className={`flex items-center gap-3 p-2 rounded-lg hover:bg-white/5 ${p.is_active ? '' : 'opacity-50'}`}>
                <span className="w-6 text-center text-xs font-bold text-muted-foreground">{i + 1}</span>
                <div className="w-10 h-10 rounded-lg bg-muted overflow-hidden shrink-0">
                  {p.cover_url && <img src={p.cover_url} alt="" className="w-full h-full object-cover" loading="lazy" />}
                </div>
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-medium truncate">{p.title}</p>
                  <p className="text-xs text-muted-foreground truncate">{p.artist}</p>
                </div>
                {!p.is_active && <Badge variant="outline" className="text-[10px]">Hidden</Badge>}
                <div className="flex items-center gap-1">
                  <Button variant="ghost" size="icon" className="h-7 w-7" aria-label="Move up"
                    disabled={i === 0 || busyId !== null} onClick={() => move(p, -1)}>
                    <ArrowUp className="w-3.5 h-3.5" />
                  </Button>
                  <Button variant="ghost" size="icon" className="h-7 w-7" aria-label="Move down"
                    disabled={i === picks.length - 1 || busyId !== null} onClick={() => move(p, 1)}>
                    <ArrowDown className="w-3.5 h-3.5" />
                  </Button>
                  <Button variant="ghost" size="icon" className="h-7 w-7"
                    aria-label={p.is_active ? 'Hide from home' : 'Show on home'}
                    disabled={busyId === p.id} onClick={() => toggleActive(p)}>
                    {p.is_active ? <Eye className="w-3.5 h-3.5" /> : <EyeOff className="w-3.5 h-3.5" />}
                  </Button>
                  <Button variant="ghost" size="icon" className="h-7 w-7 text-red-400"
                    aria-label="Remove from featured" disabled={busyId === p.id} onClick={() => removePick(p)}>
                    <PinOff className="w-3.5 h-3.5" />
                  </Button>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
};

export default ContentControl;
