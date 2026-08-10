import { redirect } from 'next/navigation';
import { createClient } from '@/lib/supabase/server';
import PredictionBoard, { type BoardFixture, type BoardPrediction } from './PredictionBoard';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'Predictions · TFK Predictions League' };

export default async function PredictionsPage(
  { searchParams }: { searchParams: Promise<{ gw?: string }> }
) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect('/login');

  const { data: gameweeks } = await supabase
    .from('gameweeks').select('id, deadline, month_key').order('id');

  if (!gameweeks || gameweeks.length === 0) {
    return (
      <>
        <h1 className="page">No fixtures loaded yet</h1>
        <p className="sub">The season hasn&apos;t been imported.</p>
        <div className="card"><div className="card-bd">
          <div className="notice info"><div>
            Run the fixture sync once to pull all 380 fixtures from the Premier League feed:
            <br /><br />
            <code>curl -H &quot;Authorization: Bearer $CRON_SECRET&quot; https://tfkpredictions.com/api/cron/sync-fixtures</code>
            <br /><br />
            After that it runs itself every night at 04:00.
          </div></div>
        </div></div>
      </>
    );
  }

  // Default to the first gameweek that hasn't started; otherwise the last one.
  const now = new Date();
  const upcoming = gameweeks.find((g) => new Date(g.deadline) > now);
  const requested = Number((await searchParams).gw);
  const current = gameweeks.find((g) => g.id === requested) ?? upcoming ?? gameweeks[gameweeks.length - 1];

  const [{ data: fixtures }, { data: predictions }, { data: entry }] = await Promise.all([
    supabase.from('fixture_board')
      .select('id, kickoff, postponed, home_name, home_short, home_code, away_name, away_short, away_code')
      .eq('gameweek', current.id).order('kickoff'),
    supabase.from('predictions')
      .select('fixture_id, home_score, away_score, created_at')
      .eq('user_id', user.id).eq('gameweek', current.id),
    supabase.from('entries')
      .select('captain_fixture').eq('user_id', user.id).eq('gameweek', current.id).maybeSingle()
  ]);

  return (
    <PredictionBoard
      gameweek={current.id}
      allGameweeks={gameweeks.map((g) => g.id)}
      deadline={current.deadline}
      monthKey={current.month_key}
      fixtures={(fixtures ?? []) as BoardFixture[]}
      predictions={(predictions ?? []) as BoardPrediction[]}
      captainFixture={entry?.captain_fixture ?? null}
    />
  );
}
