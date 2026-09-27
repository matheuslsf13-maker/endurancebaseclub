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
