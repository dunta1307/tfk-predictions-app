'use client';

import { useEffect, useMemo, useState, useTransition } from 'react';
import Link from 'next/link';
import { savePrediction, setCaptain } from './actions';
import { fixtureLock, canSetCaptain, lockMessage, type LockReason } from '@/lib/locks';
import { crestUrl, monthLabel } from '@/lib/gameweeks';
import { fmtKickoff, fmtTime, fmtDayHeading, countdown } from '@/lib/format';

export interface BoardFixture {
  id: number;
  kickoff: string;
  postponed: boolean;
  home_name: string; home_short: string; home_code: number;
  away_name: string; away_short: string; away_code: number;
}
export interface BoardPrediction { fixture_id: number; home_score: number; away_score: number; created_at: string }

interface Props {
  gameweek: number;
  allGameweeks: number[];
  deadline: string;
  monthKey: string;
  fixtures: BoardFixture[];
  predictions: BoardPrediction[];
  captainFixture: number | null;
}

const SCORES = [0, 1, 2, 3, 4, 5, 6, 7, 8, 9];

export default function PredictionBoard(props: Props) {
  const { gameweek, allGameweeks, deadline, monthKey, fixtures, captainFixture } = props;

  const [picks, setPicks] = useState(() => {
    const m = new Map<number, { home: number | null; away: number | null; createdAt: string }>();
    props.predictions.forEach((p) =>
      m.set(p.fixture_id, { home: p.home_score, away: p.away_score, createdAt: p.created_at }));
    return m;
  });
  const [captain, setCap] = useState<number | null>(captainFixture);
  const [toast, setToast] = useState<{ msg: string; err?: boolean } | null>(null);
  const [, startTransition] = useTransition();

  // Re-render every second so locks flip the moment a match kicks off.
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    const t = setInterval(() => setNow(new Date()), 1000);
    return () => clearInterval(t);
  }, []);

  useEffect(() => {
    if (!toast) return;
    const t = setTimeout(() => setToast(null), 3200);
    return () => clearTimeout(t);
  }, [toast]);

  const deadlineDate = useMemo(() => new Date(deadline), [deadline]);
  const captainOpen = canSetCaptain(now, deadlineDate);
  const deadlinePassed = now >= deadlineDate;

  function lockFor(f: BoardFixture): LockReason {
    if (f.postponed) return 'kicked_off';
    const existing = picks.get(f.id);
    return fixtureLock({
      now,
      deadline: deadlineDate,
      kickoff: new Date(f.kickoff),
      predictionCreatedAt: existing ? new Date(existing.createdAt) : null
    });
  }

  const editable = fixtures.filter((f) => lockFor(f) === 'open');
  /** Fixtures still to kick off — distinguishes "you are committed" from "it is all over". */
  const notStarted = fixtures.filter((f) => !f.postponed && new Date(f.kickoff) > now).length;
  const captainMatch = fixtures.find((f) => f.id === captain);
  const complete = fixtures.filter((f) => {
    const p = picks.get(f.id);
    return p && p.home !== null && p.away !== null;
  }).length;

  function onScore(f: BoardFixture, side: 'home' | 'away', raw: string) {
    const value = raw === '' ? null : Number(raw);
    const current = picks.get(f.id) ?? { home: null, away: null, createdAt: new Date().toISOString() };
    const next = { ...current, [side]: value } as typeof current;
    setPicks(new Map(picks).set(f.id, next));

    if (next.home === null || next.away === null) return; // wait for both halves
    startTransition(async () => {
      const res = await savePrediction(f.id, next.home!, next.away!);
      if (!res.ok) {
        setToast({ msg: res.error ?? 'Could not save', err: true });
        setPicks((prev) => {
          const m = new Map(prev);
          if (current.home === null && current.away === null) m.delete(f.id);
          else m.set(f.id, current);
          return m;
        });
      }
    });
  }

  function onCaptain(f: BoardFixture) {
    if (!captainOpen) return;
    const next = captain === f.id ? null : f.id;
    setCap(next);
    startTransition(async () => {
      const res = await setCaptain(gameweek, next);
      if (!res.ok) { setToast({ msg: res.error ?? 'Could not save', err: true }); setCap(captain); }
      else if (next) setToast({ msg: 'Captain set — double points on this match' });
    });
  }

  let lastDay = '';

  return (
    <>
      <h1 className="page">Gameweek {gameweek} predictions</h1>
      <p className="sub">
        Pick a scoreline for all {fixtures.length} fixtures, then nominate one match as your Captain to
        double its points. This Gameweek counts towards the <strong>{monthLabel(monthKey)}</strong> prize.
      </p>

      <div className="deadline">
        <div><div className="lbl">Deadline</div><div className="val">{fmtKickoff(deadline)}</div></div>
        <div><div className="lbl">{deadlinePassed ? 'Status' : 'Time remaining'}</div>
          <div className="val clock">{countdown(deadlineDate, now)}</div></div>
        <div className="spacer" />
        <div><div className="lbl">Completed</div>
          <div className="val">{complete} / {fixtures.length}{' '}
            {captain && <span className="pill pink" style={{ verticalAlign: 'middle' }}>★ Captain set</span>}
          </div></div>
      </div>

      <div className="gwsel">
        {allGameweeks.map((g) => (
          <Link key={g} href={`/predictions?gw=${g}`} className={g === gameweek ? 'on' : ''}>GW{g}</Link>
        ))}
      </div>

      {deadlinePassed && editable.length > 0 && (
        <div className="notice warn" style={{ margin: '16px 0' }}>
          <div><strong>The Gameweek {gameweek} deadline has passed.</strong> You can still enter the{' '}
            {editable.length} {editable.length === 1 ? 'fixture' : 'fixtures'} that haven&apos;t kicked off,
            but anything you had already saved is locked and you cannot pick a Captain this week.</div>
        </div>
      )}
      {/*
        Two genuinely different situations used to share one message. Anyone who
        submitted on time saw "every fixture has kicked off" the moment the
        deadline passed — hours before most of them had — which read as a
        blanket lockout and made people think something was wrong.
      */}
      {deadlinePassed && editable.length === 0 && notStarted > 0 && (
        <div className="notice info" style={{ margin: '16px 0' }}>
          <div>
            <strong>You&apos;re locked in for Gameweek {gameweek}.</strong> Everything was submitted
            before the deadline, so your picks are final — same as everyone else. Scores appear
            here as the matches finish.
            <div style={{ marginTop: 6, fontWeight: 700 }}>
              {complete} of {fixtures.length} predictions
              {captainMatch && ` · Captain on ${captainMatch.home_name} v ${captainMatch.away_name}`}
            </div>
          </div>
        </div>
      )}

      {deadlinePassed && editable.length === 0 && notStarted === 0 && (
        <div className="notice warn" style={{ margin: '16px 0' }}>
          <div><strong>Every Gameweek {gameweek} fixture has kicked off.</strong> Points land once
          the last match is done.</div>
        </div>
      )}

      <div className="card" style={{ marginTop: 16 }}>
        <div className="card-hd">
          <h2>Fixtures</h2>
          <span className="pill grey">{fixtures.length} matches</span>
          <div className="spacer" />
          {!captainOpen && <span className="pill amber">Captain locked</span>}
        </div>

        {fixtures.map((f) => {
          const reason = lockFor(f);
          const locked = reason !== 'open';
          const p = picks.get(f.id);
          const isCap = captain === f.id;
          const day = fmtDayHeading(f.kickoff);
          const heading = day !== lastDay ? ((lastDay = day), day) : null;

          const select = (side: 'home' | 'away') => {
            const value = side === 'home' ? p?.home : p?.away;
            return (
              <select
                className={`scoresel${value != null ? ' filled' : ''}`}
                disabled={locked}
                value={value ?? ''}
                onChange={(e) => onScore(f, side, e.target.value)}
                aria-label={`${side === 'home' ? f.home_name : f.away_name} goals`}
              >
                <option value="">–</option>
                {SCORES.map((n) => <option key={n} value={n}>{n}</option>)}
              </select>
            );
          };

          return (
            <div key={f.id}>
              {heading && <div className="fx-daygap">{heading}</div>}
              <div className={`fx${isCap ? ' captained' : ''}${locked ? ' locked' : ''}`}>
                <div className="team">
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img className="crest" src={crestUrl(f.home_code)} alt="" width={28} height={28} />
                  <span className="nm">{f.home_name}</span>
                </div>
                <div className="scorebox">{select('home')}<span className="vs">v</span>{select('away')}</div>
                <div className="team away">
                  <span className="nm">{f.away_name}</span>
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img className="crest" src={crestUrl(f.away_code)} alt="" width={28} height={28} />
                </div>
                <div className="capwrap">
                  <button className={`capbtn${isCap ? ' on' : ''}`} disabled={!captainOpen || locked}
                    onClick={() => onCaptain(f)} type="button">
                    {isCap ? '★ CAPTAIN' : '☆ Captain'}
                  </button>
                  {locked
                    ? <div className="lockrow">{f.postponed ? 'Postponed' : lockMessage(reason)}</div>
                    : <div className="ko">{fmtTime(f.kickoff)}</div>}
                </div>
              </div>
            </div>
          );
        })}

        <div className="card-bd" style={{ borderTop: '1px solid var(--line)', fontSize: 13, color: 'var(--muted)' }}>
          Saved automatically as you go — there is no submit button. Each fixture locks the moment it
          kicks off. 2 points for the right result, 4 for the exact score, doubled on your Captain.
        </div>
      </div>

      {toast && <div className={`toast${toast.err ? ' err' : ''}`}>{toast.msg}</div>}
    </>
  );
}
