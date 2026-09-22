#!/usr/bin/env bash
set -euo pipefail

: "${MIGRATION_CONFIRM:?MIGRATION_CONFIRM required}"
: "${BEGET_SUPABASE_HOST:?BEGET_SUPABASE_HOST required}"
: "${BEGET_SUPABASE_USER:?BEGET_SUPABASE_USER required}"
: "${OLD_SUPABASE_DB_URL:?OLD_SUPABASE_DB_URL required}"
: "${TARGET_SUPABASE_URL:?TARGET_SUPABASE_URL required}"
: "${TARGET_ANON_KEY:?TARGET_ANON_KEY required}"

if [[ "${MIGRATION_CONFIRM}" != "MIGRATE" ]]; then
  echo "Migration confirmation is not MIGRATE; refusing to continue." >&2
  exit 1
fi

REMOTE="${BEGET_SUPABASE_USER}@${BEGET_SUPABASE_HOST}"
LOCAL_WORK="/tmp/mercy-cutover-${GITHUB_RUN_ID:-manual}"
SOURCE_ENV="/tmp/source-pg.env"
mkdir -p "${LOCAL_WORK}"
chmod 700 "${LOCAL_WORK}"
umask 077

python3 - <<'PY'
import os
from pathlib import Path
from urllib.parse import urlparse, unquote

u = urlparse(os.environ["OLD_SUPABASE_DB_URL"])
if u.scheme not in {"postgres", "postgresql"}:
    raise SystemExit("OLD_SUPABASE_DB_URL must be a postgres URI")
if not all([u.hostname, u.username, u.path, u.password]):
    raise SystemExit("OLD_SUPABASE_DB_URL is incomplete")

values = {
    "PGHOST": u.hostname,
    "PGPORT": str(u.port or 5432),
    "PGUSER": unquote(u.username),
    "PGPASSWORD": unquote(u.password),
    "PGDATABASE": unquote(u.path.lstrip("/")),
    "PGSSLMODE": "require",
}
p = Path("/tmp/source-pg.env")
p.write_text("".join(f"{k}={v}\n" for k, v in values.items()))
p.chmod(0o600)
PY

source_psql() {
  docker run --rm \
    --env-file "${SOURCE_ENV}" \
    postgres:17-alpine \
    psql -v ON_ERROR_STOP=1 "$@"
}

source_psql_stdin() {
  docker run --rm -i \
    --env-file "${SOURCE_ENV}" \
    postgres:17-alpine \
    psql -v ON_ERROR_STOP=1 -f /dev/stdin
}

source_dump() {
  docker run --rm     --env-file "${SOURCE_ENV}"     -v "${LOCAL_WORK}:/work"     postgres:17-alpine     pg_dump "$@"
}

remote_home="$(ssh "${REMOTE}" 'printf %s "$HOME"')"
REMOTE_WORK="${remote_home}/mercy-cutover-${GITHUB_RUN_ID:-manual}"
BACKUP_DIR="${remote_home}/beget-pre-migration-backups"
SUPABASE_DIR="/opt/beget/supabase"
frozen=0
success=0

unfreeze_source() {
  cat > "${LOCAL_WORK}/unfreeze.sql" <<'SQL'
BEGIN;
DO $$
DECLARE r record;
BEGIN
  FOR r IN
    SELECT schemaname, tablename
    FROM pg_tables
    WHERE schemaname = 'public'
  LOOP
    EXECUTE format(
      'DROP TRIGGER IF EXISTS mercy_migration_write_freeze ON %I.%I',
      r.schemaname,
      r.tablename
    );
  END LOOP;
END
$$;

DROP TRIGGER IF EXISTS mercy_migration_write_freeze ON auth.users;
DROP TRIGGER IF EXISTS mercy_migration_write_freeze ON auth.identities;
DROP SCHEMA IF EXISTS mercy_migration CASCADE;
COMMIT;
SQL
  source_psql_stdin < "${LOCAL_WORK}/unfreeze.sql" >/dev/null
}

cleanup() {
  rc=$?
  set +e
  if [[ "${success}" != "1" && "${frozen}" == "1" ]]; then
    echo "Migration did not complete; unfreezing the old production database."
    unfreeze_source || echo "::error::Automatic source unfreeze failed; operator action is required."
  fi
  ssh "${REMOTE}" "rm -rf '${REMOTE_WORK}'" >/dev/null 2>&1 || true
  rm -rf "${LOCAL_WORK}"
  rm -f "${SOURCE_ENV}" ~/.ssh/id_ed25519
  exit "${rc}"
}
trap cleanup EXIT

