import Link from 'next/link';
import { createAdminClient } from '@/lib/supabase/admin';
import { verifyUserId } from '@/lib/email/tokens';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'Email preferences · TFK Predictions League' };

/**
 * One-click unsubscribe. Deliberately does not require signing in — nobody
 * logs in to stop emails, they hit "report spam" instead, and that damages
 * deliverability for the whole league. The signed token stops anyone
 * unsubscribing somebody else.
 */
export default async function UnsubscribePage(
  { searchParams }: { searchParams: Promise<{ u?: string; t?: string }> }
) {
  const { u, t } = await searchParams;
  let state: 'done' | 'bad' = 'bad';
  let name = '';

  if (u && t && verifyUserId(u, t)) {
    const db = createAdminClient();
    const { data } = await db
      .from('profiles')
      .update({ email_optin: false })
      .eq('id', u)
      .select('display_name')
      .maybeSingle();
    if (data) { state = 'done'; name = data.display_name; }
  }

  return (
    <div className="auth-wrap">
      <div className="auth-card">
        <div className="auth-brand">
          <div className="mark">TFK</div>
          <div>
            <h1>TFK Predictions League</h1>
            <div style={{ fontSize: 10, fontWeight: 800, letterSpacing: '.14em', textTransform: 'uppercase', color: 'var(--muted)' }}>
              Email preferences
            </div>
          </div>
        </div>

        {state === 'done' ? (
          <>
            <p className="tagline" style={{ marginBottom: 16 }}>
              Done{name ? `, ${name.split(' ')[0]}` : ''} — no more emails from us.
            </p>
            <div className="notice info" style={{ marginBottom: 18 }}>
              <div>
                You&apos;ll stop getting deadline reminders and the results round-up. Your predictions,
                points and league position are all untouched — you just won&apos;t be nudged.
                <br /><br />
                Changed your mind? Turn them back on any time in Settings.
              </div>
            </div>
            <Link href="/predictions" className="btn" style={{ width: '100%', justifyContent: 'center' }}>
              Back to the league
            </Link>
          </>
        ) : (
          <>
            <p className="tagline" style={{ marginBottom: 16 }}>That link didn&apos;t work.</p>
            <div className="notice warn" style={{ marginBottom: 18 }}>
              <div>
                It may have been copied incompletely, or it&apos;s from an old email. You can change
                your email preferences directly in Settings once you&apos;re signed in.
              </div>
            </div>
            <Link href="/settings" className="btn" style={{ width: '100%', justifyContent: 'center' }}>
              Go to Settings
            </Link>
          </>
        )}
      </div>
    </div>
  );
}
