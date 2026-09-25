## Task 2: Local Supabase emulation (Postgres bootstrap, scripts, auth/RPC shim)

**Files:**
- Create: `dev/db/bootstrap.sql`, `scripts/db-local.sh`, `scripts/test-sql.sh`, `scripts/dev-stack.sh`, `dev/shim/jwt.mjs`, `dev/shim/server.mjs`, `supabase/tests/00_helpers.sql`, `vitest.integration.config.ts`, `tests/integration/shim.test.ts`, `supabase/migrations/.gitkeep`

**Interfaces:**
- Produces: `bash scripts/db-local.sh start|stop|reset|apply|psql|url` (honors `EBC_DB`, `EBC_PG_PORT`); `bash scripts/test-sql.sh` (resets `EBC_DB` default `ebc_test`, applies migrations, runs `supabase/tests/*.sql` in name order, exits non-zero on failure); shim `node dev/shim/server.mjs` (env `SHIM_PORT` default 54321, `EBC_DB` default `ebc`, `EBC_PG_PORT`, `SHIM_JWT_SECRET` default `ebc-local-dev-jwt-secret-0123456789abcdef`); SQL test helpers in schema `tests`: `tests.as_user(uuid)`, `tests.as_anon()`, `tests.assert_raises(p_sql text, p_errcode text, p_msg_like text default null)`, `tests.set(k text, v text)`, `tests.get(k text) returns text`.

- [ ] **Step 1: `dev/db/bootstrap.sql`** — emulates what our SQL relies on in Supabase:

```sql
do $$ begin
  if not exists (select 1 from pg_roles where rolname = 'anon') then create role anon nologin noinherit; end if;
  if not exists (select 1 from pg_roles where rolname = 'authenticated') then create role authenticated nologin noinherit; end if;
  if not exists (select 1 from pg_roles where rolname = 'service_role') then create role service_role nologin noinherit bypassrls; end if;
end $$;
create schema if not exists extensions;
create extension if not exists pgcrypto with schema extensions;
grant usage on schema extensions to anon, authenticated, service_role;

create schema if not exists auth;
grant usage on schema auth to anon, authenticated, service_role;
create table if not exists auth.users (
  instance_id uuid, id uuid not null primary key, aud varchar(255), role varchar(255), email varchar(255),
  encrypted_password varchar(255), email_confirmed_at timestamptz, invited_at timestamptz,
  confirmation_token varchar(255), confirmation_sent_at timestamptz, recovery_token varchar(255),
  recovery_sent_at timestamptz, email_change_token_new varchar(255), email_change varchar(255),
  email_change_sent_at timestamptz, last_sign_in_at timestamptz, raw_app_meta_data jsonb,
  raw_user_meta_data jsonb, is_super_admin boolean, created_at timestamptz, updated_at timestamptz,
  phone text default null, phone_confirmed_at timestamptz, phone_change text default '',
  phone_change_token varchar(255) default '', phone_change_sent_at timestamptz,
  confirmed_at timestamptz generated always as (least(email_confirmed_at, phone_confirmed_at)) stored,
  email_change_token_current varchar(255) default '', email_change_confirm_status smallint default 0,
  banned_until timestamptz, reauthentication_token varchar(255) default '', reauthentication_sent_at timestamptz,
  is_sso_user boolean not null default false, deleted_at timestamptz, is_anonymous boolean not null default false
);
create unique index if not exists users_email_partial_key on auth.users (email) where is_sso_user = false;
create table if not exists auth.identities (
  provider_id text not null, user_id uuid not null references auth.users(id) on delete cascade,
  identity_data jsonb not null, provider text not null, last_sign_in_at timestamptz,
  created_at timestamptz, updated_at timestamptz,
  email text generated always as (lower(identity_data ->> 'email')) stored,
  id uuid not null default gen_random_uuid() primary key,
  unique (provider_id, provider)
);
create or replace function auth.jwt() returns jsonb language sql stable as
$$ select coalesce(nullif(current_setting('request.jwt.claims', true), ''), '{}')::jsonb $$;
create or replace function auth.uid() returns uuid language sql stable as
$$ select nullif(auth.jwt() ->> 'sub', '')::uuid $$;
create or replace function auth.role() returns text language sql stable as
$$ select nullif(auth.jwt() ->> 'role', '') $$;
grant execute on function auth.jwt(), auth.uid(), auth.role() to anon, authenticated, service_role;

grant usage on schema public to anon, authenticated, service_role;
alter default privileges in schema public grant all on tables to anon, authenticated, service_role;
alter default privileges in schema public grant all on functions to anon, authenticated, service_role;
alter default privileges in schema public grant all on sequences to anon, authenticated, service_role;
```

