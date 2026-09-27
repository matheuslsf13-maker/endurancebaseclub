// Shared stack bootstrap for tests/integration/*.test.ts: resets a local Postgres database,
// applies dev/db/bootstrap.sql + supabase/migrations/*, spawns the shim (dev/shim/server.mjs)
// bound to that database on its own port, and waits until it answers HTTP. Mirrors the pattern in
// tests/integration/shim.test.ts (kept there unmodified; this file is the reusable version).
import { execSync, spawn, type ChildProcess } from 'node:child_process';
import pg from 'pg';

export interface Stack {
  url: string;
  stop(): void;
  sql(q: string, params?: unknown[]): Promise<any[]>;
}

const READY_POLL_MS = 100;
const READY_ATTEMPTS = 50;

/**
 * Resets database `db` (drop + recreate + bootstrap.sql + migrations), spawns the shim on `port`
 * against it, and waits until it responds. Callers own the same database name for the lifetime of
 * one test file so parallel agents on this machine never collide (see CLAUDE.md / task briefs).
 */
export async function startStack(db: string, port: number): Promise<Stack> {
  const env = { ...process.env, EBC_DB: db };
  execSync('bash scripts/db-local.sh reset', { env, stdio: 'inherit' });
  const pgUrl = execSync('bash scripts/db-local.sh url', { env }).toString().trim();
  const pool = new pg.Pool({ connectionString: pgUrl });

  const url = `http://127.0.0.1:${port}`;
  const shim: ChildProcess = spawn('node', ['dev/shim/server.mjs'], {
    env: { ...process.env, EBC_DB: db, SHIM_PORT: String(port) },
    stdio: 'ignore',
  });

  let ready = false;
  for (let i = 0; i < READY_ATTEMPTS; i++) {
    try {
      await fetch(`${url}/rest/v1/`);
      ready = true;
      break;
    } catch {
      await new Promise((resolve) => setTimeout(resolve, READY_POLL_MS));
    }
  }
  if (!ready) {
    shim.kill('SIGKILL');
    await pool.end().catch(() => {});
    throw new Error(`shim on port ${port} (db=${db}) never became ready`);
  }

  let stopped = false;
  return {
    url,
    stop() {
      if (stopped) return;
      stopped = true;
      // SIGTERM first so the shim's http server can close its listener cleanly; a SIGKILL shortly
      // after guarantees no orphan node process survives a slow/hung shutdown even if a test failed
      // mid-request (this runs from afterAll, including on failure).
      shim.kill('SIGTERM');
      const killTimer = setTimeout(() => {
        if (shim.exitCode === null && shim.signalCode === null) shim.kill('SIGKILL');
      }, 2000);
      killTimer.unref();
      pool.end().catch(() => {});
    },
    async sql(q: string, params: unknown[] = []) {
      const res = await pool.query(q, params);
      return res.rows;
    },
  };
}
