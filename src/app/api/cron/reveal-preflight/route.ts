import { NextResponse, type NextRequest } from 'next/server';
import { createAdminClient } from '@/lib/supabase/admin';
import { sendEmail } from '@/lib/email/resend';
import { fmtKickoff } from '@/lib/format';

export const dynamic = 'force-dynamic';

/**
 * Pre-flight check for the reveal.
 *
 * The reveal fires in a thirty-minute window once a week. If something is
 * wrong, you find out by noticing an email that never came — a week after it
 * mattered. This runs hourly and, roughly six hours before a deadline, checks
 * the reveal would actually do something. If it would send to nobody, it tells
 * you while there is still time to act.
 *
 * Deliberately conservative: one alert per gameweek, and silence when all is well.
 */
const ALERT_WINDOW_HOURS = 6;

export async function GET(request: NextRequest) {
  const secret = process.env.CRON_SECRET;
  const fromHeader = request.headers.get('authorization')?.replace(/^Bearer\s+/i, '');
  const url = new URL(request.url);
  if (!secret || (fromHeader || url.searchParams.get('secret')) !== secret) {
    return NextResponse.json({ error: 'Unauthorised' }, { status: 401 });
  }

  const db = createAdminClient();
  const site = process.env.NEXT_PUBLIC_SITE_URL ?? 'https://tfkpredictions.com';
  const now = new Date();
  const force = url.searchParams.get('force') === '1';

  try {
    const { data: gameweeks } = await db
      .from('gameweeks').select('id, deadline')
      .gt('deadline', now.toISOString()).order('deadline').limit(1);
    const next = (gameweeks ?? [])[0];
    if (!next) return NextResponse.json({ ok: true, checked: false, reason: 'no upcoming gameweek' });

    const hoursOut = (new Date(next.deadline).getTime() - now.getTime()) / 3_600_000;
    const inAlertWindow = hoursOut > ALERT_WINDOW_HOURS - 1 && hoursOut <= ALERT_WINDOW_HOURS;
    if (!inAlertWindow && !force) {
      return NextResponse.json({ ok: true, checked: false, gameweek: next.id, hoursOut: Math.round(hoursOut) });
    }

    const { data: readiness, error } = await db.rpc('reveal_readiness', { p_gameweek: next.id });
    if (error) throw error;
    const r = (readiness ?? [])[0] as {
      opted_in: number; captain_set: number; all_predictions_in: number;
      would_receive: number; already_sent: number;
    } | undefined;
    if (!r) throw new Error('reveal_readiness returned nothing');

    // Only shout if it would genuinely send to nobody.
    const healthy = r.would_receive > 0 || r.already_sent > 0;

    await db.from('job_runs').insert({
      job: 'reveal-preflight',
      outcome: healthy ? 'skipped' : 'error',
      detail: { gameweek: next.id, hoursOut: Math.round(hoursOut), ...r }
    });

    if (healthy) {
      return NextResponse.json({ ok: true, checked: true, healthy: true, gameweek: next.id, ...r });
    }

    const { data: admins } = await db.rpc('league_emails');
    const adminEmail = process.env.ADMIN_EMAILS?.split(',')[0]?.trim()
      ?? (admins ?? [])[0]?.email;

    if (adminEmail) {
      await sendEmail({
        to: adminEmail,
        subject: `Heads up — the GW${next.id} reveal would send to nobody`,
        text:
`The pre-flight check ran ${Math.round(hoursOut)} hours before the Gameweek ${next.id} deadline
(${fmtKickoff(next.deadline)}) and the reveal would currently send to nobody.

  Opted in to email .......... ${r.opted_in}
  Captain set ................ ${r.captain_set}
  All predictions in ......... ${r.all_predictions_in}
  Would receive the reveal ... ${r.would_receive}
  Already sent ............... ${r.already_sent}

The reveal only goes to players with every prediction in AND a captain set. If
"all predictions in" is low, that is simply people not having finished yet and
it may well resolve itself before the deadline.

Check again closer to the time:
${site}/api/cron/send-reveal?secret=YOUR_SECRET&dryrun=1`,
        html:
`<p>The pre-flight check ran <strong>${Math.round(hoursOut)} hours</strong> before the Gameweek ${next.id} deadline (${fmtKickoff(next.deadline)}) and the reveal would currently send to <strong>nobody</strong>.</p>
<table cellpadding="4" style="font-family:monospace;font-size:13px">
<tr><td>Opted in to email</td><td align="right"><strong>${r.opted_in}</strong></td></tr>
<tr><td>Captain set</td><td align="right"><strong>${r.captain_set}</strong></td></tr>
<tr><td>All predictions in</td><td align="right"><strong>${r.all_predictions_in}</strong></td></tr>
<tr><td>Would receive the reveal</td><td align="right"><strong>${r.would_receive}</strong></td></tr>
<tr><td>Already sent</td><td align="right"><strong>${r.already_sent}</strong></td></tr>
</table>
<p>The reveal only goes to players with every prediction in <em>and</em> a captain set. If "all predictions in" is low, that is people not having finished yet and may resolve before the deadline.</p>`
      });
    }

    return NextResponse.json({ ok: true, checked: true, healthy: false, alerted: !!adminEmail, gameweek: next.id, ...r });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Preflight failed';
    console.error('[reveal-preflight]', err);
    return NextResponse.json({ ok: false, error: message }, { status: 500 });
  }
}
