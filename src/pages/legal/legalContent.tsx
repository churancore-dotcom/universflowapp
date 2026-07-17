import { ReactNode } from 'react';

export const USER_TERMS_UPDATED = '17 June 2026';
export const ARTIST_TERMS_UPDATED = '17 June 2026';

export const SUPPORT_EMAIL = 'universflow.in@gmail.com';
export const COMPANY_DISPLAY = 'Universflow';

export const UserTermsBody = (): ReactNode => (
  <>
    <h2>1. Acceptance</h2>
    <p>By creating an account or using {COMPANY_DISPLAY} ("the App"), you agree to these Terms. If you do not agree, do not use the App.</p>

    <h2>2. Eligibility</h2>
    <p>You must be at least 13 years old. If you are under the age of majority in your country, you must have a parent or guardian's permission.</p>

    <h2>3. Your account</h2>
    <p>You are responsible for keeping your password safe and for everything that happens under your account. Notify us immediately at {SUPPORT_EMAIL} if you suspect unauthorized access.</p>

    <h2>4. Content & use of the service</h2>
    <p>The App lets you stream music from various sources, build libraries and playlists, and (where supported) download for offline listening. You may use the App for personal, non-commercial enjoyment only.</p>
    <p>You agree not to: (a) attempt to reverse-engineer, scrape, or rip the audio streams; (b) bypass any rate limits, ads, or premium gates; (c) use bots; (d) upload anything that is illegal, infringing, hateful, or harmful.</p>

    <h2>5. Premium subscriptions</h2>
    <p>Premium plans purchased via UPI or promo code give you ad-free playback, unlimited downloads and other features for the duration shown at checkout. Premium auto-expires at the end of the paid period and does not auto-renew. Refunds are handled case-by-case via {SUPPORT_EMAIL}.</p>

    <h2>6. Third-party content</h2>
    <p>Some catalog content is served from third parties. We are not the source or owner of all music available through the App. If you believe content infringes your rights, see our takedown process at {SUPPORT_EMAIL}.</p>

    <h2>7. Termination</h2>
    <p>We may suspend or terminate your account for violating these Terms. You can delete your account at any time from Settings.</p>

    <h2>8. Disclaimers & liability</h2>
    <p>The App is provided "as is". To the extent permitted by law, {COMPANY_DISPLAY} is not liable for indirect, incidental, or consequential damages arising from your use of the service.</p>

    <h2>9. Changes</h2>
    <p>We may update these Terms. Continued use after an update means you accept the new Terms.</p>

    <h2>10. Contact</h2>
    <p>Questions? Email {SUPPORT_EMAIL}.</p>
  </>
);

export const UserPrivacyBody = (): ReactNode => (
  <>
    <h2>1. What we collect</h2>
    <ul>
      <li><strong>Account:</strong> email, username, optional country and avatar.</li>
      <li><strong>Usage:</strong> songs you play, like, download, and add to playlists, plus device + app version.</li>
      <li><strong>Approximate location:</strong> derived from IP at the country level for charts and recommendations. We do not collect precise GPS.</li>
      <li><strong>Payments:</strong> if you buy Premium via UPI, we record the transaction reference, amount and plan. We never see your bank or UPI PIN.</li>
    </ul>

    <h2>2. How we use it</h2>
    <p>To run the service (playlists, downloads, recommendations), keep it secure, send important notifications, and improve features. Aggregate, non-personal stats may be shown publicly (e.g. global top charts).</p>

    <h2>3. Sharing</h2>
    <p>We share data only with: (a) infrastructure providers needed to run the App (database, push notifications, email), (b) authorities when legally required. We do not sell your data.</p>

    <h2>4. Retention</h2>
    <p>Account data lives until you delete the account. Listening history is kept to power your recommendations and can be cleared from Settings.</p>

    <h2>5. Your rights</h2>
    <p>You can access, export, or delete your data by emailing {SUPPORT_EMAIL}. Under GDPR and India's DPDP Act you have rights of access, correction, deletion, and objection.</p>

    <h2>6. Children</h2>
    <p>The App is not directed at children under 13.</p>

    <h2>7. Security</h2>
    <p>We use industry-standard encryption in transit and at rest. No system is perfect — please use a strong password.</p>

    <h2>8. Contact</h2>
    <p>Privacy questions: {SUPPORT_EMAIL}.</p>
  </>
);

