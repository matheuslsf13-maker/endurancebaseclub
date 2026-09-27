# Task 3 Report: Schema migration and internal functions

Worktree: `/home/claude/ebc-wt/t3` (branch `task/3`, on top of Task 2's commit `dd92d5e`).
Commit: `11c9660 feat(db): schema, internal helpers and auth user bootstrap`.

## What was implemented

- `supabase/tests/10_schema.sql` — the failing test from the brief's Step 1, copied verbatim.
- `supabase/migrations/0001_schema.sql` — all 11 `public` tables from spec §5 (`organizers`,
  `athletes`, `events`, `races`, `waves`, `entries`, `entry_members`, `timekeepers`, `marks`,
  `resolutions`, `results`), their indexes, and `public.random_token(int)`; RLS enabled on every
  table with no policies. Copied verbatim from the brief's Step 3.
- `supabase/migrations/0002_internal.sql` — all ten items from the brief's Step 4:
  1. `tg_set_updated_at()` + `before update` triggers on `athletes, races, waves, entries, marks, resolutions`.
  2. `tg_events_before_update()` (`updated_at` + conditional `version` bump) + trigger on `events`.
  3. `bump_event_version(p_event_id uuid)`.
  4. Per-table `after insert or update or delete` triggers calling `bump_event_version`: `races`
     (direct `event_id`), `waves` (looks up `event_id` via `race_id`→`races`), `entries` (direct
     `event_id`), `entry_members` (looks up via `entry_id`→`entries`); plus `after update on
     athletes` bumping every event the athlete has an entry in (via `entry_members`→`entries`).
  5. `slugify(p text)` — `lower()` + `translate()` (24 lowercase + 24 uppercase Portuguese
     accented characters → plain ASCII) + `regexp_replace('[^a-z0-9]+','-','g')` + trim `-`.
  6. `server_time()` — `clock_timestamp()` epoch ms.
  7. `assert_organizer()` / `assert_owner()` — copied verbatim from the brief.
  8. `internal_create_auth_user(p_email, p_password)` — copied verbatim from the brief.
  9. `bootstrap_owner(p_email, p_password, p_name)` — `security definer`, delegates to
     `internal_create_auth_user` then inserts the `owner` organizer row.
  10. `default_race_config(p_team_size int)` — individual (`team_size <= 1`): rankings
      `[geral, faixa]`, six age groups (`até 19` … `60+`); team (`> 1`): only `geral`, empty
      `age_groups`. Cross-checked byte-for-byte against Task 9's brief/tests (`presets.test.ts`
      assertions), which is the other consumer of these exact values.

