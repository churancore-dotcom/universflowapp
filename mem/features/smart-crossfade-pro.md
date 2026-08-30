---
name: Smart Crossfade + Gapless Pro
description: Premium DJ-grade crossfade curve picker (linear/equal-power/smooth/exponential) and Gapless Pro zero-gap overlap, both gated in Settings
type: feature
---
- State lives in PlayerContext: `crossfadeCurve` and `gaplessPro`, persisted to localStorage (`uf_crossfade_curve`, `uf_gapless_pro`, `uf_crossfade`, `uf_crossfade_duration`).
- `startCrossfade` applies curve math per step (cos/sin for equal-power, smoothstep for smooth, squared for exponential, linear fallback).
- Gapless Pro: when ON and crossfade OFF, fires `startCrossfade` at 0.45s remaining for a zero-gap overlap; uses current `crossfadeCurve`.
- Settings UI: curve grid (4 buttons) + Gapless Pro switch under crossfade section; both gated with Crown icon for non-premium and navigate to /premium on tap.
- Premium FEATURES entry: "Smart Crossfade + Gapless Pro".
- Zero infra cost — runs entirely client-side using existing dual-audio-element setup.
- Premium gating NEVER writes localStorage: entitlement resolves async after cold boot, so writing 'false' there erased the user's Crossfade/Gapless Pro choice on every launch. Only in-memory state is gated; stored prefs persist until the user changes them.
- Android crossfade (single ExoPlayer, volume ramp) finishes ~0.4s BEFORE the natural track end to avoid racing ExoPlayer's own auto-advance (caused skipped track / silence). Fade-in ramp survives the mediaItemTransition it triggered (`clearNativeFadeTransition(false, { keepRamp: true })`), and any `playing` state with no fade running force-restores master volume.
