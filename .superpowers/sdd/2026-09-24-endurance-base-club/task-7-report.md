# Task 7 report — Public RPCs, least-privilege grants and security tests

Branch `task/7` (worktree `/home/user/ebc-wt/t7`), commit `4f48716`.

## Implemented

`supabase/migrations/0006_public_grants.sql`:
- `resolve_public_event(p_slug)` — internal helper (no `pub_` prefix, deliberately ungranted,
  like `tk_event`): resolves an event by `public_slug` only if `is_public`, else `Evento não
  encontrado` (P0001). Shared by `pub_event`/`pub_live`.
- `mark_public_json(m public.marks)` — internal helper (ungranted): `to_jsonb(m) - 'device_ts' -
  'clock_offset_ms' - 'clock_rtt_ms' - 'org_edited'`. Works whether or not `org_edited` exists yet
  (Task 6's fix round is adding it concurrently in another worktree) since removing an absent jsonb
  key is a no-op.
- `pub_events()` — public event list `{id, public_slug, name, date, location, status}`, `is_public`
  only, newest first.
- `pub_event(p_slug)` — full `PubEventPayload`: `event` minus `tk_token`/`tk_enabled`; `races`;
  `waves`; `entries` = `entry_json(id, true) - 'notes'` (Ruling 29: keeps `level`/`status`/
  `penalty_ms`); `athletes` limited to `{id,name,sex,team_club,city,public_profile,age_event,
  age_year_end}` (age fields computed from `age()`/`extract(year from ...)`, naturally `null` when
  `birth_date` is `null`); `timekeepers` `{id,name}`; `marks` via `mark_public_json` (all, including
  discarded, per the brief); `resolutions`; `results`; `version`; `server_now`.
- `pub_live(p_slug, p_since)` — same shape/semantics as `admin_live`, same mark projection.
- `pub_athlete(p_athlete_id)` — only if `public_profile`, else `Perfil não encontrado`; results
  restricted to `results r join events ev on ev.id = r.event_id where ev.is_public`.
- Grants block, exactly as given by the brief (Ruling 15): blanket revoke (tables, sequences,
  function execute, and the matching default-privilege revokes) first, then a `DO` block granting
  `admin_*` to `authenticated` and `tk_*` (except `tk_event`) / `pub_*` / `server_time` to
  `anon, authenticated`, by name prefix only. Repeated verbatim as a comment note for future
  migrations, matching the brief.

Test files (mine): `supabase/tests/50_public.sql`, `supabase/tests/60_security.sql`.
Also touched (see "Concerns/cross-file fix" below): `supabase/tests/10_schema.sql`.

## Tests + results (RED → GREEN)

**RED**: moved `0006_public_grants.sql` out of `supabase/migrations/` and ran
`EBC_DB=ebc_t7 bash scripts/test-sql.sh`:
```
FAIL supabase/tests/50_public.sql
  ERROR: expected errcode P0001 but got 42883 (function public.pub_event(text) does not exist)
FAIL supabase/tests/60_security.sql
  ERROR: expected error 42501 but statement succeeded: select * from public.events
```
(00/10/20/30/40 all PASS at this point, confirming the failures are specific to the new work.)

**GREEN**: restored the migration, fixed two bugs the RED run didn't reach (a raw `select ... from
public.events` inside a do-block that ran as anon post-grants in `50_public.sql`, replaced with a
computation from the already-known `t0` fixture instead of the table; a missing `::uuid` cast on
`admin_finalize_race`'s first argument), then:
```
EBC_DB=ebc_t7 bash scripts/test-sql.sh
PASS supabase/tests/00_helpers.sql
PASS supabase/tests/10_schema.sql
PASS supabase/tests/20_admin_events.sql
PASS supabase/tests/30_admin_athletes_entries.sql
PASS supabase/tests/40_timing.sql
PASS supabase/tests/50_public.sql
PASS supabase/tests/60_security.sql
```
Re-ran twice more (fresh `db-local.sh reset` each time via `test-sql.sh`) — reproducible, all PASS.

`50_public.sql` covers: private event → `pub_event`/`pub_events` both refuse/omit it; after
`admin_save_event(..., is_public: true)`, `pub_event` as anon returns entries with member names and
no `notes`, athletes with no `email`/`phone`/`birth_date` keys and correct `age_event`/
`age_year_end` (including `null` for the athlete with no birth date), event with no `tk_token`/
`tk_enabled`, and marks including a discarded one with no `device_ts`/`clock_offset_ms`/
`clock_rtt_ms`; `pub_live` delta semantics (all marks incl. discarded at `p_since=null`, empty after
a future cutoff, waves always in full) and its own "unknown slug" P0001; `pub_athlete` returns only
the public event's result (a second, private event's result for the same athlete is excluded), and
raises `Perfil não encontrado` once the athlete's `public_profile` is set to `false`.

`60_security.sql` is the brief's block verbatim plus one addition (Ruling 15): an
`entry_json` call as anon now also asserts 42501.

### Integration shim check
`npx vitest run tests/integration/shim.test.ts -c vitest.integration.config.ts` → **5 passed, 0
failed**, run against the fully-migrated (0001-0006) `ebc_shim` database. The shim's ad hoc test
functions (`shim_echo`/`shim_fail`/`shim_bigint`, created outside any migration) remain callable by
anon — expected, see the Postgres-quirk note below — and everything the shim itself does (login,
RPC dispatch via `set local role`, SQL-error mapping, bigint handling, password update) still works
unmodified. Not modified per instructions.

## Files
- `/home/user/ebc-wt/t7/supabase/migrations/0006_public_grants.sql` (new)
- `/home/user/ebc-wt/t7/supabase/tests/50_public.sql` (new)
- `/home/user/ebc-wt/t7/supabase/tests/60_security.sql` (new)
- `/home/user/ebc-wt/t7/supabase/tests/10_schema.sql` (one-line assertion fix, see below)

## Self-review

- **Brief compliance**: grant block is byte-for-byte the one given (revokes first, then the exact
  `DO` block with the exact prefix logic); `tk_event` confirmed still ungranted (60_security); all
  four RPC names/shapes match the brief and `contracts.md`'s `PubEventPayload`/`PubEventListItem`.
- **Ruling 15**: added `entry_json` to the ungranted-function proof in `60_security.sql`, on top of
  `bootstrap_owner`/`internal_create_auth_user` (already in the brief's block) — confirmed by the
  passing test. Direct table reads (`events`, `marks`, `athletes`) confirmed refused with 42501 for
  both anon and a non-organizer authenticated user.
- **Ruling 29**: `entries` in `pub_event`/`pub_live` never carry `notes` (asserted directly); `level`,
  `status`, `penalty_ms` are still present (asserted). Athletes never carry `email`/`phone`/
  `birth_date` (asserted per-row in a loop, not just the first one).
- **Ruling 4 / marks**: `device_ts`, `clock_offset_ms`, `clock_rtt_ms` stripped via
  `mark_public_json`; `org_edited` handled defensively (jsonb `-` is a no-op on a missing key) since
  Task 6's fix round adds that column in a separate, concurrent worktree I don't touch.
  `pub_event`/`pub_live` both include discarded marks, per the brief.
- **Internal helpers stay ungranted**: I deliberately did *not* prefix `resolve_public_event` or
  `mark_public_json` with `pub_`, so the DO block's name-based walk leaves them ungranted (verified:
  they're only ever invoked from inside another `security definer` function, where the *owner's*
  privileges apply, not the caller's — the same pattern `entry_json` already relies on).
- **Privacy of public payloads**: re-checked every field against the brief/rulings; nothing beyond
  what's specified leaks (resolutions/results/waves/timekeepers projections match `admin_get_event`/
  `admin_live`'s existing shapes, which the spec doesn't ask to restrict further for these).
- **Test quality**: `50_public.sql` avoids duplicating the age-formula-under-test by computing
  expected `age_event`/`age_year_end` from the fixture's own `t0` timestamp (a value already known
  to the test) rather than re-deriving the formula inline as a tautology; it also avoids any direct
  table read while running as anon (see the cross-file fix below — I initially wrote one such read
  by mistake and had to fix it).

### A Postgres quirk worth flagging (not a defect in this task)
While verifying the integration shim, I confirmed empirically (isolated repro, three scenarios) that
`alter default privileges in schema public revoke execute on functions from public, anon,
authenticated;` — part of the brief's grant block, included verbatim — does **not** stop
newly-created functions from getting `PUBLIC` execute: Postgres's `CREATE FUNCTION` always unions in
the hard-coded `PUBLIC=EXECUTE` default in addition to whatever `pg_default_acl` records, and a
`REVOKE` that would leave that default-privileges row with nothing beyond the hard-coded default
gets deleted rather than stored as an explicit "no privilege" override. In other words: default
privileges can *add* future grants (e.g. `service_role`) but cannot *suppress* the built-in
PUBLIC-execute-on-new-functions rule. This does not affect Task 7's own deliverable — the *existing*
functions at the time 0006 runs (all of `pub_*`/`admin_*`/`tk_*`/helpers) get a direct, effective
`REVOKE EXECUTE ... FROM public, anon, authenticated` (not going through default privileges), which
is what 60_security.sql actually verifies. It does mean the brief's own note — "every later
migration that adds an RPC must repeat the same DO block at its end" — is load-bearing, not just
good hygiene: a future migration that adds a function and only re-runs the `DO` grant loop (without
first re-running the blanket `revoke execute on all functions ... from public, anon, authenticated`)
would leave that new function callable by anon via its automatic `PUBLIC` grant. Worth keeping in
mind for Task 8+.

### Cross-file fix (outside my nominal 3-file ownership) — flagging for the controller
`supabase/tests/10_schema.sql` had one assertion — `assert (select count(*) from public.events) =
0;` after `tests.as_anon()` — whose own comment said "grants are revoked later in 0006; here RLS
alone returns no rows". Once `0006` exists in the migration set (`db-local.sh reset` applies every
file in `supabase/migrations/` before any test runs), that assumption is no longer true: a table
with no grant produces a hard `42501` before RLS is even consulted, not an empty result. This is an
unavoidable, direct consequence of correctly implementing this task's own grant model (exactly what
that comment anticipated), and no later task in the plan revisits schema/internal-helper tests, so
I made the minimal one-line fix (assert `42501` via `tests.assert_raises`, matching the pattern
already used everywhere else) rather than leave the full suite permanently red. Flagging it
explicitly since it's outside my stated 3-file ownership.

## Concerns
- The cross-file fix to `10_schema.sql` above, and the Postgres default-privileges quirk, are both
  informational — worth a quick look by the controller, but I don't believe either blocks merging.
- I did not touch `supabase/migrations/0005_timing.sql` / `tk_open` (Task 6's fix round owns that
  concurrently), matching the brief.
- See "Amendment (Ruling 35)" below for a new, deliberate consequence: the local dev shim's own
  smoke test now partially fails because of the stricter fix, and I did not touch it (see there).

## Amendment (Ruling 35)

Commit `598995f` "fix(db): revoke default PUBLIC execute on future functions", on top of the
original `4f48716`.

### What changed
- `supabase/migrations/0006_public_grants.sql`: added
  `alter default privileges revoke execute on functions from public;` (the role-global form, no
  `in schema`) right after the existing schema-scoped default-privilege revokes, with a comment
  explaining why the schema-scoped form alone doesn't work and noting this line is not
  schema-scoped so it only needs to be set once (unlike the per-migration `DO` re-grant walk).
- `supabase/tests/60_security.sql`: added a check, right after the `owner`/`stranger` setup and
  before the `as_anon()` switch (so it runs as the superuser, which has `CREATE` on schema
  `public`): `create function public.zz_probe() returns int language sql as 'select 1'`, then
  asserts `has_function_privilege('anon', 'public.zz_probe()', 'execute')` and the same for
  `authenticated` are both `false`. It rolls back with the rest of the file, confirmed with a
  direct query afterward (`select proname from pg_proc where proname = 'zz_probe'` → 0 rows).

### RED → GREEN
**RED** (before adding the new `alter default privileges` line, with the new check already in
`60_security.sql`):
```
FAIL supabase/tests/60_security.sql
  ERROR: a function created after 0006 must not be executable by anon
```
**GREEN** (after adding the line): `EBC_DB=ebc_t7 bash scripts/test-sql.sh` → all 7 files PASS,
reproduced on a second fresh reset.

### Empirical verification of the mechanism (why Ruling 35 is correct)
Isolated repro across three throwaway databases:
1. `alter default privileges in schema public revoke execute on functions from public, anon;` with
   no prior grant on record → `pg_default_acl` ends up with **zero rows** for that (owner, schema,
   objtype); a function created afterward is still `PUBLIC`-executable (Postgres falls back to its
   hard-coded default because there's no stored override).
2. Same but with an explicit prior `alter default privileges in schema public grant all on
   functions to public;` first, then the schema-scoped revoke → the `pg_default_acl` row still
   goes back to **zero rows** (the "revoke down to nothing beyond hard-coded default" case gets
   deleted, not stored as an explicit "no privilege" override) → same result, still
   `PUBLIC`-executable.
3. The role-global form (`alter default privileges revoke execute on functions from public;`, no
   `in schema`) → `pg_default_acl` keeps a **non-empty** row (`defaclnamespace = 0`, i.e. every
   schema) with only the owner listed → a function created afterward has `proacl` with no `PUBLIC`
   entry, and `has_function_privilege('anon', ..., 'execute')` / `'public'` both come back `false`.

Re-verified directly on `ebc_t7` post-migration that this doesn't regress `service_role`'s own
default execute grant (Supabase's expected server-side bypass): both the schema-scoped
(`service_role=X`, from `dev/db/bootstrap.sql`, untouched by 0006) and the new global
(owner-only) default-ACL rows apply together to a freshly created function, giving it
`{postgres=X, service_role=X}` with no `anon`/`authenticated`/`PUBLIC` — confirmed with
`has_function_privilege` for all three roles.

### New consequence: the local dev shim's own smoke test partially regresses
Re-ran `npx vitest run tests/integration/shim.test.ts -c vitest.integration.config.ts` after this
change: **2 passed, 3 failed** (previously 5/5). The three failures are exactly the tests that call
the shim's own ad hoc `shim_echo`/`shim_fail`/`shim_bigint` functions — those are created directly
in the test's `beforeAll` (plain `create function ...`, no explicit grant), *after*
`db-local.sh reset` has already applied every migration including the new global revoke. Since
those functions are created outside the app's migration/grant system, they no longer get an
automatic `PUBLIC` execute grant either, and `anon`/`authenticated` can no longer call them through
the shim — e.g. `shim_fail`'s RPC call now fails with "permission denied for function shim_fail"
instead of reaching the function body's own `raise exception 'Falhou'`.

This is the intended, direct consequence of closing exactly the gap Ruling 35 targets — it is not
a bug in the migration, but it does mean `tests/integration/shim.test.ts` is no longer fully green
against a fully-migrated database. Per the original task instructions I did **not** modify that
test file (or `dev/db/bootstrap.sql`, which is also outside my file ownership); the trivial fix
would be adding an explicit `grant execute on function public.shim_echo(jsonb,int),
public.shim_fail(), public.shim_bigint() to anon, authenticated;` right after those functions are
created in the test's `beforeAll`, but I'm leaving that call to the controller since it touches a
file I don't own and wasn't asked of me. Flagging prominently rather than silently leaving it
broken.

Both throwaway databases created during this verification (`zz_probe3`, and the shim test's own
`ebc_shim`) were dropped afterward; no residue left in `ebc_t7`.

## Amendment 2 (Ruling 37)

Commit `d353d11` "test: grant shim probe functions explicitly after least-privilege defaults", on
top of `598995f`.

### What changed
I was granted `tests/integration/shim.test.ts` for this one change (previously out of scope).
In its `beforeAll`, right after `create function public.shim_echo/shim_fail/shim_bigint`, added:
```sql
grant execute on function public.shim_echo(jsonb, int), public.shim_fail(), public.shim_bigint()
  to anon, authenticated;
```
with a comment explaining why it's needed (0006's grants, specifically Ruling 35's role-global
default-privileges revoke, mean any function created after migrations run no longer gets `PUBLIC`
execute automatically — these three probe functions exist only to exercise the shim server's own
RPC/error/bigint plumbing, not the app's grant model). Nothing else in the file changed.
`dev/db/bootstrap.sql` and `0006_public_grants.sql` were **not** touched.

### Verification
- `npx vitest run tests/integration/shim.test.ts -c vitest.integration.config.ts` → **5 passed, 0
  failed** (back to fully green).
- `EBC_DB=ebc_t7 bash scripts/test-sql.sh` → all 7 files PASS (unaffected, since this change is
  confined to the test-only file).
- Confirmed via `git diff`/`git status` that only `tests/integration/shim.test.ts` changed for this
  commit.
- Dropped the shim test's leftover `ebc_shim` database afterward.
