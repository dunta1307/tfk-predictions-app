/**
 * The bot's scoreline model.
 *
 * Standard approach for football: model each side's goals as a Poisson
 * distribution, then pick the most likely scoreline from the joint grid.
 *
 * Two sources of signal, blended by how much of the season has been played:
 *
 *   1. FPL's own 1-5 fixture difficulty ratings. Available from day one, which
 *      matters because in August there are no results to learn from.
 *   2. Attack and defence strength derived from actual goals scored and
 *      conceded, normalised against the league average.
 *
 * Early season leans on (1); by about ten games it is almost entirely (2).
 *
 * Deliberately not clever. A model that reliably beat the market would not be
 * sitting in a mates' predictions league — the point is a consistent, explainable
 * opponent, not an oracle.
 */

export interface FixtureInput {
  fixture_id: number;
  home_team: number; away_team: number;
  home_name: string; away_name: string;
  home_difficulty: number | null; away_difficulty: number | null;
}
export interface TeamForm {
  team_id: number; played: number; scored: number; conceded: number;
  home_played: number; home_scored: number; home_conceded: number;
}
export interface Prediction {
  fixture_id: number;
  home: number; away: number;
  /** Probability of that exact scoreline. */
  confidence: number;
  /** Probability of getting at least the outcome right. */
  outcomeChance: number;
  /** Expected points under this league's rules. Drives the captain choice. */
  expectedPoints: number;
  expectedHome: number; expectedAway: number;
  homeName: string; awayName: string;
}

/** Long-run Premier League averages. Home sides score a little more. */
const LEAGUE_HOME_GOALS = 1.50;
const LEAGUE_AWAY_GOALS = 1.20;
const MAX_GOALS = 6;
/** Games before form fully replaces the difficulty prior. */
const FORM_MATURITY = 10;

function poisson(k: number, lambda: number): number {
  if (lambda <= 0) return k === 0 ? 1 : 0;
  let fact = 1;
  for (let i = 2; i <= k; i++) fact *= i;
  return (Math.exp(-lambda) * Math.pow(lambda, k)) / fact;
}

/**
 * Turn a 1-5 difficulty rating into a multiplier. 3 is neutral; a rating of 5
 * (hardest) suppresses the opponent's expected goals, 2 inflates them.
 */
function difficultyFactor(rating: number | null): number {
  if (rating == null) return 1;
  return 1 + (3 - rating) * 0.18;
}

function strengths(form: TeamForm[]) {
  const played = form.reduce((a, t) => a + t.played, 0);
  const scored = form.reduce((a, t) => a + t.scored, 0);
  const avgGoals = played > 0 ? scored / played : LEAGUE_HOME_GOALS;
  const byTeam = new Map<number, { attack: number; defence: number; played: number }>();
  for (const t of form) {
    if (t.played === 0) continue;
    byTeam.set(t.team_id, {
      attack: avgGoals > 0 ? (t.scored / t.played) / avgGoals : 1,
      defence: avgGoals > 0 ? (t.conceded / t.played) / avgGoals : 1,
      played: t.played
    });
  }
  return byTeam;
}

export function predictFixtures(fixtures: FixtureInput[], form: TeamForm[]): Prediction[] {
  const strength = strengths(form);

  return fixtures.map((f) => {
    const h = strength.get(f.home_team);
    const a = strength.get(f.away_team);
    const games = Math.min(h?.played ?? 0, a?.played ?? 0);
    const w = Math.min(1, games / FORM_MATURITY);   // 0 = all prior, 1 = all form

    // Prior from difficulty ratings. A high home_difficulty means the HOME side
    // faces a hard game, so it suppresses the home expectation.
    const priorHome = LEAGUE_HOME_GOALS * difficultyFactor(f.home_difficulty);
    const priorAway = LEAGUE_AWAY_GOALS * difficultyFactor(f.away_difficulty);

    const formHome = LEAGUE_HOME_GOALS * (h?.attack ?? 1) * (a?.defence ?? 1);
    const formAway = LEAGUE_AWAY_GOALS * (a?.attack ?? 1) * (h?.defence ?? 1);

    const expectedHome = Math.max(0.15, priorHome * (1 - w) + formHome * w);
    const expectedAway = Math.max(0.15, priorAway * (1 - w) + formAway * w);

    // Build the joint grid, then total the three outcomes.
    const grid: number[][] = [];
    let pHome = 0, pDraw = 0, pAway = 0;
    for (let i = 0; i <= MAX_GOALS; i++) {
      grid[i] = [];
      for (let j = 0; j <= MAX_GOALS; j++) {
        const p = poisson(i, expectedHome) * poisson(j, expectedAway);
        grid[i][j] = p;
        if (i > j) pHome += p; else if (i === j) pDraw += p; else pAway += p;
      }
    }

    /**
     * Pick the scoreline that maximises EXPECTED POINTS, not the one that is
     * most likely.
     *
     * Under this league's rules a scoreline pays 4 if exact and 2 if merely the
     * right outcome, so:
     *
     *   E[points] = 4·P(exact) + 2·(P(outcome) − P(exact)) = 2·P(exact) + 2·P(outcome)
     *
     * That single change is what stops the bot predicting 1-1 every week. The
     * most likely individual scoreline is very often a low-scoring draw, but a
     * draw is the least likely of the three outcomes — so backing it forfeits
     * the easier two points most of the time.
     */
    let best = { home: 1, away: 1, p: 0, outcome: 0, ep: -1 };
    for (let i = 0; i <= MAX_GOALS; i++) {
      for (let j = 0; j <= MAX_GOALS; j++) {
        const p = grid[i][j];
        const outcome = i > j ? pHome : i === j ? pDraw : pAway;
        const ep = 2 * p + 2 * outcome;
        if (ep > best.ep) best = { home: i, away: j, p, outcome, ep };
      }
    }

    return {
      fixture_id: f.fixture_id,
      home: best.home, away: best.away,
      confidence: best.p,
      outcomeChance: best.outcome,
      expectedPoints: best.ep,
      expectedHome, expectedAway,
      homeName: f.home_name, awayName: f.away_name
    };
  });
}

/**
 * Captain the fixture with the highest expected points, since the armband
 * simply doubles whatever that fixture pays. Doubling the pick with the best
 * expected return is the whole of the maths.
 */
export function chooseCaptain(predictions: Prediction[]): number | null {
  if (!predictions.length) return null;
  return predictions.reduce((a, b) => (b.expectedPoints > a.expectedPoints ? b : a)).fixture_id;
}
