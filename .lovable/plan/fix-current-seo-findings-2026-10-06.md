# Fix current SEO findings

## Findings to address
- Remove duplicate inherited page titles and descriptions from the shared app shell.
- Remove duplicate Open Graph image/type tags from the shared app shell.
- Add unique metadata for the public artist application, sign-in, and profile-claim pages.

## Implementation
- Keep only sitewide metadata in the shared shell, including charset, viewport, site name, crawler rules, app settings, and organization schema.
- Add route-specific title, description, Open Graph, Twitter, canonical URL, and indexing behavior through the existing SEO helper.
- Preserve existing page content and behavior.

## Verification
- Check the rendered head for the affected routes to confirm one title, one description, and one social-preview set.
- Confirm the preview build succeeds.
- Mark only fully corrected SEO findings as fixed; the next SEO scan will verify them.
