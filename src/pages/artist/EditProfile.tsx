import { useEffect, useMemo, useState } from 'react';
import { useOutletContext } from '@/lib/router-compat';
import { Loader2, Image as ImageIcon, Check, Palette, X, Star, Plus, Trash2 } from 'lucide-react';
import { toast } from 'sonner';
import { supabase } from '@/integrations/supabase/client';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { uploadArtistPhoto, uploadArtistCover, uploadArtistGalleryPhoto } from '@/lib/artist';
import { useFilePreview } from '@/lib/useFilePreview';
import { ArtistProfile } from './_shared';

type Ctx = { profile: ArtistProfile; user: { id: string } };

const ACCENT_SWATCHES = [
  '#FF2D55', '#FF6B6B', '#F59E0B', '#EAB308', '#22C55E', '#10B981',
  '#06B6D4', '#3B82F6', '#8B5CF6', '#A855F7', '#EC4899', '#F43F5E',
];

const GENRE_PRESETS = [
  'Hip-Hop', 'R&B', 'Pop', 'Rock', 'Indie', 'Electronic', 'House', 'Techno',
  'Lo-Fi', 'Jazz', 'Soul', 'Afrobeats', 'Punjabi', 'Hindi', 'Bollywood',
  'Trap', 'Drill', 'Ambient', 'Classical', 'Country', 'Reggae', 'K-Pop',
];

