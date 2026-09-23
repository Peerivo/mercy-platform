#!/usr/bin/env bash
set -euo pipefail
trap 'echo "Disposable recovery assertion failed at line ${LINENO}" >&2' ERR

# Exercise the production sanitizer with a simulated failed restore; the SQL
# contains a sentinel which must never appear in its diagnostic output.
classifier="$(sed -n '/^# BEGIN_SAFE_PG_RESTORE_CLASSIFIER$/,/^# END_SAFE_PG_RESTORE_CLASSIFIER$/p' scripts/cutover-beget.sh)"
[[ -n "$classifier" ]] || { echo "Restore diagnostic classifier missing" >&2; exit 1; }
eval "$classifier"
simulated_error=$'pg_restore: error: could not execute query: ERROR: permission denied to set parameter "app.settings.jwt_secret"\npg_restore: from TOC entry 4321; 0 0 DATABASE PROPERTIES postgres\nCommand was: ALTER DATABASE postgres SET "app.settings.jwt_secret" TO fixture-secret-do-not-log;'
safe_result="$(classify_restore_error "$simulated_error")"
[[ "$safe_result" == "category=restricted_parameter toc=4321" ]]
[[ "$safe_result" != *"fixture-secret-do-not-log"* ]]

db_url="$(supabase status -o env | sed -n 's/^DB_URL=//p' | tr -d '"')"
[[ -n "$db_url" ]] || { echo "DB_URL was not reported by supabase status" >&2; exit 1; }

db_container="supabase_db_mercy-platform-integration"
[[ "$(docker exec "$db_container" psql -U supabase_admin -d template1 -Atc 'select rolsuper from pg_roles where rolname=current_user')" == "t" ]] || {
  echo "Disposable Supabase lacks the administrative restore role" >&2
  exit 1
}

target_url="$(python3 - "$db_url" <<'PY'
import sys
from urllib.parse import urlparse, urlunparse

u = urlparse(sys.argv[1])
print(urlunparse((u.scheme, u.netloc, "/mercy_restore_test", u.params, u.query, u.fragment)))
PY
)"

