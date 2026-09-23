#!/usr/bin/env bash
set -euo pipefail

: "${MIGRATION_CONFIRM:?MIGRATION_CONFIRM required}"
: "${BEGET_SUPABASE_HOST:?BEGET_SUPABASE_HOST required}"
: "${BEGET_SUPABASE_USER:?BEGET_SUPABASE_USER required}"
: "${OLD_SUPABASE_DB_URL:?OLD_SUPABASE_DB_URL required}"
: "${TARGET_SUPABASE_URL:?TARGET_SUPABASE_URL required}"
: "${TARGET_ANON_KEY:?TARGET_ANON_KEY required}"
RECOVER_FROM_RUN_ID="${RECOVER_FROM_RUN_ID:-}"
RECOVERY_RUN_VERIFIED="${RECOVERY_RUN_VERIFIED:-0}"

if [[ "${MIGRATION_CONFIRM}" != "MIGRATE" && "${MIGRATION_CONFIRM}" != "RECOVER" ]]; then
  echo "Confirmation must be MIGRATE or RECOVER; refusing to continue." >&2
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
frozen=0
success=0
target_mutated=0
backup_prefix=""

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

target_profile() {
  ssh "${REMOTE}" "docker exec supabase-db psql -U postgres -d postgres -At -F '|' -c \"select (select count(*) from auth.users),coalesce(to_regclass('public.help_requests')::text,''),(select count(*) from storage.buckets),(select count(*) from storage.objects);\""
}

assert_target_fresh() {
  local target_fresh target_users target_help_relation target_storage_buckets target_storage_objects
  target_fresh="$(target_profile)"
  IFS='|' read -r target_users target_help_relation target_storage_buckets target_storage_objects <<< "${target_fresh}"
  if [[ "${target_users}" != "0" || -n "${target_help_relation}" || "${target_storage_buckets}" != "0" || "${target_storage_objects}" != "0" ]]; then
    echo "::error::Beget target is no longer fresh; refusing destructive cutover. Expected zero users, no Mercy schema marker, and zero Storage buckets/objects."
    return 1
  fi
}

