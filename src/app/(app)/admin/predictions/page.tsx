import { requireAdmin } from '@/lib/admin';
import { createClient } from '@/lib/supabase/server';
import PredictionsAdmin, { type Row } from './PredictionsAdmin';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'Predictions · Admin' };

export default async function AdminPredictionsPage(
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

  const [{ data: rows }, { data: changes }] = await Promise.all([
    supabase.rpc('admin_gameweek_predictions', { p_gameweek: current.id }),
    supabase.rpc('admin_recent_changes', { p_limit: 25 })
  ]);

  return (
    <PredictionsAdmin
      gameweek={current.id}
      status={current.status}
      allGameweeks={gameweeks.map((g) => g.id)}
      rows={(rows ?? []) as Row[]}
      changes={(changes ?? []) as never[]}
    />
  );
}
