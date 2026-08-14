/**
 * When does each reminder go out?
 *
 * The job runs every ten minutes, so rather than trying to fire at an exact
 * moment we ask "is now inside this reminder's window?" and rely on the
 * email_log to guarantee one send each. If the scheduler misses a beat, or
 * the job is slow, the reminder still goes — just a little later — instead
 * of being skipped entirely.
 *
 *   24-hour reminder ... from deadline − 24h until deadline − 1h
 *   1-hour reminder .... from deadline − 1h  until the deadline
 *
 * The windows do not overlap, so nobody gets both at once.
 */
export type ReminderKind = 'reminder_24h' | 'reminder_1h';

const HOUR = 60 * 60 * 1000;

export function dueReminder(now: Date, deadline: Date): ReminderKind | null {
  const ms = deadline.getTime() - now.getTime();
  if (ms <= 0) return null;              // deadline gone, too late to chase
  if (ms <= 1 * HOUR) return 'reminder_1h';
  if (ms <= 24 * HOUR) return 'reminder_24h';
  return null;                            // more than a day out, nothing to do
}

/** Human phrasing for how long is left. Deliberately vague — it is a nudge, not a clock. */
export function timeLeftPhrase(now: Date, deadline: Date): string {
  const ms = deadline.getTime() - now.getTime();
  if (ms <= 0) return 'closed';
  const mins = Math.round(ms / 60000);
  if (mins < 60) return `${mins} minute${mins === 1 ? '' : 's'}`;
  const hours = Math.round(ms / HOUR);
  if (hours < 24) return `${hours} hour${hours === 1 ? '' : 's'}`;
  return `${Math.round(hours / 24)} days`;
}
