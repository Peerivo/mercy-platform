set -Eeuo pipefail

run_id="${1:?run id required}"
probe_path="${2:?SMTP probe path required}"

target_host="smtp.resend.com"
target_port="465"
target_user="resend"
target_admin="no-reply@mercy.peerivo.net"
target_site="https://mercy.peerivo.net"
target_redirect="https://mercy.peerivo.net/auth/callback"
target_api="https://api.mercy.peerivo.net/auth/v1"

smtp_pass="$(cat)"
[[ -n "${smtp_pass}" && "${smtp_pass}" != *$'\n'* && "${#smtp_pass}" -le 1024 ]] || {
  echo "Protected Resend key input is missing or malformed." >&2
  exit 1
}

project="$(docker inspect -f '{{ index .Config.Labels "com.docker.compose.project" }}' supabase-db)"
[[ -n "${project}" ]] || {
  echo "Cannot resolve Supabase Compose project." >&2
  exit 1
}

get_service_id() {
  local service="$1"
  local ids=()
  mapfile -t ids < <(
    docker ps -aq       --filter "label=com.docker.compose.project=${project}"       --filter "label=com.docker.compose.service=${service}"
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
  docker inspect -f '{{range .Config.Env}}{{println .}}{{end}}' "${cid}"     | sed -n "s/^${key}=//p"     | head -n 1
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
scratch="$(mktemp -d /tmp/mercy-auth-smtp-repair.XXXXXXXX)"
chmod 700 "${scratch}"
scratch_env="${scratch}/env"
scratch_configs=()
scratch_target_override="${scratch}/auth-smtp-target-override.yml"
scratch_rollback_override="${scratch}/auth-smtp-rollback-override.yml"

cleanup_scratch() {
  rm -rf "${scratch}"
}
trap cleanup_scratch EXIT

docker_read_host_file() {
  local source="$1"
  local destination="$2"
  docker run --rm --user 0:0 --entrypoint /bin/sh     -v "${source}:/mercy-source:ro" "${helper_image}"     -c 'cat /mercy-source' > "${destination}"
  chmod 600 "${destination}"
}

docker_write_host_file() {
  local source="$1"
  local destination="$2"
  docker run --rm -i --user 0:0 --entrypoint /bin/sh     -v "${destination}:/mercy-target" "${helper_image}"     -c 'cat > /mercy-target' < "${source}"
}

workdir_file_exists() {
  local rel="$1"
  docker run --rm --user 0:0 --entrypoint /bin/sh     -v "${working_dir}:/mercy-workdir:ro" "${helper_image}"     -c 'test -f "/mercy-workdir/$1"' sh "${rel}"
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
      "${working_dir}"/*) config_files+=("${file}") ;;
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
  for candidate in docker-compose.override.yml docker-compose.override.yaml compose.override.yml compose.override.yaml; do
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
      API_EXTERNAL_URL: https://api.mercy.peerivo.net/auth/v1
      GOTRUE_SITE_URL: https://mercy.peerivo.net
      GOTRUE_URI_ALLOW_LIST: https://mercy.peerivo.net/auth/callback
      GOTRUE_JWT_ISSUER: https://api.mercy.peerivo.net/auth/v1
      GOTRUE_SMTP_HOST: ${SMTP_HOST}
      GOTRUE_SMTP_PORT: ${SMTP_PORT}
      GOTRUE_SMTP_USER: ${SMTP_USER}
      GOTRUE_SMTP_PASS: ${SMTP_PASS}
      GOTRUE_SMTP_ADMIN_EMAIL: ${SMTP_ADMIN_EMAIL}
OVERRIDE
chmod 600 "${scratch_target_override}"

cat > "${scratch_rollback_override}" <<'OVERRIDE'
services:
  auth:
    environment:
      API_EXTERNAL_URL: ${MERCY_ROLLBACK_API_EXTERNAL_URL}
      GOTRUE_SITE_URL: ${MERCY_ROLLBACK_SITE_URL}
      GOTRUE_URI_ALLOW_LIST: ${MERCY_ROLLBACK_URI_ALLOW_LIST}
      GOTRUE_JWT_ISSUER: ${MERCY_ROLLBACK_JWT_ISSUER}
      GOTRUE_SMTP_HOST: ${MERCY_ROLLBACK_SMTP_HOST}
      GOTRUE_SMTP_PORT: ${MERCY_ROLLBACK_SMTP_PORT}
      GOTRUE_SMTP_USER: ${MERCY_ROLLBACK_SMTP_USER}
      GOTRUE_SMTP_PASS: ${MERCY_ROLLBACK_SMTP_PASS}
      GOTRUE_SMTP_ADMIN_EMAIL: ${MERCY_ROLLBACK_SMTP_ADMIN_EMAIL}
OVERRIDE
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
  set +e
  cp -p "${backup}" "${scratch_env}"
  docker_write_host_file "${scratch_env}" "${env_file}"
  export MERCY_ROLLBACK_API_EXTERNAL_URL="${api_before}"
  export MERCY_ROLLBACK_SITE_URL="${site_before}"
  export MERCY_ROLLBACK_URI_ALLOW_LIST="${allow_before}"
  export MERCY_ROLLBACK_JWT_ISSUER="${issuer_before}"
  export MERCY_ROLLBACK_SMTP_HOST="${smtp_host_before}"
  export MERCY_ROLLBACK_SMTP_PORT="${smtp_port_before}"
  export MERCY_ROLLBACK_SMTP_USER="${smtp_user_before}"
  export MERCY_ROLLBACK_SMTP_PASS="${smtp_pass_before}"
  export MERCY_ROLLBACK_SMTP_ADMIN_EMAIL="${smtp_admin_before}"

  if compose_auth_up_rollback >/dev/null 2>&1; then
    sleep 3
    restored="$(get_service_id auth 2>/dev/null)"
    if [[ -n "${restored}" \
      && "$(docker inspect -f '{{.Config.Image}}' "${restored}")" == "${image_before}" \
      && "$(full_env_hash "${restored}")" == "${full_hash_before}" ]]; then
      rollback_ok=1
      echo "Auth SMTP repair rolled back and verified."
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

set_env_line SMTP_HOST "${target_host}"
set_env_line SMTP_PORT "${target_port}"
set_env_line SMTP_USER "${target_user}"
set_env_line SMTP_PASS "${smtp_pass}"
set_env_line SMTP_ADMIN_EMAIL "${target_admin}"

validate_rendered_auth

docker_write_host_file "${scratch_env}" "${env_file}"
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
    echo "Auth service failed after SMTP recreate." >&2
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
[[ "$(non_smtp_env_hash "${auth_after}")" == "${non_smtp_hash_before}" ]] || {
  echo "Auth environment changed outside the approved SMTP variables." >&2
  exit 1
}
validate_canonical_urls "${auth_after}" || {
  echo "Canonical Auth URL configuration changed unexpectedly." >&2
  exit 1
}

[[ "$(get_env_value "${auth_after}" GOTRUE_SMTP_HOST)" == "${target_host}" ]] || exit 1
[[ "$(get_env_value "${auth_after}" GOTRUE_SMTP_PORT)" == "${target_port}" ]] || exit 1
[[ "$(get_env_value "${auth_after}" GOTRUE_SMTP_USER)" == "${target_user}" ]] || exit 1
[[ "$(get_env_value "${auth_after}" GOTRUE_SMTP_ADMIN_EMAIL)" == "${target_admin}" ]] || exit 1
runtime_pass="$(get_env_value "${auth_after}" GOTRUE_SMTP_PASS)"
[[ -n "${runtime_pass}" && "${runtime_pass}" == "${smtp_pass}" ]] || {
  unset runtime_pass
  echo "Auth SMTP password verification failed." >&2
  exit 1
}
unset runtime_pass

for service in db rest realtime storage kong; do
  [[ "$(get_service_id "${service}")" == "${other_before[${service}]}" ]] || {
    echo "Non-Auth service changed unexpectedly: ${service}" >&2
    exit 1
  }
done

smtp_probe "${auth_after}" "${other_before[storage]}"

rm -f "${backup}"
trap - EXIT HUP INT TERM
cleanup_scratch
unset smtp_pass
echo "AUTH_SMTP_REPAIR_OK=1"
