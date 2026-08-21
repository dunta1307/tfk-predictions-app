import { requireAdmin } from '@/lib/admin';
import { createClient } from '@/lib/supabase/server';
import { listSentEmails } from '@/lib/email/resend';
import { fmtKickoff } from '@/lib/format';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'Emails · Admin' };

const LABEL: Record<string, string> = {
  reminder_24h: '24-hour reminder',
  reminder_1h: '1-hour reminder',
  results: 'Results round-up',
  reveal: 'Pre-match reveal'
};

function statusPill(event?: string) {
  if (!event) return <span className="pill grey">unknown</span>;
  const e = event.toLowerCase();
  if (e.includes('deliver')) return <span className="pill teal">delivered</span>;
  if (e.includes('bounce')) return <span className="pill pink">bounced</span>;
  if (e.includes('complain')) return <span className="pill pink">spam report</span>;
  if (e.includes('open')) return <span className="pill teal">opened</span>;
  if (e.includes('click')) return <span className="pill teal">clicked</span>;
  if (e.includes('sent') || e.includes('queue')) return <span className="pill amber">{e}</span>;
  return <span className="pill grey">{e}</span>;
}

export default async function AdminEmailsPage() {
  await requireAdmin();
  const supabase = await createClient();

  const [{ data: summary }, { data: recent }, resend] = await Promise.all([
    supabase.rpc('admin_email_summary'),
    supabase.rpc('admin_recent_emails', { p_limit: 25 }),
    listSentEmails(25)
  ]);

  const rows = (summary ?? []) as { kind: string; gameweek: number; sent: number; last_sent: string }[];
  const log = (recent ?? []) as { provider_id: string | null; kind: string; gameweek: number; display_name: string; sent_at: string }[];
  const byId = new Map(resend.emails.map((e) => [e.id, e]));

  const totals = rows.reduce<Record<string, number>>((acc, r) => {
    acc[r.kind] = (acc[r.kind] ?? 0) + r.sent; return acc;
  }, {});
  const grand = Object.values(totals).reduce((a, b) => a + b, 0);
  const bounced = log.filter((l) => {
    const ev = l.provider_id ? byId.get(l.provider_id)?.last_event?.toLowerCase() : undefined;
    return ev?.includes('bounce') || ev?.includes('complain');
  }).length;

  return (
    <>
      <h1 className="page">Emails</h1>
      <p className="sub">What the league has been sent, and what happened to it.</p>

      <div className="card"><div className="card-bd">
        <div className="statgrid">
          <div className="stat"><div className="k">Sent all season</div><div className="v">{grand}</div></div>
          <div className="stat"><div className="k">24-hour reminders</div><div className="v">{totals.reminder_24h ?? 0}</div></div>
          <div className="stat"><div className="k">1-hour reminders</div><div className="v">{totals.reminder_1h ?? 0}</div></div>
          <div className="stat"><div className="k">Results round-ups</div><div className="v">{totals.results ?? 0}</div></div>
          <div className="stat"><div className="k">Bounced / spam</div>
            <div className="v" style={{ color: bounced ? 'var(--pl-pink)' : undefined }}>{bounced}</div></div>
        </div>
        <p style={{ fontSize: 12.5, color: 'var(--muted)', marginTop: 12, marginBottom: 0 }}>
          Free tier allows 100 a day and 3,000 a month. At {24} players your busiest day is a
          results round-up, so there is plenty of headroom.
        </p>
      </div></div>

      {!resend.ok && (
        <div className="notice warn" style={{ marginBottom: 18 }}>
          <div><strong>Couldn&apos;t reach Resend.</strong> {resend.error} — the counts below still come
          from our own send log, but delivery status is unavailable.</div>
        </div>
      )}

      <div className="card">
        <div className="card-hd"><h2>By Gameweek</h2></div>
        {rows.length === 0 ? (
          <div className="card-bd"><p style={{ fontSize: 14, color: 'var(--muted)', margin: 0 }}>
            Nothing sent yet. The first reminders go out 24 hours before the GW1 deadline.
          </p></div>
        ) : (
          <div style={{ overflowX: 'auto' }}>
            <table className="lb">
              <thead><tr><th>GW</th><th>Type</th><th className="num">Sent</th><th>Last</th></tr></thead>
              <tbody>
                {rows.map((r) => (
                  <tr key={`${r.gameweek}-${r.kind}`}>
                    <td style={{ fontWeight: 800 }}>GW{r.gameweek}</td>
                    <td>{LABEL[r.kind] ?? r.kind}</td>
                    <td className="num total">{r.sent}</td>
                    <td style={{ color: 'var(--muted)' }}>{fmtKickoff(r.last_sent)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      <div className="card">
        <div className="card-hd"><h2>Recent sends</h2>
          <span className="pill grey">last {log.length}</span></div>
        {log.length === 0 ? (
          <div className="card-bd"><p style={{ fontSize: 14, color: 'var(--muted)', margin: 0 }}>
            No sends logged yet.</p></div>
        ) : (
          <div style={{ overflowX: 'auto' }}>
            <table className="lb">
              <thead><tr><th>Player</th><th className="hide-sm">Type</th><th className="hide-sm">GW</th><th>Status</th><th>When</th></tr></thead>
              <tbody>
                {log.map((l, i) => (
                  <tr key={`${l.provider_id ?? i}`}>
                    <td style={{ fontWeight: 700 }}>{l.display_name}</td>
                    <td className="hide-sm">{LABEL[l.kind] ?? l.kind}</td>
                    <td className="hide-sm">GW{l.gameweek}</td>
                    <td>{statusPill(l.provider_id ? byId.get(l.provider_id)?.last_event : undefined)}</td>
                    <td style={{ color: 'var(--muted)', fontSize: 13 }}>{fmtKickoff(l.sent_at)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        <div className="card-bd" style={{ borderTop: '1px solid var(--line)', fontSize: 12.5, color: 'var(--muted)' }}>
          Status comes from Resend and only covers their most recent 25 sends, so older rows may
          show as unknown. <strong>Bounced</strong> usually means a mistyped address — worth
          correcting in Players. <strong>Spam report</strong> is worth a quiet word, because a few
          of those damage delivery for the whole league.
        </div>
      </div>
    </>
  );
}
