/**
 * Month assignment.
 *
 * A Gameweek belongs entirely to the month its FIRST match is played in.
 * GW9 opens on Sat 31 October and finishes on Mon 2 November — the whole
 * Gameweek, spillover included, counts towards the October prize.
 *
 * Months are computed in UK local time, not UTC, so a 20:00 BST Friday
 * kickoff on the 31st is not accidentally pushed into the next month.
 */
export function monthKeyFor(firstKickoff: Date): string {
  const parts = new Intl.DateTimeFormat('en-GB', {
    timeZone: 'Europe/London',
    year: 'numeric',
    month: '2-digit'
  }).formatToParts(firstKickoff);
  const year = parts.find((p) => p.type === 'year')!.value;
  const month = parts.find((p) => p.type === 'month')!.value;
  return `${year}-${month}`;
}

export function monthLabel(monthKey: string): string {
  const [y, m] = monthKey.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, 15)).toLocaleDateString('en-GB', {
    month: 'long',
    year: 'numeric',
    timeZone: 'UTC'
  });
}

/** Crest image for a Premier League club code (teams.code). */
export const crestUrl = (clubCode: number) =>
  `https://resources.premierleague.com/premierleague/badges/50/t${clubCode}.png`;
