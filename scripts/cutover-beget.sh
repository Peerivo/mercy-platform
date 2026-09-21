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
  docker run --rm     --env-file "${SOURCE_ENV}"     postgres:17-alpine     psql -v ON_ERROR_STOP=1 "$@"
}

source_dump() {
  docker run --rm     --env-file "${SOURCE_ENV}"     -v "${LOCAL_WORK}:/work"     postgres:17-alpine     pg_dump "$@"
}

remote_home="$(ssh "${REMOTE}" 'printf %s "$HOME"')"
REMOTE_WORK="${remote_home}/mercy-cutover-${GITHUB_RUN_ID:-manual}"
BACKUP_DIR="${remote_home}/beget-pre-migration-backups"
frozen=0
success=0

unfreeze_source() {
  cat > "${LOCAL_WORK}/unfreeze.sql" <<'SQL'
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
SQL
  source_psql -f /dev/stdin < "${LOCAL_WORK}/unfreeze.sql" >/dev/null
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

target_fresh="$(ssh "${REMOTE}" "docker exec supabase-db psql -U postgres -d postgres -At -F '|' -c \"select (select count(*) from auth.users),coalesce(to_regclass('public.help_requests')::text,''),(select count(*) from storage.objects);\"")"
IFS='|' read -r target_users target_help_relation target_storage_objects <<< "${target_fresh}"
if [[ "${target_users}" != "0" || -n "${target_help_relation}" || "${target_storage_objects}" != "0" ]]; then
  echo "::error::Beget target is no longer fresh; refusing destructive cutover."
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
CREATE SCHEMA IF NOT EXISTS mercy_migration;
CREATE TABLE IF NOT EXISTS mercy_migration.state(
  singleton boolean PRIMARY KEY DEFAULT true CHECK (singleton),
  frozen_at timestamptz NOT NULL DEFAULT now()
);
INSERT INTO mercy_migration.state(singleton)
VALUES (true)
ON CONFLICT (singleton) DO UPDATE SET frozen_at = excluded.frozen_at;

CREATE OR REPLACE FUNCTION mercy_migration.block_write()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = ''
AS $$
BEGIN
  RAISE EXCEPTION 'Mercy production is temporarily read-only for migration';
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
SQL

source_psql -f /dev/stdin < "${LOCAL_WORK}/freeze.sql" >/dev/null
frozen=1

freeze_count="$(source_psql -Atc "select count(*) from pg_trigger t join pg_class c on c.oid=t.tgrelid join pg_namespace n on n.oid=c.relnamespace where t.tgname='mercy_migration_write_freeze' and not t.tgisinternal and (n.nspname='public' or (n.nspname='auth' and c.relname in ('users','identities')));")"
public_table_count="$(source_psql -Atc "select count(*) from pg_tables where schemaname='public';")"
expected_freeze_count=$((public_table_count + 2))
if [[ "${freeze_count}" != "${expected_freeze_count}" ]]; then
  echo "::error::Write freeze is incomplete."
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

