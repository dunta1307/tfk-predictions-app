import { NextResponse, type NextRequest } from 'next/server';
import { createAdminClient } from '@/lib/supabase/admin';
import { getFixtures } from '@/lib/fpl';

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

/**
 * Pulls live and final scores from the Premier League feed, then scores and
 * publishes any gameweek where every match is settled.
 *
 * Scheduling note: Vercel's Hobby plan only permits cron jobs that run once a
 * day, so this is driven from Supabase using pg_cron every 10 minutes. See
 * supabase/schedule.sql. The endpoint is safe to call as often as you like —
 * scoring is idempotent, re-running it produces identical rows.
 */
export async function GET(request: NextRequest) {
  const secret = process.env.CRON_SECRET;
  const fromHeader = request.headers.get('authorization')?.replace(/^Bearer\s+/i, '');
  const fromQuery = new URL(request.url).searchParams.get('secret');
  if (!secret || (fromHeader || fromQuery) !== secret) {
    return NextResponse.json({ error: 'Unauthorised' }, { status: 401 });
  }

  const db = createAdminClient();

  try {
    const fpl = await getFixtures();

    // ---- update scores on fixtures we already know about ----
    const played = fpl.filter((f) => f.event !== null && f.kickoff_time !== null);
    const updates = played.map((f) => ({
      id: f.id,
      gameweek: f.event!,
      kickoff: f.kickoff_time!,
      home_team: f.team_h,
      away_team: f.team_a,
      home_score: f.team_h_score,
      away_score: f.team_a_score,
      finished: f.finished || f.finished_provisional,
      postponed: false,
      home_difficulty: f.team_h_difficulty,
      away_difficulty: f.team_a_difficulty,
      updated_at: new Date().toISOString()
    }));
    if (updates.length) {
      const { error } = await db.from('fixtures').upsert(updates);
      if (error) throw error;
    }

    // A fixture that has lost its gameweek in the feed has been postponed.
    const stillScheduled = new Set(updates.map((u) => u.id));
    const postponed = fpl.filter((f) => f.event === null && !stillScheduled.has(f.id)).map((f) => f.id);
    if (postponed.length) {
      await db.from('fixtures')
        .update({ postponed: true, updated_at: new Date().toISOString() })
        .in('id', postponed);
    }

    // ---- finalise any gameweek that is past its deadline and not yet published ----
    const { data: pending, error: gwErr } = await db
      .from('gameweeks')
      .select('id, deadline, status')
      .neq('status', 'published')
      .lte('deadline', new Date().toISOString())
      .order('id');
    if (gwErr) throw gwErr;

    const publishedNow: number[] = [];
    for (const gw of pending ?? []) {
      const { data: didPublish, error } = await db.rpc('finalise_gameweek', { p_gameweek: gw.id });
      if (error) {
        console.error(`[sync-results] finalise_gameweek(${gw.id})`, error);
        continue;
      }
      if (didPublish) publishedNow.push(gw.id);
    }

    return NextResponse.json({
      ok: true,
      fixturesUpdated: updates.length,
      postponed: postponed.length,
      gameweeksChecked: pending?.length ?? 0,
      gameweeksPublished: publishedNow,
      syncedAt: new Date().toISOString()
    });
  } catch (err) {
    console.error('[sync-results]', err);
    return NextResponse.json(
      { ok: false, error: err instanceof Error ? err.message : 'Sync failed' },
      { status: 500 }
    );
  }
}
