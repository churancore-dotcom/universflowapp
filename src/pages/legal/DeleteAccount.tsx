import LegalLayout from './LegalLayout';
import { SUPPORT_EMAIL, USER_TERMS_UPDATED } from './legalContent';

export default function DeleteAccount() {
  return (
    <LegalLayout
      title="Delete Your UniversFlow Account"
      updated={USER_TERMS_UPDATED}
      path="/legal/delete-account"
      description="How to schedule deletion of your UniversFlow account and associated data."
    >
      <h2>Delete inside the app</h2>
      <p>Sign in, open <strong>Settings &rarr; Delete Account</strong>, type <strong>DELETE</strong>, and confirm. No support email is required.</p>
      <h2>Seven-day recovery period</h2>
      <p>Your deletion request is scheduled for seven days later. Sign back in before the displayed deadline to cancel. After processing, deletion cannot be undone.</p>
      <h2>Data removed</h2>
      <p>Eligible authentication, profile, listening, playlist, like, follow, device, artist, verification and download-record data is permanently removed. Local downloads can be removed immediately by uninstalling the app or clearing its storage.</p>
      <h2>Limited retention</h2>
      <p>Payment or transaction records may be retained where tax, fraud-prevention, dispute or other law requires it. Anonymous totals that no longer identify you may remain.</p>
      <h2>Cannot access the app?</h2>
      <p>Email {SUPPORT_EMAIL} from your registered address with the subject &ldquo;Delete my account&rdquo;.</p>
    </LegalLayout>
  );
}