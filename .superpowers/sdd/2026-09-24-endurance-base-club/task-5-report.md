# Task 5 Report — Admin RPCs: athletes, import, profile, entries

## Environment note

The environment reminder for this session named `/home/claude/ebc-wt/t17` as the primary working
directory, but `t17` is a pre-existing worktree on branch `task/17` (unrelated, mid-review work).
The task instructions explicitly named `/home/claude/ebc-wt/t5` — a worktree already on branch
`task/5`, based on `task/4` at `b9cb55e`, exactly as described in the brief. All work was done in
`/home/claude/ebc-wt/t5`; `t17` and every other worktree were left untouched.

## What I implemented

`supabase/migrations/0004_admin_athletes_entries.sql` — ten functions, in this order:

1. `next_bib(p_event_id uuid) returns text` (internal) — `coalesce(max(bib::int) filter (bib ~ '^\d+$'), 0) + 1`.
2. `admin_list_athletes()` — every athlete plus `participations` (results with status not in `dns`/`not_started`), `wins` (`overall_pos = 1`), `podiums` (any `data->'podiums'` item with `podium_pos <= 3`), ordered by `lower(name)`.
3. `admin_save_athlete(p_athlete jsonb)` — insert/update; trims strings (empty → null), lowercases email, validates `sex` and `birth_date` (not future, year ≥ 1900).
4. `admin_delete_athlete(p_athlete_id uuid)` — blocks with `Atleta tem inscrições; remova-as antes de excluir` while the athlete has entries.
5. `admin_import_athletes(p_event_id uuid, p_rows jsonb)` — per row (1-based): soft-validates name/sex (bad rows become `{row, message}` entries, loop continues); matches an existing athlete by `lower(email)` or by `lower(btrim(name))` + `birth_date` (null-safe); updates non-null incoming fields or inserts; if `p_event_id` + `race_name` resolve to an individual race, creates the entry with `next_bib` unless already entered (not-found/team-race cases become error rows). Each row's body also runs inside its own `exception when others` so one bad row can't abort the batch.
6. `admin_athlete_profile(p_athlete_id uuid)` — `{athlete, results}`, results ordered by `data->'event'->>'date' desc`.
7. `admin_save_entry(p_entry jsonb)` — full create/update flow in the order given in the brief: race lookup + race-change lock → bib assign/dedupe → members (exactly `team_size` distinct existing athletes; individual members get every leg, team members must cover every leg 0..N-1 exactly once) → athlete-already-in-race check → level/team_name → wave_id (must belong to the race; defaults to the first wave by position) → persist entry + replace `entry_members` → `entry_json(id, true)`.
8. `admin_bulk_create_entries(p_race_id uuid, p_athlete_ids uuid[])` — individual races only; skips athletes already in the race; sequential bibs via `next_bib`.
9. `admin_update_entry_status(p_entry_id uuid, p_status text, p_penalty_ms int, p_notes text)`.
10. `admin_delete_entry(p_entry_id uuid)` — plain delete; marks unassign via the existing `on delete set null` FK.

`supabase/tests/30_admin_athletes_entries.sql` — covers every bullet in the brief's Step 1 list plus the remaining documented rules for each produced function (wave default/validation, race-change lock, `admin_update_entry_status`/`admin_delete_entry` incl. FK mark-unassignment, `admin_list_athletes`/`admin_athlete_profile` stats and ordering, and a happy-path `admin_delete_athlete`).

No grants were added (that's Task 7's job); local dev privileges come from `dev/db/bootstrap.sql`'s `alter default privileges`, same as 0002/0003.

## Testing

Command: `EBC_DB=ebc_t5 bash scripts/test-sql.sh` (resets `ebc_t5`, applies `dev/db/bootstrap.sql` + migrations 0001–0004, runs every `supabase/tests/*.sql`).

Final result (run twice for stability, plus a rerun after a small style edit — all clean, no stray notices):

```
PASS supabase/tests/00_helpers.sql
PASS supabase/tests/10_schema.sql
PASS supabase/tests/20_admin_events.sql
PASS supabase/tests/30_admin_athletes_entries.sql
```

## TDD Evidence

**RED** — command: `EBC_DB=ebc_t5 bash scripts/test-sql.sh`, run after writing `supabase/tests/30_admin_athletes_entries.sql` but before creating the migration:

