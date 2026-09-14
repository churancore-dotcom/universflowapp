# Repair Home, Search, Queue, and Playback Settings

## What will change

- Replace Home's old global chart/release inputs with JioSaavn-first Indian catalog rails. Keep Audius only as a fallback, hide thin sections, and never invent tracks.
- Add real JioSaavn search pagination, merge multiple pages without duplicates, and avoid applying YouTube-specific spam rules to clean provider results.
- Remove Android's second, incompatible queue deduplication. Preserve the exact queue order and stable media IDs created by the app.
- Make native track transitions resolve by stable fingerprint when an index is stale, update the visible song immediately, and recover from an unplayable next track instead of showing silent moving progress.
- Finish the native settings path so Crossfade, Gapless Pro, curve changes, playback speed, and EQ are reapplied on every transition and after recovery.
- Replace remaining auto-mix and suggestions calls that still depend on YouTube with JioSaavn/Audius-backed results.

## Verification

- Test paginated Indian catalog searches and deduplication.
- Add regression coverage for queue order, duplicate provider tracks, and native media-ID lookup.
- Run focused tests and verify the current build and runtime logs are clean.
- The Android queue/settings fixes will require a fresh APK to test on-device.

## Technical details

- Keep content fingerprints based on normalized title plus primary artist across React and Android.
- Preserve JioSaavn stream-quality selection and existing persistent caches while extending cache keys by query and page.
- Do not restore YouTube as a visible catalog or automatic playback dependency.
