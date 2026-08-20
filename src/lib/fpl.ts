/**
 * Fantasy Premier League API client.
 *
 * Two things to know:
 *  - It sends no CORS headers, so every call must be server-side. That is fine;
 *    one call here serves all 100 players.
 *  - It is unofficial. We cache everything into our own tables on each sync, so
 *    if the feed goes down mid-season we still hold every fixture and result.
 */
const BASE = 'https://fantasy.premierleague.com/api';

export interface FplTeam { id: number; code: number; name: string; short_name: string }
export interface FplEvent { id: number; name: string; deadline_time: string; finished: boolean }
export interface FplFixture {
  id: number;
  event: number | null;
  kickoff_time: string | null;
  team_h: number;
  team_a: number;
  team_h_score: number | null;
  team_a_score: number | null;
  finished: boolean;
  finished_provisional: boolean;
  team_h_difficulty: number | null;
  team_a_difficulty: number | null;
}

async function get<T>(path: string): Promise<T> {
  const res = await fetch(`${BASE}${path}`, {
    headers: { 'User-Agent': 'tfkpredictions.com fixture sync' },
    cache: 'no-store'
  });
  if (!res.ok) throw new Error(`FPL ${path} returned ${res.status}`);
  return res.json() as Promise<T>;
}

export const getBootstrap = () =>
  get<{ teams: FplTeam[]; events: FplEvent[] }>('/bootstrap-static/');

export const getFixtures = () => get<FplFixture[]>('/fixtures/');
