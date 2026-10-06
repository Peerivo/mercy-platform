#!/usr/bin/env bash
# Fixed reviewed target; schema only, never runtime/auth/Notify activation.
set -euo pipefail
umask 077
root="${1:?isolated temporary directory required}"
mode="${2:?INSPECT or APPLY required}"
[[ "$root" =~ ^/tmp/menaion-issue-package\.[A-Za-z0-9]+$ ]]
[[ "$mode" = INSPECT || "$mode" = APPLY ]]
test -d "$root" && test ! -L "$root"
test "$(stat -c '%a' "$root")" = 700
test "$(stat -c '%u' "$root")" = "$(id -u)"
trap 'rm -rf -- "$root"' EXIT
fail() { echo 'Menaion issue package outcome not confirmed; inspect before any retry.' >&2; exit 1; }
# Neither environment overrides nor a selected Docker context may redirect the fixed target.
[[ -z "${DOCKER_HOST:-}" && -z "${DOCKER_CONTEXT:-}" ]] || fail
docker_local=(docker --host unix:///var/run/docker.sock)
for file in payload10.b64 payload12.b64 manifest.json contract.json build-transaction.py; do
  test -f "$root/$file" && test ! -L "$root/$file" || fail
done
check_hash() { test "$(sha256sum "$root/$1" | cut -d' ' -f1)" = "$2" || fail; }
check_hash payload10.b64 '0462c0804ee37bb73edfbe468c16ccd5cfd5de69a7f1e1e108c4d50625e7fa57'
check_hash payload12.b64 '1bc348d8c88f45815a34defd25e77b44aa589892a4be150ff3dddeb2ae5ebe68'
check_hash manifest.json '613887b5920dcffae6cad1db2b107ba0f8e366ae8c21f809a0b31f7d2fbf91a6'
check_hash contract.json 'd2ff79cf5ecf3818e807b58130e05835b43369b4665fd9fa14c4b9361e67a2ce'
test "$("${docker_local[@]}" inspect -f '{{.State.Running}}' supabase-db)" = true || fail
test -s "$HOME/.living-menaion/deploy-private.pem" || fail
test -s "$HOME/.living-menaion/deploy-cert.pem" || fail
openssl x509 -in "$HOME/.living-menaion/deploy-cert.pem" -checkend 86400 -noout >/dev/null 2>&1 || fail
fingerprint="$(openssl x509 -in "$HOME/.living-menaion/deploy-cert.pem" -outform DER 2>/dev/null | sha256sum | cut -d' ' -f1)"
test "$fingerprint" = '1c445517d9fe95784a9caced337ce5f34b9132610afd1946f325bd5ad8d385c9' || fail
python3 "$root/build-transaction.py" inspect "$root" 2>"$root/build-error" || fail
"${docker_local[@]}" exec -e PGOPTIONS='-c default_transaction_read_only=on -c statement_timeout=10000' \
  -i supabase-db env -u PGHOST -u PGHOSTADDR -u PGPORT -u PGSERVICE -u PGSERVICEFILE psql -X -qAt -w -U supabase_admin -d living_menaion -v ON_ERROR_STOP=1 \
  < "$root/inspection.sql" > "$root/inspection-result" 2> "$root/db-error" || fail
mapfile -t inspection < "$root/inspection-result"
test "${#inspection[@]}" = 2 || fail
state="${inspection[0]}"
legacy="${inspection[1]}"
[[ "$legacy" =~ ^MENAION_ISSUE_PACKAGE_LEGACY_UNMAPPED_ATTEMPTED=(0|[1-9][0-9]{0,18})$ ]] || fail
if [[ "$state" = MENAION_ISSUE_PACKAGE_ALREADY_APPLIED ]]; then
  printf '%s\n%s\n' "$state" "$legacy"
  exit 0
fi
test "$state" = MENAION_ISSUE_PACKAGE_READY || fail
if [[ "$mode" = INSPECT ]]; then
  printf '%s\n%s\n' "$state" "$legacy"
  exit 0
fi
for version in 10 12; do
  base64 -d "$root/payload$version.b64" > "$root/payload$version.cms" 2>"$root/decode-error" || fail
  openssl cms -decrypt -binary -inform DER -in "$root/payload$version.cms" \
    -recip "$HOME/.living-menaion/deploy-cert.pem" -inkey "$HOME/.living-menaion/deploy-private.pem" \
    -out "$root/migration$version.sql" 2>"$root/decrypt-error" || fail
done
check_hash migration10.sql 'ee2bf27553ca0a71baa275ad607b7ddbf0893e9e64d5687d8029d94bf592b499'
check_hash migration12.sql '57661d31ed4bc5f441b94a1b9f44b704e17ac6b98c390c8a4bddfcdd16a076a3'
python3 "$root/build-transaction.py" apply "$root" 2>"$root/build-error" || fail
# One transaction checks exact history under lock, skips recorded10, applies12,
# verifies all catalogs/unchanged roles/content11 and records missing ledger rows.
# Never print raw PostgreSQL errors, which may include private source or row data.
"${docker_local[@]}" exec -i supabase-db env -u PGHOST -u PGHOSTADDR -u PGPORT -u PGSERVICE -u PGSERVICEFILE -u PGOPTIONS psql -X -qAt -w -U supabase_admin -d living_menaion \
  -v ON_ERROR_STOP=1 < "$root/transaction.sql" > "$root/result" 2> "$root/db-error" || fail
mapfile -t result < "$root/result"
test "${#result[@]}" = 2 || fail
[[ "${result[0]}" =~ ^MENAION_ISSUE_PACKAGE_LEGACY_UNMAPPED_ATTEMPTED=(0|[1-9][0-9]{0,18})$ ]] || fail
test "${result[1]}" = MENAION_ISSUE_PACKAGE_VERIFIED || fail
printf '%s\n%s\n' MENAION_ISSUE_PACKAGE_VERIFIED "${result[0]}"
