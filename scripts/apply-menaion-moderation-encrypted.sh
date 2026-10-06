#!/usr/bin/env bash
# Existing protected transport only. Never creates keys, logins, tokens or runtime config.
set -euo pipefail
umask 077
root="${1:?isolated temporary directory required}"
mode="${2:?INSPECT or APPLY required}"
[[ "$root" =~ ^/tmp/menaion-moderation\.[A-Za-z0-9]+$ ]]
[[ "$mode" = INSPECT || "$mode" = APPLY ]]
test -d "$root" && test ! -L "$root"
test "$(stat -c '%a' "$root")" = 700
test "$(stat -c '%u' "$root")" = "$(id -u)"
trap 'rm -rf -- "$root"' EXIT
fail() { echo 'Menaion moderation outcome not confirmed; inspect ledger before any retry.' >&2; exit 1; }
for file in payload.b64 manifest.json build-transaction.py; do
  test -f "$root/$file" && test ! -L "$root/$file" || fail
done
test "$(sha256sum "$root/payload.b64" | cut -d' ' -f1)" = '0462c0804ee37bb73edfbe468c16ccd5cfd5de69a7f1e1e108c4d50625e7fa57' || fail
test "$(sha256sum "$root/manifest.json" | cut -d' ' -f1)" = '613887b5920dcffae6cad1db2b107ba0f8e366ae8c21f809a0b31f7d2fbf91a6' || fail
test "$(docker inspect -f '{{.State.Running}}' supabase-db)" = true || fail
test -s "$HOME/.living-menaion/deploy-private.pem" || fail
test -s "$HOME/.living-menaion/deploy-cert.pem" || fail
openssl x509 -in "$HOME/.living-menaion/deploy-cert.pem" -checkend 86400 -noout >/dev/null 2>&1 || fail
fingerprint="$(openssl x509 -in "$HOME/.living-menaion/deploy-cert.pem" -outform DER 2>/dev/null | sha256sum | cut -d' ' -f1)"
test "$fingerprint" = '1c445517d9fe95784a9caced337ce5f34b9132610afd1946f325bd5ad8d385c9' || fail
# Read-only target/history/object gate runs before decryption and every apply.
python3 "$root/build-transaction.py" inspect "$root" 2>"$root/build-error" || fail
docker exec -e PGOPTIONS='-c default_transaction_read_only=on -c statement_timeout=10000' \
  -i supabase-db psql -X -qAt -U supabase_admin -d living_menaion -v ON_ERROR_STOP=1 \
  < "$root/inspection.sql" > "$root/inspection-result" 2> "$root/db-error" || fail
state="$(cat "$root/inspection-result")"
if [[ "$state" = MENAION_MODERATION_ALREADY_APPLIED ]]; then
  printf '%s\n' "$state"
  exit 0
fi
test "$state" = MENAION_MODERATION_READY || fail
if [[ "$mode" = INSPECT ]]; then
  printf '%s\n' "$state"
  exit 0
fi
base64 -d "$root/payload.b64" > "$root/payload.cms" 2>"$root/decode-error" || fail
openssl cms -decrypt -binary -inform DER -in "$root/payload.cms" \
  -recip "$HOME/.living-menaion/deploy-cert.pem" -inkey "$HOME/.living-menaion/deploy-private.pem" \
  -out "$root/migration.sql" 2>"$root/decrypt-error" || fail
test "$(sha256sum "$root/migration.sql" | cut -d' ' -f1)" = 'ee2bf27553ca0a71baa275ad607b7ddbf0893e9e64d5687d8029d94bf592b499' || fail
python3 "$root/build-transaction.py" apply "$root" 2>"$root/build-error" || fail
# The transaction repeats the history gate under lock, then verifies grants before commit.
# Never emit PostgreSQL errors: CONTEXT may contain private SQL or submitted corrections.
docker exec -i supabase-db psql -X -qAt -U supabase_admin -d living_menaion \
  -v ON_ERROR_STOP=1 < "$root/transaction.sql" > "$root/result" 2> "$root/db-error" || fail
test "$(cat "$root/result")" = MENAION_MODERATION_MIGRATION_VERIFIED || fail
printf 'MENAION_MODERATION_MIGRATION_VERIFIED\n'
