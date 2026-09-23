// Silent country detection — Spotify-style.
// 1) Edge function (uses CDN country header OR a real IP geo lookup).
// 2) Device time zone → country (set by the OS, survives VPNs and the
//    en-US default locale Android ships with).
// 3) Browser-locale region tag when it actually contains a region.
// 4) Empty string → consumers fall back to a Global feed (never forced IN/US).
// Cached per session so we hit the edge at most once per tab.
import { supabase } from '@/integrations/supabase/client';

const CACHE_KEY = 'uf-geo-country';

/**
 * IANA time zone → ISO country. The zone name itself carries the market for
 * every zone we care about, and the OS sets it from the SIM / network, so a
 * listener in Los Angeles resolves to US even with an en-IN keyboard locale.
 */
const TZ_COUNTRY: Record<string, string> = {
  'Asia/Kolkata': 'IN', 'Asia/Calcutta': 'IN', 'Asia/Karachi': 'PK',
  'Asia/Dhaka': 'BD', 'Asia/Colombo': 'LK', 'Asia/Kathmandu': 'NP',
  'Asia/Dubai': 'AE', 'Asia/Riyadh': 'SA', 'Asia/Qatar': 'QA',
  'Asia/Tokyo': 'JP', 'Asia/Seoul': 'KR', 'Asia/Shanghai': 'CN',
  'Asia/Hong_Kong': 'HK', 'Asia/Taipei': 'TW', 'Asia/Singapore': 'SG',
  'Asia/Bangkok': 'TH', 'Asia/Jakarta': 'ID', 'Asia/Manila': 'PH',
  'Asia/Kuala_Lumpur': 'MY', 'Asia/Ho_Chi_Minh': 'VN', 'Asia/Jerusalem': 'IL',
  'Asia/Istanbul': 'TR', 'Europe/Istanbul': 'TR',
  'Europe/London': 'GB', 'Europe/Dublin': 'IE', 'Europe/Paris': 'FR',
  'Europe/Berlin': 'DE', 'Europe/Madrid': 'ES', 'Europe/Rome': 'IT',
  'Europe/Amsterdam': 'NL', 'Europe/Brussels': 'BE', 'Europe/Vienna': 'AT',
  'Europe/Zurich': 'CH', 'Europe/Stockholm': 'SE', 'Europe/Oslo': 'NO',
  'Europe/Copenhagen': 'DK', 'Europe/Helsinki': 'FI', 'Europe/Warsaw': 'PL',
  'Europe/Prague': 'CZ', 'Europe/Budapest': 'HU', 'Europe/Lisbon': 'PT',
  'Europe/Athens': 'GR', 'Europe/Bucharest': 'RO', 'Europe/Kiev': 'UA',
  'Europe/Kyiv': 'UA', 'Europe/Moscow': 'RU',
  'Africa/Lagos': 'NG', 'Africa/Nairobi': 'KE', 'Africa/Cairo': 'EG',
  'Africa/Johannesburg': 'ZA', 'Africa/Accra': 'GH', 'Africa/Casablanca': 'MA',
  'America/Toronto': 'CA', 'America/Vancouver': 'CA', 'America/Edmonton': 'CA',
  'America/Winnipeg': 'CA', 'America/Halifax': 'CA', 'America/St_Johns': 'CA',
  'America/Mexico_City': 'MX', 'America/Monterrey': 'MX', 'America/Tijuana': 'MX',
  'America/Sao_Paulo': 'BR', 'America/Bahia': 'BR', 'America/Fortaleza': 'BR',
  'America/Recife': 'BR', 'America/Manaus': 'BR',
  'America/Argentina/Buenos_Aires': 'AR', 'America/Santiago': 'CL',
  'America/Bogota': 'CO', 'America/Lima': 'PE', 'America/Caracas': 'VE',
  'America/Guatemala': 'GT', 'America/Panama': 'PA', 'America/Havana': 'CU',
  'America/Santo_Domingo': 'DO', 'America/Puerto_Rico': 'PR',
  'America/New_York': 'US', 'America/Chicago': 'US', 'America/Denver': 'US',
  'America/Los_Angeles': 'US', 'America/Phoenix': 'US', 'America/Anchorage': 'US',
  'America/Detroit': 'US', 'America/Indiana/Indianapolis': 'US',
  'America/Kentucky/Louisville': 'US', 'America/Boise': 'US',
  'Pacific/Honolulu': 'US', 'US/Eastern': 'US', 'US/Central': 'US',
  'US/Mountain': 'US', 'US/Pacific': 'US',
  'Australia/Sydney': 'AU', 'Australia/Melbourne': 'AU', 'Australia/Brisbane': 'AU',
  'Australia/Perth': 'AU', 'Australia/Adelaide': 'AU',
  'Pacific/Auckland': 'NZ',
};

/** Country implied by the device's time zone, or '' when unknown. */
export function timeZoneCountry(): string {
  try {
    const tz = Intl.DateTimeFormat().resolvedOptions().timeZone || '';
    if (!tz) return '';
    const direct = TZ_COUNTRY[tz];
    if (direct) return direct;
    // Unlisted US/Canada zones ("America/Indiana/Knox", "America/Nome" …):
    // fall back on the region prefix only for unambiguous cases.
    if (/^US\//.test(tz)) return 'US';
    return '';
  } catch {
    return '';
  }
}

function localeRegion(): string {
  try {
    const navAny = navigator as unknown as { languages?: string[]; language?: string };
    const candidates = [
      ...(navAny.languages || []),
      navAny.language || '',
      Intl.DateTimeFormat().resolvedOptions().locale || '',
    ];
    const regions: string[] = [];
    for (const raw of candidates) {
      const m = raw.toUpperCase().match(/-([A-Z]{2})(?:[-_]|$)/);
      if (m?.[1] && !regions.includes(m[1])) regions.push(m[1]);
    }
    // Prefer a region the user actually chose over the en-US default Android
    // ships with, but never throw US away when it is all we have — that is
    // what pushed real US listeners onto a Global/Indian feed.
    return regions.find((r) => r !== 'US') || regions[0] || '';
  } catch { /* noop */ }
  return '';
}

export async function detectCountrySilently(): Promise<string> {
  try {
    const cached = sessionStorage.getItem(CACHE_KEY);
    if (cached && /^[A-Z]{2}$/.test(cached)) return cached;
  } catch { /* noop */ }

  let cc: string | null = null;
  try {
    const { data } = await supabase.functions.invoke('geo-detect');
    if (data?.country_code && /^[A-Z]{2}$/.test(data.country_code)) {
      cc = data.country_code;
    }
  } catch { /* edge unavailable */ }

  const final = cc || timeZoneCountry() || localeRegion() || '';
  if (final) {
    try { sessionStorage.setItem(CACHE_KEY, final); } catch { /* noop */ }
  }
  return final;
}
