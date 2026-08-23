import { useState, useEffect, useCallback } from 'react';
import {
  ChevronLeft, ChevronRight, Crown, MessageSquare, Gauge, RotateCcw, Sliders,
  KeyRound, Trash2, EyeOff, Smartphone, Mail, CheckCircle2, Wifi, Download,
  Radio, Bell, Music2, Vibrate, Globe, HardDrive, FileText, Info, ShieldCheck,
  Languages, Waves, Zap, Repeat, PlayCircle, HelpCircle,
  Activity,
} from 'lucide-react';


import { useNavigate } from '@/lib/router-compat';
import BottomNav from '@/components/BottomNav';
import PageTransition from '@/components/PageTransition';
import { Slider } from '@/components/ui/slider';
import { Switch } from '@/components/ui/switch';
import { usePremium } from '@/hooks/usePremium';
import { usePlayer } from '@/contexts/PlayerContext';
import { toast } from 'sonner';
import SupportChatModal from '@/components/SupportChatModal';
import EmailVerificationCard from '@/components/EmailVerificationCard';
import EqualizerModal from '@/components/EqualizerModal';
import PremiumLockOverlay from '@/components/PremiumLockOverlay';
import { SettingsUpdateButton } from '@/components/SettingsUpdateButton';
import ChangePasswordModal from '@/components/ChangePasswordModal';
import DeleteAccountModal from '@/components/DeleteAccountModal';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/contexts/AuthContext';
import { useEmailVerified } from '@/hooks/useEmailVerified';
import PremiumBadge from '@/components/PremiumBadge';

import { setEQSettings } from '@/lib/eqSettings';
import { setHapticsEnabled, getHapticsEnabled, triggerHaptic } from '@/hooks/useHaptics';
import { applyLanguageToDocument, emitPrefsChanged, type LanguagePref as PrefLang } from '@/lib/userPrefs';
import SEOHead from '@/components/SEOHead';
import { YouTubeAccountSection } from '@/components/YouTubeAccountSection';


const EQ_KEY = 'eq_settings';

const readEq = () => {
  try { return JSON.parse(localStorage.getItem(EQ_KEY) || '{}'); } catch { return {}; }
};
const writeEq = (patch: Record<string, unknown>) => {
  try {
    const cur = readEq();
    localStorage.setItem(EQ_KEY, JSON.stringify({ ...cur, ...patch }));
    setEQSettings(patch as Parameters<typeof setEQSettings>[0]);
  } catch { /* ignore */ }
};

type CapacitorWindow = Window & typeof globalThis & {
  Capacitor?: { isNativePlatform?: () => boolean };
};

type QualityTier = 'saver' | 'normal' | 'high' | 'very_high';
const QUALITY_OPTIONS: { id: QualityTier; label: string; hint: string }[] = [
  { id: 'saver',     label: 'Saver',  hint: '~96 kbps' },
  { id: 'normal',    label: 'Normal', hint: '~160 kbps' },
  { id: 'high',      label: 'High',   hint: '~256 kbps' },
  { id: 'very_high', label: 'Ultra',  hint: '320 kbps+' },
];
const readQuality = (key: string, fallback: QualityTier): QualityTier => {
  try {
    const v = localStorage.getItem(key) as QualityTier | null;
    return v && QUALITY_OPTIONS.some(o => o.id === v) ? v : fallback;
  } catch { return fallback; }
};

type LanguagePref = 'en' | 'hi' | 'pa';
const LANGUAGE_OPTIONS: { id: LanguagePref; label: string; native: string }[] = [
  { id: 'en', label: 'English', native: 'English' },
  { id: 'hi', label: 'Hindi',   native: 'हिन्दी' },
  { id: 'pa', label: 'Punjabi', native: 'ਪੰਜਾਬੀ' },
];

const monthsBetween = (iso?: string | null): string => {
  if (!iso) return '—';
  const d = new Date(iso);
  const now = new Date();
  const m = Math.max(0, (now.getFullYear() - d.getFullYear()) * 12 + (now.getMonth() - d.getMonth()));
  if (m < 1) return 'Joined this month';
  if (m < 12) return `${m} month${m === 1 ? '' : 's'} on Univers Flow`;
  const y = Math.floor(m / 12);
  const r = m % 12;
  return r ? `${y}y ${r}mo on Univers Flow` : `${y} year${y === 1 ? '' : 's'} on Univers Flow`;
};

