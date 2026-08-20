'use server';

import { revalidatePath } from 'next/cache';
import { createClient } from '@/lib/supabase/server';
import { createAdminClient } from '@/lib/supabase/admin';
import { isAdmin } from '@/lib/admin';

export interface Result { ok: boolean; message?: string; error?: string }

const clean = (m: string) => m.replace(/^.*?(?:ERROR|error):\s*/i, '').trim();

/* ---------------------------------------------------------- results ---- */
export async function setResult(
  fixtureId: number, home: number | null, away: number | null, postponed = false
): Promise<Result> {
  const supabase = await createClient();
  const { error } = await supabase.rpc('admin_set_result', {
    p_fixture: fixtureId, p_home: home, p_away: away, p_postponed: postponed
  });
  if (error) return { ok: false, error: clean(error.message) };
  revalidatePath('/admin/results');
  return { ok: true };
}

export async function rescoreGameweek(gameweek: number): Promise<Result> {
  const supabase = await createClient();
  const { data, error } = await supabase.rpc('admin_rescore_gameweek', { p_gameweek: gameweek });
  if (error) return { ok: false, error: clean(error.message) };
  revalidatePath('/admin/results');
  revalidatePath('/leaderboard');
  return { ok: true, message: `Re-scored — ${data} entries updated` };
}

export async function setGameweekStatus(gameweek: number, status: string): Promise<Result> {
  const supabase = await createClient();
  const { error } = await supabase.rpc('admin_set_gameweek_status', {
    p_gameweek: gameweek, p_status: status
  });
  if (error) return { ok: false, error: clean(error.message) };
  revalidatePath('/admin/results');
  revalidatePath('/leaderboard');
  return { ok: true, message: `Gameweek ${gameweek} marked ${status}` };
}

/* ---------------------------------------------------------- players ---- */
export async function setUserActive(userId: string, active: boolean): Promise<Result> {
  const supabase = await createClient();
  const { error } = await supabase.rpc('admin_set_user_active', {
    p_user: userId, p_active: active
  });
  if (error) return { ok: false, error: clean(error.message) };
  revalidatePath('/admin/players');
  return { ok: true, message: active ? 'Reactivated' : 'Deactivated — history kept' };
}

/**
 * Hard delete. Removes the auth account, which cascades to their profile,
 * predictions, entries, scores and email log. Leaderboards recalculate as if
 * they never played, so this is for duplicates and test accounts — use
 * Deactivate for anyone who has actually taken part.
 */
export async function deleteUser(userId: string): Promise<Result> {
  if (!(await isAdmin())) return { ok: false, error: 'Admins only.' };

  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (user?.id === userId) return { ok: false, error: 'You cannot delete your own account here.' };

  const db = createAdminClient();
  const { error } = await db.auth.admin.deleteUser(userId);
  if (error) return { ok: false, error: error.message };
  revalidatePath('/admin/players');
  revalidatePath('/leaderboard');
  return { ok: true, message: 'Player removed' };
}

/** Sends a Supabase invite email so they can set their own password. */
export async function invitePlayer(email: string): Promise<Result> {
  if (!(await isAdmin())) return { ok: false, error: 'Admins only.' };
  const trimmed = email.trim().toLowerCase();
  if (!trimmed.includes('@')) return { ok: false, error: 'That does not look like an email address.' };

  const db = createAdminClient();
  const site = process.env.NEXT_PUBLIC_SITE_URL ?? 'https://tfkpredictions.com';
  const { error } = await db.auth.admin.inviteUserByEmail(trimmed, { redirectTo: `${site}/predictions` });
  if (error) return { ok: false, error: error.message };
  revalidatePath('/admin/players');
  return { ok: true, message: `Invite sent to ${trimmed}` };
}

/* -------------------------------------------------------------- bot ---- */

/**
 * Creates the bot's player account. It is a real auth user with a random
 * password nobody knows — it never signs in, it is written to directly by the
 * scheduled job. Opted out of email, flagged as a bot so leaderboards can mark
 * it and the cash prize can skip it.
 */
export async function createBot(displayName: string): Promise<Result> {
  if (!(await isAdmin())) return { ok: false, error: 'Admins only.' };
  const name = displayName.trim() || 'The Algorithm';

  const db = createAdminClient();

  const { data: existing } = await db.from('profiles').select('id').eq('is_bot', true).maybeSingle();
  if (existing) return { ok: false, error: 'A bot already exists.' };

  const password = crypto.randomUUID() + crypto.randomUUID();
  const { data: created, error } = await db.auth.admin.createUser({
    email: 'bot@tfkpredictions.com',
    password,
    email_confirm: true,
    user_metadata: { display_name: name, email_optin: false }
  });
  if (error) return { ok: false, error: error.message };
  if (!created.user) return { ok: false, error: 'Account not created.' };

  const { error: pErr } = await db.from('profiles').update({
    display_name: name, is_bot: true, is_active: true, email_optin: false
  }).eq('id', created.user.id);
  if (pErr) return { ok: false, error: pErr.message };

  revalidatePath('/admin');
  revalidatePath('/admin/players');
  return { ok: true, message: `${name} has joined the league` };
}

export async function removeBot(): Promise<Result> {
  if (!(await isAdmin())) return { ok: false, error: 'Admins only.' };
  const db = createAdminClient();
  const { data: bot } = await db.from('profiles').select('id').eq('is_bot', true).maybeSingle();
  if (!bot) return { ok: false, error: 'No bot to remove.' };
  const { error } = await db.auth.admin.deleteUser(bot.id);
  if (error) return { ok: false, error: error.message };
  revalidatePath('/admin');
  revalidatePath('/admin/players');
  return { ok: true, message: 'Bot removed, along with all its predictions' };
}
