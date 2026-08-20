/**
 * Minimal Resend client. Only sends transactional mail, so there is no need
 * for the full SDK — one fetch call and a clear error if it fails.
 */
const ENDPOINT = 'https://api.resend.com/emails';

export interface SendResult { ok: boolean; id?: string; error?: string }

export async function sendEmail(opts: {
  to: string;
  subject: string;
  html: string;
  text: string;
  unsubscribeUrl?: string;
}): Promise<SendResult> {
  const key = process.env.RESEND_API_KEY;
  if (!key) return { ok: false, error: 'RESEND_API_KEY is not set' };

  const from = process.env.EMAIL_FROM ?? 'TFK Predictions League <noreply@tfkpredictions.com>';

  try {
    const res = await fetch(ENDPOINT, {
      method: 'POST',
      headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        from,
        to: [opts.to],
        subject: opts.subject,
        html: opts.html,
        text: opts.text,
        // Gmail and Outlook surface this as a native unsubscribe button, which
        // people use instead of hitting "report spam". Worth having.
        headers: opts.unsubscribeUrl
          ? {
              'List-Unsubscribe': `<${opts.unsubscribeUrl}>`,
              'List-Unsubscribe-Post': 'List-Unsubscribe=One-Click'
            }
          : undefined
      })
    });

    const body = await res.json().catch(() => ({}));
    if (!res.ok) return { ok: false, error: body?.message ?? `Resend returned ${res.status}` };
    return { ok: true, id: body?.id };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : 'Send failed' };
  }
}


export interface SentEmail {
  id: string;
  to: string[];
  subject: string;
  created_at: string;
  last_event?: string;   // delivered | bounced | complained | opened | ...
}

/**
 * The last N emails Resend has on record, with delivery status.
 *
 * Our email_log says what we asked to send; this says what actually happened
 * to it. Returns an empty list rather than throwing, so a Resend outage
 * degrades the admin page instead of breaking it.
 */
export async function listSentEmails(limit = 25): Promise<{ ok: boolean; emails: SentEmail[]; error?: string }> {
  const key = process.env.RESEND_API_KEY;
  if (!key) return { ok: false, emails: [], error: 'RESEND_API_KEY is not set' };
  try {
    const res = await fetch(`https://api.resend.com/emails?limit=${Math.min(limit, 100)}`, {
      headers: { Authorization: `Bearer ${key}` },
      cache: 'no-store'
    });
    if (!res.ok) return { ok: false, emails: [], error: `Resend returned ${res.status}` };
    const body = await res.json();
    const rows = Array.isArray(body?.data) ? body.data : Array.isArray(body) ? body : [];
    return { ok: true, emails: rows as SentEmail[] };
  } catch (err) {
    return { ok: false, emails: [], error: err instanceof Error ? err.message : 'Lookup failed' };
  }
}
