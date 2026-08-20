import { NextResponse, type NextRequest } from 'next/server';
import { createAdminClient } from '@/lib/supabase/admin';
import { predictFixtures, chooseCaptain, type FixtureInput, type TeamForm } from '@/lib/bot/model';
import { summary } from '@/lib/bot/rationale';

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

/** How long before the deadline the bot commits. Well clear, and never after. */
const SUBMIT_WINDOW_HOURS = 6;

/**
 * The bot's weekly entry.
 *
 * Runs every 10 minutes and does nothing almost every time. When a gameweek
 * deadline is inside the submission window it predicts all ten fixtures and
 * picks a captain, then never touches that gameweek again.
 *
 * Fairness: it writes strictly before the deadline, so it has no more
 * information than anybody else. If this job somehow ran late, the guard below
 * makes it skip rather than submit after kickoff.
 */
export async function GET(request: NextRequest) {
  const secret = process.env.CRON_SECRET;
  const fromHeader = request.headers.get('authorization')?.replace(/^Bearer\s+/i, '');
  const fromQuery = new URL(request.url).searchParams.get('secret');
  if (!secret || (fromHeader || fromQuery) !== secret) {
    return NextResponse.json({ error: 'Unauthorised' }, { status: 401 });
  }

  const db = createAdminClient();
  const now = new Date();

  try {
    const { data: bot } = await db
      .from('profiles').select('id, display_name').eq('is_bot', true).maybeSingle();
    if (!bot) {
      return NextResponse.json({ ok: false, error: 'No bot account. Create it from the Admin panel.' }, { status: 400 });
    }

    const { data: gameweeks } = await db
      .from('gameweeks').select('id, deadline').gt('deadline', now.toISOString())
      .order('deadline').limit(2);

    const target = (gameweeks ?? []).find((g) => {
      const hours = (new Date(g.deadline).getTime() - now.getTime()) / 3_600_000;
      return hours > 0 && hours <= SUBMIT_WINDOW_HOURS;
    });
    if (!target) {
      return NextResponse.json({ ok: true, submitted: 0, reason: 'no deadline inside the submission window' });
    }

    // Never submit twice for the same gameweek.
    const { count } = await db
      .from('predictions').select('*', { count: 'exact', head: true })
      .eq('user_id', bot.id).eq('gameweek', target.id);
    if ((count ?? 0) > 0) {
      return NextResponse.json({ ok: true, submitted: 0, gameweek: target.id, reason: 'already entered' });
    }

    const [{ data: fixtures }, { data: form }] = await Promise.all([
      db.rpc('bot_model_input', { p_gameweek: target.id }),
      db.rpc('bot_form')
    ]);
    if (!fixtures?.length) {
      return NextResponse.json({ ok: true, submitted: 0, reason: 'no fixtures' });
    }

    // Belt and braces: never write a pick for a match that has already started.
    const safe = (fixtures as (FixtureInput & { kickoff: string })[])
      .filter((f) => new Date(f.kickoff) > now);
    if (safe.length !== fixtures.length) {
      console.warn(`[bot] skipping ${fixtures.length - safe.length} fixture(s) already under way`);
    }

    const predictions = predictFixtures(safe, (form ?? []) as TeamForm[]);
    const captain = chooseCaptain(predictions);

    const rows = predictions.map((p) => ({
      user_id: bot.id, fixture_id: p.fixture_id, gameweek: target.id,
      home_score: p.home, away_score: p.away
    }));

    const { error: insErr } = await db.from('predictions').insert(rows);
    if (insErr) throw insErr;

    const { error: entErr } = await db.from('entries').upsert({
      user_id: bot.id, gameweek: target.id,
      captain_fixture: captain, captain_set_at: new Date().toISOString()
    });
    if (entErr) throw entErr;

    return NextResponse.json({
      ok: true,
      gameweek: target.id,
      submitted: rows.length,
      captain,
      summary: summary(predictions, captain),
      picks: predictions.map((p) => `${p.homeName} ${p.home}-${p.away} ${p.awayName}`)
    });
  } catch (err) {
    console.error('[bot-predictions]', err);
    return NextResponse.json(
      { ok: false, error: err instanceof Error ? err.message : 'Bot run failed' },
      { status: 500 }
    );
  }
}
