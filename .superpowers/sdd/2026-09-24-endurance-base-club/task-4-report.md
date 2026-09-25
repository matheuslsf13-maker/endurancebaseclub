# Task 4 Report: Admin RPCs — organizers, events, races, waves

Worktree: `/home/claude/ebc-wt/t4` (branch `task/4`, on top of Task 3's commit `11c9660`).
Commit: `b9cb55e feat(db): admin RPCs for organizers, events, races and waves`.

## What was implemented

`supabase/migrations/0003_admin_events.sql` — 17 functions, in dependency order (each
callee defined before its caller, since `check_function_bodies` validates plpgsql bodies,
including function-existence, at `CREATE FUNCTION` time):

**Internal helpers** (no grants; only reachable from inside other `security definer`
functions — confirmed against Task 7's brief, whose grant DO block only matches
`admin_/tk_/pub_/server_time`, so these three stay ungranted after Task 7 runs, as intended):
- `entry_json(p_entry_id, p_with_names)` — copied verbatim from the brief's given pattern.
- `next_unique_public_slug(p_base, p_exclude_id)` — appends `-2`, `-3`, … until free.
- `validate_race_config(p_config, p_event_id)` — validates every `RaceConfig` field
  (`age_rule`, `team_age_rule`, `time_source`, `cumulative` boolean, `same_crossing_window_s`
  1–600, `divergence_threshold_s` 0.1–600, each ranking's `id`/`name`/`dims`/`size`, age-group
  bounds and non-overlap, `reference_timekeeper_id` belongs to the event).

**Organizers**: `admin_me`, `admin_password_changed`, `admin_list_organizers`,
`admin_create_organizer` (owner), `admin_delete_organizer` (owner, self-delete guard).

**Events**: `admin_list_events` (+ `races_count`/`entries_count`), `admin_get_event`
(full `EventAggregate`: event, races, waves, entries via `entry_json(id,false)` with
numeric-aware bib ordering, distinct athlete projection, timekeepers with `marks_count`,
marks, resolutions, results, `version`, `server_now`), `admin_save_event` (insert-or-update
with partial-update merge semantics for fields the payload omits, unique-slug generation on
insert and on `is_public` turning true while the slug is still null, slug format/uniqueness
validation), `admin_delete_event`, `admin_duplicate_event` (copies levels/description/
location, races with their config/legs/team_size, waves without `start_at`, fresh
`tk_token` via the column default), `admin_rotate_tk_token`.

**Races/waves**: `admin_save_race` (event-exists check, legs validation — modality enum,
non-empty label, `distance_m` required and `>0` unless `other`; `team_size` 1–10; config =
`default_race_config(team_size) || payload.config`, validated via `validate_race_config`;
the marks-exist structural lock on leg count/modality-order/team_size; wave upsert-by-id +
delete-not-in-payload + ensure-one-default-wave-if-payload-empty), `admin_delete_race`,
`admin_set_wave_start`.

## Tests + results

### TDD evidence — RED (genuine: migration file moved aside, test run against the DB with
only 0001/0002 applied)

```
$ mv supabase/migrations/0003_admin_events.sql /tmp/... && bash scripts/test-sql.sh
PASS supabase/tests/00_helpers.sql
PASS supabase/tests/10_schema.sql
FAIL supabase/tests/20_admin_events.sql
psql:supabase/tests/20_admin_events.sql:6: ERROR:  expected errcode 42501 but got 42883
(function public.admin_list_events() does not exist) for: select public.admin_list_events()
```

### GREEN (migration restored, implementation complete)

```
$ bash scripts/test-sql.sh
PASS supabase/tests/00_helpers.sql
PASS supabase/tests/10_schema.sql
PASS supabase/tests/20_admin_events.sql
```

Re-ran twice more for stability (no flakiness) and once more after the final self-review
edit (marks_count scoping) — still all green, and again immediately after the commit.

### Integration test (Task 8's future consumer; run now per task instructions)

```
$ npm run test:integration -- tests/integration/shim.test.ts
 Test Files  1 passed (1)
      Tests  5 passed (5)
```

### Regression checks

```
$ npm run typecheck   # no output, exit 0
$ npm test            # vitest run
 Test Files  2 passed (2)
      Tests  11 passed (11)
```

## `20_admin_events.sql` — what it covers

