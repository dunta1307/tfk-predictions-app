import Link from 'next/link';
import NavLink from '@/components/NavLink';
import { redirect } from 'next/navigation';
import { createClient } from '@/lib/supabase/server';

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect('/login');

  const { data: profile } = await supabase
    .from('profiles').select('display_name, is_admin').eq('id', user.id).single();

  const name = profile?.display_name ?? user.email ?? 'Player';
  const initials = name.split(' ').map((w: string) => w[0]).join('').slice(0, 2).toUpperCase();

  return (
    <>
      <header className="topbar">
        <div className="topbar-inner">
          <Link href="/predictions" className="brand">
            <div className="mark">TFK</div>
            <div>TFK Predictions League<small>Premier League 2026/27</small></div>
          </Link>
          <div className="spacer" />
          <div className="userchip">
            <div className="avatar">{initials}</div>
            <span className="hide-sm">{name}</span>
            <form action="/auth/signout" method="post">
              <button className="linkbtn" type="submit">Sign out</button>
            </form>
          </div>
        </div>
      </header>
      <nav className="tabs">
        <div className="tabs-inner">
          <NavLink href="/predictions">Predictions</NavLink>
          <NavLink href="/leaderboard">Leaderboard</NavLink>
          <NavLink href="/results">Results</NavLink>
          <NavLink href="/settings">Settings</NavLink>
        </div>
      </nav>
      <main>{children}</main>
    </>
  );
}
