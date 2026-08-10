/**
 * The deadline rules, in one place.
 *
 * These are mirrored exactly by save_prediction() and set_captain() in
 * supabase/schema.sql. The database is the source of truth — this module
 * exists so the UI can grey out the right things without a round trip.
 * Never rely on this alone: a tampered browser bypasses it, the database
 * functions are what actually stop a late save.
 */

export type LockReason =
  | 'open'              // editable
  | 'locked_at_deadline' // you had already committed this pick before the deadline
  | 'kicked_off';        // the match has started

export interface LockInput {
  now: Date;
  /** First kickoff of the gameweek. This is the deadline. */
  deadline: Date;
  /** Kickoff of this specific fixture. */
  kickoff: Date;
  /** When this user first saved a pick for this fixture, if they ever did. */
  predictionCreatedAt: Date | null;
}

export function fixtureLock(i: LockInput): LockReason {
  if (i.now < i.deadline) return 'open';
  // Deadline has passed — we are in the late-entry window.
  if (i.predictionCreatedAt !== null && i.predictionCreatedAt < i.deadline) {
    return 'locked_at_deadline';
  }
  if (i.now >= i.kickoff) return 'kicked_off';
  return 'open';
}

export const canEditFixture = (i: LockInput) => fixtureLock(i) === 'open';

/** The captain locks hard at the gameweek deadline. No late captains. */
export function canSetCaptain(now: Date, deadline: Date): boolean {
  return now < deadline;
}

export function lockMessage(reason: LockReason): string | null {
  switch (reason) {
    case 'open': return null;
    case 'locked_at_deadline': return 'Locked at the deadline';
    case 'kicked_off': return 'Kicked off';
  }
}