Every function in `0002_internal.sql` carries `set search_path = public, extensions, pg_temp`
(per the brief's Step 4 preamble, "all functions"). `security definer` is used only where the
brief's given code shows it or where it's structurally required to bypass RLS/write `auth.users`
(`assert_organizer`, `assert_owner`, `internal_create_auth_user`, `bootstrap_owner`) — matching
the pattern already established by `random_token` in `0001` (no `security definer` there either).
Trigger functions don't need their own `security definer`: they run nested inside whatever
elevated context (table owner via a future `security definer` admin RPC, or superuser in tests)
performed the triggering DML, which I verified empirically (see Self-review).

## Tests + results

### TDD evidence — RED (captured live, before either migration file existed)

```
$ bash scripts/test-sql.sh
PASS supabase/tests/00_helpers.sql
FAIL supabase/tests/10_schema.sql
psql:supabase/tests/10_schema.sql:3: ERROR:  function public.bootstrap_owner(unknown, unknown, unknown) does not exist
LINE 1: select tests.set('owner', public.bootstrap_owner('Owner@EBC....
                                  ^
HINT:  No function matches the given name and argument types. You might need to add explicit type casts.
```

(This is the genuine first run against the test file with no migrations present — not a
reconstruction. `supabase/migrations/` held only `.gitkeep` at that point.)

### GREEN — after implementing both migrations

```
$ bash scripts/test-sql.sh
PASS supabase/tests/00_helpers.sql
PASS supabase/tests/10_schema.sql
```

Re-confirmed again after the commit (final run, same output as above).

### Integration test (Task 2's shim, now applying these migrations)

```
$ npm run test:integration -- tests/integration/shim.test.ts
 Test Files  1 passed (1)
      Tests  5 passed (5)
```

### Other regression checks

```
$ npm run typecheck   # tsc --noEmit -p tsconfig.json — no output, exit 0
$ npm test            # vitest run
 Test Files  2 passed (2)
      Tests  11 passed (11)
```
(These 2 files are Task 1's `format.test.ts`/`storage.test.ts`, untouched by this task — run to
confirm no collateral damage.)

## Self-review findings (beyond the given test)

I ran several additional manual checks directly against `ebc_test` (via `psql`, wrapped in
`begin; … rollback;` so nothing persisted) to probe things the given test doesn't exercise
directly, since `assert_organizer`/`assert_owner`/grants aren't touched by `10_schema.sql`:

1. **Exact version-bump delta (not just `>`).** The given test only asserts `version > v`, which
   wouldn't catch a double-bump bug. I traced a single event through race → wave → entry →
   entry_member insert, then an athlete update, then a direct `events` update — version went
   `1 → 2 → 3 → 4 → 5 → 6 → 7`, i.e. exactly +1 per operation, confirming
   `tg_events_before_update`'s guard (`if new.version = old.version`) correctly avoids a double
   increment when `bump_event_version` already set the new value in the same statement.
2. **`updated_at` across real transactions.** Within one `begin/rollback` block, `now()` is
   transaction-stable, so two updates in the same transaction showed identical `updated_at` —
   expected Postgres behavior, not a bug. Confirmed with two separate (autocommit) statements a
   second apart that `updated_at` does advance correctly, and `version` incremented too.
3. **`default_race_config(1)` and `(3)` full output**, and **`slugify` edge cases** (empty
   string, punctuation-only string, `São Paulo / SP`, `café com açúcar`) — all produced the
   expected shapes/strings (`sao-paulo-sp`, `cafe-com-acucar`, empty → empty).
4. **`assert_organizer`/`assert_owner` permission matrix** (not exercised by the given test at
   all): bootstrapped an owner and a second `admin` organizer, then via `tests.as_user(...)`
   confirmed: owner → both functions succeed with `role='owner'`; admin → `assert_organizer`
   succeeds (`role='admin'`), `assert_owner` raises `42501`; anon and an authenticated user with
   no organizer row → `assert_organizer` raises `42501`.
5. **`coalesce(new.col, old.col)` / `coalesce(new, old)` pattern in combined
   insert/update/delete triggers.** This is a known PL/pgSQL gotcha (NEW/OLD "not assigned" for
   the inapplicable operation), so I didn't trust memory — built a throwaway table+trigger in a
   scratch database and confirmed empirically that this idiom works correctly for row-level
   triggers across all three operations before relying on it for `races`/`waves`/`entries`/
   `entry_members`.
6. **EXECUTE grants for `anon`.** The given test never calls a plain utility function as `anon`
   (only the final RLS/`count` check runs under that role). I confirmed separately that `anon`
   can call `slugify`/`server_time`/`random_token` successfully, i.e. the `alter default
   privileges … grant all on functions` from Task 2's `dev/db/bootstrap.sql` correctly covers
   functions created in these new migrations (same creating role, so no explicit `grant` needed
   in `0001`/`0002`).

No defects found; no changes were needed as a result of self-review — it was confirmatory.

## Files changed

- `/home/claude/ebc-wt/t3/supabase/migrations/0001_schema.sql` (new)
- `/home/claude/ebc-wt/t3/supabase/migrations/0002_internal.sql` (new)
- `/home/claude/ebc-wt/t3/supabase/tests/10_schema.sql` (new)

No other files were touched. `supabase/migrations/.gitkeep` was left in place (harmless,
out of this task's file-ownership list).

## Concerns

- **Process note, not a code issue:** this run was interrupted mid-self-review by a transient
  "model temporarily unavailable" error on the Bash tool's safety classifier (not an API usage
  limit as the resume message assumed — the classifier itself was timing out on tool-call
  approval, confirmed by plain `echo`/`cd` still working while `psql` calls failed, then
  recovering on retry). No work was lost: the commit had not yet been attempted successfully at
  that point, and the RED output above is the original capture from earlier in the same session,
  not reconstructed. On resume I re-verified both test suites GREEN, finished the one
  in-progress self-review check (EXECUTE grants for `anon`), and committed.
- `bump_event_version`, the per-table `tg_*_bump_event_version` trigger functions, and
  `tg_set_updated_at`/`tg_events_before_update` are intentionally **not** `security definer`
  (only `assert_organizer`, `assert_owner`, `internal_create_auth_user`, `bootstrap_owner` are,
  matching the brief's explicit code and mirroring `random_token`'s precedent in `0001`). This is
  correct as long as every future write path to these tables is a `security definer` `admin_*`/
  `tk_*` RPC owned by the same role that owns the tables (per contracts.md's SQL conventions,
  which later tasks are expected to follow) — direct, non-`security definer` DML from
  `authenticated`/`anon` would have its triggers run under that caller's own (RLS-restricted)
  privileges. Flagging so later tasks (0003+) keep all mutating RPCs `security definer`.
- On a cascading delete (e.g. deleting a `race`, which cascades to `waves`), the `waves` trigger's
  lookup of `event_id` via `race_id → races` can return `NULL` if the parent `races` row is
  already gone by the time the cascade fires; `bump_event_version(NULL)` is then a harmless
  no-op (matches zero rows), and the `races` table's own `AFTER DELETE` trigger already bumped
  the event's version once for that deletion. Not exercised by any test (brief doesn't ask for
  one), verified safe by reading the trigger logic; noted for awareness only.
- `default_race_config`'s values were cross-checked against Task 9's brief/tests (the other
  consumer of the same source values) rather than Task 9's actual TS source, since Task 9 lives
  on a separate branch/worktree — the brief and its committed test assertions matched my SQL
  output exactly, including array order (`geral` then `faixa`) and every age-group boundary.

## Report

Full report at:
`/home/claude/endurance-base-club/.superpowers/sdd/2026-09-24-endurance-base-club/task-3-report.md`
