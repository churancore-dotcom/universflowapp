# Fix repeat ads and restore simple sharing

## Changes
- Prevent a dismissed or skipped ad from reopening immediately by consuming the pending transition once and adding a short post-ad guard.
- Make ad breaks a proper full-screen timed experience with support for video creatives, image fallback, clear sponsor labeling, countdown/progress, skip timing, sound control, CTA, and automatic music resume.
- Extend the existing Ads Manager so an admin can upload either a video or image creative and preview what listeners receive.
- Remove the animated song-story flow and make every player Share action open the lightweight sheet directly: artwork, song details, WhatsApp, X, system share, and Copy App Link.
- Delete the unused story renderer after confirming no remaining imports.

## Verification
- Confirm skipping, completing, closing, and CTA actions resume exactly one pending song without reopening the ad.
- Test video and image ad fallbacks at phone size, including mute and skip controls.
- Confirm Share opens immediately without canvas, lyrics loading, or media generation.
- Run focused tests and verify the preview build is clean.