echo "== Compatibility gates =="

repo_versions="$(find supabase/migrations -maxdepth 1 -type f -name '*.sql' -printf '%f\n' | sed 's/_.*//' | sort)"
source_versions="$(source_psql -Atc "select version from supabase_migrations.schema_migrations order by version;")"
if [[ "${repo_versions}" != "${source_versions}" ]]; then
  echo "::error::Repository migration history differs from Mercy-prod."
  diff -u <(printf '%s\n' "${source_versions}") <(printf '%s\n' "${repo_versions}") || true
  exit 1
fi

source_auth_columns="$(source_psql -At -F '|' -c "select table_name,ordinal_position,column_name,udt_name,is_nullable from information_schema.columns where table_schema='auth' and table_name in ('users','identities') order by table_name,ordinal_position;")"
target_auth_columns="$(ssh "${REMOTE}" "docker exec supabase-db psql -U postgres -d postgres -At -F '|' -c \"select table_name,ordinal_position,column_name,udt_name,is_nullable from information_schema.columns where table_schema='auth' and table_name in ('users','identities') order by table_name,ordinal_position;\"")"
if [[ "${source_auth_columns}" != "${target_auth_columns}" ]]; then
  echo "::error::auth.users/auth.identities schemas differ between managed Supabase and Beget."
  exit 1
fi

source_profile="$(source_psql -At -F '|' -c "select (select count(*) from storage.buckets),(select count(*) from storage.objects),(select count(*) from auth.mfa_factors),(select count(*) from auth.sso_providers),(select count(*) from auth.identities where provider <> 'email');")"
IFS='|' read -r storage_buckets storage_objects mfa_factors sso_providers non_email_identities <<< "${source_profile}"
if [[ "${storage_buckets}" != "0" || "${storage_objects}" != "0" || "${mfa_factors}" != "0" || "${sso_providers}" != "0" || "${non_email_identities}" != "0" ]]; then
  echo "::error::Migration profile changed: this cutover supports email identities only, no MFA/SSO, and empty Storage."
  exit 1
fi

target_fresh="$(ssh "${REMOTE}" "docker exec supabase-db psql -U postgres -d postgres -At -F '|' -c \"select (select count(*) from auth.users),coalesce(to_regclass('public.help_requests')::text,''),(select count(*) from storage.buckets),(select count(*) from storage.objects);\"")"
IFS='|' read -r target_users target_help_relation target_storage_buckets target_storage_objects <<< "${target_fresh}"
if [[ "${target_users}" != "0" || -n "${target_help_relation}" || "${target_storage_buckets}" != "0" || "${target_storage_objects}" != "0" ]]; then
  echo "::error::Beget target is no longer fresh; refusing destructive cutover. Expected zero users, no Mercy schema marker, and zero Storage buckets/objects."
  exit 1
fi

echo "== Target safety backup =="
ssh "${REMOTE}" "mkdir -p '${BACKUP_DIR}' '${REMOTE_WORK}' && chmod 700 '${BACKUP_DIR}' '${REMOTE_WORK}'"
backup_prefix="${BACKUP_DIR}/before-${GITHUB_RUN_ID:-manual}"
ssh "${REMOTE}" "docker exec supabase-db pg_dumpall -U postgres --globals-only > '${backup_prefix}-globals.sql' && docker exec supabase-db pg_dump -U postgres -d postgres -Fc > '${backup_prefix}-postgres.dump' && chmod 600 '${backup_prefix}-globals.sql' '${backup_prefix}-postgres.dump'"

tar -C supabase -czf "${LOCAL_WORK}/migrations.tgz" migrations
scp -q "${LOCAL_WORK}/migrations.tgz" "${REMOTE}:${REMOTE_WORK}/migrations.tgz"

echo "== Freeze old Mercy writes =="
cat > "${LOCAL_WORK}/freeze.sql" <<'SQL'
BEGIN;
CREATE SCHEMA IF NOT EXISTS mercy_migration;
CREATE TABLE IF NOT EXISTS mercy_migration.state(
  singleton boolean PRIMARY KEY DEFAULT true CHECK (singleton),
  frozen_at timestamptz NOT NULL DEFAULT now(),
  frozen_until timestamptz NOT NULL
);
INSERT INTO mercy_migration.state(singleton, frozen_until)
VALUES (true, now() + interval '45 minutes')
ON CONFLICT (singleton) DO UPDATE
SET frozen_at = now(),
    frozen_until = excluded.frozen_until;

