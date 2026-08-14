import type { ReminderKind } from './windows';

export interface StandingSnippet {
  rank: number; points: number; players: number; gapToLeader: number;
}
export interface MonthSnippet {
  label: string;
  top: { rank: number; name: string; points: number }[];
  myRank: number | null;
  myPoints: number | null;
}
export interface ReminderData {
  kind: ReminderKind;
  name: string;
  gameweek: number;
  deadlineText: string;      // "Fri 21 Aug, 20:00"
  openingFixture: string;    // "Arsenal v Coventry City"
  picksMade: number;
  fixturesTotal: number;
  captainSet: boolean;
  season: StandingSnippet | null;
  month: MonthSnippet | null;
  appUrl: string;
  unsubscribeUrl: string;
}

const esc = (s: string) =>
  String(s).replace(/[&<>"']/g, (c) =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c] as string));

/* ---------------------------------------------------------------------
   Copy. Warm and dry — it should read like a person who also plays,
   not a system telling you about a state change.
   --------------------------------------------------------------------- */
function headline(d: ReminderData): string {
  const first = d.name.split(' ')[0];
  return d.kind === 'reminder_1h' ? `One hour, ${first}` : `Twenty-four hours, ${first}`;
}

function situation(d: ReminderData): string {
  const missing = d.fixturesTotal - d.picksMade;
  const urgent = d.kind === 'reminder_1h';

  if (d.picksMade === 0) {
    return urgent
      ? `Nothing in yet. Ten scorelines and a Captain — it genuinely takes two minutes, and a blank week scores zero.`
      : `Not a single scoreline in yet. It takes about two minutes, and future you will be glad.`;
  }
  if (missing === 0 && !d.captainSet) {
    return urgent
      ? `All ten in, but no Captain. That's your double-points pick going begging — one tap fixes it.`
      : `All ten predictions in, which is the hard part done. You haven't picked a Captain though, and that's the one that doubles.`;
  }
  if (missing > 0 && !d.captainSet) {
    return urgent
      ? `${d.picksMade} of ${d.fixturesTotal} in and no Captain. ${missing} to go.`
      : `You're ${d.picksMade} of ${d.fixturesTotal} in, no Captain set yet. Nearly there.`;
  }
  return urgent
    ? `${missing} still to go. Captain's sorted, so it's just the scorelines.`
    : `${d.picksMade} of ${d.fixturesTotal} in, Captain set. Just ${missing} left.`;
}

export function reminderSubject(d: ReminderData): string {
  const missing = d.fixturesTotal - d.picksMade;
  if (d.kind === 'reminder_1h') {
    return missing === 0 && !d.captainSet
      ? `One hour — you still haven't picked a Captain`
      : `One hour left — Gameweek ${d.gameweek}`;
  }
  return missing === 0 && !d.captainSet
    ? `Gameweek ${d.gameweek}: all ten in, no Captain`
    : `24 hours to get your Gameweek ${d.gameweek} predictions in`;
}

/* ---------------------------------------------------------------------
   HTML
   --------------------------------------------------------------------- */
const P = '#37003C', TEAL = '#04F5FF', INK = '#00707A', MUTED = '#6B6472', LINE = '#E6E1EA';

function block(title: string, rows: string): string {
  return `
  <tr><td style="padding:0 24px 16px;">
    <table width="100%" cellpadding="0" cellspacing="0" style="background:#FAF8FB;border:1px solid ${LINE};border-radius:10px;">
      <tr><td style="padding:14px 16px;">
        <div style="font-size:11px;text-transform:uppercase;letter-spacing:.1em;font-weight:800;color:${MUTED};margin-bottom:8px;">${title}</div>
        <table width="100%" cellpadding="0" cellspacing="0" style="font-size:14px;color:#444;">${rows}</table>
      </td></tr>
    </table>
  </td></tr>`;
}

export function reminderHtml(d: ReminderData): string {
  const seasonBlock = d.season
    ? block('Where you stand', `
        <tr><td style="padding:3px 0;">Season position</td>
            <td align="right" style="font-weight:800;color:${P};">${d.season.rank} of ${d.season.players}</td></tr>
        <tr><td style="padding:3px 0;">Points</td>
            <td align="right" style="font-weight:800;color:${P};">${d.season.points}</td></tr>
        <tr><td style="padding:3px 0;">${d.season.gapToLeader === 0 ? 'Top of the pile' : 'Behind the leader'}</td>
            <td align="right" style="font-weight:800;color:${d.season.gapToLeader === 0 ? INK : P};">
              ${d.season.gapToLeader === 0 ? '—' : d.season.gapToLeader}</td></tr>`)
    : '';

  const monthBlock = d.month && d.month.top.length
    ? block(`${esc(d.month.label)} prize race`, `
        ${d.month.top.map((r) => `
        <tr><td style="padding:3px 0;">${r.rank}. ${esc(r.name)}</td>
            <td align="right" style="font-weight:800;color:${P};">${r.points}</td></tr>`).join('')}
        ${d.month.myRank && d.month.myRank > 3
          ? `<tr><td colspan="2" style="padding-top:8px;border-top:1px solid ${LINE};"></td></tr>
             <tr><td style="padding:3px 0;color:${INK};font-weight:700;">${d.month.myRank}. You</td>
                 <td align="right" style="font-weight:800;color:${INK};">${d.month.myPoints}</td></tr>`
          : ''}`)
    : '';

  return `
<table width="100%" cellpadding="0" cellspacing="0" style="background:#F5F3F7;padding:28px 12px;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;">
 <tr><td align="center">
  <table width="100%" cellpadding="0" cellspacing="0" style="max-width:520px;background:#fff;border-radius:12px;overflow:hidden;box-shadow:0 2px 10px rgba(55,0,60,.10);">

   <tr><td style="background:${P};padding:20px 24px;">
     <div style="color:#fff;font-weight:800;font-size:17px;letter-spacing:-.02em;">TFK Predictions League</div>
     <div style="color:${TEAL};font-size:11px;letter-spacing:.14em;text-transform:uppercase;font-weight:700;margin-top:3px;">Gameweek ${d.gameweek}</div>
   </td></tr>

   <tr><td style="padding:24px 24px 4px;">
     <h1 style="margin:0 0 10px;font-size:21px;font-weight:800;color:${P};letter-spacing:-.02em;">${esc(headline(d))}</h1>
     <p style="margin:0 0 12px;font-size:15px;line-height:1.55;color:#444;">${esc(situation(d))}</p>
     <p style="margin:0 0 16px;font-size:14px;line-height:1.55;color:${MUTED};">
       Locks <strong style="color:#444;">${esc(d.deadlineText)}</strong>, when ${esc(d.openingFixture)} kicks off.
     </p>
   </td></tr>

   <tr><td align="center" style="padding:0 24px 20px;">
     <a href="${d.appUrl}/predictions"
        style="display:inline-block;background:${TEAL};color:${P};font-weight:800;font-size:15px;padding:14px 32px;border-radius:8px;text-decoration:none;">
       ${d.picksMade === 0 ? 'Make my predictions' : 'Finish my entry'}</a>
   </td></tr>

   ${seasonBlock}
   ${monthBlock}

   <tr><td style="padding:6px 24px 22px;">
     <p style="margin:0;font-size:12.5px;color:${MUTED};line-height:1.55;">
       2 points for the right result, 4 for the exact score, doubled on your Captain.
     </p>
   </td></tr>

   <tr><td style="padding:14px 24px;background:#FAF8FB;border-top:1px solid ${LINE};">
     <p style="margin:0;font-size:11.5px;color:${MUTED};line-height:1.5;">
       You're getting this because you asked for deadline reminders when you joined.<br>
       <a href="${d.unsubscribeUrl}" style="color:${INK};">Turn these off</a> ·
       <a href="${d.appUrl}/settings" style="color:${INK};">Email preferences</a> ·
       <a href="${d.appUrl}" style="color:${INK};">tfkpredictions.com</a>
     </p>
   </td></tr>

  </table>
 </td></tr>
</table>`;
}

/** Plain-text version. Not optional — text/html-only mail scores worse with spam filters. */
export function reminderText(d: ReminderData): string {
  const L: string[] = [];
  L.push(`TFK PREDICTIONS LEAGUE — GAMEWEEK ${d.gameweek}`, '');
  L.push(headline(d), '');
  L.push(situation(d), '');
  L.push(`Locks ${d.deadlineText}, when ${d.openingFixture} kicks off.`, '');
  L.push(`${d.appUrl}/predictions`, '');
  if (d.season) {
    L.push(`WHERE YOU STAND`);
    L.push(`  Season position: ${d.season.rank} of ${d.season.players}`);
    L.push(`  Points: ${d.season.points}`);
    L.push(d.season.gapToLeader === 0 ? '  Top of the pile' : `  Behind the leader: ${d.season.gapToLeader}`);
    L.push('');
  }
  if (d.month && d.month.top.length) {
    L.push(`${d.month.label.toUpperCase()} PRIZE RACE`);
    d.month.top.forEach((r) => L.push(`  ${r.rank}. ${r.name} — ${r.points}`));
    if (d.month.myRank && d.month.myRank > 3) L.push(`  ${d.month.myRank}. You — ${d.month.myPoints}`);
    L.push('');
  }
  L.push('2 points for the right result, 4 for the exact score, doubled on your Captain.', '');
  L.push(`Turn these off: ${d.unsubscribeUrl}`);
  return L.join('\n');
}
