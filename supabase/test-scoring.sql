-- =====================================================================
-- TFK PREDICTIONS — scoring self-test
-- Run this in the Supabase SQL Editor AFTER phase2.sql.
-- It touches no tables and writes nothing. It runs the exact CASE
-- expression used inside score_gameweek() against known cases.
-- Every row must say PASS.
-- =====================================================================
with cases(label, ph, pa, rh, ra, cap, expected) as (values
  ('exact home win',                 2,1, 2,1, false, 4),
  ('right outcome, wrong score',     2,1, 3,0, false, 2),
  ('wrong outcome',                  2,1, 0,1, false, 0),
  ('predicted win, it was a draw',   2,1, 1,1, false, 0),
  ('exact draw',                     1,1, 1,1, false, 4),
  ('draw outcome, wrong score',      1,1, 2,2, false, 2),
  ('exact away win',                 0,2, 0,2, false, 4),
  ('away outcome, wrong score',      0,2, 1,3, false, 2),
  ('exact 0-0',                      0,0, 0,0, false, 4),
  ('CAPTAIN exact',                  2,1, 2,1, true,  8),
  ('CAPTAIN outcome',                2,1, 3,0, true,  4),
  ('CAPTAIN miss (0 doubled is 0)',  2,1, 0,1, true,  0),
  ('CAPTAIN exact draw',             1,1, 1,1, true,  8),
  ('CAPTAIN badly wrong',            5,0, 0,5, true,  0)
),
calc as (
  select
    label,
    expected,
    case
      when ph = rh and pa = ra
        then 4 * (case when cap then 2 else 1 end)
      when sign(ph - pa) = sign(rh - ra)
        then 2 * (case when cap then 2 else 1 end)
      else 0
    end as points,
    (ph = rh and pa = ra) as is_exact,
    (sign(ph - pa) = sign(rh - ra) and not (ph = rh and pa = ra)) as is_outcome_only
  from cases
)
select
  label,
  points,
  expected,
  is_exact,
  is_outcome_only,
  case when points = expected then 'PASS' else 'FAIL' end as result
from calc;

-- Ceilings: one fixture maxes at 8, a ten-fixture gameweek at 44.
select 4 * 2 as max_one_fixture, (4 * 9) + (4 * 2) as max_gameweek;
