import Link from 'next/link';
import { redirect } from 'next/navigation';
import { createClient } from '@/lib/supabase/server';
import { monthLabel } from '@/lib/gameweeks';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'Leaderboard · TFK Predictions League' };

type View = 'overall' | 'monthly' | 'gw';
interface Row {
  user_id: string; display_name: string; is_bot: boolean;
  points: number; exact_count: number; outcome_count: number; rank: number;
}

export default async function LeaderboardPage(
  { searchParams }: { searchParams: Promise<{ view?: string; month?: string; gw?: string }> }
) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect('/login');

  const sp = await searchParams;
  const view: View = sp.view === 'monthly' ? 'monthly' : sp.view === 'gw' ? 'gw' : 'overall';

  const { data: published } = await supabase
    .from('gameweeks').select('id, month_key').eq('status', 'published').order('id');

  if (!published || published.length === 0) {
    return (
      <>
        <h1 className="page">Leaderboard</h1>
        <p className="sub">Standings appear once a Gameweek has been played and scored.</p>
        <div className="card"><div className="card-bd">
          <div className="notice info"><div>
            <strong>Nothing scored yet.</strong> The first table appears after Gameweek 1 finishes
            on Monday 24 August. Scoring runs automatically within minutes of the last whistle.
          </div></div>
        </div></div>
      </>
    );
  }

  const publishedGws = published.map((g) => g.id);
  const monthKeys = [...new Set(published.map((g) => g.month_key))].sort();
  const activeMonth = sp.month && monthKeys.includes(sp.month) ? sp.month : monthKeys[monthKeys.length - 1];
  const requestedGw = Number(sp.gw);
  const activeGw = publishedGws.includes(requestedGw) ? requestedGw : publishedGws[publishedGws.length - 1];

  let rows: Row[] = [];
  let caption = '';

  if (view === 'overall') {
    const { data } = await supabase
      .from('v_leaderboard_overall')
      .select('user_id, display_name, is_bot, points, exact_count, outcome_count, rank')
      .order('rank');
    rows = (data ?? []) as Row[];
    caption = `Season standings after Gameweek ${publishedGws[publishedGws.length - 1]}`;
  } else if (view === 'monthly') {
    const { data } = await supabase
      .from('v_leaderboard_monthly')
      .select('user_id, display_name, is_bot, points, exact_count, outcome_count, rank')
      .eq('month_key', activeMonth).order('rank');
    rows = (data ?? []) as Row[];
    caption = `${monthLabel(activeMonth)} — points earned this month only`;
  } else {
    const { data } = await supabase
      .from('v_leaderboard_gameweek')
      .select('user_id, display_name, is_bot, points, exact_count, outcome_count, rank')
      .eq('gameweek', activeGw).order('rank');
    rows = (data ?? []) as Row[];
    caption = `Gameweek ${activeGw} only. Maximum possible is 44.`;
  }

  const me = rows.find((r) => r.user_id === user.id);
  const leader = rows[0];

  return (
    <>
      <h1 className="page">Leaderboard</h1>
      <p className="sub">{rows.length} player{rows.length === 1 ? '' : 's'} · {caption}</p>

      <div className="subtabs">
        <Link href="/leaderboard?view=overall" className={`subtab${view === 'overall' ? ' on' : ''}`}>Overall</Link>
        <Link href="/leaderboard?view=monthly" className={`subtab${view === 'monthly' ? ' on' : ''}`}>Monthly</Link>
        <Link href="/leaderboard?view=gw" className={`subtab${view === 'gw' ? ' on' : ''}`}>By Gameweek</Link>
      </div>

      {view === 'monthly' && (
        <div className="gwsel" style={{ marginBottom: 16 }}>
          {monthKeys.map((m) => (
            <Link key={m} href={`/leaderboard?view=monthly&month=${m}`} className={m === activeMonth ? 'on' : ''}>
              {monthLabel(m).split(' ')[0]}
            </Link>
          ))}
        </div>
      )}

      {view === 'gw' && (
        <div className="gwsel" style={{ marginBottom: 16 }}>
          {publishedGws.map((g) => (
            <Link key={g} href={`/leaderboard?view=gw&gw=${g}`} className={g === activeGw ? 'on' : ''}>GW{g}</Link>
          ))}
        </div>
      )}

      {me && (
        <div className="card"><div className="card-bd">
          <div className="statgrid">
            <div className="stat"><div className="k">Your rank</div>
              <div className="v">{me.rank}<span style={{ fontSize: 14, color: 'var(--muted)' }}>/{rows.length}</span></div></div>
            <div className="stat"><div className="k">Your points</div><div className="v">{me.points}</div></div>
            <div className="stat"><div className="k">Exact scores</div><div className="v">{me.exact_count}</div></div>
            <div className="stat"><div className="k">Correct outcomes</div><div className="v">{me.outcome_count}</div></div>
            <div className="stat"><div className="k">Gap to leader</div>
              <div className="v">{leader && me.points === leader.points ? '—' : me.points - (leader?.points ?? 0)}</div></div>
          </div>
        </div></div>
      )}

      <div className="card">
        <div className="card-hd"><h2>{caption}</h2></div>
        <div style={{ overflowX: 'auto' }}>
          <table className="lb">
            <thead><tr>
              <th>#</th><th>Player</th>
              <th className="num hide-sm">Exact</th>
              <th className="num hide-sm">Outcome</th>
              <th className="num">Points</th>
            </tr></thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.user_id} className={r.user_id === user.id ? 'me' : ''}>
                  <td className={`rank${r.rank <= 3 ? ' top' + r.rank : ''}`}>{r.rank}</td>
                  <td>
                    <div className="plname">
                      <span>{r.display_name}</span>
                      {r.is_bot && <span className="pill grey">Bot</span>}
                      {r.rank === 1 && !r.is_bot && <span className="pill amber">Leader</span>}
                      {r.user_id === user.id && <span className="pill teal">You</span>}
                    </div>
                  </td>
                  <td className="num hide-sm">{r.exact_count}</td>
                  <td className="num hide-sm">{r.outcome_count}</td>
                  <td className="num total">{r.points}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <div className="card-bd" style={{ borderTop: '1px solid var(--line)', fontSize: 12.5, color: 'var(--muted)' }}>
          {rows.some((r) => r.is_bot) && (
            <><strong>The bot</strong> plays under the same deadline as everyone else but is not
            eligible for the monthly cash prize — if it tops a month, the money goes to the leading
            human. <br /></>
          )}
          Ties break on most exact scores, then most correct outcomes.
          <strong> Exact</strong> means the scoreline called spot on; <strong>Outcome</strong> means
          the right result but the wrong scoreline.
        </div>
      </div>
    </>
  );
}
