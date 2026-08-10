# TFK Predictions League — Phase 1

Premier League 2026/27 predictions league. Next.js + Supabase, deploys to Vercel.

**Phase 1 delivers:** accounts and login, the full 380-fixture import from the Premier
League feed, prediction entry with captain selection, and every deadline rule enforced
in the database.

**Phase 2 (next):** results polling, scoring, season/monthly/gameweek leaderboards.
**Phase 3:** WhatsApp and CSV export, the three email automations, admin panel.

---

## Setup — about 30 minutes

You need the Supabase project and Vercel account you've already created, plus
tfkpredictions.com pointed somewhere you can edit DNS.

### 1. Load the database schema

Supabase dashboard → **SQL Editor** → **New query**. Paste the whole of
`supabase/schema.sql`, run it. It's idempotent, so re-running it is safe.

This creates the tables, the row level security policies, and — most importantly —
the two functions that enforce the deadline rules. Those functions are the reason a
tampered browser can't save a late prediction.

### 2. Turn on email confirmation (optional but sensible)

Supabase → **Authentication → Providers → Email**. Leave "Confirm email" on.
Under **Authentication → URL Configuration**, set:

- Site URL: `https://tfkpredictions.com`
- Redirect URLs: `https://tfkpredictions.com/**` and `http://localhost:3000/**`

### 3. Environment variables

Copy `.env.example` to `.env.local` and fill it in from Supabase →
**Project Settings → API**:

| Variable | Where it comes from |
|---|---|
| `NEXT_PUBLIC_SUPABASE_URL` | Project URL |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | `anon` / `public` key — safe in the browser |
| `SUPABASE_SERVICE_ROLE_KEY` | `service_role` key — **server only, never commit** |
| `CRON_SECRET` | Any long random string you invent |
| `NEXT_PUBLIC_SITE_URL` | `https://tfkpredictions.com` |

> The service role key bypasses all security. Keep it out of git, out of Slack, and
> out of chat windows. If it ever leaks, rotate it in Supabase immediately.

### 4. Run it locally

```bash
npm install
npm run dev          # http://localhost:3000
```

### 5. Push to GitHub, then connect Vercel

```bash
git init
git add .
git commit -m "Phase 1"
git branch -M main
git remote add origin git@github.com:<you>/tfk-predictions.git
git push -u origin main
```

In Vercel: **Add New → Project**, import the repo, and add all five environment
variables under **Settings → Environment Variables** before the first deploy.
Then **Settings → Domains** → add `tfkpredictions.com`.

### 6. Import the season

Once deployed, run the fixture sync by hand the first time:

```bash
curl -H "Authorization: Bearer YOUR_CRON_SECRET" \
     https://tfkpredictions.com/api/cron/sync-fixtures
```

You should get back something like
`{"ok":true,"teams":20,"gameweeks":38,"fixtures":380}`.

After that `vercel.json` runs it automatically every night at 04:00. It has to run
nightly rather than once, because TV picks move kickoff times — and since the
deadline **is** the first kickoff, a moved fixture moves the deadline with it.

### 7. Make yourself an admin

Register through the app first, then in the Supabase SQL editor:

```sql
update profiles set is_admin = true
where id = (select id from auth.users where email = 'you@yourdomain.com');
```

---

## The deadline rules

These are implemented in `supabase/schema.sql` (`save_prediction`, `set_captain`) and
mirrored for the UI in `src/lib/locks.ts`. The database is the source of truth.

1. **Before the deadline** — which is the first kickoff of the Gameweek — everything
   is editable, as often as you like.
2. **After the deadline**, a fixture is editable only if **both**:
   - you had *not* already saved a pick for it before the deadline, **and**
   - it hasn't kicked off yet.
3. **The captain locks hard at the deadline.** Miss it and you play the week without one.

Rule 2 is a small refinement of "only players who submitted nothing get the late
window". Basing it per fixture rather than per entry avoids a perverse outcome: under a
strict entry-level rule, someone who saved eight of ten picks would be locked out
completely, while someone who saved nothing at all would get the late window. Per
fixture, everyone gets the same deal — the picks you committed are committed, the ones
you never made are still open until kickoff. Nobody can revise a pick after seeing a
result, which is the thing that actually matters.

Rule 3 is what closes the obvious exploit: without it, a player could wait until Sunday
evening, watch Saturday's results, and then captain a Monday night game.

## Scoring

| | Standard | Captained |
|---|---|---|
| Exact scoreline | 4 | 8 |
| Right result, wrong scoreline | 2 | 4 |
| Wrong result | 0 | 0 |

Exact replaces the outcome points rather than stacking on top. Maximum for a single
fixture is 8; maximum for a Gameweek is 44.

## Monthly prizes

A Gameweek belongs entirely to the month its **first** match is played in. GW9 opens
on Sat 31 October and finishes on Mon 2 November — the whole Gameweek counts towards
October. Ten monthly prizes, all of equal value regardless of how many Gameweeks fall
in the month. Computed in `src/lib/gameweeks.ts` and stored as `gameweeks.month_key`.

## Tests

```bash
npm test
```

Eight tests covering the lock rules at every boundary and the scoring engine.
Requires Node 22.18 or later (native TypeScript execution).

## Project layout

```
supabase/schema.sql            tables, RLS, and the lock-enforcing functions
src/lib/locks.ts               lock rules for the UI (mirrors the SQL)
src/lib/scoring.ts             points calculation — used from Phase 2
src/lib/gameweeks.ts           month assignment, crest URLs
src/lib/fpl.ts                 Premier League feed client
src/app/api/cron/sync-fixtures fixture import, runs nightly
src/app/(app)/predictions      the predictions board
src/components/AuthForm.tsx    register and sign in
src/middleware.ts              session refresh and route protection
```

## Notes

- Club crests come from `resources.premierleague.com`, keyed on each club's PL code.
  Before the season starts, consider downloading the twenty crests and serving them
  from `/public` instead — one less external dependency and a faster page.
- All times are stored in UTC and rendered in `Europe/London`.
- The predictions board saves as you go. There is no submit button, which removes a
  whole category of "I thought I'd saved it" arguments.
