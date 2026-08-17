# Plan: Audio & Home UI Overhaul

Improve the audio processing engine with better spaces and a "Master Chain" effect, and rebuild the Home page for a premium look.

## Audio Engine & EQ
- **New Spaces (Reverb Profiles):** Add `chapel`, `opera`, `arena`, `canyon`, and `club` with distinct IR (Impulse Response) parameters in `audioEngine.ts`.
- **"Master Chain" Effect:** Replace the simple "Vocal Remover" stems with a more sophisticated mid/side processing chain.
    - Add a "Mastering" stage that combines adaptive loudness, bass restoration, and stereo width.
    - Update `EQSettings` interface and `DEFAULT_EQ_SETTINGS` in `eqSettings.ts`.
    - Implement the DSP logic in `audioEngine.ts` (Mid/Side splitting, frequency-aware gain, stereo widening).
- **UI Update:** Revamp `EqualizerModal.tsx` to show clear, labeled space cards with descriptions and replace the stems tab with the new "Master Chain" controls.
- **Native Sync:** Update `useGlobalAudioEngine.ts` to sync the new spaces and master effect parameters to the native Android (ExoPlayer) side.

## Home Page Redesign
- **Visual Identity:** Adopt a refined "Obsidian" theme (dark, deep colors) with Rose accents, clean typography (Space Grotesk or similar), and generous whitespace.
- **Layout:** Use a consistent rail-based layout with uniform card sizes (28px radius for sections, 14px for thumbnails).
- **Hero Section:** Rebuild with a full-bleed artwork-dominant tile, clean typography, and a "Play" action that feels integrated.
- **Components:** Standardize `RailHeader.tsx` and section components for visual consistency.
- **Color Palette:**
    - Background: Deep Obsidian (`#0F172A` or similar)
    - Accents: Rose (`#FF2D55`) and subtle Volt highlights.

## Technical Details
- **AudioEngine:** Use frequency-aware Mid/Side splitting (MidLow < 180Hz, MidBand 180Hz-9kHz, MidHigh > 9kHz) to isolate elements without losing track energy.
- **Home UI:** Use `framer-motion` for smooth, uniform entrance animations (staggered rails).
- **Skeletons:** Update `PageSkeletons.tsx` to match the new layout to prevent layout shifts.

## Verification
- Verify AudioEngine logic with `tsgo`.
- Check Home page rendering in mobile viewport using Playwright.
- Smoke test EQ presets and spaces.
