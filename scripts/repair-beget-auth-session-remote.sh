set -Eeuo pipefail

run_id="${1:?run id required}"

target_timebox="72h"
target_inactivity="72h"
target_site="https://mercy.peerivo.net"
target_redirect="https://mercy.peerivo.net/auth/callback"
target_api="https://api.mercy.peerivo.net/auth/v1"
session_override_rel="mercy-auth-session.override.yml"

project="$(docker inspect -f '{{ index .Config.Labels "com.docker.compose.project" }}' supabase-db)"
[[ -n "${project}" ]] || {
  echo "Cannot resolve Supabase Compose project." >&2
  exit 1
}

get_service_id() {
  local service="$1"
  local ids=()
  mapfile -t ids < <(
    docker ps -aq \
      --filter "label=com.docker.compose.project=${project}" \
      --filter "label=com.docker.compose.service=${service}"
  )
  [[ "${#ids[@]}" == "1" ]] || {
    echo "Expected exactly one container for Compose service: ${service}" >&2
    return 1
  }
  printf '%s' "${ids[0]}"
}

get_env_value() {
  local cid="$1"
  local key="$2"
  docker inspect -f '{{range .Config.Env}}{{println .}}{{end}}' "${cid}" \
    | sed -n "s/^${key}=//p" \
    | head -n 1
}

has_env_key() {
  local cid="$1"
  local key="$2"
  docker inspect -f '{{range .Config.Env}}{{println .}}{{end}}' "${cid}" \
    | grep -q "^${key}="
}

auth_before="$(get_service_id auth)"
working_dir="$(docker inspect -f '{{ index .Config.Labels "com.docker.compose.project.working_dir" }}' "${auth_before}")"
config_files_raw="$(docker inspect -f '{{ index .Config.Labels "com.docker.compose.project.config_files" }}' "${auth_before}")"
env_file_raw="$(docker inspect -f '{{ index .Config.Labels "com.docker.compose.project.environment_file" }}' "${auth_before}")"

