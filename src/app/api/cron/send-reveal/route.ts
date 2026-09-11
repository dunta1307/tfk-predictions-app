import { NextResponse, type NextRequest } from 'next/server';
import { createAdminClient } from '@/lib/supabase/admin';
import { sendEmail } from '@/lib/email/resend';
import { unsubscribeUrl } from '@/lib/email/tokens';
import { revealHtml, revealText, revealSubject, type RevealData, type RevealFixture } from '@/lib/email/reveal';
import { fmtKickoff, fmtTime } from '@/lib/format';

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

/** How long before the deadline the cards go on the table. */
const REVEAL_WINDOW_MINUTES = 30;

type Outcome = 'sent' | 'skipped' | 'error';

/**
 * Every run leaves a trace. This job fires six times in a thirty-minute window
 * once a week; without a record, a failure is invisible until somebody notices
 * an email that never arrived — which is exactly how it went undiagnosed twice.
 */
async function logRun(
  db: ReturnType<typeof createAdminClient>,
  outcome: Outcome,
  detail: Record<string, unknown>
) {
  try {
    await db.from('job_runs').insert({ job: 'reveal', outcome, detail });
  } catch {
    // Never let logging break the send.
  }
}

/**
 * The pre-match reveal: everyone's predictions, half an hour before kickoff.
 *
 * Only goes to players whose entry is COMPLETE. At this point captains are not
 * locked yet, so sending the field to someone still deciding would hand them a
 * free look. They get the one-hour reminder instead.
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
  const url = new URL(request.url);

  /**
   * Preview mode: ?preview=1&to=you@email.com
   *
   * Sends the real thing, with real predictions, to ONE address regardless of
   * the send window. Writes nothing to email_log, so the scheduled run later
   * is unaffected and everyone still gets theirs at the proper time.
   */
  const previewTo = url.searchParams.get('preview') === '1'
    ? url.searchParams.get('to')
    : null;
  /** Reports what would happen and sends nothing. Safe to hit any time. */
  const dryRun = url.searchParams.get('dryrun') === '1';
  /** Ignores the time window. For testing the full path on demand. */
  const force = url.searchParams.get('force') === '1';
  if (url.searchParams.get('preview') === '1' && !previewTo?.includes('@')) {
    return NextResponse.json({ error: 'Preview needs &to=your@email.com' }, { status: 400 });
  }

  try {
    const { data: gameweeks } = await db
      .from('gameweeks').select('id, deadline')
      .gt('deadline', now.toISOString()).order('deadline').limit(2);

    const minutesTo = (g: { deadline: string }) =>
      (new Date(g.deadline).getTime() - now.getTime()) / 60000;

    const target = (previewTo || force || dryRun)
      ? (gameweeks ?? [])[0]                       // next gameweek, whenever it is
      : (gameweeks ?? []).find((g) => {
          const mins = minutesTo(g);
          return mins > 0 && mins <= REVEAL_WINDOW_MINUTES;
        });

    if (!target) {
      const next = (gameweeks ?? [])[0];
      const detail = {
        reason: 'not inside the reveal window',
        nextGameweek: next?.id ?? null,
        minutesToNextDeadline: next ? Math.round(minutesTo(next)) : null,
        windowMinutes: REVEAL_WINDOW_MINUTES
      };
      await logRun(db, 'skipped', detail);
      return NextResponse.json({ ok: true, sent: 0, ...detail });
    }

    const [{ data: liveTargets, error: tErr }, { data: rows, error: rErr }] = await Promise.all([
      db.rpc('reveal_targets', { p_gameweek: target.id }),
      db.rpc('reveal_data', { p_gameweek: target.id })
    ]);
    if (tErr) throw tErr;
    if (rErr) throw rErr;

    // In preview mode the recipient list is exactly one person: you.
    const targets = previewTo
      ? [{ user_id: 'preview', email: previewTo, display_name: 'Preview' }]
      : liveTargets;

    if (dryRun) {
      const detail = {
        dryRun: true,
        gameweek: target.id,
        minutesToDeadline: Math.round(minutesTo(target)),
        wouldReceive: liveTargets?.length ?? 0,
        predictionsFound: (rows ?? []).length
      };
      await logRun(db, 'skipped', detail);
      return NextResponse.json({ ok: true, sent: 0, ...detail });
    }

    if (!targets?.length) {
      const detail = {
        reason: 'nobody eligible',
        gameweek: target.id,
        minutesToDeadline: Math.round(minutesTo(target)),
        hint: 'reveal_targets requires all predictions in AND a captain set. Check reveal_readiness().'
      };
      await logRun(db, 'skipped', detail);
      return NextResponse.json({ ok: true, sent: 0, ...detail });
    }

    // Build the fixture blocks once — identical for every recipient except for
    // which picks get highlighted, which the template handles.
    const byFixture = new Map<number, RevealFixture>();
    for (const r of rows ?? []) {
      let f = byFixture.get(r.fixture_id);
      if (!f) {
        f = {
          fixture_id: r.fixture_id,
          homeName: r.home_name, awayName: r.away_name,
          kickoffText: fmtTime(r.kickoff),
          picks: []
        };
        byFixture.set(r.fixture_id, f);
      }
      f.picks.push({
        user_id: r.user_id, name: r.display_name, isBot: r.is_bot,
        home: r.home_score, away: r.away_score, isCaptain: r.is_captain
      });
    }
    const fixtures = [...byFixture.values()];
    const players = new Set((rows ?? []).map((r: { user_id: string }) => r.user_id)).size;

    let sent = 0;
    let alreadySent = 0;
    const failures: string[] = [];
    const claimErrors: string[] = [];

    for (const t of targets as { user_id: string; email: string; display_name: string }[]) {
      if (!previewTo) {
        const { error: claimErr } = await db.from('email_log')
          .insert({ user_id: t.user_id, gameweek: target.id, kind: 'reveal' });
        if (claimErr) {
          /**
           * A duplicate key is the normal case — this person already had it.
           * ANYTHING ELSE is a real fault and must not be swallowed. The
           * original version skipped silently on every error, which meant a
           * constraint problem looked identical to "already sent" and the
           * endpoint reported sent:0 with nothing wrong. That hid this bug
           * for two gameweeks.
           */
          const duplicate = claimErr.code === '23505'
            || /duplicate key/i.test(claimErr.message ?? '');
          if (duplicate) { alreadySent++; continue; }
          claimErrors.push(`${t.email}: ${claimErr.message}`);
          continue;
        }
      }

      const data: RevealData = {
        name: previewTo ? 'Donnacha' : t.display_name,
        meId: t.user_id,
        gameweek: target.id,
        deadlineText: fmtKickoff(target.deadline),
        fixtures,
        players,
        appUrl: site,
        unsubscribeUrl: unsubscribeUrl(t.user_id, site)
      };

      const res = await sendEmail({
        to: t.email,
        subject: previewTo ? `[PREVIEW] ${revealSubject(data)}` : revealSubject(data),
        html: revealHtml(data),
        text: revealText(data),
        unsubscribeUrl: data.unsubscribeUrl
      });

      if (res.ok) {
        sent++;
        if (res.id && !previewTo) {
          await db.from('email_log').update({ provider_id: res.id })
            .eq('user_id', t.user_id).eq('gameweek', target.id).eq('kind', 'reveal');
        }
      } else {
        if (!previewTo) {
          await db.from('email_log').delete()
            .eq('user_id', t.user_id).eq('gameweek', target.id).eq('kind', 'reveal');
        }
        failures.push(`${t.email}: ${res.error}`);
      }
    }

    const blocked = claimErrors.length > 0;
    await logRun(db, blocked ? 'error' : 'sent', {
      gameweek: target.id, eligible: targets.length, sent, alreadySent,
      failures: failures.slice(0, 5), claimErrors: claimErrors.slice(0, 5),
      preview: !!previewTo, force
    });
    return NextResponse.json({
      ok: !blocked,
      preview: !!previewTo,
      gameweek: target.id,
      eligible: targets.length,
      sent,
      alreadySent,
      playersShown: players,
      fixtures: fixtures.length,
      failures: failures.length ? failures : undefined,
      // Surfaced loudly rather than swallowed — this is what went wrong before.
      claimErrors: blocked ? claimErrors.slice(0, 5) : undefined,
      hint: blocked
        ? 'Could not write to email_log. Check the email_log_kind_check constraint allows the value reveal.'
        : undefined
    }, { status: blocked ? 500 : 200 });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Reveal run failed';
    console.error('[send-reveal]', err);
    await logRun(db, 'error', { message });
    return NextResponse.json({ ok: false, error: message }, { status: 500 });
  }
}
