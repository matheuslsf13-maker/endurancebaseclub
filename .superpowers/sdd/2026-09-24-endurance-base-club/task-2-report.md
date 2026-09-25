# Task 2 report: Local Supabase emulation (Postgres bootstrap, scripts, auth/RPC shim)

Worktree: `/home/claude/ebc-wt/t2` · Branch: `task/2` · Commit: `dd92d5e` — "feat: local Supabase emulation for tests (bootstrap, scripts, auth/rpc shim)"

## What was implemented

All 10 files from the task's Files block, exactly matching the plan's paths, nothing else touched (`git diff --stat` on the commit shows only these 10 files, all newly created):

| File | Purpose |
|---|---|
| `dev/db/bootstrap.sql` | Emulates the parts of Supabase our SQL relies on: `anon`/`authenticated`/`service_role` roles, `extensions` schema + `pgcrypto`, `auth` schema (`auth.users`, `auth.identities`, `auth.jwt()/uid()/role()` reading `request.jwt.claims`), default privileges on `public`. Used verbatim from the brief. |
| `scripts/db-local.sh` | `start\|stop\|reset\|apply\|psql\|url` against a real local PostgreSQL 16 cluster at `/var/tmp/ebc-pg` (`EBC_DB`, `EBC_PG_PORT`). Used verbatim from the brief. |
| `scripts/test-sql.sh` | Resets `EBC_DB` (default `ebc_test`), runs `supabase/tests/*.sql` in name order, `PASS`/`FAIL` per file, non-zero exit on failure. Used verbatim from the brief. |
| `supabase/tests/00_helpers.sql` | `tests` schema: `tests.as_user`, `tests.as_anon`, `tests.assert_raises`, `tests.set`/`get`. Used verbatim from the brief. |
| `dev/shim/jwt.mjs` | HS256 sign/verify (base64url header.body.sig via HMAC-SHA256, `timingSafeEqual`, `exp` check). Used verbatim from the brief. |
| `dev/shim/server.mjs` | The Node `http` + `pg` shim (my own implementation, ~362 lines — see "Design notes" below): CORS on every response; `pg.types.setTypeParser` for bigint/numeric as JSON numbers; role resolution from `Authorization: Bearer <t>` (anon fallback for missing/`sb_publishable_*`, JWT verify otherwise, 401 `PGRST301` on invalid); `POST /rest/v1/rpc/:fn` with `pg_proc`-typed named-parameter calls, cached per function name, run in a transaction with `set_config('request.jwt.claims', …)` + `set local role`, PostgREST-shaped errors (400/401/403), `void`→204; `POST /auth/v1/token?grant_type=password\|refresh_token`; `GET`/`PUT /auth/v1/user`; `POST /auth/v1/logout`. |
| `scripts/dev-stack.sh` | Resets the dev DB, seeds the dev owner via `public.bootstrap_owner(...)` only if that function exists yet (guarded with `to_regproc`), then `exec`s the shim. |
| `vitest.integration.config.ts` | Node-environment Vitest project for `tests/integration/**`. Used verbatim from the brief. |
| `tests/integration/shim.test.ts` | The given integration test, run against the real `@supabase/supabase-js` client. Used verbatim from the brief. |
| `supabase/migrations/.gitkeep` | Keeps the (intentionally empty) migrations directory in git. |

### Design notes / research behind `server.mjs`

Since `server.mjs` wasn't given verbatim (only a behavior spec), I read the installed `@supabase/{supabase-js,auth-js,postgrest-js}` (2.117.1) and `pg`/`pg-protocol` source before writing it, to get header/error-shape fidelity right rather than guessing against possibly-stale training knowledge:

