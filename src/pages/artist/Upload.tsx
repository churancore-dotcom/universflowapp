import { useEffect, useMemo, useRef, useState } from 'react';
import { useOutletContext, useNavigate } from 'react-router-dom';
import { motion, AnimatePresence } from 'framer-motion';
import {
  Image as ImageIcon, Loader2, Upload as UploadIcon, Link2, CheckCircle2,
  AlertCircle, Cloud, HardDrive, ArrowLeft, ArrowRight, Play, Pause,
  Music2, CalendarClock, Zap, Clock,
} from 'lucide-react';
import { toast } from 'sonner';
import confetti from 'canvas-confetti';
import { supabase } from '@/integrations/supabase/client';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { uploadArtistCover } from '@/lib/artist';
import { useFilePreview } from '@/lib/useFilePreview';
import { validateUploadLink, type LinkValidation } from '@/lib/artistUploadLinks';
import { ArtistProfile, ArtistSong, fmt } from './_shared';
import BentoCard from '@/components/artist/BentoCard';

type Ctx = { profile: ArtistProfile; user: { id: string }; songs: ArtistSong[] };

const GENRES = [
  'Pop', 'Hip-Hop', 'R&B', 'Rock', 'Indie', 'Electronic', 'Dance',
  'Lo-fi', 'Classical', 'Jazz', 'Folk', 'Punjabi', 'Bollywood',
  'Devotional', 'Regional', 'Other',
];

const STEPS = [
  { key: 'source', label: 'Source', sub: 'Where is the audio?' },
  { key: 'details', label: 'Details', sub: 'Title, art, mood' },
  { key: 'schedule', label: 'Schedule', sub: 'Release now or later' },
  { key: 'review', label: 'Review', sub: 'Publish to your page' },
] as const;
type StepKey = typeof STEPS[number]['key'];

