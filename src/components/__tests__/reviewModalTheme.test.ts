import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

/**
 * Visual regression guard for ReviewModal's primary CTA and thank-you badge.
 *
 * The bug this protects against: raw HSL channel triplets (`--primary: 350 100% 60%`)
 * used bare inside `linear-gradient()` / `color-mix()` are invalid colour values, so the
 * browser drops the declaration and the pink filled button renders transparent/unstyled.
 * Only validated Tailwind theme utilities (`from-primary`, `text-primary-foreground`, …)
 * are allowed here.
 */
const source = readFileSync(
  resolve(process.cwd(), 'src/components/ReviewModal.tsx'),
  'utf8'
);

const classesFor = (testId: string): string => {
  const idx = source.indexOf(`data-testid="${testId}"`);
  expect(idx, `missing data-testid="${testId}"`).toBeGreaterThan(-1);
  const after = source.slice(idx);
  const match = after.match(/className="([^"]+)"/);
  expect(match, `no className found for ${testId}`).toBeTruthy();
  return match![1];
};

describe('ReviewModal theme tokens', () => {
  it('never uses raw CSS variables in colour functions', () => {
    expect(source).not.toMatch(/var\(--primary/);
    expect(source).not.toMatch(/linear-gradient\([^)]*var\(--/);
    expect(source).not.toMatch(/color-mix\(/);
  });

  it('uses no hardcoded colour utilities for the CTA surfaces', () => {
    for (const id of ['review-submit', 'review-thankyou-heart']) {
      const cls = classesFor(id);
      expect(cls).not.toMatch(/\b(bg|text|from|to)-(white|black)\b/);
      expect(cls).not.toMatch(/#[0-9a-fA-F]{3,8}/);
      expect(cls).not.toMatch(/rgba?\(/);
    }
  });

  it('keeps the pink filled gradient on the Post Review button', () => {
    const cls = classesFor('review-submit');
    expect(cls).toContain('bg-gradient-to-br');
    expect(cls).toContain('from-primary');
    expect(cls).toContain('to-primary/70');
    expect(cls).toContain('text-primary-foreground');
  });

  it('keeps accessible hover, focus and disabled states on the button', () => {
    const cls = classesFor('review-submit');
    expect(cls).toMatch(/hover:(from-primary|brightness-110)/);
    expect(cls).toContain('focus-visible:ring-2');
    expect(cls).toContain('focus-visible:ring-primary');
    expect(cls).toContain('disabled:cursor-not-allowed');
    // opacity must stay high enough to keep the label readable when disabled
    const opacity = cls.match(/disabled:opacity-(\d+)/);
    expect(opacity).toBeTruthy();
    expect(Number(opacity![1])).toBeGreaterThanOrEqual(60);
  });

  it('keeps the thank-you heart badge filled with theme tokens', () => {
    const cls = classesFor('review-thankyou-heart');
    expect(cls).toContain('bg-gradient-to-br');
    expect(cls).toContain('from-primary');
    expect(source).toContain('text-primary-foreground fill-current');
  });
});
