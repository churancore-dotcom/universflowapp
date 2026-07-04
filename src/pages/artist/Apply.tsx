import { useEffect, useId, useMemo, useRef, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { motion, AnimatePresence } from 'framer-motion';
import {
  ArrowLeft, ArrowRight, Loader2, Upload, Check, ShieldCheck, User,
  Music, Camera, Image as ImageIcon, Sparkles, ExternalLink,
} from 'lucide-react';
import { toast } from 'sonner';
import confetti from 'canvas-confetti';
import SEOHead from '@/components/SEOHead';
import { FadeTransition } from '@/components/PageTransition';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import FaceLivenessCapture, { LivenessShots } from '@/components/FaceLivenessCapture';
import { useAuth } from '@/contexts/AuthContext';
import { supabase } from '@/integrations/supabase/client';
import type { Json } from '@/integrations/supabase/types';
import { detectCountrySilently } from '@/lib/geoCountry';
import { useFilePreview } from '@/lib/useFilePreview';
import {
  getArtistReapplyState,
  getMyApplication,
  uploadArtistPhoto,
  uploadLivenessCapture,
} from '@/lib/artist';
import type { ArtistApplicationSafe } from '@/lib/artist';
import ArtistLoading from './ArtistLoading';
import { validatePhone, getDialCode, PHONE_DIGITS } from '@/lib/phoneValidator';
import { validateSocialLink, atLeastNValidLinks, SocialPlatform } from '@/lib/socialLinkValidator';
import { validateMusicPlatformUrl } from '@/lib/musicPlatformValidator';
import { COUNTRIES as ALL_COUNTRIES, getCountry } from '@/lib/countries';
import { CountryCombobox } from '@/components/CountryCombobox';
import LegalSheet, { type LegalDocKey } from '@/components/LegalSheet';

type Step = 1 | 2 | 3 | 4 | 5;
const TOTAL_STEPS = 5;

type SocialLinksDraft = {
  instagram?: unknown; youtube?: unknown; spotify?: unknown; apple_music?: unknown; bio?: unknown;
};

function asSocialLinks(value: Json | null): SocialLinksDraft {
  return value && typeof value === 'object' && !Array.isArray(value) ? value : {};
}

function getApplicationId(value: unknown): string | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const record = value as { application_id?: unknown; id?: unknown };
  const id = record.application_id ?? record.id;
  return typeof id === 'string' ? id : null;
}

const STEP_META: Record<Step, { label: string; icon: typeof User }> = {
  1: { label: 'About you',      icon: User },
  2: { label: 'Your music',     icon: Music },
  3: { label: 'Live face check', icon: Camera },
  4: { label: 'Profile photo',  icon: ImageIcon },
  5: { label: 'Submit',         icon: Sparkles },
};

function FilePicker({
  label, file, onPick, accept = 'image/*',
}: {
  label: string;
  file: File | null;
  onPick: (f: File | null) => void;
  accept?: string;
}) {
  const preview = useFilePreview(file);
  const inputId = useId();
  return (
    <div className="block">
      <span className="block text-[11px] uppercase tracking-[0.16em] text-muted-foreground/70 mb-2">
        {label}
      </span>
      <label
        htmlFor={inputId}
        role="button"
        tabIndex={0}
        onKeyDown={(e) => {
          if (e.key === 'Enter' || e.key === ' ') {
            e.preventDefault();
            document.getElementById(inputId)?.click();
          }
        }}
        className="relative rounded-2xl border border-dashed border-white/12 bg-white/[0.03] p-4 flex items-center gap-3 active:bg-white/[0.06] transition cursor-pointer"
      >
        {file ? (
          <>
            <div className="w-14 h-14 rounded-xl overflow-hidden bg-black/40 flex items-center justify-center shrink-0">
              <img src={preview || undefined} alt="preview" className="w-full h-full object-cover" />
            </div>
            <div className="flex-1 min-w-0">
              <p className="text-[13px] font-medium truncate">{file.name}</p>
              <p className="text-[11px] text-muted-foreground">{(file.size / 1024).toFixed(0)} KB</p>
            </div>
            <span className="text-[12px] text-primary px-2 py-1 font-medium">Change</span>
          </>
        ) : (
          <>
            <div className="w-14 h-14 rounded-xl bg-primary/10 flex items-center justify-center shrink-0">
              <Upload className="w-5 h-5 text-primary" />
            </div>
            <div className="flex-1">
              <p className="text-[13px] font-medium">Tap to upload</p>
              <p className="text-[11px] text-muted-foreground">JPG, PNG or WebP · auto-compressed</p>
            </div>
          </>
        )}
        <input
          id={inputId}
          type="file"
          accept={accept}
          className="absolute inset-0 z-10 h-full w-full cursor-pointer opacity-0"
          aria-label={label}
          onChange={(e) => {
            const f = e.target.files?.[0] ?? null;
            onPick(f);
            e.target.value = '';
          }}
        />
      </label>
    </div>
  );
}

