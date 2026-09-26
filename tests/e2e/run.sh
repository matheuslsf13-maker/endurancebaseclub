#!/usr/bin/env bash
# End-to-end run of the whole app like an event day (Task 28): local Postgres + auth/RPC shim +
# production build served by `vite preview`, driven by agent-browser through tests/e2e/0N_*.sh.
# Usage (Linux/WSL, as root for the local Postgres): bash tests/e2e/run.sh
set -euo pipefail
cd "$(dirname "$0")/../.."

export EBC_DB=ebc_e2e SHIM_PORT=54321
export NO_PROXY="127.0.0.1,localhost${NO_PROXY:+,$NO_PROXY}"
ART=tests/e2e/artifacts
PGBIN=/usr/lib/postgresql/16/bin
mkdir -p "$ART"
# Fresh artifacts every run (the folder itself is kept for .gitkeep).
find "$ART" -mindepth 1 ! -name .gitkeep -delete

CURRENT='setup'
cleanup() {
  local rc=$?
  agent-browser close --all >/dev/null 2>&1 || true
  # shellcheck disable=SC2046
  kill $(jobs -p) >/dev/null 2>&1 || true
  # npx may leave its vite child behind; the shim is a direct child and is already gone.
  pkill -f 'vite[ ]preview --mode e2e' >/dev/null 2>&1 || true
  wait >/dev/null 2>&1 || true
  if [ "$rc" -eq 0 ]; then echo "E2E PASS"; else echo "E2E FAIL in $CURRENT (exit $rc) — see $ART/"; fi
}
trap cleanup EXIT

wait_http() { # url label
  for _ in $(seq 1 120); do
    if [ "$(curl -s -o /dev/null -w '%{http_code}' "$1" || true)" != 000 ]; then return 0; fi
    sleep 0.5
  done
  echo "$2 did not start" >&2
  return 1
}

echo "--- database $EBC_DB"
agent-browser close --all >/dev/null 2>&1 || true
bash scripts/db-local.sh reset
# must_change_password stays true: scenario 01 goes through the forced password change.
"$PGBIN/psql" "$(bash scripts/db-local.sh url)" -v ON_ERROR_STOP=1 -qAt \
  -c "select public.bootstrap_owner('master@ebc.local','ebc-dev-12345','Master E2E')" >/dev/null

echo "--- shim :$SHIM_PORT"
node dev/shim/server.mjs >"$ART/shim.log" 2>&1 &
wait_http "http://127.0.0.1:$SHIM_PORT/rest/v1/" shim

echo "--- build (mode e2e) + preview :4173"
npx vite build --mode e2e >"$ART/build.log" 2>&1
npx vite preview --mode e2e --port 4173 --strictPort >"$ART/preview.log" 2>&1 &
wait_http "http://127.0.0.1:4173/" preview

for script in 01_master_setup 02_timing 03_review_results 04_public_offline; do
  CURRENT=$script
  echo "=== $script"
  bash "tests/e2e/$script.sh"
done
CURRENT='done'