```
PASS supabase/tests/00_helpers.sql
PASS supabase/tests/10_schema.sql
PASS supabase/tests/20_admin_events.sql
FAIL supabase/tests/30_admin_athletes_entries.sql
...
psql:supabase/tests/30_admin_athletes_entries.sql:27: ERROR:  function public.admin_save_athlete(jsonb) does not exist
LINE 1: a := public.admin_save_athlete('{"name":"  Carlos Silva  ","...
             ^
HINT:  No function matches the given name and argument types. You might need to add explicit type casts.
QUERY:  a := public.admin_save_athlete('{"name":"  Carlos Silva  ","sex":"M","email":"  CARLOS@X.COM "}'::jsonb)
CONTEXT:  PL/pgSQL function inline_code_block line 2 at assignment
```

This is the expected failure: the migration didn't exist yet, so the very first RPC the test calls
is undefined. The earlier suites (00/10/20, built on migrations 0001–0003 only) still passed,
confirming the base was untouched and the new test file was the only thing failing.

**GREEN** — same command, after writing `supabase/migrations/0004_admin_athletes_entries.sql`:

```
PASS supabase/tests/00_helpers.sql
PASS supabase/tests/10_schema.sql
PASS supabase/tests/20_admin_events.sql
PASS supabase/tests/30_admin_athletes_entries.sql
```

## Files changed

- `/home/claude/ebc-wt/t5/supabase/migrations/0004_admin_athletes_entries.sql` (new, 565 lines)
- `/home/claude/ebc-wt/t5/supabase/tests/30_admin_athletes_entries.sql` (new, 231 lines)

Both are exactly the files named in the task brief's Files block; nothing else was touched
(`git status` shows only these two as untracked, no modifications elsewhere).

## Self-review findings

- Checked every returned JSON shape against `contracts.md`'s `src/lib/types.ts` block
  (`AthleteRow`, `EntryRow`/`EntryMember`, `ResultRow`, `ImportResult`, `AthleteProfile`) and the
  RPC parameter names list — all match. `to_jsonb(row)` naturally includes `created_at`/`updated_at`
  beyond what the narrower TS interfaces declare, same as Task 4's races/events/waves — established
  pattern, not a new inconsistency.
- Fixed one style nit before committing: `admin_save_entry`'s level lookup used the bare table name
  as a qualifier (`events.levels ... where events.id = ...`); changed to a short alias (`ev`) to
  match every other query in the file.
- Verified no psql meta-commands (`\set`, `\echo`, `\i`, …) in the new test file, and no trailing
  whitespace in either new file.
- Two deliberate choices that go slightly beyond a literal reading of the brief, both documented
  inline with a comment:
  - `admin_save_entry`'s wave_id default: when `race_id` changes (allowed pre-marks) and `wave_id`
    is omitted, I default to the *new* race's first wave rather than reusing the old race's
    (now-invalid) `wave_id`, avoiding a confusing "Onda inválida" on a legitimate race switch.
  - `admin_import_athletes` wraps each row's body in its own `exception when others` so one
    malformed row (e.g. an unparseable date) can't abort the whole batch — directly serves spec
    §"Review Focus" #3 (bad CSV rows reported by row number, not fatal).
- Deliberately did **not** add a defensive "athlete id doesn't exist" skip in
  `admin_bulk_create_entries` (only "already entered" is skipped, per the brief); an invalid id
  would surface as a raw FK violation rather than a friendly P0001. Not exercised by any caller in
  this codebase (the UI only ever sends ids from its own athlete picker), so left out per YAGN
  — flagging in case a reviewer wants it hardened anyway.
- Error messages not given verbatim in the brief (`Atleta inválido`, `Onda inválida`, `Sexo
  inválido`, `Informe o nome do atleta`, `A data de nascimento não pode ser no futuro`, `Data de
  nascimento inválida`, `A penalidade não pode ser negativa`, `Atleta não encontrado`, `Inscrição
  não encontrada`) are my own pt-BR wording, consistent in tone with 0003's existing messages.
  Messages given verbatim in the brief (bib duplicate, member count, leg assignment, athlete
  dedup, level, team name required, delete-with-entries, import race-not-found/team-race) are
  reproduced exactly, including the `%`-substitution ones the tests pattern-match on.

## Concerns

None blocking. No defects found in migrations 0001–0003 (read-only base for this task).
