import { NextResponse, type NextRequest } from 'next/server';
import { createAdminClient } from '@/lib/supabase/admin';
import { sendEmail } from '@/lib/email/resend';
import { unsubscribeUrl } from '@/lib/email/tokens';
import { resultsHtml, resultsText, resultsSubject, type ResultsData } from '@/lib/email/results';
import { aggregate, movement, type GwTotal, type Standing } from '@/lib/email/standings';
import { monthLabel } from '@/lib/gameweeks';

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

const TOP_N = 5;
const MONTH_TOP_N = 3;

/**
 * The weekly round-up, sent once a gameweek has been scored and published.
 *
 * Goes to every opted-in player, not just the stragglers — this is the one
 * that keeps the league alive between deadlines. Idempotent via email_log,
 * same as the reminders.
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

  try {
    // Oldest published gameweek that still owes people an email.
    const { data: pending, error: pErr } = await db.rpc('gameweeks_awaiting_results_email');
    if (pErr) throw pErr;
    const target = (pending ?? []).find((g: { unsent: number }) => g.unsent > 0);
    if (!target) return NextResponse.json({ ok: true, sent: 0, reason: 'nothing to send' });

    const gw: number = target.gameweek;

    // One pass over the data — every scored total, every player, every gameweek.
    const [{ data: people }, { data: totals }, { data: allGws }, { data: everyone }] = await Promise.all([
      db.rpc('league_emails'),
      db.from('v_gameweek_totals').select('gameweek, user_id, points, exact_count, outcome_count'),
      db.from('gameweeks').select('id, month_key, status').order('id'),
      // Names for the tables, which must include the bot even though it is
      // never a recipient. Otherwise it shows up as "Unknown" in the standings.
      db.from('profiles').select('id, display_name, is_bot')
    ]);

    if (!people?.length) return NextResponse.json({ ok: true, sent: 0, reason: 'no players' });

    const names = new Map<string, string>(
      (everyone ?? []).map((p: { id: string; display_name: string }) => [p.id, p.display_name])
    );
    const botIds = new Set(
      (everyone ?? []).filter((p: { is_bot: boolean }) => p.is_bot)
        .map((p: { id: string }) => p.id)
    );
    const rows = (totals ?? []) as GwTotal[];

    const publishedUpTo = (allGws ?? [])
      .filter((g) => g.status === 'published' && g.id <= gw)
      .map((g) => g.id);
    const publishedBefore = publishedUpTo.filter((id) => id !== gw);

    const monthKey: string = target.month_key;
    const monthAll = (allGws ?? []).filter((g) => g.month_key === monthKey);
    const monthPublished = monthAll.filter((g) => g.status === 'published').map((g) => g.id);
    const monthComplete = monthPublished.length === monthAll.length;
    const monthGwsLeft = monthAll.length - monthPublished.length;

    // Tables
    const gwTable = aggregate(rows, names, [gw]);
    const seasonNow = aggregate(rows, names, publishedUpTo);
    const seasonBefore = aggregate(rows, names, publishedBefore);
    const monthTable = aggregate(rows, names, monthPublished);
    const moves = movement(seasonBefore, seasonNow);

    const gwWinners = gwTable.filter((r) => r.rank === 1);
    const gwWinnerPoints = gwWinners[0]?.points ?? 0;
    // The cash prize goes to the leading human. The bot can top the table and
    // will be shown doing so, but it never takes the money.
    const monthHumans = monthTable.filter((r) => !botIds.has(r.user_id));
    const monthWinners = monthComplete && monthHumans.length
      ? monthHumans.filter((r) => r.points === monthHumans[0].points
          && r.exact === monthHumans[0].exact && r.outcome === monthHumans[0].outcome)
      : null;
    const seasonTop = seasonNow.slice(0, TOP_N);
    const monthTop = monthTable.slice(0, MONTH_TOP_N);

    const byUser = <T extends { user_id: string }>(list: T[]) =>
      new Map(list.map((r) => [r.user_id, r]));
    const gwBy = byUser(gwTable);
    const seasonBy = byUser(seasonNow);
    const monthBy = byUser(monthTable);

    let sent = 0;
    const failures: string[] = [];

    for (const person of people as { user_id: string; email: string; display_name: string; email_optin: boolean }[]) {
      if (!person.email_optin) continue;

      const { error: claimErr } = await db.from('email_log')
        .insert({ user_id: person.user_id, gameweek: gw, kind: 'results' });
      if (claimErr) continue; // already sent

      const mine = gwBy.get(person.user_id);
      const mySeason = seasonBy.get(person.user_id) ?? null;
      const myMonth = monthBy.get(person.user_id) ?? null;

      const data: ResultsData = {
        name: person.display_name,
        gameweek: gw,
        monthLabel: monthLabel(monthKey),
        monthComplete,
        monthGwsLeft,
        myPoints: mine?.points ?? 0,
        myExact: mine?.exact ?? 0,
        myOutcome: mine?.outcome ?? 0,
        myGwRank: mine?.rank ?? null,
        players: gwTable.length,
        gwWinners,
        gwWinnerPoints,
        monthTop,
        myMonth,
        monthWinners,
        seasonTop,
        mySeason,
        mySeasonMove: moves.get(person.user_id) ?? null,
        appUrl: site,
        unsubscribeUrl: unsubscribeUrl(person.user_id, site)
      };

      const res = await sendEmail({
        to: person.email,
        subject: resultsSubject(data),
        html: resultsHtml(data),
        text: resultsText(data),
        unsubscribeUrl: data.unsubscribeUrl
      });

      if (res.ok) {
        sent++;
        if (res.id) {
          await db.from('email_log').update({ provider_id: res.id })
            .eq('user_id', person.user_id).eq('gameweek', gw).eq('kind', 'results');
        }
      } else {
        await db.from('email_log').delete()
          .eq('user_id', person.user_id).eq('gameweek', gw).eq('kind', 'results');
        failures.push(`${person.email}: ${res.error}`);
      }
    }

    return NextResponse.json({
      ok: true,
      gameweek: gw,
      sent,
      monthComplete,
      monthWinner: monthWinners?.map((w: Standing) => w.name) ?? null,
      gameweekWinner: gwWinners.map((w) => w.name),
      failures: failures.length ? failures : undefined
    });
  } catch (err) {
    console.error('[send-results]', err);
    return NextResponse.json(
      { ok: false, error: err instanceof Error ? err.message : 'Results email run failed' },
      { status: 500 }
    );
  }
}
