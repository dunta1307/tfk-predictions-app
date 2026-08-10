import { NextResponse, type NextRequest } from 'next/server';
import { createAdminClient } from '@/lib/supabase/admin';
import { getBootstrap, getFixtures } from '@/lib/fpl';
import { monthKeyFor } from '@/lib/gameweeks';

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

/**
 * Pulls the full season from the FPL API and upserts it.
 *
 * Runs nightly on Vercel Cron. It has to run nightly rather than once,
 * because TV picks move kickoff times constantly — and since our deadline
 * IS the first kickoff, a moved fixture moves the deadline with it.
 *
 * Trigger manually with:
 *   curl -H "Authorization: Bearer $CRON_SECRET" https://tfkpredictions.com/api/cron/sync-fixtures
 */
export async function GET(request: NextRequest) {
  const secret = process.env.CRON_SECRET;

  // Vercel Cron sends the secret as a header. A browser can't set headers, so
  // we also accept ?secret=... for triggering the import by hand from the
  // address bar. The endpoint only ever writes publicly available fixture data,
  // so the worst a leaked secret allows is an unnecessary resync.
  const fromHeader = request.headers.get('authorization')?.replace(/^Bearer\s+/i, '');
  const fromQuery = new URL(request.url).searchParams.get('secret');
  const provided = fromHeader || fromQuery;

  if (!secret || provided !== secret) {
    return NextResponse.json({ error: 'Unauthorised' }, { status: 401 });
  }

  const db = createAdminClient();

  try {
    const [bootstrap, fplFixtures] = await Promise.all([getBootstrap(), getFixtures()]);

    // ---- teams ----
    const teams = bootstrap.teams.map((t) => ({
      id: t.id, code: t.code, name: t.name, short_name: t.short_name, updated_at: new Date().toISOString()
    }));
    const { error: teamErr } = await db.from('teams').upsert(teams);
    if (teamErr) throw teamErr;

    // ---- fixtures with a confirmed gameweek and kickoff ----
    const scheduled = fplFixtures.filter(
      (f) => f.event !== null && f.kickoff_time !== null
    );

    // ---- gameweeks: deadline = FIRST KICKOFF of the gameweek ----
    const firstKickoff = new Map<number, string>();
    for (const f of scheduled) {
      const current = firstKickoff.get(f.event!);
      if (!current || f.kickoff_time! < current) firstKickoff.set(f.event!, f.kickoff_time!);
    }

    const gameweeks = bootstrap.events
      .filter((e) => firstKickoff.has(e.id))
      .map((e) => {
        const ko = firstKickoff.get(e.id)!;
        return {
          id: e.id,
          deadline: ko,
          fpl_deadline: e.deadline_time,
          month_key: monthKeyFor(new Date(ko)),
          status: e.finished ? 'locked' : new Date() >= new Date(ko) ? 'locked' : 'upcoming',
          updated_at: new Date().toISOString()
        };
      });

    const { error: gwErr } = await db.from('gameweeks').upsert(gameweeks);
    if (gwErr) throw gwErr;

    // ---- fixtures ----
    const rows = scheduled.map((f) => ({
      id: f.id,
      gameweek: f.event!,
      kickoff: f.kickoff_time!,
      home_team: f.team_h,
      away_team: f.team_a,
      home_score: f.team_h_score,
      away_score: f.team_a_score,
      finished: f.finished || f.finished_provisional,
      postponed: false,
      updated_at: new Date().toISOString()
    }));
    const { error: fxErr } = await db.from('fixtures').upsert(rows);
    if (fxErr) throw fxErr;

    // A fixture that has lost its gameweek in the FPL feed has been postponed.
    const keptIds = new Set(rows.map((r) => r.id));
    const orphans = fplFixtures.filter((f) => f.event === null && !keptIds.has(f.id)).map((f) => f.id);
    if (orphans.length) {
      await db.from('fixtures').update({ postponed: true, updated_at: new Date().toISOString() }).in('id', orphans);
    }

    return NextResponse.json({
      ok: true,
      teams: teams.length,
      gameweeks: gameweeks.length,
      fixtures: rows.length,
      postponed: orphans.length,
      syncedAt: new Date().toISOString()
    });
  } catch (err) {
    console.error('[sync-fixtures]', err);
    return NextResponse.json(
      { ok: false, error: err instanceof Error ? err.message : 'Sync failed' },
      { status: 500 }
    );
  }
}