// --- reusable row primitives -------------------------------------------------
const Section = ({ label, children }: { label: string; children: React.ReactNode }) => (
  <section>
    <div className="flex items-center gap-2 mb-2.5 px-1">
      <h2 className="text-[10px] font-extrabold text-white/40 uppercase tracking-[0.2em]">{label}</h2>
    </div>
    <div className="rounded-3xl overflow-hidden bg-card/50 border border-white/5 backdrop-blur-sm">
      {children}
    </div>
  </section>
);

type RowProps = {
  icon: React.ReactNode;
  label: string;
  sub?: string;
  right?: React.ReactNode;
  onClick?: () => void;
  destructive?: boolean;
  chevron?: boolean;
  last?: boolean;
};
const Row = ({ icon, label, sub, right, onClick, destructive, chevron, last }: RowProps) => {
  const base = `w-full px-4 py-3 flex items-center gap-3 ${last ? '' : 'border-b border-white/5'} ${onClick ? (destructive ? 'active:bg-destructive/10' : 'active:bg-muted/30') : ''} text-left`;
  const inner = (
    <>
      <span className={`w-4 h-4 shrink-0 flex items-center justify-center ${destructive ? 'text-destructive' : 'text-primary'}`}>{icon}</span>
      <div className="flex-1 min-w-0">
        <p className={`text-sm ${destructive ? 'text-destructive' : ''} truncate`}>{label}</p>
        {sub && <p className="text-[11px] text-white/40 truncate">{sub}</p>}
      </div>
      {right}
      {chevron && <ChevronRight className="w-4 h-4 text-muted-foreground shrink-0" />}
    </>
  );
  return onClick
    ? <button onClick={onClick} className={base}>{inner}</button>
    : <div className={base}>{inner}</div>;
};

const QualitySelector = ({ value, onChange }: { value: QualityTier; onChange: (v: QualityTier) => void }) => (
  <div className="px-4 py-3 border-b border-white/5">
    <div className="grid grid-cols-4 gap-1.5">
      {QUALITY_OPTIONS.map((o) => {
        const active = value === o.id;
        return (
          <button
            key={o.id}
            onClick={() => onChange(o.id)}
            className={`py-2 rounded-lg text-[11px] font-semibold transition-colors ${
              active ? 'bg-primary text-primary-foreground' : 'bg-muted/40 text-foreground/70 active:bg-muted'
            }`}
          >
            <div>{o.label}</div>
            <div className={`text-[9px] font-normal mt-0.5 ${active ? 'text-primary-foreground/70' : 'text-white/40'}`}>{o.hint}</div>
          </button>
        );
      })}
    </div>
  </div>
);


