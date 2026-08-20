import { requireAdmin } from '@/lib/admin';
import { createClient } from '@/lib/supabase/server';
import PlayersTable, { type Player } from './PlayersTable';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'Players · Admin' };

export default async function AdminPlayersPage() {
  const admin = await requireAdmin();
  const supabase = await createClient();
  const { data } = await supabase.rpc('admin_players');
  return <PlayersTable players={(data ?? []) as Player[]} meId={admin.id} />;
}