CREATE OR REPLACE FUNCTION mercy_migration.block_write()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = ''
AS $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM mercy_migration.state
    WHERE singleton = true
      AND frozen_until > now()
  ) THEN
    RAISE EXCEPTION 'Mercy production is temporarily read-only for migration';
  END IF;
  RETURN NULL;
END
$$;

DO $$
DECLARE r record;
BEGIN
  FOR r IN
    SELECT schemaname, tablename
    FROM pg_tables
    WHERE schemaname = 'public'
  LOOP
    EXECUTE format(
      'DROP TRIGGER IF EXISTS mercy_migration_write_freeze ON %I.%I',
      r.schemaname,
      r.tablename
    );
    EXECUTE format(
      'CREATE TRIGGER mercy_migration_write_freeze BEFORE INSERT OR UPDATE OR DELETE ON %I.%I FOR EACH STATEMENT EXECUTE FUNCTION mercy_migration.block_write()',
      r.schemaname,
      r.tablename
    );
  END LOOP;
END
$$;

DROP TRIGGER IF EXISTS mercy_migration_write_freeze ON auth.users;
CREATE TRIGGER mercy_migration_write_freeze
  BEFORE INSERT OR UPDATE OR DELETE ON auth.users
  FOR EACH STATEMENT EXECUTE FUNCTION mercy_migration.block_write();

DROP TRIGGER IF EXISTS mercy_migration_write_freeze ON auth.identities;
CREATE TRIGGER mercy_migration_write_freeze
  BEFORE INSERT OR UPDATE OR DELETE ON auth.identities
  FOR EACH STATEMENT EXECUTE FUNCTION mercy_migration.block_write();
COMMIT;
SQL

# Arm cleanup before any effect: unfreeze is idempotent and safe if the transaction rolls back.
frozen=1
source_psql_stdin < "${LOCAL_WORK}/freeze.sql" >/dev/null

freeze_verification="$(source_psql -At -F '|' -c "
with expected(schema_name, table_name) as (
  select 'public'::text, tablename::text
  from pg_tables
  where schemaname='public'
  union all
  values ('auth','users'),('auth','identities')
),
actual as (
  select n.nspname::text as schema_name, c.relname::text as table_name
  from pg_trigger t
  join pg_class c on c.oid=t.tgrelid
  join pg_namespace n on n.oid=c.relnamespace
  where t.tgname='mercy_migration_write_freeze'
    and not t.tgisinternal
)
select
  (select count(*) from expected),
  (select count(*) from actual a join expected e using(schema_name,table_name)),
  coalesce((
    select string_agg(e.schema_name || '.' || e.table_name, ',' order by e.schema_name,e.table_name)
    from expected e
    left join actual a using(schema_name,table_name)
    where a.table_name is null
  ), '');
")"
IFS='|' read -r expected_freeze_count actual_freeze_count missing_freeze_tables <<< "${freeze_verification}"
echo "Write freeze coverage: ${actual_freeze_count}/${expected_freeze_count}"
if [[ -n "${missing_freeze_tables}" || "${actual_freeze_count}" != "${expected_freeze_count}" ]]; then
  echo "::error::Write freeze is incomplete. Missing: ${missing_freeze_tables:-unknown}"
  exit 1
fi

fingerprint_source() {
  {
    while IFS= read -r table; do
      source_psql -Atc "select 'public.${table}|' || count(*) || '|' || coalesce(md5(string_agg(md5(to_jsonb(t)::text),'' order by md5(to_jsonb(t)::text))),md5('')) from public.\"${table}\" t;"
    done < <(source_psql -Atc "select tablename from pg_tables where schemaname='public' order by tablename;")
    source_psql -Atc "select 'auth.users|' || count(*) || '|' || coalesce(md5(string_agg(md5(to_jsonb(t)::text),'' order by md5(to_jsonb(t)::text))),md5('')) from auth.users t;"
    source_psql -Atc "select 'auth.identities|' || count(*) || '|' || coalesce(md5(string_agg(md5(to_jsonb(t)::text),'' order by md5(to_jsonb(t)::text))),md5('')) from auth.identities t;"
  } | sort
}