- [ ] **Step 2: `scripts/db-local.sh`**

```bash
#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/.."
PGBIN=/usr/lib/postgresql/16/bin
BASE=/var/tmp/ebc-pg
PGDATA=$BASE/data
PORT=${EBC_PG_PORT:-54322}
DB=${EBC_DB:-ebc}
URL_BASE="postgresql://postgres@127.0.0.1:$PORT"
as_pg() { runuser -u postgres -- "$@"; }
psql_db() { "$PGBIN/psql" "$URL_BASE/$1" -v ON_ERROR_STOP=1 -q "${@:2}"; }

start() {
  if [ ! -s "$PGDATA/PG_VERSION" ]; then
    mkdir -p "$BASE" && chown postgres:postgres "$BASE"
    as_pg "$PGBIN/initdb" -D "$PGDATA" -U postgres --auth=trust -E UTF8 --locale=C.UTF-8 >/dev/null
  fi
  if ! as_pg "$PGBIN/pg_ctl" -D "$PGDATA" status >/dev/null 2>&1; then
    as_pg "$PGBIN/pg_ctl" -D "$PGDATA" -o "-p $PORT -k $BASE -c listen_addresses=127.0.0.1" -l "$BASE/server.log" -w start >/dev/null
  fi
}
apply() {
  for f in supabase/migrations/*.sql; do [ -e "$f" ] || continue; psql_db "$DB" -f "$f"; done
}
reset() {
  start
  psql_db postgres -c "drop database if exists \"$DB\" with (force)" -c "create database \"$DB\""
  psql_db "$DB" -f dev/db/bootstrap.sql
  apply
}
case "${1:-}" in
  start) start ;;
  stop) as_pg "$PGBIN/pg_ctl" -D "$PGDATA" -m fast stop ;;
  reset) reset ;;
  apply) start; apply ;;
  psql) start; "$PGBIN/psql" "$URL_BASE/$DB" ;;
  url) echo "$URL_BASE/$DB" ;;
  *) echo "usage: db-local.sh start|stop|reset|apply|psql|url" >&2; exit 2 ;;
esac
```

- [ ] **Step 3: `scripts/test-sql.sh` and `supabase/tests/00_helpers.sql`**

```bash
#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/.."
export EBC_DB=${EBC_DB:-ebc_test}
bash scripts/db-local.sh reset
URL=$(bash scripts/db-local.sh url)
fail=0
for f in supabase/tests/*.sql; do
  if /usr/lib/postgresql/16/bin/psql "$URL" -v ON_ERROR_STOP=1 -q -f "$f" >/tmp/ebc-sqltest.log 2>&1; then
    echo "PASS $f"
  else
    echo "FAIL $f"; cat /tmp/ebc-sqltest.log; fail=1
  fi
done
exit $fail
```

`supabase/tests/00_helpers.sql` (not wrapped in a transaction; later test files each run `begin; … rollback;`):

