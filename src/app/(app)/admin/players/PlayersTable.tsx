'use client';

import { useState, useTransition } from 'react';
import { setUserActive, deleteUser, invitePlayer } from '../actions';

export interface Player {
  user_id: string; email: string; display_name: string;
  is_admin: boolean; is_active: boolean; email_optin: boolean;
  joined: string; gameweeks_entered: number; predictions_made: number; season_points: number;
}

export default function PlayersTable({ players, meId }: { players: Player[]; meId: string }) {
  const [toast, setToast] = useState<{ msg: string; err?: boolean } | null>(null);
  const [invite, setInvite] = useState('');
  const [, start] = useTransition();

  const flash = (msg: string, err?: boolean) => {
    setToast({ msg, err }); setTimeout(() => setToast(null), 3000);
  };
  const run = (fn: () => Promise<{ ok: boolean; message?: string; error?: string }>) =>
    start(async () => {
      const r = await fn();
      flash(r.ok ? r.message ?? 'Done' : r.error ?? 'Failed', !r.ok);
    });

  const active = players.filter((p) => p.is_active && !p.is_admin).length;
  const inactive = players.filter((p) => !p.is_active).length;

  return (
    <>
      <h1 className="page">Players</h1>
      <p className="sub">{active} active · {inactive} deactivated · {players.length} accounts in total</p>

      <div className="card">
        <div className="card-hd"><h2>Invite someone</h2></div>
        <div className="card-bd">
          <form
            onSubmit={(e) => { e.preventDefault(); run(() => invitePlayer(invite)); setInvite(''); }}
            style={{ display: 'flex', gap: 10, flexWrap: 'wrap', alignItems: 'flex-end' }}
          >
            <div className="field" style={{ flex: 1, minWidth: 240, marginBottom: 0 }}>
              <label htmlFor="inv">Email address</label>
              <input id="inv" type="email" value={invite} placeholder="them@email.com"
                     onChange={(e) => setInvite(e.target.value)} />
            </div>
            <button className="btn" type="submit" disabled={!invite.includes('@')}>Send invite</button>
          </form>
          <p style={{ fontSize: 12.5, color: 'var(--muted)', marginTop: 10 }}>
            They get an email to set their own password. Anyone can also just register
            at tfkpredictions.com — this is for chasing someone who hasn&apos;t got round to it.
          </p>
        </div>
      </div>

      <div className="card">
        <div className="card-hd"><h2>All accounts</h2></div>
        <div style={{ overflowX: 'auto' }}>
          <table className="lb">
            <thead><tr>
              <th>Player</th><th className="hide-sm">Email</th>
              <th className="num hide-sm">GWs</th><th className="num hide-sm">Picks</th>
              <th className="num">Points</th><th>Actions</th>
            </tr></thead>
            <tbody>
              {players.map((p) => (
                <tr key={p.user_id} className={p.user_id === meId ? 'me' : ''}
                    style={!p.is_active ? { opacity: .55 } : undefined}>
                  <td>
                    <div className="plname">
                      <span style={{ fontWeight: 700 }}>{p.display_name}</span>
                      {p.is_admin && <span className="pill teal">Admin</span>}
                      {!p.is_active && <span className="pill grey">Deactivated</span>}
                      {!p.email_optin && p.is_active && <span className="pill grey">No emails</span>}
                    </div>
                  </td>
                  <td className="hide-sm" style={{ color: 'var(--muted)', fontSize: 13 }}>{p.email}</td>
                  <td className="num hide-sm">{p.gameweeks_entered}</td>
                  <td className="num hide-sm">{p.predictions_made}</td>
                  <td className="num total">{p.season_points}</td>
                  <td>
                    {p.user_id === meId ? (
                      <span style={{ fontSize: 12.5, color: 'var(--muted)' }}>That&apos;s you</span>
                    ) : (
                      <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                        <button className="btn ghost sm"
                          onClick={() => run(() => setUserActive(p.user_id, !p.is_active))}>
                          {p.is_active ? 'Deactivate' : 'Reactivate'}
                        </button>
                        <button className="btn ghost sm" style={{ color: 'var(--pl-pink)' }}
                          onClick={() => {
                            if (confirm(
                              `Permanently delete ${p.display_name}?\n\n` +
                              `Their ${p.predictions_made} predictions and ${p.season_points} points go too, ` +
                              `and every leaderboard recalculates as if they never played.\n\n` +
                              `If they have actually taken part, use Deactivate instead.`
                            )) run(() => deleteUser(p.user_id));
                          }}>
                          Remove
                        </button>
                      </div>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <div className="card-bd" style={{ borderTop: '1px solid var(--line)', fontSize: 12.5, color: 'var(--muted)' }}>
          <strong>Deactivate</strong> blocks sign-in and stops emails, but keeps their points and
          history on every leaderboard — use this for someone who drops out mid-season.
          <strong> Remove</strong> deletes everything and cannot be undone — use it for duplicate
          or test accounts only. Deleting someone who has played would quietly rewrite months
          they might have won.
        </div>
      </div>

      {toast && <div className={`toast${toast.err ? ' err' : ''}`}>{toast.msg}</div>}
    </>
  );
}