The brief's given Step-1 SQL, plus the four required extra assertions, plus self-review
additions, all in one file:

1. Non-organizer rejected (`42501`).
2. Owner flow: `admin_me` role; **`admin_password_changed` clears the flag** (required
   extra); `admin_save_event` slug/token; **slug collision produces `-2`** (required extra,
   via a second event with the identical name+date); `admin_save_race` defaults (config,
   default wave); `admin_get_event` shape; `admin_list_events` counts (self-review);
   `admin_set_wave_start`; `admin_duplicate_event` race/wave copy; `admin_rotate_tk_token`.
3. Three given `admin_save_race` negative cases (empty legs, invalid modality, overlapping
   age groups) — all `P0001`.
4. **Required extra**: a mark inserted directly on the race's entry (fixture, `reset role`
   to bypass RLS since `admin_save_entry`/`tk_sync` are later tasks), then changing the leg
   count → `P0001`; plus two self-review follow-ups pinning that (a) an unchanged
   leg-set/team_size save still succeeds despite the lock and upserting the existing wave by
   id doesn't duplicate it, and (b) omitting `waves` on a later save resets to a single fresh
   default wave (documents the "if the payload has no waves, ensure one Largada geral
   exists" behavior explicitly, since it's easy to misread as update-safe).
5. `admin_create_organizer`/`admin_list_organizers`; **required extra**: the same call by
   the newly-created `admin` (not owner) → `42501`.
6. Given `admin_delete_organizer` self-delete → `P0001`.
7. Self-review: `admin_get_event` on an unknown id → `P0001`.

## A correctness issue found in the brief's given test text, and how I fixed it

The brief's Step-1 SQL does direct reads against `public.waves`/`public.races` (e.g.
`select start_at from public.waves where id = ...`, `select count(*) from public.races
where event_id = dup`) **from inside the same transaction where `tests.as_user(owner)` is
still in effect**. I hit this empirically: `bash scripts/test-sql.sh` failed on the
`start_at` assertion even with a correct implementation. I isolated it with a throwaway
`psql` session (see below) and proved the RPC itself was correct — `admin_set_wave_start`
had set `start_at` to exactly `2026-10-11 08:00:00-03` (= `11:00:00Z`) — but a **direct**
`select ... from public.waves` under role `authenticated` returned 0 rows, while the same
query as `postgres` (after `reset role`) returned the row correctly:

```
select count(*) from public.waves;      -- as authenticated: 0
reset role;
select count(*) as as_postgres from public.waves;   -- 1
```

