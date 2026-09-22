#!/usr/bin/env bash
set -euo pipefail

db_url="$(supabase status -o env | sed -n 's/^DB_URL=//p' | tr -d '"')"
[[ -n "$db_url" ]] || { echo "DB_URL was not reported by supabase status" >&2; exit 1; }

target_url="$(python3 - "$db_url" <<'PY'
import sys
from urllib.parse import urlparse, urlunparse

u = urlparse(sys.argv[1])
print(urlunparse((u.scheme, u.netloc, "/mercy_restore_test", u.params, u.query, u.fragment)))
PY
)"

dump_file="$(mktemp)"
cleanup() {
  set +e
  docker run --rm --network host postgres:17-alpine psql "$db_url" -v ON_ERROR_STOP=1     -c "drop database if exists mercy_restore_test with (force);" >/dev/null 2>&1
  docker run --rm --network host postgres:17-alpine psql "$db_url" -v ON_ERROR_STOP=1     -c "drop role if exists mercy_restore_reader;" >/dev/null 2>&1
  docker run --rm --network host postgres:17-alpine psql "$db_url" -v ON_ERROR_STOP=1     -c "drop role if exists mercy_restore_owner;" >/dev/null 2>&1
  rm -f "$dump_file"
}
trap cleanup EXIT

admin_psql() {
  docker run --rm --network host postgres:17-alpine psql "$db_url" -v ON_ERROR_STOP=1 "$@"
}

target_psql() {
  docker run --rm --network host postgres:17-alpine psql "$target_url" -v ON_ERROR_STOP=1 "$@"
}

admin_psql -c "drop database if exists mercy_restore_test with (force);" >/dev/null
admin_psql -c "drop role if exists mercy_restore_reader;" >/dev/null
admin_psql -c "drop role if exists mercy_restore_owner;" >/dev/null
admin_psql -c "create role mercy_restore_owner;" >/dev/null
admin_psql -c "create role mercy_restore_reader;" >/dev/null
admin_psql -c "grant mercy_restore_owner to postgres; grant mercy_restore_reader to postgres;" >/dev/null
admin_psql -c "create database mercy_restore_test owner mercy_restore_owner template template0;" >/dev/null

target_psql <<'SQL' >/dev/null
CREATE TABLE public.baseline_row(id integer primary key);
INSERT INTO public.baseline_row(id) VALUES (7);
ALTER TABLE public.baseline_row OWNER TO mercy_restore_owner;
GRANT SELECT ON public.baseline_row TO mercy_restore_reader;
SQL

[[ "$(target_psql -Atc "select to_regclass('public.baseline_row')::text;")" == "baseline_row" ]]

docker run --rm --network host postgres:17-alpine pg_dump "$target_url" -Fc > "$dump_file"
[[ -s "$dump_file" ]]
docker run --rm -i postgres:17-alpine pg_restore -l < "$dump_file" | grep "baseline_row" >/dev/null

target_psql -c "create table public.extra_after_backup(id integer);" >/dev/null

db_owner="$(admin_psql -Atc "select pg_get_userbyid(datdba) from pg_database where datname='mercy_restore_test';")"
[[ "$db_owner" == "mercy_restore_owner" ]]

admin_psql -c "drop database mercy_restore_test with (force);" >/dev/null
admin_psql -c "create database mercy_restore_test owner mercy_restore_owner template template0;" >/dev/null

docker run --rm -i --network host postgres:17-alpine pg_restore   --dbname="$target_url"   --exit-on-error   --single-transaction < "$dump_file"

[[ "$(target_psql -Atc "select coalesce(to_regclass('public.extra_after_backup')::text,'');")" == "" ]]
[[ "$(target_psql -Atc "select pg_get_userbyid(relowner) from pg_class where oid='public.baseline_row'::regclass;")" == "mercy_restore_owner" ]]
[[ "$(target_psql -Atc "select has_table_privilege('mercy_restore_reader','public.baseline_row','SELECT');")" == "t" ]]
[[ "$(target_psql -Atc "set role mercy_restore_reader; select id from public.baseline_row;")" == "SET
7" ]]

echo "Cutover recovery restore behavior verified against disposable PostgreSQL."
