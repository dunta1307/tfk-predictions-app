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
  if (url.searchParams.get('preview') === '1' && !previewTo?.includes('@')) {
    return NextResponse.json({ error: 'Preview needs &to=your@email.com' }, { status: 400 });
  }

  try {
    const { data: gameweeks } = await db
      .from('gameweeks').select('id, deadline')
      .gt('deadline', now.toISOString()).order('deadline').limit(2);

    const target = previewTo
      ? (gameweeks ?? [])[0]                       // next gameweek, whenever it is
      : (gameweeks ?? []).find((g) => {
          const mins = (new Date(g.deadline).getTime() - now.getTime()) / 60000;
          return mins > 0 && mins <= REVEAL_WINDOW_MINUTES;
        });
    if (!target) {
      return NextResponse.json({ ok: true, sent: 0, reason: 'not inside the reveal window' });
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

    if (!targets?.length) {
      return NextResponse.json({ ok: true, sent: 0, gameweek: target.id, reason: 'nobody eligible' });
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
    const failures: string[] = [];

    for (const t of targets as { user_id: string; email: string; display_name: string }[]) {
      if (!previewTo) {
        const { error: claimErr } = await db.from('email_log')
          .insert({ user_id: t.user_id, gameweek: target.id, kind: 'reveal' });
        if (claimErr) continue;
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

    return NextResponse.json({
      ok: true, preview: !!previewTo,
      gameweek: target.id, eligible: targets.length, sent,
      playersShown: players, fixtures: fixtures.length,
      failures: failures.length ? failures : undefined
    });
  } catch (err) {
    console.error('[send-reveal]', err);
    return NextResponse.json(
      { ok: false, error: err instanceof Error ? err.message : 'Reveal run failed' },
      { status: 500 }
    );
  }
}
