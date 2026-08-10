import test from 'node:test';
import assert from 'node:assert/strict';
import { fixtureLock, canSetCaptain } from '../src/lib/locks.ts';
import { scoreFixture, MAX_FIXTURE_POINTS, MAX_GAMEWEEK_POINTS } from '../src/lib/scoring.ts';

/**
 * GW1 2026/27. Deadline is the first kickoff: Arsenal v Coventry,
 * Fri 21 Aug 20:00 BST (19:00 UTC). The last match is Fulham v Chelsea
 * on the Monday night.
 */
const DEADLINE = new Date('2026-08-21T19:00:00Z');   // first kickoff
const SUNDAY   = new Date('2026-08-23T15:30:00Z');   // Newcastle v Liverpool
const MONDAY   = new Date('2026-08-24T19:00:00Z');   // Fulham v Chelsea

const before = new Date('2026-08-20T10:00:00Z');     // day before the deadline
const between = new Date('2026-08-23T09:00:00Z');    // deadline gone, Sunday game not started
const afterSunday = new Date('2026-08-23T16:00:00Z');// Sunday game under way

test('before the deadline everything is open', () => {
  assert.equal(fixtureLock({ now: before, deadline: DEADLINE, kickoff: SUNDAY, predictionCreatedAt: null }), 'open');
  assert.equal(fixtureLock({ now: before, deadline: DEADLINE, kickoff: MONDAY,
    predictionCreatedAt: new Date('2026-08-19T12:00:00Z') }), 'open',
    'a pick made before the deadline is still editable before the deadline');
});

test('a pick committed before the deadline locks when the deadline passes', () => {
  assert.equal(fixtureLock({
    now: between, deadline: DEADLINE, kickoff: MONDAY,
    predictionCreatedAt: new Date('2026-08-20T18:00:00Z')
  }), 'locked_at_deadline');
});

test('a fixture with no pick can still be entered late, until it kicks off', () => {
  assert.equal(fixtureLock({ now: between, deadline: DEADLINE, kickoff: SUNDAY, predictionCreatedAt: null }),
    'open', 'forgot entirely — Sunday game has not started, so it is still enterable');
  assert.equal(fixtureLock({ now: afterSunday, deadline: DEADLINE, kickoff: SUNDAY, predictionCreatedAt: null }),
    'kicked_off', 'same fixture once it is under way');
  assert.equal(fixtureLock({ now: afterSunday, deadline: DEADLINE, kickoff: MONDAY, predictionCreatedAt: null }),
    'open', 'Monday game is still open even though Sunday has gone');
});

test('a pick first saved during the late window can still be corrected before its kickoff', () => {
  const savedLate = new Date('2026-08-23T09:30:00Z'); // after the deadline
  assert.equal(fixtureLock({ now: between, deadline: DEADLINE, kickoff: MONDAY, predictionCreatedAt: savedLate }),
    'open');
});

test('the captain locks hard at the gameweek deadline', () => {
  assert.equal(canSetCaptain(before, DEADLINE), true);
  assert.equal(canSetCaptain(new Date(DEADLINE.getTime() - 1), DEADLINE), true);
  assert.equal(canSetCaptain(DEADLINE, DEADLINE), false, 'exactly on the deadline is too late');
  assert.equal(canSetCaptain(between, DEADLINE), false, 'no captain in the late window');
});

test('scoring: exact replaces outcome, it does not stack', () => {
  assert.equal(scoreFixture({ home: 2, away: 1 }, { home: 2, away: 1 }).points, 4);
  assert.equal(scoreFixture({ home: 2, away: 1 }, { home: 3, away: 0 }).points, 2);
  assert.equal(scoreFixture({ home: 2, away: 1 }, { home: 1, away: 1 }).points, 0);
  assert.equal(scoreFixture({ home: 1, away: 1 }, { home: 2, away: 2 }).points, 2);
  assert.equal(scoreFixture({ home: 1, away: 1 }, { home: 1, away: 1 }).points, 4);
});

test('scoring: captain doubles, and the ceiling is 8 per fixture', () => {
  assert.equal(scoreFixture({ home: 2, away: 1 }, { home: 2, away: 1 }, true).points, 8);
  assert.equal(scoreFixture({ home: 2, away: 1 }, { home: 3, away: 0 }, true).points, 4);
  assert.equal(scoreFixture({ home: 2, away: 1 }, { home: 0, away: 3 }, true).points, 0);
  assert.equal(MAX_FIXTURE_POINTS, 8);
  assert.equal(MAX_GAMEWEEK_POINTS, 44);
});

test('scoring: missing prediction or missing result scores nothing', () => {
  assert.equal(scoreFixture(null, { home: 1, away: 0 }, true).points, 0);
  assert.equal(scoreFixture({ home: 1, away: 0 }, null, true).points, 0);
});
