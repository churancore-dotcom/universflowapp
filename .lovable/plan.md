# Google Play release hardening

## Outcome
Prepare UniversFlow for a defensible Google Play submission while preserving licensed music features. Approval cannot be guaranteed because Google performs the final review.

## Implementation
1. Replace manual UPI purchases in Android Play builds with Google Play Billing. Keep web/outside-Play behavior separate, validate purchases before granting Premium, restore owned purchases, and show the no-refund-after-activation rule before purchase with exceptions required by Google Play or law.
2. Add a seven-day recoverable deletion flow. A confirmed request immediately disables the account, records the deletion date, supports cancellation during the recovery window, and permanently removes eligible account data after the deadline. Align Settings and Privacy wording with the real behavior.
3. Expand the legal pages with clear billing, cancellation, refund, Premium expiry/download behavior, advertising, copyright notice/counter-notice, rights warranty, and non-affiliation terms. Remove the unbuilt “Listen Together” claim.
4. Remove unnecessary provider names and badges from ordinary playback screens. Do not rename provider authentication or technical sourcing as UniversFlow; remove the optional third-party account-pairing screen from the Play-facing UI instead of disguising it.
5. Harden Android release settings: narrow cleartext/file sharing/backup access, add deterministic release rules, update version defaults, verify signing with Android tooling, and add AAB checks for manifest, target SDK, version, signing, and 16 KB compatibility.
6. Add focused tests for the user-selected rules: Play Billing in the Play build, no refund after activation subject to mandatory exceptions, and seven-day deletion scheduling/cancellation.
7. Verify the app build, relevant tests, key purchase/deletion screens, and the generated AAB workflow configuration.

## What you must provide or do
- Keep the signed music distribution agreement and cover-art permissions ready for review; do not send private contracts or signing passwords here.
- Create the Premium products and prices in Google Play Console using the product IDs implemented in the app.
- Keep an offline backup of the upload keystore and passwords, then add the four signing values to GitHub Actions secrets.
- Complete Play Console Data Safety, ads, content rating, app access, account deletion URL, financial features, and foreground-service declarations.
- Run the required closed test for a new personal developer account before requesting production access.

## AAB release flow
Run the **Build Play Store AAB (signed)** GitHub workflow with a version code higher than every prior upload. Download only `app-release.aab`, upload it first to Internal testing, resolve Play’s automated warnings, then promote through Closed testing before Production.