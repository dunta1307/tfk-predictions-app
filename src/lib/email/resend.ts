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
