set -Eeuo pipefail

run_id="${1:?run id required}"
probe_path="${2:?SMTP probe path required}"

target_host="smtp.resend.com"
target_port="465"
target_user="resend"
target_admin="no-reply@mercy.peerivo.net"
target_sender="Mercy"
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
      GOTRUE_SMTP_SENDER_NAME: ${SMTP_SENDER_NAME}
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
      GOTRUE_SMTP_SENDER_NAME: ${MERCY_ROLLBACK_SMTP_SENDER_NAME}
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
  "${compose_rollback_args[@]}" up -d --no-deps --force-recreate auth </dev/null
}

set_env_line() {
  local key="$1"
  local value="$2"
  [[ "${value}" != *$'\n'* ]] || {
    echo "Refusing multiline environment value for ${key}." >&2
    return 1
  }
  local escaped="${value//\\/\\\\}"
  escaped="${escaped//&/\\&}"
  escaped="${escaped//|/\\|}"
  if grep -q "^${key}=" "${scratch_env}"; then
    sed -i "s|^${key}=.*|${key}=${escaped}|" "${scratch_env}"
  else
    printf '%s=%s\n' "${key}" "${value}" >> "${scratch_env}"
  fi
}

full_env_hash() {
  docker inspect -f '{{range .Config.Env}}{{println .}}{{end}}' "$1"     | LC_ALL=C sort     | sha256sum     | awk '{print $1}'
}

non_smtp_env_hash() {
  docker inspect -f '{{range .Config.Env}}{{println .}}{{end}}' "$1"     | grep -Ev '^(GOTRUE_SMTP_HOST|GOTRUE_SMTP_PORT|GOTRUE_SMTP_USER|GOTRUE_SMTP_PASS|GOTRUE_SMTP_ADMIN_EMAIL|GOTRUE_SMTP_SENDER_NAME)='     | LC_ALL=C sort     | sha256sum     | awk '{print $1}'
}

validate_canonical_urls() {
  local cid="$1"
  [[ "$(get_env_value "${cid}" API_EXTERNAL_URL)" == "${target_api}"     && "$(get_env_value "${cid}" GOTRUE_SITE_URL)" == "${target_site}"     && "$(get_env_value "${cid}" GOTRUE_URI_ALLOW_LIST)" == "${target_redirect}"     && "$(get_env_value "${cid}" GOTRUE_JWT_ISSUER)" == "${target_api}" ]]
}

validate_rendered_auth() {
  "${compose_target_args[@]}" config -q </dev/null
  local rendered
  rendered="$("${compose_target_args[@]}" run --rm --no-deps -T --entrypoint /bin/sh auth -c \
    'printf "%s\\n" "$GOTRUE_SMTP_HOST" "$GOTRUE_SMTP_PORT" "$GOTRUE_SMTP_USER" "$GOTRUE_SMTP_ADMIN_EMAIL" "$GOTRUE_SMTP_SENDER_NAME" "$API_EXTERNAL_URL" "$GOTRUE_SITE_URL" "$GOTRUE_URI_ALLOW_LIST" "$GOTRUE_JWT_ISSUER"' </dev/null)"
  mapfile -t values <<< "${rendered}"
  unset rendered
  [[ "${#values[@]}" -eq 9 \
    && "${values[0]}" == "${target_host}" \
    && "${values[1]}" == "${target_port}" \
    && "${values[2]}" == "${target_user}" \
    && "${values[3]}" == "${target_admin}" \
    && "${values[4]}" == "${target_sender}" \
    && "${values[5]}" == "${target_api}" \
    && "${values[6]}" == "${target_site}" \
    && "${values[7]}" == "${target_redirect}" \
    && "${values[8]}" == "${target_api}" ]] || {
      echo "Rendered Auth configuration is not canonical; refusing host mutation." >&2
      return 1
    }

  printf '%s' "${smtp_pass}" \
    | "${compose_target_args[@]}" run --rm --no-deps -T --entrypoint /bin/sh auth -c \
      'expected="$(cat)"; test -n "$expected"; test "$GOTRUE_SMTP_PASS" = "$expected"' >/dev/null
}

