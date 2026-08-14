import { NextResponse, type NextRequest } from 'next/server';
import { createAdminClient } from '@/lib/supabase/admin';
import { dueReminder } from '@/lib/email/windows';
import { sendEmail } from '@/lib/email/resend';
import { unsubscribeUrl } from '@/lib/email/tokens';
import { reminderHtml, reminderText, reminderSubject, type ReminderData } from '@/lib/email/reminder';
import { monthLabel } from '@/lib/gameweeks';
import { fmtKickoff } from '@/lib/format';

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

/**
 * Deadline reminders, 24 hours and 1 hour out.
 *
 * Runs every ten minutes via pg_cron. Most runs do nothing — it only acts when
 * a gameweek deadline falls inside a send window. Only chases people whose
 * entry is incomplete, which roughly halves the volume and keeps the emails
 * worth opening.
 *
 * A row is written to email_log BEFORE the send. If the send then fails we
 * remove the row so it retries next time round. Getting this the other way
 * round risks double-sending on a timeout, which is the worse failure.
 */
export async function GET(request: NextRequest) {
  const secret = process.env.CRON_SECRET;
  const fromHeader = request.headers.get('authorization')?.replace(/^Bearer\s+/i, '');
  const fromQuery = new URL(request.url).searchParams.get('secret');
  if (!secret || (fromHeader || fromQuery) !== secret) {
    return NextResponse.json({ error: 'Unauthorised' }, { status: 401 });
  }

  const db = createAdminClient();
  const site = process.env.NEXT_PUBLIC_SITE_URL ?? 'https://tfkpredictions.com';
  const now = new Date();

  try {
    // Which gameweek, if any, is currently inside a reminder window?
    const { data: gameweeks, error: gwErr } = await db
      .from('gameweeks')
      .select('id, deadline, month_key')
      .gt('deadline', now.toISOString())
      .order('deadline')
      .limit(3);
    if (gwErr) throw gwErr;

    const target = (gameweeks ?? [])
      .map((g) => ({ ...g, kind: dueReminder(now, new Date(g.deadline)) }))
      .find((g) => g.kind !== null);

    if (!target || !target.kind) {
      return NextResponse.json({ ok: true, sent: 0, reason: 'no gameweek in a send window' });
    }

    // Who still needs chasing, and hasn't already had this email.
    const { data: targets, error: tErr } = await db.rpc('reminder_targets', {
      p_gameweek: target.id,
      p_kind: target.kind
    });
    if (tErr) throw tErr;
    if (!targets?.length) {
      return NextResponse.json({ ok: true, sent: 0, gameweek: target.id, kind: target.kind });
    }

    // Context shared by every email in this batch.
    const [{ data: opener }, { data: overall }, { data: monthly }] = await Promise.all([
      db.from('fixture_board').select('home_name, away_name, kickoff')
        .eq('gameweek', target.id).order('kickoff').limit(1).maybeSingle(),
      db.from('v_leaderboard_overall').select('user_id, points, rank').order('rank'),
      db.from('v_leaderboard_monthly').select('user_id, display_name, points, rank')
        .eq('month_key', target.month_key).order('rank')
    ]);

    const leaderPoints = overall?.[0]?.points ?? 0;
    const players = overall?.length ?? 0;
    const seasonBy = new Map((overall ?? []).map((r) => [r.user_id, r]));
    const monthBy = new Map((monthly ?? []).map((r) => [r.user_id, r]));
    const monthTop = (monthly ?? []).slice(0, 3)
      .map((r) => ({ rank: r.rank, name: r.display_name, points: r.points }));

    let sent = 0;
    const failures: string[] = [];

    for (const t of targets) {
      // Claim the send first — the primary key makes a double-send impossible.
      const { error: claimErr } = await db.from('email_log')
        .insert({ user_id: t.user_id, gameweek: target.id, kind: target.kind });
      if (claimErr) continue; // already sent, or claimed by a parallel run

      const season = seasonBy.get(t.user_id);
      const mine = monthBy.get(t.user_id);

      const data: ReminderData = {
        kind: target.kind,
        name: t.display_name,
        gameweek: target.id,
        deadlineText: fmtKickoff(target.deadline),
        openingFixture: opener ? `${opener.home_name} v ${opener.away_name}` : 'the opening match',
        picksMade: t.picks_made,
        fixturesTotal: t.fixtures_total,
        captainSet: t.captain_set,
        season: season
          ? { rank: season.rank, points: season.points, players, gapToLeader: leaderPoints - season.points }
          : null,
        month: monthTop.length
          ? {
              label: monthLabel(target.month_key),
              top: monthTop,
              myRank: mine?.rank ?? null,
              myPoints: mine?.points ?? null
            }
          : null,
        appUrl: site,
        unsubscribeUrl: unsubscribeUrl(t.user_id, site)
      };

      const res = await sendEmail({
        to: t.email,
        subject: reminderSubject(data),
        html: reminderHtml(data),
        text: reminderText(data),
        unsubscribeUrl: data.unsubscribeUrl
      });

      if (res.ok) {
        sent++;
        if (res.id) {
          await db.from('email_log').update({ provider_id: res.id })
            .eq('user_id', t.user_id).eq('gameweek', target.id).eq('kind', target.kind);
        }
      } else {
        // Release the claim so it retries on the next run rather than being lost.
        await db.from('email_log').delete()
          .eq('user_id', t.user_id).eq('gameweek', target.id).eq('kind', target.kind);
        failures.push(`${t.email}: ${res.error}`);
      }
    }

    return NextResponse.json({
      ok: true,
      gameweek: target.id,
      kind: target.kind,
      candidates: targets.length,
      sent,
      failures: failures.length ? failures : undefined,
      at: now.toISOString()
    });
  } catch (err) {
    console.error('[send-reminders]', err);
    return NextResponse.json(
      { ok: false, error: err instanceof Error ? err.message : 'Reminder run failed' },
      { status: 500 }
    );
  }
}
