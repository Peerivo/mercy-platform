#!/usr/bin/env bash
set -Eeuo pipefail

: "${BEGET_SUPABASE_HOST:?missing BEGET_SUPABASE_HOST}"
: "${BEGET_SUPABASE_USER:?missing BEGET_SUPABASE_USER}"
: "${GITHUB_RUN_ID:?missing GITHUB_RUN_ID}"

[[ "${BEGET_SUPABASE_HOST}" =~ ^[a-zA-Z0-9][a-zA-Z0-9.-]*$ ]]
[[ "${BEGET_SUPABASE_USER}" =~ ^[a-zA-Z_][a-zA-Z0-9_-]*$ ]]
[[ "${GITHUB_RUN_ID}" =~ ^[0-9]+$ ]]

remote="${BEGET_SUPABASE_USER}@${BEGET_SUPABASE_HOST}"
ssh_opts=(-o BatchMode=yes -o StrictHostKeyChecking=yes -o ConnectTimeout=10)

mapfile -t migration_files < <(
  find supabase/migrations -maxdepth 1 -type f -name '*.sql' -printf '%f\n' | LC_ALL=C sort
)

(("${#migration_files[@]}" > 0)) || {
  echo "No repository migrations found." >&2
  exit 1
}

repo_versions=()
declare -A seen_versions=()
for file in "${migration_files[@]}"; do
  [[ "${file}" =~ ^([0-9]{12}|[0-9]{14})_([a-zA-Z0-9_-]+)\.sql$ ]] || {
    echo "Migration filename is not canonical: ${file}" >&2
    exit 1
  }
  version="${BASH_REMATCH[1]}"
  [[ -z "${seen_versions[${version}]:-}" ]] || {
    echo "Duplicate migration version: ${version}" >&2
    exit 1
  }
  seen_versions["${version}"]=1
  repo_versions+=("${version}")
done

target_versions_raw="$(
  ssh "${ssh_opts[@]}" "${remote}" \
    "docker exec supabase-db psql -X -v ON_ERROR_STOP=1 -U postgres -d postgres -At -c \"select version from supabase_migrations.schema_migrations order by version;\""
)"

target_versions=()
while IFS= read -r version; do
  [[ -n "${version}" ]] && target_versions+=("${version}")
done <<< "${target_versions_raw}"

if (("${#target_versions[@]}" > "${#repo_versions[@]}")); then
  echo "Beget migration history is ahead of the repository; refusing mutation." >&2
  exit 1
fi

for ((i=0; i<${#target_versions[@]}; i++)); do
  if [[ "${target_versions[${i}]}" != "${repo_versions[${i}]}" ]]; then
    echo "Beget migration history is not an exact repository prefix; refusing mutation." >&2
    exit 1
  fi
done

pending_files=("${migration_files[@]:${#target_versions[@]}}")
if (("${#pending_files[@]}" == 0)); then
  echo "Beget already has the complete repository migration history."
  exit 0
fi

remote_home="$(ssh "${ssh_opts[@]}" "${remote}" 'printf %s "$HOME"')"
[[ "${remote_home}" =~ ^/[a-zA-Z0-9._/-]+$ ]] || {
  echo "Unexpected remote home path." >&2
  exit 1
}
backup_path="${remote_home}/mercy-beget-pre-migration-${GITHUB_RUN_ID}.dump"
[[ "${backup_path}" =~ ^/[a-zA-Z0-9._/-]+/mercy-beget-pre-migration-[0-9]+\.dump$ ]] || {
  echo "Unexpected backup path." >&2
  exit 1
}

ssh "${ssh_opts[@]}" "${remote}" \
  "umask 077; docker exec supabase-db pg_dump -U postgres -d postgres --format=custom > '${backup_path}' && test -s '${backup_path}'"

echo "Protected pre-migration backup created on Beget."

for file in "${pending_files[@]}"; do
  [[ "${file}" =~ ^([0-9]{12}|[0-9]{14})_([a-zA-Z0-9_-]+)\.sql$ ]]
  version="${BASH_REMATCH[1]}"
  migration_name="${BASH_REMATCH[2]}"
  echo "Applying migration ${version}_${migration_name}"

  {
    cat "supabase/migrations/${file}"
    printf "\nINSERT INTO supabase_migrations.schema_migrations(version,statements,name) VALUES ('%s',NULL,'%s') ON CONFLICT(version) DO UPDATE SET name=excluded.name;\n" \
      "${version}" "${migration_name}"
  } | ssh "${ssh_opts[@]}" "${remote}" \
      "docker exec -i supabase-db psql -X -v ON_ERROR_STOP=1 -U postgres -d postgres --single-transaction"
done

final_versions="$(
  ssh "${ssh_opts[@]}" "${remote}" \
    "docker exec supabase-db psql -X -v ON_ERROR_STOP=1 -U postgres -d postgres -At -c \"select version from supabase_migrations.schema_migrations order by version;\""
)"
expected_versions="$(printf '%s\n' "${repo_versions[@]}")"
[[ "${final_versions}" == "${expected_versions}" ]] || {
  echo "Post-migration history does not match the repository exactly." >&2
  exit 1
}

ssh "${ssh_opts[@]}" "${remote}" \
  "docker exec supabase-db psql -X -v ON_ERROR_STOP=1 -U postgres -d postgres -c \"NOTIFY pgrst, 'reload schema';\"" >/dev/null

echo "Incremental Beget migration history verified."
echo "Pre-change backup retained on Beget for operator-controlled recovery: ${backup_path}"