fingerprint_source > "${LOCAL_WORK}/source.before"

echo "== Dump frozen production data =="
source_dump --data-only --no-owner --no-privileges --table=auth.users --file=/work/auth-users.sql
source_dump --data-only --no-owner --no-privileges --table=auth.identities --file=/work/auth-identities.sql
source_dump --data-only --no-owner --no-privileges --schema=public --file=/work/public-data.sql

for f in "${LOCAL_WORK}/auth-users.sql" "${LOCAL_WORK}/auth-identities.sql" "${LOCAL_WORK}/public-data.sql"; do
  test -s "${f}"
  sed -i 's/^SET transaction_timeout/-- &/' "${f}"
  sed -i '/^\\restrict /d;/^\\unrestrict /d' "${f}"
done

fingerprint_source > "${LOCAL_WORK}/source.after"
if ! cmp -s "${LOCAL_WORK}/source.before" "${LOCAL_WORK}/source.after"; then
  echo "::error::Source data changed during the frozen dump."
  exit 1
fi

scp -q   "${LOCAL_WORK}/auth-users.sql"   "${LOCAL_WORK}/auth-identities.sql"   "${LOCAL_WORK}/public-data.sql"   "${REMOTE}:${REMOTE_WORK}/"

echo "== Apply canonical Mercy schema and data on Beget =="
ssh "${REMOTE}" bash -s -- "${REMOTE_WORK}" <<'REMOTE'
set -euo pipefail
work="$1"
cd "$work"
tar -xzf migrations.tgz

