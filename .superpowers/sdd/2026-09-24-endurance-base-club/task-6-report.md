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

## Fix round 1

Review verdict: "Needs fixes" (diff `d415c39..2bfd23f`). Commit
`45a2f9e fix(db): replay-safe tk_sync, organizer edit precedence, discriminating tests`
on `task/6`. Both changed files remain `supabase/migrations/0005_timing.sql`
and `supabase/tests/40_timing.sql`, per the fix instructions.

### 1. Spec gap: discriminating test for `admin_set_resolution`'s "mark" mode

The old test reused `mark_assigned` for the "mark from the wrong leg" P0001
case, but by that point in the file `mark_assigned` had already been
discarded (line 129 at the time) *and* unassigned (line 147), so the call
failed for the wrong reason — a mutation removing `and leg_index =
p_leg_index` from `admin_set_resolution` still passed.

Fix: added two purpose-built fixtures instead of reusing `mark_assigned`:
- `mark_leg0_discarded` — a discarded mark directly inserted on the
  *correct* leg (0), discriminating the `not discarded` predicate alone.
- `mark_unassigned` reassigned via `admin_update_mark` onto `(entry, leg 1)`
  — a genuinely non-discarded mark on the *wrong* leg, discriminating the
  `leg_index = p_leg_index` predicate alone.

Verified by mutation testing (temporarily edited, re-ran, restored):
```
$ sed -i '279s/.../.../ ' supabase/migrations/0005_timing.sql   # drop "and leg_index = p_leg_index"
$ EBC_DB=ebc_t6 bash scripts/test-sql.sh
...
ERROR: expected error P0001 but statement succeeded: ... mark_unassigned ...
```
```
$ # restore, then drop "and not discarded" instead
$ EBC_DB=ebc_t6 bash scripts/test-sql.sh
...
ERROR: expected error P0001 but statement succeeded: ... mark_leg0_discarded ...
```
Both mutations were caught (the corresponding new test failed); the
migration was restored to the identical original (`diff` confirmed) before
committing.

### 2. Ruling 27 — organizer edits must win over stale timekeeper replays

Added `marks.org_edited boolean not null default false`. `admin_update_mark`
now sets it to true whenever the update actually changes `entry_id` or
`leg_index` (comparing against the row's current stored values — a
discard-only patch, or a patch that resolves to the same values, does *not*
flip it). `tk_sync`'s existing-row branch now checks: if `org_edited` is
true and the incoming payload disagrees with the current stored
`entry_id`/`leg_index`/`athlete_id`/`discarded` in any way, the mark is
rejected with `Alterada pela organização` and nothing changes; if the
payload matches exactly, it's accepted (idempotent). This sits after the
existing ownership check and before the existing discard check, so it
doesn't change behavior for marks the organizer has never repositioned.

Test: registers a third timekeeper (Carla), sends a mark on leg 1, then (as
owner) moves it to leg 0 via `admin_update_mark` (asserting `org_edited`
flips to true) and pins a `mode='mark'` resolution to it there. Carla's
device then replays its *original* leg-1 payload — asserted rejected with
`Alterada pela organização`, and both the mark's `leg_index` (via
`admin_live`) and the resolution (via `admin_live`) are asserted intact
afterward. A final re-send matching the *current* (leg 0) state is asserted
accepted.

### 3. Ruling 28 — tk_sync robustness

(a) The new-mark `insert` now ends `on conflict (id) do nothing`; if it
loses a race (0 rows affected), the code re-selects the row and falls
through to the existing-row path (ownership + idempotent update) instead of
letting a unique-violation escape as a raw rejection.

(b) Optional hint/audit fields never reject a mark: `device_ts`,
`clock_offset_ms`, `clock_rtt_ms` and `athlete_id` are each cast inside
their own nested `begin/exception` block that falls back to `null` on any
error; `clock_offset_ms`/`clock_rtt_ms` are additionally rounded to the
nearest integer (Postgres `round(numeric)` rounds half away from zero, so
`12.5 → 13`); an `athlete_id` that isn't a member of the target entry (or
there is no entry) is nulled via an `entry_members` membership check. `ts`
remains strictly validated exactly as before (±48h of the wall clock).

(c) The per-mark `exception` block now has two arms: `when sqlstate
'P0001'` (all of the function's own validation raises default to P0001)
appends to `rejected` as before; `when others` does nothing, leaving that
mark out of both `accepted` and `rejected` so the device's outbox keeps it
`pending` and retries next cycle rather than showing a raw/English error.

Tests: (a) directly inserts a mark row owned by Beto (simulating a
concurrent send that already landed) and confirms `tk_sync` sending the
same id is accepted with 0 rejected. (b) sends a mark with
`clock_offset_ms: 12.5` and a random, non-member `athlete_id`; asserts it's
accepted and, from the returned `marks` delta, that `clock_offset_ms = 13`
and `athlete_id` is null.

### 4. Ruling 29 — `tk_open` must not expose `notes`

`tk_open`'s `entries` projection is now `entry_json(en.id, true) - 'notes'`
(status/level/penalty_ms untouched). Test: added `notes` to the fixture
entry, asserted `tk_open`'s entry still has `status` but the `notes` key
is entirely absent (`not (... ? 'notes')`).

### RED

Ran the full suite with the new/changed assertions against the
*unmodified* (pre-fix) migration:

```
$ EBC_DB=ebc_t6 bash scripts/test-sql.sh
PASS supabase/tests/00_helpers.sql
PASS supabase/tests/10_schema.sql
PASS supabase/tests/20_admin_events.sql
PASS supabase/tests/30_admin_athletes_entries.sql
FAIL supabase/tests/40_timing.sql
...
ERROR: tk_open entries must not expose the organizer-only notes field
```

### GREEN

After applying all four fixes to `0005_timing.sql` (plus one test-only
ordering fix — a role switch back to the owner was missing before the
finalize-race section, since the new Ruling-28 tests end `as_anon`):

```
$ EBC_DB=ebc_t6 bash scripts/test-sql.sh
PASS supabase/tests/00_helpers.sql
PASS supabase/tests/10_schema.sql
PASS supabase/tests/20_admin_events.sql
PASS supabase/tests/30_admin_athletes_entries.sql
PASS supabase/tests/40_timing.sql
```

Ran twice more after committing to confirm stability.

### Files changed (fix round 1)

- `/home/user/ebc-wt/t6/supabase/migrations/0005_timing.sql` (+87/-21):
  new `marks.org_edited` column; `tk_open` hides `notes`; `tk_sync`
  rewritten for replay-safety/robustness (org_edited check, `on conflict do
  nothing` fallthrough, hint-field sanitization, split P0001/others
  exception handling); `admin_update_mark` computes and persists
  `org_edited`.
- `/home/user/ebc-wt/t6/supabase/tests/40_timing.sql` (+144/-21 net): fixed
  the discriminating-test gap; added Ruling 27 replay-safety scenario,
  Ruling 28a/28b robustness cases, and the Ruling 29 `notes`-hiding
  assertion; bumped the `admin_live` marks-count assertion from 3 to 4 (one
  extra fixture mark).

### Concerns

None blocking. All four required findings addressed and covered by tests
that fail without the fix (RED) and pass with it (GREEN); the two
mutation-tested predicates were separately confirmed to catch their
respective mutations. Minor findings from the review were left as-is per
the fix instructions (deferred to the final review).