- **Auth headers**: `SupabaseClient._initSupabaseAuthClient` always sends `apikey` **and** `Authorization: Bearer <supabaseKey>` to `/auth/v1/*` (even for the new-format `sb_publishable_...` key — the "new key, no Bearer fallback" logic in `fetchWithAuth` only applies to the main REST fetch and is further disabled for Edge Functions, not `/auth/v1/*`). So the shim must not require `/auth/v1/token` to carry a real JWT.
- **RPC role fallback**: for `.rpc()`, `fetchWithAuth`'s `allowKeyAsBearer` is `true` for the main client fetch, so a signed-out client sends `Authorization: Bearer sb_publishable_local_dev` — confirms the brief's "starts with `sb_publishable_` → anon" rule is what actually arrives on the wire, both via `apikey` and `Authorization`.
- **Error shapes**: `postgrest-js` (`PostgrestBuilder.processResponse`) uses the parsed error-response JSON directly as `error` (so my `{code,message,details,hint}` body becomes the client's `error` object verbatim) and treats an empty 2xx body as `data: null` (matches `void` → 204). `auth-js` (`handleError`) picks `error.message` from `data.msg` first, and `error.code` from `data.code` only when it's a **string** and an `X-Supabase-Api-Version` response header is present and recent — otherwise from `data.error_code`; since GoTrue errors use a numeric `code` (e.g. `400`), the shim's `{code:400, error_code:'invalid_credentials', msg:'...'}` shape correctly yields `error.message === 'Invalid login credentials'` without needing to add that version header.
- **pg error fields**: confirmed in `node_modules/pg-protocol/dist/parser.js` that the driver sets `err.code`/`err.detail`/`err.hint` (singular `detail`, matching the brief's `err.detail ?? null`).
- Verified `pg.types.setTypeParser(20, Number)` / `(1700, Number)` are process-global (mutate the shared `pg.types` registry), so calling them once at module load before creating the `Pool` is sufficient.

One deliberate interpretation: the brief's dynamic-call dispatch ("jsonb/json params get `JSON.stringify`; array params pass the JS array; other params pass `String(value)`") is implemented as a **type-based** dispatch (using the `format_type` string from `pg_proc`, e.g. `type.endsWith('[]')`), not a `Array.isArray(value)` check — this matters when a jsonb param happens to receive a JS array/object (must still be `JSON.stringify`'d, not passed raw).

## TDD evidence

**RED** — before `dev/shim/server.mjs` existed (Steps 1-4 and Step 6 only committed to disk):

```
$ npm run test:integration -- tests/integration/shim.test.ts
...
 ❯ tests/integration/shim.test.ts (5 tests | 5 failed) 5249ms
   ❯ local Supabase shim (5)
     × calls RPC as anon with defaults 12ms
     × logs in with password and calls RPC as authenticated 3ms
     × rejects wrong passwords 4ms
     × maps SQL errors and bigint results like PostgREST 2ms
     × updates the password 2ms
...
AssertionError: expected { …(4) } to be null
+ Received:
{
  "code": "",
  "details": "TypeError: fetch failed

Caused by: Error: connect ECONNREFUSED 127.0.0.1:54391 (ECONNREFUSED)
...
 Test Files  1 failed (1)
      Tests  5 failed (5)
   Duration  5.45s (tests 98%, import 1%)
```

All 5 failures are `ECONNREFUSED`/`fetch failed` — the shim process (`spawn('node', ['dev/shim/server.mjs'], ...)`) fails to start because the file doesn't exist yet, so the readiness-poll loop in `beforeAll` exhausts and every subsequent request fails to connect. Confirms the test genuinely exercises the shim rather than passing vacuously.

**GREEN** — after implementing `dev/shim/jwt.mjs` + `dev/shim/server.mjs`:

```
$ npm run test:integration -- tests/integration/shim.test.ts
 RUN  v5.0.1 /home/claude/ebc-wt/t2

 Test Files  1 passed (1)
      Tests  5 passed (5)
   Duration  658ms (tests 84%, import 10%, transform 5%, worker 1%)
```

Re-ran twice more after a subsequent robustness edit (guarding `buildRpcCall` against a non-object body) — stable, 5/5 both times, ~0.7s each.

## Verification (all required commands, final run after commit)

```
$ npm run test:integration -- tests/integration/shim.test.ts
 Test Files  1 passed (1)
      Tests  5 passed (5)

$ bash scripts/test-sql.sh
PASS supabase/tests/00_helpers.sql

$ npm run typecheck
> tsc --noEmit -p tsconfig.json
(clean, no output)

$ npx vitest run
 Test Files  2 passed (2)
      Tests  11 passed (11)
```

(`npx vitest run` covers Task 1's `src/lib/format.test.ts` + `src/lib/storage.test.ts`, unaffected by this task — confirms nothing regressed.)

### Additional manual verification (beyond the given test)

The given test only exercises anon/authenticated RPC, wrong password, SQL-error mapping, bigint, and password update. Since T3–T8 and E2E will depend on the rest of the spec'd behavior, I stood up a scratch DB/shim (`ebc_manual`, port 54392) and curl'd the paths the test doesn't reach, then tore it down (dropped `ebc_manual`/`ebc_test`/`ebc_shim`, killed the process) before the final verification run above:

- `OPTIONS` preflight → `204` with the exact CORS headers from the brief.
- `void`-returning RPC → `204` with empty body.
- `text[]` param → passed through as a JS array, cast `::text[]`, correct result.
- `42501` as anon → `401`; same error as authenticated → `403` (both via a real signed-in session).
- Garbage `Authorization` token on RPC → `401 {"code":"PGRST301","message":"JWT invalid",...}`.
- `GET /auth/v1/user` with a valid access token → full user object; with a garbage token → `401`.
- `PUT /auth/v1/user` with a 5-char password → `422 weak_password` (not exercised by the given test, which only tries an 8+ char password).
- `refresh_token` grant → new session; reusing the now-rotated old refresh token → `400 refresh_token_not_found`.
- Request log: one line per request to stdout, e.g. `POST /rest/v1/rpc/mt_denied -> 403 (2ms)`.

## Self-review findings

- **Fixed during review**: `buildRpcCall` originally did `Object.prototype.hasOwnProperty.call(body, name)` / `body[name]` directly; hardened it to fall back to `{}` when `body` isn't a plain object, so a body that fails to parse as an object (rather than just being empty) can't throw instead of producing a clean 400-ish response. Not reachable by the given test or by `supabase-js` (which always sends `{}` for no-arg RPCs), but cheap and removes a latent crash path for future callers.
- **Considered, decided against**: an earlier draft of `handleUpdateUser` had a branch to return the current user when `password` was omitted from the body. Removed it — the brief only specifies password-based `PUT /user`, and the omitted-password case is already handled correctly (falls into the existing `weak_password` validation) without the extra branch. Kept the file to exactly what was asked.
- **Size**: `server.mjs` is 362 lines (314 non-blank/non-comment-only) against the brief's "~250 lines" estimate. I looked for cuts and didn't find any that wouldn't hurt clarity — every function maps to one explicitly-listed behavior (CORS, bigint/numeric parsing, two distinct auth-resolution helpers, signature cache, dynamic call builder, PG-error status mapping, password/refresh grants, get/update user, logout, router). I'm flagging this rather than silently accepting the overage; I don't think it's gold-plating (no extra endpoints or speculative features beyond the spec), but a reviewer may want to confirm.
- Confirmed no other tracked files were touched (`git status`/`git diff --stat` on the commit show exactly the 10 planned files, no edits to `package.json` or other shared files).
- Confirmed script executable bits are correct (`db-local.sh`, `test-sql.sh`, `dev-stack.sh` are `100755`; the rest `100644`).
- Left `/var/tmp/ebc-pg` running (Postgres 16 on port 54322, database `ebc` present) since this task owns it and T3–T8 will want it available; all scratch databases created for manual testing (`ebc_manual`, `ebc_test`, `ebc_shim`) were dropped again before the final verification pass.

## Concerns

- `server.mjs` line count vs. the brief's rough estimate (see above) — judgment call, not blocking.
- Refresh tokens have no expiry/TTL (only single-use rotation via the in-memory `Map`) — matches the brief's literal spec ("random hex kept in an in-memory `Map`") but is simpler than real GoTrue; fine for a local dev/test shim, flagging for awareness since no future task in the plan appears to need refresh-token TTL behavior.
- `dev/shim/*.mjs` are outside `tsconfig.json`'s `include` (only `src`, `tests`, `vite.config.ts`, `vitest.integration.config.ts` are listed, matching Task 1's scaffold), so they get no static type checking — verified correct behavior instead via the integration test plus the manual curl pass above.

## Status

DONE. All verification commands pass; TDD RED→GREEN evidence captured above; diff self-reviewed; one robustness fix applied post-review.
