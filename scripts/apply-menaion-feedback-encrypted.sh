#!/usr/bin/env bash
# Approved migration only; existing certificate/key; never activates a login or token.
set -euo pipefail
umask 077
root="${1:?isolated temporary directory required}"
[[ "$root" =~ ^/tmp/menaion-feedback\.[A-Za-z0-9]+$ ]]
trap 'rm -rf -- "$root"' EXIT
fail() { echo 'Menaion feedback migration outcome not confirmed; inspect ledger before any retry.' >&2; exit 1; }
test -d "$root" || fail
test "$(stat -c '%a' "$root")" = 700 || fail
test "$(docker inspect -f '{{.State.Running}}' supabase-db)" = true || fail
test -s "$HOME/.living-menaion/deploy-private.pem" || fail
test -s "$HOME/.living-menaion/deploy-cert.pem" || fail
fingerprint="$(openssl x509 -in "$HOME/.living-menaion/deploy-cert.pem" -outform DER | sha256sum | cut -d' ' -f1)"
test "$fingerprint" = '1c445517d9fe95784a9caced337ce5f34b9132610afd1946f325bd5ad8d385c9' || fail
test "$(sha256sum "$root/payload.b64" | cut -d' ' -f1)" = 'cf1d3ff3a61b4945198ea602f2b9be914cba600600d310c46e330b2271928117' || fail
base64 -d "$root/payload.b64" > "$root/payload.cms" || fail
openssl cms -decrypt -binary -inform DER -in "$root/payload.cms" \
  -recip "$HOME/.living-menaion/deploy-cert.pem" -inkey "$HOME/.living-menaion/deploy-private.pem" \
  -out "$root/migration.sql" 2>"$root/decrypt-error" || fail
test "$(sha256sum "$root/migration.sql" | cut -d' ' -f1)" = '15265e48dcbf87b24b7aed34c296c2a4a83cbba132a5e33bffc0cfdd9469444c' || fail
python3 "$root/build-transaction.py" "$root" 2>"$root/build-error" || fail
# Never emit PostgreSQL errors: CONTEXT can include private source or row data.
if ! docker exec -i supabase-db psql -X -qAt -U supabase_admin -d living_menaion \
  -v ON_ERROR_STOP=1 < "$root/transaction.sql" > "$root/result" 2> "$root/db-error"; then
  fail
fi
grep -qx 'MENAION_FEEDBACK_MIGRATION_VERIFIED' "$root/result" || fail
printf 'MENAION_FEEDBACK_MIGRATION_VERIFIED\n'
