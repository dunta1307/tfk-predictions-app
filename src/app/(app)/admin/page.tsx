import Link from 'next/link';
import { requireAdmin } from '@/lib/admin';
import { createClient } from '@/lib/supabase/server';
import { fmtKickoff } from '@/lib/format';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'Admin · TFK Predictions League' };

export default async function AdminStatusPage() {
  await requireAdmin();
  const supabase = await createClient();

  const [{ data: jobs }, { data: gameweeks }, { data: players }, { data: fixtures }] =
    await Promise.all([
      supabase.rpc('admin_job_status'),
      supabase.from('gameweeks').select('id, deadline, status, month_key').order('id'),
      supabase.rpc('admin_players'),
      supabase.from('fixtures').select('id, finished, updated_at').order('updated_at', { ascending: false }).limit(1)
    ]);

  const now = new Date();
  const next = (gameweeks ?? []).find((g) => new Date(g.deadline) > now);
  const published = (gameweeks ?? []).filter((g) => g.status === 'published').length;
  const active = (players ?? []).filter((p: { is_active: boolean; is_admin: boolean }) => p.is_active && !p.is_admin).length;
  const lastSync = fixtures?.[0]?.updated_at;

  const stale = (iso: string | null | undefined, mins: number) =>
    !iso || (now.getTime() - new Date(iso).getTime()) / 60000 > mins;

  return (
    <>
      <h1 className="page">Status</h1>
      <p className="sub">Everything that runs on its own, and whether it did.</p>

      <div className="card"><div className="card-bd">
        <div className="statgrid">
          <div className="stat"><div className="k">Active players</div><div className="v">{active}</div></div>
          <div className="stat"><div className="k">Gameweeks scored</div><div className="v">{published}<span style={{fontSize:14,color:'var(--muted)'}}>/38</span></div></div>
          <div className="stat"><div className="k">Next deadline</div>
            <div className="v" style={{fontSize:15,lineHeight:1.7}}>{next ? `GW${next.id}` : 'Season over'}<br/>
              <span style={{fontSize:12.5,color:'var(--muted)',fontWeight:700}}>{next ? fmtKickoff(next.deadline) : ''}</span></div></div>
          <div className="stat"><div className="k">Fixtures last updated</div>
            <div className="v" style={{fontSize:15,lineHeight:1.7}}>{lastSync ? fmtKickoff(lastSync) : 'Never'}</div></div>
        </div>
      </div></div>

      <div className="card">
        <div className="card-hd"><h2>Scheduled jobs</h2>
          <span className="pill grey">{(jobs ?? []).length} running</span></div>
        <div style={{ overflowX: 'auto' }}>
          <table className="lb">
            <thead><tr><th>Job</th><th>Schedule</th><th>Last run</th><th>Result</th></tr></thead>
            <tbody>
              {(jobs ?? []).map((j: { jobname: string; schedule: string; active: boolean; last_run: string | null; last_status: string | null }) => {
                const bad = !j.active || j.last_status === 'failed';
                const late = j.jobname.includes('sync') || j.jobname.includes('send')
                  ? stale(j.last_run, j.schedule.startsWith('*/10') || j.schedule.startsWith('5-59/10') ? 25 : 1500)
                  : false;
                return (
                  <tr key={j.jobname}>
                    <td style={{ fontWeight: 700 }}>{j.jobname}</td>
                    <td style={{ fontFamily: 'ui-monospace,Menlo,monospace', fontSize: 12.5 }}>{j.schedule}</td>
                    <td>{j.last_run ? fmtKickoff(j.last_run) : <span style={{ color: 'var(--muted)' }}>never</span>}</td>
                    <td>
                      {bad ? <span className="pill pink">{j.active ? 'Failed' : 'Paused'}</span>
                        : late ? <span className="pill amber">Overdue</span>
                        : j.last_status ? <span className="pill teal">{j.last_status}</span>
                        : <span className="pill grey">pending</span>}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
        <div className="card-bd" style={{ borderTop: '1px solid var(--line)', fontSize: 12.5, color: 'var(--muted)' }}>
          &quot;Overdue&quot; means the job hasn&apos;t run inside its expected window. One late run is usually
          nothing; two in a row is worth looking at. <strong>pending</strong> just means it hasn&apos;t
          had its first run yet.
        </div>
      </div>

      <div className="card">
        <div className="card-hd"><h2>Gameweeks</h2><div className="spacer" />
          <Link href="/admin/results" className="btn ghost sm">Enter results</Link></div>
        <div style={{ overflowX: 'auto' }}>
          <table className="lb">
            <thead><tr><th>GW</th><th>Deadline</th><th>Month</th><th>Status</th></tr></thead>
            <tbody>
              {(gameweeks ?? []).filter((g) => g.status !== 'upcoming' || g.id <= (next?.id ?? 1) + 2)
                .slice(0, 12).map((g) => (
                <tr key={g.id}>
                  <td style={{ fontWeight: 800 }}>GW{g.id}</td>
                  <td>{fmtKickoff(g.deadline)}</td>
                  <td style={{ color: 'var(--muted)' }}>{g.month_key}</td>
                  <td>{g.status === 'published'
                    ? <span className="pill teal">published</span>
                    : <span className="pill grey">{g.status}</span>}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </>
  );
}
