# Task 6 report — Timing RPCs (organizer live tools + timekeeper link)

## Status: DONE

Branch `task/6` in `/home/user/ebc-wt/t6`, commit `2bfd23f`
("feat(db): timing RPCs for organizers and timekeeper links").

## What was implemented

`supabase/migrations/0005_timing.sql` (318 lines), owning exactly the two
files listed in the brief:

1. **`tk_event(p_token)`** (internal) — resolves the event for a
   `tk_token`/`tk_enabled` pair or raises `Link de cronometragem inválido ou
   desativado` (P0001). Used by all three `tk_*` endpoints below, none of
   which call `assert_organizer()` — they gate on the token instead.
2. **`tk_open(p_token)`** — the `TkSession` snapshot: event
   `{id,name,date,location}`, races, waves, `entries` via
   `entry_json(id, true)` (so member names are included), timekeepers
   `{id,name}`, `version`, `server_now`.
3. **`tk_register(p_token, p_name, p_device_label)`** — trims/validates the
   name (1..60 chars, else `Informe seu nome`), inserts a timekeeper with a
   32-char `random_token` secret, returns `{timekeeper_id, secret}`.
4. **`tk_sync(...)`** — copied **byte-for-byte** from the brief (diffed
   programmatically against the brief's fenced code block to confirm; see
   below). Per-mark: id-not-found → insert (ts validated against the wall
   clock ±48h, `Horário inválido` otherwise); id-found → update only if the
   requesting timekeeper owns it (`Marcação pertence a outro cronometrista`)
   and it isn't organizer-discarded while the incoming payload tries to
   un-discard it (`Descartada pela organização`); `ts` is never touched on
   update (immutable). Each mark is wrapped in its own `begin/exception` so
   one bad row doesn't block the batch; results come back as
   `{accepted, rejected, server_now, version, marks (delta), waves (all)}`.
5. **`admin_live(p_event_id, p_since)`** — `server_now`, `version`, marks as
   a delta (`updated_at >= p_since`, or all when `p_since` is null), and
   resolutions/waves always in full (so deletions propagate too, matching
   the "Live endpoints" note in contracts.md).
6. **`admin_update_mark(p_mark_id, p_patch)`** — `entry_id` present & null →
   unassign (also clears `leg_index`); non-null → entry must be of the same
   event, and `leg_index` is required either from the patch or kept from the
   existing row (only when the entry is unchanged), validated
   `0 <= leg_index < legs length` (`Perna inválida`); `discarded: true` →
   `discarded_by='organizer'`, `false` → both cleared. Returns the full mark
   row.
