import { createHmac, timingSafeEqual } from 'node:crypto';

/**
 * Signed unsubscribe links.
 *
 * A one-click unsubscribe has to work without signing in — nobody is going to
 * log in to stop getting emails, they will just mark it as spam, which hurts
 * deliverability for everyone. So the link carries the user id plus a short
 * HMAC signature, which stops anyone unsubscribing somebody else.
 */
function secret(): string {
  const s = process.env.CRON_SECRET;
  if (!s) throw new Error('CRON_SECRET is not set — needed to sign unsubscribe links');
  return s;
}

export function signUserId(userId: string): string {
  return createHmac('sha256', secret()).update(userId).digest('hex').slice(0, 32);
}

export function verifyUserId(userId: string, token: string): boolean {
  const expected = signUserId(userId);
  if (token.length !== expected.length) return false;
  try {
    return timingSafeEqual(Buffer.from(expected), Buffer.from(token));
  } catch {
    return false;
  }
}

export function unsubscribeUrl(userId: string, siteUrl: string): string {
  return `${siteUrl.replace(/\/$/, '')}/unsubscribe?u=${userId}&t=${signUserId(userId)}`;
}