const Settings = () => {
  const navigate = useNavigate();
  const { isPremium } = usePremium();
  const { user } = useAuth();
  const { isVerified: emailVerified } = useEmailVerified();
  const { crossfade: cfEnabled, crossfadeDuration: cfDuration, crossfadeCurve, gaplessPro, toggleCrossfade, setCrossfadeDuration, setCrossfadeCurve, toggleGaplessPro, audioElement } = usePlayer();

  const [gaplessPlayback, setGaplessPlayback] = useState(() => localStorage.getItem('uf_gapless') !== 'false');
  const [autoplay, setAutoplay] = useState(() => localStorage.getItem('uf_autoplay') !== 'false');
  const [notifications, setNotifications] = useState(() => localStorage.getItem('uf_notifications') !== 'false');
  const [moodPushes, setMoodPushes] = useState(true);
  const [haptics, setHaptics] = useState(() => getHapticsEnabled());
  const [cacheSize, setCacheSize] = useState('0 MB');
  const [showSupport, setShowSupport] = useState(false);
  const [showEq, setShowEq] = useState(false);
  const [showEqPremium, setShowEqPremium] = useState(false);
  const [showPassword, setShowPassword] = useState(false);
  const [showDelete, setShowDelete] = useState(false);
  const [isPrivate, setIsPrivate] = useState(false);
  const [profileCreated, setProfileCreated] = useState<string | null>(null);
  const [streamQuality, setStreamQuality] = useState<QualityTier>(() => readQuality('uf_stream_quality', 'high'));
  const [downloadQuality, setDownloadQuality] = useState<QualityTier>(() => readQuality('uf_download_quality', 'very_high'));
  const [wifiOnlyDownload, setWifiOnlyDownload] = useState<boolean>(() => localStorage.getItem('uf_download_wifi_only') === 'true');
  const [language, setLanguage] = useState<LanguagePref>(() => (localStorage.getItem('uf_language') as LanguagePref) || 'en');
  type DeviceRow = { id: string; platform: string | null; device_info: Record<string, unknown> | null; updated_at: string | null };
  const [devices, setDevices] = useState<DeviceRow[]>([]);
  const [playbackSpeed, setPlaybackSpeed] = useState<number>(() => {
    const s = readEq();
    return typeof s.playbackSpeed === 'number' ? s.playbackSpeed : 1;
  });

  const loadDevices = useCallback(async () => {
    if (!user) return;
    const { data } = await supabase
      .from('device_tokens')
      .select('id, platform, device_info, updated_at')
      .eq('user_id', user.id)
      .order('updated_at', { ascending: false });
    setDevices((data as DeviceRow[] | null) || []);
  }, [user]);

  const loadProfileMeta = useCallback(async () => {
    if (!user) return;
    const { data } = await supabase
      .from('profiles')
      .select('is_private, created_at, mood_pushes_enabled')
      .eq('user_id', user.id)
      .single();
    const row = data as { is_private?: boolean; created_at?: string; mood_pushes_enabled?: boolean } | null;
    setIsPrivate(!!row?.is_private);
    if (typeof row?.mood_pushes_enabled === 'boolean') {
      setMoodPushes(row.mood_pushes_enabled);
    }
    setProfileCreated(row?.created_at || user.created_at || null);
  }, [user]);

  useEffect(() => { loadDevices(); loadProfileMeta(); }, [loadDevices, loadProfileMeta]);

  const togglePrivate = async (val: boolean) => {
    if (!user) return;
    setIsPrivate(val);
    const { error } = await supabase.from('profiles').update({ is_private: val }).eq('user_id', user.id);
    if (error) { toast.error('Could not update privacy'); setIsPrivate(!val); return; }
    toast.success(val ? 'Profile is now private' : 'Profile is now public');
  };

  const removeDevice = async (id: string) => {
    if (!window.confirm('Sign this device out of notifications?')) return;
    const { error } = await supabase.from('device_tokens').delete().eq('id', id);
    if (error) { toast.error('Failed to remove device'); return; }
    setDevices(prev => prev.filter(d => d.id !== id));
    toast.success('Device removed');
  };

  useEffect(() => {
    const calcSize = async () => {
      try {
        if ('caches' in window) {
          const keys = await caches.keys();
          let total = 0;
          for (const key of keys) {
            const cache = await caches.open(key);
            const reqs = await cache.keys();
            total += reqs.length * 50000;
          }
          if ('indexedDB' in window) {
            const estimate = await navigator.storage?.estimate();
            if (estimate?.usage) total = estimate.usage;
          }
          if (total > 1024 * 1024 * 1024) setCacheSize(`${(total / (1024 * 1024 * 1024)).toFixed(2)} GB`);
          else if (total > 1024 * 1024) setCacheSize(`${(total / (1024 * 1024)).toFixed(1)} MB`);
          else if (total > 1024) setCacheSize(`${(total / 1024).toFixed(0)} KB`);
          else setCacheSize('0 MB');
        }
      } catch { setCacheSize('0 MB'); }
    };
    calcSize();
  }, []);

  const emitPlaybackSettingsChanged = () => {
    try { window.dispatchEvent(new CustomEvent('uf-playback-settings-changed')); } catch { /* ignore */ }
  };

  const handleGapless = (val: boolean) => { setGaplessPlayback(val); localStorage.setItem('uf_gapless', String(val)); emitPlaybackSettingsChanged(); };
  const handleAutoplay = (val: boolean) => { setAutoplay(val); localStorage.setItem('uf_autoplay', String(val)); emitPlaybackSettingsChanged(); };
  const handleNotifications = async (val: boolean) => {
    setNotifications(val);
    localStorage.setItem('uf_notifications', String(val));
    if (!val) return;
    const capacitor = (window as CapacitorWindow).Capacitor;
    const isNative = typeof capacitor !== 'undefined' && capacitor.isNativePlatform?.() === true;
    if (isNative) {
      const { requestPushPermissionAndRegister } = await import('@/hooks/usePushRegistration');
      const result = await requestPushPermissionAndRegister();
      if (result !== 'granted') {
        setNotifications(false);
        localStorage.setItem('uf_notifications', 'false');
        toast.error(result === 'denied' ? 'Notification permission was not granted' : 'Push notifications are not supported on this device');
      } else {
        toast.success('Device registered for notifications');
      }
    } else if ('Notification' in window) {
      Notification.requestPermission();
    }
  };
  const handleHaptics = (val: boolean) => {
    setHaptics(val);
    setHapticsEnabled(val);           // aligns with useHaptics's storage key
    if (val) triggerHaptic('selection'); // instant confirmation buzz
  };

  const handlePlaybackSpeed = (speed: number) => {
    if (!isPremium) {
      toast.error('Playback Speed is a Premium feature');
      navigate('/premium');
      return;
    }
    setPlaybackSpeed(speed);
    writeEq({ playbackSpeed: speed });
    if (audioElement) {
      try { audioElement.playbackRate = speed; } catch { /* ignore */ }
    }
  };


  const handleStreamQuality = (v: QualityTier) => {
    setStreamQuality(v);
    localStorage.setItem('uf_stream_quality', v);
    emitPlaybackSettingsChanged();
    emitPrefsChanged();
    // Cached URLs were resolved at the previous bitrate — drop them so the new
    // tier takes effect on the next track (and the next resolve of this one).
    void import('@/lib/musicIndexer').then((m) => m.clearStreamCache()).catch(() => undefined);
    toast.success(`Streaming quality: ${QUALITY_OPTIONS.find(o => o.id === v)?.label}`);
  };

  const handleDownloadQuality = (v: QualityTier) => {
    setDownloadQuality(v);
    localStorage.setItem('uf_download_quality', v);
    emitPrefsChanged();
    toast.success(`Download quality: ${QUALITY_OPTIONS.find(o => o.id === v)?.label}`);
  };
  const handleWifiOnly = (v: boolean) => {
    setWifiOnlyDownload(v);
    localStorage.setItem('uf_download_wifi_only', String(v));
    emitPrefsChanged();
    toast.success(v ? 'Downloads limited to Wi-Fi' : 'Downloads allowed on any network');
  };
  const handleLanguage = (v: LanguagePref) => {
    setLanguage(v);
    localStorage.setItem('uf_language', v);
    applyLanguageToDocument(v as PrefLang);
    emitPrefsChanged();
    toast.success(`Language preference saved: ${LANGUAGE_OPTIONS.find(o => o.id === v)?.label}`);
  };

  const handleResetPlayback = () => {
    // Reset speed directly (never route a free user to /premium from a reset).
    setPlaybackSpeed(1);
    writeEq({ playbackSpeed: 1 });
    if (audioElement) { try { audioElement.playbackRate = 1; } catch { /* ignore */ } }
    handleGapless(true);

    handleAutoplay(true);
    if (cfEnabled) toggleCrossfade();
    if (gaplessPro) toggleGaplessPro();
    toast.success('Playback settings restored');
  };

  const handleClearCache = async () => {
    if (!window.confirm('Clear cached artwork, streams and previews on this device?')) return;
    try {
      if ('caches' in window) {
        const keys = await caches.keys();
        await Promise.all(keys.map(k => caches.delete(k)));
      }
      if ('indexedDB' in window) {
        const dbs = await indexedDB.databases?.() || [];
        for (const db of dbs) { if (db.name) indexedDB.deleteDatabase(db.name); }
      }
      for (let i = localStorage.length - 1; i >= 0; i--) {
        const key = localStorage.key(i);
        if (key && (key.startsWith('audio_cache_') || key.startsWith('img_cache_'))) {
          localStorage.removeItem(key);
        }
      }
      setCacheSize('0 MB');
      toast.success('Cache cleared successfully');
    } catch { toast.error('Failed to clear cache'); }
  };

  return (
    <PageTransition>
      <SEOHead
        title="Settings — Univers Flow"
        description="Tune playback, audio quality, notifications and storage controls inside your Univers Flow account."
        keywords="Univers Flow settings, music app preferences, audio quality, notifications"
      />
      <div className="ethereal-page h-[100dvh] flex flex-col overflow-hidden">
        <header
          className="flex-shrink-0 z-30 px-2 pt-3 pb-2 flex items-center safe-area-pt"
          style={{
            background: 'hsl(var(--background) / 0.85)',
            backdropFilter: 'blur(40px)',
            WebkitBackdropFilter: 'blur(40px)',
          }}
        >
          <button onClick={() => navigate(-1)} className="flex items-center gap-0.5 px-2 py-2 -ml-1 text-primary">
            <ChevronLeft className="w-5 h-5" />
            <span className="text-sm">Back</span>
          </button>
          <h1 className="ethereal-title text-sm font-semibold absolute left-1/2 -translate-x-1/2">Settings</h1>
        </header>

        <main className="flex-1 overflow-y-auto px-4 pt-3 pb-32 space-y-4" style={{ WebkitOverflowScrolling: 'touch' }}>

          {/* ============ 1. ACCOUNT ============ */}
          <Section label="Account">
            {/* Always-visible summary card (never blank, even when email is verified) */}
            <div className="px-4 pt-4 pb-3 border-b border-white/5">
              <div className="flex items-start gap-3">
                <div className="w-11 h-11 rounded-2xl bg-primary/15 flex items-center justify-center shrink-0">
                  <Mail className="w-5 h-5 text-primary" />
                </div>
                <div className="flex-1 min-w-0">
                  <p className="text-[10px] font-black uppercase tracking-[0.2em] text-white/40">Signed in as</p>
                  <p className="text-sm font-medium truncate mt-0.5">{user?.email || 'Guest'}</p>
                  <div className="flex items-center gap-1.5 mt-2 flex-wrap">
                    {isPremium ? (
                      <PremiumBadge size="xs" />
                    ) : (
                      <span className="text-[9px] font-black uppercase tracking-[0.2em] px-1.5 py-0.5 rounded-full bg-white/[0.06] text-white/60">Free</span>
                    )}
                    {emailVerified ? (
                      <span className="inline-flex items-center gap-1 text-[9px] font-black uppercase tracking-[0.2em] px-1.5 py-0.5 rounded-full bg-emerald-500/15 text-emerald-400">
                        <CheckCircle2 className="w-2.5 h-2.5" /> Verified
                      </span>
                    ) : (
                      <span className="text-[9px] font-black uppercase tracking-[0.2em] px-1.5 py-0.5 rounded-full bg-amber-500/15 text-amber-400">Unverified</span>
                    )}
                    <span className="text-[9px] font-black uppercase tracking-[0.2em] text-white/40">· {monthsBetween(profileCreated)}</span>
                  </div>
                </div>
              </div>
              {/* Keep verify-flow logic nested here — renders inline verify controls if unverified, nothing if verified. */}
              {!emailVerified && (
                <div className="mt-3">
                  <EmailVerificationCard compact />
                </div>
              )}
            </div>
            <Row icon={<KeyRound className="w-4 h-4" />} label="Change Password" chevron onClick={() => setShowPassword(true)} />
            <Row icon={<Trash2 className="w-4 h-4" />} label="Deactivate Account" destructive chevron last onClick={() => setShowDelete(true)} />
          </Section>

          {/* ============ 2. PLAYBACK ============ */}
          <Section label="Playback">
            {/* Crossfade */}
            <div className="px-4 py-3 border-b border-white/5">
              <div className="flex items-center justify-between mb-2">
                <div className="flex items-center gap-3">
                  <Waves className="w-4 h-4 text-primary" />
                  <span className="text-sm">Crossfade</span>
                  {!isPremium && <Crown className="w-3 h-3 text-primary" fill="currentColor" />}
                </div>
                <div className="flex items-center gap-2">
                  <span className="text-xs text-primary font-medium">{!isPremium ? 'Pro' : cfEnabled ? `${cfDuration}s` : 'Off'}</span>
                  <Switch
                    checked={cfEnabled}
                    onCheckedChange={() => {
                      if (!isPremium) { toast.error('Crossfade is a Premium feature'); navigate('/premium'); return; }
                      toggleCrossfade();
                    }}
                    className="data-[state=checked]:bg-primary scale-90"
                    aria-label="Toggle crossfade"
                  />
                </div>
              </div>
              {cfEnabled && (
                <Slider value={[cfDuration]} onValueChange={([val]) => setCrossfadeDuration(val)} max={12} step={1} className="[&_[role=slider]]:w-5 [&_[role=slider]]:h-5" />
              )}
            </div>

            {/* Crossfade Curve */}
            <div className="px-4 py-3 border-b border-white/5">
              <div className="flex items-center justify-between mb-2">
                <div className="flex items-center gap-3">
                  <Waves className="w-4 h-4 text-primary" />
                  <span className="text-sm">Crossfade Curve</span>
                </div>
                <span className="text-[10px] font-extrabold uppercase tracking-wider text-primary">Pro</span>
              </div>
              <div className="grid grid-cols-4 gap-1.5">
                {([
                  { id: 'linear', label: 'Linear' },
                  { id: 'equal-power', label: 'DJ' },
                  { id: 'smooth', label: 'Smooth' },
                  { id: 'exponential', label: 'Punch' },
                ] as const).map((c) => {
                  const active = crossfadeCurve === c.id;
                  return (
                    <button
                      key={c.id}
                      onClick={() => {
                        if (!isPremium) { navigate('/premium'); return; }
                        setCrossfadeCurve(c.id);
                        toast.success(`${c.label} curve applied`);
                      }}
                      className={`py-1.5 rounded-lg text-xs font-medium transition-colors ${
                        active ? 'bg-primary text-primary-foreground' : 'bg-muted/40 text-foreground/70 active:bg-muted'
                      }`}
                    >
                      {c.label}
                    </button>
                  );
                })}
              </div>
            </div>

            <Row
              icon={<Zap className="w-4 h-4" />}
              label="Gapless Pro"
              sub="Bit-perfect transitions on premium"
              right={
                <Switch
                  checked={gaplessPro}
                  onCheckedChange={() => { if (!isPremium) { navigate('/premium'); return; } toggleGaplessPro(); }}
                  className="data-[state=checked]:bg-primary scale-90"
                  aria-label="Toggle Gapless Pro"
                />
              }
            />
            <Row
              icon={<Repeat className="w-4 h-4" />}
              label="Gapless Playback"
              right={<Switch checked={gaplessPlayback} onCheckedChange={handleGapless} className="data-[state=checked]:bg-primary scale-90" aria-label="Toggle gapless playback" />}
            />
            <Row
              icon={<PlayCircle className="w-4 h-4" />}
              label="Autoplay"
              sub="Keep the queue rolling when it ends"
              right={<Switch checked={autoplay} onCheckedChange={handleAutoplay} className="data-[state=checked]:bg-primary scale-90" aria-label="Toggle autoplay" />}
            />

            {/* Streaming quality */}
            <div className="px-4 pt-3 pb-1 flex items-center justify-between">
              <div className="flex items-center gap-3">
                <Radio className="w-4 h-4 text-primary" />
                <span className="text-sm">Streaming Quality</span>
              </div>
              <span className="text-[11px] text-white/50">{QUALITY_OPTIONS.find(o => o.id === streamQuality)?.hint}</span>
            </div>
            <QualitySelector value={streamQuality} onChange={handleStreamQuality} />

            {/* Playback speed */}
            <div className="px-4 py-3 border-b border-white/5">

              <div className="flex items-center justify-between mb-2">
                <div className="flex items-center gap-3">
                  <Gauge className="w-4 h-4 text-primary" />
                  <span className="text-sm">Playback Speed</span>
                  {!isPremium && <Crown className="w-3 h-3 text-primary" fill="currentColor" />}
                </div>
                <span className="text-sm text-primary font-medium">
                  {isPremium ? `${playbackSpeed.toFixed(2)}x` : 'Pro'}
                </span>
              </div>
              <div className={`grid grid-cols-5 gap-1.5 ${!isPremium ? 'opacity-50' : ''}`}>
                {[0.75, 1, 1.25, 1.5, 2].map((s) => (
                  <button
                    key={s}
                    onClick={() => handlePlaybackSpeed(s)}
                    aria-disabled={!isPremium}
                    className={`py-1.5 rounded-lg text-xs font-medium transition-colors ${
                      isPremium && playbackSpeed === s ? 'bg-primary text-primary-foreground' : 'bg-muted/40 text-foreground/70 active:bg-muted'
                    }`}
                  >
                    {s}x
                  </button>
                ))}
              </div>
              {!isPremium && (
                <button
                  onClick={() => navigate('/premium')}
                  className="mt-2 text-[11px] text-primary font-medium"
                >
                  Unlock with Premium
                </button>
              )}
            </div>

            <YouTubeAccountSection />
            <Row icon={<RotateCcw className="w-4 h-4" />} label="Reset Playback Settings" chevron last onClick={handleResetPlayback} />
          </Section>


          {/* ============ 3. DOWNLOADS ============ */}
          <Section label="Downloads">
            <div className="px-4 pt-3 pb-1 flex items-center justify-between">
              <div className="flex items-center gap-3">
                <Download className="w-4 h-4 text-primary" />
                <span className="text-sm">Download Quality</span>
              </div>
              <span className="text-[11px] text-white/50">{QUALITY_OPTIONS.find(o => o.id === downloadQuality)?.hint}</span>
            </div>
            <QualitySelector value={downloadQuality} onChange={handleDownloadQuality} />
            <Row
              icon={<Wifi className="w-4 h-4" />}
              label="Download over Wi-Fi only"
              sub="Skip downloads on mobile data"
              right={<Switch checked={wifiOnlyDownload} onCheckedChange={handleWifiOnly} className="data-[state=checked]:bg-primary scale-90" aria-label="Toggle wifi only downloads" />}
              last
            />
          </Section>

          {/* ============ 4. PRIVACY ============ */}
          <Section label="Privacy">
            <Row
              icon={<EyeOff className="w-4 h-4" />}
              label="Private Profile"
              sub="Hide your profile from future public discovery"
              right={<Switch checked={isPrivate} onCheckedChange={togglePrivate} className="data-[state=checked]:bg-primary scale-90" aria-label="Toggle private profile" />}
              last
            />
          </Section>

          {/* ============ 5. DEVICES ============ */}
          <Section label="Devices">
            {devices.length === 0 && (
              <div className="px-4 py-4 flex items-center gap-3">
                <Smartphone className="w-4 h-4 text-white/30" />
                <p className="text-xs text-white/40">No devices registered for notifications.</p>
              </div>
            )}
            {devices.map((d, idx) => {
              const info = (d.device_info || {}) as Record<string, unknown>;
              const label = String(info.model || info.name || d.platform || 'Device');
              const seen = d.updated_at ? new Date(d.updated_at).toLocaleDateString() : '—';
              const last = idx === devices.length - 1;
              return (
                <div key={d.id} className={`px-4 py-3 flex items-center gap-3 ${last ? '' : 'border-b border-white/5'}`}>
                  <Smartphone className="w-4 h-4 text-primary shrink-0" />
                  <div className="min-w-0 flex-1">
                    <p className="text-sm truncate">{label}</p>
                    <p className="text-[11px] text-white/40">{d.platform || 'device'} · last seen {seen}</p>
                  </div>
                  <button onClick={() => removeDevice(d.id)} className="text-xs text-destructive font-medium px-2 py-1 rounded-md active:bg-destructive/10">Remove</button>
                </div>
              );
            })}
          </Section>

          {/* ============ 6. NOTIFICATIONS ============ */}
          <Section label="Notifications">
            <Row
              icon={<Bell className="w-4 h-4" />}
              label="Push Notifications"
              right={<Switch checked={notifications} onCheckedChange={handleNotifications} className="data-[state=checked]:bg-primary scale-90" aria-label="Toggle push notifications" />}
            />
            <Row
              icon={<Music2 className="w-4 h-4" />}
              label="Smart Mood Picks"
              sub="A daily song that matches your vibe"
              right={
                <Switch
                  checked={moodPushes}
                  onCheckedChange={async (val) => {
                    setMoodPushes(val);
                    const { data: { user: u } } = await supabase.auth.getUser();
                    if (u) {
                      const { error } = await supabase.from('profiles').update({ mood_pushes_enabled: val }).eq('user_id', u.id);
                      if (error) {
                        setMoodPushes(!val);
                        toast.error('Could not update Smart Mood Picks');
                      }
                    }
                  }}
                  className="data-[state=checked]:bg-primary scale-90"
                  aria-label="Toggle Smart Mood Picks"
                />
              }
            />
            <Row
              icon={<Vibrate className="w-4 h-4" />}
              label="Haptic Feedback"
              right={<Switch checked={haptics} onCheckedChange={handleHaptics} className="data-[state=checked]:bg-primary scale-90" aria-label="Toggle haptic feedback" />}
              last
            />
          </Section>

          {/* ============ 7. LANGUAGE & REGION ============ */}
          <Section label="Language & Region">
            <div className="px-4 py-3">
              <div className="flex items-center gap-3 mb-3">
                <Languages className="w-4 h-4 text-primary" />
                <span className="text-sm">App Language</span>
              </div>
              <div className="grid grid-cols-3 gap-1.5">
                {LANGUAGE_OPTIONS.map((l) => {
                  const active = language === l.id;
                  return (
                    <button
                      key={l.id}
                      onClick={() => handleLanguage(l.id)}
                      className={`py-2 rounded-lg text-xs font-medium transition-colors ${
                        active ? 'bg-primary text-primary-foreground' : 'bg-muted/40 text-foreground/70 active:bg-muted'
                      }`}
                    >
                      <div>{l.label}</div>
                      <div className={`text-[10px] font-normal mt-0.5 ${active ? 'text-primary-foreground/70' : 'text-white/40'}`}>{l.native}</div>
                    </button>
                  );
                })}
              </div>
              <p className="text-[10px] text-white/40 mt-2 inline-flex items-center gap-1">
                <Globe className="w-3 h-3" /> Preference saved on this device
              </p>
            </div>
          </Section>

          {/* ============ 8. SUPPORT ============ */}
          <Section label="Support">
            <Row
              icon={<Crown className="w-4 h-4" />}
              label={isPremium ? 'Manage Subscription' : 'Upgrade to Premium'}
              chevron
              onClick={() => navigate(isPremium ? '/subscription' : '/premium')}
            />
            <Row icon={<MessageSquare className="w-4 h-4" />} label="Contact Support" chevron onClick={() => setShowSupport(true)} />
            <Row icon={<HelpCircle className="w-4 h-4" />} label="Help & FAQs" chevron onClick={() => setShowSupport(true)} />
            <Row icon={<Activity className="w-4 h-4" />} label="Playback Diagnostics" chevron last onClick={() => navigate('/debug')} />

          </Section>

          {/* ============ 9. STORAGE ============ */}
          <Section label="Storage">
            <Row
              icon={<HardDrive className="w-4 h-4" />}
              label="Clear Cache"
              destructive
              right={<span className="text-xs text-muted-foreground">{cacheSize}</span>}
              onClick={handleClearCache}
              last
            />
          </Section>

          {/* ============ 10. LEGAL ============ */}
          <Section label="Legal">
            <Row icon={<FileText className="w-4 h-4" />} label="Terms of Service" chevron onClick={() => navigate('/legal/terms')} />
            <Row icon={<ShieldCheck className="w-4 h-4" />} label="Privacy Policy" chevron last onClick={() => navigate('/legal/privacy')} />
          </Section>

          {/* ============ 11. ABOUT ============ */}
          <Section label="About">
            <SettingsUpdateButton />
            <Row icon={<Info className="w-4 h-4" />} label="Version" right={<span className="text-sm text-muted-foreground">1.0.0</span>} />
            <Row icon={<Info className="w-4 h-4" />} label="Build" right={<span className="text-sm text-muted-foreground">2026.04.26</span>} last />
          </Section>
        </main>

        <BottomNav />
        <SupportChatModal isOpen={showSupport} onClose={() => setShowSupport(false)} />
        {showEq && <EqualizerModal isOpen={showEq} onClose={() => setShowEq(false)} />}
        {showEqPremium && (
          <PremiumLockOverlay
            title="Studio Equalizer"
            description="Premium unlocks instant presets, 10-band tuning, stems controls, bass, reverb, and spatial audio."
            onClose={() => setShowEqPremium(false)}
          />
        )}
        <ChangePasswordModal isOpen={showPassword} onClose={() => setShowPassword(false)} />
        <DeleteAccountModal isOpen={showDelete} onClose={() => setShowDelete(false)} />
      </div>
    </PageTransition>
  );
};

export default Settings;
