/**
 * Standings maths for the results email.
 *
 * Everything is computed from one query — every scored gameweek total for
 * every player — so the "before" and "after" tables come from the same data
 * and can never disagree. With 24 players over 38 gameweeks that is under a
 * thousand rows, so doing it in memory is simpler and safer than four
 * separate ranked queries.
 */
export interface GwTotal {
  gameweek: number;
  user_id: string;
  points: number;
  exact_count: number;
  outcome_count: number;
}
export interface Standing {
  user_id: string;
  name: string;
  points: number;
  exact: number;
  outcome: number;
  rank: number;
}

/** Ties break on points, then exact scores, then correct outcomes. */
export function rankRows(
  rows: Omit<Standing, 'rank'>[]
): Standing[] {
  const sorted = [...rows].sort(
    (a, b) =>
      b.points - a.points ||
      b.exact - a.exact ||
      b.outcome - a.outcome ||
      a.name.localeCompare(b.name)
  );
  let lastRank = 0;
  let prev: Omit<Standing, 'rank'> | null = null;
  return sorted.map((r, i) => {
    if (prev && r.points === prev.points && r.exact === prev.exact && r.outcome === prev.outcome) {
      return { ...r, rank: lastRank };
    }
    lastRank = i + 1;
    prev = r;
    return { ...r, rank: lastRank };
  });
}

export function aggregate(
  totals: GwTotal[],
  names: Map<string, string>,
  gameweeks: number[]
): Standing[] {
  const set = new Set(gameweeks);
  const acc = new Map<string, Omit<Standing, 'rank'>>();
  for (const t of totals) {
    if (!set.has(t.gameweek)) continue;
    const cur = acc.get(t.user_id) ?? {
      user_id: t.user_id,
      name: names.get(t.user_id) ?? 'Unknown',
      points: 0,
      exact: 0,
      outcome: 0
    };
    cur.points += t.points;
    cur.exact += t.exact_count;
    cur.outcome += t.outcome_count;
    acc.set(t.user_id, cur);
  }
  return rankRows([...acc.values()]);
}

/** Positions gained since the previous gameweek. Positive means moved up. */
export function movement(before: Standing[], after: Standing[]): Map<string, number | null> {
  const prev = new Map(before.map((r) => [r.user_id, r.rank]));
  const out = new Map<string, number | null>();
  for (const r of after) {
    const was = prev.get(r.user_id);
    out.set(r.user_id, was == null ? null : was - r.rank);
  }
  return out;
}