echo "== Apply canonical Mercy schema on Beget =="
ssh "${REMOTE}" "set -euo pipefail
  cd '${REMOTE_WORK}'
  tar -xzf migrations.tgz
  for f in migrations/*.sql; do
    docker cp \"$f\" supabase-db:/tmp/mercy-migration.sql
    docker exec supabase-db psql -U postgres -d postgres -v ON_ERROR_STOP=1 -f /tmp/mercy-migration.sql >/dev/null
  done
  docker exec supabase-db rm -f /tmp/mercy-migration.sql"

echo "== Restore auth identities and Mercy data =="
ssh "${REMOTE}" "set -euo pipefail
  cd '${REMOTE_WORK}'
  {
    printf 'BEGIN;\\nSET session_replication_role = replica;\\n'
    cat auth-users.sql
    cat auth-identities.sql
    cat public-data.sql
    printf '\\nSET session_replication_role = origin;\\nCOMMIT;\\n'
  } > restore.sql
  chmod 600 restore.sql
  docker cp restore.sql supabase-db:/tmp/mercy-restore.sql
  docker exec supabase-db psql -U postgres -d postgres -v ON_ERROR_STOP=1 -f /tmp/mercy-restore.sql >/dev/null
  docker exec supabase-db rm -f /tmp/mercy-restore.sql"

echo "== Record applied Mercy migration history =="
ssh "${REMOTE}" "set -euo pipefail
  docker exec supabase-db psql -U postgres -d postgres -v ON_ERROR_STOP=1 -c \"create schema if not exists supabase_migrations; create table if not exists supabase_migrations.schema_migrations(version text primary key, statements text[], name text);\" >/dev/null
  cd '${REMOTE_WORK}'
  for f in migrations/*.sql; do
    base=$(basename \"$f\")
    version=${base%%_*}
    name=${base#*_}
    name=${name%.sql}
    docker exec supabase-db psql -U postgres -d postgres -v ON_ERROR_STOP=1 -v version=\"$version\" -v name=\"$name\" -c \"insert into supabase_migrations.schema_migrations(version,statements,name) values (:'version',null,:'name') on conflict(version) do update set name=excluded.name;\" >/dev/null
  done"

echo "== Restart and verify Supabase services =="
ssh "${REMOTE}" "docker restart supabase-auth supabase-rest realtime-dev.supabase-realtime supabase-storage supabase-kong >/dev/null"

ssh "${REMOTE}" "set -euo pipefail
  for name in supabase-auth supabase-rest realtime-dev.supabase-realtime supabase-storage supabase-kong; do
    ok=0
    for i in $(seq 1 45); do
      running=$(docker inspect -f '{{.State.Running}}' \"$name\")
      health=$(docker inspect -f '{{if .State.Health}}{{.State.Health.Status}}{{else}}none{{end}}' \"$name\")
      if [ \"$running\" = true ] && { [ \"$health\" = healthy ] || [ \"$health\" = none ]; }; then
        ok=1
        break
      fi
      sleep 2
    done
    [ \"$ok\" = 1 ] || { echo \"Service not ready: $name\" >&2; exit 1; }
  done"

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

source_policy="$(source_psql -Atc "select count(*) || '|' || coalesce(md5(string_agg(md5(concat_ws('|',schemaname,tablename,policyname,cmd,roles::text,coalesce(qual,''),coalesce(with_check,''))),'' order by md5(concat_ws('|',schemaname,tablename,policyname,cmd,roles::text,coalesce(qual,''),coalesce(with_check,''))))),md5('')) from pg_policies where schemaname='public';")"
target_policy="$(ssh "${REMOTE}" "docker exec supabase-db psql -U postgres -d postgres -Atc \"select count(*) || '|' || coalesce(md5(string_agg(md5(concat_ws('|',schemaname,tablename,policyname,cmd,roles::text,coalesce(qual,''),coalesce(with_check,''))),'' order by md5(concat_ws('|',schemaname,tablename,policyname,cmd,roles::text,coalesce(qual,''),coalesce(with_check,''))))),md5('')) from pg_policies where schemaname='public';\"")"
test "${source_policy}" = "${target_policy}"

source_realtime="$(source_psql -At -F '|' -c "select schemaname,tablename from pg_publication_tables where pubname='supabase_realtime' order by schemaname,tablename;")"
target_realtime="$(ssh "${REMOTE}" "docker exec supabase-db psql -U postgres -d postgres -At -F '|' -c \"select schemaname,tablename from pg_publication_tables where pubname='supabase_realtime' order by schemaname,tablename;\"")"
test "${source_realtime}" = "${target_realtime}"

echo "== Public API smoke =="
curl -fsS   -H "apikey: ${TARGET_ANON_KEY}"   -H "Authorization: Bearer ${TARGET_ANON_KEY}"   "${TARGET_SUPABASE_URL}/auth/v1/health" >/dev/null

curl -fsS   -H "apikey: ${TARGET_ANON_KEY}"   -H "Authorization: Bearer ${TARGET_ANON_KEY}"   -H "Content-Type: application/json"   -X POST   -d '{}'   "${TARGET_SUPABASE_URL}/rest/v1/rpc/list_public_help_requests" >/dev/null

success=1
echo "Migration verified successfully."
echo "The old Mercy database remains write-frozen until application cutover is verified."
echo "Beget safety backup retained at: ${backup_prefix}-*"
