import { redirect } from 'next/navigation';
import { createClient } from '@/lib/supabase/server';

export interface AdminUser { id: string; email: string; name: string }

/**
 * Gate for the admin section.
 *
 * Permission lives on profiles.is_admin, which the database checks too — every
 * admin SQL function calls assert_admin(), so hiding the UI is belt, not braces.
 *
 * ADMIN_EMAILS is a bootstrap: if your address is listed there but the flag has
 * somehow been lost, this restores it rather than locking you out of your own
 * league. Comma-separated, optional.
 */
export async function requireAdmin(): Promise<AdminUser> {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect('/login');

  const { data: profile } = await supabase
    .from('profiles').select('display_name, is_admin').eq('id', user.id).single();

  if (profile?.is_admin) {
    return { id: user.id, email: user.email ?? '', name: profile.display_name };
  }

  const allowlist = (process.env.ADMIN_EMAILS ?? '')
    .split(',').map((e) => e.trim().toLowerCase()).filter(Boolean);

  if (user.email && allowlist.includes(user.email.toLowerCase())) {
    await supabase.from('profiles').update({ is_admin: true }).eq('id', user.id);
    return { id: user.id, email: user.email, name: profile?.display_name ?? user.email };
  }

  redirect('/predictions');
}

export async function isAdmin(): Promise<boolean> {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return false;
  const { data } = await supabase.from('profiles').select('is_admin').eq('id', user.id).single();
  if (data?.is_admin) return true;
  const allowlist = (process.env.ADMIN_EMAILS ?? '')
    .split(',').map((e) => e.trim().toLowerCase()).filter(Boolean);
  return !!user.email && allowlist.includes(user.email.toLowerCase());
}
