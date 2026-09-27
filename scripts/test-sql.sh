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