restore_target_backup() {
  local backup_file="$1"

  ssh "${REMOTE}" bash -s -- "${backup_file}" <<'REMOTE'
set -euo pipefail
backup_file="$1"
[[ -s "$backup_file" ]] || { echo "Safety backup is missing or empty: $backup_file" >&2; exit 1; }
backup_prefix="${backup_file%-postgres.dump}"
metadata_hash_file="${backup_prefix}-dbmeta.md5"
state_file="${backup_prefix}.state"

database_metadata_hash() {
  docker exec supabase-db psql -U postgres -d template1 -Atc "
    with d as (
      select d.*, t.spcname
      from pg_database d
      join pg_tablespace t on t.oid=d.dattablespace
      where d.datname='postgres'
    )
    select md5(concat_ws('|',
      pg_get_userbyid(d.datdba),
      coalesce(d.datacl::text,''),
      d.datconnlimit::text,
      d.datistemplate::text,
      d.datallowconn::text,
      d.spcname,
      d.datcollate,
      d.datctype,
      coalesce((
        select string_agg(s.setrole::text || ':' || s.setconfig::text, '|' order by s.setrole, s.setconfig::text)
        from pg_db_role_setting s
        where s.setdatabase=d.oid
      ), '')
    ))
    from d;"
}

project="$(docker inspect -f '{{ index .Config.Labels "com.docker.compose.project" }}' supabase-db)"
[[ -n "$project" ]] || { echo "Cannot resolve Supabase compose project label" >&2; exit 1; }

db_id="$(docker inspect -f '{{.Id}}' supabase-db)"
mapfile -t project_ids < <(docker ps --no-trunc -q --filter "label=com.docker.compose.project=$project")
other_ids=()
for cid in "${project_ids[@]}"; do
  [[ "$cid" == "$db_id" ]] || other_ids+=("$cid")
done

restart_others() {
  if (( ${#other_ids[@]} > 0 )); then
    docker start "${other_ids[@]}" >/dev/null 2>&1 || true
  fi
}
trap restart_others EXIT

if (( ${#other_ids[@]} > 0 )); then
  docker stop "${other_ids[@]}" >/dev/null
fi

# Decode the full custom archive before dropping the target database. This
# catches truncated payloads as well as malformed tables of contents.
docker exec -i supabase-db pg_restore -f /dev/null < "$backup_file"
docker exec -i supabase-db pg_restore --create --schema-only -f - < "$backup_file" \
  | grep -E '^CREATE DATABASE postgres([[:space:]]|;)' >/dev/null || {
  echo "Backup does not produce the expected postgres database" >&2
  exit 1
}

pre_restore_metadata_hash="$(database_metadata_hash)"
expected_metadata_hash="$pre_restore_metadata_hash"
if [[ -s "$metadata_hash_file" && -s "$state_file" &&
      "$(tr -d '[:space:]' < "$state_file")" == "prepared" ]]; then
  expected_metadata_hash="$(tr -d '[:space:]' < "$metadata_hash_file")"
else
  [[ "$(basename "$backup_file")" == "before-35770879007-postgres.dump" &&
     ! -e "$state_file" && ! -e "$metadata_hash_file" ]] || {
    echo "Safety backup is not prepared, or is not the explicitly supported legacy archive" >&2
    exit 1
  }
fi

# -C is a pg_restore option. pg_dump --create is ignored for custom archives,
# including the retained run #7 archive; both formats carry database metadata.
docker exec supabase-db dropdb -U postgres --maintenance-db=template1 --force postgres
docker exec -i supabase-db pg_restore -U postgres -d template1 \
  --create --exit-on-error < "$backup_file"

post_restore_metadata_hash="$(database_metadata_hash)"
[[ -n "$expected_metadata_hash" && "$post_restore_metadata_hash" == "$expected_metadata_hash" ]] || {
  echo "Database-level metadata fingerprint changed during recovery" >&2
  exit 1
}

state="$(docker exec supabase-db psql -U postgres -d postgres -At -F '|' -c "select (select count(*) from auth.users),coalesce(to_regclass('public.help_requests')::text,''),(select count(*) from storage.buckets),(select count(*) from storage.objects);")"
[[ "$state" == "0||0|0" ]] || { echo "Safety-backup restore did not produce a fresh target: $state" >&2; exit 1; }

docker exec -i supabase-db psql -U postgres -d postgres -v ON_ERROR_STOP=1 >/dev/null <<'SQL'
BEGIN;
SET LOCAL ROLE supabase_auth_admin;
SELECT count(*) FROM auth.users;
RESET ROLE;
SET LOCAL ROLE supabase_storage_admin;
SELECT count(*) FROM storage.objects;
RESET ROLE;
DO $
BEGIN
  IF NOT has_database_privilege('authenticator', current_database(), 'CONNECT')
     OR NOT has_schema_privilege('anon', 'public', 'USAGE')
     OR NOT has_schema_privilege('authenticated', 'public', 'USAGE') THEN
    RAISE EXCEPTION 'REST database role access was not restored';
  END IF;
END
$;
SET LOCAL ROLE authenticator;
SELECT current_user;
ROLLBACK;
SQL

restart_others
trap - EXIT
REMOTE
}

restart_target_services() {
  ssh "${REMOTE}" bash -s <<'REMOTE'
set -euo pipefail
project="$(docker inspect -f '{{ index .Config.Labels "com.docker.compose.project" }}' supabase-db)"
[[ -n "$project" ]] || { echo "Cannot resolve Supabase compose project label" >&2; exit 1; }

services=(auth rest realtime storage kong)
for service in "${services[@]}"; do
  mapfile -t service_ids < <(docker ps -aq \
    --filter "label=com.docker.compose.project=$project" \
    --filter "label=com.docker.compose.service=$service")
  [[ "${#service_ids[@]}" == "1" ]] || {
    echo "Expected exactly one container for Compose service: $service" >&2
    exit 1
  }
  cid="${service_ids[0]}"
  docker restart "$cid" >/dev/null

  ok=0
  for _ in $(seq 1 45); do
    running="$(docker inspect -f '{{.State.Running}}' "$cid")"
    health="$(docker inspect -f '{{if .State.Health}}{{.State.Health.Status}}{{else}}none{{end}}' "$cid")"
    if [[ "$running" == "true" && ( "$health" == "healthy" || "$health" == "none" ) ]]; then
      ok=1
      break
    fi
    sleep 2
  done
  [[ "$ok" == "1" ]] || { echo "Service not ready: $service" >&2; exit 1; }
done
REMOTE
}

cleanup() {
  rc=$?
  set +e
  if [[ "${success}" != "1" && "${target_mutated}" == "1" && -n "${backup_prefix}" ]]; then
    echo "Migration did not complete after target mutation; restoring the current Beget safety backup."
    restore_target_backup "${backup_prefix}-postgres.dump" || echo "::error::Automatic Beget rollback failed; retained backup: ${backup_prefix}-postgres.dump"
  fi
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

if [[ -n "${RECOVER_FROM_RUN_ID}" ]]; then
  if [[ ! "${RECOVER_FROM_RUN_ID}" =~ ^[0-9]+$ ]]; then
    echo "::error::RECOVER_FROM_RUN_ID must be a numeric GitHub Actions run id."
    exit 1
  fi
  if [[ "${RECOVERY_RUN_VERIFIED}" != "1" ]]; then
    echo "::error::Recovery run was not independently verified as a failed/interrupted Mercy cutover."
    exit 1
  fi

  recovery_prefix="${BACKUP_DIR}/before-${RECOVER_FROM_RUN_ID}"
  recovery_backup="${recovery_prefix}-postgres.dump"

  ssh "${REMOTE}" bash -s -- "${BACKUP_DIR}" "${recovery_prefix}" <<'REMOTE'
set -euo pipefail
backup_dir="$1"
recovery_prefix="$2"
if find "$backup_dir" -maxdepth 1 -type f -name 'cutover-successful-*.marker' -print -quit | grep -q .; then
  echo "A successful Beget cutover marker exists; failed/interrupted-run recovery is disabled to protect live/post-cutover data." >&2
  exit 1
fi
[[ -s "${recovery_prefix}-postgres.dump" ]] || { echo "Retained recovery backup is missing or empty" >&2; exit 1; }
printf '%s\n' 'github-terminal-run-verified' > "${recovery_prefix}.recovery-verified"
chmod 600 "${recovery_prefix}.recovery-verified"
REMOTE

  echo "== Restore Beget target from retained safety backup for verified failed/interrupted run ${RECOVER_FROM_RUN_ID} =="
  backup_prefix="${recovery_prefix}"
  target_mutated=1
  restore_target_backup "${recovery_backup}"
  if [[ "${MIGRATION_CONFIRM}" != "RECOVER" ]]; then target_mutated=0; fi
fi

if [[ "${MIGRATION_CONFIRM}" == "RECOVER" ]]; then
  [[ -n "${RECOVER_FROM_RUN_ID}" ]] || {
    echo "::error::RECOVER requires a verified failed/interrupted cutover run id." >&2
    exit 1
  }
  restart_target_services
  assert_target_fresh
  target_mutated=0
  success=1
  echo "Recovery verified: Beget target is fresh and services are ready; no source freeze or MIGRATE was run."
  exit 0
fi

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

assert_target_fresh

echo "== Target safety backup =="
ssh "${REMOTE}" "mkdir -p '${BACKUP_DIR}' '${REMOTE_WORK}' && chmod 700 '${BACKUP_DIR}' '${REMOTE_WORK}'"
backup_prefix="${BACKUP_DIR}/before-${GITHUB_RUN_ID:-manual}"
ssh "${REMOTE}" bash -s -- "${backup_prefix}" <<'REMOTE'
set -euo pipefail
backup_prefix="$1"

database_metadata_hash() {
  docker exec supabase-db psql -U postgres -d template1 -Atc "
    with d as (
      select d.*, t.spcname
      from pg_database d
      join pg_tablespace t on t.oid=d.dattablespace
      where d.datname='postgres'
    )
    select md5(concat_ws('|',
      pg_get_userbyid(d.datdba),
      coalesce(d.datacl::text,''),
      d.datconnlimit::text,
      d.datistemplate::text,
      d.datallowconn::text,
      d.spcname,
      d.datcollate,
      d.datctype,
      coalesce((
        select string_agg(s.setrole::text || ':' || s.setconfig::text, '|' order by s.setrole, s.setconfig::text)
        from pg_db_role_setting s
        where s.setdatabase=d.oid
      ), '')
    ))
    from d;"
}

docker exec supabase-db pg_dumpall -U postgres --globals-only > "${backup_prefix}-globals.sql"
docker exec supabase-db pg_dump -U postgres -d postgres -Fc > "${backup_prefix}-postgres.dump"
docker exec -i supabase-db pg_restore --create --schema-only -f - < "${backup_prefix}-postgres.dump" | grep -E '^CREATE DATABASE postgres([[:space:]]|;)' >/dev/null || {
  echo "Safety backup is missing database creation metadata" >&2
  exit 1
}
database_metadata_hash > "${backup_prefix}-dbmeta.md5"
printf '%s\n' 'prepared' > "${backup_prefix}.state"
chmod 600 "${backup_prefix}-globals.sql" "${backup_prefix}-postgres.dump" "${backup_prefix}-dbmeta.md5" "${backup_prefix}.state"
REMOTE

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
# Arm target rollback before the remote mutation. If SSH drops after PostgreSQL
# commits but before the runner receives exit status, cleanup must still restore
# the retained baseline backup.
target_mutated=1
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
  # source and fresh target both have zero Storage objects. During this one bootstrap
  # transaction only, bypass Storage's delete-protection trigger to remove the known
  # empty historical bucket, then immediately restore normal trigger behavior.
  printf 'SET session_replication_role = replica;\n'
  printf "DELETE FROM storage.buckets WHERE id = 'qualification-documents';\n"
  printf 'SET session_replication_role = origin;\n'

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
restart_target_services

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
ssh "${REMOTE}" "printf '%s\n' 'database-cutover-verified' > '${BACKUP_DIR}/cutover-successful-${GITHUB_RUN_ID:-manual}.marker' && chmod 600 '${BACKUP_DIR}/cutover-successful-${GITHUB_RUN_ID:-manual}.marker'"
success=1
echo "Migration verified successfully."
echo "The old Mercy database remains write-frozen until application cutover is verified."
echo "Beget safety backup retained at: ${backup_prefix}-*"
