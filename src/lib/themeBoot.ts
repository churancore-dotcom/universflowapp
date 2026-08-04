// Applies the saved theme tokens to :root BEFORE React mounts.
// This guarantees the theme persists across reloads and is consistent
// across every page (not just Settings).
//
// Each theme defines a COMPLETE token set so no element renders unstyled
// in any mode (Pearl/white especially).

// Universflow is locked to Onyx / pure black. Legacy ids remain only so old
// localStorage values/imports do not crash; applyTheme always resolves to black.
type ThemeMode = 'default' | 'light' | 'black';

interface ThemeTokens {
  background: string; foreground: string;
  card: string; cardForeground: string;
  muted: string; mutedForeground: string;
  popover: string; popoverForeground: string;
  secondary: string; secondaryForeground: string;
  border: string; input: string;
  primary: string; primaryForeground: string;
  accent: string; accentForeground: string;
  ring: string;
  destructive: string; destructiveForeground: string;
  // Sidebar / chart tokens (used by some shadcn primitives)
  sidebar: string; sidebarForeground: string;
  sidebarPrimary: string; sidebarPrimaryForeground: string;
  sidebarAccent: string; sidebarAccentForeground: string;
  sidebarBorder: string; sidebarRing: string;
  bodyBg: string;
  // For meta theme-color (status bar)
  statusBar: string;
}

export const THEMES: Record<ThemeMode, ThemeTokens> = {
  // ====== Obsidian — refined deep black + neon rose (default) ======
  default: {
    background: '0 0% 0%', foreground: '0 0% 98%',
    card: '0 0% 7%', cardForeground: '0 0% 98%',
    muted: '0 0% 14%', mutedForeground: '0 0% 60%',
    popover: '0 0% 9%', popoverForeground: '0 0% 98%',
    secondary: '0 0% 11%', secondaryForeground: '0 0% 98%',
    border: '0 0% 16%', input: '0 0% 12%',
    primary: '350 100% 60%', primaryForeground: '0 0% 100%',
    accent: '330 100% 65%', accentForeground: '0 0% 100%',
    ring: '350 100% 60%',
    destructive: '0 84% 60%', destructiveForeground: '0 0% 100%',
    sidebar: '0 0% 5%', sidebarForeground: '0 0% 95%',
    sidebarPrimary: '350 100% 60%', sidebarPrimaryForeground: '0 0% 100%',
    sidebarAccent: '0 0% 12%', sidebarAccentForeground: '0 0% 95%',
    sidebarBorder: '0 0% 14%', sidebarRing: '350 100% 60%',
    bodyBg: '#000',
    statusBar: '#000000',
  },
  // ====== Pearl — TRUE crisp white, fully fixed ======
  light: {
    background: '0 0% 100%', foreground: '240 10% 8%',
    card: '0 0% 100%', cardForeground: '240 10% 8%',
    muted: '240 6% 96%', mutedForeground: '240 5% 38%',
    popover: '0 0% 100%', popoverForeground: '240 10% 8%',
    secondary: '240 6% 97%', secondaryForeground: '240 10% 8%',
    border: '240 6% 90%', input: '240 6% 94%',
    primary: '350 100% 50%', primaryForeground: '0 0% 100%',
    accent: '330 95% 56%', accentForeground: '0 0% 100%',
    ring: '350 100% 50%',
    destructive: '0 75% 52%', destructiveForeground: '0 0% 100%',
    sidebar: '0 0% 100%', sidebarForeground: '240 10% 8%',
    sidebarPrimary: '350 100% 50%', sidebarPrimaryForeground: '0 0% 100%',
    sidebarAccent: '240 6% 96%', sidebarAccentForeground: '240 10% 8%',
    sidebarBorder: '240 6% 88%', sidebarRing: '350 100% 50%',
    bodyBg: '#ffffff',
    statusBar: '#ffffff',
  },
  // ====== Onyx — pure black (OLED) ======
  black: {
    background: '240 5% 11%', foreground: '240 8% 94%',
    card: '240 5% 13%', cardForeground: '240 8% 94%',
    muted: '240 5% 16%', mutedForeground: '240 5% 62%',
    popover: '240 5% 14%', popoverForeground: '240 8% 94%',
    secondary: '240 5% 15%', secondaryForeground: '240 8% 94%',
    border: '240 6% 18%', input: '240 5% 10%',
    primary: '350 100% 62%', primaryForeground: '0 0% 100%',
    accent: '330 100% 66%', accentForeground: '0 0% 100%',
    ring: '350 100% 62%',
    destructive: '0 84% 60%', destructiveForeground: '0 0% 100%',
    sidebar: '240 5% 10%', sidebarForeground: '240 8% 92%',
    sidebarPrimary: '350 100% 62%', sidebarPrimaryForeground: '0 0% 100%',
    sidebarAccent: '240 5% 15%', sidebarAccentForeground: '240 8% 92%',
    sidebarBorder: '240 6% 18%', sidebarRing: '350 100% 62%',
    bodyBg: 'hsl(240 5% 11%)',
    statusBar: '#1b1b1f',
  },
};

