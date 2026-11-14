import { describe, expect, it } from 'vitest';
import { normalizeEQSettings, roomStrengthFactor } from './eqSettings';

describe('room strength', () => {
  it('defaults to normal strength (unchanged room level)', () => {
    expect(normalizeEQSettings({}).roomStrength).toBe(50);
    expect(roomStrengthFactor(50)).toBe(1);
  });
  it('light is a quarter of the room, full is 1.75x', () => {
    expect(roomStrengthFactor(0)).toBe(0.25);
    expect(roomStrengthFactor(100)).toBe(1.75);
  });
  it('clamps saved values to 0..100', () => {
    expect(normalizeEQSettings({ roomStrength: 300 }).roomStrength).toBe(100);
    expect(normalizeEQSettings({ roomStrength: -5 }).roomStrength).toBe(0);
  });
});
