// Phone validation using libphonenumber-js (offline, free, comprehensive)
// Catches: wrong length per country, invalid operator prefixes, repeated digits,
// sequential digits, all-zeros / all-same — the classic fake-number tricks.
import {
  parsePhoneNumberFromString,
  isValidPhoneNumber,
  getCountryCallingCode,
  CountryCode,
} from 'libphonenumber-js';

// Expected national-number digit length per country (most common).
// Used for inline live feedback before the user finishes typing.
export const PHONE_DIGITS: Record<string, number> = {
  AC: 5, AD: 6, AE: 9, AF: 9, AG: 10, AI: 10, AL: 9, AM: 8,
  AO: 9, AR: 11, AS: 10, AT: 9, AU: 9, AW: 7, AX: 9, AZ: 9,
  BA: 8, BB: 10, BD: 10, BE: 9, BF: 8, BG: 8, BH: 8, BI: 8,
  BJ: 10, BL: 9, BM: 10, BN: 7, BO: 8, BQ: 7, BR: 11, BS: 10,
  BT: 8, BW: 8, BY: 9, BZ: 7, CA: 10, CC: 9, CD: 9, CF: 8,
  CG: 9, CH: 9, CI: 10, CK: 5, CL: 9, CM: 9, CN: 11, CO: 10,
  CR: 8, CU: 8, CV: 7, CW: 8, CX: 9, CY: 8, CZ: 9, DE: 11,
  DJ: 8, DK: 8, DM: 10, DO: 10, DZ: 9, EC: 9, EE: 8, EG: 10,
  EH: 9, ER: 7, ES: 9, ET: 9, FI: 9, FJ: 7, FK: 5, FM: 7,
  FO: 6, FR: 9, GA: 8, GB: 10, GD: 10, GE: 9, GF: 9, GG: 10,
  GH: 9, GI: 8, GL: 6, GM: 7, GN: 9, GP: 9, GQ: 9, GR: 10,
  GT: 8, GU: 10, GW: 9, GY: 7, HK: 8, HN: 8, HR: 9, HT: 8,
  HU: 9, ID: 9, IE: 9, IL: 9, IM: 10, IN: 10, IO: 7, IQ: 10,
  IR: 10, IS: 7, IT: 10, JE: 10, JM: 10, JO: 9, JP: 10, KE: 9,
  KG: 9, KH: 8, KI: 8, KM: 7, KN: 10, KP: 10, KR: 10, KW: 8,
  KY: 10, KZ: 10, LA: 10, LB: 8, LC: 10, LI: 9, LK: 9, LR: 9,
  LS: 8, LT: 8, LU: 9, LV: 8, LY: 9, MA: 9, MC: 9, MD: 8,
  ME: 8, MF: 9, MG: 9, MH: 7, MK: 8, ML: 8, MM: 8, MN: 8,
  MO: 8, MP: 10, MQ: 9, MR: 8, MS: 10, MT: 8, MU: 8, MV: 7,
  MW: 9, MX: 10, MY: 9, MZ: 9, NA: 9, NC: 6, NE: 8, NF: 6,
  NG: 10, NI: 8, NL: 9, NO: 8, NP: 10, NR: 7, NU: 7, NZ: 9,
  OM: 8, PA: 8, PE: 9, PF: 8, PG: 8, PH: 10, PK: 10, PL: 9,
  PM: 6, PR: 10, PS: 9, PT: 9, PW: 7, PY: 9, QA: 8, RE: 9,
  RO: 9, RS: 9, RU: 10, RW: 9, SA: 9, SB: 7, SC: 7, SD: 9,
  SE: 9, SG: 8, SH: 5, SI: 8, SJ: 8, SK: 9, SL: 8, SM: 8,
  SN: 9, SO: 8, SR: 7, SS: 9, ST: 7, SV: 8, SX: 10, SY: 9,
  SZ: 8, TA: 4, TC: 10, TD: 8, TG: 8, TH: 9, TJ: 9, TK: 4,
  TL: 8, TM: 8, TN: 8, TO: 7, TR: 10, TT: 10, TV: 6, TW: 9,
  TZ: 9, UA: 9, UG: 9, US: 10, UY: 8, UZ: 9, VA: 10, VC: 10,
  VE: 10, VG: 10, VI: 10, VN: 9, VU: 7, WF: 6, WS: 7, XK: 8,
  YE: 9, YT: 9, ZA: 9, ZM: 9, ZW: 9,
};

export interface PhoneCheck {
  ok: boolean;
  e164?: string;
  troll?: string; // playful message when fake
  reason?: string;
}

// Detect obvious fake patterns even when length matches.
function looksFake(digits: string): string | null {
  if (/^(\d)\1+$/.test(digits)) return 'all-same';
  // 1234567890 / 9876543210 etc.
  let asc = true, desc = true;
  for (let i = 1; i < digits.length; i++) {
    if (+digits[i] !== +digits[i - 1] + 1) asc = false;
    if (+digits[i] !== +digits[i - 1] - 1) desc = false;
  }
  if (asc || desc) return 'sequential';
  // Classic Bollywood fakes
  if (['1234567890', '9876543210', '0000000000', '1111111111'].includes(digits)) return 'classic-fake';
  return null;
}

const TROLLS = [
  '😏 Nice try, but Universflow doesn\'t accept made-up numbers.',
  '🤨 That phone number is faker than a $3 bill. Try a real one.',
  '🚫 Even Spotify wouldn\'t fall for that number. We won\'t either.',
  '🎭 Your fake number game is weak. Use the real one, superstar.',
  '👀 We see you typing 1234567890. We\'re Universflow, not Universnaive.',
  '🪪 Real artists use real numbers. No exceptions, no shortcuts.',
];

export function validatePhone(country: string, raw: string): PhoneCheck {
  const cc = (country || '').toUpperCase() as CountryCode;
  const digits = (raw || '').replace(/\D/g, '');

  if (!digits) return { ok: false, reason: 'Enter your phone number.' };

  const expected = PHONE_DIGITS[cc];
  if (expected && digits.length !== expected) {
    return {
      ok: false,
      reason: `${cc} numbers must be exactly ${expected} digits (you entered ${digits.length}).`,
    };
  }

  const fake = looksFake(digits);
  if (fake) {
    return {
      ok: false,
      reason: 'Fake number detected.',
      troll: TROLLS[Math.floor(Math.random() * TROLLS.length)],
    };
  }

  // libphonenumber: definitive structural + operator-prefix validation.
  try {
    const parsed = parsePhoneNumberFromString(raw, cc);
    if (!parsed || !parsed.isValid() || !isValidPhoneNumber(raw, cc)) {
      return {
        ok: false,
        reason: 'Not a valid mobile number for your country.',
        troll: TROLLS[Math.floor(Math.random() * TROLLS.length)],
      };
    }
    return { ok: true, e164: parsed.number };
  } catch {
    return { ok: false, reason: 'Could not validate this number.' };
  }
}

export function getDialCode(country: string): string {
  try {
    return '+' + getCountryCallingCode((country || 'IN').toUpperCase() as CountryCode);
  } catch {
    return '+91';
  }
}