```sql
create schema if not exists tests;
grant usage on schema tests to anon, authenticated;
create table if not exists tests.ctx (k text primary key, v text);
grant all on tests.ctx to anon, authenticated;
create or replace function tests.set(p_k text, p_v text) returns void language sql as
$$ insert into tests.ctx(k, v) values (p_k, p_v) on conflict (k) do update set v = excluded.v $$;
create or replace function tests.get(p_k text) returns text language sql stable as
$$ select v from tests.ctx where k = p_k $$;
create or replace function tests.as_user(p_uid uuid) returns void language plpgsql as $$
begin
  perform set_config('request.jwt.claims', json_build_object('sub', p_uid, 'role', 'authenticated')::text, true);
  perform set_config('role', 'authenticated', true);
end $$;
create or replace function tests.as_anon() returns void language plpgsql as $$
begin
  perform set_config('request.jwt.claims', '{"role":"anon"}', true);
  perform set_config('role', 'anon', true);
end $$;
create or replace function tests.assert_raises(p_sql text, p_errcode text, p_msg_like text default null)
returns void language plpgsql as $$
begin
  begin
    execute p_sql;
  exception when others then
    if sqlstate <> p_errcode then
      raise exception 'expected errcode % but got % (%) for: %', p_errcode, sqlstate, sqlerrm, p_sql;
    end if;
    if p_msg_like is not null and sqlerrm not like p_msg_like then
      raise exception 'expected message like "%" but got "%"', p_msg_like, sqlerrm;
    end if;
    return;
  end;
  raise exception 'expected error % but statement succeeded: %', p_errcode, p_sql;
end $$;
grant execute on all functions in schema tests to anon, authenticated;
```

Test files switch roles with `select tests.as_user(tests.get('owner')::uuid);` and return to the superuser with `reset role;`. Keep test files free of psql meta-commands (they must also run through the Supabase MCP `execute_sql`).

- [ ] **Step 4: Shim — `dev/shim/jwt.mjs`**

```js
import { createHmac, timingSafeEqual } from 'node:crypto';
const b64u = (buf) => Buffer.from(buf).toString('base64url');
export function sign(payload, secret) {
  const head = b64u(JSON.stringify({ alg: 'HS256', typ: 'JWT' }));
  const body = b64u(JSON.stringify(payload));
  const sig = createHmac('sha256', secret).update(`${head}.${body}`).digest('base64url');
  return `${head}.${body}.${sig}`;
}
export function verify(token, secret) {
  const parts = String(token).split('.');
  if (parts.length !== 3) return null;
  const expected = createHmac('sha256', secret).update(`${parts[0]}.${parts[1]}`).digest();
  const got = Buffer.from(parts[2], 'base64url');
  if (got.length !== expected.length || !timingSafeEqual(got, expected)) return null;
  const payload = JSON.parse(Buffer.from(parts[1], 'base64url').toString());
  if (payload.exp && payload.exp * 1000 < Date.now()) return null;
  return payload;
}
```