dump_file="$(mktemp)"
test_main_list=""
test_acl_list=""
cleanup() {
  if [[ -n "$test_main_list" ]]; then docker exec "$db_container" rm -f "$test_main_list" >/dev/null 2>&1; fi
  if [[ -n "$test_acl_list" ]]; then docker exec "$db_container" rm -f "$test_acl_list" >/dev/null 2>&1; fi
  set +e
  docker run --rm --network host postgres:17-alpine psql "$db_url" -v ON_ERROR_STOP=1     -c "drop database if exists mercy_restore_test with (force);" >/dev/null 2>&1
  docker run --rm --network host postgres:17-alpine psql "$db_url" -v ON_ERROR_STOP=1     -c "drop role if exists mercy_restore_stranger;" >/dev/null 2>&1
  for role in mercy_restore_auth mercy_restore_storage mercy_restore_rest; do
    docker run --rm --network host postgres:17-alpine psql "$db_url" -v ON_ERROR_STOP=1 -c "drop role if exists ${role};" >/dev/null 2>&1
  done
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
for role in mercy_restore_auth mercy_restore_storage mercy_restore_rest; do
  admin_psql -c "drop role if exists ${role};" >/dev/null
  admin_psql -c "create role ${role}; grant ${role} to postgres;" >/dev/null
done
admin_psql -c "grant mercy_restore_owner to postgres; grant mercy_restore_reader to postgres; grant mercy_restore_stranger to postgres;" >/dev/null
admin_psql -c "create database mercy_restore_test owner mercy_restore_owner template template0;" >/dev/null
admin_psql -c "revoke connect on database mercy_restore_test from public; grant connect on database mercy_restore_test to mercy_restore_reader, mercy_restore_rest; alter database mercy_restore_test set statement_timeout = '13s';" >/dev/null
# A database-level custom GUC requires the Supabase superuser during restore.
# This harmless fixture value exercises the same archive path as self-hosted JWT metadata.
docker exec "$db_container" psql -U supabase_admin -d postgres -v ON_ERROR_STOP=1 \
  -c "alter database mercy_restore_test set \"app.settings.jwt_secret\" to 'fixture-only';" >/dev/null

target_psql <<'SQL' >/dev/null
CREATE TABLE public.baseline_row(id integer primary key);
INSERT INTO public.baseline_row(id) VALUES (7);
ALTER TABLE public.baseline_row OWNER TO mercy_restore_owner;
GRANT SELECT ON public.baseline_row TO mercy_restore_reader;
CREATE SCHEMA auth AUTHORIZATION mercy_restore_auth;
CREATE TABLE auth.users(id integer PRIMARY KEY);
ALTER TABLE auth.users OWNER TO mercy_restore_auth;
CREATE SCHEMA storage AUTHORIZATION mercy_restore_storage;
CREATE TABLE storage.buckets(id text PRIMARY KEY);
CREATE TABLE storage.objects(id integer PRIMARY KEY);
ALTER TABLE storage.buckets OWNER TO mercy_restore_storage;
ALTER TABLE storage.objects OWNER TO mercy_restore_storage;
CREATE TABLE public.rest_probe(id integer PRIMARY KEY);
INSERT INTO public.rest_probe(id) VALUES (9);
ALTER TABLE public.rest_probe ENABLE ROW LEVEL SECURITY;
CREATE POLICY rest_read ON public.rest_probe FOR SELECT TO mercy_restore_rest USING (true);
GRANT SELECT ON public.rest_probe TO mercy_restore_rest;
SQL

# Include a real pg_graphql extension, schema, wrapper and ACL in the
# disposable archive to exercise the production read-only context selector.
target_psql <<'SQL' >/dev/null
CREATE SCHEMA graphql;
CREATE SCHEMA graphql_public;
GRANT USAGE ON SCHEMA graphql_public TO mercy_restore_rest;
SQL
docker exec "$db_container" psql -U supabase_admin -d mercy_restore_test -v ON_ERROR_STOP=1 \
  -c "create extension pg_graphql with schema graphql;" >/dev/null
target_psql <<'SQL' >/dev/null
GRANT USAGE ON SCHEMA graphql TO mercy_restore_rest;
GRANT EXECUTE ON ALL FUNCTIONS IN SCHEMA graphql TO mercy_restore_rest;
SQL
docker exec -i "$db_container" psql -U supabase_admin -d mercy_restore_test -v ON_ERROR_STOP=1 >/dev/null <<'SQL'
CREATE FUNCTION graphql_public.graphql("operationName" text DEFAULT NULL, query text DEFAULT NULL,
  variables jsonb DEFAULT NULL, extensions jsonb DEFAULT NULL)
RETURNS jsonb LANGUAGE sql AS 'select graphql.resolve(query := query, variables := coalesce(variables, ''{}''::jsonb), "operationName" := "operationName", extensions := extensions)';
ALTER EXTENSION pg_graphql ADD FUNCTION graphql_public.graphql(text,text,jsonb,jsonb);
REVOKE ALL ON FUNCTION graphql_public.graphql(text,text,jsonb,jsonb) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION graphql_public.graphql(text,text,jsonb,jsonb) TO mercy_restore_rest;
SQL

pre_baseline="$(target_psql -Atc "select coalesce(to_regclass('public.baseline_row')::text,'');")"
[[ "$pre_baseline" == "baseline_row" || "$pre_baseline" == "public.baseline_row" ]] || {
  echo "Baseline test relation was not created: $pre_baseline" >&2
  exit 1
}
echo "Recovery test baseline relation created."

docker run --rm --network host postgres:17-alpine pg_dump "$target_url" -Fc > "$dump_file"
[[ -s "$dump_file" ]] || { echo "Recovery test dump is empty" >&2; exit 1; }
docker run --rm -i postgres:17-alpine pg_restore --create --schema-only -f - < "$dump_file" | grep -E '^CREATE DATABASE mercy_restore_test([[:space:]]|;)' >/dev/null || {
  echo "Recovery test archive does not contain database creation metadata" >&2
  exit 1
}
echo "Recovery test archive contains database metadata."

# Exercise the exact read-only TOC lookup used by the protected archive
# inspection workflow against an actual custom-format backup entry.
toc_listing="$(docker run --rm -i postgres:17-alpine pg_restore -l < "$dump_file")"
expected_toc_entry="$(printf '%s\n' "$toc_listing" |
  awk '$1 ~ /^[0-9]+;$/ {print; exit}')"
