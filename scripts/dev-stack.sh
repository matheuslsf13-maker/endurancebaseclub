#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/.."
export EBC_DB=${EBC_DB:-ebc}
PGBIN=/usr/lib/postgresql/16/bin
PORT=${EBC_PG_PORT:-54322}

bash scripts/db-local.sh reset

HAS_BOOTSTRAP_OWNER=$("$PGBIN/psql" "postgresql://postgres@127.0.0.1:$PORT/$EBC_DB" -tA -v ON_ERROR_STOP=1 \
  -c "select to_regproc('public.bootstrap_owner') is not null")
if [ "$HAS_BOOTSTRAP_OWNER" = "t" ]; then
  "$PGBIN/psql" "postgresql://postgres@127.0.0.1:$PORT/$EBC_DB" -v ON_ERROR_STOP=1 \
    -c "select public.bootstrap_owner('master@ebc.local','ebc-dev-12345','Master Local'); update public.organizers set must_change_password=false;"
fi

exec node dev/shim/server.mjs