- [ ] **Step 5: Shim — `dev/shim/server.mjs`** (Node `http` + `pg`; ~250 lines). Required behavior:
  - CORS on every response: `Access-Control-Allow-Origin: *`, `Access-Control-Allow-Headers: apikey, authorization, content-type, x-client-info, prefer, accept-profile, content-profile, x-supabase-api-version`, `Access-Control-Allow-Methods: GET, POST, PUT, PATCH, DELETE, OPTIONS`; `OPTIONS` → 204.
  - `pg.types.setTypeParser(20, Number)` and `setTypeParser(1700, Number)` so bigint/numeric are JSON numbers (PostgREST behavior).
  - Role resolution per request from `Authorization: Bearer <t>`: missing, or starting with `sb_publishable_` → `{role:'anon'}`; else `verify(t, secret)` → claims (role from claims); invalid → 401 `{"code":"PGRST301","message":"JWT invalid","details":null,"hint":null}`.
  - `POST /rest/v1/rpc/:fn` → load signature once per fn: `select p.proargnames, array(select format_type(t, null) from unnest(p.proargtypes) t) as types, format_type(p.prorettype, null) as rettype, p.pronargdefaults from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname = 'public' and p.proname = $1`. Not found → 404 `{"code":"PGRST202","message":"Could not find the function public.<fn> in the schema cache",...}`. Build `select public."<fn>"(<name> => $1::<type>, ...) as result` only for keys present in the body (missing keys fall back to SQL defaults); jsonb/json params get `JSON.stringify(value)`; array params pass the JS array; other params pass `value === null ? null : String(value)`. Execute in a transaction on a pooled client: `begin; select set_config('request.jwt.claims', $1, true); set local role <anon|authenticated|service_role>; <call>; commit;` (role name validated against that list before interpolation). Response: rettype `void` → 204; else 200 with `JSON.stringify(result)`.
  - PG errors → rollback, status 400 (401 if code `42501` and role anon, 403 if `42501` and authenticated), body `{ code, message, details: err.detail ?? null, hint: err.hint ?? null }`.
  - `POST /auth/v1/token?grant_type=password` body `{email,password}` → `select id, email, email_confirmed_at, raw_app_meta_data, raw_user_meta_data, created_at, updated_at, encrypted_password = extensions.crypt($2, encrypted_password) as ok from auth.users where lower(email) = lower($1) and deleted_at is null`; not ok → 400 `{"code":400,"error_code":"invalid_credentials","msg":"Invalid login credentials"}`; ok → update `last_sign_in_at`, respond GoTrue session: `{access_token, token_type:'bearer', expires_in:3600, expires_at, refresh_token, user}` where access token claims are `{aud:'authenticated', role:'authenticated', sub:id, email, exp, iat, session_id, app_metadata, user_metadata, is_anonymous:false}` and `user = {id, aud:'authenticated', role:'authenticated', email, email_confirmed_at, confirmed_at: email_confirmed_at, phone:'', last_sign_in_at, app_metadata, user_metadata, identities:[], created_at, updated_at, is_anonymous:false}`. Refresh tokens: random hex kept in an in-memory `Map(token → userId)`.
  - `POST /auth/v1/token?grant_type=refresh_token` body `{refresh_token}` → new session or 400 `{"code":400,"error_code":"refresh_token_not_found","msg":"Invalid Refresh Token: Refresh Token Not Found"}`.
  - `GET /auth/v1/user` (valid user JWT) → user object; `PUT /auth/v1/user` body `{password}` (≥ 8 chars) → `update auth.users set encrypted_password = extensions.crypt($1, extensions.gen_salt('bf', 10)), updated_at = now()` → user object; `POST /auth/v1/logout` → 204.
  - Connection: `postgresql://postgres@127.0.0.1:${EBC_PG_PORT||54322}/${EBC_DB||'ebc'}`. Log one line per request to stdout.

- [ ] **Step 6: `vitest.integration.config.ts` and failing test `tests/integration/shim.test.ts`**

```ts
// vitest.integration.config.ts
import { defineConfig } from 'vitest/config';
export default defineConfig({
  test: { include: ['tests/integration/**/*.test.ts'], environment: 'node', testTimeout: 30_000, hookTimeout: 120_000, fileParallelism: false },
});
```

```ts
// tests/integration/shim.test.ts
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { execSync, spawn, type ChildProcess } from 'node:child_process';
import pg from 'pg';
import { createClient } from '@supabase/supabase-js';

const DB = 'ebc_shim';
const PORT = 54391;
let shim: ChildProcess;
const url = `http://127.0.0.1:${PORT}`;
const pgUrl = () => execSync('bash scripts/db-local.sh url', { env: { ...process.env, EBC_DB: DB } }).toString().trim();