{
  printf 'BEGIN;\n'

  for migration_file in migrations/*.sql; do
    cat "$migration_file"
    printf '\n'
  done

  # Historical specialist migrations create this bucket; the later removal migration
  # drops DB objects but hosted Supabase required Storage API cleanup. The verified
  # source profile has zero buckets/objects, so normalize the self-hosted target here.
  printf "DELETE FROM storage.buckets WHERE id = 'qualification-documents';\n"

  printf 'SET session_replication_role = replica;\n'
  cat auth-users.sql
  cat auth-identities.sql
  cat public-data.sql
  printf '\nSET session_replication_role = origin;\n'

  printf 'CREATE SCHEMA IF NOT EXISTS supabase_migrations;\n'
  printf 'CREATE TABLE IF NOT EXISTS supabase_migrations.schema_migrations(version text primary key, statements text[], name text);\n'

  for migration_file in migrations/*.sql; do
    base="$(basename "$migration_file")"
    version="${base%%_*}"
    migration_name="${base#*_}"
    migration_name="${migration_name%.sql}"

    if [[ ! "$version" =~ ^[0-9]+$ || ! "$migration_name" =~ ^[A-Za-z0-9_]+$ ]]; then
      echo "Unsafe migration filename: $base" >&2
      exit 1
    fi

    printf "INSERT INTO supabase_migrations.schema_migrations(version,statements,name) VALUES ('%s',NULL,'%s') ON CONFLICT(version) DO UPDATE SET name=excluded.name;\n" "$version" "$migration_name"
  done

  printf 'COMMIT;\n'
} | docker exec -i supabase-db psql -U postgres -d postgres -v ON_ERROR_STOP=1 >/dev/null
REMOTE

echo "== Restart and verify Supabase services =="
ssh "${REMOTE}" bash -s -- "${SUPABASE_DIR}" <<'REMOTE'
set -euo pipefail
supabase_dir="$1"
cd "$supabase_dir"

services=(auth rest realtime storage kong)
docker compose restart "${services[@]}" >/dev/null

for service in "${services[@]}"; do
  ok=0
  for _ in $(seq 1 45); do
    cid="$(docker compose ps -q "$service")"
    if [[ -n "$cid" ]]; then
      running="$(docker inspect -f '{{.State.Running}}' "$cid")"
      health="$(docker inspect -f '{{if .State.Health}}{{.State.Health.Status}}{{else}}none{{end}}' "$cid")"
      if [[ "$running" == "true" && ( "$health" == "healthy" || "$health" == "none" ) ]]; then
        ok=1
        break
      fi
    fi
    sleep 2
  done
  [[ "$ok" == "1" ]] || { echo "Service not ready: $service" >&2; exit 1; }
done
REMOTE

fingerprint_target() {
  {
    while IFS= read -r table; do
      ssh "${REMOTE}" "docker exec supabase-db psql -U postgres -d postgres -Atc \"select 'public.${table}|' || count(*) || '|' || coalesce(md5(string_agg(md5(to_jsonb(t)::text),'' order by md5(to_jsonb(t)::text))),md5('')) from public.\\\"${table}\\\" t;\""
    done < <(source_psql -Atc "select tablename from pg_tables where schemaname='public' order by tablename;")
    ssh "${REMOTE}" "docker exec supabase-db psql -U postgres -d postgres -Atc \"select 'auth.users|' || count(*) || '|' || coalesce(md5(string_agg(md5(to_jsonb(t)::text),'' order by md5(to_jsonb(t)::text))),md5('')) from auth.users t;\""
    ssh "${REMOTE}" "docker exec supabase-db psql -U postgres -d postgres -Atc \"select 'auth.identities|' || count(*) || '|' || coalesce(md5(string_agg(md5(to_jsonb(t)::text),'' order by md5(to_jsonb(t)::text))),md5('')) from auth.identities t;\""
  } | sort
}

fingerprint_target > "${LOCAL_WORK}/target.after"
if ! cmp -s "${LOCAL_WORK}/source.after" "${LOCAL_WORK}/target.after"; then
  echo "::error::Target row fingerprints do not match frozen source."
  diff -u "${LOCAL_WORK}/source.after" "${LOCAL_WORK}/target.after" || true
  exit 1
fi

target_storage_profile="$(ssh "${REMOTE}" "docker exec supabase-db psql -U postgres -d postgres -At -F '|' -c \"select (select count(*) from storage.buckets),(select count(*) from storage.objects);\"")"
if [[ "${target_storage_profile}" != "0|0" ]]; then
  echo "::error::Target Storage profile differs from the verified empty source profile: ${target_storage_profile}"
  exit 1
fi

source_policy="$(source_psql -Atc "select count(*) || '|' || coalesce(md5(string_agg(md5(concat_ws('|',schemaname,tablename,policyname,cmd,roles::text,coalesce(qual,''),coalesce(with_check,''))),'' order by md5(concat_ws('|',schemaname,tablename,policyname,cmd,roles::text,coalesce(qual,''),coalesce(with_check,''))))),md5('')) from pg_policies where schemaname='public';")"
target_policy="$(ssh "${REMOTE}" "docker exec supabase-db psql -U postgres -d postgres -Atc \"select count(*) || '|' || coalesce(md5(string_agg(md5(concat_ws('|',schemaname,tablename,policyname,cmd,roles::text,coalesce(qual,''),coalesce(with_check,''))),'' order by md5(concat_ws('|',schemaname,tablename,policyname,cmd,roles::text,coalesce(qual,''),coalesce(with_check,''))))),md5('')) from pg_policies where schemaname='public';\"")"
test "${source_policy}" = "${target_policy}"

source_realtime="$(source_psql -At -F '|' -c "select schemaname,tablename from pg_publication_tables where pubname='supabase_realtime' order by schemaname,tablename;")"
target_realtime="$(ssh "${REMOTE}" "docker exec supabase-db psql -U postgres -d postgres -At -F '|' -c \"select schemaname,tablename from pg_publication_tables where pubname='supabase_realtime' order by schemaname,tablename;\"")"
test "${source_realtime}" = "${target_realtime}"

echo "== Public API smoke =="
curl -fsS   -H "apikey: ${TARGET_ANON_KEY}"   -H "Authorization: Bearer ${TARGET_ANON_KEY}"   "${TARGET_SUPABASE_URL}/auth/v1/health" >/dev/null

curl -fsS   -H "apikey: ${TARGET_ANON_KEY}"   -H "Authorization: Bearer ${TARGET_ANON_KEY}"   -H "Content-Type: application/json"   -X POST   -d '{}'   "${TARGET_SUPABASE_URL}/rest/v1/rpc/list_public_help_requests" >/dev/null

source_psql -Atc "update mercy_migration.state set frozen_until = now() + interval '24 hours' where singleton = true;" >/dev/null
success=1
echo "Migration verified successfully."
echo "The old Mercy database remains write-frozen until application cutover is verified."
echo "Beget safety backup retained at: ${backup_prefix}-*"
