export type CrossfadeCurve = 'linear' | 'equal-power' | 'smooth' | 'exponential';

export function transitionGains(curve: CrossfadeCurve, progress: number) {
  const p = Math.max(0, Math.min(1, progress));
  switch (curve) {
    case 'equal-power': return { outgoing: Math.cos(p * Math.PI / 2), incoming: Math.sin(p * Math.PI / 2) };
    case 'smooth': { const s = p * p * (3 - 2 * p); return { outgoing: 1 - s, incoming: s }; }
    case 'exponential': return { outgoing: (1 - p) ** 2, incoming: p ** 2 };
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