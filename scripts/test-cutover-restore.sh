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
  docker run --rm --network host postgres:17-alpine psql "$db_url" -v ON_ERROR_STOP=1     -c "drop role if exists mercy_restore_stranger;" >/dev/null 2>&1
  docker run --rm --network host postgres:17-alpine psql "$db_url" -v ON_ERROR_STOP=1     -c "drop role if exists mercy_restore_reader;" >/dev/null 2>&1
  docker run --rm --network host postgres:17-alpine psql "$db_url" -v ON_ERROR_STOP=1     -c "drop role if exists mercy_restore_owner;" >/dev/null 2>&1
  rm -f "$dump_file"
}
trap cleanup EXIT

admin_psql() {
  docker run --rm --network host postgres:17-alpine psql "$db_url" -v ON_ERROR_STOP=1 "$@"
}

target_psql() {
  docker run --rm -i --network host postgres:17-alpine psql "$target_url" -v ON_ERROR_STOP=1 "$@"
}

admin_psql -c "drop database if exists mercy_restore_test with (force);" >/dev/null
admin_psql -c "drop role if exists mercy_restore_stranger;" >/dev/null
admin_psql -c "drop role if exists mercy_restore_reader;" >/dev/null
admin_psql -c "drop role if exists mercy_restore_owner;" >/dev/null
admin_psql -c "create role mercy_restore_owner;" >/dev/null
admin_psql -c "create role mercy_restore_reader;" >/dev/null
admin_psql -c "create role mercy_restore_stranger;" >/dev/null
admin_psql -c "grant mercy_restore_owner to postgres; grant mercy_restore_reader to postgres; grant mercy_restore_stranger to postgres;" >/dev/null
admin_psql -c "create database mercy_restore_test owner mercy_restore_owner template template0;" >/dev/null
admin_psql -c "revoke connect on database mercy_restore_test from public; grant connect on database mercy_restore_test to mercy_restore_reader; alter database mercy_restore_test set statement_timeout = '13s';" >/dev/null

target_psql <<'SQL' >/dev/null
CREATE TABLE public.baseline_row(id integer primary key);
INSERT INTO public.baseline_row(id) VALUES (7);
ALTER TABLE public.baseline_row OWNER TO mercy_restore_owner;
GRANT SELECT ON public.baseline_row TO mercy_restore_reader;
CREATE SCHEMA auth AUTHORIZATION supabase_auth_admin;
CREATE TABLE auth.users(id integer PRIMARY KEY);
ALTER TABLE auth.users OWNER TO supabase_auth_admin;
CREATE SCHEMA storage AUTHORIZATION supabase_storage_admin;
CREATE TABLE storage.buckets(id text PRIMARY KEY);
CREATE TABLE storage.objects(id integer PRIMARY KEY);
ALTER TABLE storage.buckets OWNER TO supabase_storage_admin;
ALTER TABLE storage.objects OWNER TO supabase_storage_admin;
CREATE TABLE public.rest_probe(id integer PRIMARY KEY);
INSERT INTO public.rest_probe(id) VALUES (9);
ALTER TABLE public.rest_probe ENABLE ROW LEVEL SECURITY;
CREATE POLICY rest_read ON public.rest_probe FOR SELECT TO anon USING (true);
GRANT SELECT ON public.rest_probe TO anon;
SQL

pre_baseline="$(target_psql -Atc "select coalesce(to_regclass('public.baseline_row')::text,'');")"
[[ "$pre_baseline" == "baseline_row" || "$pre_baseline" == "public.baseline_row" ]] || {
  echo "Baseline test relation was not created: $pre_baseline" >&2
  exit 1
}
echo "Recovery test baseline relation created."

docker run --rm --network host postgres:17-alpine pg_dump "$target_url" -Fc --create > "$dump_file"
[[ -s "$dump_file" ]] || { echo "Recovery test dump is empty" >&2; exit 1; }
docker run --rm -i postgres:17-alpine pg_restore --create --schema-only -f - < "$dump_file" | grep -E '^CREATE DATABASE mercy_restore_test([[:space:]]|;)' >/dev/null || {
  echo "Recovery test archive does not contain database creation metadata" >&2
  exit 1
}
echo "Recovery test archive contains database metadata."

target_psql <<'SQL' >/dev/null
CREATE TABLE public.help_requests(id integer PRIMARY KEY);
INSERT INTO auth.users(id) VALUES (1);
INSERT INTO storage.buckets(id) VALUES ('mercy');
INSERT INTO storage.objects(id) VALUES (1);
SQL
admin_psql -c "alter database mercy_restore_test set statement_timeout = '29s';" >/dev/null
echo "Recovery test post-backup mutation created."

admin_psql -c "drop database mercy_restore_test with (force);" >/dev/null
echo "Recovery test database dropped."

docker run --rm -i --network host postgres:17-alpine pg_restore   --dbname="$db_url"   --create   --exit-on-error < "$dump_file"

[[ "$(target_psql -Atc "select coalesce(to_regclass('public.extra_after_backup')::text,'');")" == "" ]]
[[ "$(target_psql -Atc "select pg_get_userbyid(relowner) from pg_class where oid='public.baseline_row'::regclass;")" == "mercy_restore_owner" ]]
[[ "$(target_psql -Atc "select has_table_privilege('mercy_restore_reader','public.baseline_row','SELECT');")" == "t" ]]
[[ "$(target_psql -Atc "set role mercy_restore_reader; select id from public.baseline_row;")" == "SET
7" ]]
[[ "$(admin_psql -Atc "select pg_get_userbyid(datdba) from pg_database where datname='mercy_restore_test';")" == "mercy_restore_owner" ]]
[[ "$(admin_psql -Atc "select has_database_privilege('mercy_restore_reader','mercy_restore_test','CONNECT');")" == "t" ]]
[[ "$(admin_psql -Atc "select has_database_privilege('mercy_restore_stranger','mercy_restore_test','CONNECT');")" == "f" ]]
[[ "$(target_psql -Atc "show statement_timeout;")" == "13s" ]]
[[ "$(target_psql -Atc "select (select count(*) from auth.users), coalesce(to_regclass('public.help_requests')::text,''), (select count(*) from storage.buckets), (select count(*) from storage.objects);")" == "0||0|0" ]]
[[ "$(target_psql -Atc "select pg_get_userbyid(relowner) from pg_class where oid='auth.users'::regclass;")" == "supabase_auth_admin" ]]
[[ "$(target_psql -Atc "select pg_get_userbyid(relowner) from pg_class where oid='storage.objects'::regclass;")" == "supabase_storage_admin" ]]
[[ "$(target_psql -Atc "set role supabase_auth_admin; select count(*) from auth.users;" | tail -n 1)" == "0" ]]
[[ "$(target_psql -Atc "set role supabase_storage_admin; select count(*) from storage.objects;" | tail -n 1)" == "0" ]]
[[ "$(target_psql -Atc "set role anon; select id from public.rest_probe;" | tail -n 1)" == "9" ]]
echo "Cutover recovery restore preserves database metadata, object ownership, grants, database settings and PUBLIC CONNECT denial."