[[ -n "$expected_toc_entry" ]] || { echo "Archive TOC contains no numeric entry" >&2; exit 1; }
toc_id="$(printf '%s\n' "$expected_toc_entry" | awk '{sub(/;/, "", $1); print $1}')"
[[ "$toc_id" =~ ^[0-9]+$ ]]
actual_toc_entry="$(printf '%s\n' "$toc_listing" |
  awk -v id="$toc_id" '$1 == id ";" && !found {entry=$0; found=1} END {if(found) print entry}')"
[[ "$actual_toc_entry" == "$expected_toc_entry" ]] || {
  echo "Exact TOC entry lookup returned the wrong object" >&2
  exit 1
}
missing_toc_entry="$(printf '%s\n' "$toc_listing" |
  awk -v id="999999999" '$1 == id ";" && !found {entry=$0; found=1} END {if(found) print entry}')"
[[ -z "$missing_toc_entry" ]]
# The first match precedes far more than a pipe buffer of output. Early exit
# would SIGPIPE the producer under pipefail; the production selector consumes it.
large_toc_entry="$(
  { printf '1; 0 0 TABLE public baseline_row postgres\n'
    seq 2 50000 | sed 's/$/; 0 0 TABLE public filler postgres/'
  } | awk -v id="1" '$1 == id ";" && !found {entry=$0; found=1} END {if(found) print entry}'
)"
[[ "$large_toc_entry" == "1; 0 0 TABLE public baseline_row postgres" ]]
echo "Recovery test archive index exact entry lookup passed."

# Run the same bounded selector as the protected workflow on the actual
# custom-format archive, including the independent schema/extension rows.
graphql_entries="$(printf '%s\n' "$toc_listing" |
  awk 'index($0, " SCHEMA - graphql_public ") ||
       index($0, " EXTENSION - pg_graphql ") ||
       (index($0, " graphql_public ") && index($0, "graphql(")) {print}')"
