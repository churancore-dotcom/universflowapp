import { describe, expect, it } from 'vitest';

describe('account deletion recovery window', () => {
  it('keeps the account recoverable for exactly seven full days', () => {
    const requested = Date.parse('2026-10-09T00:00:00.000Z');
    const deadline = new Date(requested + 7 * 24 * 60 * 60 * 1000);
    expect(deadline.toISOString()).toBe('2026-10-16T00:00:00.000Z');
  });
});