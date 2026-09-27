# Task 8 report — Integration test: full flow through supabase-js and the shim

Branch: `task/8` (from `task/7`, worktree `/home/user/ebc-wt/t8`). Commit:
`fc400e9 test: end-to-end RPC flow through supabase-js`.

## Implemented

- `tests/integration/helpers.ts` — `startStack(db, port)`: resets database
  `db` (`bash scripts/db-local.sh reset`, which runs `dev/db/bootstrap.sql` +
  `supabase/migrations/*`), spawns `dev/shim/server.mjs` bound to `db`/`port`,
  polls `GET ${url}/rest/v1/` until it answers, and returns
  `{ url, stop(), sql(q, params?) }` exactly per the brief's signature.
  `sql()` runs against a `pg.Pool` connected straight to Postgres (bypasses
  the shim, matching the brief's "seed nothing" use for `bootstrap_owner`).
  `stop()` sends `SIGTERM` then a `SIGKILL` fallback after 2s (unref'd) so no
  orphan `node dev/shim/server.mjs` process can survive even if a test threw
  before `afterAll` ran, and ends the pg pool. Reuses the shim.test.ts
  spawn/readiness pattern verbatim; `shim.test.ts` itself is untouched.
- `tests/integration/flow.test.ts` — one `describe`, 11 sequential `it`s
  (steps 1–10 of the brief, plus `7b`) against `startStack('ebc_t8', 54331)`,
  sharing state (ids, tokens, mark uuids, `T0`) via `describe`-scoped `let`s:
  1. `bootstrap_owner` via `sql()`; owner login; `admin_me` (`role:'owner'`,
     `must_change_password:true`); `auth.updateUser` + `admin_password_changed`;
     `admin_me` again (`must_change_password:false`).
  2. `admin_save_event` (`is_public:true`, `levels:['Elite','Base']`);
     `admin_save_race` for a 2-person relay (swim 750 / run 5000, asserts the
     default "Largada geral" wave got created) and an individual 5K run.
  3. Three `admin_save_athlete` calls (Ana/Beto/Caio); `admin_save_entry` for
     team "Tubarões" (Ana leg 0, Beto leg 1, level Elite);
     `admin_bulk_create_entries` for Caio on the run race.
  4. Anon `tk_open(token)` (asserts entries omit `notes` — Ruling 29);
     `tk_register` for "Ana" and "Bia" (two timekeeper devices).
  5. `admin_set_wave_start` on the relay wave at `T0 = Date.now()`.
  6. tk1 `tk_sync`: relay leg 0 @ T0+10:00.000, leg 1 @ T0+30:00.000, both
     accepted; tk2 `tk_sync`: leg 0 @ T0+10:04.000 (4s divergence) **with a
     malformed `clock_offset_ms: 'not-a-number'`**, leg 1 @ T0+30:00.500 —
     both accepted (not rejected) and the malformed field comes back `null`
     in the response's `marks[]` (Ruling 28b, verified positively, not just
     assumed).
  7. `admin_live(event, null)` → 4 marks; `admin_set_resolution(entry, 0,
     'mark', <tk1 leg0 id>, null, 'foto')` → `mode:'mark'`.
  7b. **Added beyond the brief's literal steps** (flagged in the task
      context as a controller ruling my assertions must match): organizer
      `admin_update_mark` moves tk2's leg-1 mark to leg 0 (`org_edited`
      flips true); tk2 then replays its original (stale) view of that same
      mark via `tk_sync` → rejected with reason `'Alterada pela organização'`
      (Ruling 27), asserted exactly.
  8. Anon `pub_event(slug)`: athletes have no `email` key at all; the team
     entry's members carry `name`; the entry itself omits `notes`; all 4
     marks come back, none carrying `device_ts`/`clock_offset_ms`/
     `clock_rtt_ms`/`org_edited`. `pub_live(slug, <that pub_event's
     server_now>)` → 0 marks.
  9. `admin_finalize_race(relay, [row])` with a hand-built `FinalizeRowInput`
     (`status:'finished'`, `final_ms:1_800_000`, `overall_pos:1`,
     `athlete_ids:[Ana,Beto]`, minimal `data`) → `count:1`;
     `admin_athlete_profile(Ana)` → 1 result; `admin_list_athletes()` → Ana
     `wins:1`.
  10. Anon `admin_list_events()` → error, accepting either `code:'42501'` or
      HTTP `status` 401/403 (asserted via `error?.code === '42501' ||
      status === 401 || status === 403`; actual observed: shim returns
      status 401 with `code:'42501'`, so both halves of the OR are
      independently true).

## Tests + results (RED → GREEN)

RED: with `tests/integration/helpers.ts` temporarily moved aside,
`npx vitest run -c vitest.integration.config.ts tests/integration/flow.test.ts`
failed to even collect the file:
```
FAIL  tests/integration/flow.test.ts [ tests/integration/flow.test.ts ]
Error: Cannot find module './helpers' imported from .../flow.test.ts
 Test Files  1 failed (1)
      Tests  no tests
```

