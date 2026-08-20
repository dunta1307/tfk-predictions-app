import { requireAdmin } from '@/lib/admin';
import { createClient } from '@/lib/supabase/server';
import ResultsEditor, { type EditorFixture } from './ResultsEditor';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'Results · Admin' };

export default async function AdminResultsPage(
  { searchParams }: { searchParams: Promise<{ gw?: string }> }
) {
  await requireAdmin();
  const supabase = await createClient();

  const { data: gameweeks } = await supabase
    .from('gameweeks').select('id, deadline, status').order('id');
  if (!gameweeks?.length) return <p className="sub">No fixtures loaded.</p>;

  const now = new Date();
  const started = gameweeks.filter((g) => new Date(g.deadline) <= now);
  const requested = Number((await searchParams).gw);
  const current =
    gameweeks.find((g) => g.id === requested) ?? started[started.length - 1] ?? gameweeks[0];

  const [{ data: fixtures }, { data: outstanding }] = await Promise.all([
    supabase.from('fixture_board')
      .select('id, kickoff, finished, postponed, home_score, away_score, home_name, away_name')
      .eq('gameweek', current.id).order('kickoff'),
    supabase.rpc('admin_outstanding', { p_gameweek: current.id })
  ]);

  return (
    <ResultsEditor
      gameweek={current.id}
      status={current.status}
      allGameweeks={gameweeks.map((g) => g.id)}
      fixtures={(fixtures ?? []) as EditorFixture[]}
      outstanding={(outstanding ?? []) as { display_name: string; picks_made: number; captain_set: boolean }[]}
      fixtureCount={(fixtures ?? []).filter((f) => !f.postponed).length}
    />
  );
}
