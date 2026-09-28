'use client';

import { useMemo, useState, useTransition } from 'react';
import Link from 'next/link';
import { adminSetPrediction, adminOverrideCaptain } from '../actions';
import { fmtTime } from '@/lib/format';

export interface Row {
  user_id: string; display_name: string; is_bot: boolean; is_active: boolean;
  fixture_id: number; kickoff: string;
  home_name: string; away_name: string; home_short: string; away_short: string;
  home_score: number | null; away_score: number | null;
  is_captain: boolean; started: boolean;
}
interface Change {
  at: string; admin_name: string; target_name: string | null; action: string;
  gameweek: number | null; fixture: string | null; note: string | null;
  before: Record<string, unknown> | null; after: Record<string, unknown> | null;
}

const SCORES = [0,1,2,3,4,5,6,7,8,9,10];

export default function PredictionsAdmin(props: {
  gameweek: number; status: string; allGameweeks: number[]; rows: Row[]; changes: Change[];
}) {
  const { gameweek, status, allGameweeks, rows, changes } = props;
  const [editing, setEditing] = useState<string | null>(null);
  const [note, setNote] = useState('');
  const [toast, setToast] = useState<{ msg: string; err?: boolean } | null>(null);
  const [, start] = useTransition();

  const flash = (msg: string, err?: boolean) => { setToast({ msg, err }); setTimeout(() => setToast(null), 3000); };
  const run = (fn: () => Promise<{ ok: boolean; message?: string; error?: string }>) =>
    start(async () => { const r = await fn(); flash(r.ok ? r.message ?? 'Done' : r.error ?? 'Failed', !r.ok); });

  // Group the flat rows into one card per player.
  const { fixtures, players } = useMemo(() => {
    const fx = new Map<number, Row>();
    const pl = new Map<string, { id: string; name: string; isBot: boolean; active: boolean; picks: Map<number, Row> }>();
    for (const r of rows) {
      if (!fx.has(r.fixture_id)) fx.set(r.fixture_id, r);
      const p = pl.get(r.user_id) ?? {
        id: r.user_id, name: r.display_name, isBot: r.is_bot, active: r.is_active, picks: new Map()
      };
      p.picks.set(r.fixture_id, r);
      pl.set(r.user_id, p);
    }
    return {
      fixtures: [...fx.values()].sort((a, b) => a.kickoff.localeCompare(b.kickoff)),
      players: [...pl.values()]
    };
  }, [rows]);

  const csv = () => {
    const head = ['Player', 'Captain', ...fixtures.map((f) => `${f.home_short} v ${f.away_short}`)];
    const lines = [head.join(',')];
    for (const p of players) {
      const cap = fixtures.find((f) => p.picks.get(f.fixture_id)?.is_captain);
      lines.push([
        `"${p.name}"`,
        cap ? `"${cap.home_short} v ${cap.away_short}"` : '""',
        ...fixtures.map((f) => {
          const r = p.picks.get(f.fixture_id);
          return r?.home_score != null ? `${r.home_score}-${r.away_score}` : '';
        })
      ].join(','));
    }
    const blob = new Blob([lines.join('\n')], { type: 'text/csv;charset=utf-8' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `tfk-gw${gameweek}-all-predictions.csv`;
    a.click();
    URL.revokeObjectURL(a.href);
  };

  const complete = players.filter((p) =>
    fixtures.every((f) => p.picks.get(f.fixture_id)?.home_score != null)).length;

  return (
    <>
      <h1 className="page">All predictions · Gameweek {gameweek}</h1>
      <p className="sub">
        {players.length} players · {complete} complete · status <strong>{status}</strong>.
        Admin edits ignore every deadline and kickoff lock.
      </p>

      <div className="gwsel" style={{ marginBottom: 16 }}>
        {allGameweeks.map((g) => (
          <Link key={g} href={`/admin/predictions?gw=${g}`} className={g === gameweek ? 'on' : ''}>GW{g}</Link>
        ))}
      </div>

      {status === 'published' && (
        <div className="notice info" style={{ marginBottom: 16 }}>
          <div><strong>This Gameweek is already scored.</strong> Any change you make here rebuilds
          the points for it immediately — no need to press Re-score.</div>
        </div>
      )}

      <div className="card">
        <div className="card-hd"><h2>Everyone&apos;s card</h2>
          <div className="spacer" />
          <button className="btn ghost sm" onClick={csv}>Download CSV</button>
        </div>
        <div style={{ overflowX: 'auto' }}>
          <table className="lb" style={{ minWidth: 760 }}>
            <thead><tr>
              <th style={{ position: 'sticky', left: 0, background: '#fff' }}>Player</th>
              {fixtures.map((f) => (
                <th key={f.fixture_id} className="num" title={`${f.home_name} v ${f.away_name}`}>
                  {f.home_short}<br />{f.away_short}
                  <div style={{ fontWeight: 400, color: 'var(--muted)' }}>{fmtTime(f.kickoff)}</div>
                </th>
              ))}
              <th></th>
            </tr></thead>
            <tbody>
              {players.map((p) => (
                <tr key={p.id} style={!p.active ? { opacity: .5 } : undefined}>
                  <td style={{ position: 'sticky', left: 0, background: '#fff', fontWeight: 700, whiteSpace: 'nowrap' }}>
                    {p.name}{p.isBot && <span className="pill grey" style={{ marginLeft: 6 }}>Bot</span>}
                  </td>
                  {fixtures.map((f) => {
                    const r = p.picks.get(f.fixture_id);
                    const has = r?.home_score != null;
                    return (
                      <td key={f.fixture_id} className="num"
                          style={{ fontVariantNumeric: 'tabular-nums',
                                   color: has ? undefined : 'var(--line)',
                                   fontWeight: r?.is_captain ? 800 : undefined,
                                   background: r?.is_captain ? 'rgba(233,0,82,.08)' : undefined }}>
                        {has ? `${r!.home_score}-${r!.away_score}` : '–'}
                        {r?.is_captain && <span style={{ color: 'var(--pl-pink)' }}> ★</span>}
                      </td>
                    );
                  })}
                  <td>
                    <button className="btn ghost sm"
                      onClick={() => setEditing(editing === p.id ? null : p.id)}>
                      {editing === p.id ? 'Close' : 'Edit'}
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <div className="card-bd" style={{ borderTop: '1px solid var(--line)', fontSize: 12.5, color: 'var(--muted)' }}>
          Pink cells are captains. A dash means no prediction was submitted.
        </div>
      </div>

      {editing && (() => {
        const p = players.find((x) => x.id === editing)!;
        return (
          <div className="card">
            <div className="card-hd"><h2>Editing {p.name}</h2>
              <span className="pill amber">Locks bypassed</span>
              <div className="spacer" />
              <button className="btn ghost sm" onClick={() => setEditing(null)}>Done</button>
            </div>

            <div className="card-bd" style={{ borderBottom: '1px solid var(--line)' }}>
              <div className="field" style={{ marginBottom: 0 }}>
                <label htmlFor="note">Why (optional, kept in the log)</label>
                <input id="note" value={note} placeholder="e.g. asked on WhatsApp, missed the deadline"
                       onChange={(e) => setNote(e.target.value)} />
              </div>
            </div>

            {fixtures.map((f) => {
              const r = p.picks.get(f.fixture_id);
              const sel = (side: 'home' | 'away') => {
                const val = side === 'home' ? r?.home_score : r?.away_score;
                return (
                  <select className={`scoresel${val != null ? ' filled' : ''}`} defaultValue={val ?? ''}
                    onChange={(e) => {
                      const v = e.target.value === '' ? null : Number(e.target.value);
                      const home = side === 'home' ? v : r?.home_score ?? null;
                      const away = side === 'away' ? v : r?.away_score ?? null;
                      run(() => adminSetPrediction(p.id, f.fixture_id, home, away, note || undefined));
                    }}>
                    <option value="">–</option>
                    {SCORES.map((n) => <option key={n} value={n}>{n}</option>)}
                  </select>
                );
              };
              return (
                <div key={f.fixture_id} className={`fx${r?.is_captain ? ' captained' : ''}`}>
                  <div className="team"><span className="nm">{f.home_name}</span></div>
                  <div className="scorebox">{sel('home')}<span className="vs">v</span>{sel('away')}</div>
                  <div className="team away"><span className="nm">{f.away_name}</span></div>
                  <div className="capwrap">
                    <button className={`capbtn${r?.is_captain ? ' on' : ''}`}
                      onClick={() => run(() => adminOverrideCaptain(
                        p.id, gameweek, r?.is_captain ? null : f.fixture_id, note || undefined))}>
                      {r?.is_captain ? '★ CAPTAIN' : '☆ Set captain'}
                    </button>
                    <div className="ko">{fmtTime(f.kickoff)}{f.started ? ' · started' : ''}</div>
                  </div>
                </div>
              );
            })}

            <div className="card-bd" style={{ borderTop: '1px solid var(--line)', fontSize: 12.5, color: 'var(--muted)' }}>
              Changes save as you make them. Setting a captain replaces any existing one for this
              Gameweek — clicking the current captain clears it.
            </div>
          </div>
        );
      })()}

      <div className="card">
        <div className="card-hd"><h2>Recent admin changes</h2>
          <span className="pill grey">last {changes.length}</span></div>
        {changes.length === 0 ? (
          <div className="card-bd"><p style={{ fontSize: 14, color: 'var(--muted)', margin: 0 }}>
            Nothing changed yet.</p></div>
        ) : (
          <div style={{ overflowX: 'auto' }}>
            <table className="lb">
              <thead><tr><th>When</th><th>Player</th><th>Change</th><th className="hide-sm">Note</th></tr></thead>
              <tbody>
                {changes.map((c, i) => (
                  <tr key={i}>
                    <td style={{ color: 'var(--muted)', fontSize: 13, whiteSpace: 'nowrap' }}>
                      {new Date(c.at).toLocaleString('en-GB', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })}
                    </td>
                    <td style={{ fontWeight: 700 }}>{c.target_name ?? '—'}</td>
                    <td style={{ fontSize: 13 }}>
                      {c.action === 'override_captain' ? 'Captain' : 'Prediction'}
                      {c.gameweek ? ` · GW${c.gameweek}` : ''}
                      {c.fixture ? ` · ${c.fixture}` : ''}
                    </td>
                    <td className="hide-sm" style={{ color: 'var(--muted)', fontSize: 13 }}>{c.note ?? ''}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {toast && <div className={`toast${toast.err ? ' err' : ''}`}>{toast.msg}</div>}
    </>
  );
}
