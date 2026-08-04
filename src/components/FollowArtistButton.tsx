import { memo, useEffect, useState, useCallback } from 'react';
import { UserPlus, UserCheck, Loader2 } from 'lucide-react';
import { useAuth } from '@/contexts/AuthContext';
import {
  followArtist as followArtistApi,
  unfollowArtist as unfollowArtistApi,
} from '@/lib/userArtistPrefs';
import { useFollowedArtists } from '@/hooks/useFollowedArtists';
import { triggerHaptic } from '@/hooks/useHaptics';
import { toast } from 'sonner';

interface Props {
  artistName: string;
  artistImage?: string | null;
  source?: 'catalog' | 'lastfm';
  className?: string;
  size?: 'sm' | 'md';
}

const FollowArtistButton = memo(function FollowArtistButton({
  artistName,
  artistImage,
  source = 'lastfm',
  className,
  size = 'sm',
}: Props) {
  const { user } = useAuth();
  const { names } = useFollowedArtists();
  const [isFollowing, setIsFollowing] = useState(false);
  const [busy, setBusy] = useState(false);

  // Follow state comes from the shared, event-driven follow list, so pressing
  // follow anywhere in the app updates every button instantly.
  useEffect(() => {
    if (!user || !artistName) { setIsFollowing(false); return; }
    const target = artistName.trim().toLowerCase();
    setIsFollowing(names.some((n) => n.trim().toLowerCase() === target));
  }, [user, artistName, names]);

  const handleClick = useCallback(async (e: React.MouseEvent) => {
    e.stopPropagation();
    e.preventDefault();
    if (!user) {
      toast.error('Sign in to follow artists');
      return;
    }
    if (!artistName.trim()) return;
    setBusy(true);
    triggerHaptic('impactLight');
    try {
      if (isFollowing) {
        const ok = await unfollowArtistApi(user.id, artistName.trim());
        if (ok) {
          setIsFollowing(false);
          toast.success(`Unfollowed ${artistName}`);
        }
      } else {
        const ok = await followArtistApi(user.id, artistName.trim(), {
          image: artistImage || null,
          source,
        });
        if (ok) {
          setIsFollowing(true);
          toast.success(`Following ${artistName}`);
        }
      }
    } finally {
      setBusy(false);
    }
  }, [user, artistName, artistImage, source, isFollowing]);

  const dim = size === 'sm' ? 'h-7 px-3 text-[11px]' : 'h-9 px-4 text-xs';

  return (
    <button
      type="button"
      onClick={handleClick}
      disabled={busy}
      className={`${dim} rounded-full font-bold inline-flex items-center gap-1.5 transition-all active:scale-95 ${className || ''}`}
      style={{
        background: isFollowing ? 'rgba(255,255,255,0.08)' : 'hsl(var(--primary))',
        color: isFollowing ? 'hsl(var(--foreground))' : 'hsl(var(--primary-foreground))',
        border: isFollowing ? '1px solid rgba(255,255,255,0.15)' : 'none',
      }}
    >
      {busy ? (
        <Loader2 className="w-3 h-3 animate-spin" />
      ) : isFollowing ? (
        <><UserCheck className="w-3 h-3" /> Following</>
      ) : (
        <><UserPlus className="w-3 h-3" /> Follow</>
      )}
    </button>
  );
});

export default FollowArtistButton;