[[ "${working_dir}" == /* ]] || {
  echo "Compose working directory metadata is invalid." >&2
  exit 1
}

helper_image="$(docker inspect -f '{{.Config.Image}}' "${auth_before}")"
scratch="$(mktemp -d /tmp/mercy-auth-session-repair.XXXXXXXX)"
chmod 700 "${scratch}"
scratch_env="${scratch}/env"
scratch_configs=()
scratch_target_override="${scratch}/auth-session-target-override.yml"
scratch_rollback_override="${scratch}/auth-session-rollback-override.yml"
persistent_override="${working_dir}/${session_override_rel}"
persistent_backup="${scratch}/persistent-override.backup"

cleanup_scratch() {
  rm -rf "${scratch}"
}
trap cleanup_scratch EXIT

docker_read_host_file() {
  local source="$1"
  local destination="$2"
  docker run --rm --user 0:0 --entrypoint /bin/sh \
    -v "${source}:/mercy-source:ro" "${helper_image}" \
    -c 'cat /mercy-source' > "${destination}"
  chmod 600 "${destination}"
}

docker_write_host_file() {
  local source="$1"
  local destination="$2"
  docker run --rm -i --user 0:0 --entrypoint /bin/sh \
    -v "${destination}:/mercy-target" "${helper_image}" \
    -c 'cat > /mercy-target' < "${source}"
}

docker_write_workdir_file() {
  local source="$1"
  local rel="$2"
  docker run --rm -i --user 0:0 --entrypoint /bin/sh \
    -v "${working_dir}:/mercy-workdir" "${helper_image}" \
    -c 'umask 077; cat > "/mercy-workdir/$1"' sh "${rel}" < "${source}"
}

docker_remove_workdir_file() {
  local rel="$1"
  docker run --rm --user 0:0 --entrypoint /bin/sh \
    -v "${working_dir}:/mercy-workdir" "${helper_image}" \
    -c 'rm -f "/mercy-workdir/$1"' sh "${rel}"
}

workdir_file_exists() {
  local rel="$1"
  docker run --rm --user 0:0 --entrypoint /bin/sh \
    -v "${working_dir}:/mercy-workdir:ro" "${helper_image}" \
    -c 'test -f "/mercy-workdir/$1"' sh "${rel}"
}

env_file=""
if [[ -n "${env_file_raw}" && "${env_file_raw}" != "<no value>" ]]; then
  env_file="${env_file_raw}"
  [[ "${env_file}" == /* ]] || env_file="${working_dir}/${env_file}"
fi
case "${env_file}" in
  "${working_dir}"/*) ;;
  *) env_file="${working_dir}/.env" ;;
esac

config_files=()
labels_trusted=1
if [[ -z "${config_files_raw}" || "${config_files_raw}" == "<no value>" ]]; then
  labels_trusted=0
else
  IFS=',' read -r -a raw_config_files <<< "${config_files_raw}"
  for raw in "${raw_config_files[@]}"; do
    file="${raw#"${raw%%[![:space:]]*}"}"
    file="${file%"${file##*[![:space:]]}"}"
    [[ -n "${file}" ]] || continue
    [[ "${file}" == /* ]] || file="${working_dir}/${file}"
    case "${file}" in
      "${working_dir}"/*)
        if workdir_file_exists "${file#"${working_dir}/"}"; then
          config_files+=("${file}")
        else
          labels_trusted=0
        fi
        ;;
      *) labels_trusted=0 ;;
    esac
  done
fi

if [[ "${labels_trusted}" != "1" || "${#config_files[@]}" -eq 0 ]]; then
  config_files=()
  base_rel=""
  for candidate in docker-compose.yml docker-compose.yaml compose.yml compose.yaml; do
    if workdir_file_exists "${candidate}"; then
      base_rel="${candidate}"
      break
    fi
  done
  [[ -n "${base_rel}" ]] || {
    echo "Cannot rediscover a canonical Compose base file under the working directory." >&2
    exit 1
  }
  config_files+=("${working_dir}/${base_rel}")
  for candidate in \
    docker-compose.override.yml docker-compose.override.yaml \
    compose.override.yml compose.override.yaml \
    "${session_override_rel}"
  do
    if workdir_file_exists "${candidate}"; then
      config_files+=("${working_dir}/${candidate}")
    fi
  done
fi

docker_read_host_file "${env_file}" "${scratch_env}"
for index in "${!config_files[@]}"; do
  copy="${scratch}/compose-${index}.yml"
  docker_read_host_file "${config_files[${index}]}" "${copy}"
  scratch_configs+=("${copy}")
done

cat > "${scratch_target_override}" <<'OVERRIDE'
services:
  auth:
    environment:
      GOTRUE_SESSIONS_TIMEBOX: 72h
      GOTRUE_SESSIONS_INACTIVITY_TIMEOUT: 72h
OVERRIDE
chmod 600 "${scratch_target_override}"

timebox_before="$(get_env_value "${auth_before}" GOTRUE_SESSIONS_TIMEBOX)"
inactivity_before="$(get_env_value "${auth_before}" GOTRUE_SESSIONS_INACTIVITY_TIMEOUT)"
timebox_present=0
inactivity_present=0
has_env_key "${auth_before}" GOTRUE_SESSIONS_TIMEBOX && timebox_present=1
has_env_key "${auth_before}" GOTRUE_SESSIONS_INACTIVITY_TIMEOUT && inactivity_present=1

cat > "${scratch_rollback_override}" <<'OVERRIDE'
services:
  auth:
    environment:
      API_EXTERNAL_URL: ${MERCY_ROLLBACK_API_EXTERNAL_URL}
      GOTRUE_SITE_URL: ${MERCY_ROLLBACK_SITE_URL}
      GOTRUE_URI_ALLOW_LIST: ${MERCY_ROLLBACK_URI_ALLOW_LIST}
      GOTRUE_JWT_ISSUER: ${MERCY_ROLLBACK_JWT_ISSUER}
OVERRIDE
if [[ "${timebox_present}" == "1" ]]; then
  printf '      GOTRUE_SESSIONS_TIMEBOX: ${MERCY_ROLLBACK_TIMEBOX}\n' >> "${scratch_rollback_override}"
fi
if [[ "${inactivity_present}" == "1" ]]; then
  printf '      GOTRUE_SESSIONS_INACTIVITY_TIMEOUT: ${MERCY_ROLLBACK_INACTIVITY}\n' >> "${scratch_rollback_override}"
fi
chmod 600 "${scratch_rollback_override}"

compose_base_args=(
  docker compose
  --project-name "${project}"
  --project-directory "${working_dir}"
  --env-file "${scratch_env}"
)
for file in "${scratch_configs[@]}"; do
  compose_base_args+=(-f "${file}")
done

compose_target_args=("${compose_base_args[@]}" -f "${scratch_target_override}")
compose_rollback_args=("${compose_base_args[@]}" -f "${scratch_rollback_override}")

compose_auth_up_target() {
  "${compose_target_args[@]}" up -d --no-deps --force-recreate auth </dev/null
}

compose_auth_up_rollback() {
  "${compose_rollback_args[@]}" up -d --no-deps --force-recreate auth </dev/null
}

full_env_hash() {
  docker inspect -f '{{range .Config.Env}}{{println .}}{{end}}' "$1" \
    | LC_ALL=C sort \
    | sha256sum \
    | awk '{print $1}'
}

non_session_env_hash() {
  docker inspect -f '{{range .Config.Env}}{{println .}}{{end}}' "$1" \
    | grep -Ev '^(GOTRUE_SESSIONS_TIMEBOX|GOTRUE_SESSIONS_INACTIVITY_TIMEOUT)=' \
    | LC_ALL=C sort \
    | sha256sum \
    | awk '{print $1}'
}

validate_canonical_urls() {
  local cid="$1"
  [[ "$(get_env_value "${cid}" API_EXTERNAL_URL)" == "${target_api}" \
    && "$(get_env_value "${cid}" GOTRUE_SITE_URL)" == "${target_site}" \
    && "$(get_env_value "${cid}" GOTRUE_URI_ALLOW_LIST)" == "${target_redirect}" \
    && "$(get_env_value "${cid}" GOTRUE_JWT_ISSUER)" == "${target_api}" ]]
}

validate_rendered_auth() {
  "${compose_target_args[@]}" config -q </dev/null
  local rendered
  rendered="$("${compose_target_args[@]}" run --rm --no-deps -T --entrypoint /bin/sh auth -c \
    'printf "%s\\n" "$GOTRUE_SESSIONS_TIMEBOX" "$GOTRUE_SESSIONS_INACTIVITY_TIMEOUT" "$API_EXTERNAL_URL" "$GOTRUE_SITE_URL" "$GOTRUE_URI_ALLOW_LIST" "$GOTRUE_JWT_ISSUER"' </dev/null)"
  mapfile -t values <<< "${rendered}"
  unset rendered
  [[ "${#values[@]}" -eq 6 \
    && "${values[0]}" == "${target_timebox}" \
    && "${values[1]}" == "${target_inactivity}" \
    && "${values[2]}" == "${target_api}" \
    && "${values[3]}" == "${target_site}" \
    && "${values[4]}" == "${target_redirect}" \
    && "${values[5]}" == "${target_api}" ]] || {
      echo "Rendered Auth session configuration is not canonical; refusing host mutation." >&2
      return 1
    }
}

image_before="$(docker inspect -f '{{.Config.Image}}' "${auth_before}")"
full_hash_before="$(full_env_hash "${auth_before}")"
non_session_hash_before="$(non_session_env_hash "${auth_before}")"
validate_canonical_urls "${auth_before}" || {
  echo "Canonical Auth URL configuration is not intact before session repair." >&2
  exit 1
}

api_before="$(get_env_value "${auth_before}" API_EXTERNAL_URL)"
site_before="$(get_env_value "${auth_before}" GOTRUE_SITE_URL)"
allow_before="$(get_env_value "${auth_before}" GOTRUE_URI_ALLOW_LIST)"
issuer_before="$(get_env_value "${auth_before}" GOTRUE_JWT_ISSUER)"

declare -A other_before
for service in db rest realtime storage kong; do
  other_before["${service}"]="$(get_service_id "${service}")"
done

override_existed=0
if workdir_file_exists "${session_override_rel}"; then
  override_existed=1
  docker_read_host_file "${persistent_override}" "${persistent_backup}"
fi

if [[ "${timebox_before}" == "${target_timebox}" \
  && "${inactivity_before}" == "${target_inactivity}" ]]; then
  validate_rendered_auth
  if [[ "${override_existed}" != "1" ]]; then
    docker_write_workdir_file "${scratch_target_override}" "${session_override_rel}"
  fi
  echo "AUTH_SESSION_REPAIR_ALREADY_OK=1"
  exit 0
fi

echo "AUTH_SESSION_PRESTATE timebox=${timebox_before:-unset} inactivity=${inactivity_before:-unset}"
validate_rendered_auth

backup="${scratch}/env.backup"
cp -p "${scratch_env}" "${backup}"
chmod 600 "${backup}"
backup_hash="$(sha256sum "${backup}" | awk '{print $1}')"
echo "Auth configuration backup created: sha256=${backup_hash}"

host_mutated=0
rollback_ok=0
rollback() {
  set +e

  if [[ "${override_existed}" == "1" ]]; then
    docker_write_workdir_file "${persistent_backup}" "${session_override_rel}"
  else
    docker_remove_workdir_file "${session_override_rel}"
  fi

  cp -p "${backup}" "${scratch_env}"
  docker_write_host_file "${scratch_env}" "${env_file}"

  export MERCY_ROLLBACK_API_EXTERNAL_URL="${api_before}"
  export MERCY_ROLLBACK_SITE_URL="${site_before}"
  export MERCY_ROLLBACK_URI_ALLOW_LIST="${allow_before}"
  export MERCY_ROLLBACK_JWT_ISSUER="${issuer_before}"
  export MERCY_ROLLBACK_TIMEBOX="${timebox_before}"
  export MERCY_ROLLBACK_INACTIVITY="${inactivity_before}"

  if compose_auth_up_rollback >/dev/null 2>&1; then
    sleep 3
    restored="$(get_service_id auth 2>/dev/null)"
    if [[ -n "${restored}" \
      && "$(docker inspect -f '{{.Config.Image}}' "${restored}")" == "${image_before}" \
      && "$(full_env_hash "${restored}")" == "${full_hash_before}" ]]; then
      rollback_ok=1
      echo "Auth session repair rolled back and verified."
    fi
  fi

  if [[ "${rollback_ok}" != "1" ]]; then
    echo "Rollback could not be fully verified; protected backup retained at ${backup}." >&2
  fi
}

on_exit() {
  code=$?
  trap - EXIT HUP INT TERM
  if [[ "${code}" -ne 0 && "${host_mutated}" == "1" ]]; then
    rollback
  fi
  if [[ "${host_mutated}" == "0" || "${rollback_ok}" == "1" || "${code}" -eq 0 ]]; then
    cleanup_scratch
  fi
  exit "${code}"
}
trap on_exit EXIT
trap 'exit 129' HUP
trap 'exit 130' INT
trap 'exit 143' TERM

docker_write_workdir_file "${scratch_target_override}" "${session_override_rel}"
host_mutated=1
compose_auth_up_target

auth_after=""
for _ in $(seq 1 30); do
  auth_after="$(get_service_id auth 2>/dev/null || true)"
  [[ -n "${auth_after}" ]] || {
    sleep 2
    continue
  }
  state="$(docker inspect -f '{{if .State.Health}}{{.State.Health.Status}}{{else}}{{.State.Status}}{{end}}' "${auth_after}")"
  if [[ "${state}" == "healthy" || "${state}" == "running" ]]; then
    break
  fi
  if [[ "${state}" == "unhealthy" || "${state}" == "exited" || "${state}" == "dead" ]]; then
    echo "Auth service failed after session-policy recreate." >&2
    exit 1
  fi
  sleep 2
done

[[ -n "${auth_after}" && "${auth_after}" != "${auth_before}" ]] || {
  echo "Auth container was not recreated." >&2
  exit 1
}
[[ "$(docker inspect -f '{{.Config.Image}}' "${auth_after}")" == "${image_before}" ]] || {
  echo "Auth image changed unexpectedly." >&2
  exit 1
}
[[ "$(non_session_env_hash "${auth_after}")" == "${non_session_hash_before}" ]] || {
  echo "Auth environment changed outside the approved session variables." >&2
  exit 1
}
validate_canonical_urls "${auth_after}" || {
  echo "Canonical Auth URL configuration changed unexpectedly." >&2
  exit 1
}
[[ "$(get_env_value "${auth_after}" GOTRUE_SESSIONS_TIMEBOX)" == "${target_timebox}" ]] || {
  echo "GOTRUE_SESSIONS_TIMEBOX verification failed." >&2
  exit 1
}
[[ "$(get_env_value "${auth_after}" GOTRUE_SESSIONS_INACTIVITY_TIMEOUT)" == "${target_inactivity}" ]] || {
  echo "GOTRUE_SESSIONS_INACTIVITY_TIMEOUT verification failed." >&2
  exit 1
}

for service in db rest realtime storage kong; do
  [[ "$(get_service_id "${service}")" == "${other_before[${service}]}" ]] || {
    echo "Non-Auth service changed unexpectedly: ${service}" >&2
    exit 1
  }
done

rm -f "${backup}"
trap - EXIT HUP INT TERM
cleanup_scratch
echo "AUTH_SESSION_REPAIR_OK=1"
