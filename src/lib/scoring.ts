/**
 * Scoring. Phase 2 uses this; it lives here now so the rules have one home.
 *
 *   Correct outcome ............ 2
 *   Exact score ................ 4   (replaces the outcome points, does not stack)
 *   Captain .................... doubles whatever the fixture pays
 *
 * Maximum for a single fixture is therefore 8 (captained exact score).
 * Maximum for a 10-fixture gameweek is 44 (nine exact at 4, plus a captained exact at 8).
 */
export const RULES = { outcome: 2, exact: 4, captainMultiplier: 2 } as const;

export interface Score { home: number; away: number }
export interface FixtureScore {
  points: number;
  exact: boolean;
  /** Right result but wrong scoreline. Mutually exclusive with `exact`. */
  outcomeOnly: boolean;
}

const sign = (n: number) => (n > 0 ? 1 : n < 0 ? -1 : 0);

export function scoreFixture(
  prediction: Score | null,
  result: Score | null,
  isCaptain = false
): FixtureScore {
  if (!prediction || !result) return { points: 0, exact: false, outcomeOnly: false };

  const exact = prediction.home === result.home && prediction.away === result.away;
  const rightOutcome =
    sign(prediction.home - prediction.away) === sign(result.home - result.away);

  let points = exact ? RULES.exact : rightOutcome ? RULES.outcome : 0;
  if (isCaptain) points *= RULES.captainMultiplier;

  return { points, exact, outcomeOnly: rightOutcome && !exact };
}

export const MAX_FIXTURE_POINTS = RULES.exact * RULES.captainMultiplier;         // 8
export const MAX_GAMEWEEK_POINTS = RULES.exact * 9 + MAX_FIXTURE_POINTS;         // 44
