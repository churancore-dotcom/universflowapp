import { describe, it, expect } from 'vitest';
import { currencyForCountry, formatLocalPrice } from './localCurrency';

describe('local currency', () => {
  it('India stays in rupees', () => {
    expect(currencyForCountry('IN')).toBe('INR');
    expect(formatLocalPrice(99, 'INR', {})).toBe('₹99');
  });
  it('US users see dollars converted from INR', () => {
    expect(currencyForCountry('US')).toBe('USD');
    expect(formatLocalPrice(100, 'USD', { USD: 0.012 }, 'en-US')).toBe('$1.20');
  });
  it('unknown countries fall back to INR', () => {
    expect(currencyForCountry('ZZ')).toBe('INR');
  });
});
