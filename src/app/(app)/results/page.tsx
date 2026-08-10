import Link from 'next/link';
import { redirect } from 'next/navigation';
import { createClient } from '@/lib/supabase/server';
import { crestUrl, monthLabel } from '@/lib/gameweeks';
import { fmtDayHeading } from '@/lib/format';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'Results · TFK Predictions League' };

interface BoardRow {
  id: number; kickoff: string; postponed: boolean; finished: boolean;
  home_score: number | null; away_score: number | null;
  home_name: string; home_code: number;
  away_name: string; away_code: number;
}

export default async function ResultsPage(
  { searchParams }: { searchParams: Promise<{ gw?: string }> }
) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect('/login');

  const { data: gameweeks } = await supabase
    .from('gameweeks').select('id, deadline, month_key, status').order('id');
  if (!gameweeks?.length) redirect('/predictions');

  const now = new Date();
  const started = gameweeks.filter((g) => new Date(g.deadline) <= now);
  const requested = Number((await searchParams).gw);
  const current =
    gameweeks.find((g) => g.id === requested) ??
    started[started.length - 1] ??
    gameweeks[0];

  const [{ data: fixtures }, { data: predictions }, { data: entry }, { data: scores }] = await Promise.all([
    supabase.from('fixture_board')
      .select('id, kickoff, postponed, finished, home_score, away_score, home_name, home_code, away_name, away_code')
      .eq('gameweek', current.id).order('kickoff'),
    supabase.from('predictions')
      .select('fixture_id, home_score, away_score')
      .eq('user_id', user.id).eq('gameweek', current.id),
    supabase.from('entries')
      .select('captain_fixture').eq('user_id', user.id).eq('gameweek', current.id).maybeSingle(),
    supabase.from('scores')
      .select('fixture_id, points, exact, outcome_only, was_captain')
      .eq('user_id', user.id).eq('gameweek', current.id)
  ]);

  const board = (fixtures ?? []) as BoardRow[];
  const picks = new Map((predictions ?? []).map((p) => [p.fixture_id, p]));
  const scored = new Map((scores ?? []).map((s) => [s.fixture_id, s]));
  const captain = entry?.captain_fixture ?? null;

  const totals = (scores ?? []).reduce(
    (acc, s) => ({
      points: acc.points + s.points,
      exact: acc.exact + (s.exact ? 1 : 0),
      outcome: acc.outcome + (s.outcome_only ? 1 : 0)
    }),
    { points: 0, exact: 0, outcome: 0 }
  );

  const settled = board.filter((f) => f.finished || f.postponed).length;
  const captainFixture = board.find((f) => f.id === captain);
  let lastDay = '';

  return (
    <>
      <h1 className="page">Gameweek {current.id} results</h1>
      <p className="sub">
        {settled}/{board.length} matches settled
        {current.status === 'published' ? ' · scored and published' : ' · scoring when the last match finishes'}
        {' · counts towards '}{monthLabel(current.month_key)}
      </p>

      <div className="gwsel" style={{ marginBottom: 16 }}>
        {gameweeks.map((g) => (
          <Link key={g.id} href={`/results?gw=${g.id}`} className={g.id === current.id ? 'on' : ''}>GW{g.id}</Link>
        ))}
      </div>

      <div className="card"><div className="card-bd">
        <div className="statgrid">
          <div className="stat"><div className="k">GW{current.id} points</div><div className="v">{totals.points}</div></div>
          <div className="stat"><div className="k">Exact scores</div><div className="v">{totals.exact}</div></div>
          <div className="stat"><div className="k">Correct outcomes</div><div className="v">{totals.outcome}</div></div>
          <div className="stat"><div className="k">Captain</div>
            <div className="v" style={{ fontSize: 15, lineHeight: 1.7 }}>
              {captainFixture ? `${captainFixture.home_name} v ${captainFixture.away_name}` : 'Not set'}
            </div></div>
        </div>
      </div></div>

      <div className="card">
        <div className="card-hd"><h2>Match by match</h2></div>
        {board.map((f) => {
          const p = picks.get(f.id);
          const s = scored.get(f.id);
          const isCap = captain === f.id;
          const day = fmtDayHeading(f.kickoff);
          const heading = day !== lastDay ? ((lastDay = day), day) : null;

          const tag = f.postponed
            ? <span className="pill grey">Postponed · void</span>
            : !f.finished
              ? <span className="pill grey">To play</span>
              : s?.exact
                ? <span className="pill teal">Exact</span>
                : s?.outcome_only
                  ? <span className="pill amber">Outcome</span>
                  : <span className="pill grey">Miss</span>;

          return (
            <div key={f.id}>
              {heading && <div className="fx-daygap">{heading}</div>}
              <div className={`fx${isCap ? ' captained' : ''}`}>
                <div className="team">
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img className="crest" src={crestUrl(f.home_code)} alt="" width={28} height={28} />
                  <span className="nm">{f.home_name}</span>
                </div>
                <div className="scorebox" style={{ flexDirection: 'column', gap: 4, alignItems: 'center' }}>
                  <span className="result-chip">
                    {f.home_score != null && f.away_score != null ? `${f.home_score} – ${f.away_score}` : '– – –'}
                  </span>
                  <span style={{ fontSize: 11, color: 'var(--muted)', fontWeight: 700 }}>
                    You: {p ? `${p.home_score}-${p.away_score}` : 'no pick'}
                    {isCap && <span style={{ color: 'var(--pl-pink)' }}> ★</span>}
                  </span>
                </div>
                <div className="team away">
                  <span className="nm">{f.away_name}</span>
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img className="crest" src={crestUrl(f.away_code)} alt="" width={28} height={28} />
                </div>
                <div style={{ textAlign: 'right' }}>
                  <div className={`pts${s && s.points > 0 ? ' hit' : ' zero'}`}>
                    {f.finished && !f.postponed ? `+${s?.points ?? 0}` : '—'}
                  </div>
                  <div style={{ marginTop: 3 }}>{tag}</div>
                </div>
              </div>
            </div>
          );
        })}
      </div>
    </>
  );
}