export default function ArtistApply() {
  const { user, isLoading, signOut } = useAuth();
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const isReapplyMode = searchParams.get('mode') === 'reapply';
  const [bootChecked, setBootChecked] = useState(false);
  const [step, setStep] = useState<Step>(1);
  const [submitting, setSubmitting] = useState(false);
  const [submittedSuccess, setSubmittedSuccess] = useState<null | { reapply: boolean }>(null);
  const [existingApp, setExistingApp] = useState<ArtistApplicationSafe | null>(null);
  const isLockedReapply = isReapplyMode && !!existingApp;

  // form state
  const [stageName, setStageName] = useState('');
  const [realName, setRealName] = useState('');
  const [phone, setPhone] = useState('');
  const [country, setCountry] = useState('');
  const [bio, setBio] = useState('');
  const [musicPlatformUrl, setMusicPlatformUrl] = useState('');
  const [instagram, setInstagram] = useState('');
  const [youtube, setYoutube] = useState('');
  const [spotify, setSpotify] = useState('');
  const [appleMusic, setAppleMusic] = useState('');

  const [photo, setPhoto] = useState<File | null>(null);
  const [agreeTerms, setAgreeTerms] = useState(false);
  const [agreePrivacy, setAgreePrivacy] = useState(false);
  const [livenessShots, setLivenessShots] = useState<LivenessShots | null>(null);
  const [ownershipConfirmed, setOwnershipConfirmed] = useState(false);

  // A short per-user code the artist temporarily pastes into their
  // music-platform bio. Reviewers open the URL and verify the code is
  // present — proves they actually control that artist page.
  const ownershipCode = useMemo(() => {
    if (!user?.id) return '';
    const base = user.id.replace(/-/g, '').toUpperCase();
    return `UF-${base.slice(0, 4)}-${base.slice(4, 8)}`;
  }, [user?.id]);


  const [signupLocked, setSignupLocked] = useState(false);
  const [handlePreview, setHandlePreview] = useState<{ slug: string; taken: boolean } | null>(null);
  const [phoneTaken, setPhoneTaken] = useState<boolean>(false);
  const [phoneChecking, setPhoneChecking] = useState<boolean>(false);
  const [stageTaken, setStageTaken] = useState<boolean>(false);
  const [legalDoc, setLegalDoc] = useState<LegalDocKey | null>(null);

  const musicCheck = validateMusicPlatformUrl(musicPlatformUrl);

  // Live duplicate check: phone number
  useEffect(() => {
    if (isLockedReapply) { setPhoneTaken(false); return; }
    if (!country || !validatePhone(country, phone).ok) { setPhoneTaken(false); return; }
    let cancelled = false;
    setPhoneChecking(true);
    const t = setTimeout(async () => {
      try {
        const e164 = `${getDialCode(country)}${phone.replace(/\D/g, '')}`;
        const enc = new TextEncoder().encode(e164.toLowerCase());
        const digest = await crypto.subtle.digest('SHA-256', enc);
        const hash = Array.from(new Uint8Array(digest)).map((b) => b.toString(16).padStart(2, '0')).join('');
        const { data, error } = await supabase.rpc('check_artist_phone_taken', { p_phone_hash: hash });
        if (cancelled) return;
        if (!error) setPhoneTaken(!!data);
      } catch { /* ignore */ }
      finally { if (!cancelled) setPhoneChecking(false); }
    }, 350);
    return () => { cancelled = true; clearTimeout(t); setPhoneChecking(false); };
  }, [phone, country, isLockedReapply]);

  // Live duplicate check: stage name
  useEffect(() => {
    if (isLockedReapply) { setStageTaken(false); return; }
    const name = stageName.trim();
    if (name.length < 2) { setStageTaken(false); return; }
    let cancelled = false;
    const t = setTimeout(async () => {
      try {
        const { data, error } = await supabase.rpc('check_artist_stage_name_taken', { p_stage_name: name });
        if (!cancelled && !error) setStageTaken(!!data);
      } catch { /* ignore */ }
    }, 350);
    return () => { cancelled = true; clearTimeout(t); };
  }, [stageName, isLockedReapply]);

  // Slug preview
  useEffect(() => {
    const raw = stageName.trim();
    if (raw.length < 2) { setHandlePreview(null); return; }
    const base = raw.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '') || 'artist';
    let cancelled = false;
    const t = setTimeout(async () => {
      try {
        const { data } = await supabase
          .from('artist_profiles')
          .select('slug')
          .ilike('slug', `${base}%`)
          .limit(20);
        if (cancelled) return;
        const taken = new Set((data ?? []).map((r) => (r.slug || '').toLowerCase()));
        if (!taken.has(base)) { setHandlePreview({ slug: base, taken: false }); return; }
        let i = 2; let candidate = `${base}-${i}`;
        while (taken.has(candidate) && i < 50) { i += 1; candidate = `${base}-${i}`; }
        setHandlePreview({ slug: candidate, taken: true });
      } catch { if (!cancelled) setHandlePreview({ slug: base, taken: false }); }
    }, 280);
    return () => { cancelled = true; clearTimeout(t); };
  }, [stageName]);

  useEffect(() => {
    if (isLoading) return;
    if (!user) { navigate('/auth', { replace: true }); return; }
    (async () => {
      try {
        const existing = await getMyApplication(user.id);
        if (existing) {
          const reapply = getArtistReapplyState(existing);
          if (!isReapplyMode || existing.status !== 'rejected' || !reapply.canReapply) {
            if (isReapplyMode && existing.status === 'rejected') toast.error(reapply.waitText || 'You can re-submit 7 days after rejection.');
            navigate('/artist/status', { replace: true });
            return;
          }
          setExistingApp(existing);
          setStageName(existing.stage_name || '');
          setRealName(existing.real_name || '');
          const lockedCountry = existing.country_code || '';
          const lockedDial = lockedCountry ? getDialCode(lockedCountry) : '';
          const lockedPhone = String(existing.phone || '');
          setPhone(lockedDial && lockedPhone.startsWith(lockedDial) ? lockedPhone.slice(lockedDial.length) : lockedPhone.replace(/\D/g, ''));
          setCountry(existing.country_code || '');
          const links = asSocialLinks(existing.social_links);
          setInstagram(typeof links.instagram === 'string' ? links.instagram : '');
          setYoutube(typeof links.youtube === 'string' ? links.youtube : '');
          setSpotify(typeof links.spotify === 'string' ? links.spotify : '');
          setAppleMusic(typeof links.apple_music === 'string' ? links.apple_music : '');
          setBio(typeof links.bio === 'string' ? links.bio : '');
          setMusicPlatformUrl((existing as { music_platform_url?: string | null }).music_platform_url ?? '');
          setBootChecked(true);
          return;
        }

        let prefilledCountry = '';
        try {
          const raw = localStorage.getItem('uf_artist_signup');
          if (raw) {
            const s = JSON.parse(raw) as { full_name?: string; phone?: string; country_code?: string };
            if (s.full_name) setRealName(s.full_name);
            if (s.country_code) { setCountry(s.country_code); prefilledCountry = s.country_code; }
            if (s.phone) {
              const dial = prefilledCountry ? getDialCode(prefilledCountry) : '';
              const rawPhone = String(s.phone);
              const digitsOnly = rawPhone.replace(/\D/g, '');
              const dialDigits = dial.replace(/\D/g, '');
              setPhone(dialDigits && digitsOnly.startsWith(dialDigits)
                ? digitsOnly.slice(dialDigits.length)
                : digitsOnly);
            }
            if (s.country_code && s.phone) setSignupLocked(true);
          }
        } catch { /* ignore */ }

        try {
          const draftRaw = localStorage.getItem(`uf_artist_apply_draft:${user.id}`);
          if (draftRaw) {
            const d = JSON.parse(draftRaw) as Partial<{
              stageName: string; realName: string; phone: string; country: string; bio: string;
              musicPlatformUrl: string;
              instagram: string; youtube: string; spotify: string; appleMusic: string;
              agreeTerms: boolean; agreePrivacy: boolean; step: Step;
            }>;
            if (d.stageName) setStageName(d.stageName);
            if (d.realName) setRealName(d.realName);
            if (d.country) setCountry(d.country);
            if (d.phone != null) setPhone(d.phone);
            if (d.bio) setBio(d.bio);
            if (d.musicPlatformUrl) setMusicPlatformUrl(d.musicPlatformUrl);
            if (d.instagram) setInstagram(d.instagram);
            if (d.youtube) setYoutube(d.youtube);
            if (d.spotify) setSpotify(d.spotify);
            if (d.appleMusic) setAppleMusic(d.appleMusic);
            if (d.agreeTerms) setAgreeTerms(true);
            if (d.agreePrivacy) setAgreePrivacy(true);
            // Resume on the saved step, but cap at step 2 — face/photo/submit need
            // files or camera we can't restore across sessions.
            if (typeof d.step === 'number' && d.step >= 1 && d.step <= 2) {
              setStep(Math.min(d.step, 2) as Step);
            }
            if (d.stageName || d.realName) {
              toast.success("Welcome back — we've restored your application.");
            }
          }
        } catch { /* ignore corrupt draft */ }

        if (!prefilledCountry) {
          try {
            const cc = await detectCountrySilently();
            if (cc && ALL_COUNTRIES.some((c) => c.code === cc)) setCountry(cc);
          } catch { /* keep blank */ }
        }
      } catch (err) {
        console.error('artist apply boot failed', err);
        toast.error('Could not load your application. Please try again.');
      } finally {
        setBootChecked(true);
      }
    })();
  }, [user, isLoading, navigate, isReapplyMode]);

  // Auto-save draft
  useEffect(() => {
    if (!user || !bootChecked || isLockedReapply) return;
    const id = setTimeout(() => {
      try {
        localStorage.setItem(`uf_artist_apply_draft:${user.id}`, JSON.stringify({
          stageName, realName, phone, country, bio,
          musicPlatformUrl,
          instagram, youtube, spotify, appleMusic,
          agreeTerms, agreePrivacy, step,
        }));
      } catch { /* quota — ignore */ }
    }, 400);
    return () => clearTimeout(id);
  }, [user, bootChecked, isLockedReapply, stageName, realName, phone, country, bio,
      musicPlatformUrl, instagram, youtube, spotify, appleMusic, agreeTerms, agreePrivacy, step]);

  const phoneCheck = country ? validatePhone(country, phone) : { ok: false, reason: '' };
  // Both Instagram AND YouTube are now required — dual-handle cross-check is the
  // strongest anti-impersonation signal without government ID.
  const instagramCheck = validateSocialLink('instagram', instagram);
  const youtubeCheck = validateSocialLink('youtube', youtube);
  const dualSocialsOk = !!instagram.trim() && !!youtube.trim() && instagramCheck.ok && youtubeCheck.ok;
  const linksCheck = atLeastNValidLinks({ instagram, youtube, spotify, apple_music: appleMusic }, 1);
  const countryLabel = getCountry(country) ? `${getCountry(country)!.flag} ${getCountry(country)!.name}` : country;

  const canNext = () => {
    if (step === 1) return stageName.trim().length >= 2 && !stageTaken && realName.trim().length >= 2 && !!country && phoneCheck.ok && !phoneTaken && !phoneChecking;
    if (step === 2) return musicCheck.ok && dualSocialsOk && linksCheck.ok;
    if (step === 3) return !!livenessShots;
    if (step === 4) return !!photo;
    return agreeTerms && agreePrivacy;
  };


  const handleBack = async () => {
    if (step > 1) { setStep((s) => (s - 1) as Step); return; }
    try {
      localStorage.removeItem('uf_artist_signup');
      localStorage.removeItem('uf_post_verify_next');
    } catch { /* ignore */ }
    await signOut();
    navigate('/auth', { replace: true });
  };

  const submit = async () => {
    if (!user) return;
    if (!agreeTerms || !agreePrivacy) {
      toast.error('Please accept the Artist Terms and Privacy Policy.');
      return;
    }
    if (!livenessShots) {
      toast.error('Complete the live face check first.');
      setStep(3);
      return;
    }
    if (!photo) {
      toast.error('Add your profile photo.');
      setStep(4);
      return;
    }
    if (!musicCheck.ok) {
      toast.error(musicCheck.reason || 'Add a valid music-platform artist page URL.');
      setStep(2);
      return;
    }
    setSubmitting(true);
    try {
      const latestApp = await getMyApplication(user.id);
      if (!isLockedReapply && latestApp) {
        const reapply = getArtistReapplyState(latestApp);
        if (latestApp.status === 'rejected' && reapply.canReapply) {
          toast.error('Use the secure re-submit flow from your status screen.');
          navigate('/artist/status', { replace: true });
        } else {
          toast.error(latestApp.status === 'rejected'
            ? reapply.waitText || 'You can re-submit 7 days after rejection.'
            : 'Your artist application already exists. Check your live status.');
          navigate('/artist/status', { replace: true });
        }
        return;
      }

      const blobToFile = (b: Blob, name: string) => new File([b], name, { type: b.type || 'image/jpeg' });
      const [selfiePath, photoUrl] = await Promise.all([
        uploadLivenessCapture(user.id, blobToFile(livenessShots.capture, 'face-capture.jpg')),
        uploadArtistPhoto(user.id, photo),
      ]);

      const sha256Hex = async (data: ArrayBuffer | string) => {
        const buf = typeof data === 'string' ? new TextEncoder().encode(data) : new Uint8Array(data);
        const digest = await crypto.subtle.digest('SHA-256', buf);
        return Array.from(new Uint8Array(digest)).map((b) => b.toString(16).padStart(2, '0')).join('');
      };
      const phoneE164 = phoneCheck.e164 || `${getDialCode(country)}${phone.replace(/\D/g, '')}`;
      const phoneHash = await sha256Hex(phoneE164.toLowerCase());

      const socialLinks = {
        instagram: instagram.trim() || null,
        youtube: youtube.trim() || null,
        spotify: spotify.trim() || null,
        apple_music: appleMusic.trim() || null,
        bio: bio.trim() || null,
        face_shots: [selfiePath],
        music_platform: musicCheck.platform,
      };

      const { data: inserted, error } = isLockedReapply
        ? await supabase.rpc('reapply_artist_application', {
            p_application_id: existingApp.id,
            p_social_links: socialLinks,
            p_music_platform_url: musicCheck.normalized,
            p_selfie_path: selfiePath,
            p_artist_photo_path: photoUrl,
          })
        : await supabase.rpc('submit_artist_application', {
            p_stage_name: stageName.trim(),
            p_real_name: realName.trim(),
            p_phone: phoneE164,
            p_country_code: country,
            p_social_links: socialLinks,
            p_music_platform_url: musicCheck.normalized,
            p_selfie_path: selfiePath,
            p_artist_photo_path: photoUrl,
            p_phone_hash: phoneHash,
          });

      if (error) {
        const msg = error.message || '';
        if (msg.includes('re-apply 7 days') || msg.includes('re-submit after') || msg.includes('Next attempt allowed')) {
          toast.error(msg);
          navigate('/artist/status', { replace: true });
        } else if (msg.includes('already have an artist application')) {
          toast.error('Your artist application already exists. Opening live status.');
          navigate('/artist/status', { replace: true });
        } else if (msg.includes('Use the re-submit verification button')) {
          toast.error('Use the secure re-submit button from your status screen.');
          navigate('/artist/status', { replace: true });
        } else if (msg.toLowerCase().includes('already linked to another artist')) {
          toast.error(msg);
        } else {
          throw error;
        }
        return;
      }

      const applicationId = getApplicationId(inserted);
      if (applicationId) {
        supabase.functions
          .invoke('artist-verify-checks', { body: { application_id: applicationId } })
          .catch((e) => console.warn('verify-checks invoke failed', e));
      }

      try { sessionStorage.setItem('uf_artist_just_submitted', String(Date.now())); } catch { /* ignore */ }
      try { localStorage.removeItem(`uf_artist_apply_draft:${user.id}`); } catch { /* ignore */ }
      setSubmittedSuccess({ reapply: isLockedReapply });
      window.setTimeout(() => navigate('/artist/status', { replace: true }), 2600);
      return;
    } catch (e: unknown) {
      console.error(e);
      toast.error(e instanceof Error ? e.message : 'Could not submit application.');
    } finally {
      setSubmitting(false);
    }
  };

  const celebratedRef = useRef(false);
  useEffect(() => {
    if (!submittedSuccess || celebratedRef.current) return;
    celebratedRef.current = true;

    const fire = (origin: { x: number; y: number }, particleCount: number, opts: confetti.Options = {}) => {
      confetti({
        particleCount, spread: 70, startVelocity: 45, ticks: 200, gravity: 0.9, scalar: 0.95,
        origin, disableForReducedMotion: true,
        colors: ['#FF2D55', '#FF6B8A', '#FFD166', '#34C759', '#FFFFFF'],
        ...opts,
      });
    };
    fire({ x: 0.5, y: 0.35 }, 90, { spread: 100, startVelocity: 55 });
    window.setTimeout(() => fire({ x: 0.1, y: 0.55 }, 55, { angle: 60 }), 180);
    window.setTimeout(() => fire({ x: 0.9, y: 0.55 }, 55, { angle: 120 }), 220);
    window.setTimeout(() => fire({ x: 0.5, y: 0.4 }, 60, { spread: 140, startVelocity: 35, gravity: 1.1, scalar: 1.1 }), 520);

    (async () => {
      try {
        const { Haptics, ImpactStyle, NotificationType } = await import('@capacitor/haptics');
        await Haptics.notification({ type: NotificationType.Success });
        window.setTimeout(() => Haptics.impact({ style: ImpactStyle.Light }).catch(() => {}), 220);
      } catch {
        if (typeof navigator !== 'undefined' && 'vibrate' in navigator) {
          try { navigator.vibrate([18, 60, 24, 60, 18]); } catch { /* ignore */ }
        }
      }
    })();
    return () => { try { confetti.reset(); } catch { /* ignore */ } };
  }, [submittedSuccess]);

  if (isLoading || !bootChecked) return <ArtistLoading label="Preparing your application…" />;

  if (submittedSuccess) {
    return (
      <>
        <SEOHead
          title="Application Submitted — Univers Flow"
          description="Your artist application has been received. Auto-verification is running."
          path="/artist/apply"
        />
        <div className="min-h-[100dvh] bg-background text-foreground flex flex-col items-center justify-center px-6 py-10 relative overflow-hidden">
          <div
            className="absolute inset-0 pointer-events-none"
            style={{ background: 'radial-gradient(ellipse at 50% 0%, hsl(340 100% 55% / 0.20) 0%, transparent 55%)' }}
          />
          <motion.div
            className="relative z-10 w-full max-w-sm text-center"
            initial={{ opacity: 0, y: 14, filter: 'blur(8px)' }}
            animate={{ opacity: 1, y: 0, filter: 'blur(0px)' }}
            transition={{ duration: 0.55, ease: [0.22, 1, 0.36, 1] }}
          >
            <motion.div
              className="mx-auto w-24 h-24 rounded-full flex items-center justify-center"
              style={{
                background: 'linear-gradient(180deg, #34c759 0%, #1f9d3f 100%)',
                boxShadow: '0 14px 40px rgba(52, 199, 89, 0.4)',
              }}
              initial={{ scale: 0.4 }}
              animate={{ scale: 1 }}
              transition={{ type: 'spring', stiffness: 240, damping: 16 }}
            >
              <Check className="w-12 h-12 text-white" strokeWidth={2.4} />
            </motion.div>
            <h1 className="text-[26px] leading-none font-display tracking-tight mt-7 mb-2">
              {submittedSuccess.reapply ? 'Re-submitted ✓' : 'Application submitted'}
            </h1>
            <p className="text-[13px] text-muted-foreground px-4 leading-relaxed">
              {submittedSuccess.reapply
                ? 'Your updated details are now in our review queue.'
                : "We've received your details. Auto-verification is running right now."}
            </p>
            <div
              className="rounded-[24px] p-5 mt-7 space-y-4 text-left"
              style={{
                background: 'rgba(16,16,18,0.78)',
                border: '0.5px solid rgba(255,255,255,0.07)',
                boxShadow: '0 24px 70px rgba(0, 0, 0, 0.5), inset 0 1px 0 rgba(255,255,255,0.04)',
                backdropFilter: 'blur(24px)',
              }}
            >
              {[
                { icon: Sparkles, text: <>Auto-checks running on your <strong className="text-foreground">face, socials & artist page</strong></> },
                { icon: ShieldCheck, text: <>Our team reviews within <strong className="text-foreground">1–3 days</strong></> },
                { icon: Check, text: <>You'll get a notification the moment we decide</> },
              ].map((item, i) => {
                const Icon = item.icon;
                return (
                  <motion.div
                    key={i}
                    className="flex items-start gap-3"
                    initial={{ opacity: 0, x: -8 }}
                    animate={{ opacity: 1, x: 0 }}
                    transition={{ delay: 0.25 + i * 0.1, duration: 0.4 }}
                  >
                    <div
                      className="w-7 h-7 rounded-full flex items-center justify-center flex-shrink-0 mt-0.5"
                      style={{
                        background: 'rgba(255, 45, 85, 0.12)',
                        border: '0.5px solid rgba(255, 45, 85, 0.18)',
                      }}
                    >
                      <Icon className="w-3.5 h-3.5 text-primary" />
                    </div>
                    <p className="text-[12.5px] text-muted-foreground leading-snug pt-1">{item.text}</p>
                  </motion.div>
                );
              })}
            </div>
            <motion.p
              className="mt-6 text-[11.5px] text-muted-foreground/70 inline-flex items-center gap-2"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              transition={{ delay: 0.7 }}
            >
              <Loader2 className="w-3 h-3 animate-spin" /> Taking you to your status…
            </motion.p>
          </motion.div>
        </div>
      </>
    );
  }

  const meta = STEP_META[step];
  const StepIcon = meta.icon;

  return (
    <FadeTransition>
      <SEOHead
        title="Apply as Artist — Universflow"
        description="Become a verified Universflow artist. Live face check, social & music-platform verification. No government ID needed."
        path="/artist/apply"
      />
      <div className="min-h-[100dvh] bg-background text-foreground pb-36">
        <header
          className="sticky top-0 z-20 bg-background/85 backdrop-blur-xl border-b border-white/5"
          style={{ paddingTop: 'env(safe-area-inset-top)' }}
        >
          <div className="max-w-md mx-auto px-4 py-3 flex items-center gap-3">
            <button
              onClick={handleBack}
              className="w-10 h-10 rounded-full flex items-center justify-center bg-white/[0.06] active:scale-95 transition"
              aria-label="Back"
            >
              <ArrowLeft className="w-5 h-5" />
            </button>
            <div className="flex-1 min-w-0">
              <h1 className="text-[15px] font-semibold tracking-tight leading-tight truncate">
                {isLockedReapply ? 'Re-submit Verification' : 'Apply as Artist'}
              </h1>
              <p className="text-[11px] text-muted-foreground leading-tight truncate">{meta.label}</p>
            </div>
            <div className="flex items-center gap-1">
              {Array.from({ length: TOTAL_STEPS }).map((_, i) => {
                const n = i + 1;
                const active = n === step;
                const done = n < step;
                return (
                  <span
                    key={n}
                    className={`h-1.5 rounded-full transition-all ${
                      active ? 'w-5 bg-primary' : done ? 'w-1.5 bg-primary/60' : 'w-1.5 bg-white/15'
                    }`}
                  />
                );
              })}
            </div>
          </div>
        </header>

        <main className="max-w-md mx-auto px-5 pt-5 pb-2">
          <div className="mb-5 flex items-center gap-3">
            <div className="w-11 h-11 rounded-2xl bg-primary/12 border border-primary/20 flex items-center justify-center">
              <StepIcon className="w-5 h-5 text-primary" />
            </div>
            <div>
              <p className="text-[10px] uppercase tracking-[0.18em] text-muted-foreground">Step {step} of {TOTAL_STEPS}</p>
              <h2 className="text-[18px] font-semibold leading-tight">{meta.label}</h2>
            </div>
          </div>

          <AnimatePresence mode="wait">
            <motion.section
              key={step}
              initial={{ opacity: 0, y: 8 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -4 }}
              transition={{ duration: 0.18 }}
              className="space-y-4"
            >
              {step === 1 && (
                <>
                  {isLockedReapply && existingApp?.admin_note && (
                    <div className="rounded-2xl bg-rose-500/10 border border-rose-500/20 p-4">
                      <p className="text-[11px] uppercase tracking-[0.16em] text-rose-300/80 mb-2">Rejected reason</p>
                      <p className="text-[13px] leading-relaxed text-foreground/90">{existingApp.admin_note}</p>
                    </div>
                  )}
                  <div className="flex items-start gap-3 p-4 rounded-2xl bg-primary/8 border border-primary/15">
                    <ShieldCheck className="w-5 h-5 text-primary shrink-0 mt-0.5" />
                    <p className="text-[12.5px] leading-relaxed text-foreground/90">
                      Verification takes <strong>1–3 days</strong>. No government ID required —
                      we verify you with a <strong>live face check</strong>, your <strong>music-platform artist page</strong>,
                      and your <strong>social handle</strong>.
                    </p>
                  </div>
                  <Field label="Stage / Artist name">
                    <Input value={stageName} onChange={(e) => setStageName(e.target.value)} placeholder="e.g. KAYO" maxLength={50} disabled={isLockedReapply} />
                    {handlePreview && (
                      <p className="mt-1.5 text-[11.5px] text-muted-foreground">
                        Your public link:{' '}
                        <span className="text-foreground/90 font-medium">universflow.in/a/{handlePreview.slug}</span>
                        {handlePreview.taken && (
                          <span className="ml-1 text-amber-400/90">· that name is taken, we'll use this handle for you</span>
                        )}
                      </p>
                    )}
                    {stageTaken && !isLockedReapply && (
                      <p className="mt-1.5 text-[11.5px] text-rose-300 leading-snug">
                        This stage name is already in use by another verified artist. Pick a different one.
                      </p>
                    )}
                  </Field>
                  <Field label="Legal / real name">
                    <Input value={realName} onChange={(e) => setRealName(e.target.value)} placeholder="Full name" maxLength={80} disabled={isLockedReapply} />
                    <p className="mt-1 text-[10.5px] text-muted-foreground/70">
                      Kept private — we cross-check it with your public artist page handle.
                    </p>
                  </Field>
                  <Field label={`Phone number${country ? ` · ${getDialCode(country)} (${PHONE_DIGITS[country] ?? '—'} digits)` : ''}`}>
                    <div className="flex gap-2">
                      <CountryCombobox
                        value={country}
                        onChange={setCountry}
                        variant="dial"
                        disabled={isLockedReapply || signupLocked}
                        ariaLabel="Phone country code"
                        className="shrink-0"
                      />
                      <Input
                        type="tel"
                        inputMode="numeric"
                        value={phone}
                        onChange={(e) => setPhone(e.target.value.replace(/\D/g, '').slice(0, 15))}
                        placeholder={country ? `${PHONE_DIGITS[country] ?? 10}-digit mobile number` : 'Pick country first'}
                        maxLength={15}
                        disabled={!country || isLockedReapply || signupLocked}
                      />
                    </div>
                    {country && phone.length > 0 && !phoneCheck.ok && (
                      <p className="mt-1.5 text-[11.5px] text-rose-300 leading-snug">
                        {phoneCheck.troll || phoneCheck.reason}
                      </p>
                    )}
                    {country && phoneCheck.ok && phoneChecking && (
                      <p className="mt-1.5 text-[11.5px] text-muted-foreground leading-snug">Checking availability…</p>
                    )}
                    {country && phoneCheck.ok && !phoneChecking && phoneTaken && (
                      <p className="mt-1.5 text-[11.5px] text-rose-300 leading-snug">
                        This phone number is already linked to another artist account.
                      </p>
                    )}
                    {country && phoneCheck.ok && !phoneChecking && !phoneTaken && (
                      <p className="mt-1.5 text-[11.5px] text-emerald-300 leading-snug">
                        ✓ Valid {countryLabel.replace(/^[^\s]+\s/, '')} mobile number.
                      </p>
                    )}
                    <p className="mt-1 text-[10.5px] text-muted-foreground/70">
                      {signupLocked
                        ? 'Locked from your verified signup. Contact support if this is wrong.'
                        : "You can't change this later. Use a real number — we check it."}
                    </p>
                  </Field>
                  <Field label="Country">
                    <CountryCombobox
                      value={country}
                      onChange={setCountry}
                      variant="full"
                      disabled={isLockedReapply || signupLocked}
                      placeholder="Select your country…"
                      ariaLabel="Country"
                    />
                  </Field>
                  <Field label="Short bio (optional)">
                    <Textarea value={bio} onChange={(e) => setBio(e.target.value)} maxLength={300} placeholder="What you make, where you're from…" rows={3} />
                  </Field>
                </>
              )}

              {step === 2 && (
                <>
                  <div className="flex items-start gap-3 p-4 rounded-2xl bg-primary/8 border border-primary/15">
                    <Music className="w-5 h-5 text-primary shrink-0 mt-0.5" />
                    <p className="text-[12.5px] leading-relaxed text-foreground/90">
                      Paste your <strong>real artist page</strong> on any music platform.
                      We open the link, check the artist name matches yours, and reject fake links instantly.
                    </p>
                  </div>

                  <Field label="Music-platform artist page (required)">
                    <div className="relative">
                      <Input
                        value={musicPlatformUrl}
                        onChange={(e) => setMusicPlatformUrl(e.target.value)}
                        placeholder="https://open.spotify.com/artist/…  ·  Apple Music, YouTube Music, Deezer, JioSaavn…"
                        inputMode="url"
                        spellCheck={false}
                        autoCapitalize="off"
                        autoCorrect="off"
                      />
                    </div>
                    {musicPlatformUrl.trim().length > 0 && !musicCheck.ok && (
                      <p className="mt-1.5 text-[11.5px] text-rose-300 leading-snug">{musicCheck.reason}</p>
                    )}
                    {musicCheck.ok && (
                      <div className="mt-1.5 flex items-center gap-2 text-[11.5px] text-emerald-300">
                        <Check className="w-3.5 h-3.5" />
                        Recognised as {musicCheck.label}
                        <a href={musicCheck.normalized} target="_blank" rel="noreferrer" className="ml-auto inline-flex items-center gap-1 underline text-muted-foreground hover:text-foreground">
                          Open <ExternalLink className="w-3 h-3" />
                        </a>
                      </div>
                    )}
                  </Field>

                  <div className="pt-2">
                    <p className="text-[12.5px] text-muted-foreground -mt-1">
                      Add at least <strong>1 more social link</strong> where your artist handle matches.
                    </p>
                  </div>

                  <LinkField platform="instagram" value={instagram} onChange={setInstagram} placeholder="https://instagram.com/yourhandle" />
                  <LinkField platform="youtube" value={youtube} onChange={setYoutube} placeholder="https://youtube.com/@yourchannel" />
                  <LinkField platform="spotify" value={spotify} onChange={setSpotify} placeholder="https://open.spotify.com/artist/…" />
                  <LinkField platform="apple_music" value={appleMusic} onChange={setAppleMusic} placeholder="https://music.apple.com/…/artist/…" />
                  {!linksCheck.ok && (instagram || youtube || spotify || appleMusic) && (
                    <p className="text-[11.5px] text-rose-300">{linksCheck.reason}</p>
                  )}
                </>
              )}

              {step === 3 && (
                <>
                  <div className="flex items-start gap-3 p-4 rounded-2xl bg-primary/8 border border-primary/15">
                    <ShieldCheck className="w-5 h-5 text-primary shrink-0 mt-0.5" />
                    <p className="text-[12.5px] leading-relaxed text-foreground/90">
                      We use your camera to confirm you're a real person — <strong>blink twice, then smile</strong>.
                      Nothing is uploaded until the check passes.
                    </p>
                  </div>
                  {livenessShots ? (
                    <div className="rounded-2xl p-4 bg-emerald-500/10 border border-emerald-500/25 flex items-center gap-3">
                      <Check className="w-5 h-5 text-emerald-300" />
                      <div className="flex-1">
                        <p className="text-[13px] font-semibold text-emerald-200">Live face check passed</p>
                        <p className="text-[11.5px] text-emerald-200/80">Real-human liveness confirmed. Tap Continue.</p>
                      </div>
                      <button type="button" onClick={() => setLivenessShots(null)} className="text-[11.5px] text-emerald-200 underline">Redo</button>
                    </div>
                  ) : (
                    <FaceLivenessCapture onComplete={(s) => setLivenessShots(s)} />
                  )}
                </>
              )}

              {step === 4 && (
                <>
                  <p className="text-[12.5px] text-muted-foreground -mt-1">
                    A clean, high-quality photo of you. This becomes your public profile picture once verified.
                  </p>
                  <FilePicker label="Artist photo" file={photo} onPick={setPhoto} />
                </>
              )}

              {step === 5 && (
                <>
                  <div className="rounded-2xl p-4 bg-gradient-to-br from-primary/15 to-primary/5 border border-primary/20">
                    <div className="flex items-center gap-2 mb-1.5">
                      <Sparkles className="w-4 h-4 text-primary" />
                      <p className="text-[13px] font-semibold">Almost done</p>
                    </div>
                    <p className="text-[12.5px] text-foreground/80 leading-relaxed">
                      Review takes 1–3 days. You'll get a push notification with the result.
                    </p>
                  </div>

                  <label className="flex items-start gap-3 cursor-pointer p-3 rounded-xl bg-white/[0.03] border border-white/10">
                    <input
                      type="checkbox" checked={agreeTerms}
                      onChange={(e) => setAgreeTerms(e.target.checked)}
                      className="mt-0.5 w-4 h-4 accent-[#FF2D55]"
                    />
                    <span className="text-[12.5px] leading-relaxed">
                      I agree to the{' '}
                      <button type="button" onClick={() => setLegalDoc('artist-terms')} className="underline text-primary font-medium">Artist Terms</button>{' '}
                      and confirm I have the right to publish the music I will upload.
                    </span>
                  </label>

                  <label className="flex items-start gap-3 cursor-pointer p-3 rounded-xl bg-white/[0.03] border border-white/10">
                    <input
                      type="checkbox" checked={agreePrivacy}
                      onChange={(e) => setAgreePrivacy(e.target.checked)}
                      className="mt-0.5 w-4 h-4 accent-[#FF2D55]"
                    />
                    <span className="text-[12.5px] leading-relaxed">
                      I agree to the{' '}
                      <button type="button" onClick={() => setLegalDoc('artist-privacy')} className="underline text-primary font-medium">Artist Privacy Policy</button>.
                    </span>
                  </label>
                </>
              )}
            </motion.section>
          </AnimatePresence>
        </main>

        <LegalSheet doc={legalDoc} onClose={() => setLegalDoc(null)} />

        <div
          className="fixed bottom-0 inset-x-0 z-20 bg-gradient-to-t from-background via-background/95 to-transparent pt-6 px-5"
          style={{ paddingBottom: 'calc(env(safe-area-inset-bottom) + 20px)' }}
        >
          <div className="max-w-md mx-auto">
            {step < TOTAL_STEPS ? (
              <Button
                className="w-full h-13 rounded-2xl text-[14.5px] font-semibold shadow-lg shadow-primary/20"
                disabled={!canNext()}
                onClick={() => setStep((s) => (s + 1) as Step)}
                style={{ background: '#FF2D55', color: '#fff', height: 52 }}
              >
                Continue <ArrowRight className="w-4 h-4 ml-1.5" />
              </Button>
            ) : (
              <Button
                className="w-full rounded-2xl text-[14.5px] font-semibold shadow-lg shadow-primary/20"
                disabled={!canNext() || submitting}
                onClick={submit}
                style={{ background: '#FF2D55', color: '#fff', height: 52 }}
              >
                {submitting ? <Loader2 className="w-4 h-4 animate-spin" /> : (
                  <span className="flex items-center gap-2"><Check className="w-4 h-4" /> Submit application</span>
                )}
              </Button>
            )}
          </div>
        </div>
      </div>
    </FadeTransition>
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

const LINK_LABELS: Record<SocialPlatform, string> = {
  instagram: 'Instagram',
  youtube: 'YouTube',
  spotify: 'Spotify artist',
  apple_music: 'Apple Music artist',
};

function LinkField({
  platform, value, onChange, placeholder,
}: {
  platform: SocialPlatform;
  value: string;
  onChange: (v: string) => void;
  placeholder: string;
}) {
  const check = validateSocialLink(platform, value);
  const hasValue = value.trim().length > 0;
  return (
    <Field label={LINK_LABELS[platform]}>
      <Input value={value} onChange={(e) => onChange(e.target.value)} placeholder={placeholder} inputMode="url" />
      {hasValue && !check.ok && (
        <p className="mt-1.5 text-[11px] text-rose-300 leading-snug">{check.reason}</p>
      )}
      {hasValue && check.ok && (
        <p className="mt-1.5 text-[11px] text-emerald-300 leading-snug">✓ Looks like a real link.</p>
      )}
    </Field>
  );
}
