#!/usr/bin/env bash
set -Eeuo pipefail

TUNNEL_PUBKEY_FILE="${1:?tunnel public key file required}"
BASE_DIR="${HOME}/.peerivo/ai-ceo"
ENV_FILE="${BASE_DIR}/postgres.env"
CONTAINER_NAME="ai-ceo-postgres"
VOLUME_NAME="ai-ceo-postgres-data"
IMAGE="postgres:17-alpine"
HOST_PORT="55432"

umask 077
mkdir -p "${BASE_DIR}"

if [ ! -s "${ENV_FILE}" ]; then
  POSTGRES_PASSWORD="$(python3 -c 'import secrets; print(secrets.token_hex(32))')"
  RESEARCH_LINK_SECRET="$(python3 -c 'import secrets; print(secrets.token_hex(32))')"
  {
    printf 'POSTGRES_USER=ai_ceo\n'
    printf 'POSTGRES_DB=ai_ceo\n'
    printf 'POSTGRES_PASSWORD=%s\n' "${POSTGRES_PASSWORD}"
    printf 'RESEARCH_LINK_SECRET=%s\n' "${RESEARCH_LINK_SECRET}"
  } > "${ENV_FILE}"
  chmod 600 "${ENV_FILE}"
fi

# shellcheck disable=SC1090
source "${ENV_FILE}"
[[ "${POSTGRES_USER:-}" == "ai_ceo" ]]
[[ "${POSTGRES_DB:-}" == "ai_ceo" ]]
[[ "${POSTGRES_PASSWORD:-}" =~ ^[a-f0-9]{64}$ ]]
[[ "${RESEARCH_LINK_SECRET:-}" =~ ^[a-f0-9]{64}$ ]]

if docker inspect "${CONTAINER_NAME}" >/dev/null 2>&1; then
  image_name="$(docker inspect -f '{{.Config.Image}}' "${CONTAINER_NAME}")"
  [ "${image_name}" = "${IMAGE}" ] || {
    echo "Existing AI CEO PostgreSQL container uses unexpected image." >&2
    exit 1
  }
  binding="$(docker inspect -f '{{with (index (index .NetworkSettings.Ports "5432/tcp") 0)}}{{.HostIp}}:{{.HostPort}}{{end}}' "${CONTAINER_NAME}")"
  [ "${binding}" = "127.0.0.1:${HOST_PORT}" ] || {
    echo "Existing AI CEO PostgreSQL container has unexpected host binding." >&2
    exit 1
  }
else
  if ss -H -ltn "sport = :${HOST_PORT}" 2>/dev/null | grep -q .; then
    echo "Beget localhost port ${HOST_PORT} is already occupied." >&2
    exit 1
  fi
  docker volume inspect "${VOLUME_NAME}" >/dev/null 2>&1 || docker volume create "${VOLUME_NAME}" >/dev/null
  docker pull "${IMAGE}" >/dev/null
  docker run -d \
    --name "${CONTAINER_NAME}" \
    --restart unless-stopped \
    --memory 512m \
    --cpus 0.75 \
    --env-file "${ENV_FILE}" \
    -v "${VOLUME_NAME}:/var/lib/postgresql/data" \
    -p "127.0.0.1:${HOST_PORT}:5432" \
    --health-cmd='pg_isready -U ai_ceo -d ai_ceo' \
    --health-interval=10s \
    --health-timeout=3s \
    --health-retries=10 \
    "${IMAGE}" >/dev/null
fi

docker start "${CONTAINER_NAME}" >/dev/null 2>&1 || true
healthy=false
for _ in $(seq 1 45); do
  state="$(docker inspect -f '{{if .State.Health}}{{.State.Health.Status}}{{else}}{{.State.Status}}{{end}}' "${CONTAINER_NAME}")"
  if [ "${state}" = "healthy" ]; then healthy=true; break; fi
  [ "${state}" = "unhealthy" ] && break
  sleep 2
done
[ "${healthy}" = "true" ] || {
  docker logs --tail=100 "${CONTAINER_NAME}" >&2 || true
  echo "AI CEO PostgreSQL did not become healthy." >&2
  exit 1
}

docker exec -e PGPASSWORD="${POSTGRES_PASSWORD}" "${CONTAINER_NAME}" \
  psql -X -qAt -v ON_ERROR_STOP=1 -U "${POSTGRES_USER}" -d "${POSTGRES_DB}" \
  -c "select current_database() || '|' || current_user;" \
  | grep -Fx 'ai_ceo|ai_ceo' >/dev/null

pubkey="$(cat "${TUNNEL_PUBKEY_FILE}")"
[[ "${pubkey}" =~ ^ssh-ed25519[[:space:]][A-Za-z0-9+/=]+([[:space:]].*)?$ ]] || {
  echo "Invalid AI CEO tunnel public key." >&2
  exit 1
}

mkdir -p "${HOME}/.ssh"
chmod 700 "${HOME}/.ssh"
touch "${HOME}/.ssh/authorized_keys"
chmod 600 "${HOME}/.ssh/authorized_keys"
tmp_auth="$(mktemp)"
grep -v ' ai-ceo-db-tunnel$' "${HOME}/.ssh/authorized_keys" > "${tmp_auth}" || true
printf 'command="/bin/sleep 2147483647",no-agent-forwarding,no-X11-forwarding,no-pty,no-user-rc,permitopen="127.0.0.1:%s" %s ai-ceo-db-tunnel\n' \
  "${HOST_PORT}" "${pubkey}" >> "${tmp_auth}"
mv "${tmp_auth}" "${HOME}/.ssh/authorized_keys"
chmod 600 "${HOME}/.ssh/authorized_keys"

echo "AI_CEO_BEGET_DB_READY container=${CONTAINER_NAME} local_port=${HOST_PORT}"
