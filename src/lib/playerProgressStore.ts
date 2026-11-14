// Lightweight external store for high-frequency progress/duration updates.
// Keeping these out of React state prevents 250ms re-renders cascading through
// every component that calls usePlayer().

import { useSyncExternalStore } from 'react';

type Listener = () => void;

const listeners = new Set<Listener>();
let progress = 0;
let duration = 0;
let playing = false;
let rate = 1;

let snapshot = { progress, duration, playing };

const now = () => (typeof performance !== 'undefined' ? performance.now() : Date.now());
let lastProgressAt = now();

const clampProgress = (v: number) => {
  if (!Number.isFinite(v)) return 0;
  return Math.max(0, duration > 0 ? Math.min(v, duration) : v);
};

const emit = () => {
  snapshot = { progress, duration, playing };
  listeners.forEach((l) => l());
};

export const playerProgressStore = {
  setProgress(v: number) {
    const next = clampProgress(v);
    const previous = progress;
    progress = next;
    lastProgressAt = now();
    if (Math.abs(previous - next) < 0.2) return;
    emit();
  },
  setDuration(v: number) {
    if (duration === v) return;
    duration = Number.isFinite(v) ? Math.max(0, v) : 0;
    progress = clampProgress(progress);
    emit();
  },
  setPlaying(v: boolean) {
    if (playing === v) return;
    if (!v) progress = this.getEstimatedProgress();
    playing = v;
    lastProgressAt = now();
    emit();
  },
  /** Playback speed, so estimated progress (bar, lyrics, lock screen) doesn't drift. */
  setRate(v: number) {
    const next = Number.isFinite(v) && v > 0 ? v : 1;
    if (next === rate) return;
    progress = this.getEstimatedProgress();
    lastProgressAt = now();
    rate = next;
  },
  getRate() { return rate; },
  reset() {
    progress = 0;
    duration = 0;
    playing = false;
    lastProgressAt = now();
    emit();
  },
  getProgress() { return progress; },
  getEstimatedProgress() {
    if (!playing) return clampProgress(progress);
    const elapsed = Math.max(0, (now() - lastProgressAt) / 1000);
    return clampProgress(progress + elapsed * rate);
  },
  getDuration() { return duration; },
  getPlaying() { return playing; },
  getSnapshot() { return snapshot; },
  subscribe(l: Listener) {
    listeners.add(l);
    return () => listeners.delete(l);
  },
};

export function usePlayerProgress() {
  return useSyncExternalStore(playerProgressStore.subscribe, playerProgressStore.getSnapshot, playerProgressStore.getSnapshot);
}