beforeAll(async () => {
  execSync('bash scripts/db-local.sh reset', { env: { ...process.env, EBC_DB: DB }, stdio: 'inherit' });
  const c = new pg.Client({ connectionString: pgUrl() });
  await c.connect();
  await c.query(`
    create function public.shim_echo(p_value jsonb, p_n int default 1) returns jsonb language sql as
      $$ select jsonb_build_object('value', p_value, 'n', p_n, 'role', current_user, 'uid', auth.uid()) $$;
    create function public.shim_fail() returns void language plpgsql as
      $$ begin raise exception 'Falhou' using errcode = 'P0001'; end $$;
    create function public.shim_bigint() returns bigint language sql as $$ select 1790000000000::bigint $$;
    insert into auth.users (instance_id, id, aud, role, email, encrypted_password, email_confirmed_at, raw_app_meta_data, raw_user_meta_data, created_at, updated_at)
    values ('00000000-0000-0000-0000-000000000000', '11111111-1111-1111-1111-111111111111', 'authenticated', 'authenticated',
            'tester@ebc.test', extensions.crypt('senha-123', extensions.gen_salt('bf')), now(), '{}', '{}', now(), now());
  `);
  await c.end();
  shim = spawn('node', ['dev/shim/server.mjs'], { env: { ...process.env, EBC_DB: DB, SHIM_PORT: String(PORT) }, stdio: 'ignore' });
  for (let i = 0; i < 50; i++) {
    try { await fetch(`${url}/rest/v1/`); break; } catch { await new Promise(r => setTimeout(r, 100)); }
  }
});
afterAll(() => { shim?.kill(); });

const client = () => createClient(url, 'sb_publishable_local_dev', { auth: { persistSession: false, autoRefreshToken: false } });

describe('local Supabase shim', () => {
  it('calls RPC as anon with defaults', async () => {
    const { data, error } = await client().rpc('shim_echo', { p_value: { a: 1 } });
    expect(error).toBeNull();
    expect(data).toEqual({ value: { a: 1 }, n: 1, role: 'anon', uid: null });
  });
  it('logs in with password and calls RPC as authenticated', async () => {
    const sb = client();
    const { error: e1 } = await sb.auth.signInWithPassword({ email: 'tester@ebc.test', password: 'senha-123' });
    expect(e1).toBeNull();
    const { data } = await sb.rpc('shim_echo', { p_value: null, p_n: 5 });
    expect(data).toMatchObject({ n: 5, role: 'authenticated', uid: '11111111-1111-1111-1111-111111111111' });
  });
  it('rejects wrong passwords', async () => {
    const { error } = await client().auth.signInWithPassword({ email: 'tester@ebc.test', password: 'errada' });
    expect(error?.message).toBe('Invalid login credentials');
  });
  it('maps SQL errors and bigint results like PostgREST', async () => {
    const { error } = await client().rpc('shim_fail');
    expect(error?.message).toBe('Falhou');
    expect(error?.code).toBe('P0001');
    const { data } = await client().rpc('shim_bigint');
    expect(data).toBe(1790000000000);
    const { error: e404 } = await client().rpc('nao_existe');
    expect(e404?.code).toBe('PGRST202');
  });
  it('updates the password', async () => {
    const sb = client();
    await sb.auth.signInWithPassword({ email: 'tester@ebc.test', password: 'senha-123' });
    const { error } = await sb.auth.updateUser({ password: 'nova-senha-456' });
    expect(error).toBeNull();
    const { error: e2 } = await client().auth.signInWithPassword({ email: 'tester@ebc.test', password: 'nova-senha-456' });
    expect(e2).toBeNull();
  });
});
```

- [ ] **Step 7: Run** `npm run test:integration -- tests/integration/shim.test.ts` → FAIL before the shim exists, PASS after Steps 4–5. Also `bash scripts/test-sql.sh` → prints `PASS supabase/tests/00_helpers.sql`.

- [ ] **Step 8: `scripts/dev-stack.sh`** — for manual/E2E use: `EBC_DB=${EBC_DB:-ebc}`; `bash scripts/db-local.sh reset`; seed the dev owner with `psql -c "select public.bootstrap_owner('master@ebc.local','ebc-dev-12345','Master Local'); update public.organizers set must_change_password=false;"` **only if** the function exists (guard with `select to_regproc('public.bootstrap_owner') is not null`); then `exec node dev/shim/server.mjs`.

- [ ] **Step 9: Commit** (`feat: local Supabase emulation for tests (bootstrap, scripts, auth/rpc shim)`).

---

