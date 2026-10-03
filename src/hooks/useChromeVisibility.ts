import { useEffect, useSyncExternalStore } from 'react';
import { useLocation } from '@/lib/router-compat';

type Listener = () => void;

const listeners = new Set<Listener>();
let visible = true;
let listening = false;
let frame = 0;
const positions = new WeakMap<EventTarget, number>();

const notify = () => {
  if (frame) cancelAnimationFrame(frame);
  frame = requestAnimationFrame(() => {
    frame = 0;
    listeners.forEach((listener) => listener());
  });
};

// Navigation (and overlay dismissal) must always restore the chrome —
// otherwise the hidden state from a scrolled page leaks into the next page.
const resetVisibility = () => {
  if (visible) return;
  visible = true;
  notify();
};

const readScrollTop = (target: EventTarget | null) => {
  if (target instanceof HTMLElement) return target.scrollTop;
  return window.scrollY || document.documentElement.scrollTop;
};

const handleScroll = (event: Event) => {
  const target = event.target ?? window;
  const current = readScrollTop(target);
  const previous = positions.get(target) ?? 0;
  positions.set(target, current);
  const delta = current - previous;
  if (Math.abs(delta) <= 10) return;

  const next = !(delta > 0 && current > 100);
  if (next === visible) return;
  visible = next;
  notify();
};

const subscribe = (listener: Listener) => {
  listeners.add(listener);
  if (!listening) {
    window.addEventListener('scroll', handleScroll, { passive: true, capture: true });
    listening = true;
  }
  return () => {
    listeners.delete(listener);
    if (listeners.size === 0 && listening) {
      window.removeEventListener('scroll', handleScroll, true);
      listening = false;
      if (frame) cancelAnimationFrame(frame);
      frame = 0;
    }
  };
};

const getSnapshot = () => visible;
const getServerSnapshot = () => true;

export function useChromeVisibility() {
  const { pathname } = useLocation();

  // A new page always starts with the chrome visible, even if the previous
  // page was scrolled down and had hidden it.
  useEffect(() => {
    resetVisibility();
  }, [pathname]);

  return useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);
}