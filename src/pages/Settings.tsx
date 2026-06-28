import { useState, useEffect, useMemo } from 'react';
import { ChevronLeft, ChevronRight, Crown, MessageSquare, Gauge, RotateCcw, Sliders, Search, Shield, BarChart3, Eye, EyeOff, Globe2, FileText, ScrollText, Lock, Trash2, ImageOff } from 'lucide-react';

import { useNavigate } from 'react-router-dom';
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
import { SettingsUpdateButton } from '@/components/SettingsUpdateButton';
import { supabase } from '@/integrations/supabase/client';

import { setEQSettings } from '@/lib/eqSettings';
import SEOHead from '@/components/SEOHead';
import {
  isHistoryPaused, setHistoryPaused,
  isAnonymousMode, setAnonymousMode,
  isHideExplicit, setHideExplicit,
  isRomanizeLyrics, setRomanizeLyrics,
  getLyricsProvider, setLyricsProvider, type LyricsProvider,
  clearListeningHistory,
} from '@/lib/privacySettings';



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

const Settings = () => {
  const navigate = useNavigate();
  const { isPremium } = usePremium();
  const { crossfade: cfEnabled, crossfadeDuration: cfDuration, crossfadeCurve, gaplessPro, toggleCrossfade, setCrossfadeDuration, setCrossfadeCurve, toggleGaplessPro, audioElement } = usePlayer();

  const [gaplessPlayback, setGaplessPlayback] = useState(() => localStorage.getItem('uf_gapless') !== 'false');
  const [autoplay, setAutoplay] = useState(() => localStorage.getItem('uf_autoplay') !== 'false');
  const [notifications, setNotifications] = useState(() => localStorage.getItem('uf_notifications') !== 'false');
  const [moodPushes, setMoodPushes] = useState(() => localStorage.getItem('uf_mood_pushes') !== 'false');
  const [haptics, setHaptics] = useState(() => localStorage.getItem('uf_haptics') !== 'false');
  const [cacheSize, setCacheSize] = useState('0 MB');
  const [showSupport, setShowSupport] = useState(false);
  const [showEq, setShowEq] = useState(false);
  const [playbackSpeed, setPlaybackSpeed] = useState<number>(() => {
    const s = readEq();
    return typeof s.playbackSpeed === 'number' ? s.playbackSpeed : 1;
  });

  // Privacy + Content
  const [pauseHistory, setPauseHistory] = useState<boolean>(() => isHistoryPaused());
  const [anonMode, setAnonMode] = useState<boolean>(() => isAnonymousMode());
  const [hideExplicit, setHideExplicitState] = useState<boolean>(() => isHideExplicit());
  const [romanize, setRomanize] = useState<boolean>(() => isRomanizeLyrics());
  const [lyricsProv, setLyricsProv] = useState<LyricsProvider>(() => getLyricsProvider());

  // Search filter
  const [query, setQuery] = useState('');
  const q = query.trim().toLowerCase();
  const show = useMemo(() => (keys: string[]) => {
    if (!q) return true;
    return keys.some(k => k.toLowerCase().includes(q));
  }, [q]);



  

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

  const handleGapless = (val: boolean) => {
    setGaplessPlayback(val);
    localStorage.setItem('uf_gapless', String(val));
    emitPlaybackSettingsChanged();
  };
  const handleAutoplay = (val: boolean) => {
    setAutoplay(val);
    localStorage.setItem('uf_autoplay', String(val));
    emitPlaybackSettingsChanged();
  };
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
  const handleHaptics = (val: boolean) => { setHaptics(val); localStorage.setItem('uf_haptics', String(val)); };

  const handlePlaybackSpeed = (speed: number) => {
    setPlaybackSpeed(speed);
    writeEq({ playbackSpeed: speed });
    if (audioElement) {
      try { audioElement.playbackRate = speed; } catch { /* ignore */ }
    }
  };

  const handleResetPlayback = () => {
    handlePlaybackSpeed(1);
    handleGapless(true);
    handleAutoplay(true);
    if (cfEnabled) toggleCrossfade();
    if (gaplessPro) toggleGaplessPro();
    toast.success('Playback settings restored');
  };


  const handleClearCache = async () => {
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
      <div className="h-[100dvh] bg-background flex flex-col overflow-hidden">
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
          <h1 className="text-sm font-semibold absolute left-1/2 -translate-x-1/2">Settings</h1>
        </header>

        <main className="flex-1 overflow-y-auto px-4 pt-3 pb-32 space-y-4" style={{ WebkitOverflowScrolling: 'touch' }}>
          {/* Search */}
          <div className="relative">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-white/40" />
            <input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search settings"
              className="w-full bg-card/50 border border-white/5 rounded-2xl pl-9 pr-3 py-2.5 text-sm placeholder:text-white/30 focus:outline-none focus:border-primary/40"
            />
          </div>

          {/* Account / Email verification */}
          {show(['account','email','verify']) && (
          <section>
            <div className="flex items-center gap-2 mb-2.5 px-1">
              <h2 className="text-[10px] font-extrabold text-white/40 uppercase tracking-[0.2em]">Account</h2>
            </div>
            <EmailVerificationCard />
          </section>
          )}

          {/* Playback */}
          {show(['playback','crossfade','gapless','speed','equalizer','autoplay','audio']) && (
          <section>
            <div className="flex items-center gap-2 mb-2.5 px-1">
              <h2 className="text-[10px] font-extrabold text-white/40 uppercase tracking-[0.2em]">Playback</h2>
            </div>
            <div className="rounded-3xl overflow-hidden bg-card/50 border border-white/5 backdrop-blur-sm">
              <div className="px-4 py-3 border-b border-white/5">
                <div className="flex items-center justify-between mb-2">
                  <div className="flex items-center gap-2">
                    <span className="text-sm">Crossfade</span>
                    {!isPremium && <Crown className="w-3 h-3 text-primary" fill="currentColor" />}
                    <Switch
                      checked={cfEnabled}
                      onCheckedChange={() => {
                        if (!isPremium) {
                          toast.error('Crossfade is a Premium feature');
                          navigate('/premium');
                          return;
                        }
                        toggleCrossfade();
                      }}
                      className="data-[state=checked]:bg-primary scale-75"
                      aria-label="Toggle crossfade"
                    />
                  </div>
                  <span className="text-sm text-primary font-medium">{!isPremium ? 'Pro' : cfEnabled ? `${cfDuration}s` : 'Off'}</span>
                </div>
                {cfEnabled && (
                  <Slider value={[cfDuration]} onValueChange={([val]) => setCrossfadeDuration(val)} max={12} step={1} className="[&_[role=slider]]:w-5 [&_[role=slider]]:h-5" />
                )}
              </div>

              {/* Crossfade Curve — Premium */}
              <div className="px-4 py-3 border-b border-white/5">
                <div className="flex items-center justify-between mb-2">
                  <div className="flex items-center gap-2">
                    <span className="text-sm">Crossfade Curve</span>
                    {!isPremium && <Crown className="w-3 h-3 text-primary" fill="currentColor" />}
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
                <p className="text-[10px] text-muted-foreground mt-2 leading-snug">
                  DJ = constant loudness, Smooth = S-curve, Punch = exponential drop-in.
                </p>
              </div>

              {/* Gapless Pro — Premium */}
              <div className="px-4 py-3 flex items-center justify-between border-b border-white/5">
                <div className="flex items-center gap-2">
                  <span className="text-sm">Gapless Pro</span>
                  {!isPremium && <Crown className="w-3 h-3 text-primary" fill="currentColor" />}
                  <span className="text-[10px] font-extrabold uppercase tracking-wider text-primary">Pro</span>
                </div>
                <Switch
                  checked={gaplessPro}
                  onCheckedChange={() => {
                    if (!isPremium) { navigate('/premium'); return; }
                    toggleGaplessPro();
                  }}
                  className="data-[state=checked]:bg-primary scale-90"
                  aria-label="Toggle Gapless Pro"
                />
              </div>
              <div className="px-4 py-3 flex items-center justify-between border-b border-white/5">
                <span className="text-sm">Gapless Playback</span>
                <Switch checked={gaplessPlayback} onCheckedChange={handleGapless} className="data-[state=checked]:bg-primary scale-90" aria-label="Toggle gapless playback" />
              </div>
              <div className="px-4 py-3 flex items-center justify-between border-b border-white/5">
                <span className="text-sm">Autoplay</span>
                <Switch checked={autoplay} onCheckedChange={handleAutoplay} className="data-[state=checked]:bg-primary scale-90" aria-label="Toggle autoplay" />
              </div>

              {/* Playback speed */}
              <div className="px-4 py-3 border-b border-white/5">
                <div className="flex items-center justify-between mb-2">
                  <div className="flex items-center gap-2">
                    <Gauge className="w-4 h-4 text-primary" />
                    <span className="text-sm">Playback Speed</span>
                  </div>
                  <span className="text-sm text-primary font-medium">{playbackSpeed.toFixed(2)}x</span>
                </div>
                <div className="grid grid-cols-5 gap-1.5">
                  {[0.75, 1, 1.25, 1.5, 2].map((s) => (
                    <button
                      key={s}
                      onClick={() => handlePlaybackSpeed(s)}
                      className={`py-1.5 rounded-lg text-xs font-medium transition-colors ${
                        playbackSpeed === s
                          ? 'bg-primary text-primary-foreground'
                          : 'bg-muted/40 text-foreground/70 active:bg-muted'
                      }`}
                    >
                      {s}x
                    </button>
                  ))}
                </div>
              </div>

              {/* Equalizer shortcut */}
              <button
                onClick={() => {
                  if (!isPremium) {
                    toast.error('Equalizer is a Premium feature');
                    navigate('/premium');
                    return;
                  }
                  setShowEq(true);
                }}
                className="w-full px-4 py-3 flex items-center justify-between border-b border-white/5 active:bg-muted/30"
              >
                <div className="flex items-center gap-2">
                  <Sliders className="w-4 h-4 text-primary" />
                  <span className="text-sm">Equalizer & Effects</span>
                  {!isPremium && <Crown className="w-3 h-3 text-primary" fill="currentColor" />}
                </div>
                <ChevronRight className="w-4 h-4 text-muted-foreground" />
              </button>

              {/* Reset playback */}
              <button
                onClick={handleResetPlayback}
                className="w-full px-4 py-3 flex items-center justify-between active:bg-muted/30"
              >
                <div className="flex items-center gap-2">
                  <RotateCcw className="w-4 h-4 text-muted-foreground" />
                  <span className="text-sm">Reset Playback Settings</span>
                </div>
                <ChevronRight className="w-4 h-4 text-muted-foreground" />
              </button>
            </div>
          </section>
          )}

          {/* Content */}
          {show(['content','explicit','lyrics','romanize','region','language']) && (
          <section>
            <div className="flex items-center gap-2 mb-2.5 px-1">
              <h2 className="text-[10px] font-extrabold text-white/40 uppercase tracking-[0.2em]">Content</h2>
            </div>
            <div className="rounded-3xl overflow-hidden bg-card/50 border border-white/5 backdrop-blur-sm">
              <div className="px-4 py-3 flex items-center justify-between border-b border-white/5">
                <div className="flex items-center gap-2">
                  <EyeOff className="w-4 h-4 text-primary" />
                  <span className="text-sm">Hide Explicit Content</span>
                </div>
                <Switch
                  checked={hideExplicit}
                  onCheckedChange={(v) => { setHideExplicitState(v); setHideExplicit(v); }}
                  className="data-[state=checked]:bg-primary scale-90"
                  aria-label="Toggle hide explicit"
                />
              </div>
              <div className="px-4 py-3 flex items-center justify-between border-b border-white/5">
                <div className="flex items-center gap-2">
                  <Globe2 className="w-4 h-4 text-primary" />
                  <span className="text-sm">Romanize Lyrics (JP/KR/CN)</span>
                </div>
                <Switch
                  checked={romanize}
                  onCheckedChange={(v) => { setRomanize(v); setRomanizeLyrics(v); }}
                  className="data-[state=checked]:bg-primary scale-90"
                  aria-label="Toggle romanize lyrics"
                />
              </div>
              <div className="px-4 py-3">
                <div className="flex items-center justify-between mb-2">
                  <span className="text-sm">Lyrics Source</span>
                  <span className="text-xs text-primary capitalize">{lyricsProv}</span>
                </div>
                <div className="grid grid-cols-4 gap-1.5">
                  {(['auto','lrclib','kugou','netease'] as LyricsProvider[]).map((p) => (
                    <button
                      key={p}
                      onClick={() => { setLyricsProv(p); setLyricsProvider(p); toast.success(`Lyrics: ${p}`); }}
                      className={`py-1.5 rounded-lg text-xs font-medium capitalize transition-colors ${
                        lyricsProv === p ? 'bg-primary text-primary-foreground' : 'bg-muted/40 text-foreground/70 active:bg-muted'
                      }`}
                    >{p}</button>
                  ))}
                </div>
              </div>
            </div>
          </section>
          )}

          {/* Privacy */}
          {show(['privacy','history','anonymous','data']) && (
          <section>
            <div className="flex items-center gap-2 mb-2.5 px-1">
              <h2 className="text-[10px] font-extrabold text-white/40 uppercase tracking-[0.2em]">Privacy</h2>
            </div>
            <div className="rounded-3xl overflow-hidden bg-card/50 border border-white/5 backdrop-blur-sm">
              <div className="px-4 py-3 flex items-center justify-between border-b border-white/5">
                <div className="flex items-center gap-2">
                  <Eye className="w-4 h-4 text-primary" />
                  <div>
                    <div className="text-sm">Pause Listening History</div>
                    <div className="text-[11px] text-white/40">Stops recording plays everywhere</div>
                  </div>
                </div>
                <Switch
                  checked={pauseHistory}
                  onCheckedChange={(v) => { setPauseHistory(v); setHistoryPaused(v); }}
                  className="data-[state=checked]:bg-primary scale-90"
                  aria-label="Pause history"
                />
              </div>
              <div className="px-4 py-3 flex items-center justify-between border-b border-white/5">
                <div className="flex items-center gap-2">
                  <Lock className="w-4 h-4 text-primary" />
                  <div>
                    <div className="text-sm">Anonymous Mode</div>
                    <div className="text-[11px] text-white/40">Listen without building a taste profile</div>
                  </div>
                </div>
                <Switch
                  checked={anonMode}
                  onCheckedChange={(v) => { setAnonMode(v); setAnonymousMode(v); }}
                  className="data-[state=checked]:bg-primary scale-90"
                  aria-label="Anonymous mode"
                />
              </div>
              <button
                onClick={async () => {
                  if (!confirm('Clear all listening history? This cannot be undone.')) return;
                  await clearListeningHistory();
                  toast.success('Listening history cleared');
                }}
                className="w-full px-4 py-3 flex items-center justify-between text-destructive active:bg-destructive/10"
              >
                <div className="flex items-center gap-2">
                  <Trash2 className="w-4 h-4" />
                  <span className="text-sm font-medium">Clear Listening History</span>
                </div>
                <ChevronRight className="w-4 h-4 opacity-60" />
              </button>
            </div>
          </section>
          )}

          {/* Stats */}
          {show(['stats','insights','listening']) && (
          <section>
            <div className="flex items-center gap-2 mb-2.5 px-1">
              <h2 className="text-[10px] font-extrabold text-white/40 uppercase tracking-[0.2em]">Insights</h2>
            </div>
            <div className="rounded-3xl overflow-hidden bg-card/50 border border-white/5 backdrop-blur-sm">
              <button onClick={() => navigate('/settings/stats')} className="w-full px-4 py-3 flex items-center justify-between active:bg-muted/30">
                <div className="flex items-center gap-2">
                  <BarChart3 className="w-4 h-4 text-primary" />
                  <span className="text-sm">Listening Stats</span>
                </div>
                <ChevronRight className="w-4 h-4 text-muted-foreground" />
              </button>
            </div>
          </section>
          )}

          {/* Support */}
          {show(['support','premium','subscription','contact','upgrade']) && (
          <section>
            <div className="flex items-center gap-2 mb-2.5 px-1">
              <h2 className="text-[10px] font-extrabold text-white/40 uppercase tracking-[0.2em]">Support</h2>
            </div>
            <div className="rounded-3xl overflow-hidden bg-card/50 border border-white/5 backdrop-blur-sm">
              <button onClick={() => navigate(isPremium ? '/subscription' : '/premium')} className="w-full px-4 py-3 flex items-center justify-between border-b border-white/5 active:bg-muted/30">
                <div className="flex items-center gap-2">
                  {isPremium && <span className="px-1.5 py-0.5 rounded-full bg-primary/20 text-[10px] font-medium text-primary">Premium</span>}
                  <span className="text-sm">{isPremium ? 'Manage Subscription' : 'Upgrade to Premium'}</span>
                </div>
                <div className="flex items-center gap-1.5 text-muted-foreground">
                  <Crown className="w-3.5 h-3.5 text-primary" />
                  <ChevronRight className="w-4 h-4" />
                </div>
              </button>
              <button onClick={() => setShowSupport(true)} className="w-full px-4 py-3 flex items-center justify-between active:bg-muted/30">
                <div className="flex items-center gap-2">
                  <MessageSquare className="w-4 h-4 text-primary" />
                  <span className="text-sm">Contact Support</span>
                </div>
                <ChevronRight className="w-4 h-4 text-muted-foreground" />
              </button>
            </div>
          </section>
          )}

          {/* Notifications */}
          {show(['notifications','push','haptic','mood']) && (
          <section>
            <div className="flex items-center gap-2 mb-2.5 px-1">
              <h2 className="text-[10px] font-extrabold text-white/40 uppercase tracking-[0.2em]">Notifications</h2>
            </div>
            <div className="rounded-3xl overflow-hidden bg-card/50 border border-white/5 backdrop-blur-sm">
              <div className="px-4 py-3 flex items-center justify-between border-b border-white/5">
                <span className="text-sm">Push Notifications</span>
                <Switch checked={notifications} onCheckedChange={handleNotifications} className="data-[state=checked]:bg-primary scale-90" aria-label="Toggle push notifications" />
              </div>
              <div className="px-4 py-3 flex items-center justify-between border-b border-white/5">
                <div className="flex flex-col">
                  <span className="text-sm">Smart Mood Picks</span>
                  <span className="text-[11px] text-white/40">A daily song that matches your vibe</span>
                </div>
                <Switch
                  checked={moodPushes}
                  onCheckedChange={async (val) => {
                    setMoodPushes(val);
                    localStorage.setItem('uf_mood_pushes', String(val));
                    const { data: { user } } = await supabase.auth.getUser();
                    if (user) {
                      await supabase.from('profiles').update({ mood_pushes_enabled: val }).eq('user_id', user.id);
                    }
                  }}
                  className="data-[state=checked]:bg-primary scale-90"
                  aria-label="Toggle Smart Mood Picks"
                />
              </div>
              <div className="px-4 py-3 flex items-center justify-between">
                <span className="text-sm">Haptic Feedback</span>
                <Switch checked={haptics} onCheckedChange={handleHaptics} className="data-[state=checked]:bg-primary scale-90" aria-label="Toggle haptic feedback" />
              </div>
            </div>
          </section>
          )}

          {/* Storage */}
          {show(['storage','cache','clear','image','offline']) && (
          <section>
            <div className="flex items-center gap-2 mb-2.5 px-1">
              <h2 className="text-[10px] font-extrabold text-white/40 uppercase tracking-[0.2em]">Storage</h2>
            </div>
            <div className="rounded-3xl overflow-hidden bg-card/50 border border-white/5 backdrop-blur-sm">
              <div className="px-4 py-3 flex items-center justify-between border-b border-white/5">
                <div className="flex items-center gap-2">
                  <ImageOff className="w-4 h-4 text-primary" />
                  <span className="text-sm">App data used</span>
                </div>
                <span className="text-sm text-muted-foreground">{cacheSize}</span>
              </div>
              <button onClick={handleClearCache} className="w-full px-4 py-3 flex items-center justify-between text-destructive active:bg-destructive/10">
                <div className="flex items-center gap-2">
                  <Trash2 className="w-4 h-4" />
                  <span className="text-sm font-medium">Clear All Cache</span>
                </div>
                <ChevronRight className="w-4 h-4 opacity-60" />
              </button>
            </div>
          </section>
          )}

          {/* About */}
          {show(['about','version','build','legal','terms','privacy','license']) && (
          <section>
            <div className="flex items-center gap-2 mb-2.5 px-1">
              <h2 className="text-[10px] font-extrabold text-white/40 uppercase tracking-[0.2em]">About</h2>
            </div>
            <div className="rounded-3xl overflow-hidden bg-card/50 border border-white/5 backdrop-blur-sm">
              <SettingsUpdateButton />
              <button onClick={() => navigate('/legal/terms')} className="w-full px-4 py-3 flex items-center justify-between border-b border-white/5 active:bg-muted/30">
                <div className="flex items-center gap-2">
                  <ScrollText className="w-4 h-4 text-primary" />
                  <span className="text-sm">Terms of Service</span>
                </div>
                <ChevronRight className="w-4 h-4 text-muted-foreground" />
              </button>
              <button onClick={() => navigate('/legal/privacy')} className="w-full px-4 py-3 flex items-center justify-between border-b border-white/5 active:bg-muted/30">
                <div className="flex items-center gap-2">
                  <Shield className="w-4 h-4 text-primary" />
                  <span className="text-sm">Privacy Policy</span>
                </div>
                <ChevronRight className="w-4 h-4 text-muted-foreground" />
              </button>
              <a href="https://github.com/lovable-dev" target="_blank" rel="noreferrer" className="w-full px-4 py-3 flex items-center justify-between border-b border-white/5 active:bg-muted/30">
                <div className="flex items-center gap-2">
                  <FileText className="w-4 h-4 text-primary" />
                  <span className="text-sm">Open-Source Licenses</span>
                </div>
                <ChevronRight className="w-4 h-4 text-muted-foreground" />
              </a>
              <div className="px-4 py-3 flex items-center justify-between border-b border-white/5">
                <span className="text-sm">Version</span>
                <span className="text-sm text-muted-foreground">1.0.0</span>
              </div>
              <div className="px-4 py-3 flex items-center justify-between">
                <span className="text-sm">Build</span>
                <span className="text-sm text-muted-foreground">2026.04.26</span>
              </div>
            </div>
          </section>
          )}
        </main>

        <BottomNav />
        <SupportChatModal isOpen={showSupport} onClose={() => setShowSupport(false)} />
        <EqualizerModal isOpen={showEq} onClose={() => setShowEq(false)} />
      </div>
    </PageTransition>
  );
};

export default Settings;
