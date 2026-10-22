export type CrossfadeCurve = 'linear' | 'equal-power' | 'smooth' | 'exponential';

export function transitionGains(curve: CrossfadeCurve, progress: number) {
  const p = Math.max(0, Math.min(1, progress));
  switch (curve) {
    // DJ: constant loudness, no mid-fade dip.
    case 'equal-power': return { outgoing: Math.cos(p * Math.PI / 2), incoming: Math.sin(p * Math.PI / 2) };
    // Smooth: quintic smootherstep — very gradual, long gentle blend.
    case 'smooth': { const s = p * p * p * (p * (6 * p - 15) + 10); return { outgoing: 1 - s, incoming: s }; }
    // Punch: outgoing holds loud then drops, incoming swells late and slams in.
    case 'exponential': return { outgoing: (1 - p) ** 3, incoming: p ** 3 };
    // Linear: classic even swap with an audible mid-fade dip.
    default: return { outgoing: 1 - p, incoming: p };
  }
}

// Autoplay extends a completed queue; it never stops tracks the user already queued.
export function canExtendQueue(autoplay: boolean, curated: boolean, repeat: string) {
  return autoplay && !curated && repeat === 'off';
}

export function overlapSeconds(crossfade: boolean, duration: number, pro: boolean, repeat: string) {
  if (repeat === 'one') return 0;
  return crossfade ? Math.max(1, Math.min(12, duration)) : pro ? 0.45 : 0;
}