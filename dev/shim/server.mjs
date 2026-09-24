#!/usr/bin/env node
// Local emulation of Supabase GoTrue (password grant / refresh / user) and PostgREST RPC
// against a real local Postgres, so `@supabase/supabase-js` works unmodified in dev/tests.
// See dev/db/bootstrap.sql for the schema this relies on (auth.users, anon/authenticated/
// service_role roles, auth.uid()/role()/jwt() reading request.jwt.claims).
import http from 'node:http';
import crypto from 'node:crypto';
import pg from 'pg';
import { sign, verify } from './jwt.mjs';

// PostgREST returns bigint/numeric as plain JSON numbers, not strings.
pg.types.setTypeParser(20, Number); // int8/bigint
pg.types.setTypeParser(1700, Number); // numeric

const SHIM_PORT = Number(process.env.SHIM_PORT || 54321);
const EBC_DB = process.env.EBC_DB || 'ebc';
const EBC_PG_PORT = Number(process.env.EBC_PG_PORT || 54322);
const JWT_SECRET = process.env.SHIM_JWT_SECRET || 'ebc-local-dev-jwt-secret-0123456789abcdef';

const pool = new pg.Pool({
  connectionString: `postgresql://postgres@127.0.0.1:${EBC_PG_PORT}/${EBC_DB}`,
});

const ALLOWED_ROLES = ['anon', 'authenticated', 'service_role'];
const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers':
    'apikey, authorization, content-type, x-client-info, prefer, accept-profile, content-profile, x-supabase-api-version',
  'Access-Control-Allow-Methods': 'GET, POST, PUT, PATCH, DELETE, OPTIONS',
};

// refresh_token (random hex) -> user id. In-memory only; reset when the shim restarts.
const refreshTokens = new Map();
// function name -> { proargnames, types, rettype, pronargdefaults } | null (not found), cached
// for the lifetime of the process (see dev/db/bootstrap.sql / migrations for what can exist).
const signatureCache = new Map();

function quoteIdent(name) {
  return `"${String(name).replace(/"/g, '""')}"`;
}

function sendJson(res, status, body) {
  const text = JSON.stringify(body);
  res.writeHead(status, { ...CORS_HEADERS, 'Content-Type': 'application/json' });
  res.end(text);
}

function sendNoContent(res, status = 204) {
  res.writeHead(status, CORS_HEADERS);
  res.end();
}

function authError(res, status, error_code, msg) {
  sendJson(res, status, { code: status, error_code, msg });
}

function readJsonBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    req.on('data', (chunk) => chunks.push(chunk));
    req.on('end', () => {
      if (chunks.length === 0) return resolve({});
      try {
        resolve(JSON.parse(Buffer.concat(chunks).toString('utf8')));
      } catch {
        resolve({});
      }
    });
    req.on('error', reject);
  });
}

// Resolves the Postgres role + `request.jwt.claims` payload for a REST/RPC request.
// Returns null when the Authorization header carries a token that fails verification
// (the caller responds 401 PGRST301, mirroring PostgREST's own JWT validation error).
function resolveRestAuth(req) {
  const header = req.headers['authorization'];
  if (!header) return { role: 'anon', claims: { role: 'anon' } };
  const token = header.replace(/^Bearer\s+/i, '').trim();
  if (!token || token.startsWith('sb_publishable_')) {
    return { role: 'anon', claims: { role: 'anon' } };
  }
  const claims = verify(token, JWT_SECRET);
  if (!claims || !ALLOWED_ROLES.includes(claims.role)) return null;
  return { role: claims.role, claims };
}

// Resolves the signed-in user's claims for GoTrue's own /auth/v1/user endpoints. Unlike
// resolveRestAuth there is no anon fallback: a missing/invalid/non-user token is always
// "not signed in".
function resolveUserAuth(req) {
  const header = req.headers['authorization'];
  if (!header) return null;
  const token = header.replace(/^Bearer\s+/i, '').trim();
  const claims = verify(token, JWT_SECRET);
  if (!claims || !claims.sub) return null;
  return claims;
}

function toUserJson(row) {
  return {
    id: row.id,
    aud: 'authenticated',
    role: 'authenticated',
    email: row.email,
    email_confirmed_at: row.email_confirmed_at,
    confirmed_at: row.email_confirmed_at,
    phone: '',
    last_sign_in_at: row.last_sign_in_at,
    app_metadata: row.raw_app_meta_data,
    user_metadata: row.raw_user_meta_data,
    identities: [],
    created_at: row.created_at,
    updated_at: row.updated_at,
    is_anonymous: false,
  };
}

