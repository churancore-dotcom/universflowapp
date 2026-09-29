# Replace animated sharing with fast link sharing

## Changes

- Make the player Share button open the existing share menu directly.
- Remove animated/video story rendering from the player flow.
- Simplify the share menu to song details, WhatsApp/X/system sharing, and Copy App Link. 
- No song Link ever !!!!! Only app link or image ! 
- Remove card generation, image downloading, canvas work, and media-file sharing from this flow.
- Delete the now-unused story screen and renderer after confirming nothing else imports them.

## Verification

- Check the app compiles.
- Verify the Share button opens immediately on a phone-sized screen without generating media.
- Confirm both copy-link actions and platform sharing remain available.