smtp_probe() {
  local auth_id="$1"
  local storage_id="$2"
  local storage_image
  storage_image="$(docker inspect -f '{{.Image}}' "${storage_id}")"
  [[ "${storage_image}" =~ ^sha256:[a-f0-9]{64}$ ]] || {
    echo "Storage image ID is not immutable." >&2
    return 1
  }
  local response
  response="$(
    printf '%s' "${smtp_pass}" \
      | python3 -c 'import json,sys; print(json.dumps({"password":sys.stdin.read(),"port":465}))' \
      | docker run --rm -i --pull never --read-only \
          --cap-drop ALL --security-opt no-new-privileges \
          --user 65534:65534 --memory 128m --cpus 0.25 --pids-limit 32 \
          --network "container:${auth_id}" \
          --entrypoint node "${storage_image}" \
          --input-type=module -e "$(cat "${probe_path}")"
  )"
  [[ "${response}" == '{"status":"authenticated"}' ]] || {
    echo "SMTP authentication probe failed." >&2
    return 1
  }
}

image_before="$(docker inspect -f '{{.Config.Image}}' "${auth_before}")"
full_hash_before="$(full_env_hash "${auth_before}")"
non_smtp_hash_before="$(non_smtp_env_hash "${auth_before}")"
validate_canonical_urls "${auth_before}" || {
  echo "Canonical Auth URL configuration is not intact before SMTP repair." >&2
  exit 1
}

api_before="$(get_env_value "${auth_before}" API_EXTERNAL_URL)"
site_before="$(get_env_value "${auth_before}" GOTRUE_SITE_URL)"
allow_before="$(get_env_value "${auth_before}" GOTRUE_URI_ALLOW_LIST)"
issuer_before="$(get_env_value "${auth_before}" GOTRUE_JWT_ISSUER)"
smtp_host_before="$(get_env_value "${auth_before}" GOTRUE_SMTP_HOST)"
smtp_port_before="$(get_env_value "${auth_before}" GOTRUE_SMTP_PORT)"
smtp_user_before="$(get_env_value "${auth_before}" GOTRUE_SMTP_USER)"
smtp_pass_before="$(get_env_value "${auth_before}" GOTRUE_SMTP_PASS)"
smtp_admin_before="$(get_env_value "${auth_before}" GOTRUE_SMTP_ADMIN_EMAIL)"
smtp_sender_before="$(get_env_value "${auth_before}" GOTRUE_SMTP_SENDER_NAME)"

declare -A other_before
for service in db rest realtime storage kong; do
  other_before["${service}"]="$(get_service_id "${service}")"
done

if [[ "${smtp_host_before}" == "${target_host}" \
  && "${smtp_port_before}" == "${target_port}" \
  && "${smtp_user_before}" == "${target_user}" \
  && "${smtp_admin_before}" == "${target_admin}" \
  && "${smtp_sender_before}" == "${target_sender}" \
  && "${smtp_pass_before}" == "${smtp_pass}" ]]; then
  smtp_probe "${auth_before}" "${other_before[storage]}"
  echo "AUTH_SMTP_REPAIR_ALREADY_OK=1"
  unset smtp_pass smtp_pass_before
  exit 0
fi
echo "AUTH_SMTP_REPAIR_PRESTATE_NONCANONICAL=1"

# Prove the installed probe image, TLS transport and protected key work before
# changing the host env or recreating Auth. Repeat after repair in the new namespace.
smtp_probe "${auth_before}" "${other_before[storage]}"
echo "AUTH_SMTP_REPAIR_PREFLIGHT_OK=1"

backup="${scratch}/env.backup"
cp -p "${scratch_env}" "${backup}"
chmod 600 "${backup}"
backup_hash="$(sha256sum "${backup}" | awk '{print $1}')"
echo "Auth configuration backup created: sha256=${backup_hash}"

host_mutated=0
rollback_ok=0
rollback() {
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
  export MERCY_ROLLBACK_SMTP_SENDER_NAME="${smtp_sender_before}"

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
set_env_line SMTP_SENDER_NAME "${target_sender}"

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
[[ "$(get_env_value "${auth_after}" GOTRUE_SMTP_SENDER_NAME)" == "${target_sender}" ]] || exit 1
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
