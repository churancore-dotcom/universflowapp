// Pure builder for the "deletion scheduled" email so its content is testable.
const ROSE = '#FF2D55';
const FONT = "-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif";

export function formatDeletionDate(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return 'in seven days';
  return date.toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric', timeZone: 'UTC' });
}

export function deletionScheduledEmail(deleteAfter: string, to: string) {
  const when = formatDeletionDate(deleteAfter);
  const safeTo = to.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]!));
  const p = (text: string) => `<p style="margin:0 0 16px;font:400 16px/1.6 ${FONT};color:#b4b4ba">${text}</p>`;
  const html = `<!doctype html><html><head><meta name="color-scheme" content="dark"></head>
<body style="margin:0;padding:0;background:#000000;color:#ffffff">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background:#000000"><tr><td align="center" style="padding:40px 20px">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="max-width:520px">
<tr><td style="padding-bottom:40px;font:700 13px/1 ${FONT};letter-spacing:.32em;color:#ffffff">UNIVERSFLOW</td></tr>
<tr><td>
<p style="margin:0 0 10px;font:600 12px/1 ${FONT};letter-spacing:.2em;text-transform:uppercase;color:${ROSE}">Account deletion</p>
<h1 style="margin:0 0 22px;font:700 30px/1.15 ${FONT};color:#ffffff">Your account will be deleted on ${when}.</h1>
${p('We received your request to delete your Univers Flow account. Your profile, playlists, likes and listening history will be permanently removed on that date.')}
${p('Changed your mind? Sign in before then and tap <strong style="color:#ffffff">Cancel deletion</strong> in Settings to keep everything.')}
<table role="presentation" cellpadding="0" cellspacing="0" border="0" style="margin:24px 0 0"><tr><td style="background:${ROSE};border-radius:10px"><a href="https://universflow.in/settings" style="display:inline-block;padding:15px 28px;font:600 15px/1 ${FONT};color:#ffffff;text-decoration:none">Keep my account</a></td></tr></table>
</td></tr>
<tr><td style="padding-top:40px"><div style="height:1px;background:#1c1c1f;margin-bottom:20px"></div>
<p style="margin:0;font:400 12px/1.6 ${FONT};color:#6e6e73">If you didn't ask for this, sign in and cancel the deletion, then change your password.</p>
<p style="margin:12px 0 0;font:400 11px/1.7 ${FONT};color:#48484a">Sent to ${safeTo} · universflow.in</p>
</td></tr></table></td></tr></table></body></html>`;
  const text = `Your Univers Flow account will be deleted on ${when}.\n\nChanged your mind? Sign in before then and tap Cancel deletion in Settings: https://universflow.in/settings\n\nIf you didn't ask for this, cancel the deletion and change your password.`;
  return { subject: `Your account will be deleted on ${when}`, html, text };
}
