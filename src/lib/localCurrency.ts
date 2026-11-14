// Indicative local-currency display for INR Premium prices.
// UPI always charges INR; other currencies are shown as "≈" estimates.
import { useEffect, useState } from 'react';
import { detectCountrySilently, timeZoneCountry } from '@/lib/geoCountry';

const COUNTRY_CURRENCY: Record<string, string> = {
  IN: 'INR', US: 'USD', PR: 'USD', EC: 'USD', GB: 'GBP', IE: 'EUR', FR: 'EUR', DE: 'EUR', ES: 'EUR',
  IT: 'EUR', NL: 'EUR', BE: 'EUR', AT: 'EUR', PT: 'EUR', GR: 'EUR', FI: 'EUR', CH: 'CHF',
  SE: 'SEK', NO: 'NOK', DK: 'DKK', PL: 'PLN', CZ: 'CZK', HU: 'HUF', RO: 'RON', UA: 'UAH',
  RU: 'RUB', TR: 'TRY', PK: 'PKR', BD: 'BDT', LK: 'LKR', NP: 'NPR', AE: 'AED', SA: 'SAR',
  QA: 'QAR', KW: 'KWD', OM: 'OMR', BH: 'BHD', JP: 'JPY', KR: 'KRW', CN: 'CNY', HK: 'HKD',
  TW: 'TWD', SG: 'SGD', TH: 'THB', ID: 'IDR', PH: 'PHP', MY: 'MYR', VN: 'VND', IL: 'ILS',
  NG: 'NGN', KE: 'KES', EG: 'EGP', ZA: 'ZAR', GH: 'GHS', MA: 'MAD', CA: 'CAD', MX: 'MXN',
  BR: 'BRL', AR: 'ARS', CL: 'CLP', CO: 'COP', PE: 'PEN', AU: 'AUD', NZ: 'NZD',
};

// Fallback INR→X rates (approximate) used when live rates are unavailable.
const FALLBACK_RATES: Record<string, number> = {
  USD: 0.012, GBP: 0.0094, EUR: 0.011, CHF: 0.0105, SEK: 0.125, NOK: 0.128, DKK: 0.082,
  PLN: 0.047, CZK: 0.27, HUF: 4.3, RON: 0.055, UAH: 0.49, RUB: 1.0, TRY: 0.40, PKR: 3.3,
  BDT: 1.43, LKR: 3.5, NPR: 1.6, AED: 0.044, SAR: 0.045, QAR: 0.044, KWD: 0.0037,
  OMR: 0.0046, BHD: 0.0045, JPY: 1.8, KRW: 16.5, CNY: 0.086, HKD: 0.093, TWD: 0.38,
  SGD: 0.016, THB: 0.41, IDR: 190, PHP: 0.69, MYR: 0.053, VND: 300, ILS: 0.044, NGN: 18,
  KES: 1.55, EGP: 0.58, ZAR: 0.22, GHS: 0.17, MAD: 0.12, CAD: 0.0165, MXN: 0.22, BRL: 0.066,
  ARS: 11, CLP: 11.2, COP: 47, PEN: 0.045, AUD: 0.018, NZD: 0.020,
};

const RATES_KEY = 'uf-inr-rates-v1';
const DAY = 24 * 60 * 60 * 1000;

export function currencyForCountry(country: string): string {
  return COUNTRY_CURRENCY[country.toUpperCase()] ?? 'INR';
}

/** Convert an INR amount and format it; returns '' if conversion is impossible. */
export function formatLocalPrice(inr: number, currency: string, rates: Record<string, number>, locale?: string): string {
  if (currency === 'INR') return `₹${inr}`;
  const rate = rates[currency] ?? FALLBACK_RATES[currency];
  if (!rate || !Number.isFinite(rate)) return '';
  const value = inr * rate;
  const big = value >= 100;
  try {
    return new Intl.NumberFormat(locale, {
      style: 'currency', currency,
      maximumFractionDigits: big ? 0 : 2, minimumFractionDigits: big ? 0 : 2,
    }).format(value);
  } catch { return ''; }
}

async function loadRates(): Promise<Record<string, number>> {
  try {
    const cached = JSON.parse(localStorage.getItem(RATES_KEY) || 'null');
    if (cached && Date.now() - cached.t < DAY) return cached.r;
  } catch { /* ignore */ }
  try {
    const res = await fetch('https://open.er-api.com/v6/latest/INR');
    if (res.ok) {
      const json = await res.json();
      if (json?.rates) {
        localStorage.setItem(RATES_KEY, JSON.stringify({ t: Date.now(), r: json.rates }));
        return json.rates;
      }
    }
  } catch { /* offline — fall back */ }
  return FALLBACK_RATES;
}

export interface LocalCurrency {
  currency: string;
  /** Formats an INR amount in the viewer's currency (with ≈ when converted). */
  format: (inr: number) => string;
  isConverted: boolean;
}

export function useLocalCurrency(): LocalCurrency {
  const [currency, setCurrency] = useState('INR');
  const [rates, setRates] = useState<Record<string, number>>(FALLBACK_RATES);

  useEffect(() => {
    let alive = true;
    const tz = timeZoneCountry();
    if (tz) setCurrency(currencyForCountry(tz));
    detectCountrySilently().then((c) => { if (alive && c) setCurrency(currencyForCountry(c)); }).catch(() => {});
    loadRates().then((r) => { if (alive) setRates(r); });
    return () => { alive = false; };
  }, []);

  const isConverted = currency !== 'INR';
  return {
    currency,
    isConverted,
    format: (inr: number) => {
      const s = formatLocalPrice(inr, currency, rates);
      if (!s) return `₹${inr}`;
      return isConverted ? `≈ ${s}` : s;
    },
  };
}