export const ArtistTermsBody = (): ReactNode => (
  <>
    <h2>1. Who this applies to</h2>
    <p>These Artist Terms apply when you apply for, or hold, a verified Artist account on {COMPANY_DISPLAY}. The general User Terms also apply.</p>

    <h2>2. Eligibility & verification</h2>
    <p>You confirm that the identity document, photo and social links you submit belong to you and that you have the right to be promoted as the artist named in the application. Verification typically takes 1 to 3 days. We may approve or reject any application at our sole discretion.</p>

    <h2>3. Your content</h2>
    <p>You may publish only music you own or have full rights to distribute. By uploading a song you grant {COMPANY_DISPLAY} a non-exclusive, worldwide, royalty-free licence to stream the audio at the URL you provide and to display the title, artwork, lyrics excerpts and your artist profile inside the App.</p>

    <h2>4. URL-only publishing</h2>
    <p>You publish songs by providing a direct stream URL (your own website, CDN, label HLS, etc.). We do <strong>not</strong> accept YouTube, JioSaavn, Spotify, SoundCloud or other aggregator links — those will be rejected automatically. You are responsible for keeping the URL online; if it stops responding the song will appear unavailable.</p>

    <h2>5. No royalties, no payouts (today)</h2>
    <p>The Artist programme is currently a <strong>promotion and discovery channel only</strong>. {COMPANY_DISPLAY} does <strong>not</strong> pay royalties, advances, per-stream payouts, ad revenue, streaming bonuses, signing fees, or any other monetary compensation to artists at this stage. Plays, likes, followers and downloads on your songs generate <strong>no earnings</strong> and no right to a payment.</p>
    <p>By publishing music you accept that your participation is entirely voluntary and unpaid. You are free to withdraw your music at any time from the Artist Studio. If we ever introduce a paid monetization programme, participation will be opt-in and covered by separate, clearly disclosed terms — this Section 5 will be replaced at that point.</p>

    <h2>6. Removal & takedown</h2>
    <p>We may remove any song, take down your profile, or revoke your Verified badge if (a) we receive a credible copyright complaint, (b) the content violates the User Terms, or (c) the verification proofs you provided turn out to be false. You can delete your songs at any time from the Artist Studio.</p>

    <h2>7. Copyright complaints</h2>
    <p>To report infringement, email {SUPPORT_EMAIL} with the song URL and proof of ownership. We action valid complaints within 7 days.</p>

    <h2>8. No exclusivity</h2>
    <p>You stay free to publish your music anywhere else. We claim no exclusivity over your masters or recordings.</p>

    <h2>9. Termination</h2>
    <p>Either party may end the Artist relationship at any time. We can revoke artist status; you can request account deletion via {SUPPORT_EMAIL}.</p>

    <h2>10. Contact</h2>
    <p>Artist support: {SUPPORT_EMAIL}.</p>
  </>
);

export const ArtistPrivacyBody = (): ReactNode => (
  <>
    <h2>1. What we collect from artists</h2>
    <ul>
      <li><strong>Identity:</strong> full name, stage name, phone, country.</li>
      <li><strong>KYC documents:</strong> the government ID you choose (e.g. Voter ID, PAN, Passport, Driver's Licence) and a selfie. Used only to confirm you are the artist you claim to be.</li>
      <li><strong>Artist photo:</strong> kept as your public profile picture.</li>
      <li><strong>Public profile:</strong> stage name, bio, avatar, banner, social links — all visible on your artist page.</li>
      <li><strong>Stats:</strong> aggregated plays, likes, downloads and follower counts for your songs.</li>
    </ul>

    <h2>2. Document retention — important</h2>
    <p>Your KYC documents (ID front/back and selfie) are stored in a private, owner-and-admin-only bucket and are <strong>automatically deleted</strong> the moment your application is approved or rejected. A daily safety job also hard-deletes any KYC file older than 7 days, no matter what.</p>
    <p>We do <strong>not</strong> use your ID for advertising, sell it, share it with brokers, or store it long-term. It exists only long enough for a human reviewer to confirm your identity.</p>

    <h2>3. Legal basis</h2>
    <p>We process KYC on the basis of your explicit consent at submission, and on our legitimate interest to prevent fraud and copyright abuse. You can withdraw consent at any time by deleting your application before review.</p>

    <h2>4. Your rights (GDPR + India DPDP Act)</h2>
    <p>You may access, correct, export, or delete your artist data at any time by writing to {SUPPORT_EMAIL}. We respond within 30 days.</p>

    <h2>5. Sharing</h2>
    <p>KYC files are visible only to {COMPANY_DISPLAY} reviewers. Your public profile (stage name, bio, photo, social links) is visible to every visitor and indexed by search engines.</p>

    <h2>6. Security</h2>
    <p>Files are stored encrypted at rest, transferred over HTTPS, and gated by per-user row-level security.</p>

    <h2>7. Contact</h2>
    <p>Artist privacy questions: {SUPPORT_EMAIL}.</p>
  </>
);