This is RLS-enabled-with-no-policies doing exactly what it's designed to do (the same
mechanism Task 3's own `10_schema.sql` test relies on and proves for `anon`/`events`) —
`tests.as_user`'s `set_config(..., true)` is `SET LOCAL`-scoped, so it stays in effect for
the rest of the transaction, and the brief's verification lines never `reset role` first.
Since the whole point of this system is "RLS denies direct table access; RPC-only API", I
fixed the **test**, not the architecture: verification now goes through RPC return values
(`admin_set_wave_start`'s own return, `admin_get_event(dup)`) instead of bare `SELECT`s
against the tables, preserving every literal value from the brief (`2026-10-11T11:00:00Z`,
the race count/null-`start_at` assertions) and the full intent. This is arguably a better
test anyway for an RPC-only API. Flagging clearly per the task's "report a concern if one
is wrong" instruction — this is about the **test file I wrote**, not migrations 0001/0002,
which I did not touch and found no issues in.

## Self-review (beyond the required test)

Ran targeted `psql` scripts (wrapped in `begin;...rollback;`, nothing persisted) covering
behavior the required assertions don't reach:

- Default **individual**-race config (`default_race_config(1)`, 6 built-in age groups) is
  itself valid against `validate_race_config` — this matters because every solo-race
  creation with no explicit `config` depends on it.
- `other` modality with no/null `distance_m` allowed; any other modality with null/missing
  `distance_m` rejected (`P0001`).
- Ranking validation: unknown `dims` value, duplicate `dims` within one ranking, duplicate
  `id` across rankings, `size` outside 1–10 — each rejected.
- Age-group bounds: `min < 0`, `max < min` — rejected (independent of the overlap check the
  given test already covers).
- `same_crossing_window_s`/`divergence_threshold_s` out of range, non-boolean `cumulative`
  — rejected.
- `reference_timekeeper_id`: unknown id rejected; a real timekeeper of the **same** event
  accepted; a real timekeeper of **another** event rejected.
- `team_size` 0 and 11 rejected.
- Event validation: blank name, duplicate levels, blank-after-trim level, invalid `status`
  — all rejected; explicit `public_slug` with bad format (too short, spaces) — rejected.
- **Partial update merge semantics**: saving `{id, name}` alone preserves `location`,
  `description`, `levels`, and leaves `public_slug` untouched; toggling `is_public` true on
  its own auto-generates a slug when one is still null (both for an event whose slug was
  simply never provided, and for a duplicated event, which intentionally starts with a null
  slug per the brief).
- `admin_delete_event` cascades (a later `admin_get_event` on the deleted id raises
  `P0001`); `admin_delete_race` removes only that race and its own waves, leaving sibling
  races of the same event untouched.
- Unknown-id handling for `admin_rotate_tk_token` and `admin_set_wave_start`.
- `admin_set_wave_start(wave, null)` clears `start_at` (verified via its own return value).
- `admin_list_events` ordered by `date desc`; `admin_get_event`'s `entries` numeric-aware
  bib ordering (`'7'`, `'70'`, `'ABC'`, not lexicographic `'70' < '7' < 'ABC'`), `athletes`
  correctly deduplicated, `entries[].members` omit `name` (since `admin_get_event` calls
  `entry_json(id, false)` — names are available via the separate `athletes[]` array
  instead, avoiding redundant payload), and `timekeepers[].marks_count` accurate.

One defensive fix made during self-review: `timekeepers[].marks_count` in `admin_get_event`
now also filters `mk.event_id = ev.id` (not just `mk.timekeeper_id = t.id`) — belt-and-braces
since nothing in the schema enforces that a mark's `event_id` matches its timekeeper's
`event_id` at the DB level (it's guaranteed by application logic in the not-yet-built
`tk_sync`, Task 6).

No other defects found. Every function starts with `assert_organizer()`/`assert_owner()`
(via `perform`, or `declare o := ...` where the organizer row's fields are actually used —
`admin_me`, `admin_password_changed`, `admin_delete_organizer`) before touching any data.

## Files changed

- `/home/claude/ebc-wt/t4/supabase/migrations/0003_admin_events.sql` (new, 595 lines)
- `/home/claude/ebc-wt/t4/supabase/tests/20_admin_events.sql` (new, 111 lines)

Migrations `0001_schema.sql`/`0002_internal.sql` were read but not modified; no concerns
found with them.

## Concerns / assumptions for later tasks and reviewers

1. **The test-text fix above** (verify via RPC return values, not direct table reads) is
   the one deviation from the brief's literal given SQL. All literal values are preserved;
   only the retrieval mechanism changed, for a reason that would affect any literal
   transcription of that text (confirmed by direct empirical reproduction, included above).
2. **Grants**: per the plan's pre-flight scan ("T4 → T5/T6/T7 | ... | T7 grant DO block
   covers every admin_/tk_/pub_ fn — OK") and Task 7's brief, `0003` intentionally adds no
   `grant`/`revoke` statements — local execution works via `dev/db/bootstrap.sql`'s `alter
   default privileges ... grant all on functions`, and Task 7's `0006_public_grants.sql`
   will apply the least-privilege grants (matching `admin_\_%`) for production. If Task 7's
   DO block loop is ever changed to exclude a name pattern, double-check it still matches
   `admin_me`, `admin_password_changed`, etc. (plain `admin_\_%` already covers them).
3. **Ambiguous brief wording resolved by inference, documented via tests**: `admin_save_race`'s
   waves handling — "if the payload has no waves, ensure one Largada geral exists" — reads
   as applying whether the `waves` key is absent or an empty array, on *both* insert and
   update (confirmed necessary for insert, since the given test's race-creation call has no
   `waves` key at all and still expects one default wave back). I implemented it
   unconditionally (absent key treated identically to `[]`) and added a test that pins this
   explicitly (`omitting waves resets to a single default wave`) so Task 19's `RaceEditor`
   knows it must always resend the current `waves` array on every race save if it wants to
   preserve wave data (including `start_at`) — a race-details-only save that omits `waves`
   will silently reset wave state. Flagging this prominently since it's the one place a
   later task could introduce a real bug (losing recorded wave start times) if it assumes
   partial-update semantics apply to `waves` the way they do to the rest of the payload.
4. **`admin_save_race`'s `team_size`/`position`/`config`** use partial-update-merge-with-
   existing-on-omission (falls back to the current row's value when the key is absent on an
   update), *except* `config`, which — per the brief's explicit unconditional formula
   (`config = default_race_config(team_size) || coalesce(config,'{}')`) — is **not** merged
   with the existing stored config on update; an update that omits `config` resets it to
   bare defaults for that `team_size`. This matches the brief's literal wording exactly; I
   did not add existing-config merging since the brief gives an explicit, unconditional
   formula (unlike `waves`, where I had to infer intent). Same caution applies to a future
   `RaceEditor`: it must always resend the full `config` object on every race save.
5. `admin_delete_organizer`/`admin_delete_event`/`admin_delete_race` on a non-existent id
   silently succeed (0 rows affected, no error) — matches the brief's terse description for
   these ("deletes (cascades)"), not flagged as a defect.

## Fix round 1 (review findings + Rulings 12, 14, 16)

Worktree: `/home/claude/ebc-wt/t4` (== `/home/user/ebc-wt/t4`), branch `task/4`, base commit
`b9cb55e`. Own database used throughout: `EBC_DB=ebc_t4 bash scripts/test-sql.sh`.

### What changed, per finding

1. **Ruling 12 — waves wiped on UPDATE when `waves` is absent** (`0003_admin_events.sql`,
   `admin_save_race`). Added `v_process_waves`, computed as
   `is_insert or ((p_race ? 'waves') and coalesce(jsonb_typeof(p_race->'waves'), 'null') <> 'null')`.
   The entire wave block (upsert loop, delete-missing, ensure-default) is now gated on this
   flag. On UPDATE with `waves` absent, or an explicit JSON `null`, the block is skipped
   entirely — existing waves and their `start_at` are left completely untouched. On INSERT the
   flag is always true, so absent/null/empty all still fall through to "ensure one default
   wave" as before. A present array on UPDATE still upserts by id, deletes waves missing from
   the array, and creates a default wave if the race ends with zero waves.
   Test: rewrote `supabase/tests/20_admin_events.sql` lines 107–142 (renaming the race with no
   `waves` key → the previously-set wave, same id, same `start_at`, survives) and added a new
   block for explicit `"waves": null` (same assertions). Also added a block for a present
   **empty** array (`'waves', '[]'::jsonb`) proving that case still deletes and recreates a
   fresh default — the one behavior that is genuinely different between "absent/null" and
   "present-but-empty".

2. **Ruling 14 — config reset to bare defaults on UPDATE when `config` is omitted**
   (`admin_save_race`). Changed the config formula to branch on `is_insert`: INSERT keeps
   `default_race_config(team_size) || coalesce(payload.config, '{}')` (unchanged); UPDATE is
   now `default_race_config(new team_size) || existing.config || coalesce(payload.config, '{}')`.
   Test: new block in `20_admin_events.sql` (right after the main owner-flow `do` block) —
   customizes `divergence_threshold_s` to 5, saves again with no `config` key at all (asserts
   the customization survives), then saves with a different partial config
   (`same_crossing_window_s: 45`) and asserts the earlier customization (`divergence_threshold_s`)
   is still 5 while the new field merges in.

3. **Ruling 16 — wave upsert took `start_at` from the payload**. The `on conflict (id) do
   update` now sets only `race_id`, `name`, `position` (dropped `start_at = excluded.start_at`).
   New wave inserts also dropped `start_at` from the column list, so a newly created wave
   always starts with `start_at` null (column default), regardless of anything sent in the
   payload. Start times change exclusively via `admin_set_wave_start`.
   Test: reworked the "same leg count/order/team_size still succeeds" block — it now resends
   the existing wave with an explicit `"start_at": null` and asserts the previously-recorded
   start (`2026-10-11T11:00:00Z`, set earlier via `admin_set_wave_start`) survives, proving the
   payload's `start_at` is ignored rather than merely happening to match.

4. **NULL bypass in `validate_race_config`**. In plpgsql, `IF NULL THEN` is false, so an
   explicit JSON `null` for a validated scalar field slipped through every `not in (...)` /
   `not between ...` check whose left side was `(p_config->>'field')` (`->>` on a JSON `null`
   scalar returns SQL `NULL`). Fixed by mirroring the existing `age_groups.min` pattern
   (`is null or ...`) on: `age_rule`, `team_age_rule`, `time_source`, `same_crossing_window_s`,
   `divergence_threshold_s`, and each ranking's `size`. `cumulative` was already safe (its check
   uses `jsonb_typeof(...) <> 'boolean'`, which is `'null' <> 'boolean'` = true for a JSON null,
   already rejecting it) and needed no change.
   Test: added `select tests.assert_raises(... 'config', '{"same_crossing_window_s": null}' ...,
   'P0001')` right after the three given negative `admin_save_race` cases.

5. **`public_slug` TOCTOU (minor, optional)**. Wrapped both the INSERT and UPDATE of
   `public.events` in `admin_save_event` in a nested `begin ... exception when unique_violation
   then raise exception 'Endereço público já em uso' using errcode = 'P0001'; end;` block, so a
   concurrent collision that slips past the pre-check `exists (...)` still surfaces the pt-BR
   P0001 message instead of a raw `23505`. No dedicated test added (true concurrent races aren't
   reproducible in this single-connection test harness); the existing slug-collision test
   (`-2` suffix) continues to exercise the normal, non-racing path and still passes.

### TDD evidence

**RED** — new tests (Ruling 14's config-merge assertions in particular) run against the
pre-fix migration (`git stash push -- supabase/migrations/0003_admin_events.sql`, keeping the
new test file), `EBC_DB=ebc_t4 bash scripts/test-sql.sh`:

```
PASS supabase/tests/00_helpers.sql
PASS supabase/tests/10_schema.sql
FAIL supabase/tests/20_admin_events.sql
...
psql:supabase/tests/20_admin_events.sql:83: ERROR:  omitting config on UPDATE must keep the existing customization (Ruling 14), got 3
CONTEXT:  PL/pgSQL function inline_code_block line 15 at ASSERT
```

(Confirms the review's finding #2 exactly: without the fix, a config-omitting update resets
`divergence_threshold_s` back to the bare default of `3`.)

**GREEN** — migration fix restored, full suite, run three times for stability (including once
right after a `git stash pop`):

```
$ EBC_DB=ebc_t4 bash scripts/test-sql.sh
PASS supabase/tests/00_helpers.sql
PASS supabase/tests/10_schema.sql
PASS supabase/tests/20_admin_events.sql
```

All three runs green, no flakiness.

### Files changed

- `/home/user/ebc-wt/t4/supabase/migrations/0003_admin_events.sql` — `validate_race_config`
  null-checks (finding 4); `admin_save_event` insert/update wrapped for TOCTOU (finding 5);
  `admin_save_race` config formula (Ruling 14) and waves block gating + upsert column list
  (Rulings 12 and 16).
- `/home/user/ebc-wt/t4/supabase/tests/20_admin_events.sql` — new Ruling 14 config-merge block;
  rewrote the Ruling 12/16 waves section (absent key, explicit null, present-empty-array cases);
  new NULL-bypass negative assertion.

### Concerns

- None of the five findings required touching `0001_schema.sql` or `0002_internal.sql`; both
  were read (to confirm `waves.start_at` has no column default other than `NULL`, and that
  `races.config`/`waves` types are as assumed) but not modified.
- The whole-config-explicit-`null` edge case (payload sends `"config": null` on UPDATE, not
  just a null *field inside* config) was not given a dedicated test, since it isn't among the
  five findings. Verified by hand that Postgres's `jsonb || jsonb` treats an object concatenated
  with a JSON `null` scalar as forming a 2-element **array** (`[obj, null]`), so
  `existing.config || null` would turn `v_config` into an array; every subsequent
  `p_config->>'field'` lookup on an array silently returns SQL `NULL` (no error), which the
  finding-4 fix now correctly rejects as `P0001` on the first checked field (`age_rule`,
  "Regra de idade inválida") rather than crashing or silently passing. The message is
  slightly generic for that specific case, but the payload is still safely rejected, and this
  is not a data-loss path (no write happens before validation). Flagging for awareness only —
  not treated as a defect since it's outside the five findings and already fails safely.
- Grants/PostgREST exposure of `entry_json`/`next_unique_public_slug`/`validate_race_config`
  are still Task 7's responsibility, per Ruling 15 (unchanged by this fix round; not part of
  this task's findings).