export const applyTheme = (_theme: ThemeMode) => {
  const root = document.documentElement;
  const theme: ThemeMode = 'black';
  const t = THEMES.black;

  // Hard lock: no Pearl / white mode can leak through old saved preferences.
  root.classList.remove('light');

  // Core surface tokens
  root.style.setProperty('--background', t.background);
  root.style.setProperty('--foreground', t.foreground);
  root.style.setProperty('--card', t.card);
  root.style.setProperty('--card-foreground', t.cardForeground);
  root.style.setProperty('--muted', t.muted);
  root.style.setProperty('--muted-foreground', t.mutedForeground);
  root.style.setProperty('--popover', t.popover);
  root.style.setProperty('--popover-foreground', t.popoverForeground);
  root.style.setProperty('--secondary', t.secondary);
  root.style.setProperty('--secondary-foreground', t.secondaryForeground);
  root.style.setProperty('--border', t.border);
  root.style.setProperty('--input', t.input);

  // Brand
  root.style.setProperty('--primary', t.primary);
  root.style.setProperty('--primary-foreground', t.primaryForeground);
  root.style.setProperty('--accent', t.accent);
  root.style.setProperty('--accent-foreground', t.accentForeground);
  root.style.setProperty('--ring', t.ring);
  root.style.setProperty('--destructive', t.destructive);
  root.style.setProperty('--destructive-foreground', t.destructiveForeground);

  // Sidebar
  root.style.setProperty('--sidebar-background', t.sidebar);
  root.style.setProperty('--sidebar-foreground', t.sidebarForeground);
  root.style.setProperty('--sidebar-primary', t.sidebarPrimary);
  root.style.setProperty('--sidebar-primary-foreground', t.sidebarPrimaryForeground);
  root.style.setProperty('--sidebar-accent', t.sidebarAccent);
  root.style.setProperty('--sidebar-accent-foreground', t.sidebarAccentForeground);
  root.style.setProperty('--sidebar-border', t.sidebarBorder);
  root.style.setProperty('--sidebar-ring', t.sidebarRing);

  // Glow + gradient helpers used across components
  root.style.setProperty('--glow-primary', t.primary);
  root.style.setProperty('--glow-accent', t.accent);
  root.style.setProperty('--gradient-start', t.primary);
  root.style.setProperty('--gradient-mid', t.accent);

  document.body.style.background = t.bodyBg;
  document.documentElement.style.background = t.bodyBg;
  root.dataset.theme = theme;

  // Update status-bar / browser theme color
  try {
    let meta = document.querySelector('meta[name="theme-color"]') as HTMLMetaElement | null;
    if (!meta) {
      meta = document.createElement('meta');
      meta.name = 'theme-color';
      document.head.appendChild(meta);
    }
    meta.content = t.statusBar;
  } catch { /* ignore */ }

  try { localStorage.setItem('uf_theme', 'black'); } catch { /* ignore */ }
};

export type { ThemeMode };

// Run immediately on import — before React mounts.
try {
  applyTheme('black');
} catch {
  applyTheme('default');
}