function issueSession(row) {
  const iat = Math.floor(Date.now() / 1000);
  const exp = iat + 3600;
  const claims = {
    aud: 'authenticated',
    role: 'authenticated',
    sub: row.id,
    email: row.email,
    exp,
    iat,
    session_id: crypto.randomUUID(),
    app_metadata: row.raw_app_meta_data,
    user_metadata: row.raw_user_meta_data,
    is_anonymous: false,
  };
  const access_token = sign(claims, JWT_SECRET);
  const refresh_token = crypto.randomBytes(24).toString('hex');
  refreshTokens.set(refresh_token, row.id);
  return {
    access_token,
    token_type: 'bearer',
    expires_in: 3600,
    expires_at: exp,
    refresh_token,
    user: toUserJson(row),
  };
}

const USER_FIELDS =
  'id, email, email_confirmed_at, raw_app_meta_data, raw_user_meta_data, created_at, updated_at, last_sign_in_at';

async function handlePasswordGrant(res, body) {
  const email = body.email ?? '';
  const password = body.password ?? '';
  const { rows } = await pool.query(
    `select ${USER_FIELDS},
            encrypted_password = extensions.crypt($2, encrypted_password) as ok
     from auth.users where lower(email) = lower($1) and deleted_at is null`,
    [email, password]
  );
  const row = rows[0];
  if (!row || !row.ok) {
    return authError(res, 400, 'invalid_credentials', 'Invalid login credentials');
  }
  const { rows: updated } = await pool.query(
    `update auth.users set last_sign_in_at = now() where id = $1 returning last_sign_in_at`,
    [row.id]
  );
  row.last_sign_in_at = updated[0].last_sign_in_at;
  sendJson(res, 200, issueSession(row));
}

async function handleRefreshGrant(res, body) {
  const token = body.refresh_token;
  const userId = token ? refreshTokens.get(token) : undefined;
  if (!userId) {
    return authError(res, 400, 'refresh_token_not_found', 'Invalid Refresh Token: Refresh Token Not Found');
  }
  refreshTokens.delete(token);
  const { rows } = await pool.query(
    `select ${USER_FIELDS} from auth.users where id = $1 and deleted_at is null`,
    [userId]
  );
  const row = rows[0];
  if (!row) {
    return authError(res, 400, 'refresh_token_not_found', 'Invalid Refresh Token: Refresh Token Not Found');
  }
  sendJson(res, 200, issueSession(row));
}

async function handleGetUser(req, res) {
  const auth = resolveUserAuth(req);
  if (!auth) return authError(res, 401, 'bad_jwt', 'invalid JWT');
  const { rows } = await pool.query(
    `select ${USER_FIELDS} from auth.users where id = $1 and deleted_at is null`,
    [auth.sub]
  );
  if (!rows[0]) return authError(res, 401, 'bad_jwt', 'invalid JWT');
  sendJson(res, 200, toUserJson(rows[0]));
}

async function handleUpdateUser(req, res, body) {
  const auth = resolveUserAuth(req);
  if (!auth) return authError(res, 401, 'bad_jwt', 'invalid JWT');
  const password = body.password;
  if (typeof password !== 'string' || password.length < 8) {
    return sendJson(res, 422, {
      code: 422,
      error_code: 'weak_password',
      msg: 'Password should be at least 8 characters.',
      weak_password: { reasons: ['length'] },
    });
  }
  const { rows } = await pool.query(
    `update auth.users
       set encrypted_password = extensions.crypt($1, extensions.gen_salt('bf', 10)), updated_at = now()
     where id = $2 returning ${USER_FIELDS}`,
    [password, auth.sub]
  );
  if (!rows[0]) return authError(res, 401, 'bad_jwt', 'invalid JWT');
  sendJson(res, 200, toUserJson(rows[0]));
}

// Looks up a public function's argument names/types and return type once per name (PostgREST
// resolves this from its schema cache; we just query pg_proc and cache the result).
async function loadSignature(fn) {
  if (signatureCache.has(fn)) return signatureCache.get(fn);
  const { rows } = await pool.query(
    `select p.proargnames,
            array(select format_type(t, null) from unnest(p.proargtypes) t) as types,
            format_type(p.prorettype, null) as rettype,
            p.pronargdefaults
     from pg_proc p join pg_namespace n on n.oid = p.pronamespace
     where n.nspname = 'public' and p.proname = $1`,
    [fn]
  );
  const sig = rows[0] ?? null;
  signatureCache.set(fn, sig);
  return sig;
}