[[ -n "$graphql_entries" ]]
mapfile -t graphql_rows <<< "$graphql_entries"
(( ${#graphql_rows[@]} <= 20 ))
printf '%s\n' "$graphql_entries" | grep -F ' SCHEMA - graphql_public ' >/dev/null
printf '%s\n' "$graphql_entries" | grep -F ' EXTENSION - pg_graphql ' >/dev/null
if printf '%s\n' "$graphql_entries" | grep -F ' FUNCTION graphql_public graphql(' >/dev/null; then
  echo "Disposable GraphQL wrapper must be omitted as an extension member" >&2; exit 1
fi
printf '%s\n' "$graphql_entries" | grep -F ' ACL graphql_public FUNCTION graphql(' >/dev/null
echo "Recovery test GraphQL archive reproduces schema, extension and orphan ACL."

target_psql <<'SQL' >/dev/null
CREATE TABLE public.help_requests(id integer PRIMARY KEY);
INSERT INTO auth.users(id) VALUES (1);
INSERT INTO storage.buckets(id) VALUES ('mercy');
INSERT INTO storage.objects(id) VALUES (1);
SQL
admin_psql -c "alter database mercy_restore_test set statement_timeout = '29s';" >/dev/null
[[ "$(target_psql -Atc 'show statement_timeout;')" == "29s" ]]
echo "Recovery test post-backup mutation created."

admin_psql -c "drop database mercy_restore_test with (force);" >/dev/null
echo "Recovery test database dropped."

# The function is an extension member: pg_dump omits its definition but keeps
# its ACL. Apply all other archive entries first, create the canonical wrapper,
# then replay the archived ACL exactly as production recovery does.
graphql_acl="$(printf '%s\n' "$toc_listing" |
  awk 'index($0, " ACL graphql_public FUNCTION graphql(\"operationName\" text, query text, variables jsonb, extensions jsonb) ") {print}')"
[[ "$(printf '%s\n' "$graphql_acl" | wc -l)" == "1" ]]
graphql_acl_id="${graphql_acl%%;*}"
[[ "$graphql_acl_id" =~ ^[0-9]+$ ]]
test_main_list="$(docker exec "$db_container" mktemp /tmp/mercy-restore-test-main.XXXXXXXX)"
test_acl_list="$(docker exec "$db_container" mktemp /tmp/mercy-restore-test-acl.XXXXXXXX)"
printf '%s\n' "$toc_listing" |
  awk -v id="$graphql_acl_id" '$1 == id ";" {$0=";" $0} {print}' |
  docker exec -i "$db_container" sh -c 'cat > "$1"' sh "$test_main_list"
printf '%s\n' "$graphql_acl" |
  docker exec -i "$db_container" sh -c 'cat > "$1"' sh "$test_acl_list"
docker exec -i "$db_container" pg_restore -U supabase_admin -d postgres --create --exit-on-error \
  --use-list="$test_main_list" < "$dump_file"
printf 'Fixture database TOC entry types: %s\n' "$(printf '%s\n' "$toc_listing" | awk 'index($0, " DATABASE ") {print $4 ":" $5}' | paste -sd, -)"
archive_sql="$(docker run --rm -i postgres:17-alpine pg_restore --create --schema-only -f - < "$dump_file")"
printf 'Fixture archive database REVOKE/GRANT counts: %s\n' "$(printf '%s\n' "$archive_sql" |
  awk '/^REVOKE .* ON DATABASE mercy_restore_test / {r++}
       /^GRANT .* ON DATABASE mercy_restore_test / {g++}
       END {print r+0 "|" g+0}')"
unset archive_sql
printf 'Fixture stranger CONNECT after main archive replay: %s\n' "$(admin_psql -Atc "select has_database_privilege('mercy_restore_stranger','mercy_restore_test','CONNECT');")"
[[ "$(target_psql -Atc "select to_regprocedure('graphql_public.graphql(text,text,jsonb,jsonb)') is null;")" == "t" ]]
wrapper_sql="$(sed -n '/^-- BEGIN_BEGET_GRAPHQL_WRAPPER$/,/^-- END_BEGET_GRAPHQL_WRAPPER$/p' scripts/cutover-beget.sh)"
[[ -n "$wrapper_sql" ]] || { echo "Production GraphQL wrapper SQL missing" >&2; exit 1; }
printf '%s\n' "$wrapper_sql" |
  docker exec -i "$db_container" psql -U supabase_admin -d mercy_restore_test -v ON_ERROR_STOP=1 >/dev/null
docker exec -i "$db_container" pg_restore -U supabase_admin -d mercy_restore_test --exit-on-error \
  --use-list="$test_acl_list" < "$dump_file"
printf 'Fixture stranger CONNECT after GraphQL ACL replay: %s\n' "$(admin_psql -Atc "select has_database_privilege('mercy_restore_stranger','mercy_restore_test','CONNECT');")"
[[ "$(target_psql -Atc "select pg_get_userbyid(proowner) from pg_proc where oid=to_regprocedure('graphql_public.graphql(text,text,jsonb,jsonb)');")" == "supabase_admin" ]]
[[ "$(target_psql -Atc "select has_function_privilege('mercy_restore_rest', 'graphql_public.graphql(text,text,jsonb,jsonb)', 'EXECUTE');")" == "t" ]]
[[ "$(target_psql -Atc "select has_function_privilege('mercy_restore_reader', 'graphql_public.graphql(text,text,jsonb,jsonb)', 'EXECUTE');")" == "f" ]]
[[ "$(target_psql -Atc "set role mercy_restore_rest; select jsonb_typeof(graphql_public.graphql(query => '{ __typename }'));" | tail -n 1)" == "object" ]]
echo "Recovery test recreated wrapper and replayed archived ACL with role boundary."

[[ "$(target_psql -Atc "select coalesce(to_regclass('public.extra_after_backup')::text,'');")" == "" ]]
[[ "$(target_psql -Atc "select pg_get_userbyid(relowner) from pg_class where oid='public.baseline_row'::regclass;")" == "mercy_restore_owner" ]]
[[ "$(target_psql -Atc "select has_table_privilege('mercy_restore_reader','public.baseline_row','SELECT');")" == "t" ]]
[[ "$(target_psql -Atc "set role mercy_restore_reader; select id from public.baseline_row;")" == "SET
7" ]]
[[ "$(admin_psql -Atc "select pg_get_userbyid(datdba) from pg_database where datname='mercy_restore_test';")" == "mercy_restore_owner" ]]
[[ "$(admin_psql -Atc "select has_database_privilege('mercy_restore_reader','mercy_restore_test','CONNECT');")" == "t" ]]
[[ "$(admin_psql -Atc "select has_database_privilege('mercy_restore_stranger','mercy_restore_test','CONNECT');")" == "f" ]]
[[ "$(target_psql -Atc "show statement_timeout;")" == "13s" ]]
[[ "$(target_psql -Atc 'show "app.settings.jwt_secret";')" == "fixture-only" ]]
[[ "$(target_psql -Atc "select (select count(*) from auth.users), coalesce(to_regclass('public.help_requests')::text,''), (select count(*) from storage.buckets), (select count(*) from storage.objects);")" == "0||0|0" ]]
[[ "$(target_psql -Atc "select pg_get_userbyid(relowner) from pg_class where oid='auth.users'::regclass;")" == "mercy_restore_auth" ]]
[[ "$(target_psql -Atc "select pg_get_userbyid(relowner) from pg_class where oid='storage.objects'::regclass;")" == "mercy_restore_storage" ]]
[[ "$(target_psql -Atc "set role mercy_restore_auth; select count(*) from auth.users;" | tail -n 1)" == "0" ]]
[[ "$(target_psql -Atc "set role mercy_restore_storage; select count(*) from storage.objects;" | tail -n 1)" == "0" ]]
[[ "$(target_psql -Atc "set role mercy_restore_rest; select id from public.rest_probe;" | tail -n 1)" == "9" ]]

# Run the production recovery role verifier against the disposable restored
# database, replacing only the role identifiers with the fixture service roles.
role_sql="$(sed -n '/^-- BEGIN_BEGET_ROLE_VERIFICATION$/,/^-- END_BEGET_ROLE_VERIFICATION$/p' scripts/cutover-beget.sh)"
[[ -n "$role_sql" ]] || { echo "Production role verification SQL was not found" >&2; exit 1; }
role_sql="$(printf '%s\n' "$role_sql" |
  sed -e 's/supabase_auth_admin/mercy_restore_auth/g' \
      -e 's/supabase_storage_admin/mercy_restore_storage/g' \
      -e 's/authenticator/mercy_restore_rest/g' \
      -e 's/authenticated/mercy_restore_rest/g' \
      -e 's/anon/mercy_restore_rest/g')"
printf '%s\n' "$role_sql" | target_psql >/dev/null
echo "Production recovery role verifier executed against restored Auth/REST/Storage roles."
echo "Cutover recovery restore preserves database metadata, object ownership, grants, database settings and PUBLIC CONNECT denial."
