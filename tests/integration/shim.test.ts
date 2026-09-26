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
    -- 0006's grants (revoke execute on all functions, plus the role-global default-privileges
    -- revoke from public per Ruling 35) mean a function created here, after the migrations have
    -- already run, is no longer PUBLIC-executable by default. These probe functions exist only to
    -- exercise the shim's own RPC/error/bigint plumbing, not the app's grant model, so grant them
    -- explicitly (and only them) rather than weakening 0006 or dev/db/bootstrap.sql.
    grant execute on function public.shim_echo(jsonb, int), public.shim_fail(), public.shim_bigint()
      to anon, authenticated;
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
