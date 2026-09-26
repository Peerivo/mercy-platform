#!/usr/bin/env bash
set -euo pipefail

site="${1:?canonical site URL required}"
site="${site%/}"
curl_bin="${CURL_BIN:-curl}"

case "${site}" in
  https://*) ;;
  *)
    echo "::error::Canonical Mercy site must use HTTPS" >&2
    exit 1
    ;;
esac

fail() {
  echo "::error::Public Auth callback did not stay on canonical Mercy origin" >&2
  exit 1
}

is_same_origin() {
  case "$1" in
    "${site}/"*) return 0 ;;
    *) return 1 ;;
  esac
}

is_callback_error_target() {
  local url="$1"
  local relative path query param
  is_same_origin "${url}" || return 1
  relative="${url#"${site}"}"
  [[ "${relative}" == *"?"* ]] || return 1
  path="${relative%%\?*}"
  [[ "${path}" == "/auth" || "${path}" == "/auth/" ]] || return 1
  query="${relative#*\?}"
  IFS='&' read -r -a params <<< "${query}"
  for param in "${params[@]}"; do
    if [[ "${param}" == "error=callback" ]]; then
      return 0
    fi
  done
  return 1
}

is_callback_hop() {
  local url="$1"
  local relative path
  is_same_origin "${url}" || return 1
  relative="${url#"${site}"}"
  path="${relative%%\?*}"
  [[ "${path}" == "/auth/callback" || "${path}" == "/auth/callback/" ]]
}

current="${site}/auth/callback"
for _ in 1 2 3 4; do
  mapfile -t response < <(
    "${curl_bin}" --silent --show-error --max-time 15 \
      --output /dev/null \
      --write-out '%{http_code}\n%{redirect_url}\n' \
      "${current}"
  )

  code="${response[0]:-}"
  redirect_url="${response[1]:-}"

  [[ "${code}" == "307" || "${code}" == "308" ]] || fail
  [[ -n "${redirect_url}" ]] || fail
  is_same_origin "${redirect_url}" || fail

  if is_callback_error_target "${redirect_url}"; then
    echo "AUTH_MAGIC_LINK_REDIRECT_CONFIGURATION_VERIFIED=1"
    exit 0
  fi

  if is_callback_hop "${redirect_url}"; then
    current="${redirect_url}"
    continue
  fi

  fail
done

fail
