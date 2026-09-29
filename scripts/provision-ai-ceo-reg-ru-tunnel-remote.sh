#!/usr/bin/env bash
set -Eeuo pipefail

BEGET_USER="${1:?Beget SSH user required}"
BEGET_HOST="${2:?Beget SSH host required}"

BASE_DIR="/opt/peerivo/ai-ceo"
DATABASE_ENV="${BASE_DIR}/database.env"
KEY_FILE="${BASE_DIR}/db-tunnel-ed25519"
KNOWN_HOSTS="${BASE_DIR}/beget-known-hosts"
NETWORK_NAME="ai-ceo-reg-ru"
NETWORK_MTU="1400"
TUNNEL_IMAGE="peerivo/ai-ceo-db-tunnel:1"
TUNNEL_NAME="ai-ceo-db-tunnel"

[ "$(id -u)" -eq 0 ] || {
  echo "REG.RU AI CEO database tunnel setup requires root." >&2
  exit 1
}

umask 077
mkdir -p "${BASE_DIR}"
chmod 700 "${BASE_DIR}"
test -s "${DATABASE_ENV}"
test -s "${KEY_FILE}"
test -s "${KNOWN_HOSTS}"
chmod 600 "${DATABASE_ENV}" "${KEY_FILE}" "${KNOWN_HOSTS}"

# shellcheck disable=SC1090
source "${DATABASE_ENV}"
[[ "${DATABASE_URL:-}" == postgresql://ai_ceo:*@ai-ceo-db-tunnel:5432/ai_ceo?sslmode=disable ]]
[[ "${DIRECT_URL:-}" == "${DATABASE_URL}" ]]
[[ "${RESEARCH_LINK_SECRET:-}" =~ ^[a-f0-9]{64}$ ]]

if ! docker network inspect "${NETWORK_NAME}" >/dev/null 2>&1; then
  docker network create \
    --driver bridge \
    --opt "com.docker.network.driver.mtu=${NETWORK_MTU}" \
    "${NETWORK_NAME}" >/dev/null
else
  configured_mtu="$(docker network inspect -f '{{ index .Options "com.docker.network.driver.mtu" }}' "${NETWORK_NAME}")"
  [ "${configured_mtu}" = "${NETWORK_MTU}" ] || {
    echo "Existing ${NETWORK_NAME} has unexpected MTU." >&2
    exit 1
  }
fi

build_dir="${BASE_DIR}/db-tunnel-image"
mkdir -p "${build_dir}"
cat > "${build_dir}/Dockerfile" <<'DOCKERFILE'
FROM alpine:3.22
RUN apk add --no-cache openssh-client
ENTRYPOINT ["ssh"]
DOCKERFILE

docker build -q -t "${TUNNEL_IMAGE}" "${build_dir}" >/dev/null

docker rm -f "${TUNNEL_NAME}" >/dev/null 2>&1 || true
docker run -d \
  --name "${TUNNEL_NAME}" \
  --restart unless-stopped \
  --read-only \
  --cap-drop ALL \
  --security-opt no-new-privileges:true \
  --tmpfs /tmp:rw,noexec,nosuid,size=8m \
  --network "${NETWORK_NAME}" \
  -v "${KEY_FILE}:/run/secrets/id_ed25519:ro" \
  -v "${KNOWN_HOSTS}:/run/secrets/known_hosts:ro" \
  "${TUNNEL_IMAGE}" \
  -NT \
  -o BatchMode=yes \
  -o IdentitiesOnly=yes \
  -o ExitOnForwardFailure=yes \
  -o ServerAliveInterval=30 \
  -o ServerAliveCountMax=3 \
  -o StrictHostKeyChecking=yes \
  -o UserKnownHostsFile=/run/secrets/known_hosts \
  -i /run/secrets/id_ed25519 \
  -L 0.0.0.0:5432:127.0.0.1:55432 \
  "${BEGET_USER}@${BEGET_HOST}" >/dev/null

ready=false
for _ in $(seq 1 30); do
  if docker exec "${TUNNEL_NAME}" sh -c 'nc -z 127.0.0.1 5432' >/dev/null 2>&1; then
    ready=true
    break
  fi
  if [ "$(docker inspect -f '{{.State.Running}}' "${TUNNEL_NAME}")" != "true" ]; then
    break
  fi
  sleep 2
done
[ "${ready}" = "true" ] || {
  docker logs --tail=100 "${TUNNEL_NAME}" >&2 || true
  echo "AI CEO database SSH tunnel did not become ready." >&2
  exit 1
}

docker run --rm \
  --network "${NETWORK_NAME}" \
  --env-file "${DATABASE_ENV}" \
  postgres:17-alpine \
  sh -c 'psql "$DIRECT_URL" -X -qAt -v ON_ERROR_STOP=1 -c "select current_database() || '\''|'\'' || current_user;"' \
  | grep -Fx 'ai_ceo|ai_ceo' >/dev/null

echo "AI_CEO_REG_RU_DB_TUNNEL_READY network=${NETWORK_NAME}"
