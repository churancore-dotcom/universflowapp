/**
 * Univers Flow signature motion — "the slice".
 * Every reveal on Home wipes in as a skewed clip-path cut rather than a fade,
 * and every press shears slightly instead of just scaling. Presentation only.
 */
export const slice = {
  initial: { clipPath: 'inset(0 100% 0 0)', skewX: -7, x: 12, opacity: 0 },
  animate: { clipPath: 'inset(0 0% 0 0)', skewX: 0, x: 0, opacity: 1 },
};

export const sliceUp = {
  initial: { clipPath: 'inset(100% 0 0 0)', skewY: 3, y: 14, opacity: 0 },
  animate: { clipPath: 'inset(0% 0 0 0)', skewY: 0, y: 0, opacity: 1 },
};

/** Signature easing: fast out of the cut, long settle. */
export const sliceEase = [0.16, 1, 0.3, 1] as const;

export const sliceTransition = (delay = 0) => ({
  duration: 0.62,
  ease: sliceEase,
  delay,
});

/** Press feedback: a shear-and-sink, not a plain scale. */
export const pressShear = { scale: 0.965, skewX: -1.6 };
