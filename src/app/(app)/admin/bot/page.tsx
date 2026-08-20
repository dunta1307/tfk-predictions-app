import { requireAdmin } from '@/lib/admin';
import { createClient } from '@/lib/supabase/server';
import BotPanel from './BotPanel';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'Bot · Admin' };

export default async function AdminBotPage() {
  await requireAdmin();
  const supabase = await createClient();

  const { data: bot } = await supabase
    .from('profiles').select('id, display_name, is_active').eq('is_bot', true).maybeSingle();

  let entries: { gameweek: number; picks: number }[] = [];
  let standing: { rank: number; points: number } | null = null;

  if (bot) {
    const [{ data: preds }, { data: lb }] = await Promise.all([
      supabase.from('predictions').select('gameweek').eq('user_id', bot.id),
      supabase.from('v_leaderboard_overall').select('rank, points').eq('user_id', bot.id).maybeSingle()
    ]);
    const counts = new Map<number, number>();
    (preds ?? []).forEach((p) => counts.set(p.gameweek, (counts.get(p.gameweek) ?? 0) + 1));
    entries = [...counts.entries()].map(([gameweek, picks]) => ({ gameweek, picks }))
      .sort((a, b) => b.gameweek - a.gameweek);
    standing = lb ?? null;
  }

  return <BotPanel bot={bot ?? null} entries={entries} standing={standing} />;
}
