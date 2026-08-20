'use client';

import { useState, useTransition } from 'react';
import Link from 'next/link';
import { setResult, rescoreGameweek, setGameweekStatus } from '../actions';
import { fmtKickoff } from '@/lib/format';

export interface EditorFixture {
  id: number; kickoff: string; finished: boolean; postponed: boolean;
  home_score: number | null; away_score: number | null;
  home_name: string; away_name: string;
}
interface Outstanding { display_name: string; picks_made: number; captain_set: boolean }

const SCORES = [0,1,2,3,4,5,6,7,8,9,10];

export default function ResultsEditor(props: {
  gameweek: number; status: string; allGameweeks: number[];
  fixtures: EditorFixture[]; outstanding: Outstanding[]; fixtureCount: number;
}) {
  const { gameweek, status, allGameweeks, fixtures, outstanding, fixtureCount } = props;
  const [toast, setToast] = useState<{ msg: string; err?: boolean } | null>(null);
  const [, start] = useTransition();

  const flash = (msg: string, err?: boolean) => { setToast({ msg, err }); setTimeout(() => setToast(null), 3200); };
  const run = (fn: () => Promise<{ ok: boolean; message?: string; error?: string }>) =>
    start(async () => { const r = await fn(); flash(r.ok ? r.message ?? 'Saved' : r.error ?? 'Failed', !r.ok); });

  const settled = fixtures.filter((f) => f.finished || f.postponed).length;
  const incomplete = outstanding.filter((o) => o.picks_made < fixtureCount || !o.captain_set);

  return (
    <>
      <h1 className="page">Gameweek {gameweek} results</h1>
      <p className="sub">
        {settled}/{fixtures.length} settled · status <strong>{status}</strong>.
        Manual entry is the failsafe — the feed normally handles this on its own.
      </p>

      <div className="gwsel" style={{ marginBottom: 16 }}>
        {allGameweeks.map((g) => (
          <Link key={g} href={`/admin/results?gw=${g}`} className={g === gameweek ? 'on' : ''}>GW{g}</Link>
        ))}
      </div>

      <div className="notice warn" style={{ marginBottom: 16 }}>
        <div><strong>Changing a score does not recalculate points on its own.</strong> After any
        correction, press <em>Re-score</em> below — that wipes and rebuilds this Gameweek&apos;s points
        from the current results.</div>
      </div>

      <div className="card">
        <div className="card-hd"><h2>Final scores</h2><div className="spacer" />
          <button className="btn teal sm" onClick={() => run(() => rescoreGameweek(gameweek))}>
            Re-score GW{gameweek}
          </button>
          {status === 'published'
            ? <button className="btn ghost sm" onClick={() => run(() => setGameweekStatus(gameweek, 'locked'))}>Unpublish</button>
            : <button className="btn ghost sm" onClick={() => run(() => setGameweekStatus(gameweek, 'published'))}>Publish</button>}
        </div>

        {fixtures.map((f) => {
          const sel = (side: 'home' | 'away') => {
            const val = side === 'home' ? f.home_score : f.away_score;
            return (
              <select className={`scoresel${val != null ? ' filled' : ''}`} defaultValue={val ?? ''}
                disabled={f.postponed}
                onChange={(e) => {
                  const v = e.target.value === '' ? null : Number(e.target.value);
                  const home = side === 'home' ? v : f.home_score;
                  const away = side === 'away' ? v : f.away_score;
                  if (home == null || away == null) return;
                  run(() => setResult(f.id, home, away));
                }}>
                <option value="">–</option>
                {SCORES.map((n) => <option key={n} value={n}>{n}</option>)}
              </select>
            );
          };
          return (
            <div key={f.id} className="fx" style={f.postponed ? { opacity: .6 } : undefined}>
              <div className="team"><span className="nm">{f.home_name}</span></div>
              <div className="scorebox">{sel('home')}<span className="vs">–</span>{sel('away')}</div>
              <div className="team away"><span className="nm">{f.away_name}</span></div>
              <div style={{ textAlign: 'right' }}>
                <div className="ko">{fmtKickoff(f.kickoff)}</div>
                <button className="btn ghost sm" style={{ marginTop: 5 }}
                  onClick={() => {
                    const msg = f.postponed
                      ? `Un-void ${f.home_name} v ${f.away_name}?`
                      : `Void ${f.home_name} v ${f.away_name}? It scores zero for everyone and voids anyone's Captain on it.`;
                    if (confirm(msg)) run(() => setResult(f.id, null, null, !f.postponed));
                  }}>
                  {f.postponed ? 'Un-void' : 'Void'}
                </button>
              </div>
            </div>
          );
        })}
      </div>

      <div className="card">
        <div className="card-hd"><h2>Still to submit</h2>
          <span className={`pill ${incomplete.length ? 'amber' : 'teal'}`}>
            {incomplete.length ? `${incomplete.length} outstanding` : 'everyone in'}</span>
        </div>
        <div className="card-bd">
          {incomplete.length === 0 ? (
            <p style={{ fontSize: 14, color: 'var(--muted)', margin: 0 }}>
              Every active player has a full entry for GW{gameweek}. Nothing to chase.
            </p>
          ) : (
            <table className="lb">
              <thead><tr><th>Player</th><th className="num">Picks</th><th>Captain</th></tr></thead>
              <tbody>
                {incomplete.map((o) => (
                  <tr key={o.display_name}>
                    <td style={{ fontWeight: 700 }}>{o.display_name}</td>
                    <td className="num">{o.picks_made}/{fixtureCount}</td>
                    <td>{o.captain_set
                      ? <span className="pill teal">set</span>
                      : <span className="pill amber">missing</span>}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      </div>

      {toast && <div className={`toast${toast.err ? ' err' : ''}`}>{toast.msg}</div>}
    </>
  );
}
