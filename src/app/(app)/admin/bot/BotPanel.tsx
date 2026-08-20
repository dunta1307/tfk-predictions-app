'use client';

import { useState, useTransition } from 'react';
import { createBot, removeBot } from '../actions';

export default function BotPanel({ bot, entries, standing }: {
  bot: { id: string; display_name: string; is_active: boolean } | null;
  entries: { gameweek: number; picks: number }[];
  standing: { rank: number; points: number } | null;
}) {
  const [name, setName] = useState('The Algorithm');
  const [toast, setToast] = useState<{ msg: string; err?: boolean } | null>(null);
  const [, start] = useTransition();
  const flash = (msg: string, err?: boolean) => { setToast({ msg, err }); setTimeout(() => setToast(null), 3200); };
  const run = (fn: () => Promise<{ ok: boolean; message?: string; error?: string }>) =>
    start(async () => { const r = await fn(); flash(r.ok ? r.message ?? 'Done' : r.error ?? 'Failed', !r.ok); });

  return (
    <>
      <h1 className="page">The bot</h1>
      <p className="sub">A model that plays the league under the same deadline as everyone else.</p>

      {!bot ? (
        <div className="card">
          <div className="card-hd"><h2>Not created yet</h2></div>
          <div className="card-bd">
            <p style={{ fontSize: 14, color: '#444', marginBottom: 14 }}>
              Creates a player account that predicts every Gameweek automatically. It appears on
              every leaderboard with a marker, and is skipped when a monthly cash prize is decided.
            </p>
            <form onSubmit={(e) => { e.preventDefault(); run(() => createBot(name)); }}
                  style={{ display: 'flex', gap: 10, flexWrap: 'wrap', alignItems: 'flex-end' }}>
              <div className="field" style={{ flex: 1, minWidth: 220, marginBottom: 0 }}>
                <label htmlFor="bn">What should it be called?</label>
                <input id="bn" value={name} maxLength={30} onChange={(e) => setName(e.target.value)} />
              </div>
              <button className="btn" type="submit">Add it to the league</button>
            </form>
          </div>
        </div>
      ) : (
        <>
          <div className="card"><div className="card-bd">
            <div className="statgrid">
              <div className="stat"><div className="k">Playing as</div>
                <div className="v" style={{ fontSize: 17, lineHeight: 1.7 }}>{bot.display_name}</div></div>
              <div className="stat"><div className="k">Gameweeks entered</div><div className="v">{entries.length}</div></div>
              <div className="stat"><div className="k">League position</div>
                <div className="v">{standing ? standing.rank : '–'}</div></div>
              <div className="stat"><div className="k">Points</div><div className="v">{standing?.points ?? 0}</div></div>
            </div>
          </div></div>

          <div className="card">
            <div className="card-hd"><h2>Entries</h2></div>
            {entries.length === 0 ? (
              <div className="card-bd"><p style={{ fontSize: 14, color: 'var(--muted)', margin: 0 }}>
                Nothing submitted yet. It enters roughly six hours before each deadline.
              </p></div>
            ) : (
              <table className="lb">
                <thead><tr><th>Gameweek</th><th className="num">Predictions</th></tr></thead>
                <tbody>{entries.map((e) => (
                  <tr key={e.gameweek}>
                    <td style={{ fontWeight: 800 }}>GW{e.gameweek}</td>
                    <td className="num">{e.picks}</td>
                  </tr>))}
                </tbody>
              </table>
            )}
          </div>

          <div className="card">
            <div className="card-hd"><h2>How it picks</h2></div>
            <div className="card-bd" style={{ fontSize: 14, color: '#444', lineHeight: 1.65 }}>
              <p style={{ marginBottom: 10 }}>
                Each side&apos;s goals are modelled as a Poisson distribution, and it takes the most
                likely scoreline from the grid. Two inputs, blended by how much of the season has
                been played: the Premier League&apos;s own fixture difficulty ratings, which are
                available from day one, and attack and defence strength worked out from goals
                actually scored and conceded. August leans on the ratings; by about ten games it is
                almost entirely form.
              </p>
              <p style={{ marginBottom: 10 }}>
                It captains whichever fixture it is most confident about — which, because the most
                likely scoreline is so often a low-scoring draw, means it will captain a lot of 1-1s.
                That is a real weakness rather than a bug, and it is most of the entertainment.
              </p>
              <p style={{ margin: 0, color: 'var(--muted)', fontSize: 13 }}>
                It has no knowledge of injuries, suspensions or team news, and it submits about six
                hours before the deadline — so it never sees a result anyone else hasn&apos;t.
              </p>
            </div>
          </div>

          <div className="card"><div className="card-bd">
            <button className="btn ghost sm" style={{ color: 'var(--pl-pink)' }}
              onClick={() => { if (confirm(`Remove ${bot.display_name} and all its predictions? Leaderboards will recalculate.`)) run(removeBot); }}>
              Remove the bot
            </button>
          </div></div>
        </>
      )}

      {toast && <div className={`toast${toast.err ? ' err' : ''}`}>{toast.msg}</div>}
    </>
  );
}
