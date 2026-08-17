/**
 * Univers Flow reveal motion — clean edition.
 * The skewed clip-path "slice" was removed (it read as broken). Reveals are now
 * a spring-ish rise + fade, presses are a plain sink. Presentation only.
 * Names are kept so existing call sites stay valid.
 */
export const slice = {
  initial: { y: 12, opacity: 0 },
  animate: { y: 0, opacity: 1 },
};

export const sliceUp = {
  initial: { y: 16, opacity: 0 },
  animate: { y: 0, opacity: 1 },
};

/** Easing: fast out, long settle. */
export const sliceEase = [0.16, 1, 0.3, 1] as const;

export const sliceTransition = (delay = 0) => ({
  duration: 0.5,
  ease: sliceEase,
  delay,
});

/** Press feedback: a straight sink. */
export const pressShear = { scale: 0.97 };
