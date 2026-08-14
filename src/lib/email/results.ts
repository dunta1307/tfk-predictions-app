import type { Standing } from './standings';

export interface ResultsData {
  name: string;
  gameweek: number;
  monthLabel: string;
  monthComplete: boolean;
  monthGwsLeft: number;

  /** This player's week */
  myPoints: number;
  myExact: number;
  myOutcome: number;
  myGwRank: number | null;
  players: number;

  /** Kudos only — no prize attached */
  gwWinners: Standing[];
  gwWinnerPoints: number;

  /** The one with cash on it */
  monthTop: Standing[];
  myMonth: Standing | null;
  monthWinners: Standing[] | null;   // set only when the month has finished

  /** Season to date */
  seasonTop: Standing[];
  mySeason: Standing | null;
  mySeasonMove: number | null;

  appUrl: string;
  unsubscribeUrl: string;
}

const esc = (s: string) =>
  String(s).replace(/[&<>"']/g, (c) =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c] as string));

const list = (rows: Standing[]) => rows.map((r) => r.name).join(' and ');

/* ---------------------------------------------------------------------
   Copy
   --------------------------------------------------------------------- */
export function resultsSubject(d: ResultsData): string {
  if (d.monthComplete && d.monthWinners?.length) {
    return `${d.monthLabel} goes to ${list(d.monthWinners)} — GW${d.gameweek} results`;
  }
  if (d.myGwRank === 1) return `Gameweek ${d.gameweek}: you won the week`;
  return `Gameweek ${d.gameweek} results — you scored ${d.myPoints}`;
}

function myWeek(d: ResultsData): string {
  const first = d.name.split(' ')[0];
  if (d.myPoints === 0) {
    return `Nothing landed, ${first}. It happens — ask anyone who captained a 0-0.`;
  }
  if (d.myGwRank === 1) {
    return `Best in the league this week, ${first}. ${d.myPoints} points, ${d.myExact} exact ${d.myExact === 1 ? 'score' : 'scores'}. Enjoy it, there's no prize.`;
  }
  if (d.myExact >= 3) {
    return `${d.myPoints} points, and ${d.myExact} exact scores. That's a proper week, ${first}.`;
  }
  return `${d.myPoints} points this week, ${first} — ${d.myExact} exact ${d.myExact === 1 ? 'score' : 'scores'} and ${d.myOutcome} right ${d.myOutcome === 1 ? 'result' : 'results'}.`;
}

/* ---------------------------------------------------------------------
   HTML
   --------------------------------------------------------------------- */
const P = '#37003C', TEAL = '#04F5FF', INK = '#00707A', PINK = '#E90052',
      MUTED = '#6B6472', LINE = '#E6E1EA', GOLD = '#8A6100';

function table(rows: Standing[], meId: string | null, moves?: Map<string, number | null>): string {
  return rows.map((r) => {
    const me = r.user_id === meId;
    const mv = moves?.get(r.user_id);
    const arrow = mv == null || mv === 0 ? '' :
      mv > 0 ? `<span style="color:${INK};font-size:11px;font-weight:800;"> ▲${mv}</span>`
             : `<span style="color:${PINK};font-size:11px;font-weight:800;"> ▼${-mv}</span>`;
    return `<tr>
      <td style="padding:4px 0;${me ? `color:${INK};font-weight:800;` : ''}">${r.rank}. ${esc(r.name)}${me ? ' (you)' : ''}${arrow}</td>
      <td align="right" style="font-weight:800;color:${me ? INK : P};">${r.points}</td></tr>`;
  }).join('');
}

function block(title: string, note: string, inner: string, accent = false): string {
  return `
  <tr><td style="padding:0 24px 16px;">
    <table width="100%" cellpadding="0" cellspacing="0" style="background:${accent ? '#FFFBF0' : '#FAF8FB'};border:1px solid ${accent ? '#F0DFA8' : LINE};border-radius:10px;">
      <tr><td style="padding:14px 16px;">
        <div style="font-size:11px;text-transform:uppercase;letter-spacing:.1em;font-weight:800;color:${accent ? GOLD : MUTED};margin-bottom:3px;">${title}</div>
        ${note ? `<div style="font-size:12px;color:${MUTED};margin-bottom:8px;">${note}</div>` : '<div style="height:5px"></div>'}
        <table width="100%" cellpadding="0" cellspacing="0" style="font-size:14px;color:#444;">${inner}</table>
      </td></tr>
    </table>
  </td></tr>`;
}

export function resultsHtml(d: ResultsData): string {
  const meId = d.mySeason?.user_id ?? d.myMonth?.user_id ?? null;

  const winnerLine = d.gwWinners.length
    ? `<tr><td style="padding:4px 0;font-weight:700;color:${P};">${esc(list(d.gwWinners))}</td>
       <td align="right" style="font-weight:800;color:${P};">${d.gwWinnerPoints}</td></tr>`
    : '';

  const monthNote = d.monthComplete
    ? 'Final — cash prize'
    : `Cash prize · ${d.monthGwsLeft} ${d.monthGwsLeft === 1 ? 'Gameweek' : 'Gameweeks'} still to play`;

  const monthCrown = d.monthComplete && d.monthWinners?.length
    ? `<tr><td colspan="2" style="padding:2px 0 10px;font-size:15px;font-weight:800;color:${GOLD};">
         ${esc(list(d.monthWinners))} ${d.monthWinners.length > 1 ? 'share' : 'takes'} ${esc(d.monthLabel)}</td></tr>`
    : '';

  return `
<table width="100%" cellpadding="0" cellspacing="0" style="background:#F5F3F7;padding:28px 12px;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;">
 <tr><td align="center">
  <table width="100%" cellpadding="0" cellspacing="0" style="max-width:520px;background:#fff;border-radius:12px;overflow:hidden;box-shadow:0 2px 10px rgba(55,0,60,.10);">

   <tr><td style="background:${P};padding:20px 24px;">
     <div style="color:#fff;font-weight:800;font-size:17px;letter-spacing:-.02em;">TFK Predictions League</div>
     <div style="color:${TEAL};font-size:11px;letter-spacing:.14em;text-transform:uppercase;font-weight:700;margin-top:3px;">Gameweek ${d.gameweek} · Results</div>
   </td></tr>

   <tr><td style="padding:24px 24px 6px;">
     <h1 style="margin:0 0 10px;font-size:21px;font-weight:800;color:${P};letter-spacing:-.02em;">Gameweek ${d.gameweek} is done</h1>
     <p style="margin:0 0 14px;font-size:15px;line-height:1.55;color:#444;">${esc(myWeek(d))}</p>
   </td></tr>

   ${block('Your week', '', `
     <tr><td style="padding:4px 0;">Points</td><td align="right" style="font-weight:800;color:${P};">${d.myPoints}</td></tr>
     <tr><td style="padding:4px 0;">Exact scores</td><td align="right" style="font-weight:800;color:${P};">${d.myExact}</td></tr>
     <tr><td style="padding:4px 0;">Correct outcomes</td><td align="right" style="font-weight:800;color:${P};">${d.myOutcome}</td></tr>
     ${d.myGwRank ? `<tr><td style="padding:4px 0;">Position this week</td><td align="right" style="font-weight:800;color:${P};">${d.myGwRank} of ${d.players}</td></tr>` : ''}`)}

   ${block('Gameweek winner', 'Kudos only — no prize, just bragging rights', winnerLine)}

   ${block(`${esc(d.monthLabel)} race`, monthNote, monthCrown + table(d.monthTop, meId) +
     (d.myMonth && d.myMonth.rank > d.monthTop.length
       ? `<tr><td colspan="2" style="padding-top:8px;border-top:1px solid ${LINE};"></td></tr>` + table([d.myMonth], meId)
       : ''), true)}

   ${block('Season standings', `After ${d.gameweek} ${d.gameweek === 1 ? 'Gameweek' : 'Gameweeks'}`,
     table(d.seasonTop, meId) +
     (d.mySeason && d.mySeason.rank > d.seasonTop.length
       ? `<tr><td colspan="2" style="padding-top:8px;border-top:1px solid ${LINE};"></td></tr>
          <tr><td style="padding:4px 0;color:${INK};font-weight:800;">${d.mySeason.rank}. You${
            d.mySeasonMove ? (d.mySeasonMove > 0
              ? `<span style="font-size:11px;"> ▲${d.mySeasonMove}</span>`
              : `<span style="font-size:11px;"> ▼${-d.mySeasonMove}</span>`) : ''}</td>
              <td align="right" style="font-weight:800;color:${INK};">${d.mySeason.points}</td></tr>`
       : ''))}

   <tr><td align="center" style="padding:2px 24px 22px;">
     <a href="${d.appUrl}/leaderboard"
        style="display:inline-block;background:${TEAL};color:${P};font-weight:800;font-size:15px;padding:14px 32px;border-radius:8px;text-decoration:none;">
       See the full leaderboard</a>
   </td></tr>

   <tr><td style="padding:14px 24px;background:#FAF8FB;border-top:1px solid ${LINE};">
     <p style="margin:0;font-size:11.5px;color:${MUTED};line-height:1.5;">
       You're getting this because you play in the TFK Predictions League.<br>
       <a href="${d.unsubscribeUrl}" style="color:${INK};">Turn these off</a> ·
       <a href="${d.appUrl}/settings" style="color:${INK};">Email preferences</a> ·
       <a href="${d.appUrl}" style="color:${INK};">tfkpredictions.com</a>
     </p>
   </td></tr>

  </table>
 </td></tr>
</table>`;
}

export function resultsText(d: ResultsData): string {
  const L: string[] = [];
  L.push(`TFK PREDICTIONS LEAGUE — GAMEWEEK ${d.gameweek} RESULTS`, '');
  L.push(myWeek(d), '');
  L.push('YOUR WEEK');
  L.push(`  Points: ${d.myPoints}`);
  L.push(`  Exact scores: ${d.myExact}`);
  L.push(`  Correct outcomes: ${d.myOutcome}`);
  if (d.myGwRank) L.push(`  Position this week: ${d.myGwRank} of ${d.players}`);
  L.push('');
  if (d.gwWinners.length) {
    L.push('GAMEWEEK WINNER (kudos only)');
    L.push(`  ${list(d.gwWinners)} — ${d.gwWinnerPoints}`, '');
  }
  L.push(`${d.monthLabel.toUpperCase()} RACE (cash prize)`);
  if (d.monthComplete && d.monthWinners?.length) {
    L.push(`  WINNER: ${list(d.monthWinners)}`);
  } else {
    L.push(`  ${d.monthGwsLeft} ${d.monthGwsLeft === 1 ? 'Gameweek' : 'Gameweeks'} still to play`);
  }
  d.monthTop.forEach((r) => L.push(`  ${r.rank}. ${r.name} — ${r.points}`));
  if (d.myMonth && d.myMonth.rank > d.monthTop.length) L.push(`  ${d.myMonth.rank}. You — ${d.myMonth.points}`);
  L.push('');
  L.push('SEASON STANDINGS');
  d.seasonTop.forEach((r) => L.push(`  ${r.rank}. ${r.name} — ${r.points}`));
  if (d.mySeason && d.mySeason.rank > d.seasonTop.length) L.push(`  ${d.mySeason.rank}. You — ${d.mySeason.points}`);
  L.push('', `${d.appUrl}/leaderboard`, '', `Turn these off: ${d.unsubscribeUrl}`);
  return L.join('\n');
}
