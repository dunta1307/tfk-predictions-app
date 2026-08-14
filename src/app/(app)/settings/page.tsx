import { redirect } from 'next/navigation';
import { createClient } from '@/lib/supabase/server';
import SettingsForm from './SettingsForm';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'Settings · TFK Predictions League' };

export default async function SettingsPage() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect('/login');

  const { data: profile } = await supabase
    .from('profiles').select('display_name, email_optin').eq('id', user.id).single();

  return (
    <>
      <h1 className="page">Settings</h1>
      <p className="sub">{user.email}</p>
      <SettingsForm
        name={profile?.display_name ?? ''}
        optin={profile?.email_optin ?? true}
      />
    </>
  );
}