7. **`admin_set_resolution`/`admin_clear_resolution`** — validates
   `leg_index` against the entry's race; `mark` mode requires a
   non-discarded mark with matching `entry_id`/`leg_index`
   (`Marcação não pertence a esta passagem`); `manual` requires
   `p_manual_ts`; upserts on `(entry_id, leg_index)` with
   `decided_by = auth.uid()` (via `assert_organizer()`'s returned row).
8. **`admin_update_timekeeper(p_timekeeper_id, p_patch)`** — optional
   `name`/`active`; returns the row with `to_jsonb(t) - 'secret'` so the
   secret never leaves the server after registration.
9. **`admin_finalize_race`/`admin_unfinalize_race`** — replaces a race's
   `results` with the client-computed snapshot rows (validating each
   `entry_id` belongs to the race), sets/clears `races.finalized_at`, and
   returns `{finalized_at, count}` / raises on an unknown race id
   (consistent with `admin_set_wave_start`'s "0 rows updated" pattern
   elsewhere in the codebase).

No grants were added (Task 7's job, per the brief); nothing outside
`0005_timing.sql`/`40_timing.sql` was touched — `0003`/`0004` and the other
test files are untouched.

## Tests

`supabase/tests/40_timing.sql` (223 lines), one `begin…rollback`, no psql
meta-commands. Fixture: one event, one relay race (swim leg 0 / run leg 1),
athletes A/B, a team entry bib 101 (A→leg 0, B→leg 1), wave start set. All
mark timestamps are anchored to a captured `t0 := now()` rather than to the
event's own date, since `tk_sync`'s ±48h validity window checks against the
real wall clock (see "found & fixed" below).

Covers every bullet in the brief's Step 1 list:
- `tk_open('errado')` → P0001 `Link de cronometragem%`; valid token → 1
  race, 1 entry with member `name`.
- `tk_register` blank name → P0001; valid name → 32-char secret.
- `tk_sync` wrong secret → P0001 `Cronometrista não autorizado`.
- Two-mark batch (assigned + unassigned) → 2 accepted, 2 in the `marks`
  delta.
- Re-send with a different `leg_index` → accepted, updated in place;
  re-send with a different `ts` → stored `ts` unchanged.
- `leg_index` 2 (out of range) → rejected `Perna inválida`; `ts` 3 days
  away → rejected `Horário inválido`.
- A second timekeeper resending the first one's mark → rejected
  `Marcação pertence a outro cronometrista`.
- `admin_update_mark(..., {"discarded":true})` → `discarded_by='organizer'`;
  timekeeper's own re-send with `discarded:false` → rejected
  `Descartada pela organização`.
- `admin_update_timekeeper(..., {"active":false})` → `tk_sync` now raises
  P0001 `Seu acesso foi desativado%`.
- `admin_set_resolution` with a mismatched-leg mark → P0001
  `Marcação não pertence a esta passagem`; valid mark → row; `manual`
  without `p_manual_ts` → P0001; `admin_clear_resolution` removes it.
- `admin_live(event, null)` → all 3 marks, 1 resolution, 1 wave;
  `admin_live(event, now()+1h)` → 0 marks, still 1 wave.
- `admin_finalize_race(...)` → `count=1`, `races.finalized_at` set (checked
  via `admin_get_event`); `admin_unfinalize_race` clears both
  `finalized_at` and `results`.

Two small extras beyond the brief's minimum: `admin_update_mark` unassigning
a mark also clears `leg_index`, and `admin_update_timekeeper`'s returned row
never contains `secret` (both are explicit contract details worth pinning).

## TDD evidence

**RED** — moved `0005_timing.sql` aside and ran the suite:

```
$ EBC_DB=ebc_t6 bash scripts/test-sql.sh
PASS supabase/tests/00_helpers.sql
PASS supabase/tests/10_schema.sql
PASS supabase/tests/20_admin_events.sql
PASS supabase/tests/30_admin_athletes_entries.sql
FAIL supabase/tests/40_timing.sql
...
psql:supabase/tests/40_timing.sql:30: ERROR:  expected errcode P0001 but got 42883
  (function public.tk_open(unknown) does not exist) for: select public.tk_open('errado')
```

Restored the migration and re-ran — first attempt still failed (a real bug,
not just "function doesn't exist yet"):

```
psql:supabase/tests/40_timing.sql:66: ERROR:  expected 2 accepted, got 0
```

Root cause: my first draft of the fixture set the event date to a
fixed future date (`2026-10-11`) and used absolute ISO timestamps for the
marks. `tk_sync`'s `Horário inválido` check compares a new mark's `ts`
against the real wall clock (`now()`, ±172800s), not against the event's own
date — so timestamps 16 days out (today is 2026-09-25) were themselves
"too far away" and got rejected. Fixed by anchoring every timestamp in the
fixture to a captured `t0 := now()` and relative intervals instead.

**GREEN** — after the fix:

```
$ EBC_DB=ebc_t6 bash scripts/test-sql.sh
PASS supabase/tests/00_helpers.sql
PASS supabase/tests/10_schema.sql
PASS supabase/tests/20_admin_events.sql
PASS supabase/tests/30_admin_athletes_entries.sql
PASS supabase/tests/40_timing.sql
```

Ran the full suite twice more after committing to confirm pristine, stable
output (no stray NOTICE/WARNING).

## Files changed

- `/home/user/ebc-wt/t6/supabase/migrations/0005_timing.sql` (new)
- `/home/user/ebc-wt/t6/supabase/tests/40_timing.sql` (new)

## Self-review

- Diffed my `tk_sync` body against the brief's fenced code block
  programmatically (`diff` on the extracted `create or replace function
  ... end $$;` blocks) — **identical**, satisfying "implement it exactly."
- Every function signature matches the "Produces" list in the brief and
  contracts.md verbatim (parameter names/order/types).
- Conventions followed: `security definer`, `set search_path = public,
  extensions, pg_temp`, `p_`-prefixed params, pt-BR `P0001` validation
  errors, `stable` on the two read-only functions (`admin_live`, and
  `tk_event`/`tk_open` which it calls), plain (volatile) on every mutating
  one. No grants added (left for Task 7, per the brief).
- Checked no psql meta-commands in the test file (`grep '^\\'` → no match).
- Confirmed via `git status`/`git diff --stat` that only the two owned
  files were touched — `0003_admin_events.sql`/`0004_admin_athletes_entries.sql`
  and the other test files are untouched, respecting the other worktree's
  concurrent work on 0003.
- Re-read the whole test file after the `sed` fix to confirm no stray
  literal dates were left (`grep -n '2026-10-11'` only matches the
  explanatory comment, not code).

## Concerns

- None blocking. Two very minor, non-blocking observations for whoever
  builds on this:
  - `admin_unfinalize_race` raises `Prova não encontrada` for an unknown
    race id (mirroring `admin_set_wave_start`'s pattern for single-target
    updates); this is slightly stricter than the brief's minimal
    description but not tested against it by name, and is covered by an
    added test.
  - Non-organizer rejection (42501) for the new `admin_*` functions isn't
    re-tested here since it's entirely delegated to the already
    well-covered shared `assert_organizer()` helper (tested in
    `20_admin_events.sql`); flagging only for completeness, not as a gap.