function notFoundError(fn) {
  return {
    code: 'PGRST202',
    message: `Could not find the function public.${fn} in the schema cache`,
    details: `Searched for the function public.${fn} in the schema cache, but no matches were found.`,
    hint: null,
  };
}

// Builds `select public."<fn>"(<name> => $1::<type>, ...) as result`, including only the
// keys present in the request body (missing keys fall back to the function's SQL defaults).
function buildRpcCall(fn, sig, body) {
  const args = body && typeof body === 'object' ? body : {};
  const names = sig.proargnames ?? [];
  const types = sig.types ?? [];
  const parts = [];
  const values = [];
  names.forEach((name, i) => {
    if (!Object.prototype.hasOwnProperty.call(args, name)) return;
    const type = types[i];
    const raw = args[name];
    let value;
    if (type === 'jsonb' || type === 'json') value = JSON.stringify(raw);
    else if (type.endsWith('[]')) value = raw;
    else value = raw === null ? null : String(raw);
    values.push(value);
    parts.push(`${name} => $${values.length}::${type}`);
  });
  return { sql: `select public.${quoteIdent(fn)}(${parts.join(', ')}) as result`, values };
}

function mapPgErrorStatus(err, role) {
  if (err.code === '42501') {
    if (role === 'anon') return 401;
    if (role === 'authenticated') return 403;
  }
  return 400;
}

async function handleRpc(req, res, fn, body) {
  const auth = resolveRestAuth(req);
  if (!auth) {
    return sendJson(res, 401, { code: 'PGRST301', message: 'JWT invalid', details: null, hint: null });
  }

  const sig = await loadSignature(fn);
  if (!sig) return sendJson(res, 404, notFoundError(fn));

  const { sql, values } = buildRpcCall(fn, sig, body);
  const client = await pool.connect();
  try {
    await client.query('begin');
    await client.query(`select set_config('request.jwt.claims', $1, true)`, [JSON.stringify(auth.claims)]);
    await client.query(`set local role ${auth.role}`);
    const result = await client.query(sql, values);
    await client.query('commit');
    if (sig.rettype === 'void') return sendNoContent(res);
    const value = result.rows[0] ? result.rows[0].result : null;
    return sendJson(res, 200, value);
  } catch (err) {
    await client.query('rollback').catch(() => {});
    return sendJson(res, mapPgErrorStatus(err, auth.role), {
      code: err.code ?? null,
      message: err.message,
      details: err.detail ?? null,
      hint: err.hint ?? null,
    });
  } finally {
    client.release();
  }
}

const server = http.createServer((req, res) => {
  const started = Date.now();
  const url = new URL(req.url, 'http://127.0.0.1');
  res.on('finish', () => {
    console.log(`${req.method} ${url.pathname} -> ${res.statusCode} (${Date.now() - started}ms)`);
  });

  if (req.method === 'OPTIONS') return sendNoContent(res, 204);

  (async () => {
    try {
      if (req.method === 'POST' && url.pathname.startsWith('/rest/v1/rpc/')) {
        const fn = decodeURIComponent(url.pathname.slice('/rest/v1/rpc/'.length));
        const body = await readJsonBody(req);
        return await handleRpc(req, res, fn, body);
      }
      if (req.method === 'POST' && url.pathname === '/auth/v1/token') {
        const body = await readJsonBody(req);
        const grant = url.searchParams.get('grant_type');
        if (grant === 'password') return await handlePasswordGrant(res, body);
        if (grant === 'refresh_token') return await handleRefreshGrant(res, body);
        return authError(res, 400, 'unsupported_grant_type', `Unsupported grant type: ${grant}`);
      }
      if (req.method === 'GET' && url.pathname === '/auth/v1/user') {
        return await handleGetUser(req, res);
      }
      if (req.method === 'PUT' && url.pathname === '/auth/v1/user') {
        const body = await readJsonBody(req);
        return await handleUpdateUser(req, res, body);
      }
      if (req.method === 'POST' && url.pathname === '/auth/v1/logout') {
        return sendNoContent(res, 204);
      }
      return sendJson(res, 404, { code: 'not_found', message: 'not found', details: null, hint: null });
    } catch (err) {
      console.error('shim request failed:', err);
      if (!res.headersSent) {
        sendJson(res, 500, {
          code: 'internal_error',
          message: err && err.message ? err.message : String(err),
          details: null,
          hint: null,
        });
      }
    }
  })();
});

server.listen(SHIM_PORT, '127.0.0.1', () => {
  console.log(`shim: listening on http://127.0.0.1:${SHIM_PORT} (db=${EBC_DB} pg_port=${EBC_PG_PORT})`);
});