GREEN: with `helpers.ts` restored, the same command:
```
 Test Files  1 passed (1)
      Tests  11 passed (11)
```

Full gate, `npm run test:integration` (both integration files together):
```
 Test Files  2 passed (2)
      Tests  16 passed (16)
```
(5 from the pre-existing `shim.test.ts`, unmodified, + 11 from
`flow.test.ts`.)

`npm run typecheck` (`tsc --noEmit -p tsconfig.json`): clean, no output.
`tests/` is included by the project's `tsconfig.json` (`"include": ["src",
"tests", ...]`), so `tests/integration/*.ts` is covered.

`EBC_DB=ebc_t8 bash scripts/test-sql.sh`: all 7 SQL suites `PASS`
(`00_helpers` … `60_security`), run again after the integration suite to
confirm the shared `ebc_t8` database is left in a state the SQL suite still
accepts.

Checked for orphan processes after every run (`ps aux | grep
dev/shim/server.mjs`): none found, including after a run where the earlier
suite's DB (`ebc_t8`) was reset again mid-session by `test-sql.sh`.

## Files

- `/home/user/ebc-wt/t8/tests/integration/helpers.ts` (new)
- `/home/user/ebc-wt/t8/tests/integration/flow.test.ts` (new)
- `/home/user/ebc-wt/t8/tests/integration/shim.test.ts` (read only, untouched)
- Read for RPC contracts: `supabase/migrations/0001_schema.sql` through
  `0006_public_grants.sql`, `dev/shim/server.mjs`, `dev/shim/jwt.mjs`,
  `scripts/db-local.sh`, `src/lib/types.ts`, `.superpowers/sdd/.../contracts.md`.

## Self-review

- Used my own database (`ebc_t8`) and port (`54331`), as instructed, so I
  don't collide with other agents' `ebc_shim` (54391, task 6's own file) or
  the plain `ebc`/`ebc_test` names other scripts default to.
- Every RPC in every SQL function I called has **no default parameter
  values** (checked all six migrations), so the shim only builds the call
  with whatever keys are present in the JSON body — I pass every declared
  parameter explicitly (including `p_since: null`, `p_manual_ts: null`,
  etc.) rather than omitting any, to avoid an accidental
  "function does not exist" from a missing named argument.
- Confirmed (by reading 0006's grant loop) that `admin_*` is granted only to
  `authenticated`, so an anon call hits Postgres `42501`, which the shim's
  `mapPgErrorStatus` turns into HTTP 401 for the `anon` role — matches what
  the brief says to accept and what I actually observed running the suite.
  I did not guess this; I traced it through the shim's error-mapping code
  and then confirmed it by running test 10.
   - I did not edit `shim.test.ts`, `package.json`, or any file outside my
    two owned files.
- Only created/edited the two files I own; did not touch `shim.test.ts`,
  migrations, or the shim.
- Did not `npm install` anything (no new dependency was needed — the file
  reuses `node:child_process`, `node:crypto`, `pg`, and
  `@supabase/supabase-js`, all already present).

## Concerns

- No server bug was exposed by the flow as specified in the brief; all 11
  assertions pass, including the two controller-ruling checks I added
  (7b's org-edited-mark rejection, and the malformed-`clock_offset_ms`
  sanitization in step 6) that the task context specifically called out as
  "your assertions must match."
- **Informational only, not a flow-exposed bug** (so not marked as a
  failing assertion, since my flow never discards a mark and therefore
  never actually exercises this path): while reading `0006_public_grants.sql`
  for `pub_event`, I noticed its `marks` subquery
  (`select jsonb_agg(public.mark_public_json(mk) order by mk.ts) from
  public.marks mk where mk.event_id = ev.id`) has no `and not mk.discarded`
  filter, whereas spec §6 describes `pub_event`'s marks as
  "`marks[]` (não descartadas)" (not discarded) — that filter is present on
  `admin_get_event`'s callers' expectations conceptually but I could not find
  it applied here, unlike e.g. `admin_set_resolution`'s own `not discarded`
  check elsewhere. `pub_live`, by contrast, is documented in `contracts.md`
  as intentionally including discarded marks (a delta clients can drop). If
  this is intended (pub_event a full snapshot, discarded marks harmless
  since they carry `discarded:true` for the client to filter), no action
  needed; if not, it's a one-line fix in `0006_public_grants.sql`'s
  `pub_event` marks subquery. I have not changed the SQL, per this task's
  instructions to record rather than fix.

## Status

DONE. Gates green: `npm run test:integration` (16/16), `npm run typecheck`
(clean), `EBC_DB=ebc_t8 bash scripts/test-sql.sh` (7/7 PASS). No orphan
shim process after any run. Committed on `task/8`.