export default function EditProfile() {
  const { profile, user } = useOutletContext<Ctx>();
  const stage = profile.stage_name;

  // Identity + display
  const [bio, setBio] = useState(profile.bio ?? '');
  const [tagline, setTagline] = useState(profile.tagline ?? '');
  const [pronouns, setPronouns] = useState(profile.pronouns ?? '');
  const [location, setLocation] = useState(profile.location ?? '');
  const [website, setWebsite] = useState(profile.website ?? '');
  const [accent, setAccent] = useState(profile.accent_color ?? '#FF2D55');
  const [genres, setGenres] = useState<string[]>(profile.genres ?? []);

  // Socials
  const [insta, setInsta] = useState(profile.social_links?.instagram ?? '');
  const [yt, setYt] = useState(profile.social_links?.youtube ?? '');
  const [sp, setSp] = useState(profile.social_links?.spotify ?? '');
  const [apm, setApm] = useState(profile.social_links?.apple_music ?? '');
  const [tiktok, setTiktok] = useState(profile.social_links?.tiktok ?? '');
  const [twitter, setTwitter] = useState(profile.social_links?.twitter ?? '');
  const [facebook, setFacebook] = useState(profile.social_links?.facebook ?? '');
  const [soundcloud, setSoundcloud] = useState(profile.social_links?.soundcloud ?? '');

  // Media
  const [avatar, setAvatar] = useState<File | null>(null);
  const [banner, setBanner] = useState<File | null>(null);
  const [saving, setSaving] = useState(false);

  // Artist Pick + Gallery
  const [pickSongId, setPickSongId] = useState<string | null>(profile.artist_pick_song_id ?? null);
  const [pickMessage, setPickMessage] = useState<string>(profile.artist_pick_message ?? '');
  const [liveSongs, setLiveSongs] = useState<Array<{ id: string; title: string; cover_url: string | null }>>([]);
  const [gallery, setGallery] = useState<string[]>(profile.gallery_urls ?? []);
  const [uploadingGallery, setUploadingGallery] = useState(false);

  useEffect(() => {
    (async () => {
      const { data } = await supabase
        .from('artist_songs')
        .select('id,title,cover_url')
        .eq('artist_user_id', user.id)
        .eq('status', 'live')
        .order('created_at', { ascending: false });
      setLiveSongs((data ?? []) as Array<{ id: string; title: string; cover_url: string | null }>);
    })();
  }, [user.id]);

  const accentValid = useMemo(() => /^#[0-9a-fA-F]{6}$/.test(accent), [accent]);

  const toggleGenre = (g: string) => {
    setGenres((prev) => {
      if (prev.includes(g)) return prev.filter((x) => x !== g);
      if (prev.length >= 5) {
        toast.info('Pick up to 5 genres — the top 5 already work best.');
        return prev;
      }
      return [...prev, g];
    });
  };

  const cleanUrl = (v: string) => {
    const t = v.trim();
    if (!t) return null;
    if (!/^https?:\/\//i.test(t)) return `https://${t}`;
    return t;
  };

  const save = async () => {
    if (accent && !accentValid) {
      toast.error('Accent must be a hex color like #FF2D55.');
      return;
    }
    setSaving(true);
    try {
      const [newAvatar, newBanner] = await Promise.all([
        avatar ? uploadArtistPhoto(user.id, avatar) : Promise.resolve(profile.avatar_url),
        banner ? uploadArtistCover(user.id, banner) : Promise.resolve(profile.banner_url),
      ]);
      const { error } = await supabase
        .from('artist_profiles')
        .update({
          bio: bio.trim() || null,
          tagline: tagline.trim() || null,
          pronouns: pronouns.trim() || null,
          location: location.trim() || null,
          website: cleanUrl(website),
          accent_color: accentValid ? accent : null,
          genres: genres.length ? genres : null,
          avatar_url: newAvatar,
          banner_url: newBanner,
          artist_pick_song_id: pickSongId,
          artist_pick_message: pickSongId ? (pickMessage.trim() || null) : null,
          gallery_urls: gallery,
          social_links: {
            instagram: cleanUrl(insta),
            youtube: cleanUrl(yt),
            spotify: cleanUrl(sp),
            apple_music: cleanUrl(apm),
            tiktok: cleanUrl(tiktok),
            twitter: cleanUrl(twitter),
            facebook: cleanUrl(facebook),
            soundcloud: cleanUrl(soundcloud),
          },
        })
        .eq('user_id', user.id);
      if (error) throw error;
      toast.success('Profile updated ✓');
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Could not save profile.');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="max-w-2xl mx-auto px-5 pt-5 pb-32">
      <h2 className="text-[20px] font-semibold tracking-tight">Edit profile</h2>
      <p className="text-[12.5px] text-muted-foreground mt-0.5">
        Live on your public page at <code className="text-foreground">/a/{profile.slug}</code>.
      </p>

      <div className="space-y-5 mt-5">
        <Section title="Identity">
          <Field label="Stage name (locked)">
            <Input value={stage} disabled readOnly className="opacity-70 cursor-not-allowed" />
            <p className="mt-1.5 text-[11px] text-muted-foreground/80">
              Verified stage names are locked. Contact support to change it.
            </p>
          </Field>
          <div className="grid grid-cols-2 gap-3">
            <Field label="Pronouns">
              <Input value={pronouns} onChange={(e) => setPronouns(e.target.value)} maxLength={24} placeholder="she/her" />
            </Field>
            <Field label="Location">
              <Input value={location} onChange={(e) => setLocation(e.target.value)} maxLength={60} placeholder="Mumbai, IN" />
            </Field>
          </div>
          <Field label="Tagline">
            <Input value={tagline} onChange={(e) => setTagline(e.target.value)} maxLength={80} placeholder="One line that describes your sound." />
            <p className="mt-1 text-[11px] text-muted-foreground/70">{tagline.length}/80</p>
          </Field>
          <Field label="Bio">
            <Textarea value={bio} onChange={(e) => setBio(e.target.value)} maxLength={500} rows={4} placeholder="Tell listeners about your sound." />
            <p className="mt-1 text-[11px] text-muted-foreground/70">{bio.length}/500</p>
          </Field>
        </Section>

        <Section title="Photos">
          <div className="grid grid-cols-2 gap-3">
            <PhotoField label="Profile photo" current={profile.avatar_url} file={avatar} onPick={setAvatar} />
            <PhotoField label="Banner" current={profile.banner_url} file={banner} onPick={setBanner} />
          </div>
        </Section>

        <Section title="Artist Pick" hint="Featured on your public page.">
          {liveSongs.length === 0 ? (
            <p className="text-[12.5px] text-muted-foreground">
              Publish a live song to feature it here.
            </p>
          ) : (
            <>
              <div className="grid grid-cols-1 gap-1.5 max-h-64 overflow-y-auto pr-1">
                <button
                  type="button"
                  onClick={() => setPickSongId(null)}
                  className={`flex items-center gap-3 p-2 rounded-xl border text-left transition ${
                    !pickSongId ? 'border-white/40 bg-white/[0.05]' : 'border-white/5 bg-white/[0.02]'
                  }`}
                >
                  <div className="w-10 h-10 rounded-lg bg-white/[0.04] grid place-items-center">
                    <X className="w-4 h-4 text-muted-foreground" />
                  </div>
                  <span className="text-[13px]">No Artist Pick</span>
                </button>
                {liveSongs.map((s) => (
                  <button
                    key={s.id}
                    type="button"
                    onClick={() => setPickSongId(s.id)}
                    className={`flex items-center gap-3 p-2 rounded-xl border text-left transition ${
                      pickSongId === s.id ? 'border-white/40 bg-white/[0.05]' : 'border-white/5 bg-white/[0.02]'
                    }`}
                  >
                    <div className="w-10 h-10 rounded-lg overflow-hidden bg-white/[0.04] shrink-0">
                      {s.cover_url
                        ? <img src={s.cover_url} className="w-full h-full object-cover" alt="" />
                        : <div className="w-full h-full grid place-items-center"><ImageIcon className="w-4 h-4 text-muted-foreground" /></div>}
                    </div>
                    <span className="text-[13px] truncate flex-1">{s.title}</span>
                    {pickSongId === s.id && (
                      <Star className="w-4 h-4 text-yellow-400 shrink-0" fill="currentColor" />
                    )}
                  </button>
                ))}
              </div>
              {pickSongId && (
                <div className="mt-3">
                  <Textarea
                    value={pickMessage}
                    onChange={(e) => setPickMessage(e.target.value)}
                    maxLength={140}
                    rows={2}
                    placeholder="A short message to your fans about this track…"
                  />
                  <p className="mt-1 text-[11px] text-muted-foreground/70">{pickMessage.length}/140</p>
                </div>
              )}
            </>
          )}
        </Section>

        <Section title="Photo gallery" hint={`Up to 12. ${gallery.length}/12`}>
          <div className="grid grid-cols-3 gap-2">
            {gallery.map((url, idx) => (
              <div
                key={url + idx}
                className="relative aspect-square rounded-xl overflow-hidden bg-white/[0.03] border border-white/5 group"
              >
                <img src={url} alt="" className="w-full h-full object-cover" />
                <button
                  type="button"
                  onClick={() => setGallery((g) => g.filter((_, i) => i !== idx))}
                  className="absolute top-1.5 right-1.5 w-7 h-7 rounded-full grid place-items-center bg-black/60 backdrop-blur-md border border-white/15 opacity-0 group-hover:opacity-100 focus:opacity-100 transition"
                  aria-label="Remove"
                >
                  <Trash2 className="w-3.5 h-3.5" />
                </button>
              </div>
            ))}
            {gallery.length < 12 && (
              <label
                className={`aspect-square rounded-xl border border-dashed border-white/15 bg-white/[0.02] grid place-items-center cursor-pointer text-muted-foreground text-[11px] ${
                  uploadingGallery ? 'opacity-60 pointer-events-none' : 'hover:bg-white/[0.04]'
                }`}
              >
                {uploadingGallery
                  ? <Loader2 className="w-4 h-4 animate-spin" />
                  : <div className="flex flex-col items-center gap-1"><Plus className="w-4 h-4" /><span>Add</span></div>}
                <input
                  type="file"
                  accept="image/*"
                  className="sr-only"
                  onChange={async (e) => {
                    const f = e.target.files?.[0];
                    e.target.value = '';
                    if (!f) return;
                    setUploadingGallery(true);
                    try {
                      const url = await uploadArtistGalleryPhoto(user.id, f);
                      setGallery((g) => [...g, url].slice(0, 12));
                    } catch (err) {
                      toast.error(err instanceof Error ? err.message : 'Upload failed');
                    } finally {
                      setUploadingGallery(false);
                    }
                  }}
                />
              </label>
            )}
          </div>
        </Section>

        <Section title="Brand color" hint="Used as your public-page accent.">
          <div className="flex items-center gap-3">
            <div
              className="w-11 h-11 rounded-xl border border-white/10 shrink-0"
              style={{ background: accentValid ? accent : 'transparent' }}
            />
            <Input
              value={accent}
              onChange={(e) => setAccent(e.target.value)}
              maxLength={7}
              className="font-mono"
              placeholder="#FF2D55"
            />
            <Palette className="w-4 h-4 text-muted-foreground shrink-0" />
          </div>
          <div className="mt-3 flex flex-wrap gap-2">
            {ACCENT_SWATCHES.map((c) => (
              <button
                key={c}
                type="button"
                onClick={() => setAccent(c)}
                aria-label={`Accent ${c}`}
                className={`w-8 h-8 rounded-full border transition ${accent.toLowerCase() === c.toLowerCase() ? 'border-white scale-110' : 'border-white/10'}`}
                style={{ background: c }}
              />
            ))}
          </div>
        </Section>

        <Section title="Genres" hint="Pick up to 5.">
          <div className="flex flex-wrap gap-2">
            {GENRE_PRESETS.map((g) => {
              const active = genres.includes(g);
              return (
                <button
                  key={g}
                  type="button"
                  onClick={() => toggleGenre(g)}
                  className={`px-3 h-8 rounded-full text-[12.5px] font-medium border transition ${
                    active
                      ? 'bg-white text-black border-white'
                      : 'bg-white/[0.03] text-muted-foreground border-white/10 hover:text-foreground'
                  }`}
                >
                  {active && <Check className="w-3 h-3 inline -mt-0.5 mr-1" />}
                  {g}
                </button>
              );
            })}
          </div>
        </Section>

        <Section title="Links">
          <div className="space-y-2.5">
            <Input value={website} onChange={(e) => setWebsite(e.target.value)} placeholder="Website (yoursite.com)" />
            <Input value={insta} onChange={(e) => setInsta(e.target.value)} placeholder="Instagram URL" />
            <Input value={tiktok} onChange={(e) => setTiktok(e.target.value)} placeholder="TikTok URL" />
            <Input value={yt} onChange={(e) => setYt(e.target.value)} placeholder="YouTube URL" />
            <Input value={twitter} onChange={(e) => setTwitter(e.target.value)} placeholder="X / Twitter URL" />
            <Input value={facebook} onChange={(e) => setFacebook(e.target.value)} placeholder="Facebook URL" />
            <Input value={sp} onChange={(e) => setSp(e.target.value)} placeholder="Spotify artist URL" />
            <Input value={apm} onChange={(e) => setApm(e.target.value)} placeholder="Apple Music URL" />
            <Input value={soundcloud} onChange={(e) => setSoundcloud(e.target.value)} placeholder="SoundCloud URL" />
          </div>
        </Section>

        <Button
          className="w-full h-12 rounded-xl font-semibold text-white"
          style={{ background: accentValid ? accent : '#FF2D55' }}
          disabled={saving}
          onClick={save}
        >
          {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : (
            <span className="flex items-center gap-2"><Check className="w-4 h-4" /> Save changes</span>
          )}
        </Button>

        <p className="text-[11px] text-muted-foreground/70 text-center">
          Reminder: Universflow does not currently pay royalties or per-stream payouts. Publishing music is voluntary.
        </p>
      </div>
    </div>
  );
}

function Section({ title, hint, children }: { title: string; hint?: string; children: React.ReactNode }) {
  return (
    <section className="rounded-2xl border border-white/5 bg-white/[0.015] p-4 space-y-3">
      <div className="flex items-baseline justify-between">
        <h3 className="text-[13px] font-semibold tracking-tight">{title}</h3>
        {hint && <span className="text-[11px] text-muted-foreground/70">{hint}</span>}
      </div>
      {children}
    </section>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="block">
      <span className="block text-[11px] uppercase tracking-[0.16em] text-muted-foreground/70 mb-2">{label}</span>
      {children}
    </label>
  );
}

function PhotoField({
  label, current, file, onPick,
}: { label: string; current: string | null; file: File | null; onPick: (f: File | null) => void }) {
  const preview = useFilePreview(file);
  const src = preview || current;
  return (
    <label className="block">
      <span className="block text-[11px] uppercase tracking-[0.16em] text-muted-foreground/70 mb-2">{label}</span>
      <div className="rounded-2xl border border-dashed border-white/10 bg-white/[0.03] p-3 flex items-center gap-3 cursor-pointer">
        <div className="w-14 h-14 rounded-xl bg-white/[0.04] flex items-center justify-center overflow-hidden">
          {src
            ? <img src={src} className="w-full h-full object-cover" alt="" />
            : <ImageIcon className="w-5 h-5 text-muted-foreground" />}
        </div>
        <span className="text-[12px] text-muted-foreground flex-1 truncate">
          {file ? file.name : preview ? 'Tap to replace' : 'Tap to upload'}
        </span>
        {file && (
          <button
            type="button"
            onClick={(e) => { e.preventDefault(); onPick(null); }}
            className="p-1 rounded-full hover:bg-white/10"
            aria-label="Remove"
          >
            <X className="w-3.5 h-3.5" />
          </button>
        )}
        <input
          type="file"
          accept="image/*"
          className="sr-only"
          onChange={(e) => {
            onPick(e.target.files?.[0] ?? null);
            e.target.value = '';
          }}
        />
      </div>
    </label>
  );
}
