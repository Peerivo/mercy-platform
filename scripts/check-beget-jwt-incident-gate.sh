#!/usr/bin/env bash
set -euo pipefail

if [[ "${BEGET_JWT_ROTATION_ATTESTATION:-}" == "rotated-and-verified-after-run-8" && "${RECOVER_FROM_RUN_ID:-}" == "35770879007" ]]; then
  echo "The legacy baseline predates JWT rotation and cannot be restored after attestation." >&2
  exit 1
fi

case "${1:-}" in
  RECOVER)
    exit 0
    ;;
  MIGRATE)
    if [[ "${BEGET_JWT_ROTATION_ATTESTATION:-}" != "rotated-and-verified-after-run-8" ]]; then
      echo "Beget JWT incident gate is closed: rotate and verify the exposed signing secret and dependent keys before MIGRATE." >&2
      exit 1
    fi
    ;;
  *)
    echo "Invalid cutover mode." >&2
    exit 1
    ;;
esac
