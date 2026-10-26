// Optional "iOS Style" look. Pure presentation: toggles a class on <html>
// that styles.css uses for fonts, tab bar, grouped lists and motion.
const KEY = 'uf_ios_style';
export const IOS_STYLE_EVENT = 'uf-ios-style-changed';

export const getIosStyle = (): boolean => {
  try { return localStorage.getItem(KEY) === 'true'; } catch { return false; }
};

export const applyIosStyle = (on: boolean) => {
  if (typeof document === 'undefined') return;
  document.documentElement.classList.toggle('ios-style', on);
};

export const setIosStyle = (on: boolean) => {
  try { localStorage.setItem(KEY, String(on)); } catch { /* ignore */ }
  applyIosStyle(on);
  try { window.dispatchEvent(new CustomEvent(IOS_STYLE_EVENT, { detail: on })); } catch { /* ignore */ }
};

if (typeof window !== 'undefined') applyIosStyle(getIosStyle());
