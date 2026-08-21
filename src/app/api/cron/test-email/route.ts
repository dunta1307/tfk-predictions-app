import { NextResponse, type NextRequest } from 'next/server';
import { sendEmail } from '@/lib/email/resend';
import { unsubscribeUrl } from '@/lib/email/tokens';
import { reminderHtml, reminderText, reminderSubject, type ReminderData } from '@/lib/email/reminder';
import { resultsHtml, resultsText, resultsSubject, type ResultsData } from '@/lib/email/results';
import { revealHtml, revealText, revealSubject, type RevealData } from '@/lib/email/reveal';

export const dynamic = 'force-dynamic';

/**
 * Fires one real email at one address, using the exact same send path as the
 * live jobs. Nothing else in the system sends until a deadline approaches, so
 * without this the first email our code ever sends would go to the whole
 * league. This lets you prove delivery, rendering and the unsubscribe link
 * with an audience of one.
 *
 *   /api/cron/test-email?secret=...&to=you@email.com&kind=reminder_24h
 *   kind = reminder_24h | reminder_1h | results | reveal
 *
 * Writes nothing to the database and touches no real player data.
 */
export async function GET(request: NextRequest) {
  const url = new URL(request.url);
  const secret = process.env.CRON_SECRET;
  const fromHeader = request.headers.get('authorization')?.replace(/^Bearer\s+/i, '');
  if (!secret || (fromHeader || url.searchParams.get('secret')) !== secret) {
    return NextResponse.json({ error: 'Unauthorised' }, { status: 401 });
  }

  const to = url.searchParams.get('to');
  if (!to || !to.includes('@')) {
    return NextResponse.json({ error: 'Add &to=your@email.com' }, { status: 400 });
  }
  const kind = url.searchParams.get('kind') ?? 'reminder_24h';
  const site = process.env.NEXT_PUBLIC_SITE_URL ?? 'https://tfkpredictions.com';
  const fakeId = '00000000-0000-0000-0000-000000000000';

  const S = (rank: number, name: string, points: number) =>
    ({ rank, name, points, exact: 0, outcome: 0, user_id: name });

  let subject: string, html: string, text: string;

  if (kind === 'reveal') {
    const who = ['Donnacha M','Ste Cash','Chalky','Kez Doyle','Big Dave','Marto','Aoife K','The Algorithm'];
    const mk = (fid: number, h: string, a: string, ko: string, scores: [number, number][], capIdx: number) => ({
      fixture_id: fid, homeName: h, awayName: a, kickoffText: ko,
      picks: scores.map((s, i) => ({
        user_id: i === 0 ? fakeId : `u${i}`, name: who[i] ?? `Player ${i}`,
        isBot: who[i] === 'The Algorithm', home: s[0], away: s[1], isCaptain: i === capIdx
      }))
    });
    const d: RevealData = {
      name: 'Test Account', meId: fakeId, gameweek: 3,
      deadlineText: 'Fri 4 Sep, 20:00', players: 8,
      fixtures: [
        mk(1, 'Ipswich Town', 'Liverpool', '20:00',
           [[0,2],[0,2],[1,2],[0,1],[0,2],[1,1],[0,3],[0,2]], 0),
        mk(2, 'Newcastle', 'Bournemouth', '12:30',
           [[2,1],[2,0],[2,1],[1,1],[3,1],[2,1],[2,0],[2,1]], 3),
        mk(3, 'Man City', 'Coventry City', '15:00',
           [[3,0],[4,0],[3,0],[2,0],[3,1],[3,0],[5,0],[3,0]], 5)
      ],
      appUrl: site, unsubscribeUrl: unsubscribeUrl(fakeId, site)
    };
    subject = `[TEST] ${revealSubject(d)}`;
    html = revealHtml(d); text = revealText(d);
  } else if (kind === 'results') {
    const d: ResultsData = {
      name: 'Test Account', gameweek: 3, monthLabel: 'September 2026',
      monthComplete: false, monthGwsLeft: 2,
      myPoints: 14, myExact: 2, myOutcome: 3, myGwRank: 9, players: 24,
      gwWinners: [S(1, 'Chalky', 22)], gwWinnerPoints: 22,
      monthTop: [S(1, 'Chalky', 44), S(2, 'Kez Doyle', 38), S(3, 'Big Dave', 35)],
      myMonth: S(6, 'Test Account', 24), monthWinners: null,
      seasonTop: [S(1, 'Kez Doyle', 96), S(2, 'Chalky', 94), S(3, 'Scouse Phil', 88),
                  S(4, 'Nadia P', 85), S(5, 'Woody', 81)],
      mySeason: S(7, 'Test Account', 62), mySeasonMove: 2,
      appUrl: site, unsubscribeUrl: unsubscribeUrl(fakeId, site)
    };
    subject = `[TEST] ${resultsSubject(d)}`;
    html = resultsHtml(d); text = resultsText(d);
  } else {
    const d: ReminderData = {
      kind: kind === 'reminder_1h' ? 'reminder_1h' : 'reminder_24h',
      name: 'Test Account', gameweek: 3,
      deadlineText: 'Fri 4 Sep, 20:00', openingFixture: 'Ipswich Town v Liverpool',
      picksMade: 10, fixturesTotal: 10, captainSet: false,
      season: { rank: 7, points: 34, players: 24, gapToLeader: 11 },
      month: {
        label: 'September 2026',
        top: [{ rank: 1, name: 'Chalky', points: 22 },
              { rank: 2, name: 'Kez Doyle', points: 20 },
              { rank: 3, name: 'Big Dave', points: 18 }],
        myRank: 7, myPoints: 12
      },
      appUrl: site, unsubscribeUrl: unsubscribeUrl(fakeId, site)
    };
    subject = `[TEST] ${reminderSubject(d)}`;
    html = reminderHtml(d); text = reminderText(d);
  }

  const res = await sendEmail({ to, subject, html, text });

  return NextResponse.json(
    res.ok
      ? { ok: true, sent: to, kind, providerId: res.id }
      : { ok: false, error: res.error, hint: 'Check RESEND_API_KEY and EMAIL_FROM in Vercel, and that the domain is verified in Resend' },
    { status: res.ok ? 200 : 500 }
  );
}
