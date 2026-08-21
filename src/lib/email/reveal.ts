export interface RevealPick {
  user_id: string; name: string; isBot: boolean;
  home: number; away: number; isCaptain: boolean;
}
export interface RevealFixture {
  fixture_id: number;
  homeName: string; awayName: string;
  kickoffText: string;
  picks: RevealPick[];
}
export interface RevealData {
  name: string;
  meId: string;
  gameweek: number;
  deadlineText: string;
  fixtures: RevealFixture[];
  players: number;
  appUrl: string;
  unsubscribeUrl: string;
}

const esc = (s: string) =>
  String(s).replace(/[&<>"']/g, (c) =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c] as string));

const P = '#37003C', TEAL = '#04F5FF', INK = '#00707A', PINK = '#E90052',
      MUTED = '#6B6472', LINE = '#E6E1EA';

/** Group identical scorelines so 24 players fit in an email people will read. */
function group(picks: RevealPick[]) {
  const m = new Map<string, { home: number; away: number; names: string[]; captains: number; mine: boolean }>();
  for (const p of picks) {
    const key = `${p.home}-${p.away}`;
    const row = m.get(key) ?? { home: p.home, away: p.away, names: [], captains: 0, mine: false };
    row.names.push(p.isCaptain ? `${p.name} ★` : p.name);
    if (p.isCaptain) row.captains++;
    m.set(key, row);
  }
  return [...m.values()].sort((a, b) => b.names.length - a.names.length);
}

export function revealSubject(d: RevealData): string {
  return `Everyone's Gameweek ${d.gameweek} predictions — locks in 30 minutes`;
}

export function revealHtml(d: RevealData): string {
  const myCaptain = d.fixtures
    .flatMap((f) => f.picks.filter((p) => p.user_id === d.meId && p.isCaptain).map(() => f))
    [0];

  const captainCounts = new Map<string, number>();
  for (const f of d.fixtures) {
    const n = f.picks.filter((p) => p.isCaptain).length;
    if (n) captainCounts.set(`${f.homeName} v ${f.awayName}`, n);
  }
  const popularCaptains = [...captainCounts.entries()].sort((a, b) => b[1] - a[1]).slice(0, 3);

  const fixtureBlocks = d.fixtures.map((f) => {
    const rows = group(f.picks).map((g) => {
      const mineHere = f.picks.some((p) => p.user_id === d.meId && p.home === g.home && p.away === g.away);
      return `<tr>
        <td style="padding:5px 10px 5px 0;white-space:nowrap;vertical-align:top;">
          <span style="display:inline-block;background:${mineHere ? INK : P};color:#fff;font-weight:800;
                       font-size:13px;border-radius:6px;padding:3px 9px;font-variant-numeric:tabular-nums;">
            ${g.home}–${g.away}</span>
        </td>
        <td style="padding:5px 0;font-size:13px;color:#444;line-height:1.5;">
          ${esc(g.names.join(', '))}
          ${g.names.length > 1 ? `<span style="color:${MUTED};"> (${g.names.length})</span>` : ''}
        </td></tr>`;
    }).join('');

    return `
    <tr><td style="padding:0 24px 14px;">
      <table width="100%" cellpadding="0" cellspacing="0" style="border:1px solid ${LINE};border-radius:10px;">
        <tr><td style="padding:12px 14px 8px;border-bottom:1px solid ${LINE};">
          <div style="font-weight:800;font-size:14.5px;color:${P};">${esc(f.homeName)} v ${esc(f.awayName)}</div>
          <div style="font-size:11.5px;color:${MUTED};margin-top:2px;">${esc(f.kickoffText)}</div>
        </td></tr>
        <tr><td style="padding:8px 14px 12px;">
          <table width="100%" cellpadding="0" cellspacing="0">${rows}</table>
        </td></tr>
      </table>
    </td></tr>`;
  }).join('');

  return `
<table width="100%" cellpadding="0" cellspacing="0" style="background:#F5F3F7;padding:28px 12px;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;">
 <tr><td align="center">
  <table width="100%" cellpadding="0" cellspacing="0" style="max-width:560px;background:#fff;border-radius:12px;overflow:hidden;box-shadow:0 2px 10px rgba(55,0,60,.10);">

   <tr><td style="background:${P};padding:20px 24px;">
     <div style="color:#fff;font-weight:800;font-size:17px;letter-spacing:-.02em;">TFK Predictions League</div>
     <div style="color:${TEAL};font-size:11px;letter-spacing:.14em;text-transform:uppercase;font-weight:700;margin-top:3px;">Gameweek ${d.gameweek} · Cards on the table</div>
   </td></tr>

   <tr><td style="padding:24px 24px 6px;">
     <h1 style="margin:0 0 10px;font-size:21px;font-weight:800;color:${P};letter-spacing:-.02em;">Right then, ${esc(d.name.split(' ')[0])}</h1>
     <p style="margin:0 0 12px;font-size:15px;line-height:1.55;color:#444;">
       Thirty minutes until it all locks. Here's what the other ${d.players - 1} have gone for —
       ★ marks a Captain.
     </p>
     ${myCaptain ? `<p style="margin:0 0 14px;font-size:14px;line-height:1.55;color:${MUTED};">
       Yours is on <strong style="color:${PINK};">${esc(myCaptain.homeName)} v ${esc(myCaptain.awayName)}</strong>.
       Your own picks are highlighted below.</p>` : ''}
   </td></tr>

   ${popularCaptains.length ? `
   <tr><td style="padding:0 24px 16px;">
     <table width="100%" cellpadding="0" cellspacing="0" style="background:#FFF0F5;border:1px solid #FFC9D9;border-radius:10px;">
       <tr><td style="padding:13px 15px;">
         <div style="font-size:11px;text-transform:uppercase;letter-spacing:.1em;font-weight:800;color:${PINK};margin-bottom:7px;">Where the armbands went</div>
         <table width="100%" cellpadding="0" cellspacing="0" style="font-size:13.5px;color:#444;">
           ${popularCaptains.map(([name, n]) => `<tr>
             <td style="padding:3px 0;">${esc(name)}</td>
             <td align="right" style="font-weight:800;color:${PINK};">${n}</td></tr>`).join('')}
         </table>
       </td></tr>
     </table>
   </td></tr>` : ''}

   ${fixtureBlocks}

   <tr><td align="center" style="padding:6px 24px 22px;">
     <a href="${d.appUrl}/predictions"
        style="display:inline-block;background:${TEAL};color:${P};font-weight:800;font-size:15px;padding:14px 32px;border-radius:8px;text-decoration:none;">
       Open the app</a>
     <div style="font-size:12px;color:${MUTED};margin-top:10px;">Locks ${esc(d.deadlineText)}. Good luck.</div>
   </td></tr>

   <tr><td style="padding:14px 24px;background:#FAF8FB;border-top:1px solid ${LINE};">
     <p style="margin:0;font-size:11.5px;color:${MUTED};line-height:1.5;">
       Only sent to players who have already completed their entry.<br>
       <a href="${d.unsubscribeUrl}" style="color:${INK};">Turn these off</a> ·
       <a href="${d.appUrl}/settings" style="color:${INK};">Email preferences</a> ·
       <a href="${d.appUrl}" style="color:${INK};">tfkpredictions.com</a>
     </p>
   </td></tr>

  </table>
 </td></tr>
</table>`;
}

export function revealText(d: RevealData): string {
  const L: string[] = [];
  L.push(`TFK PREDICTIONS — GAMEWEEK ${d.gameweek}`, `Everyone's cards. Locks ${d.deadlineText}.`, '');
  for (const f of d.fixtures) {
    L.push(`${f.homeName} v ${f.awayName}  (${f.kickoffText})`);
    for (const g of group(f.picks)) {
      L.push(`   ${g.home}-${g.away}  ${g.names.join(', ')}`);
    }
    L.push('');
  }
  L.push('★ = Captain', '', `${d.appUrl}/predictions`, '', `Turn these off: ${d.unsubscribeUrl}`);
  return L.join('\n');
}