/** Format a Date into a value compatible with <input type="datetime-local">. */
function toLocalInputValue(d: Date) {
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

/* ---------------- Synthetic waveform (CORS-safe pseudo-preview) ---------------- */
function hashString(s: string) {
  let h = 2166136261 >>> 0;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}
function pseudoWaveform(seed: string, bars = 64) {
  let h = hashString(seed) || 1;
  const out: number[] = [];
  for (let i = 0; i < bars; i++) {
    h = (Math.imul(h, 48271) ^ (h >>> 13)) >>> 0;
    // shape: louder in the middle, softer at edges
    const env = 0.45 + 0.55 * Math.sin((i / (bars - 1)) * Math.PI);
    const r = ((h >>> 8) & 0xff) / 255;
    out.push(Math.max(0.08, env * (0.4 + 0.6 * r)));
  }
  return out;
}

export default function ArtistUpload() {
  const { user, songs } = useOutletContext<Ctx>();
  const recentUploads = songs.slice(0, 5);
  const navigate = useNavigate();
  const [step, setStep] = useState<StepKey>('source');
  const [tab, setTab] = useState<'upload' | 'drive' | 'dropbox'>('upload');

  // Direct file upload state
  const [audioFile, setAudioFile] = useState<File | null>(null);
  const [uploading, setUploading] = useState(false);
  const [uploadProgress, setUploadProgress] = useState(0);
  const [uploadedAudioUrl, setUploadedAudioUrl] = useState<string | null>(null);

  const handleAudioFileSelect = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    e.target.value = '';

    const nameOk = /\.(mp3|wav|flac|m4a|aac|ogg)$/i.test(file.name);
    const typeOk = /^audio\//i.test(file.type);
    if (!nameOk && !typeOk) {
      toast.error('Only MP3, WAV, FLAC, M4A files allowed');
      return;
    }
    if (file.size > 100 * 1024 * 1024) {
      toast.error('File too large. Maximum 100MB');
      return;
    }

    setAudioFile(file);
    setUploadedAudioUrl(null);
    setUploading(true);
    setUploadProgress(0);

    try {
      const ext = (file.name.split('.').pop() || 'mp3').toLowerCase();
      const path = `${user.id}/${Date.now()}-${crypto.randomUUID()}.${ext}`;

      const { data: sess } = await supabase.auth.getSession();
      const accessToken = sess?.session?.access_token;
      if (!accessToken) throw new Error('You are signed out. Please sign in again.');

      const supabaseUrl = import.meta.env.VITE_SUPABASE_URL;
      const endpoint = `${supabaseUrl}/storage/v1/object/artist-audio/${path}`;

      await new Promise<void>((resolve, reject) => {
        const xhr = new XMLHttpRequest();
        xhr.open('POST', endpoint);
        xhr.setRequestHeader('Authorization', `Bearer ${accessToken}`);
        xhr.setRequestHeader('Content-Type', file.type || 'audio/mpeg');
        xhr.setRequestHeader('x-upsert', 'true');
        xhr.upload.onprogress = (ev) => {
          if (ev.lengthComputable) {
            setUploadProgress(Math.round((ev.loaded / ev.total) * 100));
          }
        };
        xhr.onload = () => {
          if (xhr.status >= 200 && xhr.status < 300) resolve();
          else reject(new Error(`Upload failed (${xhr.status}): ${xhr.responseText}`));
        };
        xhr.onerror = () => reject(new Error('Network error during upload'));
        xhr.send(file);
      });

      const { data: pub } = supabase.storage.from('artist-audio').getPublicUrl(path);
      const publicUrl = pub?.publicUrl;
      if (!publicUrl) throw new Error('Could not get public URL for upload');

      setUploadedAudioUrl(publicUrl);
      setUploadProgress(100);
      toast.success('Audio uploaded ✓');
    } catch (err) {
      console.error('[artist-upload] direct upload failed:', err);
      toast.error(err instanceof Error ? err.message : 'Upload failed');
      setAudioFile(null);
      setUploadProgress(0);
      setUploadedAudioUrl(null);
    } finally {
      setUploading(false);
    }
  };

  // form state
  const [streamUrl, setStreamUrl] = useState('');
  const [title, setTitle] = useState('');
  const [genre, setGenre] = useState('');
  const [description, setDescription] = useState('');
  const [lyricsPlain, setLyricsPlain] = useState('');
  const [lyricsSynced, setLyricsSynced] = useState('');
  const [cover, setCover] = useState<File | null>(null);
  const [saving, setSaving] = useState(false);
  const [justPublished, setJustPublished] = useState<null | { id: string; title: string; coverUrl: string | null; scheduled: boolean }>(null);

  // release scheduling
  const [releaseMode, setReleaseMode] = useState<'now' | 'schedule'>('now');
  const defaultScheduleAt = useMemo(() => {
    const d = new Date();
    d.setMinutes(d.getMinutes() + 60); // one hour from now
    d.setSeconds(0, 0);
    return toLocalInputValue(d);
  }, []);
  const [scheduledAt, setScheduledAt] = useState<string>(defaultScheduleAt);

  const scheduledAtDate = useMemo(() => {
    if (releaseMode !== 'schedule' || !scheduledAt) return null;
    const d = new Date(scheduledAt);
    return Number.isNaN(d.getTime()) ? null : d;
  }, [releaseMode, scheduledAt]);
  const scheduleValid = releaseMode === 'now' || (scheduledAtDate !== null && scheduledAtDate.getTime() > Date.now() + 60_000);

  const coverPreview = useFilePreview(cover);
  const linkState: LinkValidation | null = useMemo(
    () => streamUrl.trim() ? validateUploadLink(streamUrl) : null,
    [streamUrl],
  );

  const stepIndex = STEPS.findIndex((s) => s.key === step);

  const canNext = (() => {
    if (step === 'source') {
      if (tab === 'upload') return !!uploadedAudioUrl && !uploading;
      return !!linkState?.ok;
    }
    if (step === 'details') return title.trim().length > 0;
    if (step === 'schedule') return scheduleValid;
    return true;
  })();

  const next = () => {
    if (!canNext) return;
    if (step === 'source') setStep('details');
    else if (step === 'details') setStep('schedule');
    else if (step === 'schedule') setStep('review');
  };
  const back = () => {
    if (step === 'source') navigate('/artist/studio');
    else if (step === 'details') setStep('source');
    else if (step === 'schedule') setStep('details');
    else setStep('schedule');
  };

  const resetForm = () => {
    setStreamUrl(''); setTitle(''); setGenre(''); setDescription('');
    setLyricsPlain(''); setLyricsSynced(''); setCover(null);
    setReleaseMode('now'); setScheduledAt(defaultScheduleAt);
    setAudioFile(null); setUploadedAudioUrl(null); setUploadProgress(0); setUploading(false);
    setStep('source');
  };

  const fireCelebration = () => {
    const fire = (origin: { x: number; y: number }, particleCount: number, opts: confetti.Options = {}) => {
      confetti({
        particleCount, spread: 80, startVelocity: 50, ticks: 220, gravity: 0.85, scalar: 1,
        origin, disableForReducedMotion: true,
        colors: ['#FF2D55', '#FF6B8A', '#FFD166', '#34C759', '#FFFFFF'],
        ...opts,
      });
    };
    fire({ x: 0.5, y: 0.3 }, 110, { spread: 110, startVelocity: 60 });
    window.setTimeout(() => fire({ x: 0.08, y: 0.55 }, 55, { angle: 60 }), 180);
    window.setTimeout(() => fire({ x: 0.92, y: 0.55 }, 55, { angle: 120 }), 220);
    window.setTimeout(() => fire({ x: 0.5, y: 0.4 }, 70, { spread: 150, startVelocity: 30, gravity: 1.1, scalar: 1.15 }), 520);
    if (typeof navigator !== 'undefined' && 'vibrate' in navigator) {
      try { navigator.vibrate([20, 60, 24, 60, 20]); } catch { /* ignore */ }
    }
  };

  const save = async () => {
    if (!title.trim() || !scheduleValid) return;
    const finalStreamUrl = tab === 'upload' ? uploadedAudioUrl : (linkState?.ok ? linkState.normalized : null);
    if (!finalStreamUrl) return;
    setSaving(true);
    try {
      const coverUrl = cover ? await uploadArtistCover(user.id, cover) : null;
      const scheduledISO = releaseMode === 'schedule' && scheduledAtDate ? scheduledAtDate.toISOString() : null;
      const releaseDateISO = scheduledAtDate
        ? scheduledAtDate.toISOString().slice(0, 10)
        : new Date().toISOString().slice(0, 10);
      const { data, error } = await supabase
        .from('artist_songs')
        .insert({
          artist_user_id: user.id,
          title: title.trim(),
          stream_url: linkState.normalized,
          cover_url: coverUrl,
          genre: genre || null,
          description: description.trim() || null,
          release_date: releaseDateISO,
          scheduled_release_at: scheduledISO,
          lyrics_plain: lyricsPlain.trim() || null,
          lyrics_synced: lyricsSynced.trim() || null,
          lyrics_source: lyricsPlain.trim() || lyricsSynced.trim() ? 'artist' : null,
        })
        .select('id, title, cover_url, status')
        .single();
      if (error) throw error;
      if (!data?.id) throw new Error('Insert returned no row — check artist permissions.');
      const wasScheduled = data.status === 'scheduled';
      setJustPublished({ id: data.id, title: data.title, coverUrl: data.cover_url ?? null, scheduled: wasScheduled });
      fireCelebration();
      toast.success(wasScheduled ? 'Song scheduled 🗓️' : 'Song published 🎉');
      resetForm();
    } catch (e) {
      const msg = e instanceof Error ? e.message : 'Could not publish song.';
      console.error('[artist-upload] publish failed:', e);
      toast.error(msg);
    } finally {
      setSaving(false);
    }
  };


  return (
    <div className="max-w-2xl mx-auto px-5 pt-5 pb-12">
      {/* Header */}
      <div className="flex items-center gap-3">
        <button
          onClick={back}
          className="w-9 h-9 rounded-full grid place-items-center bg-white/[0.05] hover:bg-white/[0.08] active:scale-95 transition"
          aria-label="Back"
        >
          <ArrowLeft className="w-4 h-4" />
        </button>
        <div className="flex-1 min-w-0">
          <p className="text-[10px] uppercase tracking-[0.22em] text-muted-foreground/80 font-semibold">
            New release
          </p>
          <h2 className="font-display text-[24px] leading-none tracking-tight mt-1">
            Upload a song
          </h2>
        </div>
      </div>

      {/* Just published — big animated celebration card on the same screen */}
      <AnimatePresence>
        {justPublished && (
          <motion.div
            key={justPublished.id}
            initial={{ opacity: 0, y: 12, scale: 0.96 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: -8, scale: 0.98 }}
            transition={{ type: 'spring', stiffness: 220, damping: 22 }}
            className="mt-5 relative overflow-hidden rounded-3xl p-5"
            style={{
              background: 'linear-gradient(145deg, rgba(255,45,85,0.28) 0%, rgba(52,199,89,0.16) 60%, rgba(10,10,12,0.9) 100%)',
              border: '0.5px solid rgba(255,255,255,0.1)',
              boxShadow: '0 30px 80px rgba(0,0,0,0.55), inset 0 1px 0 rgba(255,255,255,0.08)',
            }}
          >
            <div className="flex items-center gap-4">
              <div className="w-16 h-16 rounded-2xl overflow-hidden bg-black/40 shrink-0 ring-1 ring-white/15 grid place-items-center">
                {justPublished.coverUrl
                  ? <img src={justPublished.coverUrl} alt="" className="w-full h-full object-cover" />
                  : <Music2 className="w-6 h-6 text-white/70" />}
              </div>
              <div className="flex-1 min-w-0">
                <motion.p
                  initial={{ opacity: 0, y: 4 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.1 }}
                  className="text-[11px] font-semibold uppercase tracking-[0.22em] text-white/85"
                >
                  {justPublished.scheduled ? '🗓️  Scheduled!' : '🎉 🎆 🎇 🎊  Published!'}
                </motion.p>
                <p className="mt-1 font-display text-[20px] leading-none tracking-tight truncate">
                  {justPublished.title}
                </p>
                <p className="mt-1.5 text-[11.5px] text-white/75">
                  {justPublished.scheduled
                    ? 'Locked in. It goes live automatically at your chosen time.'
                    : 'Live on your artist page. Views, likes and plays will start updating instantly.'}
                </p>
              </div>
            </div>
            <div className="mt-4 grid grid-cols-2 gap-2">
              <Button
                variant="ghost"
                className="h-10 rounded-xl bg-white/[0.06] hover:bg-white/[0.12] text-white text-[12.5px]"
                onClick={() => navigate('/artist/studio/songs')}
              >
                View all songs
              </Button>
              <Button
                className="h-10 rounded-xl text-[12.5px] font-semibold text-white"
                style={{ background: '#FF2D55' }}
                onClick={() => { setJustPublished(null); }}
              >
                Upload another
              </Button>
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* My uploads — realtime list, so a freshly published song appears here instantly */}
      {recentUploads.length > 0 && (
        <div className="mt-6">
          <div className="flex items-center justify-between mb-2">
            <p className="text-[11px] uppercase tracking-[0.16em] text-muted-foreground/70 font-semibold">
              My uploads · {songs.length}
            </p>
            <button
              onClick={() => navigate('/artist/studio/songs')}
              className="text-[11.5px] text-primary font-medium"
            >
              View all
            </button>
          </div>
          <div className="space-y-1.5">
            <AnimatePresence initial={false}>
              {recentUploads.map((s) => (
                <motion.div
                  key={s.id}
                  layout
                  initial={{ opacity: 0, y: -6, scale: 0.98 }}
                  animate={{ opacity: 1, y: 0, scale: 1 }}
                  exit={{ opacity: 0 }}
                  transition={{ type: 'spring', stiffness: 260, damping: 24 }}
                  className="flex items-center gap-3 p-2.5 rounded-2xl bg-white/[0.03] border border-white/[0.05]"
                >
                  <div className="w-10 h-10 rounded-xl overflow-hidden bg-black/40 shrink-0 grid place-items-center">
                    {s.cover_url
                      ? <img src={s.cover_url} alt="" className="w-full h-full object-cover" />
                      : <Music2 className="w-4 h-4 text-white/60" />}
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="text-[12.5px] font-medium truncate">{s.title}</p>
                    <p className="text-[10.5px] text-muted-foreground tabular-nums">
                      {fmt(s.play_count)} plays · {fmt(s.like_count)} likes · {fmt(s.download_count)} dl
                    </p>
                  </div>
                  {(() => {
                    const st = String(s.status);
                    return (
                      <span className={`text-[9.5px] px-1.5 py-0.5 rounded-full font-semibold uppercase tracking-wider ${
                        st === 'live' ? 'bg-emerald-500/15 text-emerald-300'
                          : st === 'scheduled' ? 'bg-amber-500/15 text-amber-300'
                          : 'bg-white/[0.06] text-muted-foreground'
                      }`}>
                        {st === 'live' ? 'Live' : st === 'scheduled' ? 'Scheduled' : st}
                      </span>
                    );
                  })()}
                </motion.div>
              ))}
            </AnimatePresence>
          </div>
        </div>
      )}

      {/* Progress rail */}
      <ProgressRail index={stepIndex} />


      {/* Step content */}
      <AnimatePresence mode="wait">
        <motion.div
          key={step}
          initial={{ opacity: 0, x: 16 }}
          animate={{ opacity: 1, x: 0 }}
          exit={{ opacity: 0, x: -16 }}
          transition={{ duration: 0.28, ease: [0.22, 1, 0.36, 1] }}
          className="mt-5"
        >
          {step === 'source' && (
            <SourceStep
              tab={tab}
              setTab={setTab}
              streamUrl={streamUrl}
              setStreamUrl={setStreamUrl}
              linkState={linkState}
            />
          )}
          {step === 'details' && (
            <DetailsStep
              title={title}
              setTitle={setTitle}
              genre={genre}
              setGenre={setGenre}
              lyricsPlain={lyricsPlain}
              setLyricsPlain={setLyricsPlain}
              lyricsSynced={lyricsSynced}
              setLyricsSynced={setLyricsSynced}
              cover={cover}
              setCover={setCover}
              coverPreview={coverPreview}
              streamUrl={linkState?.ok ? linkState.normalized : ''}
            />
          )}
          {step === 'schedule' && (
            <ScheduleStep
              releaseMode={releaseMode}
              setReleaseMode={setReleaseMode}
              scheduledAt={scheduledAt}
              setScheduledAt={setScheduledAt}
              scheduledAtDate={scheduledAtDate}
              scheduleValid={scheduleValid}
              description={description}
              setDescription={setDescription}
              minScheduleAt={defaultScheduleAt}
            />
          )}
          {step === 'review' && (
            <ReviewStep
              title={title}
              genre={genre}
              hasLyrics={Boolean(lyricsPlain.trim() || lyricsSynced.trim())}
              coverPreview={coverPreview}
              source={linkState?.ok ? linkState.source : null}
              releaseMode={releaseMode}
              scheduledAtDate={scheduledAtDate}
            />
          )}
        </motion.div>
      </AnimatePresence>

      {/* Footer */}
      <div className="mt-6 flex items-center gap-3">
        <Button
          variant="ghost"
          className="h-12 px-4 rounded-xl text-muted-foreground hover:text-foreground hover:bg-white/[0.04]"
          onClick={back}
        >
          <ArrowLeft className="w-4 h-4 mr-1.5" />
          {step === 'source' ? 'Cancel' : 'Back'}
        </Button>

        {step !== 'review' ? (
          <Button
            className="flex-1 h-12 rounded-xl font-semibold text-white"
            style={{
              background: canNext ? '#FF2D55' : 'rgba(255,255,255,0.06)',
              color: canNext ? '#fff' : 'rgba(255,255,255,0.4)',
              boxShadow: canNext ? '0 12px 30px -8px rgba(255,45,85,0.5)' : 'none',
            }}
            disabled={!canNext}
            onClick={next}
          >
            Continue <ArrowRight className="w-4 h-4 ml-1.5" />
          </Button>
        ) : (
          <Button
            className="flex-1 h-12 rounded-xl font-semibold text-white"
            style={{ background: '#FF2D55', boxShadow: '0 12px 30px -8px rgba(255,45,85,0.5)' }}
            disabled={saving}
            onClick={save}
          >
            {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : (
              <span className="flex items-center gap-2"><UploadIcon className="w-4 h-4" /> Publish to your page</span>
            )}
          </Button>
        )}
      </div>
    </div>
  );
}

/* ============================== Progress rail ============================== */
function ProgressRail({ index }: { index: number }) {
  return (
    <div className="mt-5">
      <div className="flex items-center gap-2">
        {STEPS.map((s, i) => {
          const done = i < index;
          const active = i === index;
          return (
            <div key={s.key} className="flex-1 flex items-center gap-2">
              <div className="flex-1 h-1 rounded-full overflow-hidden bg-white/[0.06]">
                <motion.div
                  initial={false}
                  animate={{ width: done || active ? '100%' : '0%' }}
                  transition={{ duration: 0.6, ease: [0.22, 1, 0.36, 1] }}
                  className="h-full"
                  style={{
                    background: done || active
                      ? 'linear-gradient(90deg, #FF2D55, #FF5A77)'
                      : 'transparent',
                  }}
                />
              </div>
            </div>
          );
        })}
      </div>
      <div className="mt-2 flex items-center justify-between">
        <p className="text-[11px] font-semibold tracking-wide text-foreground">
          Step {index + 1} of {STEPS.length} · {STEPS[index].label}
        </p>
        <p className="text-[11px] text-muted-foreground">{STEPS[index].sub}</p>
      </div>
    </div>
  );
}

/* ============================== Step 1 — Source ============================== */
function SourceStep({
  tab, setTab, streamUrl, setStreamUrl, linkState,
}: {
  tab: 'drive' | 'dropbox';
  setTab: (t: 'drive' | 'dropbox') => void;
  streamUrl: string;
  setStreamUrl: (s: string) => void;
  linkState: LinkValidation | null;
}) {
  const isValid = !!linkState?.ok;
  const linkMessage = linkState
    ? linkState.ok === false
      ? linkState.reason
      : `${linkState.source === 'drive' ? 'Google Drive' : 'Dropbox'} link looks good — we'll stream it directly.`
    : null;

  return (
    <div className="space-y-4">
      <BentoCard className="overflow-hidden">
        <div className="grid grid-cols-2">
          {(['drive', 'dropbox'] as const).map((t) => (
            <button
              key={t}
              onClick={() => setTab(t)}
              className={`px-4 py-3 text-[12.5px] font-medium flex items-center justify-center gap-2 transition relative ${
                tab === t ? 'text-foreground' : 'text-muted-foreground'
              }`}
            >
              {t === 'drive' ? <HardDrive className="w-4 h-4" /> : <Cloud className="w-4 h-4" />}
              {t === 'drive' ? 'Google Drive' : 'Dropbox'}
              {tab === t && (
                <motion.span
                  layoutId="upload-tab-underline"
                  className="absolute bottom-0 left-3 right-3 h-[2px] rounded-full"
                  style={{ background: '#FF2D55' }}
                />
              )}
            </button>
          ))}
        </div>
        <div className="p-5 pt-4 text-[12.5px] leading-relaxed text-muted-foreground space-y-2.5 border-t border-white/[0.05]">
          {tab === 'drive' ? (
            <>
              <Step n={1} text="Upload your MP3 / WAV to Google Drive." />
              <Step n={2} text={<>Right-click the file <span className="text-foreground">→ Share</span>.</>} />
              <Step n={3} text={<>Set access to <span className="text-foreground">"Anyone with the link"</span>.</>} />
              <Step n={4} text={<>Hit <span className="text-foreground">Copy link</span> and paste below.</>} />
            </>
          ) : (
            <>
              <Step n={1} text="Upload your MP3 / WAV to Dropbox." />
              <Step n={2} text={<>Hover the file <span className="text-foreground">→ Share → Create link</span>.</>} />
              <Step n={3} text={<>Hit <span className="text-foreground">Copy link</span> and paste below.</>} />
              <Step n={4} text={<>We auto-swap <code className="text-foreground">?dl=0</code> to <code className="text-foreground">?dl=1</code> so it streams.</>} />
            </>
          )}
        </div>
      </BentoCard>

      <Field label="Public share link">
        <div className="relative">
          <Link2 className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
          <Input
            value={streamUrl}
            onChange={(e) => setStreamUrl(e.target.value)}
            placeholder="https://drive.google.com/file/d/…   or   https://dropbox.com/s/…"
            className="h-12 pl-9 bg-white/[0.03] border-white/[0.08]"
            spellCheck={false}
            autoCapitalize="off"
            autoCorrect="off"
          />
        </div>
        <AnimatePresence mode="wait">
          {linkState && (
            <motion.div
              key={isValid ? 'ok' : 'bad'}
              initial={{ opacity: 0, y: -4 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0 }}
              className={`mt-2 flex items-start gap-2 text-[11.5px] ${
                isValid ? 'text-emerald-300' : 'text-rose-400'
              }`}
            >
              {isValid
                ? <CheckCircle2 className="w-3.5 h-3.5 mt-0.5 shrink-0" />
                : <AlertCircle className="w-3.5 h-3.5 mt-0.5 shrink-0" />}
              <span>{linkMessage}</span>
            </motion.div>
          )}
        </AnimatePresence>
      </Field>
    </div>
  );
}

/* ============================== Step 2 — Details ============================== */
function DetailsStep({
  title, setTitle, genre, setGenre, lyricsPlain, setLyricsPlain, lyricsSynced, setLyricsSynced, cover, setCover, coverPreview, streamUrl,
}: {
  title: string; setTitle: (s: string) => void;
  genre: string; setGenre: (s: string) => void;
  lyricsPlain: string; setLyricsPlain: (s: string) => void;
  lyricsSynced: string; setLyricsSynced: (s: string) => void;
  cover: File | null; setCover: (f: File | null) => void;
  coverPreview: string | null;
  streamUrl: string;
}) {
  return (
    <div className="space-y-5">
      {/* Waveform preview */}
      <WaveformPreview streamUrl={streamUrl} cover={coverPreview} title={title || 'Untitled'} />

      <Field label="Song title">
        <Input
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          placeholder="e.g. Midnight Run"
          maxLength={80}
          className="h-12 bg-white/[0.03] border-white/[0.08]"
        />
        <p className="mt-1.5 text-[11px] text-muted-foreground tabular-nums">
          {title.length}/80
        </p>
      </Field>

      <Field label="Genre / mood">
        <div className="flex flex-wrap gap-1.5">
          {GENRES.map((g) => (
            <button
              key={g}
              type="button"
              onClick={() => setGenre(g === genre ? '' : g)}
              className={`px-3 h-8 rounded-full text-[11.5px] font-medium transition ${
                genre === g
                  ? 'bg-white text-black shadow-[0_4px_12px_rgba(255,255,255,0.12)]'
                  : 'bg-white/[0.05] text-muted-foreground hover:text-foreground active:scale-95'
              }`}
            >
              {g}
            </button>
          ))}
        </div>
      </Field>

      <Field label="Cover art">
        <label className="rounded-2xl border border-dashed border-white/10 bg-white/[0.03] p-3.5 flex items-center gap-3 cursor-pointer hover:border-white/20 transition">
          <div className="w-16 h-16 rounded-xl bg-white/[0.04] grid place-items-center overflow-hidden ring-1 ring-white/10">
            {cover
              ? <img src={coverPreview || undefined} className="w-full h-full object-cover" alt="" />
              : <ImageIcon className="w-5 h-5 text-muted-foreground" />}
          </div>
          <div className="flex-1 min-w-0">
            <p className="text-[12.5px] text-foreground truncate">
              {cover ? cover.name : 'Tap to pick cover'}
            </p>
            <p className="text-[11px] text-muted-foreground mt-0.5">
              Square 1500×1500, JPG or PNG, no watermark.
            </p>
          </div>
          <input
            type="file"
            accept="image/*"
            className="sr-only"
            onChange={(e) => {
              setCover(e.target.files?.[0] ?? null);
              e.target.value = '';
            }}
          />
        </label>
      </Field>

      <Field label="Lyrics (optional)">
        <Textarea
          value={lyricsPlain}
          onChange={(e) => setLyricsPlain(e.target.value)}
          placeholder="Paste plain lyrics here"
          maxLength={12000}
          className="min-h-32 bg-white/[0.03] border-white/[0.08] resize-none"
        />
      </Field>

      <Field label="Synced LRC lyrics (optional)">
        <Textarea
          value={lyricsSynced}
          onChange={(e) => setLyricsSynced(e.target.value)}
          placeholder="[00:12.30] First line"
          maxLength={20000}
          className="min-h-24 bg-white/[0.03] border-white/[0.08] resize-none font-mono text-[12px]"
          spellCheck={false}
        />
      </Field>
    </div>
  );
}

/* ============================== Waveform preview ============================== */
function WaveformPreview({
  streamUrl, cover, title,
}: { streamUrl: string; cover: string | null; title: string }) {
  const bars = useMemo(() => pseudoWaveform(streamUrl || title, 56), [streamUrl, title]);
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const [playing, setPlaying] = useState(false);
  const [progress, setProgress] = useState(0);

  useEffect(() => {
    setPlaying(false);
    setProgress(0);
    audioRef.current?.pause();
  }, [streamUrl]);

  const toggle = async () => {
    const a = audioRef.current;
    if (!a) return;
    if (playing) { a.pause(); setPlaying(false); return; }
    try { await a.play(); setPlaying(true); }
    catch { toast.error('Preview blocked — open the link in Drive/Dropbox to confirm it streams.'); }
  };

  return (
    <BentoCard glow className="p-4">
      <div className="flex items-center gap-3">
        <div className="w-14 h-14 rounded-xl overflow-hidden bg-black/40 shrink-0 ring-1 ring-white/10">
          {cover
            ? <img src={cover} alt="" className="w-full h-full object-cover" />
            : <div className="w-full h-full grid place-items-center"><Music2 className="w-5 h-5 text-muted-foreground" /></div>}
        </div>
        <div className="flex-1 min-w-0">
          <p className="text-[10.5px] uppercase tracking-[0.2em] text-primary/90 font-semibold flex items-center gap-1.5">
            <Play className="w-3 h-3" /> Preview
          </p>
          <p className="text-[14px] font-semibold truncate mt-0.5 font-display">{title}</p>
        </div>
        <button
          onClick={toggle}
          className="w-11 h-11 rounded-full grid place-items-center text-white shrink-0 active:scale-95 transition"
          style={{ background: '#FF2D55', boxShadow: '0 10px 24px -8px rgba(255,45,85,0.6)' }}
          aria-label={playing ? 'Pause' : 'Play'}
        >
          {playing ? <Pause className="w-4 h-4" fill="currentColor" /> : <Play className="w-4 h-4 ml-0.5" fill="currentColor" />}
        </button>
      </div>

      {/* Waveform */}
      <div className="mt-4 h-[68px] flex items-end gap-[3px]">
        {bars.map((v, i) => {
          const isPast = i / bars.length <= progress;
          return (
            <span
              key={i}
              className="flex-1 rounded-full transition-colors"
              style={{
                height: `${v * 100}%`,
                background: isPast
                  ? 'linear-gradient(180deg, #FF5A77, #FF2D55)'
                  : 'rgba(255,255,255,0.14)',
              }}
            />
          );
        })}
      </div>

      <audio
        ref={audioRef}
        src={streamUrl || undefined}
        preload="none"
        crossOrigin="anonymous"
        onTimeUpdate={(e) => {
          const a = e.currentTarget;
          if (a.duration) setProgress(a.currentTime / a.duration);
        }}
        onEnded={() => { setPlaying(false); setProgress(0); }}
      />
    </BentoCard>
  );
}

/* ============================== Step 3 — Schedule ============================== */
function ScheduleStep({
  releaseMode, setReleaseMode, scheduledAt, setScheduledAt, scheduledAtDate,
  scheduleValid, description, setDescription, minScheduleAt,
}: {
  releaseMode: 'now' | 'schedule';
  setReleaseMode: (v: 'now' | 'schedule') => void;
  scheduledAt: string;
  setScheduledAt: (v: string) => void;
  scheduledAtDate: Date | null;
  scheduleValid: boolean;
  description: string;
  setDescription: (v: string) => void;
  minScheduleAt: string;
}) {
  return (
    <div className="space-y-4">
      <BentoCard className="p-5">
        <p className="text-[10px] uppercase tracking-[0.22em] text-muted-foreground/80 font-semibold mb-3">
          When should it go live?
        </p>
        <div className="grid grid-cols-2 gap-2.5">
          <button
            type="button"
            onClick={() => setReleaseMode('now')}
            className={`text-left p-3.5 rounded-2xl border transition ${
              releaseMode === 'now'
                ? 'bg-primary/10 border-primary/60 shadow-[0_0_0_1px_rgba(255,45,85,0.35)]'
                : 'bg-white/[0.03] border-white/[0.06] hover:bg-white/[0.05]'
            }`}
          >
            <div className="flex items-center gap-1.5 text-[12px] font-semibold">
              <Zap className="w-3.5 h-3.5" /> Publish now
            </div>
            <p className="mt-1 text-[10.5px] text-muted-foreground leading-snug">
              Goes live the moment you hit publish.
            </p>
          </button>
          <button
            type="button"
            onClick={() => setReleaseMode('schedule')}
            className={`text-left p-3.5 rounded-2xl border transition ${
              releaseMode === 'schedule'
                ? 'bg-primary/10 border-primary/60 shadow-[0_0_0_1px_rgba(255,45,85,0.35)]'
                : 'bg-white/[0.03] border-white/[0.06] hover:bg-white/[0.05]'
            }`}
          >
            <div className="flex items-center gap-1.5 text-[12px] font-semibold">
              <CalendarClock className="w-3.5 h-3.5" /> Schedule
            </div>
            <p className="mt-1 text-[10.5px] text-muted-foreground leading-snug">
              Pick a future date & time. Auto-publishes.
            </p>
          </button>
        </div>

        {releaseMode === 'schedule' && (
          <div className="mt-4">
            <Field label="Release date & time">
              <input
                type="datetime-local"
                value={scheduledAt}
                min={minScheduleAt}
                onChange={(e) => setScheduledAt(e.target.value)}
                className="w-full h-11 px-3 rounded-xl bg-white/[0.04] border border-white/[0.06] text-[13px] focus:outline-none focus:border-primary/60"
              />
            </Field>
            <p className={`mt-2 text-[11px] flex items-center gap-1.5 ${scheduleValid ? 'text-emerald-300/90' : 'text-amber-300/90'}`}>
              <Clock className="w-3 h-3" />
              {scheduleValid && scheduledAtDate
                ? `Goes live ${scheduledAtDate.toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' })}`
                : 'Pick a time at least a minute in the future.'}
            </p>
          </div>
        )}
      </BentoCard>

      <BentoCard className="p-5">
        <p className="text-[10px] uppercase tracking-[0.22em] text-muted-foreground/80 font-semibold mb-3">
          Release notes <span className="text-muted-foreground/50 normal-case tracking-normal">· optional</span>
        </p>
        <textarea
          value={description}
          onChange={(e) => setDescription(e.target.value.slice(0, 400))}
          placeholder="Tell fans the story behind this track…"
          rows={4}
          className="w-full p-3 rounded-xl bg-white/[0.04] border border-white/[0.06] text-[13px] leading-relaxed focus:outline-none focus:border-primary/60 resize-none"
        />
        <div className="mt-1 text-right text-[10px] text-muted-foreground/60 tabular-nums">
          {description.length}/400
        </div>
      </BentoCard>
    </div>
  );
}

/* ============================== Step 4 — Review ============================== */
function ReviewStep({
  title, genre, hasLyrics, coverPreview, source, releaseMode, scheduledAtDate,
}: {
  title: string;
  genre: string;
  hasLyrics: boolean;
  coverPreview: string | null;
  source: 'drive' | 'dropbox' | null;
  releaseMode: 'now' | 'schedule';
  scheduledAtDate: Date | null;
}) {
  const scheduleLabel = releaseMode === 'schedule' && scheduledAtDate
    ? scheduledAtDate.toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' })
    : null;
  return (
    <div className="space-y-4">
      <BentoCard className="p-5">
        <p className="text-[10px] uppercase tracking-[0.22em] text-muted-foreground/80 font-semibold mb-3">
          How it'll appear
        </p>
        <div className="flex items-center gap-3">
          <div className="w-20 h-20 rounded-2xl overflow-hidden bg-black/40 ring-1 ring-white/10 shrink-0">
            {coverPreview
              ? <img src={coverPreview} alt="" className="w-full h-full object-cover" />
              : <div className="w-full h-full grid place-items-center"><Music2 className="w-7 h-7 text-muted-foreground" /></div>}
          </div>
          <div className="flex-1 min-w-0">
            <p className="font-display text-[18px] truncate">{title || 'Untitled'}</p>
            <div className="mt-1.5 flex flex-wrap gap-1.5">
              {genre && (
                <span className="px-2 py-0.5 rounded-full text-[10px] font-medium bg-white/[0.06] text-foreground/80">
                  {genre}
                </span>
              )}
              {source && (
                <span
                  className="px-2 py-0.5 rounded-full text-[10px] font-medium inline-flex items-center gap-1"
                  style={{
                    background: source === 'drive' ? 'rgba(66,133,244,0.14)' : 'rgba(0,97,242,0.14)',
                    color: source === 'drive' ? '#7BB3FF' : '#7BB3FF',
                  }}
                >
                  {source === 'drive' ? <HardDrive className="w-2.5 h-2.5" /> : <Cloud className="w-2.5 h-2.5" />}
                  {source === 'drive' ? 'Google Drive' : 'Dropbox'}
                </span>
              )}
              {hasLyrics && (
                <span className="px-2 py-0.5 rounded-full text-[10px] font-medium bg-white/[0.06] text-foreground/80">
                  Lyrics ready
                </span>
              )}
              <span
                className="px-2 py-0.5 rounded-full text-[10px] font-medium inline-flex items-center gap-1"
                style={{
                  background: scheduleLabel ? 'rgba(245,158,11,0.14)' : 'rgba(52,199,89,0.14)',
                  color: scheduleLabel ? '#FCD34D' : '#86EFAC',
                }}
              >
                {scheduleLabel ? <CalendarClock className="w-2.5 h-2.5" /> : <Zap className="w-2.5 h-2.5" />}
                {scheduleLabel ? `Live ${scheduleLabel}` : 'Publish instantly'}
              </span>
            </div>
          </div>
        </div>
      </BentoCard>

      <BentoCard className="p-5">
        <p className="text-[10px] uppercase tracking-[0.22em] text-muted-foreground/80 font-semibold mb-3">
          Before you publish
        </p>
        <ul className="space-y-2.5 text-[12.5px] text-muted-foreground">
          <Bullet text="You own this recording or have explicit rights to distribute it." />
          <Bullet text="The cover art is your own — no copyrighted images or watermarks." />
          <Bullet text="The share link is set to 'Anyone with the link' so Universflow can stream it." />
        </ul>
      </BentoCard>
    </div>
  );
}

function Bullet({ text }: { text: string }) {
  return (
    <li className="flex items-start gap-2">
      <CheckCircle2 className="w-3.5 h-3.5 mt-0.5 text-emerald-300 shrink-0" />
      <span>{text}</span>
    </li>
  );
}

function Step({ n, text }: { n: number; text: React.ReactNode }) {
  return (
    <div className="flex items-start gap-2.5">
      <span className="w-5 h-5 rounded-full bg-primary/15 text-primary text-[10.5px] font-semibold grid place-items-center shrink-0 mt-0.5">
        {n}
      </span>
      <span>{text}</span>
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="block">
      <span className="block text-[10.5px] uppercase tracking-[0.2em] text-muted-foreground/80 font-semibold mb-2">
        {label}
      </span>
      {children}
    </label>
  );
}
